import test from 'node:test';
import assert from 'node:assert/strict';
import { matchWake, WakeWord } from '../../web/src/lib/wake.ts';
import { isClosingPhrase, RealtimeVoice } from '../../web/src/lib/realtime.ts';

test('wake word recognises Italian transcriptions and keeps the command', () => {
  assert.deepEqual(matchWake('Jarvis'), { rest: '' });
  assert.deepEqual(matchWake('ehi Giarvis, che tempo fa domani?'), { rest: 'che tempo fa domani?' });
  assert.deepEqual(matchWake('ok jervis apri il calendario'), { rest: 'apri il calendario' });
  assert.equal(matchWake('ho visto Jarvisland ieri'), null);
  assert.equal(matchWake('buongiorno a tutti'), null);
});

test('closing phrases end the session without catching normal sentences', () => {
  for (const text of ['Possiamo finire qui.', 'basta così, grazie', 'Ok grazie Jarvis, è tutto', 'Buonanotte Jarvis', 'A dopo!']) assert.ok(isClosingPhrase(text), text);
  for (const text of ['È tutto chiaro, andiamo avanti', 'Basta così poco per cambiare?', 'Spiegami lo stop and wait']) assert.ok(!isClosingPhrase(text), text);
});

function fakeRecognition() {
  const instances = [];
  class Rec {
    constructor() { instances.push(this); this.started = 0; this.aborted = 0; }
    start() { this.started++; this.onstart?.(); }
    stop() { this.onend?.(); }
    abort() { this.aborted++; }
    emit(transcript, isFinal = true) { this.onresult?.({ resultIndex: 0, results: [Object.assign([{ transcript }], { isFinal })] }); }
  }
  return { Rec, instances };
}
function withWindow(t, value) {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value });
  t.after(() => { if (original) Object.defineProperty(globalThis, 'window', original); else delete globalThis.window; });
}
const tick = ms => new Promise(r => setTimeout(r, ms));

test('wake word restarts after silence, triggers once and pauses the microphone', async t => {
  const { Rec, instances } = fakeRecognition();
  withWindow(t, { webkitSpeechRecognition: Rec });
  const woken = [], statuses = [], errors = [];
  const wake = new WakeWord(rest => woken.push(rest), s => statuses.push(s), e => errors.push(e));
  assert.equal(wake.start(), true);
  assert.equal(instances.length, 1); assert.equal(instances[0].lang, 'it-IT');
  instances[0].onerror({ error: 'no-speech' }); instances[0].stop();
  await tick(350);
  assert.equal(instances.length, 2, 'Chrome ending the session must not disable the wake word');
  assert.deepEqual(errors, []);
  instances[1].emit('Jarvis, quali impegni ho oggi'); instances[1].emit('Jarvis di nuovo');
  assert.deepEqual(woken, ['quali impegni ho oggi']);
  assert.equal(statuses.at(-1), 'paused'); assert.equal(instances[1].aborted, 1);
  wake.resume(); await tick(300);
  assert.equal(instances.length, 3); assert.equal(statuses.at(-1), 'listening');
  wake.stop(); assert.equal(statuses.at(-1), 'off'); assert.equal(wake.enabled, false);
});

test('wake word waits for the end of an interim command and stops on denied permission', async t => {
  const { Rec, instances } = fakeRecognition();
  withWindow(t, { SpeechRecognition: Rec });
  const woken = [], errors = [];
  const wake = new WakeWord(rest => woken.push(rest), () => {}, e => errors.push(e));
  wake.start();
  instances[0].emit('Jarvis che', false); instances[0].emit('Jarvis che ore sono', false);
  await tick(950);
  assert.deepEqual(woken, ['che ore sono']);
  wake.resume(); await tick(300);
  instances.at(-1).onerror({ error: 'not-allowed' });
  assert.equal(wake.enabled, false); assert.match(errors[0], /Permesso microfono negato/);
  const count = instances.length; await tick(400); assert.equal(instances.length, count);
});

test('a command spoken with the wake word is sent before the first response', async t => {
  const keys = ['window', 'navigator', 'Audio', 'fetch'];
  const originals = new Map(keys.map(k => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
  t.after(() => { for (const [key, d] of originals) { if (d) Object.defineProperty(globalThis, key, d); else delete globalThis[key]; } });
  const sent = [], transcripts = [], order = [];
  const channel = { readyState: 'open', send(v) { sent.push(JSON.parse(v)); }, close() {} };
  class Peer { createDataChannel() { return channel; } addTrack() {} async createOffer() { return { sdp: 'offer' }; } async setLocalDescription(o) { this.localDescription = o; } async setRemoteDescription() { channel.onopen(); } close() {} }
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { RTCPeerConnection: Peer, addEventListener() {}, removeEventListener() {} } });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ stop() {} }], getAudioTracks: () => [] }) } } });
  globalThis.Audio = class { pause() {} async play() {} };
  let release;
  globalThis.fetch = async (path, options) => {
    order.push(options.method);
    if (options.method === 'DELETE') { await new Promise(r => { release = r; }); return Response.json({ ok: true }); }
    return Response.json({ id: `s${order.length}`, sdp: 'answer', expiresAt: Date.now() + 60000 });
  };
  globalThis.RTCPeerConnection = Peer;
  const callbacks = { state() {}, error: assert.fail, transcript: (...a) => transcripts.push(a), workspace() {}, autoplay() {} };
  const first = new RealtimeVoice(callbacks);
  await first.start({ mode: 'assistant', studyContext: '', briefing: false, prompt: 'che tempo fa?' });
  assert.equal(sent[0].type, 'conversation.item.create'); assert.equal(sent[0].item.content[0].text, 'che tempo fa?');
  assert.equal(sent[1].type, 'response.create'); assert.deepEqual(transcripts, [['user', 'che tempo fa?']]);
  first.stop();
  // A new session must wait for the previous hang-up, otherwise the backend answers 409.
  const second = new RealtimeVoice(callbacks);
  const pending = second.start({ mode: 'assistant', studyContext: '', briefing: false });
  await tick(20);
  assert.deepEqual(order, ['POST', 'DELETE']);
  release(); await pending;
  assert.deepEqual(order, ['POST', 'DELETE', 'POST']);
  second.stop();
});

test('an interim "Jarvis" revised by the final transcript does not trigger', async t => {
  const { Rec, instances } = fakeRecognition();
  withWindow(t, { webkitSpeechRecognition: Rec });
  const woken = [];
  const wake = new WakeWord(rest => woken.push(rest), () => {}, assert.fail);
  wake.start();
  instances[0].emit('Jarvis', false); instances[0].emit('Davis ha chiamato', true);
  await tick(950);
  assert.deepEqual(woken, []);
  assert.ok(!isClosingPhrase('basta') && !isClosingPhrase('stop'), 'a bare "basta" interrupts, it does not hang up');
  wake.stop();
});
