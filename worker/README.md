# Server delle notifiche push (Cloudflare Worker)

Piccolo server che permette di ricevere le notifiche **anche con l'app chiusa**. Gira gratis su Cloudflare Workers.

## Come funziona
- Ogni dispositivo che attiva le notifiche si **iscrive** al server (indirizzo del servizio di push del browser + chiavi di cifratura).
- Quando qualcuno aggiunge una transazione o un conto, **la sua app dice al server a chi inviare la notifica** (le regole sono quelle delle notifiche nell'app). Il server cifra il messaggio e lo spedisce al servizio di push di Google/Apple/Mozilla, che lo consegna al telefono.
- Il server **non ha mai accesso a Drive** e non conserva token Google. A ogni richiesta controlla il token Google di chi scrive: deve essere valido e avere accesso al file del database della famiglia. Salva solo gli iscritti, sotto chiave `id del database + email`.
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
Due possibilità (basta una):

- **Nel sito pubblicato, senza ricostruirlo:** in *Impostazioni → Notifiche → Notifiche push* incolla l'indirizzo del server e la **chiave pubblica** VAPID.
- **Per tutti i dispositivi, in modo permanente:** in GitHub, *Settings → Secrets and variables → Actions → Variables*, crea `VITE_PUSH_URL` (indirizzo del server, senza `/` finale) e `VITE_VAPID_PUBLIC_KEY` (la chiave pubblica). Poi rilancia il deploy (*Actions → Deploy su GitHub Pages → Run workflow*).

## Attivarle sui dispositivi
Su ogni telefono o computer: *Impostazioni → Notifiche → Ricevi le notifiche anche con l'app chiusa*, poi concedi il permesso. Premi *Invia una notifica push di prova* per verificare.

- **iPhone:** serve iOS 16.4 o successivo e l'app **aggiunta alla schermata Home** (Safari → Condividi → Aggiungi a Home). Dalle semplici pagine di Safari il push non funziona.
- **Android e computer:** funziona anche da browser.

## Se qualcosa non va
- **«Origine non autorizzata» (403):** `ALLOWED_ORIGINS` non coincide con l'indirizzo del sito. Correggi `wrangler.toml` e rifai `npx wrangler deploy`.
- **«Sessione Google non valida» (401):** il token Google è scaduto; tocca *Riconnetti* nell'app e riprova.
- **«Nessun accesso al database» (403):** l'account non ha accesso al file del database della famiglia.
- **La prova non arriva:** controlla che il permesso notifiche non sia bloccato nelle impostazioni del browser per il sito, e che l'app sia in background (con l'app aperta la notifica compare nella campanella). Per vedere i log: `npx wrangler tail`.
- **Un dispositivo non riceve più nulla:** riattiva l'interruttore (il server elimina le iscrizioni non più valide).

## Limiti
- La notifica parte solo per le modifiche **fatte dall'app** (non per quelle fatte a mano sul file in Drive), e chi le fa deve avere la sessione Google valida in quel momento.
- Un'importazione di massa (più di 3 transazioni o conti insieme) non invia notifiche, per evitare tempeste di messaggi.
- Se l'app è in primo piano, il push non mostra nulla: sincronizza subito e compare la campanella.

## Sviluppo e test
```bash
npm test                      # include i test del server (cifratura RFC 8291, VAPID, endpoint)
node worker/scripts/generate-vapid.mjs
```
Il Worker usa solo API standard (WebCrypto, fetch): gira anche in Node 20+. È stato provato anche sul runtime Cloudflare in locale (`wrangler dev`).
