// SiteAudit x402 demo — an agent buys a site audit programmatically.
// Speaks the real x402 wire format (402 challenge → X-PAYMENT → X-PAYMENT-RESPONSE).
// Pay-then-prove: the agent calls requestAudit{value:price}(url) (native USDC, escrowed),
// then proves it with the tx hash; the server runs the audit and returns the report.
//   BUYER_PK=0x.. CONTRACT=0x.. API_BASE=https://siteaudit-arc.vercel.app \
//     node agent/audit-demo.mjs https://example.com
import { JsonRpcProvider, Wallet, Contract, Interface } from "ethers";

const RPC = process.env.ARC_RPC || "https://rpc.testnet.arc.network";
const CONTRACT = process.env.CONTRACT;
const API = process.env.API_BASE || "http://localhost:3000";
const url = process.argv[2] || "https://example.com";
if (!/^0x[0-9a-fA-F]{40}$/.test(CONTRACT || "")) { console.error("set CONTRACT=0x…"); process.exit(1); }

const wallet = new Wallet(process.env.BUYER_PK, new JsonRpcProvider(RPC, 5042002));
const abi = [
  "function requestAudit(string url) payable returns (uint256)",
  "event AuditRequested(uint256 indexed jobId, address indexed payer, string url, uint256 paid)",
];
const c = new Contract(CONTRACT, abi, wallet);

// 1) ask the x402 endpoint — get the 402 challenge with the price
const ch = await fetch(`${API}/api/x402/audit`, { method: "POST" });
if (ch.status !== 402) { console.error("expected 402, got", ch.status, await ch.text()); process.exit(1); }
const req = (await ch.json()).accepts[0];
console.log(`402 → requestAudit on ${req.payTo}, pay ${req.maxAmountRequired} wei (native USDC) on ${req.network}`);

// 2) pay by requesting the audit on-chain (the fee is escrowed until the report lands)
const tx = await c.requestAudit(url, { value: BigInt(req.maxAmountRequired) });
const rc = await tx.wait(1);
const iface = new Interface(abi);
let jobId = 0;
for (const log of rc.logs) { try { const ev = iface.parseLog(log); if (ev?.name === "AuditRequested") { jobId = Number(ev.args.jobId); break; } } catch {} }
console.log(`paid + requested: job #${jobId} (${rc.hash})`);

// 3) prove it — present the tx hash in X-PAYMENT; the server scans + returns the report
const xpay = Buffer.from(JSON.stringify({ txHash: rc.hash, payer: wallet.address })).toString("base64");
const res = await fetch(`${API}/api/x402/audit`, { method: "POST", headers: { "X-PAYMENT": xpay } });
if (!res.ok) { console.error("denied:", res.status, await res.text()); process.exit(1); }
const settle = res.headers.get("X-PAYMENT-RESPONSE");
console.log("X-PAYMENT-RESPONSE:", JSON.parse(Buffer.from(settle, "base64").toString()));
const out = await res.json();
console.log(`\nAUDIT for ${out.url} — score ${out.score}/100`);
if (out.report) {
  console.log(`  SEO ${out.report.s.seo} · Speed ${out.report.s.spd} · Security ${out.report.s.sec}`);
  for (const f of out.report.findings || []) console.log(`  [${f.category}/${f.sev}] ${f.label}`);
}
console.log(`\nreport stamped on-chain in ${out.reportTx || "(already reported)"} — verifiable: keccak256(report) == on-chain reportHash`);
