// Point the deployed contract at the auditor agent wallet (owner only).
//   OWNER_PK=0x<owner key>  node scripts/set-auditor.mjs [auditorAddress]
// Defaults the auditor to AUDITOR_WALLET from .env.local.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { JsonRpcProvider, Wallet, Contract } from "ethers";

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
const pk = process.env.OWNER_PK;
if (!/^0x[0-9a-fA-F]{64}$/.test(pk || "")) { console.error("Set OWNER_PK=0x…"); process.exit(1); }
const auditor = process.argv[2] || process.env.AUDITOR_WALLET;
if (!/^0x[0-9a-fA-F]{40}$/.test(auditor || "")) { console.error("auditor address missing"); process.exit(1); }

const lib = readFileSync(join(root, "lib/siteaudit.ts"), "utf8");
const addr = (lib.match(/CONTRACT_ADDRESS = "(0x[0-9a-fA-F]{40})"/) || [])[1];
if (!addr) { console.error("CONTRACT_ADDRESS not baked yet — deploy first"); process.exit(1); }

const wallet = new Wallet(pk, new JsonRpcProvider(RPC, 5042002));
const c = new Contract(addr, ["function setAuditor(address next)", "function auditor() view returns (address)"], wallet);
console.log("contract:", addr, "| current auditor:", await c.auditor());
const tx = await c.setAuditor(auditor);
console.log("setAuditor tx:", tx.hash);
await tx.wait(1);
console.log("✅ auditor set to", auditor);
