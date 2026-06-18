/*
 * Wallet discovery via EIP-6963.
 *
 * Browser extensions announce themselves on an event bus; we collect the
 * announcements into a registry and let callers pick one (by rdns, by a
 * remembered preference, or by the configured fallback order).
 */

export interface Eip1193Provider {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (event: string, handler: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, handler: (...args: unknown[]) => void) => void;
  isRabby?: boolean;
  isMetaMask?: boolean;
}

interface ProviderDetail {
  info: { uuid: string; name: string; icon: string; rdns: string };
  provider: Eip1193Provider;
}

// Wallets we reach for first when the user has no saved choice.
const FALLBACK_ORDER = ["io.rabby", "io.metamask"];

// localStorage slot that remembers which wallet the user last connected with.
// Derived from a versioned audit-app namespace rather than a bare prefix.
const STORAGE_SCOPE = "sa-audit/v1";
const SAVED_WALLET_SLOT = `${STORAGE_SCOPE}::chosen-rdns`;

// Live registry of everything that has announced itself so far.
const registry: ProviderDetail[] = [];

function upsert(detail?: ProviderDetail) {
  if (!detail?.info?.rdns || !detail.provider) return;
  const at = registry.findIndex((d) => d.info.rdns === detail.info.rdns);
  if (at === -1) registry.push(detail);
  else registry[at] = detail;
}

// Kick off discovery as soon as the module loads in a browser context.
if (typeof window !== "undefined") {
  window.addEventListener("eip6963:announceProvider", (e: Event) => {
    upsert((e as CustomEvent<ProviderDetail>).detail);
  });
  window.dispatchEvent(new Event("eip6963:requestProvider"));
}

// --- persisted preference -------------------------------------------------

export function setChosenRdns(rdns: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SAVED_WALLET_SLOT, rdns);
  } catch {
    /* ignore */
  }
}

export function getChosenRdns(): string {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(SAVED_WALLET_SLOT) || "";
  } catch {
    return "";
  }
}

// --- re-announce helpers --------------------------------------------------

export function refreshWallets() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event("eip6963:requestProvider"));
}

export function ensureDiscovered(timeoutMs = 250): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (registry.length) {
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      window.removeEventListener("eip6963:announceProvider", onAnnounce);
      resolve();
    };
    const onAnnounce = () => finish();
    window.addEventListener("eip6963:announceProvider", onAnnounce);
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    setTimeout(finish, timeoutMs);
  });
}

export function listWallets() {
  refreshWallets();
  return registry.map((d) => ({ name: d.info.name, rdns: d.info.rdns, icon: d.info.icon }));
}

// --- selection ------------------------------------------------------------

export function pickDetail(rdns?: string): { provider: Eip1193Provider; rdns: string } | undefined {
  refreshWallets();
  const wanted = rdns ?? getChosenRdns();
  if (wanted) {
    const hit = registry.find((d) => d.info.rdns === wanted);
    if (hit) return { provider: hit.provider, rdns: hit.info.rdns };
  }
  for (const candidate of FALLBACK_ORDER) {
    const hit = registry.find((d) => d.info.rdns === candidate);
    if (hit) return { provider: hit.provider, rdns: hit.info.rdns };
  }
  const first = registry[0];
  if (first) return { provider: first.provider, rdns: first.info.rdns };
  return undefined;
}

export function pickProvider(rdns?: string): Eip1193Provider | undefined {
  const d = pickDetail(rdns);
  if (d) return d.provider;
  return typeof window !== "undefined" ? (window.ethereum as Eip1193Provider | undefined) : undefined;
}
