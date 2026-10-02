# v0.4 — Conversazione vocale

Dalla home scegli **Conversazione continua**, poi **Avvia conversazione** e autorizza il microfono. La schermata mostra ascolto, elaborazione e riproduzione. Puoi interrompere JARVIS parlando, silenziare il microfono, fermare la risposta o terminare. Escape chiude la schermata e rilascia il microfono. Se il browser blocca la riproduzione, premi **Abilita riproduzione audio**.

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
- Le prime 10 attività di studio aperte sono incluse solo con il relativo permesso. Il modello riceve anche le memorie già salvate. Per nuovi ricordi usa la chat testuale o il pannello Memoria.
- Gli appunti (massimo 30.000 caratteri) sono inclusi solo in modalità Studio con condivisione attiva. La cronologia della chat non è importata nella sessione vocale; le trascrizioni della nuova conversazione vengono aggiunte alla chat locale.
- Gli strumenti disponibili all’avvio costituiscono il limite della sessione. Il backend ricontrolla i permessi a ogni chiamata: una revoca blocca le azioni successive. Per aggiungere strumenti abilitati in seguito, avvia una nuova sessione.
- Un evento resta una **proposta**: termina la conversazione e confermalo nella scheda del workspace. Nessuno strumento vocale può confermarlo. Le chiamate duplicate con lo stesso ID vengono eseguite una volta per sessione.

## Connessione e privacy

Il browser scambia audio con OpenAI mediante WebRTC e invia le richieste di strumenti al backend locale. Il backend crea la sessione tramite `/v1/realtime/calls`: non restituisce la chiave API al browser. Il relay client non è un’attestazione crittografica delle chiamate del modello; l’autorizzazione effettiva resta nei controlli del backend e nella conferma manuale degli eventi.

Una sola sessione attiva, massimo 10 minuti. Heartbeat ogni 15 secondi; il backend richiede la chiusura delle sessioni senza heartbeat dopo 45 secondi, con controllo ogni 10 secondi. Uscita, fine conversazione e errori di connessione chiudono tracce e peer nel browser e richiedono l’hangup al provider. Non c’è riconnessione automatica. La chiusura remota è best effort in caso di guasto di rete; il peer viene comunque chiuso localmente.

Richiede microfono, WebRTC, localhost o HTTPS e pagina aperta. Non è una telefonata, un servizio desktop sempre attivo o un’app utilizzabile a schermo bloccato. L’interfaccia si adatta al telefono, ma accesso remoto sicuro, autenticazione e distribuzione mobile non sono inclusi. Il backend resta mono-utente su loopback.

Audio, trascrizioni, memorie e appunti condivisi vengono elaborati da OpenAI; le sessioni consumano credito API. Le trascrizioni automatiche possono includere errori o testo generato ma interrotto prima dell’ascolto. Il nucleo animato è un’illustrazione astratta, non una visualizzazione dell’attività interna del modello.

## Verifica

`npm run typecheck`, `npm run build`, `npm test`.

I test simulano OpenAI e WebRTC: verificano schema di sessione, chiave solo server, strumenti autorizzati, deduplicazione, revoca, chiusura, gestione di permessi microfono tardivi e risposte annullate. Non misurano qualità audio o latenza reale. Per la verifica sul dispositivo: avvia, ascolta il saluto, interrompi parlando, chiedi una proposta di evento, termina, conferma nella scheda e verifica che l’indicatore microfono del browser si spenga.

Documentazione protocollo: [WebRTC](https://developers.openai.com/api/docs/guides/realtime-webrtc), [conversazioni e strumenti](https://developers.openai.com/api/docs/guides/realtime-conversations), [turn detection](https://developers.openai.com/api/docs/guides/realtime-vad).
