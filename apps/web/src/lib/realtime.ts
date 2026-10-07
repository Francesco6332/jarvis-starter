import { api } from './api';
export type VoiceState = 'connecting' | 'listening' | 'thinking' | 'speaking' | 'ended';
type Callbacks = { state: (s: VoiceState) => void; transcript: (role: 'user' | 'assistant', text: string) => void; error: (message: string) => void; workspace: () => void; autoplay: () => void; endRequested?: () => void; caption?: (text: string) => void };
export function completedCalls(event: any): { call_id: string; name: string; arguments: string }[] {
  return event.type === 'response.done' && event.response?.status === 'completed'
    ? (event.response.output || []).filter((x: any) => x.type === 'function_call' && x.status === 'completed' && typeof x.call_id === 'string' && typeof x.name === 'string' && typeof x.arguments === 'string') : [];
}
// Closing phrases: either explicit anywhere, or a short goodbye that is the whole utterance.
const END_ANYWHERE = /\b(possiamo|posso)\s+(finire|chiudere)\s+(qui|la conversazione)\b|\b(fine|termina|chiudi|spegni)\s+(la\s+)?conversazione\b|\bbuonanotte\s+jarvis\b/i;
const END_ALONE = /^\s*(?:ok(?:ay)?[\s,]+)?(?:grazie[\s,]+)?(?:jarvis[\s,]+)?(?:è tutto|basta così|a dopo|ci sentiamo(?: dopo)?|puoi andare|chiudi|arrivederci|ciao ciao)(?:[\s,]+(?:grazie|jarvis))*[\s.!]*$/i;
export function isClosingPhrase(text: string) { return END_ANYWHERE.test(text) || END_ALONE.test(text); }
// Provider errors that only mean "nothing to cancel" and should not alarm the user.
const BENIGN = new Set(['response_cancel_not_active', 'conversation_already_has_active_response']);

export class RealtimeVoice {
  // Hang-up of the previous session: the backend allows one session, so a quick restart must wait for it.
  private static releasing: Promise<unknown> = Promise.resolve();
  private pc?: RTCPeerConnection;
  private channel?: RTCDataChannel;
  private stream?: MediaStream;
  private audio = new Audio();
  private context?: AudioContext;
  private input?: AnalyserNode;
  private output?: AnalyserNode;
  private samples = new Uint8Array(256);
  private id = '';
  private stopped = false;
  private timer?: ReturnType<typeof setInterval>;
  private deadline?: ReturnType<typeof setTimeout>;
  private connectionTimer?: ReturnType<typeof setTimeout>;
  private dropTimer?: ReturnType<typeof setTimeout>;
  private idleTimer?: ReturnType<typeof setTimeout>;
  private active = false;
  private userSpeaking = false;
  private pending = false;
  private jobs = 0;
  private caption = '';
  private seen = new Set<string>();
  private pagehide = () => this.stop();
  constructor(private callbacks: Callbacks) { this.audio.autoplay = true; }
  private send(event: unknown) { if (!this.stopped && this.channel?.readyState === 'open') this.channel.send(JSON.stringify(event)); }
  async start(options: { mode: 'assistant' | 'study'; studyContext: string; briefing: boolean; prompt?: string }) {
    const { prompt, ...session } = options;
    this.callbacks.state('connecting'); window.addEventListener('pagehide', this.pagehide);
    this.connectionTimer = setTimeout(() => this.fail('Connessione troppo lenta. Riprova.'), 40000);
    try {
      if (!navigator.mediaDevices?.getUserMedia || !window.RTCPeerConnection) throw new Error('Microfono WebRTC non disponibile. Usa un browser compatibile su localhost o HTTPS.');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      if (this.stopped) { stream.getTracks().forEach(t => t.stop()); return; }
      this.stream = stream;
      this.input = this.analyser(stream);
      const pc = this.pc = new RTCPeerConnection();
      pc.ontrack = event => { const remote = event.streams[0] || new MediaStream([event.track]); this.audio.srcObject = remote; this.output = this.analyser(remote); void this.play(); };
      pc.onconnectionstatechange = () => {
        if (this.stopped) return;
        clearTimeout(this.dropTimer);
        if (['failed', 'closed'].includes(pc.connectionState)) this.fail('Connessione vocale interrotta.');
        // "disconnected" is often a transient network blip: give ICE a few seconds to recover.
        else if (pc.connectionState === 'disconnected') this.dropTimer = setTimeout(() => this.fail('Connessione vocale interrotta.'), 5000);
      };
      stream.getTracks().forEach(t => pc.addTrack(t, stream));
      const channel = this.channel = pc.createDataChannel('oai-events');
      channel.onopen = () => {
        clearTimeout(this.connectionTimer); this.callbacks.state('listening');
        // A command spoken together with the wake word ("Jarvis, che tempo fa?") is answered directly.
        if (prompt?.trim()) {
          this.callbacks.transcript('user', prompt.trim());
          this.send({ type: 'conversation.item.create', item: { type: 'message', role: 'user', content: [{ type: 'input_text', text: prompt.trim() }] } });
        }
        this.send({ type: 'response.create' });
      };
      channel.onclose = () => { if (!this.stopped) this.fail('Canale vocale chiuso.'); };
      channel.onmessage = event => { try { void this.handle(JSON.parse(event.data)); } catch { this.fail('Evento vocale non valido.'); } };
      const offer = await pc.createOffer(); await pc.setLocalDescription(offer);
      await RealtimeVoice.releasing;
      if (this.stopped) return;
      const created = await api<{ id: string; sdp: string; expiresAt: number }>('/api/realtime/sessions', { method: 'POST', body: JSON.stringify({ ...session, sdp: pc.localDescription!.sdp }), signal: AbortSignal.timeout(30000) });
      this.id = created.id;
      if (this.stopped) { this.release(); return; }
      await pc.setRemoteDescription({ type: 'answer', sdp: created.sdp });
      this.deadline = setTimeout(() => this.fail('Sessione di 10 minuti terminata. Chiamami di nuovo quando vuoi.'), Math.max(0, created.expiresAt - Date.now()));
      this.timer = setInterval(() => { void api(`/api/realtime/sessions/${this.id}/heartbeat`, { method: 'POST', signal: AbortSignal.timeout(10000) }).catch(() => { if (!this.stopped) this.fail('Sessione scaduta o backend non raggiungibile.'); }); }, 15000);
    } catch (e) { if (!this.stopped) this.fail(e instanceof Error ? e.message : 'Microfono non disponibile.'); }
  }
  private analyser(stream: MediaStream) {
    const Context = (window as Window & { AudioContext?: typeof AudioContext }).AudioContext;
    if (!Context) return undefined;
    try {
      this.context ||= new Context();
      void this.context.resume().catch(() => {});
      const node = this.context.createAnalyser(); node.fftSize = 512; node.smoothingTimeConstant = .6;
      this.context.createMediaStreamSource(stream).connect(node);
      return node;
    } catch { return undefined; }
  }
  private rms(node?: AnalyserNode) {
    if (!node) return 0;
    node.getByteTimeDomainData(this.samples);
    let sum = 0;
    for (const value of this.samples) { const v = (value - 128) / 128; sum += v * v; }
    return Math.min(1, Math.sqrt(sum / this.samples.length) * 4);
  }
  /** Current loudness 0..1 of the user's microphone and of JARVIS's voice, for the visualisation. */
  levels() { return { input: this.rms(this.input), output: this.rms(this.output) }; }
  async play() { try { await this.audio.play(); } catch { if (!this.stopped) this.callbacks.autoplay(); } }
  mute(value: boolean) { this.stream?.getAudioTracks().forEach(t => { t.enabled = !value; }); if (value) { this.userSpeaking = false; this.send({ type: 'input_audio_buffer.clear' }); } }
  interrupt() { if (this.active) this.send({ type: 'response.cancel' }); this.send({ type: 'output_audio_buffer.clear' }); }
  private continue() { if (this.pending && !this.active && !this.userSpeaking && !this.jobs) { this.pending = false; this.send({ type: 'response.create' }); } }
  private async handle(event: any) {
    if (this.stopped) return;
    if (event.type === 'input_audio_buffer.speech_started') { clearTimeout(this.idleTimer); this.userSpeaking = true; this.callbacks.state('listening'); }
    if (event.type === 'input_audio_buffer.speech_stopped') {
      this.userSpeaking = false; this.callbacks.state('thinking');
      // Automatic VAD normally starts the next response; if noise produced no response, go back to listening.
      clearTimeout(this.idleTimer); this.idleTimer = setTimeout(() => { if (!this.active && !this.jobs && !this.stopped) this.callbacks.state('listening'); }, 8000);
    }
    if (event.type === 'response.created') { clearTimeout(this.idleTimer); this.active = true; this.pending = false; this.callbacks.state('thinking'); }
    if (event.type === 'output_audio_buffer.started') this.callbacks.state('speaking');
    if (['output_audio_buffer.stopped', 'output_audio_buffer.cleared'].includes(event.type)) this.callbacks.state('listening');
    if (event.type === 'conversation.item.input_audio_transcription.completed' && event.transcript) {
      this.callbacks.transcript('user', event.transcript);
      if (isClosingPhrase(event.transcript)) { this.interrupt(); this.callbacks.endRequested?.(); this.stop(); return; }
    }
    if (event.type === 'response.output_audio_transcript.delta' && typeof event.delta === 'string') { this.caption += event.delta; this.callbacks.caption?.(this.caption); }
    if (event.type === 'response.output_audio_transcript.done') {
      if (event.transcript) this.callbacks.transcript('assistant', event.transcript);
      this.caption = ''; this.callbacks.caption?.('');
    }
    if (event.type === 'error' && !BENIGN.has(event.error?.code)) { this.callbacks.error(event.error?.message || 'Errore della conversazione.'); }
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
  private release() {
    if (!this.id) return;
    RealtimeVoice.releasing = api(`/api/realtime/sessions/${this.id}`, { method: 'DELETE', keepalive: true, signal: AbortSignal.timeout(5000) }).catch(() => {});
    this.id = '';
  }
  stop() {
    if (this.stopped) return;
    this.stopped = true; clearInterval(this.timer); clearTimeout(this.deadline); clearTimeout(this.connectionTimer); clearTimeout(this.dropTimer); clearTimeout(this.idleTimer);
    window.removeEventListener('pagehide', this.pagehide);
    this.stream?.getTracks().forEach(t => t.stop()); this.channel?.close(); this.pc?.close(); this.audio.pause(); this.audio.srcObject = null;
    void this.context?.close().catch(() => {}); this.input = this.output = undefined;
    this.release(); this.callbacks.state('ended');
  }
}
