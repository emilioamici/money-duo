# MoneyDuo

Web app **mobile-first** (PWA installabile) per gestire **spese personali** e **conti di famiglia** con un numero libero di membri, ispirata a Money Manager.
React + TypeScript + Vite + Tailwind CSS. Il database è un file JSON nel **Google Drive del capofamiglia**, condiviso con i membri invitati, più una cache nel browser.

## Privacy: cosa c'è (e cosa NON c'è) in questo repository
- Il repository contiene **solo codice, configurazione e dati di esempio neutri** (conti *Contanti* e *Conto Comune*, categorie di base).
- **Nessun** conto reale, saldo o transazione viene salvato nel repo: tutto è creato nell'app e salvato su Google Drive + `localStorage` del browser.
- `.gitignore` esclude `.env*` e i file di backup (`moneyduo-*.json`). Non committare mai i tuoi export.
- Il *Client ID* OAuth è un identificativo pubblico, ma per ordine va in `.env.local` o nelle *Variables* di GitHub Actions, non nel codice.

## Funzioni
- **Famiglia:** il capofamiglia crea il database scegliendo la **cartella di Drive** dove salvarlo, poi **invita i membri con la loro email Google** da Impostazioni → Famiglia. Nessun limite al numero di membri; i membri si possono rimuovere (l'accesso al file viene revocato e lo storico resta).
- **Conti:** ogni conto è **personale** (un membro), **condiviso con più membri** (selezionabili) o di **tutta la famiglia**. Saldo per conto e totale liquidità (con esclusione di investimenti/fondi vincolati), **aggiungi / nascondi / mostra** senza perdere lo storico.
- **Categorie** e sottocategorie con icona e colore, aggiungi / nascondi / mostra (cascata sui figli).
- **Transazioni:** uscite, entrate e giroconti; chi ha pagato e **con chi dividere la spesa** (parti uguali tra i membri scelti, oppure anticipo per altri); modifica/eliminazione con ricalcolo immediato dei saldi.
- **Dashboard:** navigazione mensile, filtri (Tutti / Condivisi / singolo membro), conto e ricerca testuale; statistiche per categoria; **saldi tra i membri** con registrazione del rimborso.
- Esporta / Importa JSON (unisci o sostituisci; i file del formato precedente vengono migrati). Interfaccia in italiano, tema chiaro/scuro automatico.

> **Visibilità dei conti = filtro dell'app, non sicurezza.** Il database è un unico file condiviso con tutta la famiglia: l'app mostra a ciascuno solo i conti suoi o condivisi con lui, ma chi ha accesso al file può aprirlo da Drive e leggere tutto. Invita solo persone di cui ti fidi.

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

## Uso in famiglia
L'app si apre sulla schermata **Accedi con Google**: nessun profilo da creare né file da collegare a mano.
1. **Capofamiglia**: accede, non trova nessuna famiglia e compila *Crea la tua famiglia* (nome, il suo nome, **cartella di Drive**). Poi, in *Impostazioni → Famiglia → Invita un membro*, inserisce l'email Google di ogni persona.
2. **Membri invitati**: aprono l'app e accedono con quell'account: la famiglia viene trovata e collegata in automatico. Se l'invito non è ancora arrivato, la schermata mostra la loro email e un pulsante «cerca di nuovo».
3. Su un nuovo dispositivo basta rifare l'accesso. Il capofamiglia può **spostare il file** in un'altra cartella dalle stesse impostazioni.
4. I permessi sono quelli di Drive: il file è condiviso in **modifica** con i membri e `writersCanShare` è disattivato, quindi solo il capofamiglia può invitare altre persone.

> **Modalità Testing di Google:** finché l'app OAuth non è pubblicata, **ogni email invitata va aggiunta anche tra gli *utenti di prova*** in Google Cloud Console (*Pubblico → Utenti di prova*), altrimenti la persona riceve `access_denied`. Pubblicare l'app richiede la verifica di Google, e lo scope `drive` è "ristretto" (di norma serve una valutazione di sicurezza).

## Schema del JSON (`schemaVersion: 2`)
```jsonc
{
  "schemaVersion": 2,
  "meta": { "dbId": "uuid", "createdAt": "ISO", "updatedAt": "ISO", "updatedBy": "email", "revision": 0 },
  "family": { "name": "Famiglia", "updatedAt": "ISO" },
  "members": [{ "id", "name", "email": "account Google | null", "color": "#6366f1", "active": true, "joinedAt": "ISO | null", "updatedAt" }],
  "accounts": [{ "id", "name", "group": "cash|bank|card|savings|investment|other",
                 "members": ["<id membro>"] /* [] = tutta la famiglia, 1 = personale */,
                 "initialBalance": 0, "excludeFromTotal": false, "hidden": false, "order": 0, "createdAt", "updatedAt" }],
  "categories": [{ "id", "name", "type": "expense|income", "parentId": null, "icon": "🛒", "color": "#f97316",
                   "hidden": false, "order": 0, "updatedAt" }],
  "transactions": [{ "id", "type": "expense|income|transfer", "amount": 1250, "date": "ISO",
                     "accountId", "toAccountId": null, "categoryId": null, "title": "", "note": "",
                     "paidBy": "<id membro> | null" /* null = conto condiviso */,
                     "participants": ["<id membro>"] /* chi si divide la spesa; [] = personale */, "createdAt", "updatedAt" }],
  "deleted": { "<id>": "ISO" }
}
```
Gli importi sono **interi in centesimi**. `deleted` contiene le lapidi che permettono di propagare le eliminazioni tra dispositivi. I file `schemaVersion: 1` (profili a/b/shared) vengono **migrati automaticamente** e in modo deterministico: i due profili diventano i membri `a` e `b`, e al primo accesso l'app chiede «Chi sei?» per associarli agli account Google.

Il file su Drive è marcato con la proprietà pubblica `moneyduo=db` (e nominato `moneyduo-db-<famiglia>.json`), così l'app lo ritrova anche quando è condiviso da altri.

## Come funziona la sincronizzazione
- Ogni modifica è salvata subito in locale e inviata a Drive dopo ~2 s; si controlla anche ogni 45 s, al ritorno in primo piano e alla riconnessione.
- Ciclo: legge la `version` del file → se è cambiata scarica e fa **merge per record** (vince l'`updatedAt` più recente; un'eliminazione più recente batte una modifica) → carica solo se ci sono differenze → memorizza la nuova `version`. Non c'è sovrascrittura cieca dell'intero file.
- Stati visibili: *Sincronizzato, Da inviare, Sync…, Offline, Riconnetti, Errore*. Offline le modifiche restano in cache e partono al ritorno della rete.
- **Limiti noti**: (1) il token Google dura circa 1 ora e un sito statico non può rinnovarlo in background: allo scadere compare "Riconnetti" (un tap) e nel frattempo i dati restano al sicuro in locale; (2) due scritture nello stesso istante possono teoricamente incrociarsi, ma il merge per record lo rende molto improbabile e Drive conserva la **cronologia versioni** del file per recuperare eventuali errori.

## Divisione delle spese e saldi tra i membri
Ogni spesa ha un **pagatore** (un membro, oppure «conto condiviso») e dei **partecipanti** che se la dividono in parti uguali (il resto in centesimi è assegnato in modo deterministico). Ogni partecipante diverso dal pagatore deve la sua quota al pagatore; se il pagatore non è tra i partecipanti, ha anticipato tutto per gli altri. Le spese pagate dal «conto condiviso» o senza partecipanti non generano debiti. Un **giroconto tra due conti personali di membri diversi** conta come rimborso. Statistiche mostra i saldi netti per ogni coppia di membri, del mese e complessivi, con il pulsante «Rimborsa».

## Struttura
```
src/types.ts        schema tipizzato
src/lib/            defaults neutri, calcoli (saldi, statistiche, pareggio), merge/validazione, mutazioni pure
src/sync/           google.ts (token GIS) · drive.ts (REST) · engine.ts (ciclo di sync)
src/store/          stato + cache locale
src/components/     UI riusabile, form, Gate (login + ricerca/creazione della famiglia), FamilyCard, FolderPicker
src/pages/          Transazioni, Statistiche, Conti, Impostazioni, Categorie
```
