import { useEffect, useRef, useState } from 'react';
import { Mic, MicOff, PhoneOff } from 'lucide-react';
import { NeuralCore } from './NeuralCore';
import { RealtimeVoice, type VoiceState } from '../lib/realtime';
export function Conversation({ mode, studyContext, onClose, onWorkspace, onTranscript }: { mode: 'assistant' | 'study'; studyContext: string; onClose: () => void; onWorkspace: () => void; onTranscript: (role: 'user' | 'assistant', text: string) => void }) {
  const dialog = useRef<HTMLDialogElement>(null), session = useRef<RealtimeVoice | null>(null);
  const [state, setState] = useState<VoiceState>('ended'), [started, setStarted] = useState(false), [muted, setMuted] = useState(false), [error, setError] = useState(''), [blocked, setBlocked] = useState(false), [briefing, setBriefing] = useState(true);
  const [transcript, setTranscript] = useState<{ role: string; text: string }[]>([]);
  const callbacks = useRef({ onWorkspace, onTranscript }); callbacks.current = { onWorkspace, onTranscript };
  useEffect(() => { const previous = document.activeElement as HTMLElement | null; dialog.current?.showModal(); return () => { session.current?.stop(); previous?.focus(); }; }, []);
  function start() {
    setError(''); setStarted(true); setMuted(false); setBlocked(false);
    const voice = new RealtimeVoice({ state: setState, error: setError, autoplay: () => setBlocked(true), workspace: () => callbacks.current.onWorkspace(), transcript: (role, text) => { setTranscript(old => [...old, { role, text }].slice(-6)); callbacks.current.onTranscript(role, text); } });
    session.current = voice; void voice.start({ mode, studyContext, briefing });
  }
  const labels = { connecting: 'Connessione…', listening: muted ? 'Microfono disattivato' : 'Ti ascolto', thinking: 'Sto elaborando', speaking: 'JARVIS sta parlando', ended: started ? 'Conversazione terminata' : 'Pronto quando vuoi' };
  return <dialog ref={dialog} className="conversation" onCancel={e => { e.preventDefault(); onClose(); }} aria-labelledby="voice-title">
    <div className="conversation-top"><span>J.A.R.V.I.S. / CONVERSAZIONE</span><button onClick={onClose} aria-label="Chiudi conversazione">✕</button></div>
    <h2 id="voice-title">Parliamone.</h2><p>Voce AI in tempo reale · Puoi interrompermi parlando</p>
    <div className="conversation-core"><NeuralCore active={state === 'speaking' || state === 'listening'} thinking={state === 'thinking' || state === 'connecting'} /></div>
    <p className="conversation-state" role="status">{labels[state]}</p>
    {error && <p role="alert" className="conversation-error">{error}</p>}
    {state === 'ended' ? <div className="conversation-start"><label><input type="checkbox" checked={briefing} onChange={e => setBriefing(e.target.checked)} /> Inizia con un briefing dei miei impegni</label><p>Audio inviato a OpenAI. Consuma credito API. Sessioni di massimo 10 minuti, solo con pagina aperta. Gli appunti vengono inclusi solo se ne hai attivato la condivisione.</p><button className="primary" onClick={start}>{started ? 'Nuova conversazione' : 'Avvia conversazione'}</button><button onClick={onClose}>Torna alla chat</button></div> : <div className="conversation-controls"><button onClick={() => { session.current?.mute(!muted); setMuted(!muted); }} aria-pressed={muted}>{muted ? <MicOff size={18}/> : <Mic size={18}/>} {muted ? 'Attiva microfono' : 'Silenzia'}</button><button onClick={() => session.current?.interrupt()}>Interrompi risposta</button><button onClick={() => session.current?.stop()}><PhoneOff size={18}/> Termina</button></div>}
    {blocked && <button onClick={() => { setBlocked(false); void session.current?.play(); }}>Abilita riproduzione audio</button>}
    <div className="conversation-transcript" aria-label="Trascrizione della conversazione">{transcript.map((item, i) => <p key={i}><strong>{item.role === 'user' ? 'Tu' : 'JARVIS'}:</strong> {item.text}</p>)}</div>
    <small>Trascrizioni automatiche: possono contenere errori o testo interrotto. Per confermare un evento, termina e apri la scheda nel workspace.</small>
  </dialog>;
}
