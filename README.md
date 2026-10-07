# J.A.R.V.I.S. — Personal AI (v0.5)

Prototipo funzionante con **React + TypeScript + Vite** e un backend **Node.js + Express**. Ha una rete neurale astratta animata su Canvas, chat, modalità studio, appunti locali, dettatura (nei browser compatibili) e risposta vocale opzionale.

## Avvio

Prerequisiti: Node.js 20+ e npm.

```bash
npm install
# Crea apps/api/.env e inserisci OPENAI_API_KEY=la_tua_chiave
npm run dev
```

Apri `http://localhost:5173`. Se non inserisci la chiave API, l'interfaccia funziona in **modalità demo** e il server risponde con messaggi dimostrativi.

Crea il file `.env` con il tuo editor senza sovrascrivere eventuali impostazioni esistenti.

## Sicurezza e privacy

- La chiave API rimane **solo nel backend**. Non inserirla in Vite, React o nella repository.
- Le chat e gli appunti sono **locali al browser** (`localStorage`); non sono sincronizzati tra dispositivi. Per dati sensibili e sincronizzazione implementare login, crittografia e database in una release successiva.
- Questa release **non ha accesso al computer** e **non esegue comandi**. Le automazioni arriveranno solo con una allowlist di strumenti e conferma esplicita prima di operazioni importanti.
- Il riconoscimento vocale usa la Web Speech API quando supportata: a seconda del browser l'audio può essere elaborato dai servizi del fornitore. La sintesi vocale usa OpenAI con voce `onyx`; in caso di errore può usare una voce del browser, non necessariamente maschile.
- La rete neurale è una **visualizzazione artistica astratta**: non rappresenta i pesi o il ragionamento interno del modello AI.
- Prima di esporre il backend su Internet: aggiungere autenticazione, rate limiting, persistenza sicura e controllo dei costi.

## Struttura

```text
apps/
  web/          React, TypeScript, Vite, Canvas neurale, UI mobile responsive
  api/          Express, endpoint /api/chat, chiave AI sul server
packages/
  shared/       Riservato a schemi e API condivise per web + futura app mobile
```

## Roadmap mobile

1. Fase 1: web responsive (questa release), interfaccia adattabile al telefono; accesso mobile al backend da configurare in una fase successiva.
2. Fase 2: spostare tipi, client API e logica condivisa in `packages/shared`.
3. Fase 3: creare `apps/mobile` con Expo / React Native; riusare backend e logica, realizzare l'interfaccia mobile nativa e notifiche push.
4. Fase 4: autenticazione, database per chat/appunti sincronizzati, eventuale app desktop Electron.

## Studio

Il tutor AI può spiegare concetti e fare quiz, ma non conosce automaticamente il materiale dei corsi. Per supportare PDF, slide e dispense personali servono caricamento file, estrazione testo e ricerca nei documenti con riferimenti alle fonti (futura fase RAG).

## Verifiche

`npm run typecheck` e `npm run build`.

## v0.2 — Voce, risveglio e memoria

- **Voce AI**: `POST /api/speech`, modello `gpt-4o-mini-tts`, voce `onyx`, istruzioni per voce italiana maschile naturale. Audio MP3 dal backend; fallback alla voce italiana del browser, che non è necessariamente maschile. La voce generata è artificiale.
- **Wake word sperimentale**: attiva dall'interfaccia «Hey Jarvis», poi pronuncia «Ciao Jarvis», «Buongiorno Jarvis», «Buonasera Jarvis», «Hey Jarvis» oppure «Jarvis». Dopo il riconoscimento si attiva il nucleo e viene pronunciato uno dei saluti variabili. Funziona solo mentre la pagina è aperta e il browser consente il microfono; usa la Web Speech API (eventuale trascrizione cloud del vendor browser). Non è sempre in ascolto con PC bloccato/scheda chiusa. Per quello servirà un servizio desktop e wake-word locale.
- **Primo cervello persistente**: `GET/POST /api/memory`, `DELETE /api/memory/:id`, file JSON locale al server (mono-utente). Puoi aggiungere ricordi dalla sezione Memoria o con «Ricorda che ...». I ricordi vengono inseriti come contesto nella chat. NON è addestramento di neuroni o modifica dei pesi AI: il grafo animato è una visualizzazione; per una rete conoscitiva reale, aggiungere grafo indicizzato e recupero semantico.
- **Skills**: `GET /api/skills` espone registro capacità e stato; tool esterni, automazioni e sincronizzazione multi-dispositivo rimangono disattivati.
- **Privacy**: la memoria sul backend viene salvata nel percorso `apps/api/data/memory.json`, escluso da Git. Non esporre l'API su Internet: attualmente NON c'è autenticazione utente. Non avviare contemporaneamente più istanze dell'API sullo stesso archivio.
- **Importante**: disattivare l'ascolto se non necessario; il browser può inviare l'audio a servizi di trascrizione. L'audio AI generato è a consumo secondo tariffe OpenAI.

## Esecuzione locale

Il backend ascolta solo su `127.0.0.1`: questa versione è mono-utente e non autenticata. Non pubblicare il proxy Vite su Internet. Le scritture della memoria sono serializzate nella singola istanza per evitare perdita di ricordi con richieste contemporanee.

## v0.3 — Google Calendar, studio e risposta progressiva

- Apri **Permessi e attività**: collega Google, abilita separatamente gli strumenti e conferma le proposte di eventi nella scheda. Configurazione completa in [docs/GOOGLE_CALENDAR.md](docs/GOOGLE_CALENDAR.md).
- Le attività di studio possono essere create e completate dalla chat o dal pannello, con persistenza locale e avvisi browser mentre la pagina è aperta.
- In **Studio → I miei appunti**, importa un testo `.txt`/`.md` o incolla un estratto (massimo 30.000 caratteri), quindi attiva la condivisione per usarlo come contesto. Puoi chiedere spiegazioni, quiz e un piano di ripasso. Non c’è ancora estrazione PDF, ricerca semantica o sincronizzazione.
- La chat arriva progressivamente via SSE. La voce `onyx` viene generata per brevi frasi, con preparazione anticipata della successiva: può iniziare prima che la risposta sia completa. Questa modalità testuale con TTS è distinta dalla conversazione Realtime v0.4; usa **Interrompi risposta e voce** per fermarla. La latenza reale dipende dalla connessione e dai servizi AI e va misurata sul dispositivo.
- Senza chiave API si usa il fallback vocale del browser, evitando richieste TTS in errore. Le voci disponibili sul dispositivo non sono necessariamente maschili.
- Backend locale con controllo Host/Origin e header anti-CSRF sulle scritture. I token restano sul server, fuori da Git; sul disco sono in chiaro. Non è un sistema multi-utente o pronto per Internet.
- La correzione `.env` risolve il percorso rispetto al pacchetto API, sia in `src` che in `dist`, e stampa una diagnosi senza la chiave.

Verifiche: `npm run typecheck`, `npm run build`, `npm test`. I test simulano Google/OpenAI e verificano permessi, OAuth, proposte, idempotenza, persistenza e streaming. Il collegamento reale richiede credenziali e consenso sul tuo computer.

## v0.4 — Conversazione continua, memoria e ricerca web

Apri **Conversazione continua** per attivare l’ascolto della parola “Jarvis”. La sessione vocale parte solo dopo il richiamo e si chiude con frasi come “possiamo finire qui”. Può salvare ricordi espliciti, cercare notizie e fonti aggiornate, consigliare articoli e preparare un resoconto della giornata. Sessioni di massimo 10 minuti con pagina aperta; ricerca e voce consumano credito API. Configurazione e limiti in [docs/REALTIME.md](docs/REALTIME.md). La memoria persistente rende il comportamento più personale, mentre un apprendimento autonomo illimitato richiederebbe un sistema separato di valutazione, consenso e aggiornamento del modello.

## v0.5 — Chiamalo per nome

- Un solo comando vocale: attiva **«Jarvis»**, pronuncia il suo nome (anche seguito da una domanda) e la conversazione si apre a tutto schermo. Si chiude da sola con “basta così” o “possiamo finire qui” e torna in ascolto. Dettagli in [docs/REALTIME.md](docs/REALTIME.md).
- Nuova schermata vocale con anelli HUD, colori per stato (ascolto, elaborazione, risposta), nucleo che reagisce al volume e sottotitoli live.
- Correzioni: la wake word non si spegne più dopo un silenzio, il riconoscimento dentro la conversazione funzionava solo in teoria (`isFinal` letto nel punto sbagliato), riaprire subito la conversazione non dà più “conversazione già attiva”, la pagina non scorre più fino alla chat al caricamento e l’animazione non riparte da zero a ogni cambio di stato.
- Voce più rapida: `POST /api/speech` avvia subito la sintesi e restituisce un id, `GET /api/speech/:id` trasmette l’MP3 mentre viene generato, così la riproduzione parte ai primi byte. Le frasi in coda vengono accorpate per un’intonazione più naturale; link, markdown ed emoji non vengono letti. Voce configurabile con `OPENAI_TTS_VOICE` (predefinita `onyx`).
- Ascolto più affidabile: dettatura che non si chiude subito con la wake word attiva, nessuna attivazione da un «Jarvis» poi corretto dal riconoscimento, «basta»/«stop» interrompono senza chiudere, riduzione eco `far_field` (`OPENAI_REALTIME_NOISE=near_field` con le cuffie) e turni meno impazienti.
