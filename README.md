# MoneyDuo

Web app **mobile-first** (PWA installabile) per gestire **spese personali** e **conti in comune** in coppia, ispirata a Money Manager.
React + TypeScript + Vite + Tailwind CSS. I dati vivono in un file JSON su **Google Drive** (condiviso tra i due account) e in cache nel browser.

## Privacy: cosa c'è (e cosa NON c'è) in questo repository
- Il repository contiene **solo codice, configurazione e dati di esempio neutri** (conti *Contanti* e *Conto Comune*, categorie di base).
- **Nessun** conto reale, saldo o transazione viene salvato nel repo: tutto è creato nell'app e salvato su Google Drive + `localStorage` del browser.
- `.gitignore` esclude `.env*` e i file di backup (`moneyduo-*.json`). Non committare mai i tuoi export.
- Il *Client ID* OAuth è un identificativo pubblico, ma per ordine va in `.env.local` o nelle *Variables* di GitHub Actions, non nel codice.

## Funzioni
- Conti per i due profili e in comune, saldo per conto e totale liquidità (con esclusione di investimenti/fondi vincolati), **aggiungi / nascondi / mostra** senza perdere lo storico.
- Categorie e sottocategorie (Entrate/Uscite) con icona e colore, **aggiungi / nascondi / mostra** (cascata sui figli).
- Uscite, entrate e giroconti; modifica/eliminazione con ricalcolo immediato; chi ha pagato + divisione (personale, 50/50, anticipata 100% per l'altro).
- Navigazione mensile, filtri per ambito (Tutti / In Comune / profili), conto e ricerca testuale; statistiche per categoria; **bilancio di coppia** con registrazione del rimborso.
- Nomi dei profili e dell'area condivisa modificabili da Impostazioni (predefiniti: Emilio, Sara, In Comune).
- Esporta / Importa JSON (unisci o sostituisci). Interfaccia in italiano, tema chiaro/scuro automatico.

## Sviluppo
```bash
npm install
cp .env.example .env.local   # inserisci VITE_GOOGLE_CLIENT_ID
npm run dev                  # http://localhost:5173
npm test                     # test di calcoli e merge
npm run build                # type-check + build in dist/
```
Il Client ID si può anche incollare dall'app (Impostazioni → Google Drive); resta solo nel browser.

## Configurazione Google Cloud Console
1. Crea un progetto su <https://console.cloud.google.com/> e abilita **Google Drive API** (*API e servizi → Libreria*).
2. *Schermata consenso OAuth*: tipo **Esterno**, lascia lo stato **Testing** e aggiungi come **utenti di prova** i due account Google (il tuo e quello dell'altra persona).
3. *Credenziali → Crea credenziali → ID client OAuth → Applicazione web*. In **Origini JavaScript autorizzate** aggiungi:
   - `http://localhost:5173` (sviluppo)
   - `https://<utente>.github.io` (produzione; solo l'origine, senza il percorso `/money-duo/`).
4. Copia il **Client ID** (non serve il client secret).

Scope richiesto: `https://www.googleapis.com/auth/drive`. Serve per vedere e collegare anche file creati dall'altro account e condivisi con te (lo scope ristretto `drive.file` non lo permette senza Google Picker). L'app legge e scrive **solo** il file che colleghi. In modalità *Testing* Google mostra l'avviso "app non verificata": è normale per un uso personale.

## Pubblicazione su GitHub Pages
1. *Settings → Pages → Source*: **GitHub Actions**.
2. *Settings → Secrets and variables → Actions → Variables*: crea `VITE_GOOGLE_CLIENT_ID`.
3. Il push su `main` esegue test + build + deploy (`.github/workflows/deploy.yml`). L'app usa percorsi relativi, quindi funziona in `https://<utente>.github.io/money-duo/` senza altre impostazioni.

> `localStorage` è condiviso da tutte le pagine della stessa origine `<utente>.github.io`. Se pubblichi altri siti sullo stesso account, valuta un dominio dedicato.

## Uso in coppia
L'app si apre sulla schermata **Accedi con Google**: non ci sono profili da creare né file da collegare a mano.
1. **Prima persona**: accede col proprio account. Non trovando nessun database, l'app mostra «Crea nuovo database» (crea `moneyduo-shared-db.json` su Drive). Poi, da *Impostazioni → Google Drive*, condivide il file con l'email dell'altra persona (permesso *modifica*).
2. **Seconda persona**: accede col proprio account. L'app cerca da sola il file condiviso e si collega: non resta che aspettare un attimo. Se il file non è ancora stato condiviso, la schermata mostra l'email con cui ha fatto l'accesso, da usare per la condivisione, e un pulsante «Cerca di nuovo».
3. Su un nuovo dispositivo o browser basta rifare l'accesso: il database viene ritrovato in automatico. Se ci sono più file con lo stesso nome compare una scelta; se sul dispositivo ci sono dati propri non ancora nel file si sceglie se unirli o usare solo il file.

> Crea un database nuovo **solo una volta**: due file separati non si vedrebbero tra loro.

## Schema del JSON (`schemaVersion: 1`)
```jsonc
{
  "schemaVersion": 1,
  "meta": { "dbId": "uuid", "createdAt": "ISO", "updatedAt": "ISO", "updatedBy": "email", "revision": 0 },
  "profiles": { "a": "Emilio", "b": "Sara", "shared": "In Comune", "updatedAt": "ISO" },
  "accounts": [{ "id", "name", "group": "cash|bank|card|savings|investment|other", "owner": "a|b|shared",
                 "initialBalance": 0, "excludeFromTotal": false, "hidden": false, "order": 0, "createdAt", "updatedAt" }],
  "categories": [{ "id", "name", "type": "expense|income", "parentId": null, "icon": "🛒", "color": "#f97316",
                   "hidden": false, "order": 0, "updatedAt" }],
  "transactions": [{ "id", "type": "expense|income|transfer", "amount": 1250, "date": "ISO",
                     "accountId", "toAccountId": null, "categoryId": null, "title": "", "note": "",
                     "paidBy": "a|b|shared", "split": "personal|equal|advance", "createdAt", "updatedAt" }],
  "deleted": { "<id>": "ISO" }
}
```
Gli importi sono **interi in centesimi**. `deleted` contiene le lapidi che permettono di propagare le eliminazioni tra dispositivi.

## Come funziona la sincronizzazione
- Ogni modifica è salvata subito in locale e inviata a Drive dopo ~2 s; si controlla anche ogni 45 s, al ritorno in primo piano e alla riconnessione.
- Ciclo: legge la `version` del file → se è cambiata scarica e fa **merge per record** (vince l'`updatedAt` più recente; un'eliminazione più recente batte una modifica) → carica solo se ci sono differenze → memorizza la nuova `version`. Non c'è sovrascrittura cieca dell'intero file.
- Stati visibili: *Sincronizzato, Da inviare, Sync…, Offline, Riconnetti, Errore*. Offline le modifiche restano in cache e partono al ritorno della rete.
- **Limiti noti**: (1) il token Google dura circa 1 ora e un sito statico non può rinnovarlo in background: allo scadere compare "Riconnetti" (un tap) e nel frattempo i dati restano al sicuro in locale; (2) due scritture nello stesso istante possono teoricamente incrociarsi, ma il merge per record lo rende molto improbabile e Drive conserva la **cronologia versioni** del file per recuperare eventuali errori.

## Bilancio di coppia
Spesa pagata da una persona: *50/50* → l'altra deve metà; *anticipata 100%* → l'altra deve tutto; *personale* → nessun debito; pagata da *In Comune* → nessun debito. Un **giroconto tra un conto di un profilo e uno dell'altro** conta come rimborso. L'app propone il rimborso pre-compilato.

## Struttura
```
src/types.ts        schema tipizzato
src/lib/            defaults neutri, calcoli (saldi, statistiche, pareggio), merge/validazione, mutazioni pure
src/sync/           google.ts (token GIS) · drive.ts (REST) · engine.ts (ciclo di sync)
src/store/          stato + cache locale
src/components/     UI riusabile, form, Gate (login + ricerca automatica del database)
src/pages/          Transazioni, Statistiche, Conti, Impostazioni, Categorie
```
