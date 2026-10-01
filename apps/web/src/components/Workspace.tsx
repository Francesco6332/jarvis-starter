import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';

type Permissions = { calendarRead: boolean; calendarWrite: boolean; studyTasks: boolean };
type Task = { id: string; title: string; dueAt: string | null; done: boolean; notes: string };
type Proposal = { id: string; event: { title: string; description: string; start: string; end: string; timeZone: string; reminderMinutes: number } };
type State = { permissions: Permissions; tasks: Task[]; proposals: Proposal[]; google: { configured: boolean; connected: boolean } };
const labels: Record<keyof Permissions, string> = { calendarRead: 'Leggere eventi Google Calendar', calendarWrite: 'Proporre eventi e promemoria (con conferma)', studyTasks: 'Gestire attività di studio locali' };
const format = (date: string, timeZone = 'Europe/Rome') => new Date(date).toLocaleString('it-IT', { timeZone, dateStyle: 'medium', timeStyle: 'short' });
export function Workspace({ revision, onResult }: { revision: number; onResult: (message: string) => void }) {
  const [state, setState] = useState<State | null>(null);
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [title, setTitle] = useState(''), [due, setDue] = useState('');
  const [notifications, setNotifications] = useState(false);
  const notified = useRef(new Set<string>());
  async function refresh() { try { setState(await api<State>('/api/workspace')); } catch (e) { setError((e as Error).message); } }
  useEffect(() => { void refresh(); }, [revision]);
  useEffect(() => {
    const timer = setInterval(() => { void refresh(); }, 30000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!notifications || !state || !('Notification' in window) || Notification.permission !== 'granted') return;
    for (const task of state.tasks) {
      if (!task.done && task.dueAt && Date.parse(task.dueAt) <= Date.now() && !notified.current.has(task.id)) {
        notified.current.add(task.id); new Notification('JARVIS · Promemoria studio', { body: task.title, tag: task.id });
      }
    }
  }, [state, notifications]);
  async function action(job: () => Promise<unknown>) {
    if (busy) return; setBusy(true); setError('');
    try { await job(); await refresh(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  if (!state) return <section className="work-panel">{error || 'Caricamento strumenti…'}</section>;
  return <section className="work-panel" aria-label="Permessi e attività">
    <div className="section-heading">PERMESSI E ATTIVITÀ <a href="https://calendar.google.com/calendar/u/0/r" target="_blank" rel="noreferrer">Apri Google Calendar ↗</a></div>
    <p>Decidi cosa può usare JARVIS. Gli eventi Google vengono creati solo dopo la tua conferma.</p>
    <div className="permission-grid">{(Object.keys(labels) as (keyof Permissions)[]).map(key => <label key={key}><input type="checkbox" checked={state.permissions[key]} disabled={busy} onChange={e => { const permissions = { ...state.permissions, [key]: e.target.checked }; void action(() => api('/api/workspace/permissions', { method: 'PUT', body: JSON.stringify(permissions) })); }}/>{labels[key]}</label>)}</div>
    <div className="work-actions"><span>Google: {state.google.connected ? 'collegato' : state.google.configured ? 'da collegare' : 'configurazione necessaria'}</span>
      <button disabled={busy} className="secondary-button" onClick={() => void action(async () => {
        if (state.google.connected) await api('/api/google/disconnect', { method: 'POST' });
        else { const result = await api<{ url: string }>('/api/google/connect', { method: 'POST' }); window.location.assign(result.url); }
      })}>{state.google.connected ? 'Scollega Google' : 'Collega Google'}</button>
      <button disabled={notifications} className="secondary-button" onClick={async () => {
        if (!('Notification' in window)) { setError('Notifiche non supportate.'); return; }
        const permission = await Notification.requestPermission(); setNotifications(permission === 'granted');
        if (permission !== 'granted') setError('Notifiche non autorizzate nel browser.');
      }}>{notifications ? 'Avvisi locali attivi' : 'Abilita avvisi locali'}</button>
    </div>
    {!state.google.configured && <small>Inserisci le credenziali OAuth Google in apps/api/.env. Guida: docs/GOOGLE_CALENDAR.md.</small>}
    {error && <p role="alert" className="work-error">{error}</p>}
    {state.proposals.map(p => <article className="proposal-card" key={p.id}>
      <strong>Da confermare: {p.event.title}</strong>
      <p>{format(p.event.start, p.event.timeZone)} → {format(p.event.end, p.event.timeZone)} · {p.event.timeZone}</p>
      <p>{p.event.description}</p><small>Avviso Google {p.event.reminderMinutes} minuti prima · Calendario principale</small>
      <div className="work-actions"><button className="secondary-button" disabled={busy || !state.permissions.calendarWrite} onClick={() => void action(async () => {
        await api(`/api/workspace/proposals/${p.id}/confirm`, { method: 'POST' }); onResult(`Evento confermato e salvato su Google Calendar: ${p.event.title}, ${format(p.event.start, p.event.timeZone)}.`);
      })}>Conferma e crea evento</button><button className="secondary-button" disabled={busy} onClick={() => void action(() => api(`/api/workspace/proposals/${p.id}/cancel`, { method: 'POST' }))}>Annulla</button></div>
    </article>)}
    <h3>Attività di studio</h3>
    <form className="task-form" onSubmit={e => { e.preventDefault(); void action(async () => { await api('/api/workspace/tasks', { method: 'POST', body: JSON.stringify({ title, dueAt: due ? new Date(due).toISOString() : null, notes: '' }) }); setTitle(''); setDue(''); }); }}>
      <input aria-label="Attività di studio" placeholder="Es. Ripassare crittografia" maxLength={200} value={title} onChange={e => setTitle(e.target.value)}/>
      <label>Scadenza (ora del dispositivo)<input aria-label="Scadenza attività" type="datetime-local" value={due} onChange={e => setDue(e.target.value)}/></label>
      <button className="secondary-button" disabled={busy || !title.trim() || !state.permissions.studyTasks}>Aggiungi</button>
    </form>
    <div className="task-list">{state.tasks.filter(t => !t.done).map(t => <div key={t.id}><div><strong>{t.title}</strong><small>{t.dueAt ? format(t.dueAt) : 'Senza scadenza'}{t.notes ? ` · ${t.notes}` : ''}</small></div><button disabled={busy || !state.permissions.studyTasks} className="secondary-button" onClick={() => void action(() => api(`/api/workspace/tasks/${t.id}/complete`, { method: 'POST' }))}>Fatto</button></div>)}</div>
    <small>Gli avvisi locali funzionano mentre JARVIS è aperto (controllo ogni 30 secondi). Per avvisi anche a pagina chiusa usa un evento Google e abilita le notifiche sul dispositivo.</small>
  </section>;
}
