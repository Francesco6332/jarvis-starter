import { Router } from 'express';
import { randomBytes, createHash } from 'node:crypto';
import { join } from 'node:path';
import { z } from 'zod';
import { JsonStore } from './store.js';

const scope = 'https://www.googleapis.com/auth/calendar.events.owned';
const dateTime = z.string().datetime({ offset: true });
export const eventSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().max(3000).default(''),
  start: dateTime, end: dateTime,
  timeZone: z.string().refine(value => { try { new Intl.DateTimeFormat('it', { timeZone: value }); return true; } catch { return false; } }),
  reminderMinutes: z.number().int().min(0).max(40320).default(10),
}).strict().refine(e => Date.parse(e.end) > Date.parse(e.start), 'La fine deve seguire l’inizio.');
export type CalendarEvent = z.infer<typeof eventSchema>;
type Tokens = { access_token?: string; refresh_token?: string; expires_at?: number; scope?: string };
type GoogleEvent = { id: string; summary?: string; start?: { dateTime?: string; date?: string }; end?: { dateTime?: string; date?: string }; htmlLink?: string };

export function createCalendar(dataDir: string, request: typeof fetch = fetch) {
  const store = new JsonStore<Tokens>(join(dataDir, 'google-tokens.json'), () => ({}));
  const states = new Map<string, { verifier: string; expires: number }>();
  const clientId = () => process.env.GOOGLE_CLIENT_ID || '';
  const clientSecret = () => process.env.GOOGLE_CLIENT_SECRET || '';
  const redirectUri = () => process.env.GOOGLE_REDIRECT_URI || 'http://localhost:5173/api/google/callback';
  const configured = () => Boolean(clientId() && clientSecret());
  const router = Router();
  async function tokenRequest(values: Record<string, string>) {
    const response = await request('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ ...values, client_id: clientId(), client_secret: clientSecret() }),
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error('Autorizzazione Google scaduta o non valida. Ricollega il calendario.');
    return await response.json() as { access_token: string; refresh_token?: string; expires_in: number; scope?: string };
  }
  async function accessToken() {
    const tokens = await store.update(async current => {
      if (current.access_token && (current.expires_at || 0) > Date.now() + 60000) return current;
      if (!current.refresh_token) throw new Error('Collega Google Calendar dal pannello Permessi.');
      const fresh = await tokenRequest({ grant_type: 'refresh_token', refresh_token: current.refresh_token });
      return { ...current, ...fresh, expires_at: Date.now() + fresh.expires_in * 1000 };
    });
    return tokens.access_token!;
  }
  async function google(path: string, init: RequestInit = {}) {
    const token = await accessToken();
    const response = await request(`https://www.googleapis.com/calendar/v3/calendars/primary/events${path}`, {
      ...init, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(15000),
    });
    return response;
  }
  async function status() {
    const tokens = await store.read();
    return { configured: configured(), connected: Boolean(tokens.refresh_token || (tokens.access_token && (tokens.expires_at || 0) > Date.now())), calendar: 'primary' };
  }
  router.get('/status', async (_req, res) => { try { res.json(await status()); } catch { res.status(500).json({ error: 'Configurazione Google non leggibile.' }); } });
  router.post('/connect', (_req, res) => {
    if (!configured()) { res.status(503).json({ error: 'Configura GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET in apps/api/.env. Consulta docs/GOOGLE_CALENDAR.md.' }); return; }
    for (const [key, value] of states) if (value.expires < Date.now()) states.delete(key);
    if (states.size >= 20) { res.status(429).json({ error: 'Troppe connessioni in corso. Riprova tra poco.' }); return; }
    const state = randomBytes(32).toString('hex'), verifier = randomBytes(48).toString('base64url');
    states.set(state, { verifier, expires: Date.now() + 600000 });
    res.cookie('jarvis_oauth', state, { httpOnly: true, sameSite: 'lax', secure: redirectUri().startsWith('https:'), path: '/api/google', maxAge: 600000 });
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.search = new URLSearchParams({ client_id: clientId(), redirect_uri: redirectUri(), response_type: 'code', scope, state, access_type: 'offline', prompt: 'consent', code_challenge_method: 'S256', code_challenge: createHash('sha256').update(verifier).digest('base64url') }).toString();
    res.json({ url: url.toString() });
  });
  router.get('/callback', async (req, res) => {
    const state = typeof req.query.state === 'string' ? req.query.state : '';
    const cookie = req.headers.cookie?.split(';').map(x => x.trim()).find(x => x.startsWith('jarvis_oauth='))?.slice('jarvis_oauth='.length);
    const pending = states.get(state);
    if (!pending || cookie !== state || pending.expires < Date.now()) { res.status(400).send('Sessione Google non valida o scaduta. Torna a JARVIS e riprova.'); return; }
    states.delete(state); res.clearCookie('jarvis_oauth', { path: '/api/google' });
    if (typeof req.query.code !== 'string') { res.redirect((process.env.WEB_ORIGIN || 'http://localhost:5173') + '/?google=denied'); return; }
    try {
      const tokens = await tokenRequest({ grant_type: 'authorization_code', code: req.query.code, redirect_uri: redirectUri(), code_verifier: pending.verifier });
      if (!tokens.access_token || !tokens.scope?.split(' ').includes(scope)) throw new Error('Permesso calendario non concesso.');
      await store.update(() => ({ ...tokens, expires_at: Date.now() + tokens.expires_in * 1000 }));
      res.redirect((process.env.WEB_ORIGIN || 'http://localhost:5173') + '/?google=connected');
    } catch { res.status(502).send('Connessione Google non riuscita. Controlla client, redirect e autorizzazioni, poi riprova da JARVIS.'); }
  });
  router.post('/disconnect', async (_req, res) => {
    try {
      await store.update(() => ({}));
      res.json({ ok: true });
    } catch { res.status(500).json({ error: 'Impossibile scollegare Google.' }); }
  });
  async function list(start: string, end: string) {
    const query = z.object({ start: dateTime, end: dateTime }).refine(d => Date.parse(d.end) > Date.parse(d.start)).parse({ start, end });
    const params = new URLSearchParams({ timeMin: query.start, timeMax: query.end, singleEvents: 'true', orderBy: 'startTime', maxResults: '50' });
    const response = await google(`?${params}`);
    if (!response.ok) throw new Error(`Lettura calendario non riuscita (${response.status}). Controlla i permessi Google.`);
    const data = await response.json() as { items?: GoogleEvent[]; nextPageToken?: string };
    return { events: (data.items || []).map(e => ({ id: e.id, title: e.summary || '(senza titolo)', start: e.start, end: e.end, url: e.htmlLink })), truncated: Boolean(data.nextPageToken) };
  }
  async function insert(event: CalendarEvent, id: string) {
    const value = eventSchema.parse(event);
    const response = await google('?sendUpdates=none', { method: 'POST', body: JSON.stringify({
      id, summary: value.title, description: value.description,
      start: { dateTime: value.start, timeZone: value.timeZone }, end: { dateTime: value.end, timeZone: value.timeZone },
      reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: value.reminderMinutes }] },
    }) });
    // The same proposal always uses the same Google ID, including after an uncertain network result.
    const result = response.status === 409 ? await google(`/${encodeURIComponent(id)}`) : response;
    if (!result.ok) throw new Error(`Creazione evento non riuscita (${result.status}). Puoi riprovare la stessa proposta.`);
    const data = await result.json() as GoogleEvent;
    return { id: data.id, title: data.summary, url: data.htmlLink };
  }
  return { router, status, list, insert };
}
