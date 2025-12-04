#!/usr/bin/env node
const axios = require("axios");
const dotenv = require("dotenv");
const zcashcore = require("bitcore-lib-zcash");
const fs = require("fs");
const path = require("path");
const mime = require("mime-types");

dotenv.config();
const { Script, Transaction } = zcashcore;

// ---------------- RPC CONFIG (local node) ----------------
const NODE_RPC_URL  = process.env.NODE_RPC_URL;
const NODE_RPC_USER = process.env.NODE_RPC_USER;
const NODE_RPC_PASS = process.env.NODE_RPC_PASS;

if (!NODE_RPC_URL || !NODE_RPC_USER || !NODE_RPC_PASS) {
  console.error("ERROR: Please set NODE_RPC_URL, NODE_RPC_USER and NODE_RPC_PASS in .env for your local node.");
  process.exit(1);
}

const rpcClient = axios.create({
  baseURL: NODE_RPC_URL,
  auth: {
    username: NODE_RPC_USER,
    password: NODE_RPC_PASS,
  },
  headers: {
    "Content-Type": "application/json",
  },
  timeout: 30000,
});

// ---------------- CONTENT / MASTER HELPERS ----------------
const CONTENT_DIR = path.join(process.cwd(), "content");
const MASTER_DIR = path.join(CONTENT_DIR, "master");
const MASTER_PATH = path.join(MASTER_DIR, "master.json");

function ensureContentDir() {
  if (!fs.existsSync(CONTENT_DIR)) {
    fs.mkdirSync(CONTENT_DIR, { recursive: true });
  }
  if (!fs.existsSync(MASTER_DIR)) {
    fs.mkdirSync(MASTER_DIR, { recursive: true });
  }
}

function loadMaster() {
  ensureContentDir();
  if (!fs.existsSync(MASTER_PATH)) return {};
  try {
    const raw = fs.readFileSync(MASTER_PATH, "utf8");
    if (!raw.trim()) return {};
    return JSON.parse(raw);
  } catch (e) {
    console.warn("Invalid master.json, resetting:", e.message);
    return {};
  }
}

function saveMaster(master) {
  ensureContentDir();
  fs.writeFileSync(MASTER_PATH, JSON.stringify(master, null, 2), "utf8");
}

function upsertMasterEntry(meta) {
  if (!meta || !meta.inscriptionId) return;
  const master = loadMaster();
  const existing = master[meta.inscriptionId] || {};
  // Preserve original createdAt if present
  const createdAt = existing.createdAt || meta.createdAt || new Date().toISOString();
  master[meta.inscriptionId] = {
    ...existing,
    ...meta,
    createdAt,
  };
  saveMaster(master);
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

// ---------------- RPC WRAPPER ----------------

async function rpc(method, params = [], id = "zordinals") {
  const body = { jsonrpc: "2.0", id, method, params };

  try {
    const res = await rpcClient.post("", body);

    if (res.data.error) {
      const err = new Error(res.data.error.message || JSON.stringify(res.data.error));
      err._method = method;
      err._params = params;
      err._raw = res.data.error;
      throw err;
    }
    return res.data.result;
  } catch (err) {
    if (err.code === "ECONNREFUSED") {
      console.error("ERROR: Cannot connect to local node at", NODE_RPC_URL);
      console.error("Make sure your zcashd node is running and RPC is enabled.");
    }
    throw err;
  }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---------------- TX DECODE ----------------

async function getTxDecoded(txid) {
  try { return await rpc("getrawtransaction", [txid, 1]); } catch (_) {}
  try { return await rpc("getrawtransaction", [txid, true]); } catch (_) {}

  console.log(`(fallback) decoding raw tx ${txid}`);
  const rawHex = await rpc("getrawtransaction", [txid]);
  const txObj = new Transaction(rawHex);

  return {
    txid,
    version: txObj.version,
    locktime: txObj.nLockTime,
    vin: txObj.inputs.map(inp => ({
      txid: inp.prevTxId.toString("hex"),
      vout: inp.outputIndex,
      scriptSig: { hex: inp.script.toHex() }
    })),
    vout: txObj.outputs.map((out, index) => ({
      n: index,
      value: out.satoshis / 1e8,
      scriptPubKey: { hex: out.script.toHex() }
    }))
  };
}

// ---------------- ORD PARSING ----------------

function chunkToNumber(chunk) {
  if (chunk.opcodenum === 0) return 0;
  if (chunk.opcodenum === 1 && chunk.buf) return chunk.buf[0];
  if (chunk.opcodenum === 2 && chunk.buf)
    return chunk.buf[1] * 255 + chunk.buf[0];
  if (chunk.opcodenum > 80 && chunk.opcodenum <= 96)
    return chunk.opcodenum - 80;
  return undefined;
}

function parseOrdScript(hex) {
  if (!hex) return null;
  let script;
  try { script = Script.fromHex(hex); } catch { return null; }

  const c = script.chunks;
  if (!c.length || !c[0].buf) return null;
  if (c[0].buf.toString("utf8") !== "ord") return null;

  const totalPieces = chunkToNumber(c[1]);
  if (totalPieces === undefined) return null;
  const mimeType = c[2].buf.toString("utf8");

  const pieces = {};
  let i = 3;
  while (i + 1 < c.length) {
    const idx = chunkToNumber(c[i]);
    const data = c[i + 1];
    if (idx === undefined || !data.buf) break;
    pieces[idx] = data.buf;
    i += 2;
  }

  return { totalPieces, mimeType, pieces };
}

function parseOrdPieces(hex, expectedPieces, expectedMime) {
  if (!hex) return null;
  let script;
  try { script = Script.fromHex(hex); } catch { return null; }

  const c = script.chunks;
  if (!c.length) return null;

  let i = 0;
  let totalPieces = expectedPieces;
  let mimeType = expectedMime;

  if (c[0].buf && c[0].buf.toString("utf8") === "ord") {
    const t = chunkToNumber(c[1]);
    if (t === undefined || !c[2].buf) return null;
    totalPieces = t;
    mimeType = c[2].buf.toString("utf8");
    i = 3;
  }

  const pieces = {};
  while (i + 1 < c.length) {
    const idx = chunkToNumber(c[i]);
    const data = c[i + 1];
    if (idx === undefined || !data.buf) break;
    if (idx >= 0 && idx < totalPieces) pieces[idx] = data.buf;
    i += 2;
  }

  return Object.keys(pieces).length ? { totalPieces, mimeType, pieces } : null;
}

// ---------------- CHAIN WALK ----------------

async function getTxHeight(tx) {
  if (!tx.blockhash) return null;
  const blk = await rpc("getblock", [tx.blockhash]);
  return blk.height;
}

async function findSpender(txid, vout, startHeight, depth) {
  for (let h = startHeight; h <= startHeight + depth; h++) {
    let hash;
    try { hash = await rpc("getblockhash", [h]); }
    catch { return null; }

    const blk = await rpc("getblock", [hash, 2]);
    for (const tx of blk.tx) {
      for (let i = 0; i < tx.vin.length; i++) {
        const vin = tx.vin[i];
        if (vin.txid === txid && vin.vout === vout) {
          return { txid: tx.txid, vinIndex: i, height: h };
        }
      }
    }
    await sleep(1000);
  }
  return null;
}

// Walk backwards until first ord inscription
async function findGenesis(descendantTxid) {
  let current = descendantTxid;

  while (true) {
    const tx = await getTxDecoded(current);
    const vin0 = tx.vin[0];
    if (!vin0 || !vin0.scriptSig) {
      return { genesisTxid: current, tx };
    }

    const ord = parseOrdScript(vin0.scriptSig.hex);
    if (ord) {
      const parent = await getTxDecoded(vin0.txid);
      if (parseOrdScript(parent.vin[0]?.scriptSig?.hex)) {
        // There is an earlier ord inscription, keep walking back
        current = vin0.txid;
      } else {
        // This is the first ord in the chain
        return { genesisTxid: current, tx, ord };
      }
    } else {
      // No ord here, walk further back
      current = vin0.txid;
    }
  }
}

// ---------------- RECONSTRUCTION ----------------

function allPieces(agg, total) {
  for (let i = 0; i < total; i++) {
    if (!agg[i]) return false;
  }
  return true;
}

/**
 * Core reconstruct function:
 *  - finds genesis for the given txid
 *  - walks forward collecting ord pieces
 *  - writes content/<genesisTxid>i0.<ext>
 *  - upserts entry into master.json
 *  - returns { resultBuf, mimeType, inscriptionId }
 */
async function reconstructAndReturnBuffer(baseTxid) {
  const { genesisTxid, tx: genTx, ord } = await findGenesis(baseTxid);
  const header = ord || parseOrdScript(genTx.vin[0].scriptSig.hex);

  if (!header) {
    throw new Error("No ord header found on the genesis transaction.");
  }

  const { totalPieces, mimeType } = header;
  console.log(`Genesis: ${genesisTxid}, pieces=${totalPieces}, mime=${mimeType}`);

  const aggregated = {};

  // Collect genesis pieces
  for (const k in header.pieces) {
    aggregated[k] = header.pieces[k];
  }

  // Follow spender chain
  let height = await getTxHeight(genTx);
  let curTx = genesisTxid;
  let vout = 0;

  while (!allPieces(aggregated, totalPieces)) {
    const spender = await findSpender(curTx, vout, height, 2000);
    if (!spender) break;

    const child = await getTxDecoded(spender.txid);
    const vin = child.vin[spender.vinIndex];

    const p = parseOrdPieces(vin.scriptSig?.hex, totalPieces, mimeType);
    if (p) {
      for (const k in p.pieces) {
        if (!aggregated[k]) aggregated[k] = p.pieces[k];
      }
    }

    curTx = spender.txid;
    height = spender.height;
  }

  // Build output using DESCENDING ORDER (as per your original logic)
  const order = Array.from({ length: totalPieces }, (_, i) => i).reverse();
  const resultBuf = Buffer.concat(order.map(i => aggregated[i] || Buffer.alloc(0)));

  ensureContentDir();
  const ext = mime.extension(mimeType) || "bin";

  const inscriptionId = `${genesisTxid}i0`;
  const filename = `${inscriptionId}.${ext}`;
  const out = path.join(CONTENT_DIR, filename);

  fs.writeFileSync(out, resultBuf);
  const stats = fs.statSync(out);

  console.log(`✔ Saved image → content/${filename}`);
  console.log(`Size: ${stats.size} bytes`);

  // Update master.json
  upsertMasterEntry({
    inscriptionId,
    txid: genesisTxid,
    filename,
    mimeType,
    ext,
    size: stats.size,
  });

  return { resultBuf, mimeType, inscriptionId };
}

/**
 * Ensure an inscription is present in /content and in master.json.
 * Accepts either txid or txid+i0.
 * Returns { resultBuf|null, mimeType|null, inscriptionId, fromCache:boolean }.
 */
async function ensureInscriptionDecoded(idOrTxid) {
  ensureContentDir();
  const master = loadMaster();

  const clean = idOrTxid.trim();
  const hasSuffix = /i\d+$/.test(clean);
  const inscriptionId = hasSuffix ? clean : `${clean.replace(/i\d+$/, "")}i0`;
  const baseTxid = inscriptionId.replace(/i\d+$/, "");

  const masterEntry = master[inscriptionId];

  // If master knows this inscription and file exists → use it, no decode
  if (masterEntry) {
    const candidate =
      masterEntry.filename
        ? path.join(CONTENT_DIR, masterEntry.filename)
        : findContentFile(inscriptionId);

    if (candidate && fs.existsSync(candidate)) {
      console.log(`Master: using existing inscription ${inscriptionId}`);
      const ext = path.extname(candidate).slice(1).toLowerCase();
      const mimeType = masterEntry.mimeType || mime.lookup(ext) || "application/octet-stream";
      return { resultBuf: null, mimeType, inscriptionId, fromCache: true };
    }

    console.log(`Master entry found for ${inscriptionId} but file missing, reconstructing...`);
  } else {
    // No master entry; maybe the file exists already (older data)
    const existingFile = findContentFile(inscriptionId);
    if (existingFile) {
      const ext = path.extname(existingFile).slice(1).toLowerCase();
      const mimeType = mime.lookup(ext) || "application/octet-stream";
      const stats = fs.statSync(existingFile);
      upsertMasterEntry({
        inscriptionId,
        txid: baseTxid,
        filename: path.basename(existingFile),
        mimeType,
        ext,
        size: stats.size,
      });
      console.log(`Master: registered existing file for ${inscriptionId}`);
      return { resultBuf: null, mimeType, inscriptionId, fromCache: true };
    }
  }

  // Need to actually reconstruct
  const { resultBuf, mimeType, inscriptionId: realId } =
    await reconstructAndReturnBuffer(baseTxid);

  return {
    resultBuf,
    mimeType,
    inscriptionId: realId,
    fromCache: false,
  };
}

// Recursively ensure that all /content/<inscriptionId> dependencies
// referenced inside an HTML/SVG inscription are decoded into /content.
async function handleHtmlSvgDependencies(inscriptionId, mimeType, buffer, visited = new Set()) {
  if (!mimeType || (mimeType !== "text/html" && mimeType !== "image/svg+xml")) {
    return;
  }

  const baseTxid = inscriptionId.replace(/i\d+$/, "");
  if (visited.has(baseTxid)) return;
  visited.add(baseTxid);

  let text;
  try {
    // If buffer is null (came from cache), read from disk
    if (!buffer) {
      const filePath = findContentFile(inscriptionId);
      if (!filePath) {
        console.warn("Cannot scan dependencies, file missing for", inscriptionId);
        return;
      }
      buffer = fs.readFileSync(filePath);
    }
    text = buffer.toString("utf8");
  } catch (e) {
    console.warn("Could not read HTML/SVG as text for dependency scan:", e.message);
    return;
  }

  const depRegex = /\/content\/([0-9a-f]{64}i\d+)/gi;
  const deps = new Set();
  let m;
  while ((m = depRegex.exec(text)) !== null) {
    deps.add(m[1]);
  }

  if (deps.size === 0) {
    console.log("No recursive /content/<inscriptionId> references found.");
    return;
  }

  console.log("↺ Detected recursive content dependencies:");
  for (const id of deps) {
    console.log("  -", id);
  }

  // Decode any missing dependency (or register existing), recurse into HTML/SVG children
  for (const depId of deps) {
    const child = await ensureInscriptionDecoded(depId);

    if (child.mimeType === "text/html" || child.mimeType === "image/svg+xml") {
      await handleHtmlSvgDependencies(
        child.inscriptionId,
        child.mimeType,
        child.resultBuf,
        visited,
      );
    }
  }
}

// High-level wrapper used by the CLI
async function reconstruct(inputTxidOrInscription) {
  const base = inputTxidOrInscription.trim();

  // Make sure this inscription itself exists and is in master
  const { resultBuf, mimeType, inscriptionId } = await ensureInscriptionDecoded(base);

  // If HTML/SVG, recursively ensure children exist
  if (mimeType === "text/html" || mimeType === "image/svg+xml") {
    await handleHtmlSvgDependencies(inscriptionId, mimeType, resultBuf);
  }
}

// ---------------- CLI ----------------

const [, , txidArg] = process.argv;
if (!txidArg) {
  console.error("Usage: node decode.js <txid or txid+i0>");
  process.exit(1);
}

reconstruct(txidArg).catch(err => {
  console.error("ERROR:", err.message);
  if (err._method) console.error("RPC", err._method, err._params, err._raw);
  process.exit(1);
});
