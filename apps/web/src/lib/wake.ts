// Always-on "Jarvis" wake word built on the Web Speech API (Chrome/Edge).
// Restarts itself when the browser ends the recognition session and only gives up on permission errors.
interface Alternative { transcript: string }
interface Result { isFinal: boolean; 0: Alternative; length: number }
interface RecognitionEvent { resultIndex: number; results: ArrayLike<Result> }
interface RecognitionError { error: string }
export interface Recognition {
  lang: string; continuous: boolean; interimResults: boolean; maxAlternatives: number;
  onresult: ((event: RecognitionEvent) => void) | null; onerror: ((event: RecognitionError) => void) | null;
  onstart: (() => void) | null; onend: (() => void) | null;
  start: () => void; stop: () => void; abort: () => void;
}
type RecognitionWindow = Window & { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
export function recognitionClass() { const w = window as RecognitionWindow; return w.SpeechRecognition || w.webkitSpeechRecognition; }

// Italian speech-to-text often spells the name in different ways.
const WAKE = /(?:^|[\s,.!?])(?:(?:ehi|ehy|hey|ei|ciao|ok|okay|buongiorno|buonasera|salve)[\s,]+)?(?:jarvis|jarvi|jarviss|giarvis|giarvi|giarviss|jervis|jarves|jarvys|djarvis|garvis|charvis)(?=$|[\s,.!?])/i;
export function matchWake(text: string): { rest: string } | null {
  const match = WAKE.exec(text);
  if (!match) return null;
  return { rest: text.slice(match.index + match[0].length).replace(/^[\s,.!?]+/, '').trim() };
}

export type WakeStatus = 'off' | 'listening' | 'paused';
const FATAL: Record<string, string> = {
  'not-allowed': 'Permesso microfono negato: autorizzalo dal lucchetto nella barra degli indirizzi.',
  'service-not-allowed': 'Il browser ha bloccato il riconoscimento vocale. Usa Chrome o Edge.',
  'audio-capture': 'Nessun microfono disponibile.',
  'language-not-supported': 'Riconoscimento vocale italiano non disponibile in questo browser.',
};

export class WakeWord {
  private rec: Recognition | null = null;
  private wanted = false;
  private paused = false;
  private fired = false;
  private failures = 0;
  private restartTimer?: ReturnType<typeof setTimeout>;
  private interimTimer?: ReturnType<typeof setTimeout>;
  private interimIndex = -1;
  constructor(private onWake: (rest: string) => void, private onStatus: (status: WakeStatus) => void, private onError: (message: string) => void) {}
  static supported() { return typeof window !== 'undefined' && Boolean(recognitionClass()); }
  get enabled() { return this.wanted; }
  start() {
    if (!WakeWord.supported()) { this.onError('Attivazione vocale non supportata. Usa Chrome o Edge su desktop.'); return false; }
    this.wanted = true; this.paused = false; this.failures = 0; this.launch();
    return true;
  }
  stop() { this.wanted = false; this.halt(); this.onStatus('off'); }
  /** Release the microphone temporarily (conversation, dictation, JARVIS speaking). */
  pause() { if (!this.wanted || this.paused) return; this.paused = true; this.halt(); this.onStatus('paused'); }
  resume() { if (!this.wanted || !this.paused) return; this.paused = false; this.schedule(250); }
  private halt() {
    clearTimeout(this.restartTimer); clearTimeout(this.interimTimer);
    const rec = this.rec; this.rec = null;
    if (rec) { rec.onstart = null; rec.onend = null; rec.onresult = null; rec.onerror = null; try { rec.abort(); } catch { /* already stopped */ } }
  }
  private schedule(delay: number) {
    clearTimeout(this.restartTimer);
    this.restartTimer = setTimeout(() => this.launch(), delay);
  }
  private launch() {
    if (!this.wanted || this.paused || this.rec) return;
    const Ctor = recognitionClass(); if (!Ctor) return;
    const rec = new Ctor(); this.rec = rec; this.fired = false; this.interimIndex = -1;
    rec.lang = 'it-IT'; rec.continuous = true; rec.interimResults = true; rec.maxAlternatives = 1;
    rec.onstart = () => this.onStatus('listening');
    rec.onresult = event => {
      if (this.fired) return;
      this.failures = 0;
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i], heard = result?.[0]?.transcript || '';
        const match = matchWake(heard);
        if (!match) {
          // The recogniser revised an interim "Jarvis" into something else: forget it.
          if (result.isFinal && i === this.interimIndex) clearTimeout(this.interimTimer);
          continue;
        }
        clearTimeout(this.interimTimer);
        // A final result triggers at once; an interim one waits for a short pause so the command is complete.
        if (result.isFinal) { this.trigger(match.rest); return; }
        this.interimIndex = i;
        this.interimTimer = setTimeout(() => this.trigger(match.rest), 900);
      }
    };
    rec.onerror = event => {
      const fatal = FATAL[event.error];
      if (fatal) { this.wanted = false; this.halt(); this.onStatus('off'); this.onError(fatal); return; }
      if (event.error === 'network') this.failures++;
    };
    rec.onend = () => {
      if (this.rec !== rec) return;
      this.rec = null;
      if (!this.wanted || this.paused) return;
      // Chrome ends continuous sessions after silence: restart, backing off on repeated failures.
      this.schedule(Math.min(300 * 2 ** this.failures, 8000));
    };
    try { rec.start(); }
    catch { this.rec = null; this.failures++; this.schedule(Math.min(500 * 2 ** this.failures, 8000)); }
  }
  private trigger(rest: string) {
    if (this.fired || !this.wanted || this.paused) return;
    this.fired = true; this.failures = 0;
    this.pause();
    this.onWake(rest);
  }
}
