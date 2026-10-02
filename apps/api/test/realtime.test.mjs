import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createRealtime } from '../dist/realtime.js';
import { completedCalls, RealtimeVoice } from '../../web/src/lib/realtime.ts';

test('Realtime session: server credentials, scoped tools, deduplication, revocation and hangup', async t => {
  const previous = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'test-not-a-real-key';
  t.after(() => { if (previous === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = previous; });
  let allowed = true, executions = 0, hangups = 0, configuration;
  const work = {
    tools: async () => allowed ? [{ type: 'function', function: { name: 'create_study_task', description: 'test', parameters: { type: 'object' } } }] : [],
    briefing: async () => ({ agenda: { status: 'disconnected' } }),
    execute: async (_name, args) => { executions++; await new Promise(r => setTimeout(r, 15)); return args; },
  };
  const realtime = createRealtime(work, async () => [], async (url, options) => {
    assert.equal(options.headers.Authorization, 'Bearer test-not-a-real-key');
    if (url.endsWith('/hangup')) { hangups++; return new Response(null, { status: 200 }); }
    assert.equal(options.body.get('sdp'), 'test-sdp-offer');
    configuration = JSON.parse(options.body.get('session'));
    return new Response('test-sdp-answer', { headers: { location: '/v1/realtime/calls/rtc_test' } });
  });
  const app = express(); app.use(express.json()); app.use(realtime.router);
  const server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
  t.after(async () => { await realtime.close(); await new Promise(r => server.close(r)); });
  const url = `http://127.0.0.1:${server.address().port}`;
  const post = async (path, body) => fetch(url + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal((await post('/sessions', { sdp: 'tiny' })).status, 400);
  const response = await post('/sessions', { sdp: 'test-sdp-offer', mode: 'assistant' });
  assert.equal(response.status, 200);
  const session = await response.json();
  assert.equal(session.sdp, 'test-sdp-answer'); assert.ok(session.expiresAt > Date.now());
  assert.ok(!JSON.stringify(session).includes('test-not-a-real-key'));
  assert.equal(configuration.audio.input.turn_detection.interrupt_response, true);
  assert.equal(configuration.tools[0].name, 'create_study_task');
  assert.match(configuration.instructions, /disconnected/);
  assert.equal((await post('/sessions', { sdp: 'test-sdp-offer', mode: 'assistant' })).status, 409);
  const tool = { callId: 'call-1', name: 'create_study_task', arguments: '{"title":"Ripasso"}' };
  const replies = await Promise.all([post(`/sessions/${session.id}/tools`, tool), post(`/sessions/${session.id}/tools`, tool)]);
  assert.deepEqual(await replies[0].json(), await replies[1].json()); assert.equal(executions, 1);
  assert.equal((await post(`/sessions/${session.id}/tools`, { ...tool, arguments: '{}' })).status, 409);
  assert.equal((await post(`/sessions/${session.id}/tools`, { ...tool, callId: '2', name: 'confirm_event' })).status, 400);
  allowed = false;
  assert.equal((await post(`/sessions/${session.id}/tools`, { ...tool, callId: '3' })).status, 400); assert.equal(executions, 1);
  assert.equal((await post(`/sessions/${session.id}/heartbeat`, {})).status, 200);
  await fetch(`${url}/sessions/${session.id}`, { method: 'DELETE' }); assert.equal(hangups, 1);
  assert.equal((await post(`/sessions/${session.id}/heartbeat`, {})).status, 410);
  assert.equal((await post(`/sessions/${session.id}/tools`, tool)).status, 410);
  delete process.env.OPENAI_API_KEY;
  assert.equal((await post('/sessions', { sdp: 'test-sdp-offer', mode: 'assistant' })).status, 503);
});

test('cancelled and incomplete voice responses cannot dispatch tools', () => {
  const call = { type: 'function_call', status: 'completed', call_id: 'a', name: 'create_study_task', arguments: '{}' };
  assert.deepEqual(completedCalls({ type: 'response.done', response: { status: 'cancelled', output: [call] } }), []);
  assert.deepEqual(completedCalls({ type: 'response.done', response: { status: 'completed', output: [{ ...call, status: 'in_progress' }] } }), []);
  assert.equal(completedCalls({ type: 'response.done', response: { status: 'completed', output: [call] } }).length, 1);
});

test('closing while the microphone permission prompt is pending releases late tracks', async t => {
  const originals = new Map(['window', 'navigator', 'Audio'].map(k => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
  t.after(() => { for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; } });
  let resolveMedia, stopped = 0, removed = 0;
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { RTCPeerConnection: function(){}, addEventListener(){}, removeEventListener(){ removed++; } } });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: { getUserMedia: () => new Promise(r => { resolveMedia = r; }) } } });
  globalThis.Audio = class { pause() {} };
  const states = [];
  const voice = new RealtimeVoice({ state: s => states.push(s), error: assert.fail, transcript(){}, workspace(){}, autoplay(){} });
  const pending = voice.start({ mode: 'assistant', studyContext: '', briefing: true });
  voice.stop(); voice.stop();
  resolveMedia({ getTracks: () => [{ stop(){ stopped++; } }] });
  await pending;
  assert.equal(stopped, 1); assert.equal(removed, 1); assert.deepEqual(states, ['connecting', 'ended']);
});

test('WebRTC connects, returns tool output, mutes and closes all resources', async t => {
  const keys = ['window', 'navigator', 'Audio', 'RTCPeerConnection', 'fetch'];
  const originals = new Map(keys.map(k => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
  t.after(() => { for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; } });
  const sent = [], states = [], transcripts = []; let deleted = 0, trackStops = 0, peerClosed = 0, calls = 0;
  const track = { enabled: true, stop(){ trackStops++; } };
  const channel = { readyState: 'open', send(value){ sent.push(JSON.parse(value)); }, close(){ this.onclose?.(); } };
  class Peer {
    connectionState = 'connected';
    createDataChannel(){ return channel; }
    addTrack(){}
    async createOffer(){ return { type: 'offer', sdp: 'test-offer' }; }
    async setLocalDescription(offer){ this.localDescription = offer; }
    async setRemoteDescription(answer){ assert.equal(answer.sdp, 'test-answer'); channel.onopen(); }
    close(){ peerClosed++; this.connectionState = 'closed'; this.onconnectionstatechange(); }
  }
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { RTCPeerConnection: Peer, addEventListener(){}, removeEventListener(){} } });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [track], getAudioTracks: () => [track] }) } } });
  globalThis.RTCPeerConnection = Peer;
  globalThis.Audio = class { pause(){} async play(){} };
  globalThis.fetch = async (path, options) => {
    if (options.method === 'DELETE') { deleted++; return Response.json({ ok: true }); }
    if (path.endsWith('/tools')) { calls++; return Response.json({ result: { task: { title: 'Ripasso' } } }); }
    return Response.json({ id: 'session-test', sdp: 'test-answer', expiresAt: Date.now() + 60000 });
  };
  const voice = new RealtimeVoice({ state: s => states.push(s), error: assert.fail, transcript: (...args) => transcripts.push(args), workspace(){}, autoplay: assert.fail });
  await voice.start({ mode: 'assistant', studyContext: '', briefing: true });
  assert.deepEqual(states, ['connecting', 'listening']); assert.equal(sent[0].type, 'response.create');
  voice.mute(true); assert.equal(track.enabled, false); voice.mute(false); assert.equal(track.enabled, true);
  channel.onmessage({ data: JSON.stringify({ type: 'response.created' }) }); voice.interrupt(); assert.ok(sent.some(e => e.type === 'response.cancel'));
  channel.onmessage({ data: JSON.stringify({ type: 'conversation.item.input_audio_transcription.completed', transcript: 'Ciao' }) }); assert.deepEqual(transcripts, [['user', 'Ciao']]);
  const event = { type: 'response.done', response: { status: 'completed', output: [{ type: 'function_call', status: 'completed', call_id: 'one', name: 'create_study_task', arguments: '{}' }] } };
  channel.onmessage({ data: JSON.stringify(event) });
  await new Promise(resolve => setImmediate(resolve));
  channel.onmessage({ data: JSON.stringify(event) });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 1); assert.ok(sent.some(e => e.item?.type === 'function_call_output'));
  voice.stop(); voice.stop(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(trackStops, 1); assert.equal(peerClosed, 1); assert.equal(deleted, 1); assert.equal(states.at(-1), 'ended');
});
