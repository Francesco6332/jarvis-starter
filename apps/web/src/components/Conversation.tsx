import { useEffect, useRef, useState } from 'react';
import { Mic, MicOff, PhoneOff } from 'lucide-react';
import { NeuralCore } from './NeuralCore';
import { RealtimeVoice, type VoiceState } from '../lib/realtime';
interface Recognition { lang: string; continuous: boolean; interimResults: boolean; onresult: ((event: any) => void) | null; onerror: (() => void) | null; onend: (() => void) | null; start: () => void; stop: () => void }
type VoiceWindow = Window & { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
export function Conversation({ mode, studyContext, onClose, onWorkspace, onTranscript }: { mode: 'assistant' | 'study'; studyContext: string; onClose: () => void; onWorkspace: () => void; onTranscript: (role: 'user' | 'assistant', text: string) => void }) {
  const dialog = useRef<HTMLDialogElement>(null), session = useRef<RealtimeVoice | null>(null), activation = useRef<Recognition | null>(null);
  const [state, setState] = useState<VoiceState>('ended'), [started, setStarted] = useState(false), [muted, setMuted] = useState(false), [error, setError] = useState(''), [blocked, setBlocked] = useState(false), [briefing, setBriefing] = useState(true), [armed, setArmed] = useState(false);
  const [transcript, setTranscript] = useState<{ role: string; text: string }[]>([]);
  const callbacks = useRef({ onWorkspace, onTranscript }); callbacks.current = { onWorkspace, onTranscript };
  useEffect(() => { const previous = document.activeElement as HTMLElement | null; dialog.current?.showModal(); return () => { activation.current?.stop(); session.current?.stop(); previous?.focus(); }; }, []);
  function createSession() {
    setError(''); setStarted(true); setMuted(false); setBlocked(false);
    const voice = new RealtimeVoice({ state: setState, error: setError, autoplay: () => setBlocked(true), workspace: () => callbacks.current.onWorkspace(), endRequested: () => { activation.current?.stop(); setArmed(false); }, transcript: (role, text) => { setTranscript(old => [...old, { role, text }].slice(-6)); callbacks.current.onTranscript(role, text); } });
    session.current = voice; void voice.start({ mode, studyContext, briefing });
  }
  function armVoice() {
    const w = window as VoiceWindow, RecognitionCtor = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!RecognitionCtor) { setError('Attivazione vocale non supportata. Usa Chrome o Edge con microfono autorizzato.'); return; }
    const rec = new RecognitionCtor(); rec.lang = 'it-IT'; rec.continuous = true; rec.interimResults = false;
    rec.onresult = event => { for (let i = event.resultIndex; i < event.results.length; i++) { const heard = event.results[i]?.[0]?.transcript || ''; if (event.results[i]?.[0]?.isFinal && /\b(?:ehi|hey|ciao)?\s*jarvis\b/i.test(heard)) { rec.stop(); activation.current = null; setArmed(false); createSession(); return; } } };
    rec.onerror = () => { activation.current = null; setArmed(false); setError('Microfono non disponibile o permesso negato.'); };
    rec.onend = () => { if (activation.current === rec) { activation.current = null; setArmed(false); } };
    activation.current = rec; setError(''); setArmed(true); rec.start();
  }
  function stopAll() { activation.current?.stop(); activation.current = null; setArmed(false); session.current?.stop(); setState('ended'); }
  const labels = { connecting: 'Connessione…', listening: muted ? 'Microfono disattivato' : 'Ti ascolto', thinking: 'Sto elaborando', speaking: 'JARVIS sta parlando', ended: started ? 'Conversazione terminata' : 'Pronto quando vuoi' };
  return <dialog ref={dialog} className="conversation" onCancel={e => { e.preventDefault(); onClose(); }} aria-labelledby="voice-title">
    <div className="conversation-top"><span>J.A.R.V.I.S. / CONVERSAZIONE</span><button onClick={onClose} aria-label="Chiudi conversazione">✕</button></div>
    <h2 id="voice-title">Parliamone.</h2><p>Voce AI in tempo reale · Puoi interrompermi parlando</p>
    <div className="conversation-core"><NeuralCore active={state === 'speaking' || state === 'listening'} thinking={state === 'thinking' || state === 'connecting'} /></div>
    <p className="conversation-state" role="status">{labels[state]}</p>
    {error && <p role="alert" className="conversation-error">{error}</p>}
    {state === 'ended' ? <div className="conversation-start"><label><input type="checkbox" checked={briefing} onChange={e => setBriefing(e.target.checked)} /> Inizia con un briefing dei miei impegni</label><p>JARVIS resta inattivo finché non sente “Jarvis”. Dopo la frase di chiusura disattiva l’ascolto. Audio inviato a OpenAI quando la conversazione parte; consuma credito API.</p>{armed ? <button className="primary" onClick={stopAll}>Disattiva ascolto vocale</button> : <button className="primary" onClick={armVoice}>{started ? 'Riattiva «Jarvis»' : 'Attiva ascolto vocale'}</button>}<button onClick={onClose}>Torna alla chat</button></div> : <div className="conversation-controls"><button onClick={() => { session.current?.mute(!muted); setMuted(!muted); }} aria-pressed={muted}>{muted ? <MicOff size={18}/> : <Mic size={18}/>} {muted ? 'Attiva microfono' : 'Silenzia'}</button><button onClick={() => session.current?.interrupt()}>Interrompi risposta</button><button onClick={stopAll}><PhoneOff size={18}/> Termina</button></div>}
    {blocked && <button onClick={() => { setBlocked(false); void session.current?.play(); }}>Abilita riproduzione audio</button>}
    <div className="conversation-transcript" aria-label="Trascrizione della conversazione">{transcript.map((item, i) => <p key={i}><strong>{item.role === 'user' ? 'Tu' : 'JARVIS'}:</strong> {item.text}</p>)}</div>
    <small>Trascrizioni automatiche: possono contenere errori o testo interrotto. Per confermare un evento, termina e apri la scheda nel workspace.</small>
  </dialog>;
}
