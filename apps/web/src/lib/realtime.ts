import { api } from './api';
export type VoiceState = 'connecting' | 'listening' | 'thinking' | 'speaking' | 'ended';
type Callbacks = { state: (s: VoiceState) => void; transcript: (role: 'user' | 'assistant', text: string) => void; error: (message: string) => void; workspace: () => void; autoplay: () => void };
export function completedCalls(event: any): { call_id: string; name: string; arguments: string }[] {
  return event.type === 'response.done' && event.response?.status === 'completed'
    ? (event.response.output || []).filter((x: any) => x.type === 'function_call' && x.status === 'completed' && typeof x.call_id === 'string' && typeof x.name === 'string' && typeof x.arguments === 'string') : [];
}
export class RealtimeVoice {
  private pc?: RTCPeerConnection;
  private channel?: RTCDataChannel;
  private stream?: MediaStream;
  private audio = new Audio();
  private id = '';
  private stopped = false;
  private timer?: ReturnType<typeof setInterval>;
  private deadline?: ReturnType<typeof setTimeout>;
  private connectionTimer?: ReturnType<typeof setTimeout>;
  private active = false;
  private userSpeaking = false;
  private pending = false;
  private jobs = 0;
  private seen = new Set<string>();
  private pagehide = () => this.stop();
  constructor(private callbacks: Callbacks) { this.audio.autoplay = true; }
  private send(event: unknown) { if (!this.stopped && this.channel?.readyState === 'open') this.channel.send(JSON.stringify(event)); }
  async start(options: { mode: 'assistant' | 'study'; studyContext: string; briefing: boolean }) {
    this.callbacks.state('connecting'); window.addEventListener('pagehide', this.pagehide);
    this.connectionTimer = setTimeout(() => this.fail('Connessione troppo lenta. Riprova.'), 40000);
    try {
      if (!navigator.mediaDevices?.getUserMedia || !window.RTCPeerConnection) throw new Error('Microfono WebRTC non disponibile. Usa un browser compatibile su localhost o HTTPS.');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      if (this.stopped) { stream.getTracks().forEach(t => t.stop()); return; }
      this.stream = stream;
      const pc = this.pc = new RTCPeerConnection();
      pc.ontrack = event => { this.audio.srcObject = event.streams[0] || new MediaStream([event.track]); void this.play(); };
      pc.onconnectionstatechange = () => { if (['failed', 'disconnected', 'closed'].includes(pc.connectionState) && !this.stopped) this.fail('Connessione vocale interrotta.'); };
      stream.getTracks().forEach(t => pc.addTrack(t, stream));
      const channel = this.channel = pc.createDataChannel('oai-events');
      channel.onopen = () => { clearTimeout(this.connectionTimer); this.callbacks.state('listening'); this.send({ type: 'response.create' }); };
      channel.onclose = () => { if (!this.stopped) this.fail('Canale vocale chiuso.'); };
      channel.onmessage = event => { try { void this.handle(JSON.parse(event.data)); } catch { this.fail('Evento vocale non valido.'); } };
      const offer = await pc.createOffer(); await pc.setLocalDescription(offer);
      const session = await api<{ id: string; sdp: string; expiresAt: number }>('/api/realtime/sessions', { method: 'POST', body: JSON.stringify({ ...options, sdp: pc.localDescription!.sdp }), signal: AbortSignal.timeout(30000) });
      this.id = session.id;
      if (this.stopped) { this.release(); return; }
      await pc.setRemoteDescription({ type: 'answer', sdp: session.sdp });
      this.deadline = setTimeout(() => this.fail('Sessione di 10 minuti terminata. Puoi avviarne un’altra.'), Math.max(0, session.expiresAt - Date.now()));
      this.timer = setInterval(() => { void api(`/api/realtime/sessions/${this.id}/heartbeat`, { method: 'POST', signal: AbortSignal.timeout(10000) }).catch(() => { if (!this.stopped) this.fail('Sessione scaduta o backend non raggiungibile.'); }); }, 15000);
    } catch (e) { if (!this.stopped) this.fail(e instanceof Error ? e.message : 'Microfono non disponibile.'); }
  }
  async play() { try { await this.audio.play(); } catch { if (!this.stopped) this.callbacks.autoplay(); } }
  mute(value: boolean) { this.stream?.getAudioTracks().forEach(t => { t.enabled = !value; }); if (value) { this.userSpeaking = false; this.send({ type: 'input_audio_buffer.clear' }); } }
  interrupt() { if (this.active) this.send({ type: 'response.cancel' }); this.send({ type: 'output_audio_buffer.clear' }); }
  private continue() { if (this.pending && !this.active && !this.userSpeaking && !this.jobs) { this.pending = false; this.send({ type: 'response.create' }); } }
  private async handle(event: any) {
    if (this.stopped) return;
    if (event.type === 'input_audio_buffer.speech_started') { this.userSpeaking = true; this.callbacks.state('listening'); }
    if (event.type === 'input_audio_buffer.speech_stopped') { this.userSpeaking = false; this.callbacks.state('thinking'); /* automatic VAD starts the next response */ }
    if (event.type === 'response.created') { this.active = true; this.pending = false; this.callbacks.state('thinking'); }
    if (event.type === 'output_audio_buffer.started') this.callbacks.state('speaking');
    if (['output_audio_buffer.stopped', 'output_audio_buffer.cleared'].includes(event.type)) this.callbacks.state('listening');
    if (event.type === 'conversation.item.input_audio_transcription.completed' && event.transcript) this.callbacks.transcript('user', event.transcript);
    if (event.type === 'response.output_audio_transcript.done' && event.transcript) this.callbacks.transcript('assistant', event.transcript);
    if (event.type === 'error') { this.callbacks.error(event.error?.message || 'Errore della conversazione.'); }
    if (event.type !== 'response.done') return;
    this.active = false;
    if (event.response?.status === 'failed') { this.fail('Risposta vocale non riuscita. Verifica credito e connessione.'); return; }
    const calls = completedCalls(event).filter(c => !this.seen.has(c.call_id));
    this.jobs += calls.length;
    await Promise.all(calls.map(async call => {
      this.seen.add(call.call_id);
      let result: unknown;
      try { result = (await api<{ result: unknown }>(`/api/realtime/sessions/${this.id}/tools`, { method: 'POST', body: JSON.stringify({ callId: call.call_id, name: call.name, arguments: call.arguments }), signal: AbortSignal.timeout(25000) })).result; }
      catch (e) { result = { error: e instanceof Error ? e.message : 'Azione non riuscita.' }; }
      if (!this.stopped) { this.send({ type: 'conversation.item.create', item: { type: 'function_call_output', call_id: call.call_id, output: JSON.stringify(result) } }); this.callbacks.workspace(); this.pending = true; }
      this.jobs--;
    }));
    this.continue();
  }
  private fail(message: string) { this.callbacks.error(message); this.stop(); }
  private release() { if (this.id) { void api(`/api/realtime/sessions/${this.id}`, { method: 'DELETE', keepalive: true }).catch(() => {}); this.id = ''; } }
  stop() {
    if (this.stopped) return;
    this.stopped = true; clearInterval(this.timer); clearTimeout(this.deadline); clearTimeout(this.connectionTimer);
    window.removeEventListener('pagehide', this.pagehide);
    this.stream?.getTracks().forEach(t => t.stop()); this.channel?.close(); this.pc?.close(); this.audio.pause(); this.audio.srcObject = null;
    this.release(); this.callbacks.state('ended');
  }
}
