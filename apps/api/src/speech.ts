import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';

const input = z.object({ text: z.string().trim().min(1).max(1800) });
const INSTRUCTIONS = 'Parla in italiano con voce maschile adulta, calda, spontanea e nitida. Conversazione naturale, ritmo moderato e scorrevole, brevi pause espressive, nessun tono robotico. Pronuncia correttamente nomi e termini tecnici inglesi.';
type Job = { chunks: Buffer[]; done: boolean; failed: boolean; controller: AbortController; listeners: Set<() => void>; timer: ReturnType<typeof setTimeout> };

/**
 * Two-step TTS so the browser can play while OpenAI is still generating:
 * POST (CSRF-protected) starts the generation at once and returns an unguessable id,
 * GET streams the bytes received so far and then the live ones to an <audio> element.
 */
export function createSpeech(request: typeof fetch = fetch) {
  const router = Router(), jobs = new Map<string, Job>();
  const notify = (job: Job) => { for (const listener of [...job.listeners]) listener(); };
  function drop(id: string) {
    const job = jobs.get(id); if (!job) return;
    jobs.delete(id); clearTimeout(job.timer);
    if (!job.done) { job.controller.abort(); job.done = true; job.failed = true; notify(job); }
  }
  async function generate(job: Job, text: string) {
    try {
      const response = await request('https://api.openai.com/v1/audio/speech', {
        method: 'POST', signal: AbortSignal.any([job.controller.signal, AbortSignal.timeout(30000)]),
        headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: process.env.OPENAI_TTS_MODEL || 'gpt-4o-mini-tts', voice: process.env.OPENAI_TTS_VOICE || 'onyx', instructions: INSTRUCTIONS, input: text, response_format: 'mp3' }),
      });
      if (!response.ok || !response.body) { console.error('TTS error', response.status); throw new Error('tts'); }
      for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) { job.chunks.push(Buffer.from(chunk)); notify(job); }
    } catch { job.failed = !job.chunks.length; }
    finally { job.done = true; notify(job); }
  }
  router.post('/', (req, res) => {
    const parsed = input.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: 'Testo non valido.' }); return; }
    if (!process.env.OPENAI_API_KEY) { res.status(503).json({ error: 'Chiave API mancante.' }); return; }
    // Bound memory and cost: only a few phrases are ever queued by the client.
    while (jobs.size >= 8) drop(jobs.keys().next().value!);
    const id = randomUUID();
    const job: Job = { chunks: [], done: false, failed: false, controller: new AbortController(), listeners: new Set(), timer: setTimeout(() => drop(id), 120000) };
    jobs.set(id, job);
    void generate(job, parsed.data.text);
    res.status(201).json({ id, url: `/api/speech/${id}` });
  });
  router.get('/:id', async (req, res) => {
    const job = jobs.get(req.params.id);
    if (!job) { res.status(404).json({ error: 'Audio non trovato o scaduto.' }); return; }
    // Wait for the first bytes so a provider error can still become a proper status code.
    await new Promise<void>(resolve => { if (job.chunks.length || job.done) return resolve(); const ready = () => { job.listeners.delete(ready); resolve(); }; job.listeners.add(ready); });
    if (job.failed) { res.status(502).json({ error: 'Sintesi vocale non disponibile.' }); return; }
    res.setHeader('Content-Type', 'audio/mpeg'); res.setHeader('Cache-Control', 'no-store');
    let sent = 0;
    const pump = () => {
      while (sent < job.chunks.length) res.write(job.chunks[sent++]);
      if (job.done) { job.listeners.delete(pump); res.end(); }
    };
    job.listeners.add(pump); pump();
    res.once('close', () => { job.listeners.delete(pump); if (!res.writableFinished) drop(req.params.id); });
  });
  router.delete('/:id', (req, res) => { drop(req.params.id); res.json({ ok: true }); });
  return { router, close: () => { for (const id of [...jobs.keys()]) drop(id); } };
}
