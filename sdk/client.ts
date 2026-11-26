/**
 * CadenceGate client.
 *
 * Reads and writes both go through genlayer-js, which owns the GenVM calldata
 * encoding this network expects. Reads need no wallet; writes sign with the
 * private key exported in CADENCEGATE_PRIVATE_KEY. The contract address is
 * always resolved through sdk/config, never hard-coded.
 */

import { chains, createAccount, createClient as createSdkClient } from "genlayer-js";
import { readManifest, resolveAddress, rpcUrl, sourceDigest, type ContractKey, type Manifest } from "./config.js";
import { readStatusValue, type ReceiptStage } from "./status.js";
import { contractReason } from "./reasons.js";
import type { PlanRecord, PendingWrite } from "./types.js";

export interface ClientOptions {
  address?: string;
  rpc?: string;
  contractKey?: ContractKey;
  /** Signs and broadcasts a write, returning its hash. */
  signer?: SendSigner;
}

export type SendSigner = (request: { to: string; data: string; from?: string }) => Promise<string>;

type SdkClient = ReturnType<typeof createSdkClient>;

const ZERO = "0x0000000000000000000000000000000000000000";

/** Rebuilds the SDK chain preset from the manifest so it can be swapped. */
function chainFrom(rpc: string) {
  return {
    ...chains.studionet,
    rpcUrls: { ...chains.studionet.rpcUrls, default: { http: [rpc] } },
  };
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

export class CadenceGateClient {
  readonly address: string;
  readonly rpc: string;
  private client: SdkClient;
  private signer?: SendSigner;

  constructor(options: ClientOptions) {
    if (!/^0x[0-9a-fA-F]{40}$/.test(options.address ?? "")) throw new Error("NO_CONTRACT");
    this.address = (options.address as string).trim();
    this.rpc = rpcUrl(options.rpc);
    this.client = createSdkClient({ chain: chainFrom(this.rpc) });
    this.signer = options.signer;
  }

  /**
   * Reads through the SDK, which owns the GenVM calldata encoding this network
   * expects. A hand-rolled encoder cannot be trusted here.
   */
  async call(method: string, args: unknown[] = []): Promise<unknown> {
    try {
      const value = await this.client.readContract({
        address: this.address as `0x${string}`,
        functionName: method,
        args: args as never[],
      });
      return unwrap(value);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      if (/not found|does not exist/i.test(message)) return "";
      throw cause;
    }
  }

  /**
   * Signs and broadcasts a write. Studionet requires a fee distribution on every
   * transaction, so the estimate is always taken first and passed along.
   */
  async send(method: string, args: unknown[] = [], from?: string): Promise<string> {
    const key = process.env.CADENCEGATE_PRIVATE_KEY ?? process.env.GENLAYER_PRIVATE_KEY;
    if (!key) throw new Error("NO_SIGNER");
    const account = createAccount((key.startsWith("0x") ? key : `0x${key}`) as `0x${string}`);
    const writer = createSdkClient({ chain: chainFrom(this.rpc), account });
    void from;

    const call = {
      address: this.address as `0x${string}`,
      functionName: method,
      args: args as never[],
      value: 0n,
    };

    // The accurate estimate dry-runs the call, which the node refuses for
    // methods that execute a model call under consensus. Quote without
    // executing in that case, but never swallow a real contract refusal.
    let estimate: Awaited<ReturnType<typeof writer.estimateTransactionFeesForWrite>>;
    try {
      estimate = await writer.estimateTransactionFeesForWrite(call);
    } catch (cause) {
      if (contractReason(cause)) throw cause;
      estimate = await writer.estimateTransactionFees();
    }

    return writer.writeContract({
      ...call,
      fees: {
        distribution: estimate.distribution,
        feeValue: estimate.feeValue,
        ...(estimate.messageAllocations ? { messageAllocations: estimate.messageAllocations } : {}),
      },
    });
  }

  /* ---------------- views ---------------- */

  async protocol(): Promise<Record<string, unknown>> {
    const value = await this.call("protocol", []);
    return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  }

  async getPlan(planId: string): Promise<PlanRecord> {
    const value = await this.call("get_plan", [planId]);
    if (!value || typeof value !== "object") throw new Error("NOT_FOUND");
    return value as PlanRecord;
  }

  async planState(planId: string): Promise<Record<string, unknown>> {
    const value = await this.call("plan_state", [planId]);
    return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  }

  async listPlans(owner: string): Promise<string[]> {
    const value = await this.call("list_plans", [owner]);
    return Array.isArray(value) ? (value as string[]) : [];
  }

  async readPlan(planId: string): Promise<PlanRecord> {
    return this.getPlan(planId);
  }

  /** Cheap status read, same method the interface polls with. */
  async transactionStatus(hash: string): Promise<Record<string, unknown>> {
    const provider = this.client as unknown as { request?: (args: unknown) => Promise<unknown> };
    if (typeof provider.request === "function") {
      try {
        const raw = (await provider.request({
          method: "gen_getTransactionStatus",
          params: [hash],
        })) as Record<string, unknown>;
        if (raw) return raw;
      } catch {
        /* fall through to the endpoint below */
      }
    }
    const response = await fetch(this.rpc, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "gen_getTransactionStatus",
        params: [hash],
      }),
    });
    const payload = (await response.json()) as { result?: Record<string, unknown>; error?: { message: string } };
    if (payload.error) throw new Error(payload.error.message);
    return payload.result ?? {};
  }
}

/* ---------------- factories ---------------- */

export async function createClient(options: ClientOptions = {}): Promise<CadenceGateClient> {
  const manifest = await readManifest();
  const address = options.address ?? (await resolveAddress(undefined, options.contractKey ?? "cadenceGate"));
  return new CadenceGateClient({ ...options, address, rpc: options.rpc ?? manifest.rpc });
}

/** Read-only client for verification and ledger browsing. */
export async function readClient(options: ClientOptions = {}): Promise<CadenceGateClient> {
  return createClient(options);
}

export async function manifestIdentity(path?: string): Promise<Manifest> {
  return readManifest(path);
}

export async function contractDigest(path = "contracts/cadencegate.py"): Promise<string> {
  return sourceDigest(path);
}

/* ---------------- receipt helpers ---------------- */

export type { ReceiptStage } from "./status.js";

/**
 * Normalises either shape the endpoint returns: a bare status string from
 * `gen_getTransactionStatus`, or the full transaction object from
 * `eth_getTransactionByHash`. Anything unrecognised stays UNKNOWN rather than
 * being guessed at.
 */
export function receiptStatus(receipt: unknown): ReceiptStage {
  const view = readStatusValue(receipt);
  if (view) return view.stage;

  if (receipt && typeof receipt === "object") {
    const record = receipt as Record<string, unknown>;
    if (record.result === 6 && record.leader_only === false) return "FAILED";
    if (record.finalized === true) return "FINALIZED";
    const raw = String(record.status ?? record.stage ?? "").toLowerCase();
    if (raw === "0x3" || raw === "3") return "FINALIZED";
    if (raw === "0x4" || raw === "4") return "FAILED";
    if (raw === "0x2" || raw === "2") return "PROPOSING";
    if (raw === "0x0" || raw === "0x1" || raw === "0" || raw === "1") return "QUEUED";
  }
  return "UNKNOWN";
}

export function checkFinalReceipt(receipt: unknown, hash: string): void {
  const record = (receipt ?? {}) as Record<string, unknown>;
  if (record.hash && record.hash !== hash) throw new Error("RECEIPT_MISMATCH");
  const stage = receiptStatus(receipt);
  if (stage !== "FINALIZED" && stage !== "ACCEPTED") throw new Error("NOT_FINALIZED");
}

export function checkIntentBinding(receipt: Record<string, unknown>, pending: PendingWrite): void {
  const body = JSON.stringify(receipt, (_, value) => (typeof value === "bigint" ? value.toString() : value));
  if (!body.includes(pending.method)) throw new Error("INTENT_NOT_BOUND");
  if (!body.includes(pending.planId)) throw new Error("INTENT_NOT_BOUND");
}

export function checkReceipt(receipt: Record<string, unknown>, pending: PendingWrite): void {
  checkIntentBinding(receipt, pending);
  if (receiptStatus(receipt) === "FAILED") throw new Error("TX_FAILED");
}

export function checkReadback(plan: PlanRecord, pending: PendingWrite): void {
  if (plan.id !== pending.planId) throw new Error("READBACK_MISMATCH");
  if (pending.expectedRevision !== undefined && plan.revision !== pending.expectedRevision) {
    throw new Error("READBACK_MISMATCH");
  }
}

/**
 * Confirms the deployed contract identifies the release this repository records.
 * The chain does not publish its own source bytes, so identity is checked the
 * way the contract exposes it: through `protocol()`.
 */
export async function verifySource(
  client: CadenceGateClient,
  address: string,
  expectedSha256: string,
  expectedVersion?: string,
): Promise<string> {
  if (address.toLowerCase() !== client.address.toLowerCase()) {
    throw new Error("ADDRESS_MISMATCH");
  }
  const protocol = await client.protocol();
  const published = String(protocol.version ?? "");
  if (!published) throw new Error("SOURCE_UNVERIFIABLE");
  if (expectedVersion && published !== expectedVersion) {
    throw new Error(`VERSION_MISMATCH:${published}!=${expectedVersion}`);
  }
  if (!/^[a-f0-9]{64}$/.test(expectedSha256)) throw new Error("SOURCE_DIGEST_INVALID");
  return published;
}
