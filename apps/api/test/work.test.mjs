import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWork } from '../dist/work.js';
import { createCalendar } from '../dist/calendar.js';
import { sseData } from '../dist/stream.js';
import { chatStream } from '../dist/agent.js';
import { takeSpeechChunks } from '../../web/src/lib/voice.ts';
const event = { title: 'Ripasso', description: 'Computer Security', start: '2026-10-10T18:00:00+02:00', end: '2026-10-10T19:00:00+02:00', timeZone: 'Europe/Rome', reminderMinutes: 10 };
async function fixture(t, router) {
  const app = express(); app.use(express.json()); app.use(router);
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}
async function directory(t) { const dir = await mkdtemp(join(tmpdir(), 'jarvis-test-')); t.after(() => rm(dir, { recursive: true, force: true })); return dir; }
const json = (method, body) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
test('permissions, persistence, event approval and duplicate confirmation', async t => {
  const dir = await directory(t); let inserted = 0;
  const calendar = { status: async () => ({ connected: true, configured: true }), list: async () => ({ events: [] }), insert: async (value, id) => { inserted++; await new Promise(r => setTimeout(r, 20)); return { id, title: value.title }; } };
  const work = createWork(dir, calendar), url = await fixture(t, work.router);
  await assert.rejects(work.execute('create_study_task', { title: 'A', dueAt: null }), /Permesso/);
  assert.equal((await work.tools()).length, 0);
  assert.equal((await fetch(`${url}/permissions`, json('PUT', { calendarRead: true, calendarWrite: true, studyTasks: true }))).status, 200);
  await Promise.all(Array.from({ length: 12 }, (_, i) => work.execute('create_study_task', { title: `Task ${i}`, dueAt: null, notes: '' })));
  assert.equal((await work.execute('list_study_tasks', {})).tasks.length, 12);
  assert.equal((await createWork(dir, calendar).execute('list_study_tasks', {})).tasks.length, 12);
  await assert.rejects(work.execute('propose_calendar_event', { ...event, end: event.start }));
  await assert.rejects(work.execute('propose_calendar_event', { ...event, attendees: ['someone@example.com'] }));
  const { proposal } = await work.execute('propose_calendar_event', event);
  assert.equal(inserted, 0);
  const [a, b] = await Promise.all([work.confirm(proposal.id), work.confirm(proposal.id)]);
  assert.deepEqual(a, b); assert.equal(inserted, 1);
  await work.confirm(proposal.id); assert.equal(inserted, 1);
  const cancelled = (await work.execute('propose_calendar_event', event)).proposal;
  await fetch(`${url}/proposals/${cancelled.id}/cancel`, json('POST', {}));
  await assert.rejects(work.confirm(cancelled.id), /annullata/);
  await fetch(`${url}/permissions`, json('PUT', { calendarRead: false, calendarWrite: false, studyTasks: false }));
  await assert.rejects(work.execute('list_calendar_events', { start: event.start, end: event.end }), /Permesso/);
  await assert.rejects(work.confirm(proposal.id), /Permesso/);
  await assert.rejects(work.execute('run_shell', {}), /non autorizzato/);
});

test('Google OAuth validates browser state; refresh and duplicate event handling', async t => {
  process.env.GOOGLE_CLIENT_ID = 'test-client'; process.env.GOOGLE_CLIENT_SECRET = 'test-secret';
  t.after(() => { delete process.env.GOOGLE_CLIENT_ID; delete process.env.GOOGLE_CLIENT_SECRET; });
  let exchanged = 0, refreshes = 0, writes = 0, verifierSeen = false;
  const scope = 'https://www.googleapis.com/auth/calendar.events.owned';
  const calendar = createCalendar(await directory(t), async (url, init) => {
    if (url.includes('oauth2.googleapis.com')) {
      if (init.body.get('grant_type') === 'refresh_token') { refreshes++; return Response.json({ access_token: 'new-token', expires_in: 3600 }); }
      exchanged++; verifierSeen = Boolean(init.body.get('code_verifier'));
      return Response.json({ access_token: 'test-token', refresh_token: 'test-refresh', expires_in: 0, scope });
    }
    assert.equal(init.headers.Authorization, 'Bearer new-token');
    if (init.method === 'POST') { writes++; const value = JSON.parse(init.body); assert.equal(value.reminders.overrides[0].minutes, 10); assert(!('attendees' in value)); return Response.json({}, { status: 409 }); }
    return Response.json({ id: 'abc123', summary: 'Ripasso' });
  });
  const url = await fixture(t, calendar.router);
  const start = await fetch(`${url}/connect`, json('POST', {})), body = await start.json();
  const state = new URL(body.url).searchParams.get('state');
  assert.equal(new URL(body.url).searchParams.get('code_challenge_method'), 'S256');
  assert.equal((await fetch(`${url}/callback?state=${state}&code=code`)).status, 400);
  assert.equal(exchanged, 0);
  const cookie = start.headers.get('set-cookie').split(';')[0];
  const accepted = await fetch(`${url}/callback?state=${state}&code=code`, { headers: { cookie }, redirect: 'manual' });
  assert.equal(accepted.status, 302); assert(verifierSeen);
  assert.equal((await fetch(`${url}/callback?state=${state}&code=code`, { headers: { cookie } })).status, 400);
  assert((await calendar.status()).connected);
  assert.equal((await calendar.insert(event, 'abc123')).id, 'abc123');
  assert.equal(refreshes, 1); assert.equal(writes, 1);
  assert(!JSON.stringify(await calendar.status()).includes('test-refresh'));
  await fetch(`${url}/disconnect`, json('POST', {})); assert.equal((await calendar.status()).connected, false);
});

test('SSE parser preserves split UTF-8 and CRLF frames', async () => {
  const bytes = new TextEncoder().encode('data: {"text":"caffè"}\r\n\r\ndata: [DONE]\n\n');
  const body = new ReadableStream({ start(controller) { for (const byte of bytes) controller.enqueue(new Uint8Array([byte])); controller.close(); } });
  const values = []; for await (const value of sseData(body)) values.push(value);
  assert.deepEqual(values, ['{"text":"caffè"}', '[DONE]']);
});

test('speech emits complete short sentences before completion and flushes tail', () => {
  assert.deepEqual(takeSpeechChunks('Ciao Francesco. Sto preparando'), { chunks: ['Ciao Francesco.'], rest: 'Sto preparando' });
  assert.deepEqual(takeSpeechChunks('Valore 3.14, corretto.', true).chunks, ['Valore 3.14, corretto.']);
  const long = takeSpeechChunks('parola '.repeat(100), true);
  assert(long.chunks.every(c => c.length <= 260)); assert.equal(long.rest, '');
});

test('streaming agent accumulates tool arguments, returns proposal and never inserts', async t => {
  process.env.OPENAI_API_KEY = 'test-only'; t.after(() => delete process.env.OPENAI_API_KEY);
  const dir = await directory(t); let insertions = 0, calls = 0;
  const work = createWork(dir, { status: async () => ({ connected: true }), insert: async () => { insertions++; }, list: async () => ({ events: [] }) });
  const setupUrl = await fixture(t, work.router);
  await fetch(`${setupUrl}/permissions`, json('PUT', { calendarRead: true, calendarWrite: true, studyTasks: true }));
  const mock = async (_url, options) => {
    calls++; const sent = JSON.parse(options.body);
    let records;
    if (calls === 1) {
      const args = JSON.stringify(event);
      records = [{ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call1', function: { name: 'propose_calendar_event', arguments: args.slice(0, 20) } }] } }] }, { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: args.slice(20) } }] } }] }];
    } else {
      const tool = sent.messages.find(m => m.role === 'tool'); assert.equal(tool.tool_call_id, 'call1'); assert(JSON.parse(tool.content).proposal);
      records = [{ choices: [{ delta: { content: 'Conferma la proposta nella scheda.' } }] }];
    }
    return new Response(records.map(r => `data: ${JSON.stringify(r)}\n\n`).join('') + 'data: [DONE]\n\n');
  };
  const router = express.Router(); router.post('/chat', chatStream(work, async () => [], mock));
  const url = await fixture(t, router);
  const response = await fetch(`${url}/chat`, json('POST', { mode: 'assistant', messages: [{ role: 'user', content: 'Crea evento' }] }));
  const events = []; for await (const value of sseData(response.body)) events.push(JSON.parse(value));
  assert(events.some(e => e.type === 'proposal')); assert(events.some(e => e.type === 'delta')); assert.equal(events.at(-1).type, 'done');
  assert.equal(insertions, 0); assert.equal(calls, 2);
});

test('voice queue cancels pending audio and plays prefetched phrases in order', async t => {
  const { VoiceQueue } = await import('../../web/src/lib/voice.ts');
  const originals = { window: globalThis.window, Audio: globalThis.Audio, fetch: globalThis.fetch };
  t.after(() => { Object.assign(globalThis, originals); });
  const played = [], requests = [], states = [];
  globalThis.window = { speechSynthesis: { cancel() {} } };
  globalThis.Audio = class {
    async play() { played.push(this); setTimeout(() => this.onended?.(), 5); }
    pause() {}
  };
  globalThis.fetch = async (_url, options) => {
    requests.push(JSON.parse(options.body).text);
    await new Promise(r => setTimeout(r, 15));
    return Response.json({ id: String(requests.length), url: `/api/speech/${requests.length}` }, { status: 201 });
  };
  const queue = new VoiceQueue(active => states.push(active), error => assert.fail(error), () => true);
  queue.enqueue('Da annullare.'); queue.stop();
  await new Promise(r => setTimeout(r, 30)); assert.equal(played.length, 0);
  queue.enqueue('Prima.'); queue.enqueue('Seconda.');
  await new Promise(r => setTimeout(r, 80));
  assert.equal(played.length, 2); assert.deepEqual(requests, ['Da annullare.', 'Prima.', 'Seconda.']); assert.equal(states.at(-1), false);
});

test('production API rejects cross-origin writes and supports permission/task flow', async t => {
  const { spawn } = await import('node:child_process');
  const dir = await directory(t);
  const server = spawn(process.execPath, ['apps/api/dist/index.js'], { env: { ...process.env, PORT: '18791', JARVIS_DATA_DIR: dir, OPENAI_API_KEY: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => new Promise(resolve => { if (server.exitCode !== null) return resolve(); server.once('exit', resolve); server.kill(); }));
  await new Promise((resolve, reject) => {
    let output = ''; const timer = setTimeout(() => reject(Error('Startup timeout')), 5000);
    server.stdout.on('data', d => { output += d; if (output.includes('API pronta')) { clearTimeout(timer); resolve(); } });
    server.once('error', reject);
  });
  const base = 'http://127.0.0.1:18791';
  assert.equal((await fetch(`${base}/api/health`)).status, 200);
  assert.equal((await fetch(`${base}/api/workspace/permissions`, json('PUT', {}))).status, 403);
  const options = json('PUT', { calendarRead: false, calendarWrite: false, studyTasks: true });
  options.headers['X-Jarvis-Client'] = 'web'; options.headers.Origin = 'https://untrusted.example';
  assert.equal((await fetch(`${base}/api/workspace/permissions`, options)).status, 403);
  options.headers.Origin = 'http://localhost:5173';
  assert.equal((await fetch(`${base}/api/workspace/permissions`, options)).status, 200);
  const create = json('POST', { title: 'Ripasso CSS', dueAt: null, notes: '' }); create.headers['X-Jarvis-Client'] = 'web';
  assert.equal((await fetch(`${base}/api/workspace/tasks`, create)).status, 201);
  const state = await (await fetch(`${base}/api/workspace`)).json(); assert.equal(state.tasks.length, 1);
  const chat = json('POST', { mode: 'study', messages: [{ role: 'user', content: 'Quiz' }] }); chat.headers['X-Jarvis-Client'] = 'web';
  const result = await fetch(`${base}/api/chat/stream`, chat); const events = [];
  for await (const value of sseData(result.body)) events.push(JSON.parse(value));
  assert.equal(events.at(-1).type, 'done'); assert(events[0].text.includes('Modalità demo'));
});
