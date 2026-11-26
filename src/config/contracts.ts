/**
 * Single source of truth for on-chain deployment identity.
 *
 * Every read and write in the application resolves the contract address through
 * this module, so moving to a new deployment only ever means changing one of:
 *   1. the environment variables below, or
 *   2. the value stored in local storage by the in-app deployment panel, or
 *   3. the defaults listed here.
 *
 * No component, hook or helper is allowed to hard-code an address.
 */

export type ContractKey = "cadenceGate";

export interface DeploymentTarget {
  /** Key used by the SDK and the browser client to look up a contract. */
  key: ContractKey;
  /** Human readable label shown in the interface. */
  label: string;
  /** Default address baked into the build, overridable by env or local storage. */
  defaultAddress: string;
  /** Currently resolved address. */
  address: string;
}

export interface NetworkTarget {
  chainId: number;
  chainName: string;
  rpcUrl: string;
  explorerUrl: string;
  currency: { name: string; symbol: string; decimals: number };
}

export interface ProtocolTarget {
  sdkPackage: string;
  contractSource: string;
  sourceDocumentUrl: string;
  deploymentManifest: string;
}

const STORAGE_KEY = "cadencegate.deployment.v1";

/**
 * The address baked into the published bundle for release cadencegate-2.
 * Override it with VITE_CADENCEGATE_ADDRESS at build time, or from the
 * deployment panel at runtime, without touching this file.
 */
export const RELEASE_CONTRACT_ADDRESS = "0xBCA8c56FD5D2f8dcABA997FDc601b0A4E5CF2E32";

/** Defaults for a fresh checkout. Replace with your own release identity. */
const DEFAULT_NETWORK: NetworkTarget = {
  chainId: Number(import.meta.env.VITE_CHAIN_ID ?? 61999),
  chainName: String(import.meta.env.VITE_CHAIN_NAME ?? "GenLayer Studio Testnet"),
  rpcUrl: String(import.meta.env.VITE_RPC_URL ?? "https://studio.genlayer.com/api"),
  explorerUrl: String(
    import.meta.env.VITE_EXPLORER_URL ?? "https://explorer-studio.genlayer.com",
  ),
  currency: { name: "Genesis", symbol: "GEN", decimals: 18 },
};

const DEFAULT_PROTOCOL: ProtocolTarget = {
  sdkPackage: String(import.meta.env.VITE_SDK_PACKAGE ?? "genlayer-js"),
  contractSource: String(import.meta.env.VITE_CONTRACT_SOURCE ?? "contracts/cadencegate.py"),
  sourceDocumentUrl: String(
    import.meta.env.VITE_SOURCE_DOCUMENT_URL ??
      "https://raw.githubusercontent.com/github/docs/main/content/graphql/overview/rate-limits-and-query-limits-for-the-graphql-api.md",
  ),
  deploymentManifest: "deployment.json",
};

const DEFAULT_ADDRESSES: Record<ContractKey, string> = {
  cadenceGate: String(import.meta.env.VITE_CADENCEGATE_ADDRESS ?? RELEASE_CONTRACT_ADDRESS),
};

export interface DeploymentOverrides {
  addresses?: Partial<Record<ContractKey, string>>;
  network?: Partial<NetworkTarget>;
  protocol?: Partial<ProtocolTarget>;
}

function readOverrides(): DeploymentOverrides {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as DeploymentOverrides) : {};
  } catch {
    return {};
  }
}

function writeOverrides(value: DeploymentOverrides): void {
  if (typeof window === "undefined") return;
  try {
    if (!value.addresses && !value.network && !value.protocol) {
      window.localStorage.removeItem(STORAGE_KEY);
    } else {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
    }
  } catch {
    /* storage unavailable - overrides stay in memory for this session */
  }
}

/**
 * Validates an address but keeps its published casing: the GenLayer node looks
 * contracts up case-sensitively, so rewriting it would make every call miss.
 * Case-insensitive comparisons happen where identities are matched, never here.
 */
function normalise(value: string): string {
  const trimmed = value.trim();
  return /^0x[0-9a-fA-F]{40}$/.test(trimmed) ? trimmed : trimmed;
}

let overrides: DeploymentOverrides = readOverrides();
const listeners = new Set<() => void>();

function currentAddress(key: ContractKey): string {
  const fromOverrides = overrides.addresses?.[key];
  const candidate = fromOverrides ?? DEFAULT_ADDRESSES[key];
  return normalise(candidate ?? "");
}

function snapshot(): DeploymentState {
  return {
    contracts: (Object.keys(DEFAULT_ADDRESSES) as ContractKey[]).map((key) => ({
      key,
      label: key === "cadenceGate" ? "CadenceGate core" : key,
      defaultAddress: normalise(DEFAULT_ADDRESSES[key] ?? ""),
      address: currentAddress(key),
    })),
    network: { ...DEFAULT_NETWORK, ...(overrides.network ?? {}) },
    protocol: { ...DEFAULT_PROTOCOL, ...(overrides.protocol ?? {}) },
  };
}

export interface DeploymentState {
  contracts: DeploymentTarget[];
  network: NetworkTarget;
  protocol: ProtocolTarget;
}

let state: DeploymentState = snapshot();

function commit(): void {
  state = snapshot();
  writeOverrides(overrides);
  listeners.forEach((fn) => fn());
}

export const deployment = {
  get(): DeploymentState {
    return state;
  },
  address(key: ContractKey = "cadenceGate"): string {
    return currentAddress(key);
  },
  network(): NetworkTarget {
    return state.network;
  },
  protocol(): ProtocolTarget {
    return state.protocol;
  },
  isConfigured(key: ContractKey = "cadenceGate"): boolean {
    return /^0x[0-9a-fA-F]{40}$/.test(currentAddress(key));
  },
  setContractAddress(key: ContractKey, value: string): void {
    overrides = { ...overrides, addresses: { ...(overrides.addresses ?? {}), [key]: value } };
    commit();
  },
  clearContractAddress(key: ContractKey): void {
    const next = { ...(overrides.addresses ?? {}) };
    delete next[key];
    overrides = { ...overrides, addresses: next };
    commit();
  },
  setNetwork(patch: Partial<NetworkTarget>): void {
    overrides = { ...overrides, network: { ...(overrides.network ?? {}), ...patch } };
    commit();
  },
  reset(): void {
    overrides = {};
    commit();
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

export const CONTRACT_STORAGE_KEY = STORAGE_KEY;


export function explorerUrlFor(address: string): string {
  const base = state.network.explorerUrl.replace(/\/$/, "");
  return /^0x[0-9a-fA-F]{40}$/.test(address) ? `${base}/address/${address}` : base;
}
