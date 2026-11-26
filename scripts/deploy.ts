/**
 * Publish contracts/cadencegate.py and record the release identity.
 *
 * The resulting address is written back into deployment.json so that every other
 * tool in this repository picks it up automatically. Exporting
 * CADENCEGATE_ADDRESS overrides that address everywhere without editing files.
 */

import { readFile, writeFile } from "node:fs/promises";
import { resolveAddress, readManifest, sourceDigest, MANIFEST_PATH, ADDRESS_ENV_KEYS } from "../sdk/config.js";

interface Deployed {
  address: string;
  transaction: string;
}

async function tryDeploy(): Promise<Deployed | null> {
  let sdk: Record<string, unknown> | null = null;
  try {
    sdk = (await import("genlayer-js")) as unknown as Record<string, unknown>;
  } catch {
    return null;
  }

  const setup = (sdk as { setupStudio?: () => unknown }).setupStudio;
  if (typeof setup !== "function") return null;
  const client = await (setup as () => Promise<Record<string, unknown>>)();
  const source = await readFile("contracts/cadencegate.py", "utf8");
  const deploy = (client as { deployContract?: (args: unknown) => Promise<unknown> }).deployContract;
  if (typeof deploy !== "function") return null;
  const result = (await deploy({ code: source })) as { data?: { contract_address?: string; tx_hash?: string } };
  const address = result?.data?.contract_address;
  const transaction = result?.data?.tx_hash ?? "";
  if (!address) throw new Error("DEPLOY_INCOMPLETE");
  return { address, transaction };
}

async function main(): Promise<void> {
  const manifest = await readManifest();
  const digest = await sourceDigest(manifest.contractSource);
  const attempted = await tryDeploy();

  const raw = JSON.parse(await readFile(MANIFEST_PATH, "utf8")) as Record<string, unknown>;
  const contracts = (raw.contracts ?? {}) as Record<string, Record<string, string>>;
  const addresses = (raw.addresses ?? {}) as Record<string, string>;

  if (attempted) {
    raw.status = "DEPLOYED";
    raw.address = attempted.address;
    raw.deployTransaction = attempted.transaction;
    raw.sourceSha256 = digest;
    raw.deployedAt = new Date().toISOString();
    contracts.cadenceGate = {
      label: "CadenceGate core",
      address: attempted.address,
      deployTransaction: attempted.transaction,
      sourceSha256: digest,
      deployedAt: raw.deployedAt as string,
      deployedBy: "scripts/deploy.ts",
    };
    addresses.cadenceGate = attempted.address;
  } else {
    const manual = await resolveAddress(process.env.CADENCEGATE_ADDRESS).catch(() => "");
    raw.sourceSha256 = digest;
    if (manual) {
      raw.status = "DEPLOYED";
      raw.address = manual;
      contracts.cadenceGate = { label: "CadenceGate core", address: manual, sourceSha256: digest };
      addresses.cadenceGate = manual;
    }
  }

  raw.contracts = contracts;
  raw.addresses = addresses;
  await writeFile(MANIFEST_PATH, JSON.stringify(raw, null, 2) + "\n");

  const resolved = await resolveAddress().catch(() => "");
  console.log("Source digest:", digest);
  if (resolved) {
    console.log("Release identity recorded in", MANIFEST_PATH);
    console.log("Contract address:", resolved);
  } else {
    console.log("No address resolved yet.");
    console.log("Either install the deployment SDK and rerun, or set one of:", ADDRESS_ENV_KEYS.join(", "));
    console.log("You can also paste the address into deployment.json or the in-app deployment panel.");
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
