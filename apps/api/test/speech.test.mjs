import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createSpeech } from '../dist/speech.js';
import { speakable, takeSpeechChunks, VoiceQueue } from '../../web/src/lib/voice.ts';

async function serve(t, request) {
  const speech = createSpeech(request);
  const app = express(); app.use(express.json()); app.use('/api/speech', speech.router);
  const server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
  t.after(() => { speech.close(); return new Promise(r => server.close(r)); });
  return `http://127.0.0.1:${server.address().port}/api/speech`;
}
const post = (url, text) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) });

test('speech streams audio bytes before the provider has finished', async t => {
  const previous = process.env.OPENAI_API_KEY; process.env.OPENAI_API_KEY = 'test-key';
  t.after(() => { if (previous === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = previous; });
  let finish, sent;
  const url = await serve(t, async (_url, options) => {
    sent = JSON.parse(options.body);
    return new Response(new ReadableStream({ start(c) { c.enqueue(new Uint8Array([1, 2])); finish = () => { c.enqueue(new Uint8Array([3])); c.close(); }; } }), { headers: { 'Content-Type': 'audio/mpeg' } });
  });
  const created = await post(url, 'Ciao Francesco.');
  assert.equal(created.status, 201);
  const { id } = await created.json();
  assert.equal(sent.voice, 'onyx'); assert.equal(sent.input, 'Ciao Francesco.');
  const audio = await fetch(`${url}/${id}`);
  assert.equal(audio.headers.get('content-type'), 'audio/mpeg');
  const reader = audio.body.getReader();
  assert.deepEqual([...(await reader.read()).value], [1, 2], 'first bytes arrive while generation is still running');
  finish();
  const rest = []; for (let r = await reader.read(); !r.done; r = await reader.read()) rest.push(...r.value);
  assert.deepEqual(rest, [3]);
  assert.equal((await fetch(`${url}/unknown`)).status, 404);
});

test('speech reports provider errors and cancels generation on delete', async t => {
  const previous = process.env.OPENAI_API_KEY; process.env.OPENAI_API_KEY = 'test-key';
  t.after(() => { if (previous === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = previous; });
  let aborted = false, fail = true;
  const url = await serve(t, async (_url, options) => {
    if (fail) return new Response('no credit', { status: 429 });
    options.signal.addEventListener('abort', () => { aborted = true; });
    return new Promise(() => {});
  });
  const { id } = await (await post(url, 'Errore.')).json();
  assert.equal((await fetch(`${url}/${id}`)).status, 502);
  fail = false;
  const second = await (await post(url, 'Annulla.')).json();
  await fetch(`${url}/${second.id}`, { method: 'DELETE' });
  assert.equal(aborted, true);
  delete process.env.OPENAI_API_KEY;
  assert.equal((await post(url, 'Senza chiave.')).status, 503);
});

test('spoken text drops markdown, links, list numbers and emoji', () => {
  assert.equal(speakable('**Ecco** le [fonti](https://example.com) 🚀 https://x.it/a'), 'Ecco le fonti');
  assert.deepEqual(takeSpeechChunks('1. Prima voce.\n2. Seconda voce.', true).chunks, ['Prima voce.', 'Seconda voce.']);
});

test('voice queue merges phrases that are not being generated yet', async t => {
  const originals = { window: globalThis.window, Audio: globalThis.Audio, fetch: globalThis.fetch };
  t.after(() => { Object.assign(globalThis, originals); });
  const requests = [];
  globalThis.window = { speechSynthesis: { cancel() {} } };
  globalThis.Audio = class { async play() { setTimeout(() => this.onended?.(), 5); } pause() {} };
  globalThis.fetch = async (_url, options) => { requests.push(JSON.parse(options.body).text); return Response.json({ id: 'x', url: '/a' }, { status: 201 }); };
  const queue = new VoiceQueue(() => {}, error => assert.fail(error), () => true);
  for (const text of ['Uno.', 'Due.', 'Tre.', 'Quattro.']) queue.enqueue(text);
  await new Promise(r => setTimeout(r, 60));
  assert.deepEqual(requests, ['Uno.', 'Due.', 'Tre. Quattro.']);
});
