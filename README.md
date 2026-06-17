![SiteAudit — pay a few cents, an agent audits your site, on-chain](docs/cover.png)

# SiteAudit

**Name a URL. Pay a few cents of USDC. An agent scans the site and stamps the report on-chain — before you finish reading this sentence.**

`ARC TESTNET` · `native USDC` · `pay-per-task` · `x402` — live at **siteaudit-arc.vercel.app**

---

### The short version

I've spent thirty years finding what's broken on other people's websites. The first pass is
always the same handful of things — a missing title, a sluggish first byte, no
`Content-Security-Policy` — and it has no business costing a consulting day. So I taught a small
agent to do exactly that pass, and put a coin slot on it.

You drop in a URL and **five cents**. The fee doesn't go anywhere yet — it sits in escrow. An
autonomous agent fetches the page, runs a real scan, scores it out of 100, and **stamps the
verdict on-chain**: who paid, what was scanned, the score, and a `keccak256` fingerprint of the
findings. *Only then* does the nickel leave escrow and land in the agent's wallet. No report, no
payment — your fee is refundable. Work first, money second.

It's the whole pitch of an agent economy in one coin-op: **you don't hire the auditor, you pay it
per job, and the receipt is a fact on a ledger rather than an invoice in an inbox.**

### What the agent actually checks

One `fetch`, three lenses, no LLM hand-waving — every deduction is a rule you can read:

- **🔍 SEO** — `<title>` and its length, meta description, a single `<h1>`, viewport, canonical,
  `lang`, and the Open Graph / Twitter cards that decide how a shared link looks.
- **⏱ Speed** — wall-clock response time (banded), a healthy 2xx, gzip/br compression, HTML weight,
  and whether anything is cached or behind a CDN.
- **🛡 Security** — the headers that actually matter: HTTPS, HSTS, `Content-Security-Policy`,
  clickjacking protection, `nosniff`, `Referrer-Policy`, `Permissions-Policy`. Each missing one is
  a finding with a one-line *why it matters*.

Three sub-scores, weight-blended into the headline. Deliberately a *mini*-audit — meta + timing +
a fistful of headers — not a Lighthouse crawl. Honest about its own scope.

### Why this only works on Arc

A five-cent product dies the instant the toll costs more than the ride. On Arc, **native USDC is
the gas and the money** — the audit fee, the agent's payout, and the agent's own on-chain write
are all the same coin. The nickel arrives roughly intact, and an agent grinding a thousand audits
a day pays each report-write in the currency it just earned, no separate gas tank to babysit. Put
this on an ETH-gas chain and the fee evaporates into gas; the machine-scale version never starts.

### For agents — the audit is a paid API (x402)

The same job a human buys with a pink button, another agent buys over genuine **x402** (HTTP-402).
A bot vetting a list of domains pays per scan, no wallet UI:

```
POST /api/x402/audit            →  402  { accepts:[{ network:"eip155:5042002", maxAmountRequired, payTo, asset:native }] }
requestAudit(url){value:price}  →  tx        (native USDC, escrowed on-chain)
POST /api/x402/audit            X-PAYMENT: base64({ txHash })
                                →  200  { score, report, reportTx }   + X-PAYMENT-RESPONSE
```

**Honest scope:** Arc's USDC is *native* — no ERC-20, no EIP-3009 gasless transfer — so this is
**pay-then-prove**, not a facilitator settlement. The agent pays *through the contract* and proves
it with the transaction; the route self-verifies the `AuditRequested` event on-chain and bounds
replay with a freshness window. Real `402` / `X-PAYMENT` / `X-PAYMENT-RESPONSE` wire format, no
gasless theatre. Demo: [`agent/audit-demo.mjs`](agent/audit-demo.mjs).

### The part I won't oversell

A chain can't prove a scan happened — that's true of every oracle ever written. What
[`SiteAudit.sol`](contracts/SiteAudit.sol) *does* guarantee is the money:

- your fee is **escrowed**, and releases **only** against a posted report — otherwise you reclaim
  100% after the refund window;
- the agent that gets paid is **bound to your job at request time**, so the owner can't re-point a
  later agent at funds you've already escrowed (it's a per-job snapshot, not a mutable global —
  that was the one real bug two independent adversarial reviews chased down before launch, and it's
  closed);
- there is **no admin drain, no protocol fee, no treasury, no withdraw** — every wei that enters
  has exactly one exit, the auditor on delivery or you on refund;
- CEI throughout, terminal-status guards, and a `receive`/`fallback` that refuses loose coins so
  the balance always equals the sum of open jobs.

The report itself is **inline on-chain** (a compact JSON in the job) with a `keccak256` commitment —
re-hash it yourself, it matches. No IPFS pin to rot, no S3 bucket to trust.

### Run it

```bash
npm install
npm run dev          # http://localhost:3000

# the autonomous auditor (its own funded wallet in .env.local):
node agent/auditor.mjs
```

The live site triggers the same agent serverlessly the moment you pay, so an audit lands in
seconds; `agent/auditor.mjs` is the standalone watcher for anyone who wants to run the agent
themselves.

### Specs

```
chain ......... ARC testnet (5042002) · native USDC, 18 decimals
contract ...... SiteAudit.sol — escrow-with-result, no OpenZeppelin, no admin over funds
toolchain ..... solc 0.8.35 · paris · optimizer 200 · no viaIR (flatten-verifiable)
stack ......... Next.js 16 · React 19 · ethers v6 · Tailwind v4
type ......... Cabinet Grotesk · Crimson Pro · Geist Mono
```

---

*Built in Cologne by Andrew Treuberg. Thirty years of telling people their headers are missing —
now automated, on-chain, and wearing pink.*
