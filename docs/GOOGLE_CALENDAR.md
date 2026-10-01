# Collegare Google Calendar a JARVIS

Questa integrazione è per il prototipo locale, personale e mono-utente. Non esporre Vite o l’API su Internet. Il calendario utilizzato è quello **principale** dell’account che colleghi.

## Configurazione iniziale

1. Apri https://console.cloud.google.com/ e seleziona o crea un progetto.
2. In **API e servizi → Libreria**, abilita **Google Calendar API**.
3. Configura **Google Auth Platform / schermata consenso OAuth**: nome dell’app, email di supporto e pubblico. Se l’app è in modalità di test, aggiungi il tuo account Google agli utenti di test.
4. Crea un **client OAuth 2.0 di tipo Applicazione web**.
5. Registra esattamente questo **URI di reindirizzamento autorizzato**:

   `http://localhost:5173/api/google/callback`

   Usa `localhost` anche per aprire JARVIS; `127.0.0.1`, un’altra porta o un altro percorso non sono equivalenti. Vite inoltra il callback al backend.
6. In `apps/api/.env` aggiungi:

   ```dotenv
   GOOGLE_CLIENT_ID=il_tuo_client_id
   GOOGLE_CLIENT_SECRET=il_tuo_client_secret
   GOOGLE_REDIRECT_URI=http://localhost:5173/api/google/callback
   WEB_ORIGIN=http://localhost:5173
   ```

7. Riavvia `npm run dev`. Apri `http://localhost:5173`, poi **Permessi e attività → Collega Google**. Accedi all’account desiderato e concedi l’accesso al calendario.
8. Attiva i permessi locali che vuoi concedere: lettura calendario, proposte di eventi, attività di studio. Sono disattivati inizialmente e controllati anche dal backend.

Non mettere credenziali nel frontend o in Git. La chiave OpenAI è separata dalle credenziali Google.

## Come usarlo

- «Quali impegni ho domani?»
- «Prepara un evento Ripasso CSS domani dalle 19 alle 20, con avviso 10 minuti prima.»
- «Ricordami venerdì alle 18 di chiamare il meccanico, crea un evento di 15 minuti con avviso all’inizio.»
- «Crea un’attività per ripassare crittografia entro domani alle 20.»
- «Quali attività di studio mi restano?»

L’AI deve chiedere data, ora o durata mancanti. Gli eventi e promemoria Google **non vengono creati dalla sola risposta AI**: controlla la scheda e premi **Conferma e crea evento**. Per correggere i dettagli annulla e chiedi una nuova proposta. Le proposte scadono dopo 15 minuti. Non sono supportati invitati, cancellazione/modifica di eventi o ricorrenze.

Un promemoria Google è qui un evento con avviso popup, non un elemento Google Tasks. Gli avvisi Google dipendono dalle impostazioni di Calendar e del tuo dispositivo. Gli avvisi delle attività locali richiedono la pagina JARVIS aperta, il permesso del browser e l’attivazione degli avvisi nella sessione; vengono controllati ogni 30 secondi, soggetti alla sospensione delle schede.

## Dati, permessi e scollegamento

Il flusso OAuth verifica `state`, cookie della sessione e PKCE. Il backend richiede lo scope `calendar.events.owned`; usa esclusivamente il calendario principale. I permessi nel pannello limitano gli strumenti disponibili all’AI. Non vengono inviati inviti.

I token Google e le attività sono salvati in `apps/api/data/`, escluso da Git, con permessi filesystem restrittivi dove supportati. I token sono **in chiaro sul disco**, non nel portachiavi del sistema: proteggi l’account del computer e la directory. Non condividere questa cartella. Per una versione desktop/cloud serviranno un archivio credenziali sicuro e autenticazione utenti.

**Scollega Google** elimina i token locali. Per revocare anche l’autorizzazione presso Google, rimuovi JARVIS dalla pagina delle connessioni del tuo account Google. Se Google revoca o fa scadere il token, ricollega l’account.

## Problemi frequenti

- `redirect_uri_mismatch`: confronta il redirect in Google Cloud e nel `.env`, inclusi porta e percorso.
- Accesso negato: verifica l’utente di test, i permessi concessi e l’API Calendar abilitata.
- `configured: false` da `/api/health`: riguarda la **chiave OpenAI**, non Google. Verifica `.env` e riavvia il backend; i log indicano il percorso atteso senza mostrare segreti.
- Modificando `.env` devi riavviare il backend.

## Riferimenti ufficiali

- https://developers.google.com/identity/protocols/oauth2/web-server
- https://developers.google.com/workspace/calendar/api/v3/reference/events/insert
- https://developers.openai.com/api/docs/guides/function-calling
- https://developers.openai.com/api/docs/guides/text-to-speech
