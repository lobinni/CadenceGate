/**
 * Deployment identity resolution for the TypeScript side of the project.
 *
 * The single rule of this repository is that no file hard-codes a contract
 * address. Everything resolves here, in this order:
 *
 *   1. an explicit argument passed to a helper or script,
 *   2. the CADENCEGATE_ADDRESS environment variable,
 *   3. the CONTRACT_ADDRESS environment variable,
 *   4. deployment.json,
 *   5. an empty string, meaning "not deployed yet".
 */

import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

export type ContractKey = "cadenceGate";

export interface Manifest {
  release: string;
  status: string;
  chainId: number;
  rpc: string;
  sdk: string;
  contractSource: string;
  sourceDocument: string;
  sourceSha256?: string;
  address?: string;
  deployTransaction?: string;
  contracts?: Record<string, { address?: string; deployTransaction?: string; sourceSha256?: string }>;
  addresses?: Record<string, string>;
  fills?: Record<string, string>;
}

export const MANIFEST_PATH = "deployment.json";
export const ADDRESS_ENV_KEYS = ["CADENCEGATE_ADDRESS", "CONTRACT_ADDRESS"] as const;

function fromEnv(): string {
  for (const key of ADDRESS_ENV_KEYS) {
    const value = process.env[key];
    if (value && value.trim().length > 0) return value.trim();
  }
  return "";
}

export async function readManifest(path: string = MANIFEST_PATH): Promise<Manifest> {
  return JSON.parse(await readFile(path, "utf8")) as Manifest;
}

/** Read the address recorded in the manifest for one contract key. */
export async function manifestAddress(key: ContractKey = "cadenceGate", path = MANIFEST_PATH): Promise<string> {
  const manifest = await readManifest(path);
  const fromMap = manifest.contracts?.[key]?.address ?? manifest.addresses?.[key] ?? "";
  return (fromMap || manifest.address || "").trim();
}

/**
 * Resolve the address a script should talk to. `explicit` always wins, which is
 * what makes local testing against a second deployment trivial.
 */
export async function resolveAddress(explicit?: string, key: ContractKey = "cadenceGate", path = MANIFEST_PATH) {
  // Casing is preserved on purpose: the GenLayer node resolves contracts
  // case-sensitively, so a rewritten address would silently miss.
  if (explicit !== undefined && explicit.trim().length > 0) {
    const candidate = explicit.trim();
    if (!isAddress(candidate)) throw new Error(`"${explicit}" is not a valid contract address.`);
    return candidate;
  }

  const environment = fromEnv().trim();
  if (environment) {
    if (!isAddress(environment)) throw new Error("The address in the environment is not valid.");
    return environment;
  }

  let recorded = "";
  try {
    recorded = await manifestAddress(key, path);
  } catch {
    recorded = "";
  }

  const candidate = recorded.trim();
  if (!isAddress(candidate)) {
    throw new Error(
      "No contract address resolved. Pass it explicitly, export CADENCEGATE_ADDRESS, or fill deployment.json.",
    );
  }
  return candidate;
}

export function isAddress(value: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(value.trim()) && BigInt(value.trim()) !== 0n;
}

export async function sourceDigest(path: string): Promise<string> {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

export const RPC_DEFAULT = "https://studio.genlayer.com/api";

export function rpcUrl(explicit?: string): string {
  return (explicit ?? process.env.RPC_URL ?? RPC_DEFAULT).trim();
}

export const SDK_PACKAGE = "genlayer-js";
