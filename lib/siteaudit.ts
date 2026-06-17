import { ethers } from "ethers";
import { ARC_RPC } from "./arcNetwork";
// @ts-ignore — plain ESM module, the report catalog is the single source of truth
import { CATALOG, CATEGORY_LABEL, SEV_LABEL, expandReport, band } from "./scan.mjs";

export { CATALOG, CATEGORY_LABEL, SEV_LABEL, expandReport, band };

// ─────────────────────────────────────────────────────────────────────────────
// SiteAudit — pay-per-task audit jobs on ARC. Native USDC; report stored inline,
// on-chain. Set after deploy (scripts/deploy.mjs bakes it in).
// ─────────────────────────────────────────────────────────────────────────────
export const CONTRACT_ADDRESS = "0xc131306f4B34425A567E19D04828AB77ebceF672";

export const SITEAUDIT_ABI = [
  "function price() view returns (uint96)",
  "function minPrice() view returns (uint96)",
  "function refundAfter() view returns (uint64)",
  "function auditor() view returns (address)",
  "function owner() view returns (address)",
  "function jobCount() view returns (uint256)",
  "function reportedCount() view returns (uint256)",
  "function refundedCount() view returns (uint256)",
  "function paidVolume() view returns (uint256)",
  "function requestAudit(string url) payable returns (uint256)",
  "function submitReport(uint256 jobId, uint8 score, string reportUri, bytes32 reportHash)",
  "function refund(uint256 jobId)",
  "function setAuditor(address next)",
  "function setPrice(uint96 next)",
  "function getJob(uint256) view returns (address payer, uint96 paid, uint64 requestedAt, uint8 status, uint8 score, address jobAuditor, string url, string reportUri, bytes32 reportHash)",
  "function isRefundable(uint256) view returns (bool)",
  "function escrowOf(uint256) view returns (uint256)",
  "event AuditRequested(uint256 indexed jobId, address indexed payer, string url, uint256 paid)",
  "event ReportSubmitted(uint256 indexed jobId, address indexed auditor, uint8 score, string reportUri, bytes32 reportHash)",
  "event AuditRefunded(uint256 indexed jobId, address indexed payer, uint256 amount)",
];

export const STATUS = { Requested: 0, Reported: 1, Refunded: 2 } as const;
export const STATUS_LABEL = ["Scanning", "Reported", "Refunded"];

export interface Finding { cat: string; sev: string; code: string; label: string; why: string; category: string; }
export interface Report { v: number; u: string; sc: number; s: { seo: number; spd: number; sec: number }; st: number; ms: number; t: number; findings: Finding[]; }

export interface Job {
  id: number;
  payer: string;
  paid: bigint;
  requestedAt: number;
  status: number;
  score: number;
  auditor: string;
  url: string;
  reportUri: string;
  reportHash: string;
  report: Report | null; // parsed + expanded inline report, when Reported
}

export interface Config {
  price: bigint; minPrice: bigint; refundAfter: number;
  auditor: string; owner: string;
  jobCount: number; reportedCount: number; refundedCount: number; paidVolume: bigint;
}
export const EMPTY_CONFIG: Config = {
  price: 0n, minPrice: 0n, refundAfter: 3600, auditor: "", owner: "",
  jobCount: 0, reportedCount: 0, refundedCount: 0, paidVolume: 0n,
};

export function readProvider() { return new ethers.JsonRpcProvider(ARC_RPC); }
export function readContract(p?: ethers.Provider) { return new ethers.Contract(CONTRACT_ADDRESS, SITEAUDIT_ABI, p ?? readProvider()); }
export function hasContract(): boolean { return /^0x[a-fA-F0-9]{40}$/.test(CONTRACT_ADDRESS); }

async function mapLimit<T, R>(items: T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += limit) {
    const s = await Promise.allSettled(items.slice(i, i + limit).map(fn));
    s.forEach((r) => { if (r.status === "fulfilled") out.push(r.value); });
  }
  return out;
}

function parseReport(reportUri: string): Report | null {
  const t = (reportUri || "").trim();
  if (!t.startsWith("{")) return null;
  try {
    const c = JSON.parse(t);
    return expandReport(c) as Report;
  } catch {
    return null;
  }
}

export async function fetchConfig(contract?: ethers.Contract): Promise<Config> {
  const c = contract ?? readContract();
  const [price, minPrice, refundAfter, auditor, owner, jobCount, reportedCount, refundedCount, paidVolume] = await Promise.all([
    c.price(), c.minPrice(), c.refundAfter(), c.auditor(), c.owner(), c.jobCount(), c.reportedCount(), c.refundedCount(), c.paidVolume(),
  ]);
  return {
    price, minPrice, refundAfter: Number(refundAfter), auditor, owner,
    jobCount: Number(jobCount), reportedCount: Number(reportedCount), refundedCount: Number(refundedCount), paidVolume,
  };
}

export async function fetchJob(id: number, contract?: ethers.Contract): Promise<Job | null> {
  const c = contract ?? readContract();
  try {
    const j = await c.getJob(id);
    if (j.payer === ethers.ZeroAddress) return null;
    return {
      id, payer: j.payer, paid: j.paid, requestedAt: Number(j.requestedAt),
      status: Number(j.status), score: Number(j.score), auditor: j.jobAuditor,
      url: j.url, reportUri: j.reportUri, reportHash: j.reportHash,
      report: parseReport(j.reportUri),
    };
  } catch { return null; }
}

export async function fetchRecentJobs(count = 18, contract?: ethers.Contract): Promise<Job[]> {
  const c = contract ?? readContract();
  const total = Number(await c.jobCount());
  if (total === 0) return [];
  const ids = Array.from({ length: total }, (_, i) => total - i).slice(0, count);
  const out = await mapLimit(ids, 6, (id) => fetchJob(id, c));
  return out.filter((x): x is Job => !!x).sort((a, b) => b.id - a.id);
}

export async function fetchMyJobs(addr: string, contract?: ethers.Contract): Promise<Job[]> {
  if (!addr) return [];
  const c = contract ?? readContract();
  try {
    const filter = c.filters.AuditRequested(null, addr);
    const logs = await c.queryFilter(filter, 0, "latest");
    const ids = logs.map((l) => Number((l as ethers.EventLog).args?.jobId)).filter((n) => n > 0);
    const uniq = Array.from(new Set(ids)).sort((a, b) => b - a).slice(0, 40);
    const out = await mapLimit(uniq, 6, (id) => fetchJob(id, c));
    return out.filter((x): x is Job => !!x).sort((a, b) => b.id - a.id);
  } catch {
    // fallback: scan recent jobs and filter by payer
    const recent = await fetchRecentJobs(40, c);
    return recent.filter((j) => j.payer.toLowerCase() === addr.toLowerCase());
  }
}

// ── helpers ──────────────────────────────────────────────────────────────────
export function shortAddr(a: string, lead = 6, tail = 4): string { return a ? `${a.slice(0, lead)}…${a.slice(-tail)}` : ""; }

export function fmtUsdc(wei: bigint, dp = 2): string {
  const n = parseFloat(ethers.formatEther(wei));
  if (n === 0) return "0.00";
  if (n < 0.01) { const s = n.toFixed(4).replace(/0+$/, "").replace(/\.$/, ""); return s === "0" ? "<0.01" : s; }
  return n.toFixed(dp);
}

/** cents string for the headline price, e.g. 0.05 USDC → "5¢" */
export function centsLabel(wei: bigint): string {
  const n = parseFloat(ethers.formatEther(wei));
  const cents = n * 100;
  if (cents < 1) return `${(cents).toFixed(2)}¢`;
  return Number.isInteger(cents) ? `${cents}¢` : `${cents.toFixed(1)}¢`;
}

export function secsLabel(s: number): string {
  if (s % 3600 === 0) return `${s / 3600}h`;
  if (s % 60 === 0) return `${s / 60}m`;
  return `${s}s`;
}

export function timeAgo(unix: number, now: number): string {
  const d = Math.max(0, now - unix);
  if (d < 60) return `${d}s ago`;
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  return `${Math.floor(d / 86400)}d ago`;
}

/** seconds left until a job becomes refundable */
export function refundIn(job: Job, refundAfter: number, now: number): number {
  return Math.max(0, job.requestedAt + refundAfter - now);
}
