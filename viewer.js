#!/usr/bin/env node

// Zordinals Viewer + API server

require('dotenv').config();

const express = require('express');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
const axios = require('axios');
const mime = require('mime-types');

const app = express();

// ---------- Paths ----------

const ROOT_DIR = __dirname;
const CONTENT_DIR = path.join(ROOT_DIR, 'content');
const RAWDATA_DIR = path.join(CONTENT_DIR, 'rawdata');
const ASSETS_DIR = path.join(ROOT_DIR, 'assets');
const PAGES_DIR = path.join(ROOT_DIR, 'assets-page');
const ENV_PATH = path.join(ROOT_DIR, '.env');

if (!fs.existsSync(CONTENT_DIR)) fs.mkdirSync(CONTENT_DIR, { recursive: true });
if (!fs.existsSync(RAWDATA_DIR)) fs.mkdirSync(RAWDATA_DIR, { recursive: true });
if (!fs.existsSync(ASSETS_DIR)) fs.mkdirSync(ASSETS_DIR, { recursive: true });
if (!fs.existsSync(PAGES_DIR)) fs.mkdirSync(PAGES_DIR, { recursive: true });

app.use(express.json());

// Static folders
app.use('/assets', express.static(ASSETS_DIR));
app.use('/assets-page', express.static(PAGES_DIR));

// Allow extension-less /content/<inscriptionId> URLs (e.g. /content/<txid>i0)
// to resolve to the actual file on disk: <txid>i0.<ext>
app.get('/content/:id', (req, res, next) => {
  const id = (req.params.id || '').trim();

  // If there is already a dot, this is a real filename -> let static handler deal with it.
  if (!id || id.includes('.')) {
    return next();
  }

  try {
    const entries = fs.readdirSync(CONTENT_DIR);
    const match = entries.find((name) => name.startsWith(id + '.'));

    // No matching file, fall through to static (which will 404)
    if (!match) {
      return next();
    }

    const fullPath = path.join(CONTENT_DIR, match);
    return res.sendFile(fullPath);
  } catch (err) {
    console.error('Error resolving /content alias for', id, err);
    return next(err);
  }
});
app.use('/content', express.static(CONTENT_DIR));

function ensureContentDir() {
  if (!fs.existsSync(CONTENT_DIR)) {
    fs.mkdirSync(CONTENT_DIR, { recursive: true });
  }
}

// Find a saved inscription file in /content by inscription id or txid
// e.g. "01a4...99232i0" → content/01a4...99232i0.svg
function findContentFile(idOrTxid) {
  if (!idOrTxid) return null;

  const base = idOrTxid.toLowerCase();
  const cleaned = base.replace(/i\d+$/, "");

  const candidates = [...new Set(
    [base, cleaned, cleaned ? `${cleaned}i0` : null].filter(Boolean)
  )];

  try {
    ensureContentDir();
    const entries = fs.readdirSync(CONTENT_DIR);
    for (const name of entries) {
      const lower = name.toLowerCase();
      for (const cand of candidates) {
        if (!cand) continue;
        if (lower.startsWith(cand + ".")) {
          return path.join(CONTENT_DIR, name);
        }
      }
    }
  } catch (e) {
    console.warn("findContentFile error:", e.message);
  }

  return null;
}
// ---------- Helpers ----------

/**
 * Find a file in /Zords matching:
 *   <txid>.ext
 * and if txid has a suffix "i<number>" (e.g. inscription id),
 * also try <txidWithoutSuffix>.ext
 */
function findZordFile(txid) {
  if (!txid) return null;
  const base = txid.toLowerCase();
  const cleaned = base.replace(/i\d+$/, ''); // strip i0 / i123 etc

  const candidates = [...new Set(
    [base, cleaned, cleaned ? `${cleaned}i0` : null].filter(Boolean)
  )];


  const files = fs.readdirSync(CONTENT_DIR);
  for (const f of files) {
    const lower = f.toLowerCase();
    for (const cand of candidates) {
      if (!cand) continue;
      const prefix = cand + '.';
      if (lower.startsWith(prefix)) {
        return path.join(CONTENT_DIR, f);
      }
    }
  }
  return null;
}

function runScript(scriptName, args = []) {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(ROOT_DIR, scriptName);
    execFile(
      'node',
      [scriptPath, ...args],
      { maxBuffer: 20 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          err.stderr = stderr;
          return reject(err);
        }
        resolve({ stdout, stderr });
      }
    );
  });
}

// ---------- RPC helper ----------

let NODE_RPC_URL = process.env.NODE_RPC_URL || 'http://127.0.0.1:8232';
let NODE_RPC_USER = process.env.NODE_RPC_USER || '';
let NODE_RPC_PASS = process.env.NODE_RPC_PASS || '';

async function rpc(method, params = []) {
  if (!NODE_RPC_URL || !NODE_RPC_USER || !NODE_RPC_PASS) {
    throw new Error(
      'RPC not configured (NODE_RPC_URL / NODE_RPC_USER / NODE_RPC_PASS)'
    );
  }

  const payload = {
    jsonrpc: '1.0',
    id: 'zord-viewer',
    method,
    params,
  };

  const resp = await axios.post(NODE_RPC_URL, payload, {
    auth: {
      username: NODE_RPC_USER,
      password: NODE_RPC_PASS,
    },
  });

  if (resp.data.error) {
    const msg = resp.data.error.message || JSON.stringify(resp.data.error);
    throw new Error(msg);
  }

  return resp.data.result;
}


// ---------- /api/inscription/:txid ----------
// If file exists in /content, return metadata + URL.
// Otherwise run decode.js <txid> then look again.

app.get('/api/inscription/:txid', async (req, res) => {
  const rawTxid = (req.params.txid || '').trim();
  if (!rawTxid) {
    return res.status(400).json({ error: 'missing_txid' });
  }

  try {
    let filePath = findZordFile(rawTxid);
    let fromCache = true;

    if (!filePath) {
      console.log(
        `[decode] no local file for ${rawTxid}, running decode.js...`
      );
      try {
        await runScript('decode.js', [rawTxid]);
      } catch (err) {
        console.error('decode.js failed', err.stderr || err.message);
        return res.status(500).json({
          error: 'decode_failed',
          detail: err.stderr || err.message,
        });
      }

      filePath = findZordFile(rawTxid);
      fromCache = false;
    }

    if (!filePath) {
      console.error(
        `[api/inscription] still no file in /content after decode.js for ${rawTxid}`
      );
      return res.status(404).json({
        error: 'content_not_found',
        detail: 'File not found in /content after decode.js',
      });
    }

    const stat = fs.statSync(filePath);                // <-- get bytes
    const filename = path.basename(filePath);
    const ext = path.extname(filename).slice(1).toLowerCase();
    const contentType = mime.lookup(ext) || 'application/octet-stream';
    const url = `/content/${encodeURIComponent(filename)}`;

    const base = filename.split('.')[0];               // e.g. <genesisTxid>i0
    const inscriptionId = base;
    const genesisTxid = base.replace(/i\d+$/, '');

    res.json({
      requestTxid: rawTxid,                            // what the user typed
      txid: genesisTxid,                               // bare txid
      inscriptionId,                                   // full <txid>i0
      filename,
      url,
      ext,
      contentType,
      fromCache,
      sizeBytes: stat.size,                            // <-- bytes for viewer
      size: stat.size,                                 // (alias, for other UIs)
    });
  } catch (err) {
    console.error('[/api/inscription] error', err);
    res.status(500).json({
      error: 'internal_error',
      detail: err.message || String(err),
    });
  }
});


// ---------- /api/inspect/:txid ----------
// Cache inspect.js output into /Zords/rawdata/<txid>.json

app.get('/api/inspect/:txid', async (req, res) => {
  const txid = (req.params.txid || '').trim();
  if (!txid) {
    return res.status(400).json({ error: 'missing_txid' });
  }

  const outFile = path.join(RAWDATA_DIR, `${txid}.json`);

  try {
    if (fs.existsSync(outFile)) {
      const raw = fs.readFileSync(outFile, 'utf8');
      try {
        const parsed = JSON.parse(raw);
        return res.json({ fromCache: true, ...parsed });
      } catch {
        return res.json({ fromCache: true, rawText: raw });
      }
    }

    console.log(`[inspect] running inspect.js for txid ${txid}`);
    let result;
    try {
      result = await runScript('inspect.js', [txid]);
    } catch (err) {
      console.error('inspect.js failed', err.stderr || err.message);
      return res.status(500).json({
        error: 'inspect_failed',
        detail: err.stderr || err.message,
      });
    }

    const payload = {
      rawText: result.stdout || '',
      stderr: result.stderr || '',
      fromCache: false,
    };

    try {
      fs.writeFileSync(outFile, JSON.stringify(payload, null, 2), 'utf8');
    } catch (e) {
      console.warn('Failed to write rawdata cache', e.message);
    }

    res.json(payload);
  } catch (err) {
    console.error('[/api/inspect] error', err);
    res.status(500).json({
      error: 'internal_error',
      detail: err.message || String(err),
    });
  }
});

// ---------- /api/node/status ----------
// Zcash node RPC summary for Znode status page

app.get('/api/node/status', async (req, res) => {
  try {
    const [
      blockchainInfo,
      networkInfo,
      mempoolInfo,
      totalBalance,
      rawMempool,
    ] = await Promise.all([
      rpc('getblockchaininfo').catch(() => null),
      rpc('getnetworkinfo').catch(() => null),
      rpc('getmempoolinfo').catch(() => null),
      rpc('z_gettotalbalance').catch(() => null),
      rpc('getrawmempool', [true]).catch(() => null),
    ]);

    const connected = !!networkInfo;

    const wallets = [];
    if (totalBalance) {
      wallets.push({
        name: 'default',
        balance: totalBalance.total,
        transparent: totalBalance.transparent,
        private: totalBalance.private,
        unconfirmed: totalBalance.unconfirmed || 0,
      });
    }

    const pendingTxs = [];
    if (rawMempool && typeof rawMempool === 'object') {
      const entries = Object.entries(rawMempool).slice(0, 50);
      for (const [txid, info] of entries) {
        pendingTxs.push({
          txid,
          size: info.size,
          fee: info.fee,
          time: info.time,
          height: info.height,
          depends: info.depends,
        });
      }
    }

    res.json({
      connected,
      blockchainInfo,
      networkInfo,
      mempoolInfo,
      wallets,
      pendingTxs,
      mempoolTxCount: mempoolInfo ? mempoolInfo.size : pendingTxs.length,
      mempoolBytes: mempoolInfo ? mempoolInfo.bytes : undefined,
    });
  } catch (err) {
    console.error('[/api/node/status] error', err.message || err);
    res.status(500).json({
      connected: false,
      error: err.message || String(err),
    });
  }
});



// ---------- /api/wallet/import-privkey ----------
// Body: { privkey, label, rescan }

app.post('/api/wallet/import-privkey', async (req, res) => {
  const { privkey, label, rescan } = req.body || {};

  if (!privkey || typeof privkey !== 'string') {
    return res.status(400).json({ error: 'privkey_required' });
  }

  const labelStr = typeof label === 'string' ? label : '';
  const doRescan = !!rescan;

  try {
    // importprivkey "zcashprivkey" "label" rescan
    const result = await rpc('importprivkey', [privkey, labelStr, doRescan]);
    // importprivkey returns null on success
    res.json({ ok: true, result });
  } catch (err) {
    console.error('[/api/wallet/import-privkey] error', err.message || err);
    res.status(500).json({
      error: 'importprivkey_failed',
      detail: err.message || String(err),
    });
  }
});

// ---------- /api/wallet/send ----------
// Body: { walletName, address, amount }

app.post('/api/wallet/send', async (req, res) => {
  const { walletName, address, amount, utxos } = req.body;

  if (!address || typeof amount !== 'number') {
    return res.status(400).json({
      error: 'bad_request',
      detail: 'address and numeric amount are required',
    });
  }

  const useUtxos = Array.isArray(utxos) && utxos.length > 0;
  let lockList = [];

  try {
    if (useUtxos) {
      // get all current UTXOs
      const all = await rpc('listunspent', [0, 9999999, []]);
      const wanted = new Set(
        utxos.map((u) => `${u.txid}:${u.vout}`)
      );

      lockList = (all || [])
        .filter((u) => !wanted.has(`${u.txid}:${u.vout}`))
        .map((u) => ({ txid: u.txid, vout: u.vout }));

      // lock everything EXCEPT the selected UTXOs
      if (lockList.length) {
        await rpc('lockunspent', [false, lockList]);
      }
    }

    // normal wallet send – wallet will choose from remaining unlocked UTXOs
    const params = [address, amount];
    const txid = await rpc('sendtoaddress', params);

    res.json({ txid });
  } catch (err) {
    console.error('[/api/wallet/send] error:', err.message || err);
    res.status(500).json({
      error: 'send_failed',
      detail: err.message || String(err),
    });
  } finally {
    // always unlock what we locked
    if (lockList.length) {
      try {
        await rpc('lockunspent', [true, lockList]);
      } catch (e2) {
        console.error('[/api/wallet/send] unlock error:', e2.message || e2);
      }
    }
  }
});

// List UTXOs used by the wallet
// List UTXOs used by the wallet
app.get('/api/wallet/utxos', async (req, res) => {
  try {
    let unspent;

    // Some zcashd builds are picky about params, so we try the simplest form first
    try {
      // no args: use node defaults
      unspent = await rpc('listunspent');
    } catch (innerErr) {
      console.error('[listunspent] no-arg failed, retrying with defaults:', innerErr.message || innerErr);
      // fallback to explicit minconf / maxconf but no address filter
      unspent = await rpc('listunspent', [0, 9999999]);
    }

    if (!Array.isArray(unspent)) {
      throw new Error('Unexpected listunspent result: ' + JSON.stringify(unspent));
    }

    const utxos = unspent.map((u) => ({
      txid: u.txid,
      vout: u.vout,
      address: u.address,
      amount: u.amount,
      confirmations: u.confirmations,
      // label may be missing depending on your node/wallet version
      label: u.label || 'default',
    }));

    res.json({ utxos });
  } catch (err) {
    console.error('[/api/wallet/utxos] error:', err.message || err);
    res.status(500).json({
      error: 'utxo_failed',
      detail: err.message || String(err),
    });
  }
});

// ---------- /api/tx/check ----------
// Body: { txid } -> gettransaction

app.post('/api/tx/check', async (req, res) => {
  const { txid } = req.body || {};
  if (!txid || typeof txid !== 'string') {
    return res.status(400).json({ error: 'txid_required' });
  }

  try {
    const tx = await rpc('gettransaction', [txid]);
    res.json({ ok: true, tx });
  } catch (err) {
    console.error('[/api/tx/check] error', err.message || err);
    res.status(500).json({
      error: 'gettransaction_failed',
      detail: err.message || String(err),
    });
  }
});

// ---------- /api/zords/list ----------
// Returns a list of all inscription files in /Zords (excluding /rawdata)

app.get('/api/zords/list', (req, res) => {
  try {
    const entries = fs.readdirSync(CONTENT_DIR);
    const result = [];

    for (const name of entries) {
      if (name === 'rawdata') continue;
      if (name.startsWith('.')) continue;

      const full = path.join(CONTENT_DIR, name);
      const stat = fs.statSync(full);
      if (!stat.isFile()) continue;

      const ext = path.extname(name).slice(1).toLowerCase();
      const base = path.basename(name, '.' + ext); // e.g. <genesisTxid>i0
      const contentType = mime.lookup(ext) || 'application/octet-stream';

      const inscriptionId = base;                 // full <txid>i0
      const genesisTxid = base.replace(/i\d+$/, '');

      result.push({
        txid: genesisTxid,                        // bare txid
        inscriptionId,                            // full inscription id
        filename: name,
        url: '/content/' + encodeURIComponent(name),
        ext,
        contentType,
        size: stat.size,
      });

    }

    res.json(result);
  } catch (err) {
    console.error('[/api/zords/list] error', err);
    res.status(500).json({
      error: 'list_failed',
      detail: err.message || String(err),
    });
  }
});

// ---------- /api/node/history ----------
// Recent wallet transactions from this node
// Uses listtransactions + getrawtransaction for size.

app.get('/api/node/history', async (req, res) => {
  try {
    const maxTx = 30;

    // listtransactions "*" count from=0 include_watchonly=true
    const list = await rpc('listtransactions', ['*', maxTx, 0, true]).catch(
      () => []
    );

    const unique = [];
    const seen = new Set();
    for (const tx of list || []) {
      if (!tx.txid || seen.has(tx.txid)) continue;
      seen.add(tx.txid);
      unique.push(tx);
      if (unique.length >= maxTx) break;
    }

    const sizes = {};
    for (const tx of unique) {
      try {
        const rawHex = await rpc('getrawtransaction', [tx.txid, false]);
        const hex = typeof rawHex === 'string' ? rawHex : rawHex.hex;
        if (typeof hex === 'string') {
          sizes[tx.txid] = Math.floor(hex.length / 2); // bytes
        }
      } catch (e) {
        // ignore per-tx errors
      }
    }

    const result = unique.map((tx) => ({
      txid: tx.txid,
      time: tx.time,
      category: tx.category,
      amount: tx.amount,
      fee: tx.fee,
      address: tx.address,
      confirmations: tx.confirmations,
      size: sizes[tx.txid] || null,
    }));

    res.json({ txs: result });
  } catch (err) {
    console.error('[/api/node/history] error', err.message || err);
    res.status(500).json({
      error: 'history_failed',
      detail: err.message || String(err),
    });
  }
});

// ---------- /api/dev/rpc-config/save ----------
// Body: { url, user, pass } -> write into .env and update in-memory config.

function updateRpcEnvFile({ url, user, pass }) {
  let existing = '';
  try {
    existing = fs.readFileSync(ENV_PATH, 'utf8');
  } catch (e) {
    existing = '';
  }

  const lines = existing.split(/\r?\n/);
  const map = {};

  // keep any existing simple KEY=VALUE pairs
  for (const line of lines) {
    const m = line.match(/^\s*([^#=\s]+)\s*=\s*(.*)\s*$/);
    if (m) {
      const key = m[1];
      const val = m[2];
      map[key] = val;
    }
  }

  if (url != null) map.NODE_RPC_URL = url;
  if (user != null) map.NODE_RPC_USER = user;
  if (pass != null) map.NODE_RPC_PASS = pass;

  const newLines = Object.entries(map).map(
    ([k, v]) => `${k}=${v}`
  );

  fs.writeFileSync(ENV_PATH, newLines.join('\n'), 'utf8');
}

app.post('/api/dev/rpc-config/save', (req, res) => {
  try {
    const { url, user, pass } = req.body || {};
    const finalUrl =
      (typeof url === 'string' && url.trim()) || 'http://127.0.0.1:8232';
    const finalUser = typeof user === 'string' ? user.trim() : '';
    const finalPass = typeof pass === 'string' ? pass.trim() : '';

    updateRpcEnvFile({
      url: finalUrl,
      user: finalUser,
      pass: finalPass,
    });

    // update in-memory + process.env so this running server switches over
    NODE_RPC_URL = finalUrl;
    NODE_RPC_USER = finalUser;
    NODE_RPC_PASS = finalPass;
    process.env.NODE_RPC_URL = finalUrl;
    process.env.NODE_RPC_USER = finalUser;
    process.env.NODE_RPC_PASS = finalPass;

    res.json({
      ok: true,
      url: finalUrl,
    });
  } catch (err) {
    console.error('[/api/dev/rpc-config/save] error', err);
    res.status(500).json({
      error: 'env_write_failed',
      detail: err.message || String(err),
    });
  }
});


// Simple dev-console RPC runner with a whitelist of allowed commands
// (shielded commands removed per request)
const DEV_ALLOWED_CMDS = new Set([
  'getblockchaininfo',
  'getnetworkinfo',
  'getconnectioncount',
  'getbestblockhash',

  'validateaddress',
  'dumpprivkey',
  'getbalance',

  'listunspent',

  'gettransaction',
  'getrawtransaction',
  'decoderawtransaction',

  'getblockhash',
  'getblock',
]);

// Coerce CLI-style string args into JSON-RPC types (number/bool/JSON/string)
function coerceCliArg(v) {
  if (typeof v !== 'string') return v;
  const s = v.trim();
  if (s === '') return undefined;

  // treat "" or '' as an empty string (for getaddressesbyaccount "")
  if (s === '""' || s === "''") return '';

  // booleans
  if (s === 'true') return true;
  if (s === 'false') return false;

  // numeric
  if (/^-?\d+(\.\d+)?$/.test(s)) {
    return Number(s);
  }

  // JSON (arrays/objects) – e.g. ["t1..."] or {"addr":1.0}
  if (
    (s.startsWith('{') && s.endsWith('}')) ||
    (s.startsWith('[') && s.endsWith(']'))
  ) {
    try {
      return JSON.parse(s);
    } catch (e) {
      // fall through to plain string if parse fails
    }
  }

  // default: plain string
  return s;
}

app.post('/api/dev/cli/run', async (req, res) => {
  try {
    const { command, args } = req.body || {};
    if (!command || !DEV_ALLOWED_CMDS.has(command)) {
      return res.status(400).json({
        error: 'invalid_command',
        detail: 'Command not allowed or missing.',
      });
    }

    const rawArgs = Array.isArray(args) ? args : [];

    // coerce each arg into the right JSON-RPC type
    let safeArgs = rawArgs
      .map(coerceCliArg)
      .filter((v) => v !== undefined);

      if (command === "backupwallet" || command === "z_exportwallet") {
        let filename = args[0];
    
        // If nothing was provided, make a default filename
        if (!filename || filename.trim() === "") {
            const ts = new Date().toISOString().replace(/[:.]/g, "-");
            filename = command + "-" + ts + ".dat";
        }
    
        // IMPORTANT:
        // Pass ONLY the filename to zcashd.
        // zcashd will write it into its configured -exportdir folder.
        const rpcResult = await rpc(command, [filename]);
    
        return res.json({
            command,
            filename,
            exportdir: "zcashd-configured-exportdir",
            result: rpcResult,
            note: "File will appear inside zcashd's configured -exportdir folder."
        });
    }

    // normal commands
    const result = await rpc(command, safeArgs);

    res.json({
      command,
      args: safeArgs,
      result,
    });
  } catch (err) {
    console.error(
      '[/api/dev/cli/run] error:',
      err.response?.data || err.message || err
    );
    const detail =
      (err.response && err.response.data && JSON.stringify(err.response.data)) ||
      err.message ||
      String(err);
    res.status(500).json({
      error: 'rpc_failed',
      detail,
    });
  }
});

// ---------- Root route ----------

app.get('/', (req, res) => {
  res.sendFile(path.join(PAGES_DIR, 'index.html'));
});

// ---------- Start server ----------

const PORT = process.env.VIEWER_PORT
  ? parseInt(process.env.VIEWER_PORT, 10)
  : 4000;

app.listen(PORT, () => {
  console.log(`Zordinals viewer running on http://localhost:${PORT}`);
  console.log(`Open http://localhost:${PORT}/assets-page/index.html`);
});
