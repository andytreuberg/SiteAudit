# SiteAudit — Engagement Report

<img src="assets/seal.svg" align="right" width="200" alt="Stamped score seal — a wobbly Memphis notary stamp reading SCORE 82/100 with passing ticks for SEO, Speed and Security">

**Engagement:** automated first-pass web audit, paid per job, settled and recorded on Arc testnet.
**Assessor:** an autonomous auditor agent (deterministic scanner, no model in the loop).
**Subject under test:** any URL the requester names.
**Live engagement portal:** https://siteaudit-arc.vercel.app/
**Ledger of record:** Arc testnet, chain `5042002`.

> This document is laid out the way a real audit deliverable is: scope, method,
> findings, then how the bill gets settled. The "findings" here are not bugs — they
> describe how the product behaves. Severity tags (INFO / OBS / CTRL) are reused as
> shorthand for *how load-bearing* each behaviour is.

---

## Scope

What gets assessed, and the boundary of the engagement:

- **In scope.** A single HTTP `GET` against the named URL, parsed three ways: on-page
  SEO markup, response timing, and the security response headers. Each produces a
  0–100 sub-score; the three blend (Security 0.40, SEO 0.30, Speed 0.30) into one
  headline figure. The verdict, the URL, the payer, and a `keccak256` digest of the
  report body are written into the contract.
- **Explicitly out of scope.** No headless browser, no JavaScript execution, no crawl
  beyond the one page, no Lighthouse-grade rendering audit, no language model
  generating prose. Every point deducted maps to a named rule in `lib/scan.mjs`. This
  is a *triage* pass — the cheap, repetitive first look a human consultant does before
  the meter starts — not a full penetration test.
- **Trust boundary.** A chain cannot witness that an HTTP fetch occurred; no oracle
  can. So the contract makes no such claim. It attests only to the money trail and the
  report commitment — who paid, what URL, the score the agent signed, and that the fee
  moved *only* against a posted report.

The remainder of this report documents the system as the assessed subject.

---

## Methodology

The flow, traced end to end:

1. A requester submits a URL and the exact fee via `requestAudit(string url)` — a
   `payable` call carrying native USDC. The fee is not forwarded anywhere; it is
   **held in the contract** against a fresh job record (status `Requested`).
2. At that instant the contract **snapshots the current auditor address into the
   job**. Whatever the operator does later, *this* fee can only ever release to the
   agent that was named when the money went in.
3. The auditor agent picks the job up, fetches the page, runs the deterministic scan,
   and calls `submitReport(jobId, score, reportUri, reportHash)`. The report JSON is
   stored **inline** in the job (capped under 1024 bytes); `reportHash` is the
   `keccak256` of that exact body.
4. `submitReport` finalises state, then releases the *escrowed* fee to the auditor in
   one transfer. Effects-before-interaction; a terminal-status guard makes any re-entry
   a no-op.
5. If no report lands inside the refund window, the requester calls `refund(jobId)` and
   reclaims **100%** of the fee. The two exits — auditor-on-delivery, payer-on-timeout —
   are the only paths funds can take.

The scan rules themselves are catalogued, not improvised: missing `<title>`,
out-of-range meta description, absent `<h1>` or multiple of them, no responsive
viewport, missing canonical/`lang`/Open Graph/Twitter tags (SEO); non-2xx status,
slow time-to-first-byte, no gzip/br, oversized HTML, no cache/CDN headers (Speed);
no HTTPS, no HSTS, no `Content-Security-Policy`, no clickjacking defence, no
`nosniff`, no `Referrer-Policy`, no `Permissions-Policy` (Security). Each carries a
one-line *why it matters*.

---

## Findings

Tagged by how central each behaviour is to the design, not by risk.

### CTRL-01 — The fee is held, not trusted

*Control.* `requestAudit` escrows the payment inside `SiteAudit.sol`. No code path lets
the owner withdraw, sweep, or redirect held funds; there is no treasury address and no
protocol cut. `escrowOf(jobId)` reports exactly what is being held for an open job, and
`receive()`/`fallback()` both revert — the contract refuses stray coins, so its balance
always equals the sum of open jobs. Money leaves only as a payout or a refund.

### CTRL-02 — The agent is bound to the job at payment time

*Control.* The auditor address is copied into the job struct on `requestAudit` and
`submitReport` pays `j.auditor`, never the live global. `setAuditor` rotates who
handles *future* jobs and emits `AuditorChanged`; it cannot re-point a fee that is
already in escrow. This separation — per-job binding versus a mutable global pointer —
is the single property the whole settlement model rests on.

### CTRL-03 — Release is conditional on a posted report

*Control.* There is no "pay the agent" button. The only function that moves escrow to
the auditor is `submitReport`, which requires a non-empty report body and a valid
score (0–100) and rejects anything but the `Requested` status. No report, no payout —
and after the timeout, the requester takes the money back.

### OBS-01 — The report lives on the ledger, by value

*Observation.* The findings JSON is stored inline in `reportUri`, with `reportHash =
keccak256(reportUri)` alongside it. Re-hash the body yourself and it matches; there is
no off-chain pin or bucket to trust or to rot. `getJob(id)` returns the whole record —
payer, paid amount, timestamp, status, score, bound auditor, URL, report, hash.

### OBS-02 — Tallies are cosmetic

*Observation.* `jobCount`, `reportedCount`, `refundedCount`, and `paidVolume` are
running counters for the UI. None of them gate a transfer or a state change.

### INFO-01 — Pricing has a floor

*Informational.* `price()` is the current per-audit fee (native USDC, 18 decimals);
`minPrice` is an *immutable* floor set at deploy. `setPrice` can adjust the fee but can
never drop it below `minPrice`. `requestAudit` demands the exact current price — no
over- or underpayment.

---

## Why this engagement is priced for Arc, specifically

Lead with the economics of the work itself. The agent is being paid a handful of cents
to go *do something external* — reach out across the network, pull a page, parse it,
and then write its verdict back to the chain. That write is itself a transaction the
agent pays for. The only way a five-cent job survives is if the fee it collects, the
balance it spends to post the report, and the payout it ultimately keeps are all
denominated in **the same native unit** — here, USDC on Arc, which is the chain's own
transactable asset rather than a wrapped token sitting behind an approval.

Run the identical loop on a chain where the audit is priced in a stablecoin but the
report-write is settled in a separate volatile fee token, and an agent grinding
thousands of audits a day has to hold, top up, and price-hedge a second balance just to
afford writing its own results. The margin on a nickel evaporates into that second
asset. On Arc the agent earns and spends in one currency, so each completed audit nets a
predictable few cents and the machine-scale version of this — bots vetting whole lists
of domains, paying per scan — actually clears. The escrow-with-result model is what
makes paying an autonomous worker safe; doing it for cents is what makes Arc the place
it pencils out.

---

## Settlement model

| step | function | who | effect |
|---|---|---|---|
| request | `requestAudit(url)` `payable` | requester / buyer agent | fee escrowed, job opened, auditor bound |
| deliver | `submitReport(id, score, uri, hash)` | bound auditor only | report stored, escrow released to auditor |
| reclaim | `refund(id)` | payer only, post-timeout | full fee returned, job closed |
| operate | `setPrice` / `setAuditor` / `transferOwnership` | owner | tune future jobs; never touches open escrow |

States: `Requested → Reported` (agent delivers) or `Requested → Refunded` (payer
reclaims). Both are terminal. Events `AuditRequested`, `ReportSubmitted`, and
`AuditRefunded` mark every transition.

**Contract on the ledger:** `0xc131306f4B34425A567E19D04828AB77ebceF672`
**Inspect it:** https://testnet.arcscan.app/address/0xc131306f4B34425A567E19D04828AB77ebceF672

---

## Refund window

`refundAfter` is fixed at deploy (default 3600 seconds) and **immutable** — the operator
cannot stretch the window to sit on a requester's money. `isRefundable(jobId)` returns
true once that window has elapsed on a still-open job; at that point `refund` returns the
full snapshotted fee to the payer and nothing else. The agent is on a clock: deliver, or
the work walks.

---

## The auditor agent — verified autonomous

This is a genuine server-side worker with its own funded wallet, not a client-side
mock.

- `agent/auditor.mjs` — a standalone watcher. It polls `jobCount`, picks up open jobs
  **bound to its own address**, runs the scan, and submits the report. Run it with
  `AUDITOR_PK=0x… node agent/auditor.mjs`.
- `lib/auditor.ts` (`runAudit`) — the same logic, invoked serverlessly. The live site
  fires `POST /api/scan/:jobId` the moment a payment lands, so reports return in
  seconds. The call is idempotent: an already-reported job just returns its existing
  report rather than submitting twice.

Both paths share `lib/scan.mjs` — one fetch, deterministic parsing, identical scoring —
so the standalone agent and the hosted one cannot disagree.

---

## The audit-as-API channel — real x402

`POST /api/x402/audit` exposes the same engagement to other machines over the genuine
HTTP-402 wire format, no wallet UI:

```
POST /api/x402/audit
  → 402  { accepts:[{ scheme:"exact", network:"eip155:5042002",
                       maxAmountRequired, payTo:<contract>, asset:native USDC,
                       extra:{ method:"requestAudit(string url)" } }] }

requestAudit(url){value:price}              # buyer pays on-chain (native USDC, escrowed)

POST /api/x402/audit   X-PAYMENT: base64({ txHash })
  → 200  { jobId, url, score, report, reportTx }   + X-PAYMENT-RESPONSE
```

**Disclosed limitation, stated plainly.** Arc's USDC is the native coin — there is no
ERC-20 surface and no EIP-3009 gasless transfer — so this is **pay-then-prove**, not a
facilitator settlement. The buyer pays *through the contract* and presents the
transaction hash; the route verifies the `AuditRequested` event on-chain, checks the
amount, and bounds replay with a 300-second freshness window plus a seen-set. The
status codes and `X-PAYMENT` / `X-PAYMENT-RESPONSE` headers are real; there is no
gasless theatre and no third-party facilitator. Reference client:
[`agent/audit-demo.mjs`](agent/audit-demo.mjs).

---

## Reproducing the engagement locally

```bash
npm install
npm run dev                      # http://localhost:3000

# the autonomous auditor (its own funded key in .env.local):
AUDITOR_PK=0x… node agent/auditor.mjs

# an agent buying an audit over x402, end to end:
BUYER_PK=0x… CONTRACT=0xc131306f4B34425A567E19D04828AB77ebceF672 \
  API_BASE=http://localhost:3000 node agent/audit-demo.mjs https://example.com
```

---

## Assessor's note

Filed by Andrew Treuberg. I have spent a long career telling site owners that their
security headers are missing; the finding is almost always the same and rarely worth a
consulting day. This is that first pass, handed to an agent, billed per job, and signed
into a ledger instead of an invoice.
