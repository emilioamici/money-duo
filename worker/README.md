# Server delle notifiche push (Cloudflare Worker)

Piccolo server che permette di ricevere le notifiche **anche con l'app chiusa**. Gira gratis su Cloudflare Workers.

## Come funziona
- Ogni dispositivo che attiva le notifiche si **iscrive** al server (indirizzo del servizio di push del browser + chiavi di cifratura).
- Quando qualcuno aggiunge una transazione o un conto, **la sua app dice al server a chi inviare la notifica** (le regole sono quelle delle notifiche nell'app). Il server cifra il messaggio e lo spedisce al servizio di push di Google/Apple/Mozilla, che lo consegna al telefono.
- Il server **non ha mai accesso a Drive** e, per le sole notifiche, non conserva token Google (con l'accesso persistente facoltativo conserva invece un token di rinnovo cifrato: vedi sotto). A ogni richiesta controlla il token Google di chi scrive: deve essere valido e avere accesso al file del database della famiglia. Salva solo gli iscritti, sotto chiave `id del database + email`.
- Il messaggio è cifrato fino al dispositivo (RFC 8291). Il testo però passa dal server: nella notifica ci sono nome, importo e titolo.

## Cosa serve
- Un account Cloudflare gratuito: <https://dash.cloudflare.com/sign-up> (non serve carta di credito).
- Node 20 o successivo sul tuo computer.

I limiti del piano gratuito bastano di gran lunga per una famiglia: 100.000 richieste al giorno, e le scritture sull'archivio KV (1.000 al giorno) avvengono solo quando un dispositivo si iscrive o si rinnova.

## Installazione (una volta sola)
Dalla cartella del progetto:

1. **Chiavi VAPID** (identificano il tuo server presso i servizi di push):
   ```bash
   node worker/scripts/generate-vapid.mjs
   ```
   Stampa `VAPID_PUBLIC_KEY` e `VAPID_PRIVATE_KEY`. Copiale da qualche parte. **La privata non va mai condivisa né committata.**

2. **Configurazione**:
   ```bash
   cd worker
   cp wrangler.example.toml wrangler.toml
   ```
   Apri `wrangler.toml` e sostituisci `<utente>` con il tuo nome utente GitHub (`ALLOWED_ORIGINS` deve essere esattamente l'origine del sito, per esempio `https://emilioamici.github.io`, **senza** `/money-duo` e senza `/` finale). `wrangler.toml` è ignorato da Git.

3. **Accesso a Cloudflare**:
   ```bash
   npx wrangler login
   ```
   Si apre il browser: accedi e autorizza.

4. **Archivio degli iscritti (KV)**:
   ```bash
   npx wrangler kv namespace create SUBS
   ```
   Il comando stampa un `id`. Incollalo in `wrangler.toml` al posto di `INSERISCI_QUI_L_ID_DEL_KV`.

5. **Segreti** (ti viene chiesto di incollare il valore):
   ```bash
   npx wrangler secret put VAPID_PRIVATE_KEY
   npx wrangler secret put VAPID_PUBLIC_KEY
   ```

6. **Pubblicazione**:
   ```bash
   npx wrangler deploy
   ```
   Alla fine stampa l'indirizzo, per esempio `https://moneyduo-push.tuo-nome.workers.dev`. Aprendo `…/health` nel browser deve comparire `{"ok":true}`.

## Collegare l'app
In GitHub, *Settings → Secrets and variables → Actions → Variables*, crea `VITE_PUSH_URL` (indirizzo del server, senza `/` finale) e `VITE_VAPID_PUBLIC_KEY` (la chiave pubblica). Poi rilancia il deploy (*Actions → Deploy su GitHub Pages → Run workflow*). Sono valori pubblici e vengono inseriti nell'app alla pubblicazione: nessun utente deve inserire nulla. Non c'è più un campo nell'app per modificarli.

## Attivarle sui dispositivi
Su ogni telefono o computer: *Impostazioni → Notifiche → Attiva notifiche* (un solo interruttore: attiva sia le notifiche del dispositivo sia, se il server è configurato, il push anche con l'app chiusa), poi concedi il permesso. Premi *Invia una notifica di prova* per verificare. Chi aveva già le notifiche attive viene iscritto al server da solo alla prima apertura dopo la configurazione; se il server non risponde compare «Riprova ad attivarle anche con l'app chiusa».

- **iPhone:** serve iOS 16.4 o successivo e l'app **aggiunta alla schermata Home** (Safari → Condividi → Aggiungi a Home). Dalle semplici pagine di Safari il push non funziona.
- **Android e computer:** funziona anche da browser.

## Accesso persistente (facoltativo)
Il token di accesso di Google dura 1 ora, e un sito statico non può rinnovarlo da solo: dopo un'ora, o a ogni riapertura, serve un tocco su «Riconnetti». Con questo server l'accesso diventa **persistente**: il Worker conserva il token di rinnovo e l'app ottiene token freschi da sola, senza popup e **anche in background**, quindi le notifiche non si fermano.

**Prima di attivarlo, due cose da sapere**
- Il Worker custodirà un token di rinnovo con **accesso completo a Google Drive** per ogni persona che lo attiva, oltre al **client secret** dell'app. È cifrato (AES-GCM, chiave `SESSION_KEY` nei segreti di Cloudflare) e non esce mai dal Worker, ma chi controllasse il tuo account Cloudflare potrebbe usarlo. Usa un account Cloudflare protetto da verifica in due passaggi.
- Sul dispositivo resta un identificativo di sessione casuale (in `localStorage`): chi lo ottenesse potrebbe farsi dare token d'accesso dal Worker. Se sul tuo `<utente>.github.io` pubblichi anche altri siti, valuta un dominio dedicato.

**1. Google Cloud Console**
1. **Pubblica l'app.** Vai su *Google Auth Platform → Pubblico* (o *Schermata consenso OAuth*) e premi **Pubblica app** (stato *In produzione*). Se resta in *Testing*, Google fa scadere i token di rinnovo dopo **7 giorni**. In produzione senza verifica, Google mostra «app non verificata» al primo accesso: *Avanzate → Vai a MoneyDuo*. Per uso personale va bene (limite di 100 utenti).
2. **Aggiungi l'URI di reindirizzamento.** In *Client → il tuo ID client OAuth → URI di reindirizzamento autorizzati* aggiungi l'indirizzo del Worker seguito da `/auth/callback`, per esempio `https://moneyduo-push.tuo-nome.workers.dev/auth/callback`.
3. **Copia il client secret** dalla stessa pagina del client. Non incollarlo in chat né nel repository: lo inserirai tra poco nel terminale.

**2. Worker**
```bash
node worker/scripts/generate-session-key.mjs        # stampa SESSION_KEY: copiala
cd worker
```
Poi:
- in `wrangler.toml` togli il `#` davanti a `GOOGLE_CLIENT_ID` e inserisci l'ID del client (è pubblico);
- imposta i due segreti (ti viene chiesto di incollare il valore):
  ```bash
  npx wrangler secret put GOOGLE_CLIENT_SECRET
  npx wrangler secret put SESSION_KEY
  npx wrangler deploy
  ```
- apri `…/health` nel browser: deve comparire `{"ok":true,"auth":true}`.

**3. App**
Non serve altro (l'app usa lo stesso indirizzo del server delle notifiche). Sulle nuove installazioni «Accedi con Google» passa dal Worker. Dove sei già dentro: *Impostazioni → Sincronizzazione → Attiva l'accesso persistente*. Dopo il consenso su Google l'app ricompare con «Accesso persistente attivo».

**Come si gestisce**
- *Esci* elimina la sessione **di quel dispositivo**. Il token di rinnovo non viene revocato su Google, perché scollegherebbe anche gli altri dispositivi.
- Per revocare tutto: <https://myaccount.google.com/permissions> → MoneyDuo → Rimuovi accesso. Al rinnovo successivo il Worker se ne accorge, cancella la sessione e l'app chiede un nuovo accesso.
- Se cambi o perdi `SESSION_KEY`, le sessioni esistenti non sono più leggibili: basta rifare l'accesso.
- Le sessioni scadono dopo 180 giorni di inattività.

**Se qualcosa non va**
- **«Google non ha rilasciato il token di rinnovo»:** l'app era già autorizzata. Rimuovi l'accesso su myaccount.google.com/permissions e riprova.
- **Errore `redirect_uri_mismatch` su Google:** l'URI nel punto 1.2 non coincide con l'indirizzo del Worker (compreso `https://` e `/auth/callback`).
- **Dopo 7 giorni chiede di nuovo l'accesso:** l'app è ancora in *Testing*; vedi il punto 1.1.
- **«Origine non autorizzata»:** `ALLOWED_ORIGINS` deve contenere l'origine dell'app (per esempio `https://emilioamici.github.io`, senza percorso).

## Apple Wallet (facoltativo)

Con lo stesso Worker le spese pagate con **Apple Pay** possono arrivare da sole in MoneyDuo. Non serve nessuna configurazione in più: la funzione compare in *Impostazioni → Apple Wallet* appena l'app conosce l'indirizzo del Worker.

- iOS non permette alle app di leggere Wallet, ma l'automazione **«Transazione»** dell'app Comandi parte a ogni pagamento e può chiamare un indirizzo. L'app genera per ogni persona un indirizzo personale `…/wallet/in/<token>` (il server conserva solo l'hash del token).
- Il Comando Rapido invia importo, commerciante e carta. Il Worker mette la spesa in una casella (KV, `wi:…`), **cifrata** con `SESSION_KEY` se è impostata e **cancellata dopo 30 giorni**, e manda una notifica push ai dispositivi dell'utente.
- L'app, quando si sincronizza (o riceve la notifica), scarica la casella, crea le transazioni sul conto riconosciuto dal nome della carta e le segna **«Da approvare»** (conto non riconosciuto: **«Da completare»**), poi conferma e il server le cancella.
- Usa `KV.list` (limite del piano gratuito: 1000 al giorno): l'app interroga il server al massimo ogni 2 minuti e solo sui dispositivi dove la funzione è attiva.


- **«Origine non autorizzata» (403):** `ALLOWED_ORIGINS` non coincide con l'indirizzo del sito. Correggi `wrangler.toml` e rifai `npx wrangler deploy`.
- **«Sessione Google non valida» (401):** il token Google è scaduto; tocca *Riconnetti* nell'app e riprova.
- **«Nessun accesso al database» (403):** l'account non ha accesso al file del database della famiglia.
- **La prova non arriva:** controlla che il permesso notifiche non sia bloccato nelle impostazioni del browser per il sito, e che l'app sia in background (con l'app aperta la notifica compare nella campanella). Per vedere i log: `npx wrangler tail`.
- **Un dispositivo non riceve più nulla:** riattiva l'interruttore (il server elimina le iscrizioni non più valide).

## Limiti
- La notifica parte solo per le modifiche **fatte dall'app** (non per quelle fatte a mano sul file in Drive).
- **La notifica parte quando i dati arrivano su Drive**, non quando premi «Salva»: così chi la riceve trova subito la spesa. Se sei offline, le notifiche restano in coda sul dispositivo (fino a 24 ore, max 100) e partono dopo l'invio dei dati; se il server push non risponde si riprova al ciclo successivo. Se nel frattempo elimini la spesa, la notifica viene scartata. In quel momento serve una sessione Google valida.
- Un'importazione di massa (più di 3 transazioni o conti insieme) non invia notifiche, per evitare tempeste di messaggi.
- Se l'app è in primo piano, il push non mostra nulla: sincronizza subito e compare la campanella.

## Sviluppo e test
```bash
npm test                      # include i test del server (cifratura RFC 8291, VAPID, endpoint)
node worker/scripts/generate-vapid.mjs
```
Il Worker usa solo API standard (WebCrypto, fetch): gira anche in Node 20+. È stato provato anche sul runtime Cloudflare in locale (`wrangler dev`).

## Permesso ristretto
Con il permesso ristretto `drive.file` l'app chiama `/auth/start?scope=file`: il token di rinnovo copre solo i file dell'app. Ripubblica il Worker e riattiva l'accesso persistente sui dispositivi.
