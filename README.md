# J.A.R.V.I.S. — Personal AI (starter v0.1)

Prototipo funzionante con **React + TypeScript + Vite** e un backend **Node.js + Express**. Ha una rete neurale astratta animata su Canvas, chat, modalità studio, appunti locali, dettatura (nei browser compatibili) e risposta vocale opzionale.

## Avvio

Prerequisiti: Node.js 20+ e npm.

```bash
npm install
cp apps/api/.env.example apps/api/.env
# Inserisci OPENAI_API_KEY nel file apps/api/.env
npm run dev
```

Apri `http://localhost:5173`. Se non inserisci la chiave API, l'interfaccia funziona in **modalità demo** e il server risponde con messaggi dimostrativi.

**Windows PowerShell**: `Copy-Item apps/api/.env.example apps/api/.env`

## Sicurezza e privacy

- La chiave API rimane **solo nel backend**. Non inserirla in Vite, React o nella repository.
- Le chat e gli appunti sono **locali al browser** (`localStorage`); non sono sincronizzati tra dispositivi. Per dati sensibili e sincronizzazione implementare login, crittografia e database in una release successiva.
- Questa release **non ha accesso al computer** e **non esegue comandi**. Le automazioni arriveranno solo con una allowlist di strumenti e conferma esplicita prima di operazioni importanti.
- Il riconoscimento vocale usa la Web Speech API quando supportata: a seconda del browser l'audio può essere elaborato dai servizi del fornitore. La sintesi vocale usa le voci del dispositivo/browser.
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

1. Fase 1: web responsive (questa release), verificare UX con telefono nella rete locale.
2. Fase 2: spostare tipi, client API e logica condivisa in `packages/shared`.
3. Fase 3: creare `apps/mobile` con Expo / React Native; riusare backend e logica, realizzare l'interfaccia mobile nativa e notifiche push.
4. Fase 4: autenticazione, database per chat/appunti sincronizzati, eventuale app desktop Electron.

## Studio

Il tutor AI può spiegare concetti e fare quiz, ma non conosce automaticamente il materiale dei corsi. Per supportare PDF, slide e dispense personali servono caricamento file, estrazione testo e ricerca nei documenti con riferimenti alle fonti (futura fase RAG).

## Verifiche

`npm run typecheck` e `npm run build`.
