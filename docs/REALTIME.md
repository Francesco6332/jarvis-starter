# v0.4 — Conversazione vocale

Attiva **«Jarvis»** nella home e autorizza il microfono: JARVIS resta in ascolto della parola “Jarvis” (riconosce anche trascrizioni come “Giarvis” o “Jervis”) e, quando lo chiami, si apre a tutto schermo la conversazione Realtime. Se pronunci il nome insieme a una richiesta (“Jarvis, quali impegni ho oggi?”) risponde direttamente a quella. In alternativa premi **Parla con JARVIS** o tocca il nucleo. La schermata mostra connessione, ascolto, elaborazione e risposta, con sottotitoli live e animazione che reagisce alla voce. Puoi interrompere JARVIS parlando, silenziare il microfono, fermare la risposta o terminare. Frasi come “possiamo finire qui”, “basta così”, “a dopo” o “buonanotte Jarvis” chiudono la schermata e riattivano l’ascolto della parola “Jarvis”. Escape chiude la schermata e rilascia il microfono. L’attivazione resta memorizzata nel browser e riparte al ricaricamento della pagina. Se il browser blocca la riproduzione, premi **Abilita riproduzione audio**.

L’ascolto della parola “Jarvis” usa la Web Speech API (Chrome/Edge; l’audio può essere elaborato dal fornitore del browser), si mette in pausa mentre JARVIS parla, durante la dettatura e durante la conversazione, e si riavvia da solo quando il browser chiude la sessione di riconoscimento dopo un silenzio. Senza `OPENAI_API_KEY` il richiamo risponde in chat con la voce del dispositivo.

## Configurazione

Crea o modifica `apps/api/.env`, mantenendo le impostazioni Google già presenti:

```dotenv
OPENAI_API_KEY=la_tua_chiave
# Opzionale: modello Realtime disponibile al tuo account
OPENAI_REALTIME_MODEL=gpt-realtime
```

Riavvia il backend. La chiave deve avere accesso al modello e credito API; la presenza della chiave nell’health check non ne verifica la validità. Non inserirla nel frontend o in Git.

La voce Realtime è `cedar`. La chat normale mantiene `onyx` tramite TTS. Il riconoscimento dei turni usa semantic VAD e l’interruzione automatica. Non si promette una latenza fissa: rete, dispositivo e servizio incidono sulla reattività.

## Briefing e strumenti

- Il briefing iniziale è facoltativo. Legge gli eventi delle **prossime 24 ore**, fino a 50, solo con Google collegato e permesso di lettura attivo. Mostra al modello lo stato di connessione: calendario non disponibile non significa calendario vuoto.
- Per notizie, articoli, fonti aggiornate, consigli documentati e un resoconto della giornata JARVIS può usare `search_web`, basato sulla ricerca web ospitata da OpenAI. Riporta fonti e date e tratta le pagine come dati, non come istruzioni.
- Le prime 10 attività di studio aperte sono incluse solo con il relativo permesso. Il modello riceve anche le memorie già salvate. Per nuovi ricordi usa la chat testuale o il pannello Memoria.
- Gli appunti (massimo 30.000 caratteri) sono inclusi solo in modalità Studio con condivisione attiva. La cronologia della chat non è importata nella sessione vocale; le trascrizioni della nuova conversazione vengono aggiunte alla chat locale.
- Gli strumenti disponibili all’avvio costituiscono il limite della sessione. Il backend ricontrolla i permessi a ogni chiamata: una revoca blocca le azioni successive. Per aggiungere strumenti abilitati in seguito, avvia una nuova sessione.
- Se dici esplicitamente “ricordati che…” o chiedi di ricordare una preferenza, JARVIS può usare `remember_fact` e salvarla nella memoria locale già usata dalla chat. Non salva automaticamente ogni frase e non memorizza dati sensibili senza una richiesta esplicita.
- Un evento resta una **proposta**: termina la conversazione e confermalo nella scheda del workspace. Nessuno strumento vocale può confermarlo. Le chiamate duplicate con lo stesso ID vengono eseguite una volta per sessione.

## Connessione e privacy

Il browser scambia audio con OpenAI mediante WebRTC e invia le richieste di strumenti al backend locale. Il backend crea la sessione tramite `/v1/realtime/calls`: non restituisce la chiave API al browser. Il relay client non è un’attestazione crittografica delle chiamate del modello; l’autorizzazione effettiva resta nei controlli del backend e nella conferma manuale degli eventi.

Una sola sessione attiva, massimo 10 minuti. Heartbeat ogni 15 secondi; il backend richiede la chiusura delle sessioni senza heartbeat dopo 45 secondi, con controllo ogni 10 secondi. Uscita, fine conversazione, frase di chiusura e errori di connessione chiudono tracce e peer nel browser e richiedono l’hangup al provider. Non c’è riconnessione automatica. La chiusura remota è best effort in caso di guasto di rete; il peer viene comunque chiuso localmente.

Richiede microfono, WebRTC, localhost o HTTPS e pagina aperta. Non è una telefonata, un servizio desktop sempre attivo o un’app utilizzabile a schermo bloccato. L’interfaccia si adatta al telefono, ma accesso remoto sicuro, autenticazione e distribuzione mobile non sono inclusi. Il backend resta mono-utente su loopback.

Audio, trascrizioni, memorie, appunti condivisi e richieste di ricerca vengono elaborati da OpenAI; le sessioni e la ricerca consumano credito API. Le trascrizioni automatiche possono includere errori o testo generato ma interrotto prima dell’ascolto. La memoria migliora il contesto di JARVIS, ma non modifica i pesi del modello e non equivale a un apprendimento autonomo illimitato. Il nucleo animato è un’illustrazione astratta, non una visualizzazione dell’attività interna del modello.

## Verifica

`npm run typecheck`, `npm run build`, `npm test`.

I test simulano OpenAI e WebRTC: verificano schema di sessione, chiave solo server, strumenti autorizzati, deduplicazione, revoca, chiusura, gestione di permessi microfono tardivi e risposte annullate. Non misurano qualità audio o latenza reale. Per la verifica sul dispositivo: avvia, ascolta il saluto, interrompi parlando, chiedi una proposta di evento, termina, conferma nella scheda e verifica che l’indicatore microfono del browser si spenga.

Documentazione protocollo: [WebRTC](https://developers.openai.com/api/docs/guides/realtime-webrtc), [conversazioni e strumenti](https://developers.openai.com/api/docs/guides/realtime-conversations), [turn detection](https://developers.openai.com/api/docs/guides/realtime-vad).
