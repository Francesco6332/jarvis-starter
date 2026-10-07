import { useCallback, useEffect, useRef, useState } from 'react';
import { Mic, MicOff, PhoneOff, RotateCcw, Square, X } from 'lucide-react';
import { NeuralCore, type CoreMode } from './NeuralCore';
import { RealtimeVoice, type VoiceState } from '../lib/realtime';
type Props = { mode: 'assistant' | 'study'; studyContext: string; briefing: boolean; prompt: string; onClose: () => void; onWorkspace: () => void; onTranscript: (role: 'user' | 'assistant', text: string) => void };
const CORE: Record<VoiceState, CoreMode> = { connecting: 'thinking', listening: 'listening', thinking: 'thinking', speaking: 'speaking', ended: 'idle' };

/** Full-screen voice session: starts as soon as it opens (button or "Jarvis") and closes itself on a goodbye. */
export function Conversation({ mode, studyContext, briefing, prompt, onClose, onWorkspace, onTranscript }: Props) {
  const dialog = useRef<HTMLDialogElement>(null), session = useRef<RealtimeVoice | null>(null);
  const [state, setState] = useState<VoiceState>('connecting'), [muted, setMuted] = useState(false), [error, setError] = useState(''), [blocked, setBlocked] = useState(false);
  const [caption, setCaption] = useState(''), [farewell, setFarewell] = useState(false), [attempt, setAttempt] = useState(0);
  const [transcript, setTranscript] = useState<{ role: 'user' | 'assistant'; text: string }[]>([]);
  const callbacks = useRef({ onWorkspace, onTranscript, onClose }); callbacks.current = { onWorkspace, onTranscript, onClose };
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    if (!dialog.current?.open) dialog.current?.showModal();
    return () => previous?.focus();
  }, []);
  useEffect(() => {
    let closeTimer: ReturnType<typeof setTimeout> | undefined;
    setError(''); setMuted(false); setBlocked(false); setCaption(''); setFarewell(false);
    const voice = new RealtimeVoice({
      state: setState, error: setError, autoplay: () => setBlocked(true), caption: setCaption,
      workspace: () => callbacks.current.onWorkspace(),
      endRequested: () => { setFarewell(true); closeTimer = setTimeout(() => callbacks.current.onClose(), 1500); },
      transcript: (role, text) => { setTranscript(old => [...old, { role, text }].slice(-4)); callbacks.current.onTranscript(role, text); },
    });
    session.current = voice;
    // The command spoken with the wake word belongs to the first attempt only.
    void voice.start({ mode, studyContext, briefing: briefing && !prompt, prompt: attempt === 0 ? prompt : '' });
    return () => { clearTimeout(closeTimer); voice.stop(); };
    // Mode, notes and briefing are fixed for the lifetime of a session.
  }, [attempt]);
  const level = useCallback(() => { const l = session.current?.levels(); return l ? Math.max(l.output, l.input * .7) : 0; }, []);
  const ended = state === 'ended';
  const label = farewell ? 'A presto, Francesco.' : { connecting: 'Mi collego…', listening: muted ? 'Microfono disattivato' : 'Ti ascolto', thinking: 'Sto pensando…', speaking: 'Sto parlando', ended: 'Conversazione terminata' }[state];
  const last = transcript.at(-1);
  return <dialog ref={dialog} className={`conversation is-${farewell ? 'farewell' : state}`} onCancel={e => { e.preventDefault(); onClose(); }} aria-labelledby="voice-title">
    <div className="hud-top"><span><i className="hud-dot"/> J.A.R.V.I.S. · VOICE LINK</span><button className="hud-close" onClick={onClose} aria-label="Chiudi conversazione"><X size={20}/></button></div>
    <h2 id="voice-title" className="sr-only">Conversazione vocale con JARVIS</h2>
    <div className="hud-core">
      <div className="hud-ring ring-a"/><div className="hud-ring ring-b"/><div className="hud-ring ring-c"/>
      <NeuralCore mode={farewell ? 'idle' : CORE[state]} level={level}/>
    </div>
    <p className="conversation-state" role="status">{label}</p>
    <p className="conversation-caption">{caption || (last && !ended ? last.text : '')}</p>
    {error && !farewell && <p role="alert" className="conversation-error">{error}</p>}
    {blocked && <button className="hud-button primary" onClick={() => { setBlocked(false); void session.current?.play(); }}>Abilita riproduzione audio</button>}
    {ended ? !farewell && <div className="conversation-controls">
      <button className="hud-button primary" onClick={() => setAttempt(a => a + 1)}><RotateCcw size={18}/> Riprova</button>
      <button className="hud-button" onClick={onClose}>Torna alla chat</button>
    </div> : <div className="conversation-controls">
      <button className="hud-button" onClick={() => { session.current?.mute(!muted); setMuted(!muted); }} aria-pressed={muted}>{muted ? <MicOff size={18}/> : <Mic size={18}/>} {muted ? 'Riattiva' : 'Silenzia'}</button>
      <button className="hud-button" onClick={() => session.current?.interrupt()} disabled={state !== 'speaking' && state !== 'thinking'}><Square size={16}/> Interrompi</button>
      <button className="hud-button danger" onClick={onClose}><PhoneOff size={18}/> Termina</button>
    </div>}
    <small className="hud-hint">Dì «possiamo finire qui» o «basta così» per chiudere · Esc per uscire · Gli eventi proposti si confermano nella scheda del workspace.</small>
  </dialog>;
}
