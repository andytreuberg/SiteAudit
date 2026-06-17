// ─────────────────────────────────────────────────────────────────────────────
// SiteAudit — the scan. Pure, deterministic, no LLM, no headless browser.
// One fetch(url) + header/HTML parsing → three category scores (0..100) and a
// typed findings list. Shared by the autonomous agent (agent/auditor.mjs) and the
// serverless auditor route (app/api/scan). Runs on Node 18+ (global fetch).
//
// The report it produces is COMPACT and goes on-chain inline (the contract's
// reportUri field, < 1024 chars). The UI expands finding codes to human text via
// CATALOG below, so the catalog is the single source of truth for both sides.
// ─────────────────────────────────────────────────────────────────────────────

/** code → { cat, label, why } — the human-readable expansion of every finding. */
export const CATALOG = {
  // ── SEO ──
  "title-missing":  { cat: "seo", label: "No <title> tag", why: "The title is the single biggest on-page SEO signal and the clickable headline in search results." },
  "title-len":      { cat: "seo", label: "Title length off (aim 10–60 chars)", why: "Very short or long titles get truncated or look thin in search results." },
  "desc-missing":   { cat: "seo", label: "No meta description", why: "Search engines fall back to scraping page text; a written description controls the snippet." },
  "desc-len":       { cat: "seo", label: "Meta description length off (aim 50–160)", why: "Out-of-range descriptions get cut off or padded in the snippet." },
  "h1-missing":     { cat: "seo", label: "No <h1> heading", why: "The H1 tells crawlers and readers what the page is primarily about." },
  "h1-multi":       { cat: "seo", label: "Multiple <h1> headings", why: "More than one top-level heading muddies the page's primary topic." },
  "viewport":       { cat: "seo", label: "No responsive viewport meta", why: "Without it mobile browsers render desktop-width; mobile-friendliness is a ranking factor." },
  "canonical":      { cat: "seo", label: "No canonical link", why: "Canonical tags prevent duplicate-content dilution across URL variants." },
  "lang":           { cat: "seo", label: "No lang attribute on <html>", why: "Declaring the language helps search engines and screen readers." },
  "og":             { cat: "seo", label: "Missing Open Graph tags", why: "Without og:title/og:image, shared links render as bland, low-click previews." },
  "twitter":        { cat: "seo", label: "No Twitter card meta", why: "twitter:card controls how the page looks when shared on X/Twitter." },
  // ── SPEED ──
  "status":         { cat: "spd", label: "Non-2xx HTTP status", why: "The page did not return a healthy 200-range response on a plain GET." },
  "unreachable":    { cat: "spd", label: "Site could not be fetched", why: "The request timed out or the host refused/failed to connect." },
  "slow":           { cat: "spd", label: "Slow server response", why: "High time-to-first-byte delays everything downstream and hurts rankings and bounce rate." },
  "no-compression": { cat: "spd", label: "No gzip/br compression", why: "Uncompressed HTML wastes bandwidth and slows first paint, especially on mobile." },
  "large-html":     { cat: "spd", label: "Large HTML payload", why: "A heavy HTML document is slower to download and parse." },
  "no-cache":       { cat: "spd", label: "No cache/CDN headers", why: "Missing cache-control / CDN headers means repeat visits re-fetch everything." },
  // ── SECURITY ──
  "no-https":       { cat: "sec", label: "Not served over HTTPS", why: "Plain HTTP is unencrypted and tamperable in transit; browsers flag it as Not Secure." },
  "hsts":           { cat: "sec", label: "No HSTS header", why: "Strict-Transport-Security forces HTTPS and blocks SSL-strip downgrade attacks." },
  "csp":            { cat: "sec", label: "No Content-Security-Policy", why: "A CSP is the strongest defense against cross-site scripting and content injection." },
  "xfo":            { cat: "sec", label: "No clickjacking protection", why: "Without X-Frame-Options or CSP frame-ancestors the page can be framed for clickjacking." },
  "nosniff":        { cat: "sec", label: "No X-Content-Type-Options: nosniff", why: "MIME-sniffing lets browsers reinterpret responses as executable content." },
  "referrer":       { cat: "sec", label: "No Referrer-Policy", why: "Without it, full URLs (with any tokens) leak to third parties via the Referer header." },
  "permissions":    { cat: "sec", label: "No Permissions-Policy", why: "Permissions-Policy locks down camera/mic/geolocation access for the page and its frames." },
};

export const CATEGORY_LABEL = { seo: "SEO", spd: "Speed", sec: "Security" };
export const SEV_LABEL = { hi: "high", md: "medium", lo: "low" };

const WEIGHTS = { seo: 0.30, spd: 0.30, sec: 0.40 };

function clamp(n) { return Math.max(0, Math.min(100, Math.round(n))); }
function get(headers, k) { return headers[k.toLowerCase()] || ""; }

// ── fetch the site once, measure, capture headers + (capped) body ───────────
export async function fetchSite(rawUrl, { timeoutMs = 10000 } = {}) {
  let url = String(rawUrl || "").trim();
  if (!/^https?:\/\//i.test(url)) url = "https://" + url;
  const isHttps = /^https:\/\//i.test(url);

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  const started = Date.now();
  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: ac.signal,
      headers: { "User-Agent": "SiteAudit/1.0 (+https://siteaudit-arc.vercel.app)", "Accept-Encoding": "gzip, deflate, br" },
    });
    const elapsedMs = Date.now() - started;
    const headers = {};
    res.headers.forEach((v, k) => { headers[k.toLowerCase()] = v; });
    const buf = await res.arrayBuffer();
    const bytes = buf.byteLength;
    const html = new TextDecoder("utf-8", { fatal: false }).decode(buf.slice(0, 600000));
    const finalHttps = /^https:\/\//i.test(res.url || url);
    return { ok: true, url, finalUrl: res.url || url, status: res.status, elapsedMs, headers, html, bytes, isHttps: finalHttps };
  } catch (e) {
    return { ok: false, url, status: 0, elapsedMs: Date.now() - started, headers: {}, html: "", bytes: 0, isHttps, error: String(e?.name || e) };
  }
}

// ── three deterministic category scorers ────────────────────────────────────
function scoreSeo(html) {
  const f = [];
  let s = 100;
  const titleM = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!titleM) { s -= 25; f.push(["seo", "hi", "title-missing"]); }
  else { const t = titleM[1].trim(); if (t.length < 10 || t.length > 60) { s -= 8; f.push(["seo", "lo", "title-len"]); } }

  const descM = html.match(/<meta[^>]+name=["']description["'][^>]*>/i);
  if (!descM) { s -= 18; f.push(["seo", "md", "desc-missing"]); }
  else { const c = (descM[0].match(/content=["']([\s\S]*?)["']/i) || [, ""])[1].trim(); if (c.length < 50 || c.length > 160) { s -= 6; f.push(["seo", "lo", "desc-len"]); } }

  const h1count = (html.match(/<h1[\s>]/gi) || []).length;
  if (h1count === 0) { s -= 12; f.push(["seo", "md", "h1-missing"]); }
  else if (h1count > 1) { s -= 6; f.push(["seo", "lo", "h1-multi"]); }

  if (!/<meta[^>]+name=["']viewport["']/i.test(html)) { s -= 12; f.push(["seo", "md", "viewport"]); }
  if (!/<link[^>]+rel=["']canonical["']/i.test(html)) { s -= 6; f.push(["seo", "lo", "canonical"]); }
  if (!/<html[^>]+lang=/i.test(html)) { s -= 6; f.push(["seo", "lo", "lang"]); }
  if (!/property=["']og:title["']/i.test(html) || !/property=["']og:image["']/i.test(html)) { s -= 8; f.push(["seo", "lo", "og"]); }
  if (!/name=["']twitter:card["']/i.test(html)) { s -= 5; f.push(["seo", "lo", "twitter"]); }

  return { score: clamp(s), findings: f };
}

function scoreSpeed(r) {
  const f = [];
  let s = 100;
  if (!r.ok) { return { score: 0, findings: [["spd", "hi", "unreachable"]] }; }
  if (r.status < 200 || r.status >= 300) { s -= 40; f.push(["spd", "hi", "status"]); }

  const ms = r.elapsedMs;
  if (ms > 2500) { s -= 45; f.push(["spd", "hi", "slow"]); }
  else if (ms > 1500) { s -= 30; f.push(["spd", "md", "slow"]); }
  else if (ms > 800) { s -= 16; f.push(["spd", "lo", "slow"]); }

  if (!get(r.headers, "content-encoding")) { s -= 12; f.push(["spd", "md", "no-compression"]); }
  if (r.bytes > 3_000_000) { s -= 20; f.push(["spd", "lo", "large-html"]); }
  else if (r.bytes > 1_000_000) { s -= 10; f.push(["spd", "lo", "large-html"]); }

  const cache = get(r.headers, "cache-control") || get(r.headers, "cdn-cache-control") || get(r.headers, "cf-cache-status") || get(r.headers, "x-vercel-cache") || get(r.headers, "age");
  if (!cache) { s -= 6; f.push(["spd", "lo", "no-cache"]); }

  return { score: clamp(s), findings: f };
}

function scoreSecurity(r) {
  const f = [];
  let s = 100;
  if (!r.isHttps) { s -= 35; f.push(["sec", "hi", "no-https"]); }
  if (!get(r.headers, "strict-transport-security")) { s -= 15; f.push(["sec", "md", "hsts"]); }
  const csp = get(r.headers, "content-security-policy");
  if (!csp) { s -= 20; f.push(["sec", "hi", "csp"]); }
  if (!get(r.headers, "x-frame-options") && !/frame-ancestors/i.test(csp)) { s -= 12; f.push(["sec", "md", "xfo"]); }
  if (!/nosniff/i.test(get(r.headers, "x-content-type-options"))) { s -= 8; f.push(["sec", "lo", "nosniff"]); }
  if (!get(r.headers, "referrer-policy")) { s -= 6; f.push(["sec", "lo", "referrer"]); }
  if (!get(r.headers, "permissions-policy")) { s -= 5; f.push(["sec", "lo", "permissions"]); }
  return { score: clamp(s), findings: f };
}

const SEV_RANK = { hi: 0, md: 1, lo: 2 };

// ── full audit: fetch + score + assemble the compact on-chain report ─────────
export async function auditUrl(rawUrl, opts = {}) {
  const r = await fetchSite(rawUrl, opts);
  const seo = scoreSeo(r.html);
  const spd = scoreSpeed(r);
  const sec = scoreSecurity(r);
  const sub = { seo: seo.score, spd: spd.score, sec: sec.score };
  const overall = clamp(WEIGHTS.seo * sub.seo + WEIGHTS.spd * sub.spd + WEIGHTS.sec * sub.sec);

  // merge + order findings by severity, cap to keep the on-chain payload < 1024 chars
  let findings = [...seo.findings, ...spd.findings, ...sec.findings]
    .sort((a, b) => SEV_RANK[a[1]] - SEV_RANK[b[1]]);
  if (findings.length > 16) findings = findings.slice(0, 16);

  // host label for the receipt (no scheme)
  let host = "";
  try { host = new URL(/^https?:\/\//i.test(rawUrl) ? rawUrl : "https://" + rawUrl).host; } catch { host = String(rawUrl).slice(0, 80); }

  // compact, versioned, deterministic — THIS is what goes on-chain inline + gets hashed
  const compact = { v: 1, u: host, sc: overall, s: sub, st: r.status, ms: r.elapsedMs, t: Math.floor((opts.now ?? Date.now()) / 1000), f: findings };
  const compactJson = JSON.stringify(compact);

  return { overall, sub, status: r.status, elapsedMs: r.elapsedMs, ok: r.ok, host, findings, compact, compactJson };
}

// ── expand a compact report (from chain) into human-readable findings ────────
export function expandReport(compact) {
  const findings = (compact?.f || []).map(([cat, sev, code]) => ({
    cat, sev, code,
    label: CATALOG[code]?.label || code,
    why: CATALOG[code]?.why || "",
    category: CATEGORY_LABEL[CATALOG[code]?.cat || cat] || cat,
  }));
  return { ...compact, findings };
}

// state band for a 0..100 score
export function band(score) { return score >= 80 ? "pass" : score >= 50 ? "warn" : "fail"; }
