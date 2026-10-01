import { useEffect, useRef, useState } from 'react';
import { Activity, ArrowUp, BookOpen, BrainCircuit, Check, ChevronRight, CircleHelp, Cpu, GraduationCap, Menu, Mic, MicOff, Plus, Settings2, Sparkles, Volume2, VolumeX, X } from 'lucide-react';
import { NeuralCore } from './components/NeuralCore';

type Mode = 'assistant' | 'study';
type Message = { id: string; role: 'user' | 'assistant'; content: string };
const welcome: Message = { id: 'welcome', role: 'assistant', content: 'Buonasera, Francesco. Sono JARVIS. Il nucleo neurale è attivo. Possiamo parlare oppure passare alla modalità studio. Da dove iniziamo?' };
const storageKey = 'jarvis-v1-messages';
function loadMessages(): Message[] { try { const raw = localStorage.getItem(storageKey); return raw ? JSON.parse(raw) as Message[] : [welcome]; } catch { return [welcome]; } }
interface SpeechResult { results: ArrayLike<ArrayLike<{transcript:string}>> }
interface SpeechRecognitionLike { lang:string; interimResults:boolean; onresult: ((event: SpeechResult)=>void)|null; onerror: (()=>void)|null; onend:(()=>void)|null; start:()=>void; stop:()=>void }
type SpeechWindow = Window & { SpeechRecognition?: new()=>SpeechRecognitionLike; webkitSpeechRecognition?: new()=>SpeechRecognitionLike };

export default function App() {
  const [mode, setMode] = useState<Mode>('assistant');
  const [messages, setMessages] = useState<Message[]>(loadMessages);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [listening, setListening] = useState(false);
  const [voiceOutput, setVoiceOutput] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [notes, setNotes] = useState(() => localStorage.getItem('jarvis-study-notes') ?? '');
  const [notesVisible, setNotesVisible] = useState(false);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const recognition = useRef<SpeechRecognitionLike | null>(null);
  const messagesEnd = useRef<HTMLDivElement>(null);
  useEffect(() => { localStorage.setItem(storageKey, JSON.stringify(messages)); messagesEnd.current?.scrollIntoView({ behavior:'smooth' }); }, [messages]);
  useEffect(() => { localStorage.setItem('jarvis-study-notes', notes); }, [notes]);
  useEffect(() => { fetch('/api/health').then(r=>r.json()).then(d=>setConfigured(Boolean(d.configured))).catch(()=>setConfigured(false)); }, []);
  useEffect(() => () => { recognition.current?.stop(); window.speechSynthesis?.cancel(); }, []);

  async function send(text = input) {
    const content = text.trim(); if (!content || loading) return;
    const userMessage: Message = { id: crypto.randomUUID(), role:'user', content };
    const history = [...messages.filter(m=>m.id!=='welcome'), userMessage].slice(-24);
    setMessages(old=>[...old,userMessage]); setInput(''); setLoading(true);
    try {
      const response = await fetch('/api/chat', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({mode, messages:history.map(({role,content})=>({role,content}))}) });
      const result = await response.json() as { reply?:string; error?:string };
      if (!response.ok) throw new Error(result.error || 'Errore di comunicazione');
      const reply = result.reply || 'Nessuna risposta';
      setMessages(old=>[...old,{id:crypto.randomUUID(),role:'assistant',content:reply}]);
      if (voiceOutput && 'speechSynthesis' in window) { window.speechSynthesis.cancel(); const utterance = new SpeechSynthesisUtterance(reply); utterance.lang='it-IT'; utterance.rate=1.04; window.speechSynthesis.speak(utterance); }
    } catch (error) { setMessages(old=>[...old,{id:crypto.randomUUID(),role:'assistant',content:`Connessione interrotta: ${error instanceof Error ? error.message : 'errore sconosciuto'}. Verifica che il backend sia avviato.`}]); }
    finally { setLoading(false); }
  }
  function toggleListening() {
    if (listening) { recognition.current?.stop(); return; }
    const w = window as SpeechWindow;
    const SpeechClass = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!SpeechClass) { alert('Riconoscimento vocale non disponibile in questo browser. Prova Chrome su desktop o usa la tastiera.'); return; }
    const rec = new SpeechClass(); rec.lang='it-IT'; rec.interimResults=false;
    rec.onresult = event => { const transcript=event.results[0]?.[0]?.transcript; if (transcript) setInput(old=>old ? `${old} ${transcript}` : transcript); };
    rec.onerror = () => setListening(false); rec.onend = () => setListening(false);
    recognition.current=rec; try { rec.start(); setListening(true); } catch { setListening(false); }
  }
  function clearChat() { setMessages([{...welcome,id:crypto.randomUUID()}]); window.speechSynthesis?.cancel(); setSidebarOpen(false); }
  function changeMode(next:Mode) { setMode(next); setSidebarOpen(false); }
  return <div className="app-shell">
    <aside className={`sidebar ${sidebarOpen?'open':''}`}>
      <div className="brand"><div className="brand-mark"><BrainCircuit size={23}/></div><div><strong>J.A.R.V.I.S.</strong><small>PERSONAL AI SYSTEM</small></div><button className="icon-button mobile-close" onClick={()=>setSidebarOpen(false)} aria-label="Chiudi menu"><X size={20}/></button></div>
      <div className="sidebar-label">WORKSPACE</div>
      <nav className="navigation">
        <button className={mode==='assistant'?'nav-item selected':'nav-item'} onClick={()=>changeMode('assistant')}><Cpu size={18}/> Assistente <ChevronRight size={15}/></button>
        <button className={mode==='study'?'nav-item selected':'nav-item'} onClick={()=>changeMode('study')}><GraduationCap size={18}/> Studio <ChevronRight size={15}/></button>
      </nav>
      <div className="sidebar-label tools-label">IL TUO SISTEMA</div>
      <div className="feature-list"><div><Activity size={15}/> Nucleo neurale <span className="online-dot"/></div><div><BrainCircuit size={15}/> Memoria locale <span className="online-dot"/></div><div><Settings2 size={15}/> Automazioni <span className="soon">PRESTO</span></div></div>
      <div className="sidebar-bottom"><div className="profile-avatar">F</div><div><strong>Francesco</strong><small>Personal workspace</small></div><span className="profile-online"/></div>
    </aside>
    {sidebarOpen&&<button aria-label="Chiudi menu" className="sidebar-overlay" onClick={()=>setSidebarOpen(false)}/>}
    <main className="main-area">
      <header className="topbar"><button className="icon-button menu-button" onClick={()=>setSidebarOpen(true)} aria-label="Apri menu"><Menu size={22}/></button><div className="breadcrumb">SYSTEM <span>/</span> <strong>{mode==='assistant'?'ASSISTANT':'STUDY LAB'}</strong></div><div className="topbar-right"><span className={`status-pill ${configured?'ready':'demo'}`}><span className="online-dot"/>{configured?'AI CONNECTED':'DEMO MODE'}</span><button className="icon-button" title="Nuova conversazione" onClick={clearChat} aria-label="Nuova conversazione"><Plus size={20}/></button></div></header>
      <div className="workspace">
        <section className="hero" aria-label="Nucleo neurale di JARVIS">
          <div className="hero-top"><span><span className="square"/> NEURAL ENGINE / V.01</span><span className="engine-state">{loading?'PROCESSING':listening?'LISTENING':'SYSTEM STANDBY'} <span className="blink"/></span></div>
          <div className="neural-wrap"><div className="target-circle target-one"/><div className="target-circle target-two"/><NeuralCore active={listening} thinking={loading}/><div className="neural-center-label"><strong>{loading?'THINKING':listening?'LISTENING':'JARVIS'}</strong><span>{loading?'ELABORAZIONE':listening?'MICROFONO ATTIVO':'NEURAL CORE ONLINE'}</span></div></div>
          <div className="hero-bottom"><span>● {mode==='study'?'LEARNING PROTOCOL':'PERSONAL ASSISTANT'}</span><span>110 NODES · LIVE VISUALIZATION</span></div>
        </section>
        <div className="content-title"><div><span className="eyebrow">{mode==='study'?'ACADEMIC INTERFACE':'COMMAND CENTER'}</span><h1>{mode==='study'?'Study Lab':'Bentornato, Francesco.'}</h1><p>{mode==='study'?'Spiegazioni, esercizi e ripasso: il tuo tutor AI sempre disponibile.':'Il tuo assistente personale è pronto. Parla, scrivi o esplora le funzionalità.'}</p></div>{mode==='study'&&<button className="secondary-button" onClick={()=>setNotesVisible(s=>!s)}><BookOpen size={16}/> {notesVisible?'Chiudi appunti':'I miei appunti'}</button>}</div>
        {notesVisible&&mode==='study'&&<section className="notes-panel"><div className="section-heading"><BookOpen size={17}/> APPUNTI PERSONALI <span><Check size={14}/> Salvati sul dispositivo</span></div><textarea aria-label="Appunti di studio" placeholder="Scrivi qui i tuoi appunti. Si salvano automaticamente su questo dispositivo..." value={notes} onChange={event=>setNotes(event.target.value)}/></section>}
        <section className="chat-panel" aria-label="Chat con JARVIS"><div className="section-heading"><Sparkles size={17}/> {mode==='study'?'SESSIONE DI STUDIO':'CONVERSAZIONE'} <span> <span className="chat-live"/> LIVE</span></div><div className="messages" aria-live="polite">{messages.map(message=><div className={`message ${message.role}`} key={message.id}><div className="message-avatar">{message.role==='assistant'?<BrainCircuit size={17}/>: 'F'}</div><div className="message-body"><div className="message-name">{message.role==='assistant'?'JARVIS':'TU'}</div><p>{message.content}</p></div></div>)}{loading&&<div className="message assistant"><div className="message-avatar"><BrainCircuit size={17}/></div><div className="message-body"><div className="message-name">JARVIS</div><div className="typing"><i/><i/><i/></div></div></div>}<div ref={messagesEnd}/></div>
          <form className="composer" onSubmit={event=>{event.preventDefault();void send();}}><button type="button" aria-label={listening?'Interrompi microfono':'Dettatura vocale'} title="Dettatura vocale" className={`mic-button ${listening?'is-listening':''}`} onClick={toggleListening}>{listening?<MicOff size={20}/>:<Mic size={20}/>}</button><input value={input} onChange={event=>setInput(event.target.value)} aria-label="Scrivi un messaggio" placeholder={mode==='study'?'Chiedimi di spiegarti un argomento...':'Scrivi un comando o fai una domanda...'} maxLength={6000}/><button type="button" className={`voice-button ${voiceOutput?'enabled':''}`} onClick={()=>{setVoiceOutput(v=>!v); window.speechSynthesis?.cancel();}} title={voiceOutput?'Disattiva la voce':'Attiva le risposte vocali'} aria-label={voiceOutput?'Disattiva risposte vocali':'Attiva risposte vocali'}>{voiceOutput?<Volume2 size={20}/>:<VolumeX size={20}/>}</button><button type="submit" className="send-button" disabled={!input.trim()||loading} aria-label="Invia"><ArrowUp size={20}/></button></form>
          <div className="quick-actions">{(mode==='study'?["Spiegami la crittografia",'Fammi un quiz di Computer Security','Preparami un piano di ripasso']:["Cosa possiamo fare oggi?",'Aiutami a programmare','Organizziamo il mio studio']).map(text=><button key={text} onClick={()=>{setInput(text);}}>{text}</button>)}</div>
        </section>
        <footer><span><CircleHelp size={13}/> Le animazioni rappresentano una rete astratta, non il funzionamento interno del modello AI.</span><span>BUILT FOR THE FUTURE · MOBILE READY</span></footer>
      </div>
    </main>
  </div>;
}
