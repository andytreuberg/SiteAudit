import { ethers } from "ethers";
import { ARC_RPC, ARC_CHAIN_ID } from "./arcNetwork";
import { CONTRACT_ADDRESS, SITEAUDIT_ABI, expandReport, type Report } from "./siteaudit";
// @ts-ignore — plain ESM scanner module
import { auditUrl } from "./scan.mjs";

// ─────────────────────────────────────────────────────────────────────────────
// The auditor agent, server side. Triggered by the UI (POST /api/scan) or by the
// x402 route after payment is proven. Reads the on-chain job, runs the real scan,
// and stamps a compact report inline on-chain (reportUri JSON + keccak256 hash),
// releasing the escrowed fee to itself. Same logic the standalone agent runs.
// ─────────────────────────────────────────────────────────────────────────────

export interface AuditOutcome {
  ok: boolean;
  jobId: number;
  status: number;       // 0 Requested, 1 Reported, 2 Refunded
  score?: number;
  report?: Report;
  txHash?: string;
  already?: boolean;    // report already existed on-chain
  error?: string;
}

function signer(): ethers.Wallet {
  const pk = process.env.AUDITOR_PK || "";
  if (!/^0x[0-9a-fA-F]{64}$/.test(pk)) throw new Error("AUDITOR_PK not configured");
  return new ethers.Wallet(pk, new ethers.JsonRpcProvider(ARC_RPC, ARC_CHAIN_ID));
}

function parseInline(reportUri: string): Report | null {
  const t = (reportUri || "").trim();
  if (!t.startsWith("{")) return null;
  try { return expandReport(JSON.parse(t)) as Report; } catch { return null; }
}

/** Run (or fetch an already-run) audit for an on-chain job. Idempotent. */
export async function runAudit(jobId: number): Promise<AuditOutcome> {
  if (!/^0x[a-fA-F0-9]{40}$/.test(CONTRACT_ADDRESS)) return { ok: false, jobId, status: 0, error: "contract not configured" };
  let wallet: ethers.Wallet;
  try { wallet = signer(); } catch (e) { return { ok: false, jobId, status: 0, error: String((e as Error).message) }; }

  const contract = new ethers.Contract(CONTRACT_ADDRESS, SITEAUDIT_ABI, wallet);
  const j = await contract.getJob(jobId);
  if (j.payer === ethers.ZeroAddress) return { ok: false, jobId, status: 0, error: "no such job" };
  const status = Number(j.status);

  // already reported → return the inline report, no second submit
  if (status === 1) {
    return { ok: true, jobId, status, already: true, score: Number(j.score), report: parseInline(j.reportUri) ?? undefined };
  }
  if (status === 2) return { ok: false, jobId, status, error: "job was refunded" };

  // this server can only report jobs bound to ITS auditor address
  if (j.jobAuditor.toLowerCase() !== wallet.address.toLowerCase()) {
    return { ok: false, jobId, status, error: "this job is bound to a different auditor" };
  }

  // do the real work
  const result = await auditUrl(j.url);
  let compactJson: string = result.compactJson;
  // hard cap: the contract rejects reportUri > 1024 bytes — trim findings if needed
  if (Buffer.byteLength(compactJson, "utf8") > 1024) {
    const trimmed = { ...result.compact, f: result.compact.f.slice(0, 8) };
    compactJson = JSON.stringify(trimmed);
  }
  const reportHash = ethers.keccak256(ethers.toUtf8Bytes(compactJson));

  const tx = await contract.submitReport(jobId, result.overall, compactJson, reportHash);
  const rc = await tx.wait(1);

  return { ok: true, jobId, status: 1, score: result.overall, report: expandReport(JSON.parse(compactJson)) as Report, txHash: rc.hash };
}

/** Address the configured auditor key signs as (for UI/diagnostics). */
export function auditorAddress(): string | null {
  try { return signer().address; } catch { return null; }
}
