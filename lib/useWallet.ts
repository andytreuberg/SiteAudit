"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ethers } from "ethers";
import { ensureDiscovered, pickDetail, pickProvider, setChosenRdns, type Eip1193Provider } from "./wallet";
import { ARC_CHAIN_HEX, ARC_RPC, switchToArc } from "./arcNetwork";

// A flag we drop in localStorage so a deliberate disconnect survives reloads —
// otherwise an eager eth_accounts call would silently re-attach the wallet.
const OFFLINE_FLAG = "sa-audit/v1::session-detached";

// Normalise an arbitrary chainId value down to "is this Arc?".
const isArcChain = (raw: unknown) => (raw as string).toLowerCase() === ARC_CHAIN_HEX.toLowerCase();

export function useWallet() {
  const [account, setAccount] = useState("");
  const [balance, setBalance] = useState("");
  const [chainOk, setChainOk] = useState(false);
  const [connecting, setConnecting] = useState(false);

  const detachedRef = useRef(false);
  const subRef = useRef<{ provider: Eip1193Provider; cleanup: () => void } | null>(null);

  const refreshBalance = useCallback(async (addr: string) => {
    try {
      const rpc = new ethers.JsonRpcProvider(ARC_RPC);
      const wei = await rpc.getBalance(addr);
      setBalance(parseFloat(ethers.formatEther(wei)).toFixed(3));
    } catch {
      setBalance("—");
    }
  }, []);

  // Wire up accountsChanged / chainChanged on the injected provider, making
  // sure we never double-subscribe and always tear the previous one down.
  const subscribe = useCallback(
    (inj: Eip1193Provider) => {
      if (!inj?.on) return;
      if (subRef.current?.provider === inj) return;
      subRef.current?.cleanup();

      const handleAccounts = (payload: unknown) => {
        if (detachedRef.current) return;
        const accs = payload as string[];
        if (accs.length) {
          setAccount(accs[0]);
          refreshBalance(accs[0]);
        } else {
          setAccount("");
          setBalance("");
          setChainOk(false);
        }
      };
      const handleChain = (payload: unknown) => setChainOk(isArcChain(payload));

      inj.on("accountsChanged", handleAccounts);
      inj.on("chainChanged", handleChain);
      subRef.current = {
        provider: inj,
        cleanup: () => {
          inj.removeListener?.("accountsChanged", handleAccounts);
          inj.removeListener?.("chainChanged", handleChain);
        },
      };
    },
    [refreshBalance]
  );

  const connect = useCallback(async () => {
    detachedRef.current = false;
    if (typeof window !== "undefined") {
      try {
        window.localStorage.removeItem(OFFLINE_FLAG);
      } catch {
        /* ignore */
      }
    }
    await ensureDiscovered();
    const detail = pickDetail();
    const inj = detail?.provider;
    if (!inj) return;
    setChosenRdns(detail.rdns);
    setConnecting(true);
    try {
      const accs = (await inj.request({ method: "eth_requestAccounts" })) as string[];
      if (!accs?.length) return;
      setAccount(accs[0]);
      subscribe(inj);
      try {
        await switchToArc(inj);
      } catch {
        /* user declined the network switch */
      }
      try {
        const id = (await inj.request({ method: "eth_chainId" })) as string;
        setChainOk(isArcChain(id));
      } catch {
        setChainOk(false);
      }
      refreshBalance(accs[0]);
    } catch {
      /* user rejected */
    } finally {
      setConnecting(false);
    }
  }, [refreshBalance, subscribe]);

  const disconnect = useCallback(() => {
    detachedRef.current = true;
    if (typeof window !== "undefined") {
      try {
        window.localStorage.setItem(OFFLINE_FLAG, "1");
      } catch {
        /* ignore */
      }
    }
    setAccount("");
    setBalance("");
    setChainOk(false);
  }, []);

  // On mount: honour a prior disconnect, otherwise quietly re-attach if the
  // wallet still has us authorised.
  useEffect(() => {
    if (typeof window !== "undefined" && window.localStorage.getItem(OFFLINE_FLAG) === "1") {
      detachedRef.current = true;
    }
    (async () => {
      await ensureDiscovered();
      const inj = pickProvider();
      if (!inj) return;
      if (!detachedRef.current) {
        try {
          const accs = (await inj.request({ method: "eth_accounts" })) as string[];
          if (accs.length) {
            setAccount(accs[0]);
            refreshBalance(accs[0]);
            inj
              .request({ method: "eth_chainId" })
              .then((id) => setChainOk(isArcChain(id)))
              .catch(() => {});
          }
        } catch {
          /* ignore */
        }
      }
      subscribe(inj);
    })();
    return () => {
      subRef.current?.cleanup();
      subRef.current = null;
    };
  }, [refreshBalance, subscribe]);

  return { account, balance, chainOk, connecting, connect, disconnect, refreshBalance };
}
