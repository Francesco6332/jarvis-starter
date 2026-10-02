import { apiFetch } from './api';

export function takeSpeechChunks(text: string, flush = false): { chunks: string[]; rest: string } {
  const chunks: string[] = [];
  while (text.trim()) {
    const match = (flush ? /[.!?](?=\s|$)|\n/ : /[.!?](?=\s)|\n/).exec(text);
    let end = match ? match.index + 1 : -1;
    if (end > 260 || (end < 0 && text.length > 260)) {
      const space = text.lastIndexOf(' ', 260); end = space > 40 ? space : 260;
    }
    if (end < 0) { if (!flush) break; end = text.length; }
    const chunk = text.slice(0, end).replace(/[*#`]/g, '').trim();
    if (chunk) chunks.push(chunk);
    text = text.slice(end).trimStart();
  }
  return { chunks, rest: text };
}

type AudioResult = { blob: Blob } | { error: Error };
type Item = { text: string; result?: Promise<AudioResult> };
export class VoiceQueue {
  private queue: Item[] = [];
  private active = false;
  private generation = 0;
  private controller = new AbortController();
  private audio: HTMLAudioElement | null = null;
  private finishPlayback: (() => void) | null = null;
  constructor(private onActive: (active: boolean) => void, private onError: (error: string) => void, private aiAvailable: () => boolean) {}
  stop() {
    this.generation++; this.controller.abort(); this.controller = new AbortController();
    this.queue = []; this.audio?.pause(); this.finishPlayback?.(); this.audio = null;
    window.speechSynthesis?.cancel(); this.active = false; this.onActive(false);
  }
  enqueue(text: string) {
    if (!text.trim()) return;
    this.queue.push({ text }); this.prefetch();
    if (!this.active) void this.play();
  }
  private prefetch() {
    if (!this.aiAvailable()) return;
    for (const item of this.queue.slice(0, 2)) {
      if (item.result) continue;
      item.result = apiFetch('/api/speech', { method: 'POST', body: JSON.stringify({ text: item.text }), signal: this.controller.signal })
        .then(async response => { if (!response.ok) throw new Error('Voce AI non disponibile: uso la voce del dispositivo.'); return { blob: await response.blob() }; })
        .catch((error: Error) => ({ error }));
    }
  }
  private async play() {
    this.active = true; this.onActive(true);
    const generation = this.generation;
    try {
      while (this.queue.length && generation === this.generation) {
        this.prefetch(); const item = this.queue[0];
        const result = item.result ? await item.result : null;
        if (generation !== this.generation) return;
        if (result && 'blob' in result) {
          const url = URL.createObjectURL(result.blob);
          try {
            await new Promise<void>((resolve, reject) => {
              const audio = new Audio(url); this.audio = audio;
              this.finishPlayback = resolve; audio.onended = () => resolve(); audio.onerror = () => reject(new Error('Riproduzione audio non riuscita.'));
              audio.play().catch(reject);
            });
          } finally { URL.revokeObjectURL(url); }
        } else {
          if (result && 'error' in result) this.onError(result.error.message);
          await this.fallback(item.text);
        }
        if (generation !== this.generation) return;
        this.queue.shift(); this.prefetch();
      }
    } catch (error) {
      if (generation === this.generation) { this.queue = []; this.onError(error instanceof Error ? error.message : 'Errore audio.'); }
    } finally {
      if (generation === this.generation) { this.active = false; this.audio = null; this.finishPlayback = null; this.onActive(false); }
    }
  }
  private fallback(text: string): Promise<void> {
    if (!('speechSynthesis' in window)) return Promise.resolve();
    return new Promise(resolve => {
      const speech = new SpeechSynthesisUtterance(text); speech.lang = 'it-IT'; speech.rate = 1.02;
      const voices = window.speechSynthesis.getVoices();
      speech.voice = voices.find(v => v.lang.startsWith('it') && /luca|diego|giorgio/i.test(v.name)) || voices.find(v => v.lang.startsWith('it')) || null;
      this.finishPlayback = resolve; speech.onend = () => resolve(); speech.onerror = () => resolve(); window.speechSynthesis.speak(speech);
    });
  }
}
