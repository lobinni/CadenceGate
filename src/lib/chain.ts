/**
 * Transport layer between the interface and the deployed contract.
 *
 * Reads and writes go through genlayer-js, which owns the GenVM calldata
 * encoding for this network. The contract address and the network identity
 * always resolve through the deployment registry, so a new release never
 * requires touching this file.
 */

import { chains, createClient } from "genlayer-js";
import { deployment, type ContractKey } from "@/config/contracts";
import { contractReason, messageFor } from "@/lib/reasons";
import { readStatusValue, isWaiting, type ReceiptStage, type StatusView } from "../../sdk/status";

export interface Eip1193Provider {
  request(args: { method: string; params?: unknown[] | object }): Promise<unknown>;
  on?(event: string, handler: (...args: unknown[]) => void): void;
  removeListener?(event: string, handler: (...args: unknown[]) => void): void;
  isMetaMask?: boolean;
}

declare global {
  interface Window {
    ethereum?: Eip1193Provider;
  }
}

const ZERO = "0x0000000000000000000000000000000000000000";

/* ------------------------------------------------------------------ *
 * Chain identity                                                      *
 * ------------------------------------------------------------------ */

/** Rebuilds the SDK chain preset from the registry so it can be swapped. */
function activeChain() {
  const network = deployment.network();
  return {
    ...chains.studionet,
    id: network.chainId,
    name: network.chainName,
    rpcUrls: { ...chains.studionet.rpcUrls, default: { http: [network.rpcUrl] } },
  };
}

function chainIdHex(): string {
  return `0x${deployment.network().chainId.toString(16)}`;
}

export function hasInjectedWallet(): boolean {
  return typeof window !== "undefined" && Boolean(window.ethereum);
}

/**
 * Makes sure the wallet is on the network the registry names. It fails closed:
 * if the wallet still reports another chain after the switch, the caller is
 * refused rather than allowed to sign against the wrong network.
 */
export async function ensureChain(): Promise<void> {
  const provider = window.ethereum;
  if (!provider) throw new Error("NO_WALLET");

  const wanted = chainIdHex();
  const read = async () => {
    try {
      return String(await provider.request({ method: "eth_chainId" })).toLowerCase();
    } catch {
      return "";
    }
  };

  if ((await read()) === wanted) return;

  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: wanted }] });
  } catch (cause) {
    const code = (cause as { code?: number }).code;
    const message = cause instanceof Error ? cause.message : "";
    const missing = code === 4902 || code === -32603 || /not added|unrecognized|unknown chain/i.test(message);
    if (!missing) {
      if (/reject|denied/i.test(message)) throw new Error("CHAIN_REJECTED");
      throw new Error("CHAIN_SWITCH_FAILED");
    }

    const network = deployment.network();
    try {
      await provider.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: wanted,
            chainName: network.chainName,
            rpcUrls: [network.rpcUrl],
            nativeCurrency: network.currency,
            blockExplorerUrls: [network.explorerUrl],
          },
        ],
      });
      await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: wanted }] });
    } catch {
      throw new Error("CHAIN_SWITCH_FAILED");
    }
  }

  if ((await read()) !== wanted) throw new Error("WRONG_CHAIN");
}

/* ------------------------------------------------------------------ *
 * Clients                                                             *
 * ------------------------------------------------------------------ */

type Client = ReturnType<typeof createClient>;

function readClient(): Client {
  return createClient({ chain: activeChain() });
}

function writeClient(account: string): Client {
  return createClient({ chain: activeChain(), account: account as `0x${string}`, provider: window.ethereum as never });
}

function contractAddress(key: ContractKey = "cadenceGate"): `0x${string}` {
  const address = deployment.address(key);
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) throw new Error("NO_CONTRACT");
  return address as `0x${string}`;
}

/** GenVM returns the contract's own JSON envelope, sometimes double encoded. */
function unwrap(value: unknown): unknown {
  let current = value;
  for (let i = 0; i < 3 && typeof current === "string"; i += 1) {
    try {
      current = JSON.parse(current);
    } catch {
      break;
    }
  }
  return current;
}

/* ------------------------------------------------------------------ *
 * Reads                                                               *
 * ------------------------------------------------------------------ */

export type CallOutcome = { value: unknown; raw: string };

export async function readView(
  method: string,
  args: unknown[] = [],
  contractKey: ContractKey = "cadenceGate",
): Promise<CallOutcome> {
  const address = contractAddress(contractKey);
  const value = await readClient().readContract({
    address,
    functionName: method,
    args: args as never[],
  });
  const decoded = unwrap(value);
  return { value: decoded, raw: typeof decoded === "string" ? decoded : JSON.stringify(decoded ?? null) };
}

export async function readPlan(planId: string, contractKey: ContractKey = "cadenceGate"): Promise<unknown> {
  const outcome = await readView("get_plan", [planId], contractKey);
  if (!outcome.value || typeof outcome.value !== "object") throw new Error("NOT_FOUND");
  return outcome.value;
}

export async function readOwnedPlans(owner: string, contractKey: ContractKey = "cadenceGate"): Promise<string[]> {
  const outcome = await readView("list_plans", [owner], contractKey);
  return Array.isArray(outcome.value) ? (outcome.value as string[]) : [];
}

export async function readProtocol(contractKey: ContractKey = "cadenceGate"): Promise<Record<string, unknown>> {
  const outcome = await readView("protocol", [], contractKey);
  return outcome.value && typeof outcome.value === "object"
    ? (outcome.value as Record<string, unknown>)
    : {};
}

export async function readPlanState(
  planId: string,
  contractKey: ContractKey = "cadenceGate",
): Promise<Record<string, unknown>> {
  const outcome = await readView("plan_state", [planId], contractKey);
  return outcome.value && typeof outcome.value === "object"
    ? (outcome.value as Record<string, unknown>)
    : {};
}

/* ------------------------------------------------------------------ *
 * Wallet                                                              *
 * ------------------------------------------------------------------ */

export interface Session {
  account: string;
  chainId: string;
}

export async function connectWallet(): Promise<Session> {
  if (!hasInjectedWallet()) throw new Error("NO_WALLET");
  const provider = window.ethereum as Eip1193Provider;
  const accounts = (await provider.request({ method: "eth_requestAccounts" })) as string[];
  if (!Array.isArray(accounts) || accounts.length === 0) throw new Error("NO_ACCOUNT");
  await ensureChain();
  const chainId = String(await provider.request({ method: "eth_chainId" }));
  return { account: accounts[0].toLowerCase(), chainId };
}

export async function activeAccount(): Promise<string> {
  if (!hasInjectedWallet()) throw new Error("NO_WALLET");
  const provider = window.ethereum as Eip1193Provider;
  const accounts = (await provider.request({ method: "eth_accounts" })) as string[];
  if (!Array.isArray(accounts) || accounts.length === 0) throw new Error("NO_ACCOUNT");
  return accounts[0].toLowerCase();
}

export async function currentChainId(): Promise<string | null> {
  if (!hasInjectedWallet()) return null;
  try {
    return String(await (window.ethereum as Eip1193Provider).request({ method: "eth_chainId" })).toLowerCase();
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ *
 * Writes                                                              *
 * ------------------------------------------------------------------ */

export interface WriteRequest {
  method: string;
  args: unknown[];
  contractKey?: ContractKey;
}

export async function sendWrite({ method, args, contractKey = "cadenceGate" }: WriteRequest): Promise<string> {
  const address = contractAddress(contractKey);
  const account = await activeAccount();
  await ensureChain();

  const client = writeClient(account);
  // The client already carries the signing account, so the estimate and the
  // write share one sender.
  const call = { address, functionName: method, args: args as never[], value: 0n };

  // Studionet charges fees on every write, so a distribution is mandatory.
  // The accurate estimate dry-runs the exact call, which works for deterministic
  // methods but not for the ones that run a model call under consensus: those
  // cannot be simulated and the node answers with an internal error. In that
  // case quote the fee without executing. A genuine contract refusal is never
  // swallowed, because it still carries its own exception code.
  let estimate: Awaited<ReturnType<typeof client.estimateTransactionFeesForWrite>>;
  try {
    estimate = await client.estimateTransactionFeesForWrite(call);
  } catch (cause) {
    if (contractReason(cause)) throw cause;
    estimate = await client.estimateTransactionFees();
  }

  const hash = await client.writeContract({
    ...call,
    fees: {
      distribution: estimate.distribution,
      feeValue: estimate.feeValue,
      ...(estimate.messageAllocations ? { messageAllocations: estimate.messageAllocations } : {}),
    },
  });

  const text = String(hash ?? "");
  if (!/^0x[0-9a-f]{16,}$/i.test(text)) throw new Error("SUBMISSION_REJECTED");
  return text;
}

/* ------------------------------------------------------------------ *
 * Receipt polling                                                     *
 * ------------------------------------------------------------------ */

export { isWaiting };
export type { ReceiptStage };

export interface ReceiptSnapshot extends StatusView {
  hash: string;
}

async function readViaEndpoint(hash: string): Promise<Record<string, unknown> | null> {
  const network = deployment.network();
  for (const method of ["gen_getTransactionStatus", "eth_getTransactionByHash"]) {
    try {
      const response = await fetch(network.rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: [hash] }),
      });
      if (!response.ok) continue;
      const payload = (await response.json()) as { result?: Record<string, unknown> };
      if (payload.result) return payload.result;
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * Asks the wallet first, because that path already talks to the right network,
 * then falls back to the endpoint directly so polling keeps working even when a
 * wallet does not proxy the network status methods.
 *
 * `gen_getTransactionStatus` answers with a bare string such as "FINALIZED",
 * while `eth_getTransactionByHash` answers with a full object. Both are fed
 * through the shared normalizer.
 */
async function readStatus(hash: string): Promise<ReceiptSnapshot> {
  const provider = hasInjectedWallet() ? (window.ethereum as Eip1193Provider) : null;

  if (provider) {
    for (const method of ["gen_getTransactionStatus", "eth_getTransactionByHash"]) {
      try {
        const raw = (await provider.request({ method, params: [hash] })) as unknown;
        if (raw === null || raw === undefined) continue;
        const view = readStatusValue(raw);
        if (view) return { hash, ...view };
      } catch {
        continue;
      }
    }
  }

  const direct = await readViaEndpoint(hash);
  if (direct) {
    const view = readStatusValue(direct);
    if (view) return { hash, ...view };
  }

  return { hash, ...emptyView() };
}

function emptyView(): StatusView {
  return {
    stage: "QUEUED",
    label: "Waiting",
    detail: "The network has not reported a status yet.",
    statusCode: null,
    execution: null,
    agreement: null,
  };
}

/**
 * Follows a submission until the network decides it. The interval backs off so a
 * long finalization does not hammer the endpoint, and the elapsed time is always
 * reported so the wait never looks stuck.
 */
export async function awaitReceipt(
  hash: string,
  onTick?: (snapshot: ReceiptSnapshot, elapsedSeconds: number) => void,
  timeoutMs = 600000,
): Promise<ReceiptSnapshot & { elapsedSeconds: number; timedOut: boolean }> {
  const started = Date.now();
  let interval = 2000;
  let last: ReceiptSnapshot = { hash, ...emptyView() };

  for (;;) {
    const elapsedSeconds = Math.round((Date.now() - started) / 1000);
    try {
      last = await readStatus(hash);
    } catch {
      last = { hash, ...emptyView() };
    }
    onTick?.(last, elapsedSeconds);

    if (last.stage === "FINALIZED" || last.stage === "FAILED") {
      return { ...last, elapsedSeconds, timedOut: false };
    }

    if (Date.now() - started > timeoutMs) {
      return { ...last, elapsedSeconds, timedOut: true };
    }

    await new Promise((resolve) => setTimeout(resolve, interval));
    interval = Math.min(interval + 1000, 8000);
  }
}

/** Cheap one-shot read, used after a reload to resume a known submission. */
export async function pollReceipt(hash: string): Promise<ReceiptSnapshot> {
  return readStatus(hash);
}

export function explorerUrlForHash(hash: string): string {
  const base = deployment.network().explorerUrl.replace(/\/$/, "");
  return `${base}/transactions/${hash}`;
}

/* ------------------------------------------------------------------ *
 * Errors                                                              *
 * ------------------------------------------------------------------ */

const KNOWN: Record<string, { title: string; detail: string }> = {
  NO_WALLET: {
    title: "Wallet unavailable",
    detail: "Attach a browser wallet and unlock an account before continuing.",
  },
  NO_ACCOUNT: {
    title: "No account selected",
    detail: "Choose an account inside your wallet, then connect again.",
  },
  NO_CONTRACT: {
    title: "Deployment not selected",
    detail: "Open the deployment panel and choose a live contract address.",
  },
  WRONG_CHAIN: {
    title: "Wrong network",
    detail: `Your wallet is still on another network. Switch to ${deployment.network().chainName} (chain ${deployment.network().chainId}) and try again.`,
  },
  CHAIN_REJECTED: {
    title: "Network switch declined",
    detail: "You declined the switch, so nothing was signed. Approve it in your wallet and retry.",
  },
  CHAIN_SWITCH_FAILED: {
    title: "Network switch failed",
    detail: `Add ${deployment.network().chainName} (chain ${deployment.network().chainId}) to your wallet manually, then retry.`,
  },
  SUBMISSION_REJECTED: {
    title: "Request refused",
    detail: "The wallet did not return a submission hash, so nothing was recorded.",
  },
};

export function describeError(error: unknown): { title: string; detail: string } {
  const text = error instanceof Error ? error.message : String(error);

  // The contract's own refusal always wins over the SDK's generic wording.
  const reason = contractReason(error);
  if (reason) return { title: "The contract refused this request", detail: messageFor(reason) };

  for (const [code, copy] of Object.entries(KNOWN)) {
    if (text.includes(code)) return copy;
  }
  if (/OWNER_MUST_BE_MEMBER|MEMBER_ONLY|STALE_REVISION|ALREADY_APPROVED|NOT_READY|NOT_SEALED|TERMINAL|ID_CONFLICT|OWNER_LIMIT|TAG\b/.test(text)) {
    return { title: "The contract refused this request", detail: messageFor(text.match(/[A-Z][A-Z0-9_]{3,}/)?.[0] ?? text) };
  }
  if (/internal error|internal error was received|-32603/i.test(text)) {
    return {
      title: "The network could not dry-run this call",
      detail:
        "This step runs a model call under consensus, which cannot be simulated ahead of time. The fee was quoted without executing it and the request was retried. Try once more, and follow the hash in the explorer if it stays stuck.",
    };
  }
  if (/user rejected|denied|4001/i.test(text)) {
    return { title: "Request declined", detail: "You declined the request in your wallet, so nothing was sent." };
  }
  if (/network|fetch|failed to fetch|timeout/i.test(text)) {
    return { title: "Network unreachable", detail: "The configured endpoint did not answer. Try again shortly." };
  }
  return { title: "Request refused", detail: text.slice(0, 300) };
}

export { ZERO };
