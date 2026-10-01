import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { z } from 'zod';
import { JsonStore } from './store.js';
import { createCalendar, eventSchema, type CalendarEvent } from './calendar.js';

const permissionsSchema = z.object({ calendarRead: z.boolean(), calendarWrite: z.boolean(), studyTasks: z.boolean() }).strict();
type Permissions = z.infer<typeof permissionsSchema>;
const taskInput = z.object({ title: z.string().trim().min(1).max(200), dueAt: z.string().datetime({ offset: true }).nullable(), notes: z.string().max(2000).default('') }).strict();
type Task = z.infer<typeof taskInput> & { id: string; done: boolean; createdAt: string };
type Proposal = { id: string; event: CalendarEvent; expiresAt: number; status: 'pending' | 'done' | 'cancelled'; result?: unknown };
type State = { permissions: Permissions; tasks: Task[]; proposals: Proposal[] };
export type Work = ReturnType<typeof createWork>;
export function createWork(dataDir: string, calendar: ReturnType<typeof createCalendar>) {
  const store = new JsonStore<State>(join(dataDir, 'workspace.json'), () => ({ permissions: { calendarRead: false, calendarWrite: false, studyTasks: false }, tasks: [], proposals: [] }));
  const router = Router();
  const active = new Map<string, Promise<unknown>>();
  async function requirePermission(key: keyof Permissions) {
    if (!(await store.read()).permissions[key]) throw new Error(`Permesso ${key} disattivato: abilitalo nel pannello Permessi.`);
  }
  router.get('/', async (_req, res) => {
    try { const state = await store.read(); res.json({ ...state, proposals: state.proposals.filter(p => p.status === 'pending' && p.expiresAt > Date.now()), google: await calendar.status() }); }
    catch { res.status(500).json({ error: 'Workspace non disponibile.' }); }
  });
  router.put('/permissions', async (req, res) => {
    const parsed = permissionsSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: 'Permessi non validi.' }); return; }
    try { const state = await store.update(s => ({ ...s, permissions: parsed.data })); res.json(state.permissions); }
    catch { res.status(500).json({ error: 'Salvataggio permessi non riuscito.' }); }
  });
  async function confirm(id: string) {
    if (active.has(id)) return active.get(id)!;
    const operation = (async () => {
      await requirePermission('calendarWrite');
      const proposal = (await store.read()).proposals.find(p => p.id === id);
      if (!proposal) throw new Error('Proposta non trovata.');
      if (proposal.status === 'done') return proposal.result;
      if (proposal.status !== 'pending' || proposal.expiresAt <= Date.now()) throw new Error('Proposta annullata o scaduta. Chiedi una nuova proposta.');
      const result = await calendar.insert(proposal.event, proposal.id.replaceAll('-', ''));
      await store.update(s => ({ ...s, proposals: s.proposals.map(p => p.id === id ? { ...p, status: 'done', result } : p) }));
      return result;
    })();
    active.set(id, operation);
    try { return await operation; } finally { active.delete(id); }
  }
  router.post('/proposals/:id/confirm', async (req, res) => {
    try { res.json({ result: await confirm(req.params.id) }); }
    catch (e) { res.status(400).json({ error: e instanceof Error ? e.message : 'Azione non riuscita.' }); }
  });
  router.post('/proposals/:id/cancel', async (req, res) => {
    if (active.has(req.params.id)) { res.status(409).json({ error: 'Creazione già in corso. Attendi il risultato.' }); return; }
    try { await store.update(s => ({ ...s, proposals: s.proposals.map(p => p.id === req.params.id && p.status === 'pending' ? { ...p, status: 'cancelled' } : p) })); res.json({ ok: true }); }
    catch { res.status(500).json({ error: 'Annullamento non riuscito.' }); }
  });
  router.post('/tasks', async (req, res) => { try { res.status(201).json(await execute('create_study_task', req.body)); } catch (e) { res.status(400).json({ error: e instanceof Error ? e.message : 'Attività non valida.' }); } });
  router.post('/tasks/:id/complete', async (req, res) => { try { res.json(await execute('complete_study_task', { id: req.params.id })); } catch { res.status(400).json({ error: 'Impossibile completare l’attività. Controlla i permessi.' }); } });

  async function execute(name: string, args: unknown): Promise<unknown> {
    if (name === 'list_calendar_events') {
      await requirePermission('calendarRead');
      const input = z.object({ start: z.string().datetime({ offset: true }), end: z.string().datetime({ offset: true }) }).strict().parse(args);
      return calendar.list(input.start, input.end);
    }
    if (name === 'propose_calendar_event') {
      await requirePermission('calendarWrite');
      if (!(await calendar.status()).connected) throw new Error('Collega prima Google Calendar.');
      const event = eventSchema.parse(args);
      const proposal: Proposal = { id: randomUUID(), event, expiresAt: Date.now() + 15 * 60000, status: 'pending' };
      await store.update(s => ({ ...s, proposals: [...s.proposals.filter(p => p.status === 'pending' && p.expiresAt > Date.now()), proposal].slice(-100) }));
      return { proposal, message: 'Solo proposta: evento NON creato. L’utente deve confermare nella scheda.' };
    }
    if (name === 'list_study_tasks') { await requirePermission('studyTasks'); return { tasks: (await store.read()).tasks }; }
    if (name === 'create_study_task') {
      await requirePermission('studyTasks');
      const input = taskInput.parse(args);
      const task: Task = { ...input, id: randomUUID(), done: false, createdAt: new Date().toISOString() };
      await store.update(s => { if (s.tasks.length >= 500) throw new Error('Limite di 500 attività raggiunto.'); return { ...s, tasks: [...s.tasks, task] }; });
      return { task };
    }
    if (name === 'complete_study_task') {
      await requirePermission('studyTasks');
      const { id } = z.object({ id: z.string().uuid() }).strict().parse(args);
      await store.update(s => { if (!s.tasks.some(t => t.id === id)) throw new Error('Attività non trovata.'); return { ...s, tasks: s.tasks.map(t => t.id === id ? { ...t, done: true } : t) }; });
      return { ok: true, id };
    }
    throw new Error('Strumento non autorizzato.');
  }
  const string = { type: 'string' };
  const tool = (name: string, description: string, properties: Record<string, unknown>, required = Object.keys(properties)) => ({ type: 'function', function: { name, description, parameters: { type: 'object', properties, required, additionalProperties: false } } });
  const definitions = [
    tool('list_calendar_events', 'Leggi fino a 50 eventi del calendario Google principale nell’intervallo. Date ISO 8601 con offset obbligatorio.', { start: string, end: string }),
    tool('propose_calendar_event', 'Prepara un evento o promemoria Google da confermare nella UI. NON crea l’evento. Chiedi dati mancanti; non inventare ora o durata.', { title: string, description: string, start: string, end: string, timeZone: string, reminderMinutes: { type: 'integer', minimum: 0, maximum: 40320 } }),
    tool('list_study_tasks', 'Leggi attività di studio salvate e relativo stato.', {}),
    tool('create_study_task', 'Salva un’attività di studio solo su richiesta dell’utente. Scadenza ISO con offset, oppure null se non specificata. Avviso locale solo con pagina aperta.', { title: string, dueAt: { type: ['string', 'null'] }, notes: string }),
    tool('complete_study_task', 'Segna completata una specifica attività su richiesta; recupera prima il suo ID con list_study_tasks.', { id: string }),
  ];
  async function tools() {
    const p = (await store.read()).permissions;
    return definitions.filter(t => t.function.name === 'list_calendar_events' ? p.calendarRead : t.function.name === 'propose_calendar_event' ? p.calendarWrite : p.studyTasks);
  }
  return { router, execute, tools, confirm };
}
