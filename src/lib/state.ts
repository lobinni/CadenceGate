import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { deployment, type DeploymentState } from "@/config/contracts";
import { activeAccount, connectWallet, currentChainId, ensureChain, hasInjectedWallet } from "@/lib/chain";

/* ---------------- deployment registry ---------------- */

export function useDeployment(): DeploymentState {
  const subscribe = useCallback((onStoreChange: () => void) => deployment.subscribe(onStoreChange), []);
  return useSyncExternalStore(subscribe, () => deployment.get(), () => deployment.get());
}

/* ---------------- wallet session ---------------- */

export interface WalletSession {
  account: string | null;
  ready: boolean;
  available: boolean;
  /** Lowercase hex chain id the wallet currently reports, or null when absent. */
  chainId: string | null;
  onExpectedChain: boolean;
  connect: () => Promise<void>;
  switchChain: () => Promise<void>;
  refresh: () => Promise<void>;
  release: () => void;
  error: string | null;
}

export function useWallet(): WalletSession {
  const [account, setAccount] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [chainId, setChainId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const id = await currentChainId();
    setChainId(id);
    if (!hasInjectedWallet()) {
      setReady(true);
      return;
    }
    try {
      const current = await activeAccount();
      setAccount(current);
    } catch {
      setAccount(null);
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
    if (typeof window === "undefined") return;
    const onAccounts = (...args: unknown[]) => {
      const next = args[0] as string[] | undefined;
      setAccount(Array.isArray(next) && next.length > 0 ? next[0].toLowerCase() : null);
    };
    const onChain = (...args: unknown[]) => {
      const next = args[0];
      setChainId(typeof next === "string" ? next.toLowerCase() : null);
    };
    window.ethereum?.on?.("accountsChanged", onAccounts);
    window.ethereum?.on?.("chainChanged", onChain);
    return () => {
      window.ethereum?.removeListener?.("accountsChanged", onAccounts);
      window.ethereum?.removeListener?.("chainChanged", onChain);
    };
  }, [refresh]);

  const switchChain = useCallback(async () => {
    setError(null);
    try {
      await ensureChain();
      setChainId(await currentChainId());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "CHAIN_SWITCH_FAILED");
    }
  }, []);

  const connect = useCallback(async () => {
    setError(null);
    try {
      const { account: next } = await connectWallet();
      setAccount(next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Wallet connection failed.");
    }
  }, []);

  const release = useCallback(() => setAccount(null), []);

  const expected = deployment.network().chainId.toString(16).toLowerCase();
  const onExpectedChain = Boolean(chainId && chainId === `0x${expected}`);

  return useMemo(
    () => ({
      account,
      ready,
      available: hasInjectedWallet(),
      chainId,
      onExpectedChain,
      connect,
      switchChain,
      refresh,
      release,
      error,
    }),
    [account, ready, chainId, onExpectedChain, connect, switchChain, refresh, release, error],
  );
}

/* ---------------- transient notices ---------------- */

export interface Toast {
  id: number;
  tone: "good" | "warn" | "bad";
  title: string;
  detail: string;
}

let toastId = 0;

export function useToasts() {
  const [items, setItems] = useState<Toast[]>([]);

  const push = useCallback((tone: Toast["tone"], title: string, detail: string) => {
    toastId += 1;
    const entry = { id: toastId, tone, title, detail };
    setItems((prev) => [...prev.slice(-2), entry]);
    window.setTimeout(() => setItems((prev) => prev.filter((item) => item.id !== entry.id)), 6200);
  }, []);

  const dismiss = useCallback((id: number) => setItems((prev) => prev.filter((item) => item.id !== id)), []);

  return { items, push, dismiss };
}

/* ---------------- short address ---------------- */

export function shorten(value: string | null | undefined, head = 6, tail = 4): string {
  if (!value) return "—";
  if (value.length <= head + tail + 2) return value;
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}
