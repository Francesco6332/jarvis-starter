import { apiFetch } from './api';

/** Turn chat markdown into something worth saying aloud: no URLs, list markers, symbols or emoji. */
export function speakable(text: string) {
  return text
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/^\s*(?:[-*•]|\d{1,2}[.)])\s+/gm, '')
    .replace(/[*#`_>|~]/g, '')
    .replace(/\p{Extended_Pictographic}/gu, '')
    .replace(/\s+/g, ' ').trim();
}

export function takeSpeechChunks(text: string, flush = false): { chunks: string[]; rest: string } {
  const chunks: string[] = [];
  // A full stop after a short number is a list marker ("1. "), not the end of a sentence.
  const end = flush ? /(?<!(?:^|\s)\d{1,2})[.!?](?=\s|$)|\n/ : /(?<!(?:^|\s)\d{1,2})[.!?](?=\s)|\n/;
  while (text.trim()) {
    const match = end.exec(text);
    let stop = match ? match.index + 1 : -1;
    if (stop > 260 || (stop < 0 && text.length > 260)) {
      const space = text.lastIndexOf(' ', 260); stop = space > 40 ? space : 260;
    }
    if (stop < 0) { if (!flush) break; stop = text.length; }
    const chunk = speakable(text.slice(0, stop));
    if (chunk) chunks.push(chunk);
    text = text.slice(stop).trimStart();
  }
  return { chunks, rest: text };
}

type Item = { text: string; audio?: Promise<HTMLAudioElement | null>; id?: string };
const MERGE_LIMIT = 420;
export class VoiceQueue {
  private queue: Item[] = [];
  private active = false;
  private generation = 0;
  private controller = new AbortController();
  private audio: HTMLAudioElement | null = null;
  private finishPlayback: (() => void) | null = null;
  private reported = false;
  constructor(private onActive: (active: boolean) => void, private onError: (error: string) => void, private aiAvailable: () => boolean) {
    // Chrome loads the device voices lazily: ask early so the fallback has an Italian voice ready.
    try { window.speechSynthesis?.getVoices?.(); } catch { /* no speech synthesis */ }
  }
  stop() {
    this.generation++; this.controller.abort(); this.controller = new AbortController();
    for (const item of this.queue) this.discard(item);
    this.queue = []; this.audio?.pause(); this.finishPlayback?.(); this.audio = null; this.reported = false;
    window.speechSynthesis?.cancel(); this.active = false; this.onActive(false);
  }
  enqueue(text: string) {
    if (!text.trim()) return;
    // Phrases that are not being generated yet are joined: fewer requests and a more natural intonation.
    // The head of the queue may already be playing, so it is never extended.
    const last = this.queue.length > 1 ? this.queue.at(-1) : undefined;
    if (last && !last.audio && last.text.length + text.length < MERGE_LIMIT) last.text += ' ' + text;
    else this.queue.push({ text });
    this.prefetch();
    if (!this.active) void this.play();
  }
  private report(message: string) { if (!this.reported) { this.reported = true; this.onError(message); } }
  private discard(item: Item) {
    void item.audio?.then(audio => { audio?.pause(); audio?.removeAttribute?.('src'); audio?.load?.(); });
    if (item.id) void apiFetch(`/api/speech/${item.id}`, { method: 'DELETE', keepalive: true }).catch(() => {});
  }
  private prefetch() {
    if (!this.aiAvailable()) return;
    const signal = this.controller.signal;
    for (const item of this.queue.slice(0, 2)) {
      if (item.audio) continue;
      // Generation starts now; the <audio> element then streams it and can start before the file is complete.
      item.audio = apiFetch('/api/speech', { method: 'POST', body: JSON.stringify({ text: item.text }), signal })
        .then(async response => {
          if (!response.ok) throw new Error('Voce AI non disponibile: uso la voce del dispositivo.');
          const { id, url } = await response.json() as { id: string; url: string };
          item.id = id;
          if (signal.aborted) { this.discard(item); return null; }
          const audio = new Audio(url); audio.preload = 'auto';
          return audio;
        })
        .catch((error: Error) => { if (!signal.aborted) this.report(error.message); return null; });
    }
  }
  private async play() {
    this.active = true; this.onActive(true);
    const generation = this.generation;
    try {
      while (this.queue.length && generation === this.generation) {
        this.prefetch(); const item = this.queue[0];
        const audio = item.audio ? await item.audio : null;
        if (generation !== this.generation) return;
        if (audio) {
          try { await this.playAudio(audio); }
          catch (error) {
            if (generation !== this.generation) return;
            if (error instanceof DOMException && error.name === 'NotAllowedError') throw new Error('Il browser ha bloccato l’audio: clicca un punto della pagina e riprova.');
            this.report('Riproduzione della voce AI non riuscita: uso la voce del dispositivo.');
            await this.fallback(item.text);
          }
        } else await this.fallback(item.text);
        if (generation !== this.generation) return;
        this.queue.shift(); this.prefetch();
      }
    } catch (error) {
      if (generation === this.generation) { for (const item of this.queue) this.discard(item); this.queue = []; this.onError(error instanceof Error ? error.message : 'Errore audio.'); }
    } finally {
      if (generation === this.generation) { this.active = false; this.audio = null; this.finishPlayback = null; this.reported = false; this.onActive(false); }
    }
  }
  private playAudio(audio: HTMLAudioElement) {
    this.audio = audio;
    return new Promise<void>((resolve, reject) => {
      this.finishPlayback = resolve;
      audio.onended = () => resolve();
      audio.onerror = () => reject(new Error('Riproduzione audio non riuscita.'));
      audio.play().catch(reject);
    });
  }
  private fallback(text: string): Promise<void> {
    if (!('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined') return Promise.resolve();
    return new Promise(resolve => {
      const speech = new SpeechSynthesisUtterance(text); speech.lang = 'it-IT'; speech.rate = 1.02;
      const voices = window.speechSynthesis.getVoices();
      speech.voice = voices.find(v => v.lang.startsWith('it') && /luca|diego|giorgio|cosimo/i.test(v.name)) || voices.find(v => v.lang.startsWith('it')) || null;
      this.finishPlayback = resolve; speech.onend = () => resolve(); speech.onerror = () => resolve(); window.speechSynthesis.speak(speech);
    });
  }
}
