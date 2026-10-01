import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { z } from 'zod';

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '100kb' }));
app.use(cors({ origin: process.env.WEB_ORIGIN || 'http://localhost:5173' }));

const messageSchema = z.object({
  mode: z.enum(['assistant', 'study']),
  messages: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().trim().min(1).max(6000) })).min(1).max(24)
});

const assistantPrompt = `Sei JARVIS, un assistente personale in italiano: diretto, preciso, pragmatico e cordiale. Ti rivolgi all'utente come Francesco solo quando naturale. Non fingere di poter aprire programmi, accedere a mail o conoscere dati che non hai. Non eseguire azioni esterne: questa prima versione supporta solo chat. Se la richiesta richiede dati aggiornati o accesso al computer, dichiaralo. Rispondi nella lingua dell'utente.`;
const studyPrompt = `${assistantPrompt}\nMODALITÀ STUDIO: aiuti uno studente universitario di Computer Science. Fai da tutor: spiega concetti con esempi, proponi domande di verifica ed esercizi, usa progressione a piccoli passi. Quando si tratta di assignment valutati, aiuta con metodo e feedback anziché sostituirti allo studente. Chiedi il livello solo quando è davvero necessario.`;

app.get('/api/health', (_req, res) => res.json({ ok: true, configured: Boolean(process.env.OPENAI_API_KEY) }));
app.post('/api/chat', async (req, res) => {
  const parsed = messageSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'Richiesta non valida.' }); return; }
  const { mode, messages } = parsed.data;
  if (!process.env.OPENAI_API_KEY) {
    res.json({ demo: true, reply: mode === 'study'
      ? 'Modalità studio attiva. Configura OPENAI_API_KEY nel backend per spiegazioni personalizzate, quiz e ripasso. Intanto puoi esplorare la rete neurale e salvare i tuoi appunti in locale.'
      : 'Sistema operativo in modalità demo. Configura OPENAI_API_KEY nel backend per attivare la conversazione AI. Microfono, sintesi vocale e animazioni sono già disponibili nei browser compatibili.' });
    return;
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: process.env.OPENAI_MODEL || 'gpt-4.1-mini', temperature: mode === 'study' ? 0.5 : 0.7, messages: [{ role: 'system', content: mode === 'study' ? studyPrompt : assistantPrompt }, ...messages] }),
      signal: controller.signal
    });
    const result = await response.json() as { choices?: { message?: { content?: string } }[]; error?: { message?: string } };
    if (!response.ok) { console.error('AI provider error:', response.status, result.error?.message); res.status(502).json({ error: 'Il servizio AI non è disponibile. Controlla modello, crediti e chiave API.' }); return; }
    const reply = result.choices?.[0]?.message?.content;
    if (!reply) { res.status(502).json({ error: 'Risposta AI vuota.' }); return; }
    res.json({ reply, demo: false });
  } catch (error) {
    console.error('AI request failed:', error);
    res.status(504).json({ error: 'Timeout o errore di connessione al servizio AI.' });
  } finally { clearTimeout(timeout); }
});

const port = Number(process.env.PORT || 8787);
app.listen(port, () => console.log(`JARVIS API pronta su http://localhost:${port}`));
