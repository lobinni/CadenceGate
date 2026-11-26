/**
 * Reads back what a submission actually called.
 *
 * The explorer only shows GenVM-compressed calldata, which carries no function
 * label, so the interface does two things: it states the call at submission
 * time, and it can recover the method from any transaction payload afterwards.
 */

/** Every entry point the deployed contract exposes, in declaration order. */
export const CONTRACT_METHODS = [
  "protocol",
  "get_plan",
  "list_plans",
  "plan_state",
  "seal",
  "assess",
  "approve",
  "cancel",
] as const;

export interface CallSummary {
  method: string;
  /** Short, human readable rendering of the arguments. */
  args: string;
  /** One line per argument, for the detailed view. */
  lines: string[];
}

function summarise(arg: unknown): string {
  if (typeof arg === "string") {
    if (/^0x[0-9a-fA-F]{40}$/.test(arg)) return arg;
    // Plan references and addresses stay whole: they are what you copy.
    if (arg.length <= 72) return arg;
    return `${arg.slice(0, 34)}…${arg.slice(-16)}`;
  }
  if (typeof arg === "number" || typeof arg === "bigint") return String(arg);
  if (arg === null || arg === undefined) return "—";
  return "…";
}

export function describeCall(method: string, args: unknown[] = []): CallSummary {
  const lines = args.map(summarise);
  return { method, args: lines.join("  ·  "), lines };
}

function toBytes(raw: string): Uint8Array | null {
  const value = raw.trim();
  if (/^0x[0-9a-fA-F]*$/.test(value) && value.length % 2 === 0) {
    const hex = value.slice(2);
    const out = new Uint8Array(hex.length / 2);
    for (let i = 0; i < out.length; i += 1) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    return out;
  }
  if (/^[A-Za-z0-9+/]+={0,2}$/.test(value) && value.length % 4 === 0) {
    try {
      const binary = atob(value);
      const out = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
      return out;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Recovers the entry point from a payload. GenVM stores the method name as a
 * raw ASCII span, so it is recoverable even though the surrounding framing is
 * compressed. A zero-argument call such as `protocol` has no `args` marker, so
 * that case falls back to matching the known entry points.
 */
export function methodFromCalldata(raw: string): string | null {
  const bytes = toBytes(raw);
  if (!bytes) return null;
  const text = Array.from(bytes, (byte) => String.fromCharCode(byte)).join("");

  const marker = text.indexOf("args");
  if (marker > 0) {
    let start = marker;
    while (start > 0) {
      const code = text.charCodeAt(start - 1);
      const printable = (code >= 97 && code <= 122) || (code >= 65 && code <= 90) || code === 95;
      if (!printable) break;
      start -= 1;
    }
    const candidate = text.slice(start, marker);
    if (candidate && (CONTRACT_METHODS as readonly string[]).includes(candidate)) return candidate;
  }

  for (const method of CONTRACT_METHODS) {
    if (text.includes(method)) return method;
  }
  return null;
}

/** True once the value looks like a transaction hash rather than an address. */
export function looksLikeHash(value: string): boolean {
  return /^0x[0-9a-fA-F]{64}$/.test(value.trim());
}

/**
 * Reads a transaction straight from the network and reports the entry point it
 * called, so a hash copied out of the explorer can be labelled here.
 */
export async function methodForTransaction(hash: string, rpcUrl: string): Promise<string | null> {
  const value = hash.trim();
  if (!looksLikeHash(value)) return null;

  for (const method of ["eth_getTransactionByHash", "gen_getTransactionByHash"]) {
    try {
      const response = await fetch(rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: [value] }),
      });
      if (!response.ok) continue;
      const payload = (await response.json()) as {
        result?: { data?: { calldata?: string } | string; calldata?: string; txData?: string } | null;
      };
      const result = payload.result;
      if (!result) continue;
      const calldata =
        (typeof result === "object" ? (result.data as { calldata?: string })?.calldata : undefined) ??
        (typeof result === "object" ? result.calldata : undefined) ??
        (typeof result === "object" ? result.txData : undefined);
      if (typeof calldata === "string" && calldata.length > 0) {
        const method = methodFromCalldata(calldata);
        if (method) return method;
      }
    } catch {
      continue;
    }
  }
  return null;
}
