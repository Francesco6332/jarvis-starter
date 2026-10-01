import { useEffect, useRef, useState } from 'react';
import { Activity, ArrowUp, BookOpen, BrainCircuit, Check, ChevronRight, CircleHelp, Cpu, GraduationCap, Menu, Mic, MicOff, Plus, Settings2, Power, Trash2, Save, Sparkles, Volume2, VolumeX, X } from 'lucide-react';
import { NeuralCore } from './components/NeuralCore';

type Mode = 'assistant' | 'study';
type Memory = { id: string; content: string; createdAt: string };
type Message = { id: string; role: 'user' | 'assistant'; content: string };
const welcome: Message = { id: 'welcome', role: 'assistant', content: 'Buonasera, Francesco. Sono JARVIS. Il nucleo neurale è attivo. Possiamo parlare oppure passare alla modalità studio. Da dove iniziamo?' };
const storageKey = 'jarvis-v1-messages';
function loadMessages(): Message[] { try { const raw = localStorage.getItem(storageKey); return raw ? JSON.parse(raw) as Message[] : [welcome]; } catch { return [welcome]; } }
interface SpeechResult { resultIndex:number; results: ArrayLike<ArrayLike<{transcript:string}>> }
interface SpeechRecognitionLike { lang:string; interimResults:boolean; continuous:boolean; onresult: ((event: SpeechResult)=>void)|null; onerror: (()=>void)|null; onend:(()=>void)|null; start:()=>void; stop:()=>void }
type SpeechWindow = Window & { SpeechRecognition?: new()=>SpeechRecognitionLike; webkitSpeechRecognition?: new()=>SpeechRecognitionLike };

export default function App() {
  const [mode, setMode] = useState<Mode>('assistant');
  const [messages, setMessages] = useState<Message[]>(loadMessages);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [listening, setListening] = useState(false);
  const [voiceOutput, setVoiceOutput] = useState(true);
  const [wakeEnabled, setWakeEnabled] = useState(false);
  const [awake, setAwake] = useState(false);
  const [memoryVisible, setMemoryVisible] = useState(false);
  const [memoryText, setMemoryText] = useState('');
  const [memories, setMemories] = useState<Memory[]>([]);
  const [voiceError, setVoiceError] = useState('');
  const sendRef = useRef<(text: string) => Promise<void>>(async () => {});
  const greetRef = useRef<() => void>(() => {});
  const voiceOutputRef = useRef(true);
  const audioGenerationRef = useRef(0);
  const wakeEnabledRef = useRef(false);
  const speakingRef = useRef(false);
  const awakeRef = useRef(false);
  const loadingRef = useRef(false);
  const recognitionActiveRef = useRef(false);
  const audioRef = useRef<HTMLAudioElement|null>(null);
  const audioUrlRef = useRef<string|null>(null);
  const wakeTimerRef = useRef<ReturnType<typeof setTimeout>|null>(null);
  const greetingIndexRef = useRef(0);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [notes, setNotes] = useState(() => localStorage.getItem('jarvis-study-notes') ?? '');
  const [notesVisible, setNotesVisible] = useState(false);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const recognition = useRef<SpeechRecognitionLike | null>(null);
  const messagesEnd = useRef<HTMLDivElement>(null);
  useEffect(() => { localStorage.setItem(storageKey, JSON.stringify(messages)); messagesEnd.current?.scrollIntoView({ behavior:'smooth' }); }, [messages]);
  useEffect(() => { localStorage.setItem('jarvis-study-notes', notes); }, [notes]);
  useEffect(() => { fetch('/api/memory').then(r=>r.json()).then(d=>setMemories(d.memories||[])).catch(()=>setVoiceError('Memoria non disponibile.')); }, []);
  useEffect(() => { loadingRef.current=loading; }, [loading]);
  useEffect(() => { fetch('/api/health').then(r=>r.json()).then(d=>setConfigured(Boolean(d.configured))).catch(()=>setConfigured(false)); }, []);
  useEffect(() => () => { wakeEnabledRef.current=false; recognition.current?.stop(); if(wakeTimerRef.current)clearTimeout(wakeTimerRef.current); audioRef.current?.pause(); if(audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current); window.speechSynthesis?.cancel(); }, []);

  function stopAudio() { audioGenerationRef.current++; audioRef.current?.pause(); audioRef.current=null; if(audioUrlRef.current){URL.revokeObjectURL(audioUrlRef.current);audioUrlRef.current=null;} window.speechSynthesis?.cancel(); speakingRef.current=false; }
  function restartWakeSoon() {
    if(wakeTimerRef.current)clearTimeout(wakeTimerRef.current);
    if(!wakeEnabledRef.current || speakingRef.current || loadingRef.current) return;
    wakeTimerRef.current=setTimeout(()=>{ if(wakeEnabledRef.current && !speakingRef.current && !loadingRef.current && !recognitionActiveRef.current) { try { recognition.current?.start(); recognitionActiveRef.current=true; setListening(true); } catch { /* browser might require another gesture */ } } },350);
  }
  async function speak(text:string) {
    if(!voiceOutputRef.current || !text.trim()) { restartWakeSoon(); return; }
    recognition.current?.stop(); recognitionActiveRef.current=false;setListening(false);
    stopAudio(); const generation=audioGenerationRef.current; speakingRef.current=true;
    try {
      const response=await fetch('/api/speech',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:text.slice(0,1800)})});
      if(!response.ok)throw new Error('Voce AI non disponibile');
      const blob=await response.blob();if(generation!==audioGenerationRef.current)return;const url=URL.createObjectURL(blob);audioUrlRef.current=url;
      const audio=new Audio(url);audioRef.current=audio;
      audio.onended=()=>{stopAudio();restartWakeSoon();};
      audio.onerror=()=>{stopAudio();setVoiceError('Impossibile riprodurre audio.');restartWakeSoon();};
      await audio.play();
    } catch(error) {
      if(generation!==audioGenerationRef.current)return;
      stopAudio();setVoiceError(error instanceof Error?error.message:'Errore audio');
      // Fallback to browser TTS, voice locale maschile se disponibile.
      if('speechSynthesis' in window){
        speakingRef.current=true;
        const utterance=new SpeechSynthesisUtterance(text);utterance.lang='it-IT';utterance.rate=.97;
        const voices=window.speechSynthesis.getVoices();
        utterance.voice=voices.find(v=>v.lang.toLowerCase().startsWith('it')&&/male|luca|diego|giorgio/i.test(v.name))||voices.find(v=>v.lang.toLowerCase().startsWith('it'))||null;
        utterance.onend=()=>{speakingRef.current=false;restartWakeSoon();};
        utterance.onerror=()=>{speakingRef.current=false;restartWakeSoon();};
        window.speechSynthesis.speak(utterance);
      }else restartWakeSoon();
    }
  }
  function greet() {
    awakeRef.current=true;setAwake(true);
    const hour=new Date().getHours();const prefix=hour<12?'Buongiorno':hour<18?'Ciao':'Buonasera';
    const choices=[`${prefix}, Francesco! Come va oggi?`,`${prefix}, Francesco. Oggi che facciamo?`,`${prefix}, Francesco. Vuoi sapere quali attività hai da fare oggi?`];
    const greeting=choices[greetingIndexRef.current++%choices.length];
    setMessages(old=>[...old,{id:crypto.randomUUID(),role:'assistant',content:greeting}]);
    void speak(greeting);
  }
  async function addMemory(content=memoryText) {
    const value=content.trim();if(!value)return;
    try {const r=await fetch('/api/memory',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({content:value})});if(!r.ok)throw Error('Salvataggio non riuscito');const data=await r.json() as {memory:Memory};setMemories(old=>[...old,data.memory]);setMemoryText('');return true;}
    catch {setVoiceError('Impossibile salvare la memoria.');return false;}
  }
  async function removeMemory(id:string) {
    try {const r=await fetch(`/api/memory/${encodeURIComponent(id)}`,{method:'DELETE'});if(!r.ok)throw Error();setMemories(old=>old.filter(x=>x.id!==id));}
    catch {setVoiceError('Impossibile eliminare la memoria.');}
  }
  function enableWake() {
    if(wakeEnabledRef.current){wakeEnabledRef.current=false;setWakeEnabled(false);awakeRef.current=false;setAwake(false);recognition.current?.stop();recognitionActiveRef.current=false;setListening(false);stopAudio();return;}
    const w=window as SpeechWindow;const Recognition=w.SpeechRecognition||w.webkitSpeechRecognition;
    if(!Recognition){setVoiceError('Wake word non supportata. Usa Chrome desktop oppure il pulsante Saluta JARVIS.');return;}
    const rec=new Recognition();rec.lang='it-IT';rec.continuous=true;rec.interimResults=false;
    rec.onresult=e=>{
      for(let i=e.resultIndex;i<e.results.length;i++){
        const heard=e.results[i]?.[0]?.transcript||'';
        const match=heard.match(/\b(?:ciao|buongiorno|buonasera|hey|ehi|salve)\s+jarvis\b|\bjarvis\b/i);
        if(match && !speakingRef.current && !loadingRef.current){
          rec.stop();recognitionActiveRef.current=false;setListening(false);
          greetRef.current(); const rest=heard.slice((match.index??0)+match[0].length).replace(/^[, .!?]+/,'').trim();
          if(rest)setInput(rest);break;
        } else if(awakeRef.current && !speakingRef.current && !loadingRef.current && heard.trim()) {
          rec.stop();recognitionActiveRef.current=false;setListening(false);void sendRef.current(heard);break;
        }
      }
    };
    rec.onerror=()=>{wakeEnabledRef.current=false;setWakeEnabled(false);recognitionActiveRef.current=false;setListening(false);setVoiceError('Microfono non disponibile o permesso negato. Verifica le autorizzazioni.');};
    rec.onend=()=>{recognitionActiveRef.current=false;setListening(false);restartWakeSoon();};
    recognition.current=rec;wakeEnabledRef.current=true;setWakeEnabled(true);setVoiceError('');
    try{rec.start();recognitionActiveRef.current=true;setListening(true);}catch{setVoiceError('Attiva il microfono tramite le autorizzazioni del browser.');}
  }

  async function send(text = input) {
    const content = text.trim(); if (!content || loadingRef.current) return;
    loadingRef.current=true;setLoading(true);
    if(/^ricorda\s+che\b/i.test(content)) {
      const saved=await addMemory(content.replace(/^ricorda\s+che\s*/i,''));
      if(!saved){loadingRef.current=false;setLoading(false);restartWakeSoon();return;}
    }
    recognition.current?.stop();recognitionActiveRef.current=false;setListening(false);
    const userMessage: Message = { id: crypto.randomUUID(), role:'user', content };
    const history = [...messages.filter(m=>m.id!=='welcome'), userMessage].slice(-24);
    setMessages(old=>[...old,userMessage]); setInput(''); setLoading(true);
    try {
      const response = await fetch('/api/chat', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({mode, messages:history.map(({role,content})=>({role,content}))}) });
      const result = await response.json() as { reply?:string; error?:string };
      if (!response.ok) throw new Error(result.error || 'Errore di comunicazione');
      const reply = result.reply || 'Nessuna risposta';
      setMessages(old=>[...old,{id:crypto.randomUUID(),role:'assistant',content:reply}]);
      void speak(reply);
    } catch (error) { setMessages(old=>[...old,{id:crypto.randomUUID(),role:'assistant',content:`Connessione interrotta: ${error instanceof Error ? error.message : 'errore sconosciuto'}. Verifica che il backend sia avviato.`}]); }
    finally { loadingRef.current=false;setLoading(false);restartWakeSoon(); }
  }
  function toggleListening() {
    if(wakeEnabledRef.current){setVoiceError('Disattiva prima la wake word per usare la dettatura manuale.');return;}
    if (listening) { recognition.current?.stop(); return; }
    const w = window as SpeechWindow;
    const SpeechClass = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!SpeechClass) { alert('Riconoscimento vocale non disponibile in questo browser. Prova Chrome su desktop o usa la tastiera.'); return; }
    const rec = new SpeechClass(); rec.lang='it-IT'; rec.interimResults=false;rec.continuous=false;
    rec.onresult = event => { const transcript=event.results[0]?.[0]?.transcript; if (transcript) setInput(old=>old ? `${old} ${transcript}` : transcript); };
    rec.onerror = () => setListening(false); rec.onend = () => setListening(false);
    recognition.current=rec; try { rec.start(); setListening(true); } catch { setListening(false); }
  }
  function clearChat() { setMessages([{...welcome,id:crypto.randomUUID()}]); stopAudio();restartWakeSoon(); setSidebarOpen(false); }
  function changeMode(next:Mode) { setMode(next); setSidebarOpen(false); }
  sendRef.current=send;
  greetRef.current=greet;
  return <div className="app-shell">
    <aside className={`sidebar ${sidebarOpen?'open':''}`}>
      <div className="brand"><div className="brand-mark"><BrainCircuit size={23}/></div><div><strong>J.A.R.V.I.S.</strong><small>PERSONAL AI SYSTEM</small></div><button className="icon-button mobile-close" onClick={()=>setSidebarOpen(false)} aria-label="Chiudi menu"><X size={20}/></button></div>
      <div className="sidebar-label">WORKSPACE</div>
      <nav className="navigation">
        <button className={mode==='assistant'?'nav-item selected':'nav-item'} onClick={()=>changeMode('assistant')}><Cpu size={18}/> Assistente <ChevronRight size={15}/></button>
        <button className={mode==='study'?'nav-item selected':'nav-item'} onClick={()=>changeMode('study')}><GraduationCap size={18}/> Studio <ChevronRight size={15}/></button>
      </nav>
      <div className="sidebar-label tools-label">IL TUO SISTEMA</div>
      <div className="feature-list"><div><Activity size={15}/> Nucleo neurale <span className="online-dot"/></div><button className="feature-button" onClick={()=>setMemoryVisible(v=>!v)}><BrainCircuit size={15}/> Memoria ({memories.length}) <ChevronRight size={14}/></button><div><Settings2 size={15}/> Automazioni <span className="soon">PRESTO</span></div></div>
      <div className="sidebar-bottom"><div className="profile-avatar">F</div><div><strong>Francesco</strong><small>Personal workspace</small></div><span className="profile-online"/></div>
    </aside>
    {sidebarOpen&&<button aria-label="Chiudi menu" className="sidebar-overlay" onClick={()=>setSidebarOpen(false)}/>}
    <main className="main-area">
      <header className="topbar"><button className="icon-button menu-button" onClick={()=>setSidebarOpen(true)} aria-label="Apri menu"><Menu size={22}/></button><div className="breadcrumb">SYSTEM <span>/</span> <strong>{mode==='assistant'?'ASSISTANT':'STUDY LAB'}</strong></div><div className="topbar-right"><span className={`status-pill ${configured?'ready':'demo'}`}><span className="online-dot"/>{configured?'AI CONNECTED':'DEMO MODE'}</span><button className="icon-button" title="Nuova conversazione" onClick={clearChat} aria-label="Nuova conversazione"><Plus size={20}/></button></div></header>
      <div className="workspace">
        <section className="hero" aria-label="Nucleo neurale di JARVIS">
          <div className="hero-top"><span><span className="square"/> NEURAL ENGINE / V.02</span><span className="engine-state">{loading?'PROCESSING':listening?'WAKE WORD ACTIVE':awake?'AWAKE':'STANDBY'} <span className="blink"/></span></div>
          <div className="neural-wrap"><div className="target-circle target-one"/><div className="target-circle target-two"/><NeuralCore active={listening||awake} thinking={loading}/><div className="neural-center-label"><strong>{loading?'THINKING':listening?'LISTENING':'JARVIS'}</strong><span>{loading?'ELABORAZIONE':listening?'MICROFONO ATTIVO':'NEURAL CORE ONLINE'}</span></div></div>
          <div className="hero-bottom"><span>● {mode==='study'?'LEARNING PROTOCOL':'PERSONAL ASSISTANT'}</span><span>110 NODES · LIVE VISUALIZATION</span></div>
        </section>
        <div className="wake-controls"><button className={`secondary-button ${wakeEnabled?'wake-on':''}`} onClick={enableWake}><Power size={17}/>{wakeEnabled?'Disattiva «Hey Jarvis»':'Attiva «Hey Jarvis»'}</button><button className="secondary-button" onClick={greet}><Mic size={17}/> Saluta JARVIS</button><span>{wakeEnabled?'In ascolto finché questa scheda resta attiva':'Attiva il microfono per chiamarlo per nome'}</span></div>
        {voiceError&&<div className="voice-error" role="alert">{voiceError}<button onClick={()=>setVoiceError('')} aria-label="Chiudi avviso"><X size={16}/></button></div>}
        {memoryVisible&&<section className="notes-panel memory-panel"><div className="section-heading"><BrainCircuit size={17}/> MEMORIA DI JARVIS <span>{memories.length} ricordi</span></div><p>Salva solo ciò che vuoi che JARVIS ricordi. Scrivi anche in chat «Ricorda che...». Puoi eliminare ogni ricordo.</p><form onSubmit={e=>{e.preventDefault();void addMemory();}} className="memory-form"><input value={memoryText} maxLength={500} onChange={e=>setMemoryText(e.target.value)} placeholder="Es. Studio Computer Science all'università"/><button type="submit" className="secondary-button" disabled={!memoryText.trim()}><Save size={16}/> Ricorda</button></form><div className="memory-items">{memories.map(m=><div key={m.id} className="memory-item"><span>{m.content}</span><button aria-label="Elimina ricordo" title="Elimina ricordo" onClick={()=>void removeMemory(m.id)}><Trash2 size={16}/></button></div>)}</div><small>Memoria privata locale al backend, non ancora sincronizzata tra dispositivi.</small></section>}
        <div className="content-title"><div><span className="eyebrow">{mode==='study'?'ACADEMIC INTERFACE':'COMMAND CENTER'}</span><h1>{mode==='study'?'Study Lab':'Bentornato, Francesco.'}</h1><p>{mode==='study'?'Spiegazioni, esercizi e ripasso: il tuo tutor AI sempre disponibile.':'Il tuo assistente personale è pronto. Parla, scrivi o esplora le funzionalità.'}</p></div>{mode==='study'&&<button className="secondary-button" onClick={()=>setNotesVisible(s=>!s)}><BookOpen size={16}/> {notesVisible?'Chiudi appunti':'I miei appunti'}</button>}</div>
        {notesVisible&&mode==='study'&&<section className="notes-panel"><div className="section-heading"><BookOpen size={17}/> APPUNTI PERSONALI <span><Check size={14}/> Salvati sul dispositivo</span></div><textarea aria-label="Appunti di studio" placeholder="Scrivi qui i tuoi appunti. Si salvano automaticamente su questo dispositivo..." value={notes} onChange={event=>setNotes(event.target.value)}/></section>}
        <section className="chat-panel" aria-label="Chat con JARVIS"><div className="section-heading"><Sparkles size={17}/> {mode==='study'?'SESSIONE DI STUDIO':'CONVERSAZIONE'} <span> <span className="chat-live"/> LIVE</span></div><div className="messages" aria-live="polite">{messages.map(message=><div className={`message ${message.role}`} key={message.id}><div className="message-avatar">{message.role==='assistant'?<BrainCircuit size={17}/>: 'F'}</div><div className="message-body"><div className="message-name">{message.role==='assistant'?'JARVIS':'TU'}</div><p>{message.content}</p></div></div>)}{loading&&<div className="message assistant"><div className="message-avatar"><BrainCircuit size={17}/></div><div className="message-body"><div className="message-name">JARVIS</div><div className="typing"><i/><i/><i/></div></div></div>}<div ref={messagesEnd}/></div>
          <form className="composer" onSubmit={event=>{event.preventDefault();void send();}}><button type="button" aria-label={listening?'Interrompi microfono':'Dettatura vocale'} title="Dettatura vocale" className={`mic-button ${listening?'is-listening':''}`} onClick={toggleListening}>{listening?<MicOff size={20}/>:<Mic size={20}/>}</button><input value={input} onChange={event=>setInput(event.target.value)} aria-label="Scrivi un messaggio" placeholder={mode==='study'?'Chiedimi di spiegarti un argomento...':'Scrivi un comando o fai una domanda...'} maxLength={6000}/><button type="button" className={`voice-button ${voiceOutput?'enabled':''}`} onClick={()=>{voiceOutputRef.current=!voiceOutputRef.current;setVoiceOutput(voiceOutputRef.current); stopAudio();restartWakeSoon();}} title={voiceOutput?'Disattiva la voce':'Attiva le risposte vocali'} aria-label={voiceOutput?'Disattiva risposte vocali':'Attiva risposte vocali'}>{voiceOutput?<Volume2 size={20}/>:<VolumeX size={20}/>}</button><button type="submit" className="send-button" disabled={!input.trim()||loading} aria-label="Invia"><ArrowUp size={20}/></button></form>
          <div className="quick-actions">{(mode==='study'?["Spiegami la crittografia",'Fammi un quiz di Computer Security','Preparami un piano di ripasso']:["Cosa possiamo fare oggi?",'Aiutami a programmare','Organizziamo il mio studio']).map(text=><button key={text} onClick={()=>{setInput(text);}}>{text}</button>)}</div>
        </section>
        <footer><span><CircleHelp size={13}/> Le animazioni rappresentano una rete astratta, non il funzionamento interno del modello AI.</span><span>BUILT FOR THE FUTURE · MOBILE READY</span></footer>
      </div>
    </main>
  </div>;
}
