# AnimeUnity Media Provider Module

Modulo di integrazione generico per l'estrazione e lo streaming dal catalogo di AnimeUnity su player ed aggregatori multimediali mobile compatibili (V3 Handler Specification).

---

## 📦 Guida alla Creazione del Pacchetto ZIP (Server Package)

Per utilizzare questo modulo all'interno di lettori e aggregatori multimediali compatibili, è necessario creare un **archivio ZIP locale**.

### Passo 1: Preparazione dei file
Assicurati che nella cartella siano presenti i seguenti file:
- `module.json` (descrittore e metadati del modulo)
- `index.js` (logica di estrazione e provider)
- `icon.png` (icona del modulo, opzionale ma consigliata)

### Passo 2: Creazione dell'archivio ZIP
1. Seleziona **direttamente i file** (`module.json`, `index.js`, `icon.png`).
2. Crea un archivio comprimendoli in formato `.zip` (es. `animeunity.zip`).
   > ⚠️ **IMPORTANTE**: Comprimi direttamente i singoli file, **NON la cartella principale**. Aprendo il file `.zip`, `module.json` e `index.js` devono trovarsi subito nella radice dell'archivio.

### Passo 3: Importazione nell'applicazione
1. Trasferisci il file `animeunity.zip` sul tuo dispositivo mobile (tramite AirDrop, iCloud, Telegram, Email o cavo USB) e salvalo nella memoria interna o nell'app **File**.
2. Apri la sezione **Gestione Moduli / Fonti** del tuo lettore multimediale.
3. Seleziona l'opzione **Importa Pacchetto Locale** (o *Choose Server Package*).
4. Seleziona il file `animeunity.zip` salvato sul dispositivo per completare l'installazione.

---

## ⚡ Caratteristiche del Modulo
- **Ricerca Catalogo**: ricerca titoli e navigazione dei contenuti.
- **Estrattore Episodi**: estrazione dei dettagli, copertine e lista episodi.
- **Stream Extractor (Vixcloud)**: estrazione dinamica dei flussi `.m3u8` HLS con gestione degli header e Referer corretti.

---

## 📄 Licenza
Rilasciato sotto licenza [MIT](LICENSE).