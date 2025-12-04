
<p align="center">
  <a href="https://x.com/Zordtoshi" target="_blank">
    <img src="https://unavatar.io/x/Zordtoshi"
         alt="Zordtoshi on X"
         width="120" />
  </a>
</p>

<p align="center">
  <a href="https://x.com/Zordtoshi" target="_blank">
    <img src="https://img.shields.io/badge/Follow-@Zordtoshi-000000?style=for-the-badge&logo=x&logoColor=white"
         alt="Follow @Zordtoshi on X" />
  </a>
</p>

# Zordinals Viewer & ZNode Tools  
A complete **local‑first**, **self‑hosted** toolkit for Zcash full node runners.  
Everything runs **100% on your machine**, with **zero third‑party APIs**.

---

# ✨ What’s Included

- **Zordinals Viewer** – load inscription IDs (`txid i0`) instantly  
- **Explore Zords** – grid view of everything in your `/content` folder  
- **Metadata Tools** – build, fix, convert or merge metadata  
- **HashLips → Zordinals Converter** – automatic collection converter  
- **Trait Definition Lab** – 20×20 fingerprint grid for traits  
- **ZNode Status Dashboard** – balances, UTXOs, mempool, sends  
- **Dev CLI Console** – GUI wrapper for `zcash-cli`  
- **Info + Theory Pages** – documentation & Zordinal explanation  
- **Local caching** of decoded inscriptions (`content/`)  
- **Local rawdata** for inspect logs (`content/rawdata/`)

---

# 🚀 Features Overview (Full Detail)

## 🔍 1. Zordinals Viewer (`assets-page/index.html`)
The main inscription viewer.

### How it works  
1. Enter any inscription ID:  
   ```
   <txid>i0
   ```
2. If the file already exists in `/content/<id>.*`, it's loaded instantly.  
3. Otherwise:
   - `decode.js <id>` runs  
   - Data is pulled from your local Zcash node  
   - Stored into `/content/<id>.<ext>`  
   - Displayed in the viewer  

### Supports  
- **Images**: PNG, JPG, WEBP, GIF  
- **HTML** (fully executed inside iframe)  
- **SVG** (inline or HTML-wrapped)  
- **TXT / Markdown** rendered as text  
- **JSON** with auto‑overlay:

### Viewer Tools  
- **Fullscreen mode**  
- **Download** (saves the exact local file)  
- **Info terminal**:  
  - Runs `inspect.js`  
  - Saves raw tx decoding under `content/rawdata/<id>.json`  
  - Shows scriptSig, inputs, outputs, OP_RETURNs, sizes, markers  

---

## 🗂️ 2. Explore Zords (`assets-page/explore.html`)
A modern gallery-style explorer for the entire `/content` directory.

### Features  
- Auto-scans every file under `/content`  
- Grid previews with:
  - Live image or HTML rendering  
  - JSON overlays  
  - TXID badge (+ copy)  
  - Info button → modal  

### Modal Viewer  
- Full preview (HTML runs scripts; SVG executes)  
- Type + size  
- Buttons:
  - COPY TXID  
  - COPY IMAGE URL  
  - DOWNLOAD  
  - SHOW RAW  

---

## 🧬 3. Metadata Tools (`assets-page/meta.html`)
A full metadata workshop used for building and repairing collections.

### Modes

#### **A. BASIC MODE – Build clean metadata**
- Define:
  - Collection name  
  - Description  
  - Supply / ID range   

#### **B. ADVANCED MODE – Edit or repair**
- Load JSON from file or paste in  
- Add/remove/rename attributes  
- Re‑index IDs  
- Split combined arrays → 1 file per token  
- Merge many files → big array  
- Attach inscription IDs to each metadata file  
- Run validators

#### **C. HASHLIPS → Zordinals Converter**
- Drop in `_metadata.json` from HashLips  
- Produces:
  - Clean `<id>.json` per token  
  - Proper `master.json`  
  - UI to map inscription IDs to each token  

Perfect for migrating old collections on-chain.

---

## 🎨 4. Define Traits (`assets-page/define.html`)
A pixel analyzer for generative collections.

### Features  
- 20×20 grid (scaled pixel selector)  
- Click = add pixel  
- CTRL-click = remove pixel  
- Auto-detect traits across entire folder of images  
- Saves per-trait “fingerprints”:
```json
{
  "trait_type": "Hat",
  "value": "Red Cap",
  "positions": [{ "x": 12, "y": 3 }, ...]
}
```

### Tools included  
- Trait list editor  
- Import/export project  
- Per-image trait detection  
- Automatic blue/yellow pixel highlights  
- Merging trait structures for metadata  

Perfect for building rarity charts or advanced explorers.

---

## 🧭 5. ZNode Status (`assets-page/znode-status.html`)
Full dashboard for your local Zcash node.

### Node Panels  
- Chain / Height / Best block  
- Difficulty  
- Version/build  
- Peer count  
- Mempool with fee + size  

### Wallet Panels  
- Balances for all wallets  
- Unconfirmed balance  
- Label-aware imported keys  
- Wallet UTXOs:
  - Checkbox coin-control  
  - Row-click JSON modal  
  - Filter by wallet  

### Sending ZEC  
- Select wallet  
- Auto-fee “max minus fee” logic  
- Error display  
- Confirmation counter  
- Success toasts  

### Import Private Keys  
- Label support  
- Optional rescan  
- Toast: “Zwallet Zimported Zuccessfully”  

---

## 🖥️ 6. Dev CLI Console (`assets-page/dev-cli.html`)
GUI wrappers for Zcash RPC.

### Each command has:  
- Description  
- Parameter inputs  
- Example CLI string  
- Run button → backend RPC  
- Raw JSON output  
- Copy response button  

### Included Commands  
```
getblockchaininfo
getnetworkinfo
getconnectioncount
validateaddress
dumpprivkey
importprivkey
getbalance
listunspent
gettransaction
getrawtransaction
decoderawtransaction
getblockhash
getblock
```

You can add more in seconds — just edit `dev-cli.html`.

---

## ℹ️ 7. Info Page (`assets-page/info.html`)
Covers:

- How Viewer loads inscriptions  
- How Explorer works  
- Metadata + Traits workflow  
- Using ZNode Status  
- How CLI Tools work  
- Sending & receiving tips  
- Theory links  
- Tip jar:

```
t1J5WgQtT3zetUjCsxknsBxMZQexMUAT9PL
```

---

## 📚 8. Zordinal Theory (`assets-page/zordinals-theory.html`)
Deep-dive into:

- How Zordinals adapt ordinal theory to Zcash  
- Why data is chunked + stored on-chain  
- Why off-chain content ≠ a Zord  
- Zimmutability  
- Structure of inscription payloads  
- Reconstruction logic  
- Future-proofing of on-chain art  

---

# 📁 Project Structure

```
.
├─ viewer.js              # Server + routes
├─ decode.js              # Decode inscription data
├─ inspect.js             # Inspect raw tx / scriptSig
├─ nodeinfo.js            # RPC information
├─ .env                   # Node RPC config
│
├─ content/               # All local Zords
│  ├─ <id>.png/.html/.json
│  ├─ rawdata/<id>.json   # inspect.js cache
│  └─ master/master.json  # masterlog of inscriptions decoded and in /content 
│
└─ assets-page/           # All frontend pages
   ├─ index.html          # Zordinals Viewer
   ├─ explore.html        # Explore Zords
   ├─ meta.html           # Metadata Tools
   ├─ define.html         # Define Traits
   ├─ znode-status.html   # Dashboard
   ├─ dev-cli.html        # CLI GUI
   ├─ info.html           # Info page
   └─ zordinals-theory.html #Zordinals Theory
```

---

# ⚙️ Requirements

- **Zcash full node (`zcashd`)**  
- **RPC enabled**  
- **Node.js 18+**

Your `~/.zcash/zcash.conf` must include:

```
rpcuser=youruser
rpcpassword=yourpass
rpcallowip=127.0.0.1
txindex=1
server=1
```

`txindex=1` is **required** for inscription decoding.

---

# 🔧 Setup

### 1. Clone
```
git clone https://github.com/Zordtoshi/zordinals-node-tools.git
cd zordinals-node-tools
```

### 2. Install
```
npm install
```

### 3. Configure `.env`
```
PORT=4000
NODE_RPC_URL=http://127.0.0.1:8232
NODE_RPC_USER=youruser
NODE_RPC_PASSWORD=yourpass
ZORDS_DIR=./content
```

### 4. Start Zcash node
```
zcashd
zcash-cli getblockchaininfo
```

### 5. Start Toolkit
```
node viewer.js
```

Then open:
```
http://localhost:4000
```

---

# 🔒 Security Notes

- Do **NOT** expose this app or your RPC port publicly  
- Treat these as nuclear material:
  - `dumpprivkey`
  - `z_exportwallet`
  - Any wallet exports  

Your node == your keys.

---

# ❤️ Credits

Created by **Zordtoshi**.  

If this toolkit helped you, tips appreciated:

```
t1J5WgQtT3zetUjCsxknsBxMZQexMUAT9PL
```

More tools coming soon.

