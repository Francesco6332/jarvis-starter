import { useEffect, useRef, useState } from 'react';
import { Activity, ArrowUp, BookOpen, BrainCircuit, Check, ChevronRight, CircleHelp, Cpu, GraduationCap, Menu, Mic, MicOff, Plus, Settings2, Power, Trash2, Save, Sparkles, Volume2, VolumeX, X } from 'lucide-react';
import { NeuralCore, type CoreMode } from './components/NeuralCore';
import { Workspace } from './components/Workspace';
import { Conversation } from './components/Conversation';
import { apiFetch, consumeEvents } from './lib/api';
import { VoiceQueue, takeSpeechChunks } from './lib/voice';
import { WakeWord, recognitionClass, type Recognition, type WakeStatus } from './lib/wake';

type Mode = 'assistant' | 'study';
type Memory = { id: string; content: string; createdAt: string };
type Message = { id: string; role: 'user' | 'assistant'; content: string };
const storageKey = 'jarvis-v1-messages';
function salutation() { const hour = new Date().getHours(); return hour < 12 ? 'Buongiorno' : hour < 18 ? 'Buon pomeriggio' : 'Buonasera'; }
const welcome = (): Message => ({ id: `welcome-${crypto.randomUUID()}`, role: 'assistant', content: `${salutation()}, Francesco. Sono JARVIS. Il nucleo neurale è attivo: chiamami per nome oppure scrivimi. Da dove iniziamo?` });
function loadMessages(): Message[] {
  try {
    const saved = (JSON.parse(localStorage.getItem(storageKey) || '[]') as Message[]).filter(m => m.content?.trim());
    return saved.length ? saved : [welcome()];
  } catch { return [welcome()]; }
}
function readFlag(key: string, fallback: boolean) { try { const v = localStorage.getItem(key); return v === null ? fallback : v === '1'; } catch { return fallback; } }
function writeFlag(key: string, value: boolean) { try { localStorage.setItem(key, value ? '1' : '0'); } catch { /* storage unavailable */ } }

export default function App() {
  const [conversation, setConversation] = useState<{ prompt: string; key: number } | null>(null);
  const [mode, setMode] = useState<Mode>('assistant');
  const [messages, setMessages] = useState<Message[]>(loadMessages);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [dictating, setDictating] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [voiceOutput, setVoiceOutput] = useState(true);
  const [wakeStatus, setWakeStatus] = useState<WakeStatus>('off');
  const [briefing, setBriefing] = useState(() => readFlag('jarvis-briefing', true));
  const [memoryVisible, setMemoryVisible] = useState(false);
  const [memoryText, setMemoryText] = useState('');
  const [memories, setMemories] = useState<Memory[]>([]);
  const [voiceError, setVoiceError] = useState('');
  const [workspaceRevision, setWorkspaceRevision] = useState(0);
  const [toolStatus, setToolStatus] = useState('');
  const [shareNotes, setShareNotes] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [notes, setNotes] = useState(() => localStorage.getItem('jarvis-study-notes') ?? '');
  const [notesVisible, setNotesVisible] = useState(false);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const voiceOutputRef = useRef(true);
  const voiceQueue = useRef<VoiceQueue | null>(null);
  const wake = useRef<WakeWord | null>(null);
  const onWakeRef = useRef<(rest: string) => void>(() => {});
  const configuredRef = useRef(false);
  const conversationRef = useRef(false);
  const speakingRef = useRef(false);
  const dictationRef = useRef<Recognition | null>(null);
  const dictationStarted = useRef(false);
  const chatAbort = useRef<AbortController | null>(null);
  const loadingRef = useRef(false);
  const greetingIndexRef = useRef(0);
  const messagesBox = useRef<HTMLDivElement>(null);
  // Scroll only the chat box: scrollIntoView would also drag the whole page down on load and on every token.
  useEffect(() => { const box = messagesBox.current; if (box) box.scrollTop = box.scrollHeight; }, [messages, loading]);
  useEffect(() => { if (!loading) try { localStorage.setItem(storageKey, JSON.stringify(messages.filter(m => m.content.trim()).slice(-200))); } catch { /* storage full */ } }, [messages, loading]);
  useEffect(() => { localStorage.setItem('jarvis-study-notes', notes); }, [notes]);
  useEffect(() => { fetch('/api/memory').then(r => r.json()).then(d => setMemories(d.memories || [])).catch(() => setVoiceError('Memoria non disponibile: il backend è avviato?')); }, []);
  useEffect(() => { fetch('/api/health').then(r => r.json()).then(d => { configuredRef.current = Boolean(d.configured); setConfigured(Boolean(d.configured)); }).catch(() => setConfigured(false)); }, []);
  useEffect(() => {
    const engine = new WakeWord(rest => onWakeRef.current(rest), setWakeStatus, message => { writeFlag('jarvis-wake', false); setVoiceError(message); });
    wake.current = engine;
    // Microphone permission on localhost persists, so a previously enabled wake word resumes on reload.
    if (readFlag('jarvis-wake', false) && WakeWord.supported()) engine.start();
    return () => { engine.stop(); dictationRef.current?.abort(); chatAbort.current?.abort(); voiceQueue.current?.stop(); };
  }, []);
  if (!voiceQueue.current) voiceQueue.current = new VoiceQueue(active => {
    speakingRef.current = active; setSpeaking(active);
    // Pause the wake word while JARVIS talks, otherwise it can hear its own name.
    if (active) wake.current?.pause(); else resumeWake();
  }, setVoiceError, () => configuredRef.current);
  function resumeWake() { if (!conversationRef.current && !speakingRef.current && !dictationRef.current) wake.current?.resume(); }
  function stopAudio() { voiceQueue.current?.stop(); }
  function speak(text: string) {
    if (!voiceOutputRef.current) return;
    stopAudio();
    for (const chunk of takeSpeechChunks(text, true).chunks) voiceQueue.current?.enqueue(chunk);
  }
  function greet() {
    const choices = [`${salutation()}, Francesco! Come va oggi?`, `${salutation()}, Francesco. Oggi che facciamo?`, `${salutation()}, Francesco. Vuoi sapere quali attività hai da fare oggi?`];
    const greeting = choices[greetingIndexRef.current++ % choices.length];
    setMessages(old => [...old, { id: crypto.randomUUID(), role: 'assistant', content: greeting }]);
    speak(greeting);
  }
  function openConversation(prompt = '') {
    if (!configuredRef.current) { setVoiceError('La conversazione vocale richiede OPENAI_API_KEY in apps/api/.env.'); return; }
    conversationRef.current = true; wake.current?.pause();
    dictationRef.current?.abort(); dictationRef.current = null; setDictating(false);
    chatAbort.current?.abort(); stopAudio(); setSidebarOpen(false);
    setConversation({ prompt, key: Date.now() });
  }
  function closeConversation() { conversationRef.current = false; setConversation(null); resumeWake(); }
  onWakeRef.current = rest => {
    if (conversationRef.current) return;
    if (configuredRef.current) { openConversation(rest); return; }
    // Demo mode has no Realtime voice: fall back to the text chat and device voice.
    if (rest) void send(rest); else greet();
    setTimeout(resumeWake, 0);
  };
  function toggleWake() {
    const engine = wake.current; if (!engine) return;
    if (engine.enabled) { engine.stop(); writeFlag('jarvis-wake', false); return; }
    setVoiceError('');
    if (engine.start()) { writeFlag('jarvis-wake', true); if (speakingRef.current || dictationRef.current) engine.pause(); }
  }
  async function addMemory(content = memoryText) {
    const value = content.trim(); if (!value) return false;
    try { const r = await apiFetch('/api/memory', { method: 'POST', body: JSON.stringify({ content: value }) }); if (!r.ok) throw Error('Salvataggio non riuscito'); const data = await r.json() as { memory: Memory }; setMemories(old => [...old, data.memory]); setMemoryText(''); return true; }
    catch { setVoiceError('Impossibile salvare la memoria.'); return false; }
  }
  async function removeMemory(id: string) {
    try { const r = await apiFetch(`/api/memory/${encodeURIComponent(id)}`, { method: 'DELETE' }); if (!r.ok) throw Error(); setMemories(old => old.filter(x => x.id !== id)); }
    catch { setVoiceError('Impossibile eliminare la memoria.'); }
  }

  async function send(text = input) {
    const content = text.trim(); if (!content || loadingRef.current) return;
    loadingRef.current = true; setLoading(true); setToolStatus('');
    stopAudio();
    try {
      if (/^ricorda\s+che\b/i.test(content) && !(await addMemory(content.replace(/^ricorda\s+che\s*/i, '')))) return;
      const userMessage: Message = { id: crypto.randomUUID(), role: 'user', content };
      const replyId = crypto.randomUUID();
      const history = [...messages.filter(m => !m.id.startsWith('welcome') && m.content.trim()), userMessage].slice(-24);
      setMessages(old => [...old, userMessage, { id: replyId, role: 'assistant', content: '' }]); setInput('');
      const controller = new AbortController(); chatAbort.current = controller;
      let speechBuffer = '';
      try {
        const response = await apiFetch('/api/chat/stream', { method: 'POST', signal: controller.signal, body: JSON.stringify({ mode, messages: history.map(({ role, content }) => ({ role, content: content.slice(0, 12000) })), voice: voiceOutputRef.current, studyContext: mode === 'study' && shareNotes ? notes.slice(0, 30000) : undefined }) });
        await consumeEvents(response, event => {
          if (event.type === 'delta') {
            setToolStatus(''); setMessages(old => old.map(m => m.id === replyId ? { ...m, content: m.content + event.text } : m));
            if (voiceOutputRef.current) { speechBuffer += event.text; const result = takeSpeechChunks(speechBuffer); speechBuffer = result.rest; for (const chunk of result.chunks) voiceQueue.current?.enqueue(chunk); } else speechBuffer = '';
          }
          if (event.type === 'tool') setToolStatus('Sto utilizzando gli strumenti autorizzati…');
          if (event.type === 'workspace' || event.type === 'proposal') setWorkspaceRevision(v => v + 1);
        });
        if (voiceOutputRef.current) for (const chunk of takeSpeechChunks(speechBuffer, true).chunks) voiceQueue.current?.enqueue(chunk);
      } catch (error) {
        stopAudio();
        const message = controller.signal.aborted ? 'Risposta interrotta.' : `Errore: ${error instanceof Error ? error.message : 'connessione non disponibile'}`;
        setMessages(old => old.map(m => m.id === replyId ? { ...m, content: m.content + (m.content ? '\n\n' : '') + message } : m));
      } finally { if (chatAbort.current === controller) chatAbort.current = null; }
    } finally { loadingRef.current = false; setLoading(false); setToolStatus(''); }
  }
  function toggleDictation() {
    if (dictationRef.current) {
      // Once started, stop() delivers the final words and onend gives the microphone back; before that, just cancel.
      if (dictationStarted.current) dictationRef.current.stop();
      else { dictationRef.current = null; setDictating(false); resumeWake(); }
      return;
    }
    const Ctor = recognitionClass();
    if (!Ctor) { setVoiceError('Riconoscimento vocale non disponibile in questo browser. Prova Chrome o Edge su desktop, oppure usa la tastiera.'); return; }
    // The browser allows a single recognizer: lend the microphone from the wake word and give it back afterwards.
    const lending = wakeStatus === 'listening';
    wake.current?.pause();
    const rec = new Ctor(); rec.lang = 'it-IT'; rec.interimResults = false; rec.continuous = false; rec.maxAlternatives = 1;
    const finish = () => { if (dictationRef.current === rec) { dictationRef.current = null; setDictating(false); resumeWake(); } };
    rec.onresult = event => { const transcript = event.results[0]?.[0]?.transcript; if (transcript) setInput(old => old ? `${old} ${transcript}` : transcript); };
    rec.onerror = event => { if (event.error === 'not-allowed') setVoiceError('Permesso microfono negato.'); };
    rec.onstart = () => { dictationStarted.current = true; };
    rec.onend = finish;
    dictationRef.current = rec; dictationStarted.current = false; setDictating(true);
    const begin = () => { if (dictationRef.current !== rec) return; try { rec.start(); } catch { finish(); } };
    // Starting while the wake recognizer is still shutting down makes Chrome end the dictation at once.
    if (lending) setTimeout(begin, 400); else begin();
  }
  function clearChat() { chatAbort.current?.abort(); setMessages([welcome()]); stopAudio(); setSidebarOpen(false); }
  function changeMode(next: Mode) { setMode(next); setSidebarOpen(false); }
  const wakeOn = wakeStatus !== 'off';
  const coreMode: CoreMode = loading ? 'thinking' : speaking ? 'speaking' : dictating || wakeStatus === 'listening' ? 'listening' : 'idle';
  const engineState = loading ? 'PROCESSING' : speaking ? 'SPEAKING' : dictating ? 'DICTATION' : wakeStatus === 'listening' ? 'WAKE WORD ACTIVE' : wakeOn ? 'WAKE WORD PAUSED' : 'STANDBY';
  const [coreTitle, coreSubtitle] = loading ? ['THINKING', 'ELABORAZIONE'] : speaking ? ['SPEAKING', 'RISPOSTA VOCALE'] : dictating ? ['LISTENING', 'DETTATURA'] : wakeStatus === 'listening' ? ['JARVIS', 'DÌ «JARVIS» PER PARLARMI'] : ['JARVIS', configured ? 'TOCCA PER PARLARE' : 'NEURAL CORE ONLINE'];
  const wakeHint = !WakeWord.supported() ? 'La wake word funziona su Chrome o Edge desktop.'
    : wakeStatus === 'listening' ? (configured ? 'Dì «Jarvis» (anche con una domanda): si apre la conversazione.' : 'Dì «Jarvis»: risponderò in chat (modalità demo).')
    : wakeOn ? 'Ascolto in pausa mentre il microfono è in uso.' : 'Attiva «Jarvis» per chiamarmi a voce mentre questa scheda è aperta.';
  return <div className="app-shell">
    {conversation && <Conversation key={conversation.key} mode={mode} briefing={briefing} prompt={conversation.prompt} studyContext={mode === 'study' && shareNotes ? notes.slice(0, 30000) : ''} onClose={closeConversation} onWorkspace={() => setWorkspaceRevision(v => v + 1)} onTranscript={(role, content) => setMessages(old => [...old, { id: crypto.randomUUID(), role, content }])}/>}
    <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
      <div className="brand"><div className="brand-mark"><BrainCircuit size={23}/></div><div><strong>J.A.R.V.I.S.</strong><small>PERSONAL AI SYSTEM</small></div><button className="icon-button mobile-close" onClick={() => setSidebarOpen(false)} aria-label="Chiudi menu"><X size={20}/></button></div>
      <div className="sidebar-label">WORKSPACE</div>
      <nav className="navigation">
        <button className={mode === 'assistant' ? 'nav-item selected' : 'nav-item'} onClick={() => changeMode('assistant')}><Cpu size={18}/> Assistente <ChevronRight size={15}/></button>
        <button className={mode === 'study' ? 'nav-item selected' : 'nav-item'} onClick={() => changeMode('study')}><GraduationCap size={18}/> Studio <ChevronRight size={15}/></button>
      </nav>
      <div className="sidebar-label tools-label">IL TUO SISTEMA</div>
      <div className="feature-list"><div><Activity size={15}/> Nucleo neurale <span className="online-dot"/></div><div><Mic size={15}/> Wake word <span className={wakeStatus === 'listening' ? 'online-dot' : 'offline-dot'}/></div><button className="feature-button" onClick={() => setMemoryVisible(v => !v)}><BrainCircuit size={15}/> Memoria ({memories.length}) <ChevronRight size={14}/></button><a className="feature-button" href="#workspace-tools" onClick={() => setSidebarOpen(false)}><Settings2 size={15}/> Permessi e attività</a></div>
      <div className="sidebar-bottom"><div className="profile-avatar">F</div><div><strong>Francesco</strong><small>Personal workspace</small></div><span className="profile-online"/></div>
    </aside>
    {sidebarOpen && <button aria-label="Chiudi menu" className="sidebar-overlay" onClick={() => setSidebarOpen(false)}/>}
    <main className="main-area">
      <header className="topbar"><button className="icon-button menu-button" onClick={() => setSidebarOpen(true)} aria-label="Apri menu"><Menu size={22}/></button><div className="breadcrumb">SYSTEM <span>/</span> <strong>{mode === 'assistant' ? 'ASSISTANT' : 'STUDY LAB'}</strong></div><div className="topbar-right"><span className={`status-pill ${configured ? 'ready' : 'demo'}`}><span className="online-dot"/>{configured ? 'AI CONFIGURED' : 'DEMO MODE'}</span><button className="icon-button" title="Nuova conversazione" onClick={clearChat} aria-label="Nuova conversazione"><Plus size={20}/></button></div></header>
      <div className="workspace">
        <section className={`hero core-${coreMode}`} aria-label="Nucleo neurale di JARVIS">
          <div className="hero-top"><span><span className="square"/> NEURAL ENGINE / V.05</span><span className="engine-state">{engineState} <span className="blink"/></span></div>
          <div className="neural-wrap"><div className="target-circle target-one"/><div className="target-circle target-two"/><NeuralCore mode={coreMode}/>
            <button className="neural-center-label" onClick={() => openConversation()} disabled={!configured} aria-label="Avvia la conversazione vocale"><strong>{coreTitle}</strong><span>{coreSubtitle}</span></button></div>
          <div className="hero-bottom"><span>● {mode === 'study' ? 'LEARNING PROTOCOL' : 'PERSONAL ASSISTANT'}</span><span>110 NODES · LIVE VISUALIZATION</span></div>
        </section>
        <div className="voice-dock">
          <button className="dock-primary" onClick={() => openConversation()} disabled={!configured}><Mic size={17}/> Parla con JARVIS</button>
          <button className={`dock-toggle ${wakeOn ? 'on' : ''}`} onClick={toggleWake} aria-pressed={wakeOn}><Power size={16}/>{wakeOn ? 'Ascolto «Jarvis» attivo' : 'Attiva «Jarvis»'}{wakeStatus === 'listening' && <span className="dock-live"/>}</button>
          <label className="dock-check"><input type="checkbox" checked={briefing} onChange={e => { setBriefing(e.target.checked); writeFlag('jarvis-briefing', e.target.checked); }}/> Briefing impegni all’avvio</label>
          <span className="dock-hint">{wakeHint}</span>
        </div>
        {voiceError && <div className="voice-error" role="alert">{voiceError}<button onClick={() => setVoiceError('')} aria-label="Chiudi avviso"><X size={16}/></button></div>}
        <details id="workspace-tools" className="tools-disclosure" open><summary>Google Calendar · Permessi · Attività di studio</summary><Workspace revision={workspaceRevision} onResult={content => { chatAbort.current?.abort(); setMessages(old => [...old, { id: crypto.randomUUID(), role: 'assistant', content }]); if (!loadingRef.current) speak(content); }}/></details>
        {memoryVisible && <section className="notes-panel memory-panel"><div className="section-heading"><BrainCircuit size={17}/> MEMORIA DI JARVIS <span>{memories.length} ricordi</span></div><p>Salva solo ciò che vuoi che JARVIS ricordi. Scrivi anche in chat «Ricorda che...» o diglielo a voce. Puoi eliminare ogni ricordo.</p><form onSubmit={e => { e.preventDefault(); void addMemory(); }} className="memory-form"><input value={memoryText} maxLength={500} onChange={e => setMemoryText(e.target.value)} placeholder="Es. Studio Computer Science all'università"/><button type="submit" className="secondary-button" disabled={!memoryText.trim()}><Save size={16}/> Ricorda</button></form><div className="memory-items">{memories.map(m => <div key={m.id} className="memory-item"><span>{m.content}</span><button aria-label="Elimina ricordo" title="Elimina ricordo" onClick={() => void removeMemory(m.id)}><Trash2 size={16}/></button></div>)}</div><small>Memoria privata locale al backend, non ancora sincronizzata tra dispositivi.</small></section>}
        <div className="content-title"><div><span className="eyebrow">{mode === 'study' ? 'ACADEMIC INTERFACE' : 'COMMAND CENTER'}</span><h1>{mode === 'study' ? 'Study Lab' : 'Bentornato, Francesco.'}</h1><p>{mode === 'study' ? 'Spiegazioni, esercizi e ripasso: il tuo tutor AI sempre disponibile.' : 'Il tuo assistente personale è pronto. Parla, scrivi o esplora le funzionalità.'}</p></div>{mode === 'study' && <button className="secondary-button" onClick={() => setNotesVisible(s => !s)}><BookOpen size={16}/> {notesVisible ? 'Chiudi appunti' : 'I miei appunti'}</button>}</div>
        {notesVisible && mode === 'study' && <section className="notes-panel"><div className="section-heading"><BookOpen size={17}/> APPUNTI PERSONALI <span><Check size={14}/> Salvati sul dispositivo</span></div><label className="share-notes"><input type="checkbox" checked={shareNotes} onChange={e => setShareNotes(e.target.checked)}/> Condividi questi appunti con l’AI nelle richieste Studio</label><label className="study-upload">Importa materiale .txt / .md (max 30.000 caratteri)<input type="file" accept=".txt,.md,text/plain,text/markdown" onChange={async e => { const input = e.target, file = input.files?.[0]; if (!file) return; input.value = ''; if (file.size > 150000) { setVoiceError('File troppo grande. Usa un estratto di massimo 30.000 caratteri.'); return; } const text = await file.text(); if (text.length > 30000) { setVoiceError('Materiale troppo lungo: massimo 30.000 caratteri.'); return; } setNotes(text); setShareNotes(false); }}/></label><textarea maxLength={30000} aria-label="Appunti di studio" placeholder="Scrivi qui i tuoi appunti. Si salvano automaticamente su questo dispositivo..." value={notes} onChange={event => setNotes(event.target.value)}/></section>}
        <section className="chat-panel" aria-label="Chat con JARVIS"><div className="section-heading"><Sparkles size={17}/> {mode === 'study' ? 'SESSIONE DI STUDIO' : 'CONVERSAZIONE'} <span> <span className="chat-live"/> LIVE</span></div>
          <div className="messages" ref={messagesBox} aria-live="polite">{messages.map(message => <div className={`message ${message.role}`} key={message.id}><div className="message-avatar">{message.role === 'assistant' ? <BrainCircuit size={17}/> : 'F'}</div><div className="message-body"><div className="message-name">{message.role === 'assistant' ? 'JARVIS' : 'TU'}</div>{message.content ? <p>{message.content}</p> : <><div className="typing"><i/><i/><i/></div>{toolStatus && <small>{toolStatus}</small>}</>}</div></div>)}</div>
          <form className="composer" onSubmit={event => { event.preventDefault(); void send(); }}><button type="button" aria-label={dictating ? 'Interrompi dettatura' : 'Dettatura vocale'} title="Dettatura vocale" className={`mic-button ${dictating ? 'is-listening' : ''}`} onClick={toggleDictation}>{dictating ? <MicOff size={20}/> : <Mic size={20}/>}</button><input value={input} onChange={event => setInput(event.target.value)} aria-label="Scrivi un messaggio" placeholder={mode === 'study' ? 'Chiedimi di spiegarti un argomento...' : 'Scrivi un comando o fai una domanda...'} maxLength={6000}/><button type="button" className={`voice-button ${voiceOutput ? 'enabled' : ''}`} onClick={() => { voiceOutputRef.current = !voiceOutputRef.current; setVoiceOutput(voiceOutputRef.current); stopAudio(); }} title={voiceOutput ? 'Disattiva la voce' : 'Attiva le risposte vocali'} aria-label={voiceOutput ? 'Disattiva risposte vocali' : 'Attiva risposte vocali'}>{voiceOutput ? <Volume2 size={20}/> : <VolumeX size={20}/>}</button><button type="button" className="voice-button" disabled={!loading && !speaking} onClick={() => { chatAbort.current?.abort(); stopAudio(); }} title="Interrompi risposta e voce" aria-label="Interrompi risposta e voce"><X size={18}/></button><button type="submit" className="send-button" disabled={!input.trim() || loading} aria-label="Invia"><ArrowUp size={20}/></button></form>
          <div className="quick-actions">{(mode === 'study' ? ['Spiegami la crittografia', 'Fammi un quiz di Computer Security', 'Preparami un piano di ripasso'] : ['Cosa possiamo fare oggi?', 'Quali impegni ho oggi?', 'Crea un’attività per ripassare crittografia']).map(text => <button key={text} disabled={loading} onClick={() => void send(text)}>{text}</button>)}</div>
        </section>
        <footer><span>Voce generata dall’AI; fallback alle voci del dispositivo. </span><span><CircleHelp size={13}/> Le animazioni rappresentano una rete astratta, non il funzionamento interno del modello AI.</span><span>BUILT FOR THE FUTURE · MOBILE READY</span></footer>
      </div>
    </main>
  </div>;
}
