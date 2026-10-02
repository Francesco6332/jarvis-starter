import { useEffect, useRef, useState } from 'react';
import { Activity, ArrowUp, BookOpen, BrainCircuit, Check, ChevronRight, CircleHelp, Cpu, GraduationCap, Menu, Mic, MicOff, Plus, Settings2, Power, Trash2, Save, Sparkles, Volume2, VolumeX, X } from 'lucide-react';
import { NeuralCore } from './components/NeuralCore';
import { Workspace } from './components/Workspace';
import { Conversation } from './components/Conversation';
import { apiFetch, consumeEvents } from './lib/api';
import { VoiceQueue, takeSpeechChunks } from './lib/voice';

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
  const [conversationOpen, setConversationOpen] = useState(false);
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
  const voiceQueue = useRef<VoiceQueue | null>(null);
  const configuredRef = useRef(false);
  const chatAbort = useRef<AbortController | null>(null);
  const [workspaceRevision, setWorkspaceRevision] = useState(0);
  const [toolStatus, setToolStatus] = useState('');
  const [shareNotes, setShareNotes] = useState(false);
  const wakeEnabledRef = useRef(false);
  const speakingRef = useRef(false);
  const awakeRef = useRef(false);
  const loadingRef = useRef(false);
  const recognitionActiveRef = useRef(false);
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
  useEffect(() => { fetch('/api/health').then(r=>r.json()).then(d=>{configuredRef.current=Boolean(d.configured);setConfigured(Boolean(d.configured));}).catch(()=>setConfigured(false)); }, []);
  useEffect(() => () => { wakeEnabledRef.current=false; recognition.current?.stop(); if(wakeTimerRef.current)clearTimeout(wakeTimerRef.current); chatAbort.current?.abort(); voiceQueue.current?.stop(); }, []);
  if (!voiceQueue.current) voiceQueue.current = new VoiceQueue(active => {
    speakingRef.current=active;
    if(active){recognition.current?.stop();recognitionActiveRef.current=false;setListening(false);}else restartWakeSoon();
  }, setVoiceError, () => configuredRef.current);
  function stopAudio() { voiceQueue.current?.stop(); }
  function restartWakeSoon() {
    if(wakeTimerRef.current)clearTimeout(wakeTimerRef.current);
    if(!wakeEnabledRef.current || speakingRef.current || loadingRef.current) return;
    wakeTimerRef.current=setTimeout(()=>{ if(wakeEnabledRef.current && !speakingRef.current && !loadingRef.current && !recognitionActiveRef.current) { try { recognition.current?.start(); recognitionActiveRef.current=true; setListening(true); } catch { /* browser might require another gesture */ } } },350);
  }
  function speak(text: string) {
    if(!voiceOutputRef.current) return;
    stopAudio();
    for(const chunk of takeSpeechChunks(text, true).chunks) voiceQueue.current?.enqueue(chunk);
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
    try {const r=await apiFetch('/api/memory',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({content:value})});if(!r.ok)throw Error('Salvataggio non riuscito');const data=await r.json() as {memory:Memory};setMemories(old=>[...old,data.memory]);setMemoryText('');return true;}
    catch {setVoiceError('Impossibile salvare la memoria.');return false;}
  }
  async function removeMemory(id:string) {
    try {const r=await apiFetch(`/api/memory/${encodeURIComponent(id)}`,{method:'DELETE'});if(!r.ok)throw Error();setMemories(old=>old.filter(x=>x.id!==id));}
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
          const rest=heard.slice((match.index??0)+match[0].length).replace(/^[, .!?]+/,'').trim();
          awakeRef.current=true;setAwake(true);
          if(rest)void sendRef.current(rest);else greetRef.current();break;
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
    loadingRef.current=true;setLoading(true);setToolStatus('');
    stopAudio();recognition.current?.stop();recognitionActiveRef.current=false;setListening(false);
    if(/^ricorda\s+che\b/i.test(content)) {
      const saved=await addMemory(content.replace(/^ricorda\s+che\s*/i,''));
      if(!saved){loadingRef.current=false;setLoading(false);restartWakeSoon();return;}
    }
    const userMessage: Message = { id: crypto.randomUUID(), role:'user', content };
    const replyId=crypto.randomUUID();
    const history = [...messages.filter(m=>m.id!=='welcome' && m.content.trim()), userMessage].slice(-24);
    setMessages(old=>[...old,userMessage,{id:replyId,role:'assistant',content:''}]);setInput('');
    const controller=new AbortController();chatAbort.current=controller;
    let speechBuffer='';
    try {
      const response=await apiFetch('/api/chat/stream',{method:'POST',signal:controller.signal,body:JSON.stringify({mode,messages:history.map(({role,content})=>({role,content})),voice:voiceOutputRef.current,studyContext:mode==='study'&&shareNotes?notes.slice(0,30000):undefined})});
      await consumeEvents(response,event=>{
        if(event.type==='delta') {
          setToolStatus('');setMessages(old=>old.map(m=>m.id===replyId?{...m,content:m.content+event.text}:m));
          if(voiceOutputRef.current){speechBuffer+=event.text;const result=takeSpeechChunks(speechBuffer);speechBuffer=result.rest;for(const chunk of result.chunks)voiceQueue.current?.enqueue(chunk);}else speechBuffer='';
        }
        if(event.type==='tool')setToolStatus('Sto utilizzando gli strumenti autorizzati…');
        if(event.type==='workspace'||event.type==='proposal')setWorkspaceRevision(v=>v+1);
      });
      if(voiceOutputRef.current)for(const chunk of takeSpeechChunks(speechBuffer,true).chunks)voiceQueue.current?.enqueue(chunk);
    } catch(error) {
      stopAudio();
      const message=controller.signal.aborted?'Risposta interrotta.':`Errore: ${error instanceof Error?error.message:'connessione non disponibile'}`;
      setMessages(old=>old.map(m=>m.id===replyId?{...m,content:m.content+(m.content?'\n\n':'')+message}:m));
    } finally {chatAbort.current=null;loadingRef.current=false;setLoading(false);setToolStatus('');restartWakeSoon();}
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
  function clearChat() { chatAbort.current?.abort();setMessages([{...welcome,id:crypto.randomUUID()}]); stopAudio();restartWakeSoon(); setSidebarOpen(false); }
  function changeMode(next:Mode) { setMode(next); setSidebarOpen(false); }
  sendRef.current=send;
  greetRef.current=greet;
  function openConversation() {
    wakeEnabledRef.current=false; setWakeEnabled(false); recognition.current?.stop(); recognitionActiveRef.current=false; setListening(false);
    if(wakeTimerRef.current)clearTimeout(wakeTimerRef.current);
    chatAbort.current?.abort(); stopAudio(); setConversationOpen(true);
  }
  return <div className="app-shell">
    {conversationOpen && <Conversation mode={mode} studyContext={mode==='study' && shareNotes ? notes.slice(0,30000) : ''} onClose={()=>setConversationOpen(false)} onWorkspace={()=>setWorkspaceRevision(v=>v+1)} onTranscript={(role,content)=>setMessages(old=>[...old,{id:crypto.randomUUID(),role,content}])}/>}
    <aside className={`sidebar ${sidebarOpen?'open':''}`}>
      <div className="brand"><div className="brand-mark"><BrainCircuit size={23}/></div><div><strong>J.A.R.V.I.S.</strong><small>PERSONAL AI SYSTEM</small></div><button className="icon-button mobile-close" onClick={()=>setSidebarOpen(false)} aria-label="Chiudi menu"><X size={20}/></button></div>
      <div className="sidebar-label">WORKSPACE</div>
      <nav className="navigation">
        <button className={mode==='assistant'?'nav-item selected':'nav-item'} onClick={()=>changeMode('assistant')}><Cpu size={18}/> Assistente <ChevronRight size={15}/></button>
        <button className={mode==='study'?'nav-item selected':'nav-item'} onClick={()=>changeMode('study')}><GraduationCap size={18}/> Studio <ChevronRight size={15}/></button>
      </nav>
      <div className="sidebar-label tools-label">IL TUO SISTEMA</div>
      <div className="feature-list"><div><Activity size={15}/> Nucleo neurale <span className="online-dot"/></div><button className="feature-button" onClick={()=>setMemoryVisible(v=>!v)}><BrainCircuit size={15}/> Memoria ({memories.length}) <ChevronRight size={14}/></button><a className="feature-button" href="#workspace-tools"><Settings2 size={15}/> Permessi e attività</a></div>
      <div className="sidebar-bottom"><div className="profile-avatar">F</div><div><strong>Francesco</strong><small>Personal workspace</small></div><span className="profile-online"/></div>
    </aside>
    {sidebarOpen&&<button aria-label="Chiudi menu" className="sidebar-overlay" onClick={()=>setSidebarOpen(false)}/>}
    <main className="main-area">
      <header className="topbar"><button className="icon-button menu-button" onClick={()=>setSidebarOpen(true)} aria-label="Apri menu"><Menu size={22}/></button><div className="breadcrumb">SYSTEM <span>/</span> <strong>{mode==='assistant'?'ASSISTANT':'STUDY LAB'}</strong></div><div className="topbar-right"><span className={`status-pill ${configured?'ready':'demo'}`}><span className="online-dot"/>{configured?'AI CONFIGURED':'DEMO MODE'}</span><button className="icon-button" title="Nuova conversazione" onClick={clearChat} aria-label="Nuova conversazione"><Plus size={20}/></button></div></header>
      <div className="workspace">
        <section className="hero" aria-label="Nucleo neurale di JARVIS">
          <div className="hero-top"><span><span className="square"/> NEURAL ENGINE / V.04</span><span className="engine-state">{loading?'PROCESSING':listening?'WAKE WORD ACTIVE':awake?'AWAKE':'STANDBY'} <span className="blink"/></span></div>
          <div className="neural-wrap"><div className="target-circle target-one"/><div className="target-circle target-two"/><NeuralCore active={listening||awake} thinking={loading}/><div className="neural-center-label"><strong>{loading?'THINKING':listening?'LISTENING':'JARVIS'}</strong><span>{loading?'ELABORAZIONE':listening?'MICROFONO ATTIVO':'NEURAL CORE ONLINE'}</span></div></div>
          <div className="hero-bottom"><span>● {mode==='study'?'LEARNING PROTOCOL':'PERSONAL ASSISTANT'}</span><span>110 NODES · LIVE VISUALIZATION</span></div>
        </section>
        <div className="wake-controls"><button className="secondary-button" onClick={openConversation} disabled={!configured}><Mic size={17}/> Conversazione continua</button><button className={`secondary-button ${wakeEnabled?'wake-on':''}`} onClick={enableWake}><Power size={17}/>{wakeEnabled?'Disattiva «Hey Jarvis»':'Attiva «Hey Jarvis»'}</button><button className="secondary-button" disabled={loading} onClick={greet}><Mic size={17}/> Saluta JARVIS</button><span>{wakeEnabled?'In ascolto finché questa scheda resta attiva':'Attiva il microfono per chiamarlo per nome'}</span></div>
        {voiceError&&<div className="voice-error" role="alert">{voiceError}<button onClick={()=>setVoiceError('')} aria-label="Chiudi avviso"><X size={16}/></button></div>}
        <details id="workspace-tools" className="tools-disclosure" open><summary>Google Calendar · Permessi · Attività di studio</summary><Workspace revision={workspaceRevision} onResult={content=>{chatAbort.current?.abort();setMessages(old=>[...old,{id:crypto.randomUUID(),role:'assistant',content}]);if(!loadingRef.current)speak(content);}}/></details>
        {memoryVisible&&<section className="notes-panel memory-panel"><div className="section-heading"><BrainCircuit size={17}/> MEMORIA DI JARVIS <span>{memories.length} ricordi</span></div><p>Salva solo ciò che vuoi che JARVIS ricordi. Scrivi anche in chat «Ricorda che...». Puoi eliminare ogni ricordo.</p><form onSubmit={e=>{e.preventDefault();void addMemory();}} className="memory-form"><input value={memoryText} maxLength={500} onChange={e=>setMemoryText(e.target.value)} placeholder="Es. Studio Computer Science all'università"/><button type="submit" className="secondary-button" disabled={!memoryText.trim()}><Save size={16}/> Ricorda</button></form><div className="memory-items">{memories.map(m=><div key={m.id} className="memory-item"><span>{m.content}</span><button aria-label="Elimina ricordo" title="Elimina ricordo" onClick={()=>void removeMemory(m.id)}><Trash2 size={16}/></button></div>)}</div><small>Memoria privata locale al backend, non ancora sincronizzata tra dispositivi.</small></section>}
        <div className="content-title"><div><span className="eyebrow">{mode==='study'?'ACADEMIC INTERFACE':'COMMAND CENTER'}</span><h1>{mode==='study'?'Study Lab':'Bentornato, Francesco.'}</h1><p>{mode==='study'?'Spiegazioni, esercizi e ripasso: il tuo tutor AI sempre disponibile.':'Il tuo assistente personale è pronto. Parla, scrivi o esplora le funzionalità.'}</p></div>{mode==='study'&&<button className="secondary-button" onClick={()=>setNotesVisible(s=>!s)}><BookOpen size={16}/> {notesVisible?'Chiudi appunti':'I miei appunti'}</button>}</div>
        {notesVisible&&mode==='study'&&<section className="notes-panel"><div className="section-heading"><BookOpen size={17}/> APPUNTI PERSONALI <span><Check size={14}/> Salvati sul dispositivo</span></div><label className="share-notes"><input type="checkbox" checked={shareNotes} onChange={e=>setShareNotes(e.target.checked)}/> Condividi questi appunti con l’AI nelle richieste Studio</label><label className="study-upload">Importa materiale .txt / .md (max 30.000 caratteri)<input type="file" accept=".txt,.md,text/plain,text/markdown" onChange={async e=>{const file=e.target.files?.[0];if(!file)return;if(file.size>150000){setVoiceError('File troppo grande. Usa un estratto di massimo 30.000 caratteri.');return;}const text=await file.text();if(text.length>30000){setVoiceError('Materiale troppo lungo: massimo 30.000 caratteri.');return;}setNotes(text);setShareNotes(false);e.target.value='';}}/></label><textarea maxLength={30000} aria-label="Appunti di studio" placeholder="Scrivi qui i tuoi appunti. Si salvano automaticamente su questo dispositivo..." value={notes} onChange={event=>setNotes(event.target.value)}/></section>}
        <section className="chat-panel" aria-label="Chat con JARVIS"><div className="section-heading"><Sparkles size={17}/> {mode==='study'?'SESSIONE DI STUDIO':'CONVERSAZIONE'} <span> <span className="chat-live"/> LIVE</span></div><div className="messages" aria-live="polite">{messages.map(message=><div className={`message ${message.role}`} key={message.id}><div className="message-avatar">{message.role==='assistant'?<BrainCircuit size={17}/>: 'F'}</div><div className="message-body"><div className="message-name">{message.role==='assistant'?'JARVIS':'TU'}</div><p>{message.content}</p></div></div>)}{loading&&<div className="message assistant"><div className="message-avatar"><BrainCircuit size={17}/></div><div className="message-body"><div className="message-name">JARVIS</div><div className="typing"><i/><i/><i/></div>{toolStatus&&<small>{toolStatus}</small>}</div></div>}<div ref={messagesEnd}/></div>
          <form className="composer" onSubmit={event=>{event.preventDefault();void send();}}><button type="button" aria-label={listening?'Interrompi microfono':'Dettatura vocale'} title="Dettatura vocale" className={`mic-button ${listening?'is-listening':''}`} onClick={toggleListening}>{listening?<MicOff size={20}/>:<Mic size={20}/>}</button><input value={input} onChange={event=>setInput(event.target.value)} aria-label="Scrivi un messaggio" placeholder={mode==='study'?'Chiedimi di spiegarti un argomento...':'Scrivi un comando o fai una domanda...'} maxLength={6000}/><button type="button" className={`voice-button ${voiceOutput?'enabled':''}`} onClick={()=>{voiceOutputRef.current=!voiceOutputRef.current;setVoiceOutput(voiceOutputRef.current); stopAudio();restartWakeSoon();}} title={voiceOutput?'Disattiva la voce':'Attiva le risposte vocali'} aria-label={voiceOutput?'Disattiva risposte vocali':'Attiva risposte vocali'}>{voiceOutput?<Volume2 size={20}/>:<VolumeX size={20}/>}</button><button type="button" className="voice-button" onClick={()=>{chatAbort.current?.abort();stopAudio();}} title="Interrompi risposta e voce" aria-label="Interrompi risposta e voce"><X size={18}/></button><button type="submit" className="send-button" disabled={!input.trim()||loading} aria-label="Invia"><ArrowUp size={20}/></button></form>
          <div className="quick-actions">{(mode==='study'?["Spiegami la crittografia",'Fammi un quiz di Computer Security','Preparami un piano di ripasso']:["Cosa possiamo fare oggi?",'Quali impegni ho oggi?','Crea un’attività per ripassare crittografia']).map(text=><button key={text} onClick={()=>{setInput(text);}}>{text}</button>)}</div>
        </section>
        <footer><span>Voce generata dall’AI; fallback alle voci del dispositivo. </span><span><CircleHelp size={13}/> Le animazioni rappresentano una rete astratta, non il funzionamento interno del modello AI.</span><span>BUILT FOR THE FUTURE · MOBILE READY</span></footer>
      </div>
    </main>
  </div>;
}
