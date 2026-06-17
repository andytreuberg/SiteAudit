import { NextResponse } from "next/server";
import { ethers } from "ethers";
import { CONTRACT_ADDRESS, SITEAUDIT_ABI, expandReport } from "@/lib/siteaudit";
import { ARC_RPC, ARCSCAN } from "@/lib/arcNetwork";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/report/:jobId — the report, served over https by the app from the
// inline on-chain payload. Anyone can also read it straight off the chain; this is
// the clean canonical URL. The body is verifiable: keccak256(canonical) == reportHash.
export async function GET(_req: Request, ctx: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await ctx.params;
  const id = Number(jobId);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "bad jobId" }, { status: 400 });
  if (!/^0x[a-fA-F0-9]{40}$/.test(CONTRACT_ADDRESS)) return NextResponse.json({ error: "contract not configured" }, { status: 503 });

  try {
    const c = new ethers.Contract(CONTRACT_ADDRESS, SITEAUDIT_ABI, new ethers.JsonRpcProvider(ARC_RPC));
    const j = await c.getJob(id);
    if (j.payer === ethers.ZeroAddress) return NextResponse.json({ error: "no such job" }, { status: 404 });
    const status = Number(j.status);
    if (status !== 1) return NextResponse.json({ jobId: id, status, pending: status === 0, url: j.url }, { status: status === 0 ? 202 : 200 });

    const raw = (j.reportUri || "").trim();
    let compact: unknown = null;
    if (raw.startsWith("{")) { try { compact = JSON.parse(raw); } catch { /* */ } }
    const verified = compact ? ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify(compact))) === j.reportHash : false;

    return NextResponse.json({
      jobId: id,
      url: j.url,
      score: Number(j.score),
      auditor: j.jobAuditor,
      reportHash: j.reportHash,
      verified,
      report: compact ? expandReport(compact) : null,
      receipt: `${ARCSCAN}/address/${CONTRACT_ADDRESS}`,
    });
  } catch (e) {
    return NextResponse.json({ error: String((e as Error).message || e) }, { status: 500 });
  }
}
