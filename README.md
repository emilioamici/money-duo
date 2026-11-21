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
- **Nuova transazione:** uscite, entrate e trasferimenti, con **tag** liberi (suggeriti quelli già usati, ricercabili); modifica/eliminazione con ricalcolo immediato dei saldi.
- **Nuovo split:** una spesa condivisa, **pagata da una o più persone, ognuna dal proprio conto** (come in Splitwise) e divisa tra i partecipanti in parti uguali, **importi precisi** o **percentuali**; anteprima di chi deve cosa.
- **Dashboard:** navigazione mensile, filtri (Tutti / Condivisi / singolo membro), conto e ricerca testuale; statistiche per categoria; **grafico dell'andamento della liquidità nell'anno** (fine di ogni mese, con tooltip, tabella e cambio anno); **saldi tra i membri** con registrazione del rimborso.
- **Notifiche:** quando un altro membro aggiunge una transazione che ti riguarda, un conto in comune, o condivide un conto con te (vedi sotto).
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

## Notifiche
Ricevi una notifica quando **un altro membro**:
1. aggiunge una **transazione** su un conto in comune o condiviso con te, oppure una spesa **divisa con te** (con la tua quota);
2. aggiunge un **conto in comune**;
3. **condivide con te un conto** (nuovo, oppure un conto esistente che ora ti include).

Le tue modifiche non notificano mai, e nemmeno i conti personali degli altri. La transazione divisa con te è visibile nel tuo elenco anche se è su un conto che non vedi.

Come funziona, senza server: ogni dispositivo confronta i dati appena ricevuti da Drive con quelli che aveva e ne ricava le notifiche (`src/lib/notifications.ts`, funzione pura e testata). Il collegamento iniziale a un database non genera notifiche. Quelle perse con l'app chiusa compaiono alla riapertura, alla prima sincronizzazione.
- **Nell'app:** campanella con contatore, elenco (tocco = apre la transazione o i Conti) e un avviso quando arrivano con l'app in primo piano. Sono salvate per famiglia e per membro su quel dispositivo.
- **Del dispositivo:** si attivano in *Impostazioni → Notifiche → Attiva notifiche* (un solo interruttore) (Android, desktop; su iPhone serve iOS 16.4+ con l'app aggiunta alla schermata Home) e partono solo se l'app è in background.

> **Limite (senza server push):** il sito è statico e non ha un server, quindi non c'è un push che sveglia il telefono ad app chiusa. Per averlo, vedi «Server delle notifiche push» qui sotto. L'app controlla Drive ogni 2 minuti finché è aperta o in background (i browser possono rallentare o sospendere i timer) e la sessione Google dura 1 ora (vedi «Sessione Google»). Un push vero richiederebbe un piccolo backend (Web Push + notifiche di modifica di Drive).

## Server delle notifiche push (facoltativo)
Per ricevere le notifiche **anche con l'app chiusa** serve un piccolo server, gratuito su **Cloudflare Workers** (codice in `worker/`, guida passo-passo in [`worker/README.md`](worker/README.md)). È il Web Push standard, cifrato fino al dispositivo; il server conosce solo gli iscritti e **non ha accesso a Drive**: a ogni richiesta verifica il token Google di chi scrive e che abbia accesso al database della famiglia. Quando fai una modifica, la tua app comunica al server chi avvisare, con le stesse regole delle notifiche nell'app. Si attiva per dispositivo in *Impostazioni → Notifiche*. Lo stesso Worker può anche rendere persistente l'accesso Google (vedi «Sessione Google»). Senza server l'app funziona come prima.

La notifica push parte **dopo che i dati sono arrivati su Drive** (anche per le spese fatte offline): finché non c'è rete restano in coda sul dispositivo, e vengono scartate se la spesa viene eliminata prima dell'invio.

**Mese o anno.** Toccando il mese in alto (Transazioni e Statistiche) si apre un selettore con i 12 mesi: scegli un mese, oppure tocca l'**anno** per selezionare l'intero anno. In vista annuale le frecce scorrono di anno e le statistiche sommano tutto l'anno.

**Copia, preferiti, swipe e proposte.**
- **Swipe sulla riga** (Transazioni): scorrendo verso sinistra compaiono *Modifica*, *Copia* ed *Elimina* (l'eliminazione chiede conferma). Si richiude toccando altrove.
- **Copia:** apre una nuova transazione con gli stessi dati (anche split e pagamenti multipli) e la **data di adesso**; si può copiare anche dal form di modifica.
- **Preferiti:** nel form di modifica la stella aggiunge (o toglie) la transazione ai preferiti. Dal menu **+ → Preferiti** (sul computer: *Preferiti* nella barra laterale) si sceglie un preferito e si apre il form di copia con la data di oggi. I preferiti sono **personali** (ognuno vede i suoi, quindi i conti privati restano tali) e vivono nel file di Drive, quindi su tutti i dispositivi.
- **Titoli già usati:** mentre scrivi il titolo compaiono le proposte (prima quelli che iniziano con il testo, poi quelli che lo contengono).
- **Comportamento da app su mobile:** la pagina non scorre né rimbalza in orizzontale.

**Filtri, dettaglio conto e impostazioni.**
- **Filtri** (Transazioni, icona accanto alla campanella): tipo (uscite, entrate, trasferimenti), conti, importo minimo e massimo, categorie (una categoria principale include le sue sottocategorie), tag e «solo spese condivise». I criteri si combinano; l'anteprima nel pulsante mostra quanti risultati ci sono. Il badge sull'icona e la riga «N filtri attivi» ricordano che la lista è filtrata; i filtri restano finché non li azzeri.
- **Conti:** toccando un conto si apre il suo dettaglio (saldo e movimenti del mese o dell'anno scelto). Scorrendo un conto verso sinistra compaiono *Modifica*, *Escludi dal totale* (o *Includi*) e *Nascondi* (o *Mostra*).
- **Impostazioni** a schede che si aprono e si chiudono: Famiglia, Sincronizzazione e account, Notifiche, Backup e dati; *Categorie* resta una schermata a parte. Da chiuse mostrano un riepilogo; lo stato aperto/chiuso si ricorda su ogni dispositivo.

**Rimborsi con PayPal.** Ogni membro può indicare il proprio nome **PayPal.Me** (Impostazioni → Famiglia → «Il tuo PayPal»; basta anche incollare il link `paypal.me/…`). Nelle Statistiche, accanto a «Rimborsa», un debito verso chi ha collegato PayPal mostra il pulsante **PayPal**: apre `paypal.me/<nome>/<importo>EUR` con l'importo già impostato e, nell'app, il rimborso già compilato da salvare. Il nome PayPal.Me è visibile a tutta la famiglia (vive nel file su Drive, campo `paypal` del membro).
Limite: PayPal.Me non permette di preselezionare «Per amici e familiari» da link; quel passaggio si sceglie in PayPal al momento del pagamento (con un conto personale la scelta è proposta da PayPal).

**Icona e stile.** L'icona dell'app (due gattini salvadanaio) e la palette derivano dall'immagine scelta: menta, crema e beige, con il marrone caldo del contorno per il testo e un verde-menta scuro come colore principale (chiaro in modalità scura). Tutti i colori del testo rispettano il contrasto minimo 4,5:1. Angoli più morbidi e carattere arrotondato dove il sistema lo offre (iPhone). Le icone (`public/icon-*.png`, `apple-touch-icon.png`, versione adattiva per Android) sono ricavate dall'immagine originale.

**Dividere una spesa già inserita.** Aprendo una spesa (uscita) in modifica, «Dividi questa spesa» la trasforma in uno split: importo, titolo, note, tag e conto restano, comprese le modifiche non ancora salvate; nel form dello split scegli chi ha pagato e come dividere. È la stessa transazione (non se ne crea una nuova).

**Temi e gattini.** In Impostazioni → Aspetto: **Modalità Mochi** (chiara: crema e arancio, dal gatto bianco e arancione dell'icona), **Modalità Zenitsu** (scura: ardesia e dorato, dal gatto grigio scuro) o *Automatico* (segue il telefono). La scelta è salvata sul dispositivo e applicata al primo disegno, senza lampo; segue anche la barra di stato. Il contrasto del testo è ≥ 4,5:1 in entrambi. I due gattini, sempre sorridenti, accompagnano la navigazione: nell'accesso, nelle schermate vuote e mentre fanno capolino sopra le schede di Transazioni, Statistiche, Conti e Impostazioni (immagini in `public/cats/`, ritagliate dall'icona).
**Statistiche.** In alto i **saldi tra i membri** e sotto la **liquidità**, entrambi a scomparsa: chiusi mostrano solo «Sara deve a Emilio · 112,29 €» (in **verde** se a te devono dei soldi, in **rosso** se sei tu a doverli; se i saldi sono tutti pari, «✓ Tutti i saldi tra i membri sono in ordine» in nero) e la liquidità di adesso con la variazione da inizio anno; aperti, il dettaglio (mese e complessivo con *Rimborsa*/PayPal) e il grafico. Lo stato aperto/chiuso si ricorda sul dispositivo.

**Lingue.** L'app è in **italiano** e **inglese**: in Impostazioni → Aspetto → *Lingua* si sceglie Automatico (segue la lingua del telefono), Italiano o English; il cambio è immediato e si ricorda sul dispositivo. Cambiano testi, date e importi (`1.234,56 €` / `€1,234.56`; nei campi si accetta sia la virgola sia il punto decimale). Tradurre un testo: nel codice si usa `t('testo in italiano')`, e in `src/i18n/en.ts` la chiave è quel testo; un test controlla che ogni testo usato abbia la traduzione. Le categorie e i nomi dei conti che hai già nel database restano come li hai scritti (sono dati tuoi); quelli di una famiglia nuova nascono nella lingua in uso. Le notifiche arrivano nella lingua del dispositivo di chi le ha generate (per i push, di chi ha fatto la modifica). La pagina privacy resta in italiano.

## Famiglia: codice, link d'invito e ponte

Come in Clean Duo, un invitato entra in tre modi: la famiglia a cui è stato invitato compare da sola dopo l'accesso con Google; oppure apre il **link d'invito** (`#join=<codice>`); oppure incolla il **codice famiglia**. Il codice e il link si trovano in *Impostazioni → Famiglia* (copia e condividi). L'app prova nell'ordine: accesso diretto al file, **ponte del Worker** (se il capofamiglia ha l'accesso persistente) e, per ultimo, il Selettore di Google limitato a quel file (un tocco). Dettagli e privacy in `worker/README.md`.

## Stile (design system di Clean Duo)

Money Duo segue il design system di `clean-duo` (`DESIGN_SYSTEM.md`): token RGB per i colori (`bg`, `surface`, `ink`, `muted`, `line`, `brand`, `inc`, `exp`, `trf`, più `warn` per gli avvisi gialli), nessun `dark:` e nessun colore fisso nei componenti, contenuto su card piene e vetro solo su barra, pulsanti, fogli e avvisi, sfondo con tre macchie animate, fallback per «Riduci trasparenza» e «Riduci movimento».

L'unica eccezione ai token di colore è il simbolo di Wallet (`WalletGlyph`), disegnato con i colori dell'icona dell'app Wallet per riconoscere al volo le spese arrivate da lì; il suo badge usa i toni blu del tema (`trf`). Anche le transizioni sono quelle di Clean Duo, con Framer Motion (`LazyMotion`: le funzioni di layout si caricano in un file a parte e «Riduci movimento» le spegne): goccia della barra e indicatore dei segmenti con `layoutId` e molla, cambio scheda con dissolvenza, scorrimento e sfocatura, righe che entrano ed escono, fogli e avvisi con molla. Differenze volute: la pagina scorre nella finestra (non in un contenitore unico) e su schermi larghi c'è una barra laterale di vetro invece della cornice «telefono».

## Apple Wallet: spese Apple Pay in automatico

Con il server delle notifiche (cartella `worker`) attivo, ogni persona può collegare i propri pagamenti con Apple Pay: da *Impostazioni → Apple Wallet* si attiva e si copia il proprio indirizzo personale, poi sull'iPhone si crea un'automazione «Transazione» nell'app Comandi (le istruzioni sono nella scheda). Ogni pagamento diventa una transazione **senza categoria e con un segno giallo «Da approvare»** (o «Da completare» finché la carta non è associata a un conto: le carte usate compaiono in *Impostazioni → Apple Wallet → Le tue carte* e si associano con un tocco). In *Impostazioni → Apple Wallet → I tuoi esercenti* ogni esercente (man mano che arrivano le spese) si può **legare a un preferito**: da quel momento le sue spese arrivano già compilate come il preferito, con l'importo pagato, e **già approvate**: la si approva dal menu a scorrimento, oppure la si apre e la si salva. Dettagli e privacy in `worker/README.md`.

## Permesso ristretto su Drive (`drive.file`)
Di base l'app chiede l'accesso a **tutto Drive**. Con il selettore di Google configurato chiede invece solo **`drive.file`**: vede soltanto i file che ha creato lei (come il database) o che scegli tu con il selettore. Gli altri file non sono accessibili. Come effetto collaterale `drive.file` è un permesso non sensibile: l'app può essere pubblicata senza verifica e senza l'avviso «app non verificata».

**Attivarlo** (una volta sola):
1. *Google Cloud Console → API e servizi → Libreria*: abilita **Google Picker API**.
2. *Credenziali → Crea credenziali → Chiave API*: limitala a **Siti web** (`https://<utente>.github.io/*`) e alla sola **Google Picker API**.
3. Il **numero del progetto** è in *Dashboard → Informazioni sul progetto*.
4. In GitHub, *Settings → Secrets and variables → Actions → Variables*: crea `VITE_GOOGLE_API_KEY` (la chiave) e `VITE_GOOGLE_APP_ID` (il numero del progetto), poi rilancia il deploy. Sono valori pubblici.
5. Dopo aver provato, in *Google Auth Platform → Accesso ai dati* aggiungi `drive.file` e togli `drive`.
6. Se usi l'accesso persistente, ripubblica il Worker (`npx wrangler deploy`) e su ogni dispositivo disattiva e riattiva l'accesso persistente (così il token di rinnovo diventa quello ristretto); poi puoi revocare il vecchio permesso su myaccount.google.com/permissions.

**Cosa cambia nell'uso:** il capofamiglia non vede differenze (il suo database l'ha creato l'app). Chi viene invitato, al primo accesso sceglie il file con **«Scegli il database di famiglia»** (lo trova in «Condivisi con me»); poi l'app lo ricorda. La cartella del nuovo database si sceglie con il selettore di Google; *Sposta…* non c'è più (il file si sposta da Drive e l'app lo trova lo stesso). Se Google non riconosce più il permesso su un file, in Sincronizzazione compare «Scegli di nuovo il database». Senza le due variabili tutto resta come prima.

## Schema del JSON (`schemaVersion: 2`)
```jsonc
{
  "schemaVersion": 2,
  "meta": { "dbId": "uuid", "createdAt": "ISO", "updatedAt": "ISO", "updatedBy": "email", "revision": 0 },
  "family": { "name": "Famiglia", "updatedAt": "ISO" },
  "members": [{ "id", "name", "email": "account Google | null", "color": "#6366f1", "active": true, "joinedAt": "ISO | null", "paypal": "nome PayPal.Me | null", "updatedAt" }],
  "accounts": [{ "id", "name", "group": "cash|bank|card|savings|investment|other",
                 "members": ["<id membro>"] /* [] = tutta la famiglia, 1 = personale */,
                 "initialBalance": 0, "excludeFromTotal": false, "hidden": false, "order": 0, "by": "<id membro>", "createdAt", "updatedAt" }],
  "categories": [{ "id", "name", "type": "expense|income", "parentId": null, "icon": "🛒", "color": "#f97316",
                   "hidden": false, "order": 0, "updatedAt" }],
  "transactions": [{ "id", "type": "expense|income|transfer", "amount": 1250, "date": "ISO",
                     "accountId", "toAccountId": null, "categoryId": null, "title": "", "note": "",
                     "paidBy": "<id membro> | null" /* null = conto condiviso */,
                     "participants": ["<id membro>"] /* chi si divide la spesa; [] = personale */,
                     "payments": [{ "member": "<id membro>", "accountId": "<conto da cui ha pagato>", "amount": 6000 }] /* solo se pagata da più persone; altrimenti null: vale accountId + paidBy */,
                     "tags": ["vacanza"],
                     "splitMode": "equal|amount|percent", "splitValues": { "<id membro>": 5000 } /* centesimi (amount) o centesimi di punto, 5000 = 50% (percent); null se equal */,
                     "by": "<id membro che l'ha aggiunta>", "createdAt", "updatedAt" }],
  "favorites": [{ "id", "by": "<id membro: i preferiti sono personali>", "type", "amount", "accountId", "toAccountId", "categoryId", "title", "note",
                  "paidBy", "participants", "splitMode", "splitValues", "payments", "tags", "createdAt", "updatedAt" }] /* modelli di transazione; assente nei file più vecchi (si legge come []) */,
  "deleted": { "<id>": "ISO" }
}
```
Gli importi sono **interi in centesimi**. `deleted` contiene le lapidi che permettono di propagare le eliminazioni tra dispositivi. I file `schemaVersion: 1` (profili a/b/shared) vengono **migrati automaticamente** e in modo deterministico: i due profili diventano i membri `a` e `b`, e al primo accesso l'app chiede «Chi sei?» per associarli agli account Google.

Il file su Drive è marcato con la proprietà pubblica `moneyduo=db` (e nominato `moneyduo-db-<famiglia>.json`), così l'app lo ritrova anche quando è condiviso da altri.

## Sessione Google
Il token d'accesso di Google dura **1 ora** e non si può allungare dal solo sito statico. Nella cache del dispositivo restano la famiglia collegata, i dati e l'email, quindi l'app si apre subito con i tuoi dati anche offline.

**Senza server:** l'app **rinnova il token in silenzio** ai tocchi dell'utente, negli ultimi 15 minuti di validità (o dopo la scadenza), con `prompt: 'none'` (funziona se sei ancora collegato a Google e hai già dato il consenso; il browser può mostrare un popup che si chiude subito). Se non è possibile, o la sessione è scaduta, compare **a tutto schermo la schermata di accesso** e i dati restano nascosti finché non accedi di nuovo (l'app resta montata sotto, inerte: quello che stavi scrivendo non si perde). Offline, o con il server di accesso non raggiungibile, si restano sui dati locali. Il token resta in `sessionStorage`.

**Con il server (facoltativo): accesso persistente.** Il Worker Cloudflare conserva, cifrato, un token di rinnovo e l'app ottiene token freschi da sola, **senza popup e anche in background**. Richiede il client secret nel Worker e di pubblicare l'app OAuth in produzione (in *Testing* i token di rinnovo scadono dopo 7 giorni): la guida con i compromessi di sicurezza è in [`worker/README.md`](worker/README.md#accesso-persistente-facoltativo).

## Copia locale e sicurezza dei dati
La copia locale dei dati sta in **IndexedDB** (non in `localStorage`, che ha un limite di circa 5 MB e su iPhone si riempiva) e ricorda a quale **versione del file su Drive** corrisponde. Regola di sicurezza: **se la copia manca o non corrisponde all'ultima versione di Drive, l'app rilegge Drive prima di inviare qualsiasi cosa** (con la copia persa adotta Drive così com'è; con una copia datata unisce). Una copia vuota non può quindi sovrascrivere il file. Se il browser non riesce a salvare la copia, Impostazioni → Sincronizzazione lo segnala. Drive conserva comunque le versioni precedenti del file (*Gestisci versioni*).

## Come funziona la sincronizzazione
- Ogni modifica è salvata subito in locale e inviata a Drive dopo ~2 s; si controlla anche ogni 2 minuti, al ritorno in primo piano e alla riconnessione.
- Ciclo: legge la `version` del file → se è cambiata scarica e fa **merge per record** (vince l'`updatedAt` più recente; un'eliminazione più recente batte una modifica) → carica solo se ci sono differenze → memorizza la nuova `version`. Non c'è sovrascrittura cieca dell'intero file.
- Stati visibili: *Sincronizzato, Da inviare, Sync…, Offline, Riconnetti, Errore*. Offline le modifiche restano in cache e partono al ritorno della rete.
- **Limiti noti**: (1) il token Google dura circa 1 ora e un sito statico non può rinnovarlo in background: allo scadere compare "Riconnetti" (un tap) e nel frattempo i dati restano al sicuro in locale; (2) due scritture nello stesso istante possono teoricamente incrociarsi, ma il merge per record lo rende molto improbabile e Drive conserva la **cronologia versioni** del file per recuperare eventuali errori.

## Divisione delle spese e saldi tra i membri
Ogni spesa ha un **pagatore** (un membro, oppure «conto condiviso») e dei **partecipanti** che se la dividono. La divisione può essere:
- **parti uguali** tra i membri scelti (il resto in centesimi è assegnato in modo deterministico);
- **importi precisi**: quanto spetta a ciascuno in euro (la somma deve essere uguale all'importo della spesa);
- **percentuali**: la quota di ciascuno in % (la somma deve fare 100%); il risultato è arrotondato al centesimo con somma sempre esatta (metodo del resto più alto).

Con **più pagatori** ogni persona indica il conto da cui ha pagato e quanto (la somma deve fare il totale): ogni conto viene addebitato del proprio pagamento, e per ciascun membro il saldo è *quanto ha pagato − la sua quota*. Chi ha il saldo negativo deve la differenza a chi ha il saldo positivo (assegnazione deterministica); con un solo pagatore equivale a «ognuno deve la sua quota a chi ha pagato». Ai pagatori si propongono i conti che includono quel membro **e che tu vedi**.

Il form mostra quanto resta da assegnare e l'anteprima di chi deve cosa. Chi lascia vuoto un valore non partecipa; se chi ha pagato non partecipa, ha anticipato tutto per gli altri. Ogni partecipante diverso dal pagatore deve la sua quota al pagatore. Le spese pagate dal «conto condiviso» o senza partecipanti non generano debiti. Un **trasferimento tra due conti personali di membri diversi** conta come rimborso. Statistiche mostra i saldi netti per ogni coppia di membri, del mese e complessivi, con il pulsante «Rimborsa».

## Struttura
```
src/types.ts        schema tipizzato
src/lib/            defaults neutri, calcoli (saldi, statistiche, pareggio), merge/validazione, mutazioni pure
src/sync/           google.ts (token GIS) · drive.ts (REST) · engine.ts (ciclo di sync)
src/store/          stato + cache locale
src/components/     UI riusabile, form, Gate (login + ricerca/creazione della famiglia), FamilyCard, FolderPicker, Notifications
src/pages/          Transazioni, Statistiche, Conti, Impostazioni, Categorie
worker/             server delle notifiche push (Cloudflare Worker) con guida e test
```
