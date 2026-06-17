// SiteAudit — the autonomous auditor agent.
// Watches the contract for open audit jobs bound to THIS wallet, scans each URL
// (SEO / speed / security headers), and stamps a compact report on-chain — which
// releases the escrowed fee to it. The same scan logic the serverless route runs.
//
//   AUDITOR_PK=0x..  node agent/auditor.mjs        (reads .env.local + the baked address)
//
// It is paid per task and pays its own submitReport gas in the same USDC it earns —
// the whole loop only pencils out because USDC is the gas token on ARC.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { JsonRpcProvider, Wallet, Contract, keccak256, toUtf8Bytes } from "ethers";
import { auditUrl } from "../lib/scan.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
function loadEnv() {
  try {
    for (const line of readFileSync(join(root, ".env.local"), "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    }
  } catch {}
}
loadEnv();

const RPC = process.env.ARC_RPC || "https://rpc.testnet.arc.network";
const pk = process.env.AUDITOR_PK;
if (!/^0x[0-9a-fA-F]{64}$/.test(pk || "")) { console.error("AUDITOR_PK not set (.env.local)"); process.exit(1); }

const lib = readFileSync(join(root, "lib/siteaudit.ts"), "utf8");
const CONTRACT = process.env.CONTRACT || (lib.match(/CONTRACT_ADDRESS = "(0x[0-9a-fA-F]{40})"/) || [])[1];
if (!/^0x[0-9a-fA-F]{40}$/.test(CONTRACT || "")) { console.error("contract address not baked yet — deploy first"); process.exit(1); }

const ABI = [
  "function jobCount() view returns (uint256)",
  "function getJob(uint256) view returns (address payer, uint96 paid, uint64 requestedAt, uint8 status, uint8 score, address jobAuditor, string url, string reportUri, bytes32 reportHash)",
  "function submitReport(uint256 jobId, uint8 score, string reportUri, bytes32 reportHash)",
];

const wallet = new Wallet(pk, new JsonRpcProvider(RPC, 5042002));
const c = new Contract(CONTRACT, ABI, wallet);
const inflight = new Set();
const POLL = Number(process.env.POLL_MS || 8000);

console.log(`SiteAudit agent ${wallet.address}`);
console.log(`contract ${CONTRACT}\nwatching for open jobs every ${POLL}ms…\n`);

async function handle(id) {
  if (inflight.has(id)) return;
  const j = await c.getJob(id);
  if (Number(j.status) !== 0) return;                                   // not open
  if (j.jobAuditor.toLowerCase() !== wallet.address.toLowerCase()) return; // not ours
  inflight.add(id);
  try {
    console.log(`#${id} scanning ${j.url}`);
    const r = await auditUrl(j.url);
    let payload = r.compactJson;
    if (Buffer.byteLength(payload, "utf8") > 1024) payload = JSON.stringify({ ...r.compact, f: r.compact.f.slice(0, 8) });
    const hash = keccak256(toUtf8Bytes(payload));
    const tx = await c.submitReport(id, r.overall, payload, hash);
    console.log(`#${id} score ${r.overall}/100 — submitReport ${tx.hash}`);
    await tx.wait(1);
    console.log(`#${id} reported ✓ (SEO ${r.sub.seo} · Speed ${r.sub.spd} · Security ${r.sub.sec})`);
  } catch (e) {
    console.error(`#${id} failed:`, String(e?.shortMessage || e?.message || e));
  } finally {
    inflight.delete(id);
  }
}

async function tick() {
  try {
    const total = Number(await c.jobCount());
    const from = Math.max(1, total - 50);
    for (let id = from; id <= total; id++) await handle(id);
  } catch (e) {
    console.error("poll error:", String(e?.shortMessage || e?.message || e));
  }
}

await tick();
setInterval(tick, POLL);
