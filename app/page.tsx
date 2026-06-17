"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ethers } from "ethers";
import { useWallet } from "@/lib/useWallet";
import { pickProvider } from "@/lib/wallet";
import { switchToArc } from "@/lib/arcNetwork";
import { ARCSCAN } from "@/lib/arcNetwork";
import {
  CONTRACT_ADDRESS, SITEAUDIT_ABI, hasContract,
  fetchConfig, fetchRecentJobs, fetchJob,
  type Config, type Job, EMPTY_CONFIG,
  fmtUsdc, centsLabel, secsLabel, shortAddr, timeAgo, band,
} from "@/lib/siteaudit";
import {
  Filters, IconMagnifier, IconGauge, IconEye, IconShare, IconRobot, ScoreSeal, MiniShapes,
} from "./art";

type Phase = "idle" | "paying" | "scanning" | "done" | "error";
const bandClass = (s: number) => (band(s) === "pass" ? "pass" : band(s) === "warn" ? "warn" : "fail");

const CHECKS = [
  { key: "seo", title: "SEO", Icon: IconMagnifier, blurb: "Title, meta description, H1, viewport, canonical, lang, Open Graph & Twitter cards.", rot: -5 },
  { key: "spd", title: "Speed", Icon: IconGauge, blurb: "Server response time, healthy status, gzip/br compression, payload size, caching.", rot: 4 },
  { key: "sec", title: "Security", Icon: IconEye, blurb: "HTTPS, HSTS, Content-Security-Policy, clickjacking, nosniff, Referrer & Permissions policy.", rot: -3 },
  { key: "meta", title: "On-chain receipt", Icon: IconShare, blurb: "Who paid, what URL, the score, and a keccak256 commitment — stamped immutably on Arc.", rot: 5 },
];

export default function Page() {
  const { account, balance, chainOk, connecting, connect } = useWallet();
  const [config, setConfig] = useState<Config>(EMPTY_CONFIG);
  const [recent, setRecent] = useState<Job[]>([]);
  const [now, setNow] = useState(0);
  const [url, setUrl] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [active, setActive] = useState<Job | null>(null);
  const [err, setErr] = useState("");
  const [modal, setModal] = useState<null | "how" | "agents">(null);
  const formRef = useRef<HTMLInputElement>(null);

  const live = hasContract();

  const refresh = useCallback(async () => {
    if (!live) return;
    try {
      const [cfg, jobs] = await Promise.all([fetchConfig(), fetchRecentJobs(15)]);
      setConfig(cfg); setRecent(jobs);
    } catch { /* rpc hiccup */ }
  }, [live]);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    setNow(Math.floor(Date.now() / 1000));
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, []);

  const priceLabel = config.price > 0n ? centsLabel(config.price) : "5¢";

  async function getSigner() {
    const inj = pickProvider();
    if (!inj) throw new Error("No wallet detected. Install Rabby or MetaMask.");
    if (!account) await connect();
    try { await switchToArc(inj); } catch { /* */ }
    const bp = new ethers.BrowserProvider(inj);
    return await bp.getSigner();
  }

  const startAudit = useCallback(async () => {
    setErr("");
    let target = url.trim();
    if (!target) { formRef.current?.focus(); return; }
    if (!/^https?:\/\//i.test(target)) target = "https://" + target;
    try { new URL(target); } catch { setErr("That doesn't look like a valid URL."); setPhase("error"); return; }
    if (!live) { setErr("The contract isn't deployed yet."); setPhase("error"); return; }

    try {
      setPhase("paying");
      const signer = await getSigner();
      const c = new ethers.Contract(CONTRACT_ADDRESS, SITEAUDIT_ABI, signer);
      const price = await c.price();
      const tx = await c.requestAudit(target, { value: price });
      const rc = await tx.wait(1);

      // pull jobId from the AuditRequested event
      const iface = new ethers.Interface(SITEAUDIT_ABI);
      let jobId = 0;
      for (const log of rc!.logs) {
        try { const ev = iface.parseLog({ topics: log.topics as string[], data: log.data }); if (ev?.name === "AuditRequested") { jobId = Number(ev.args.jobId); break; } } catch { /* */ }
      }
      if (!jobId) throw new Error("Could not read the job id from the receipt.");

      setPhase("scanning");
      const stub = await fetchJob(jobId);
      if (stub) setActive(stub);

      // trigger the auditor agent (serverless) to scan + stamp the report
      const res = await fetch(`/api/scan/${jobId}`, { method: "POST" });
      const out = await res.json().catch(() => ({}));

      // read the finished job back from chain (authoritative)
      let done = await fetchJob(jobId);
      if (done && done.status !== 1) {
        // brief poll in case the node lags the submit
        for (let i = 0; i < 4 && (!done || done.status !== 1); i++) {
          await new Promise((r) => setTimeout(r, 1200));
          done = await fetchJob(jobId);
        }
      }
      if (done && done.status === 1) { setActive(done); setPhase("done"); }
      else { setErr(out?.error || "The agent could not complete this audit. Your fee is refundable after the timeout."); setActive(done ?? stub ?? null); setPhase("error"); }
      refresh();
    } catch (e: unknown) {
      const m = (e as { shortMessage?: string; message?: string })?.shortMessage || (e as Error)?.message || "Something went wrong.";
      setErr(/user rejected|denied/i.test(m) ? "Transaction rejected." : m);
      setPhase("error");
    }
  }, [url, live, account]); // eslint-disable-line react-hooks/exhaustive-deps

  const reset = () => { setPhase("idle"); setActive(null); setErr(""); setUrl(""); };

  return (
    <div className="wrap">
      <Filters />
      <div className="grid-ground" />
      <MiniShapes />

      {/* corner nav */}
      <div className="corner" style={{ top: 18, left: 22, fontSize: "1.05rem" }}>
        <button onClick={reset}>SiteAudit <span style={{ color: "var(--tomato)" }}>’26</span></button>
      </div>
      <div className="corner" style={{ top: 18, right: 22, display: "flex", gap: 14, alignItems: "center" }}>
        {account ? (
          <span className="mono" style={{ fontSize: ".8rem", fontStyle: "normal", display: "flex", alignItems: "center", gap: 8 }}>
            <span className="chip" style={{ background: chainOk ? "color-mix(in srgb,var(--pass) 18%,var(--paper))" : "color-mix(in srgb,var(--warn) 20%,var(--paper))", borderColor: chainOk ? "var(--pass)" : "var(--warn)", color: chainOk ? "var(--pass)" : "#a9730a" }}>
              {chainOk ? "ARC" : "wrong net"}
            </span>
            {shortAddr(account)} · {balance}
          </span>
        ) : (
          <button onClick={connect}>{connecting ? "connecting…" : "Connect"}</button>
        )}
      </div>
      <div className="corner" style={{ bottom: 16, left: 22 }}>
        <button onClick={() => setModal("agents")}>For agents · x402</button>
      </div>
      <div className="corner" style={{ bottom: 16, right: 22 }}>
        <button onClick={() => setModal("how")}>How it works</button>
      </div>

      {/* ── HERO / FLOW ──────────────────────────────────────────────────── */}
      <main style={{ maxWidth: 1080, margin: "0 auto", padding: "92px 20px 40px", position: "relative" }}>
        {phase === "idle" || phase === "error" ? (
          <HeroForm
            url={url} setUrl={setUrl} startAudit={startAudit} formRef={formRef}
            priceLabel={priceLabel} account={account} err={phase === "error" ? err : ""}
          />
        ) : (
          <RunPanel phase={phase} active={active} priceLabel={priceLabel} err={err} reset={reset} now={now} />
        )}

        {/* what the agent checks — scattered illustration cards */}
        {(phase === "idle" || phase === "error") && (
          <section style={{ marginTop: 60 }}>
            <p className="tag-rule" style={{ textAlign: "center", fontSize: "1.15rem", margin: "0 0 26px" }}>
              one fetch, three lenses, a stamped verdict —
            </p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 22, justifyContent: "center" }}>
              {CHECKS.map((ch) => (
                <div key={ch.key} className="icard float" style={{ width: 246, padding: "20px 20px 22px", transform: `rotate(${ch.rot}deg)`, animationDelay: `${ch.rot * 0.1}s` }}>
                  <ch.Icon />
                  <h3 className="wordmark" style={{ color: "var(--ink)", textShadow: "none", fontSize: "1.5rem", margin: "10px 0 6px", letterSpacing: "-0.03em" }}>{ch.title}</h3>
                  <p className="serif" style={{ fontSize: ".95rem", lineHeight: 1.45, margin: 0 }}>{ch.blurb}</p>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* recent audits shelf */}
        {recent.length > 0 && (phase === "idle" || phase === "error") && (
          <section style={{ marginTop: 64 }}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 16 }}>
              <h2 className="wordmark" style={{ color: "var(--ink)", textShadow: "none", fontSize: "1.6rem" }}>Freshly stamped</h2>
              <span className="mono" style={{ fontSize: ".72rem", opacity: .7 }}>{config.reportedCount} audited · {fmtUsdc(config.paidVolume)} USDC paid to agents</span>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 16 }}>
              {recent.map((j, i) => <RecentCard key={j.id} job={j} now={now} rot={(i % 3) - 1} />)}
            </div>
          </section>
        )}

        {!live && (
          <p className="mono" style={{ textAlign: "center", marginTop: 40, fontSize: ".8rem", opacity: .7 }}>
            Contract pending deployment — the interface is live, audits open once it’s on Arc.
          </p>
        )}
      </main>

      <footer style={{ position: "relative", zIndex: 1, textAlign: "center", padding: "30px 20px 70px" }}>
        <p className="serif" style={{ fontStyle: "italic", fontSize: "1rem", margin: "0 0 6px" }}>
          Pay a few cents. An agent does the work. The receipt lives on-chain.
        </p>
        <p className="mono" style={{ fontSize: ".7rem", opacity: .65, margin: 0 }}>
          SiteAudit · native USDC on ARC testnet{live ? ` · ${shortAddr(CONTRACT_ADDRESS)}` : ""} · built by Andrew Treuberg
        </p>
      </footer>

      {modal && <Modal kind={modal} onClose={() => setModal(null)} priceLabel={priceLabel} config={config} />}
    </div>
  );
}

/* ── hero with the audit form ─────────────────────────────────────────────── */
function HeroForm({ url, setUrl, startAudit, formRef, priceLabel, account, err }: {
  url: string; setUrl: (s: string) => void; startAudit: () => void; formRef: React.RefObject<HTMLInputElement | null>;
  priceLabel: string; account: string; err: string;
}) {
  return (
    <section style={{ textAlign: "center", position: "relative" }}>
      <p className="serif" style={{ fontStyle: "italic", fontSize: "1.1rem", margin: "0 0 8px", color: "var(--ink)" }}>
        the cheerful little site auditor
      </p>
      <h1 className="wordmark" style={{ fontSize: "clamp(3.4rem, 12vw, 8rem)", margin: "0 0 14px" }}>SiteAudit</h1>
      <p style={{ maxWidth: 560, margin: "0 auto 30px", fontSize: "1.08rem", lineHeight: 1.5, fontWeight: 700 }}>
        Name a URL, pay <b style={{ color: "var(--tomato)" }}>{priceLabel}</b> in USDC, and an autonomous agent
        scans it for SEO, speed &amp; security issues — then stamps the report on-chain.
      </p>

      <div className="panel wob" style={{ maxWidth: 600, margin: "0 auto", padding: "18px 18px 20px", filter: "url(#wobble)" }}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <input
            ref={formRef} className="url-input" style={{ flex: "1 1 280px" }}
            placeholder="example.com" value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") startAudit(); }}
            spellCheck={false} autoCapitalize="none"
          />
          <button className="pill pill-primary" style={{ flex: "0 0 auto", filter: "none" }} onClick={startAudit}>
            Pay {priceLabel} &amp; scan →
          </button>
        </div>
        <p className="mono" style={{ fontSize: ".68rem", opacity: .65, margin: "12px 2px 0", textAlign: "left" }}>
          {account ? "Your fee is escrowed and released only when the agent delivers — else refundable." : "Connect a wallet to pay. Native USDC on ARC; no token approvals."}
        </p>
        {err && <p className="mono tx-fail" style={{ fontSize: ".78rem", margin: "10px 2px 0", textAlign: "left", fontWeight: 600 }}>⚠ {err}</p>}
      </div>
    </section>
  );
}

/* ── the running / finished audit ─────────────────────────────────────────── */
function RunPanel({ phase, active, priceLabel, err, reset, now }: {
  phase: Phase; active: Job | null; priceLabel: string; err: string; reset: () => void; now: number;
}) {
  const rep = active?.report;
  const sub = rep?.s;
  const worst = sub ? Math.min(sub.seo, sub.spd, sub.sec) : (active?.score ?? 0);
  const scanning = phase === "scanning" || phase === "paying";

  return (
    <section style={{ textAlign: "center" }}>
      <button className="pill pill-sm" style={{ marginBottom: 22 }} onClick={reset}>← new audit</button>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center", alignItems: "baseline", marginBottom: 6 }}>
        <h1 className="wordmark" style={{ color: "var(--ink)", textShadow: "3px 4px 0 var(--tomato)", fontSize: "clamp(2.2rem,7vw,4.2rem)" }}>
          {active?.report?.u || (active?.url || "").replace(/^https?:\/\//, "").replace(/\/$/, "") || "scanning…"}
        </h1>
      </div>

      <div className="seal-wrap" style={{ margin: "18px 0 8px" }}>
        <ScoreSeal
          score={phase === "done" ? (active?.score ?? 0) : 0}
          scanning={scanning}
          state={phase === "done" ? bandClass(worst) : "warn"}
          tx={phase === "done" ? active?.reportUri : ""}
        />
      </div>

      {scanning && (
        <p className="serif" style={{ fontStyle: "italic", fontSize: "1.15rem", marginTop: 6 }}>
          {phase === "paying" ? "escrowing your fee…" : "the agent is fetching and scanning the site…"}
        </p>
      )}

      {phase === "error" && (
        <div className="panel" style={{ maxWidth: 520, margin: "14px auto 0", padding: "16px 18px", textAlign: "left" }}>
          <p className="mono tx-fail" style={{ fontWeight: 600, margin: 0, fontSize: ".85rem" }}>⚠ {err}</p>
          {active && active.status === 0 && (
            <p className="serif" style={{ margin: "8px 0 0", fontStyle: "italic", fontSize: ".95rem" }}>
              Job #{active.id} is open. If no report lands, you can reclaim your {priceLabel} after the refund window.
            </p>
          )}
        </div>
      )}

      {phase === "done" && rep && sub && (
        <>
          {/* three category sub-scores */}
          <div style={{ display: "flex", gap: 14, justifyContent: "center", flexWrap: "wrap", margin: "22px 0 8px" }}>
            {[
              { label: "SEO", v: sub.seo, Icon: IconMagnifier },
              { label: "Speed", v: sub.spd, Icon: IconGauge },
              { label: "Security", v: sub.sec, Icon: IconEye },
            ].map((s) => (
              <div key={s.label} className={`icard edge-${bandClass(s.v)}`} style={{ width: 168, padding: "14px 16px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span className="mono" style={{ fontSize: ".66rem", letterSpacing: ".1em", textTransform: "uppercase", opacity: .8 }}>{s.label}</span>
                  <span className={`chip chip-${bandClass(s.v)}`}>{band(s.v)}</span>
                </div>
                <div className="mono" style={{ fontSize: "2.3rem", fontWeight: 600, lineHeight: 1.1, marginTop: 4 }} >{s.v}<span style={{ fontSize: "1rem", opacity: .5 }}>/100</span></div>
              </div>
            ))}
          </div>

          {/* findings */}
          <div className="panel" style={{ maxWidth: 720, margin: "20px auto 0", padding: "20px 22px", textAlign: "left" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 12 }}>
              <h3 className="wordmark" style={{ color: "var(--ink)", textShadow: "none", fontSize: "1.3rem" }}>
                {rep.findings.length ? `${rep.findings.length} finding${rep.findings.length === 1 ? "" : "s"}` : "Clean bill of health"}
              </h3>
              <span className="mono" style={{ fontSize: ".66rem", opacity: .6 }}>HTTP {rep.st || "—"} · {rep.ms}ms</span>
            </div>
            {rep.findings.length === 0 ? (
              <p className="serif" style={{ fontStyle: "italic", margin: 0 }}>No issues flagged across SEO, speed, or security headers. Nicely done.</p>
            ) : (
              <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 8 }}>
                {rep.findings.map((f, i) => (
                  <li key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "8px 0", borderTop: i ? "1.5px dashed color-mix(in srgb,var(--ink) 22%,transparent)" : "none" }}>
                    <span className={`chip chip-${f.sev === "hi" ? "fail" : f.sev === "md" ? "warn" : "pass"}`} style={{ flex: "0 0 auto", marginTop: 2 }}>{f.category}</span>
                    <span>
                      <b style={{ fontWeight: 800 }}>{f.label}</b>
                      <span className="serif" style={{ display: "block", fontSize: ".9rem", opacity: .85, lineHeight: 1.4 }}>{f.why}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {active && (
              <p className="mono" style={{ fontSize: ".66rem", opacity: .6, marginTop: 14, marginBottom: 0 }}>
                Job #{active.id} · stamped {timeAgo(active.requestedAt, now)} ·{" "}
                <a className="flat-link" href={`${ARCSCAN}/address/${CONTRACT_ADDRESS}`} target="_blank" rel="noreferrer">on-chain receipt ↗</a>
                {" "}· keccak256(report) committed
              </p>
            )}
          </div>
        </>
      )}
    </section>
  );
}

/* ── recent audit mini-card ───────────────────────────────────────────────── */
function RecentCard({ job, now, rot }: { job: Job; now: number; rot: number }) {
  const reported = job.status === 1;
  const refunded = job.status === 2;
  const b = reported ? bandClass(job.score) : "warn";
  const host = job.report?.u || job.url.replace(/^https?:\/\//, "").replace(/\/$/, "");
  return (
    <div className={`icard ${reported ? `edge-${b}` : ""}`} style={{ width: 218, padding: "13px 15px", transform: `rotate(${rot * 1.4}deg)` }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <span className="mono" style={{ fontSize: ".8rem", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{host}</span>
        {reported ? (
          <span className={`mono tx-${b}`} style={{ fontSize: "1.4rem", fontWeight: 600 }}>{job.score}</span>
        ) : refunded ? <span className="chip chip-fail">refunded</span> : <span className="chip chip-warn">scan</span>}
      </div>
      <div className="mono" style={{ fontSize: ".6rem", opacity: .6, marginTop: 8, display: "flex", justifyContent: "space-between" }}>
        <span>#{job.id} · {timeAgo(job.requestedAt, now)}</span>
        <a className="flat-link" href={`${ARCSCAN}/address/${CONTRACT_ADDRESS}`} target="_blank" rel="noreferrer">↗</a>
      </div>
    </div>
  );
}

/* ── modals ───────────────────────────────────────────────────────────────── */
function Modal({ kind, onClose, priceLabel, config }: { kind: "how" | "agents"; onClose: () => void; priceLabel: string; config: Config }) {
  return (
    <div className="scrim" onClick={onClose}>
      <div className={kind === "agents" ? "panel-ink" : "panel"} style={{ maxWidth: 600, width: "100%", padding: "26px 28px", maxHeight: "86vh", overflowY: "auto" }} onClick={(e) => e.stopPropagation()}>
        {kind === "how" ? (
          <>
            <h2 className="wordmark" style={{ color: "var(--ink)", textShadow: "2px 3px 0 var(--tomato)", fontSize: "2rem", marginTop: 0 }}>How it works</h2>
            <ol className="serif" style={{ fontSize: "1.02rem", lineHeight: 1.55, paddingLeft: 20, display: "grid", gap: 10 }}>
              <li><b>You pay {priceLabel}</b> in native USDC and name a URL. The fee is <i>escrowed</i> in the contract — not released on faith.</li>
              <li><b>An autonomous agent</b> fetches the site and runs a real scan: SEO meta, response speed, and security headers — deterministic, no guesswork.</li>
              <li><b>It stamps the report on-chain</b> — a 0–100 score plus a keccak256 commitment to the findings — and only then does the escrow release to it.</li>
              <li><b>No delivery, full refund.</b> If the agent goes quiet past the {secsLabel(config.refundAfter || 3600)} window, you reclaim 100%.</li>
            </ol>
            <p className="mono" style={{ fontSize: ".74rem", opacity: .7 }}>
              Why Arc? A {priceLabel} audit only makes sense where USDC <i>is</i> the gas — the fee, the agent’s payout, and the on-chain write are one unit. On an ETH-gas chain the gas eats the sale.
            </p>
            <button className="pill pill-sm" onClick={onClose}>got it</button>
          </>
        ) : (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6 }}>
              <IconRobot />
              <h2 className="wordmark" style={{ color: "var(--paper)", textShadow: "2px 3px 0 var(--tomato)", fontSize: "1.8rem", margin: 0 }}>Agents audit at machine scale</h2>
            </div>
            <p className="serif" style={{ fontSize: "1.02rem", lineHeight: 1.5, color: "var(--paper)" }}>
              The same audit is a paid API. Another agent vetting a list of sites pays per scan over genuine <b>x402</b> (HTTP-402) — no wallet UI, no human in the loop.
            </p>
            <div className="codeblock">
              <div><span className="d"># 1 — ask, get the price</span></div>
              <div><span className="k">POST</span> /api/x402/audit  →  <span className="g">402</span></div>
              <div className="d">{`{ accepts:[{ network:"eip155:5042002", maxAmountRequired, payTo, asset:native }] }`}</div>
              <div style={{ height: 6 }} />
              <div><span className="d"># 2 — pay on-chain, then prove</span></div>
              <div>requestAudit(url)<span className="k">{`{value:price}`}</span> → tx</div>
              <div><span className="k">POST</span> /api/x402/audit  <span className="d">X-PAYMENT: base64({`{txHash}`})</span></div>
              <div><span className="g">200</span> {`{ score, report, reportTx }`} <span className="d">+ X-PAYMENT-RESPONSE</span></div>
            </div>
            <p className="mono" style={{ fontSize: ".7rem", color: "var(--paper)", opacity: .75 }}>
              Honest scope: Arc’s USDC is native (no ERC-20, no EIP-3009 gasless), so this is <b>pay-then-prove</b> — the agent pays through the contract and proves it with the tx; the server self-verifies on-chain, no facilitator. Real 402 / X-PAYMENT / X-PAYMENT-RESPONSE wire format.
            </p>
            <button className="pill pill-sm" onClick={onClose}>close</button>
          </>
        )}
      </div>
    </div>
  );
}
