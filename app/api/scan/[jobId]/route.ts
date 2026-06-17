import { NextResponse } from "next/server";
import { runAudit } from "@/lib/auditor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/scan/:jobId — the auditor agent, on demand.
// The UI calls this right after requestAudit() lands; it scans the job's URL and
// stamps the report on-chain (releasing the escrow to the auditor). Idempotent:
// if the job is already reported, it just returns the existing report.
export async function POST(_req: Request, ctx: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await ctx.params;
  const id = Number(jobId);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ ok: false, error: "bad jobId" }, { status: 400 });
  }
  try {
    const outcome = await runAudit(id);
    return NextResponse.json(outcome, { status: outcome.ok ? 200 : 409 });
  } catch (e) {
    return NextResponse.json({ ok: false, jobId: id, error: String((e as Error).message || e) }, { status: 500 });
  }
}
