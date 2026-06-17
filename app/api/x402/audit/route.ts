import { NextRequest, NextResponse } from "next/server";
import { ethers } from "ethers";
import { ARC_RPC, ARC_CHAIN_ID } from "@/lib/arcNetwork";
import { CONTRACT_ADDRESS, SITEAUDIT_ABI } from "@/lib/siteaudit";
import { runAudit } from "@/lib/auditor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ── SiteAudit x402 — audit-as-a-paid-API ──
// Another agent pays a micro-fee over the real x402 (HTTP-402) standard to get a URL
// audited programmatically, then receives the report — no wallet UI, machine scale.
// Honest scope: Arc's USDC is the NATIVE coin (no ERC-20, no EIP-3009 gasless), so this
// is PAY-THEN-PROVE: the calling agent itself calls requestAudit{value:price}(url) (native
// USDC, escrowed), then proves it with the tx hash in X-PAYMENT. We verify the AuditRequested
// event on-chain, then the auditor agent scans the URL and stamps the report on-chain, and we
// return it. Genuine 402/X-PAYMENT/X-PAYMENT-RESPONSE wire format, self-verified, no facilitator.
// Replay-bounded by a freshness window + a seen-set (best-effort on testnet).

const FRESH = 300;
const seen = new Set<string>();

async function price(provider: ethers.JsonRpcProvider): Promise<bigint> {
  const c = new ethers.Contract(CONTRACT_ADDRESS, SITEAUDIT_ABI, provider);
  return await c.price();
}

function challenge(req: NextRequest, p: bigint, error: string) {
  return NextResponse.json({
    x402Version: 1,
    error,
    accepts: [{
      scheme: "exact",
      network: `eip155:${ARC_CHAIN_ID}`,
      maxAmountRequired: p.toString(),
      resource: `${req.nextUrl.origin}/api/x402/audit`,
      description: "SiteAudit mini-audit — call requestAudit(url){value:price} on the SiteAudit contract (native USDC, 18 dec), then prove with the tx hash. Pay-then-prove, self-verified, no facilitator. Returns the SEO/speed/security report.",
      mimeType: "application/json",
      payTo: CONTRACT_ADDRESS,
      asset: "0x0000000000000000000000000000000000000000",
      extra: { name: "USDC", decimals: 18, native: true, method: "requestAudit(string url)" },
    }],
  }, { status: 402 });
}

export async function GET(req: NextRequest) {
  if (!/^0x[a-fA-F0-9]{40}$/.test(CONTRACT_ADDRESS)) return NextResponse.json({ error: "contract not configured" }, { status: 503 });
  const provider = new ethers.JsonRpcProvider(ARC_RPC);
  return challenge(req, await price(provider), "X-PAYMENT header required");
}

export async function POST(req: NextRequest) {
  if (!/^0x[a-fA-F0-9]{40}$/.test(CONTRACT_ADDRESS)) return NextResponse.json({ error: "contract not configured" }, { status: 503 });
  const provider = new ethers.JsonRpcProvider(ARC_RPC);
  const p = await price(provider);

  const hdr = req.headers.get("x-payment");
  if (!hdr) return challenge(req, p, "X-PAYMENT header required");

  let txHash: string;
  try {
    const parsed = JSON.parse(Buffer.from(hdr, "base64").toString("utf8"));
    txHash = parsed?.txHash || parsed?.payload?.txHash;
    if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) throw new Error("bad txHash");
  } catch {
    return challenge(req, p, "malformed X-PAYMENT");
  }
  if (seen.has(txHash)) return challenge(req, p, "payment already used");

  try {
    const rc = await provider.getTransactionReceipt(txHash);
    if (!rc || rc.status !== 1 || rc.to?.toLowerCase() !== CONTRACT_ADDRESS.toLowerCase()) {
      return challenge(req, p, "invalid or unconfirmed payment");
    }
    const blk = await provider.getBlock(rc.blockNumber);
    if (!blk || Math.floor(Date.now() / 1000) - Number(blk.timestamp) > FRESH) {
      return challenge(req, p, "payment too old — request again");
    }

    // find the AuditRequested event in that tx → the jobId + paid + url
    const iface = new ethers.Interface(SITEAUDIT_ABI);
    let job: { jobId: number; payer: string; url: string; paid: bigint } | null = null;
    for (const log of rc.logs) {
      try {
        const ev = iface.parseLog({ topics: log.topics as string[], data: log.data });
        if (ev?.name === "AuditRequested") {
          job = { jobId: Number(ev.args.jobId), payer: ev.args.payer, url: ev.args.url, paid: ev.args.paid };
          break;
        }
      } catch { /* not ours */ }
    }
    if (!job) return challenge(req, p, "no audit requested in that tx");
    if (job.paid < p) return challenge(req, p, "underpaid");
    seen.add(txHash);

    // run (or fetch) the audit — the auditor agent scans + stamps the report on-chain
    const outcome = await runAudit(job.jobId);

    const settlement = { success: true, transaction: txHash, network: `eip155:${ARC_CHAIN_ID}`, payer: job.payer };
    return NextResponse.json({
      jobId: job.jobId,
      url: job.url,
      paid: job.paid.toString(),
      network: `eip155:${ARC_CHAIN_ID}`,
      score: outcome.score ?? null,
      report: outcome.report ?? null,
      reportTx: outcome.txHash ?? null,
      note: outcome.ok ? "audit complete — report stamped on-chain" : (outcome.error || "audit pending"),
    }, {
      status: 200,
      headers: { "X-PAYMENT-RESPONSE": Buffer.from(JSON.stringify(settlement)).toString("base64") },
    });
  } catch (e) {
    return NextResponse.json({ error: "verification error: " + String((e as Error).message || e) }, { status: 502 });
  }
}
