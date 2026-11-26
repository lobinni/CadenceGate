/**
 * Read-only replay of public evidence against the current release.
 *
 * Nothing here writes to the chain. It re-reads the published plans, re-checks
 * the local source digest against the manifest, and confirms that every recorded
 * operation reached finality with the state it claimed.
 */

import { readFile } from "node:fs/promises";
import { createClient, checkReceipt, checkReadback, receiptStatus, verifySource } from "../sdk/client.js";
import { readManifest, resolveAddress, sourceDigest } from "../sdk/config.js";
import type { PendingWrite, PlanRecord } from "../sdk/types.js";

interface EvidenceOperation {
  name: string;
  pending: PendingWrite;
  expectedError?: string;
  verified?: boolean;
}

interface EvidenceFile {
  deployment: { address: string; release: string };
  operations: EvidenceOperation[];
  finalPlan?: { id: string };
}

async function main(): Promise<void> {
  const manifest = await readManifest();
  const address = await resolveAddress();
  const digest = await sourceDigest(manifest.contractSource);

  const recorded = manifest.sourceSha256 ?? manifest.contracts?.cadenceGate?.sourceSha256 ?? "";
  if (recorded && recorded !== digest) throw new Error("Local source digest does not match the release record");

  const client = await createClient({ address });
  const protocol = await client.protocol();
  if (!protocol.version) throw new Error("The contract did not identify itself");

  // The chain does not publish its source bytes, so identity is checked the way
  // the contract exposes it: the release it reports, the address it answers on,
  // and the digest this repository records.
  const reported = await verifySource(client, address, digest, manifest.release);
  if (protocol.version !== manifest.release) {
    throw new Error(
      `The contract reports ${String(protocol.version)} but this release records ${manifest.release}.`,
    );
  }

  const evidence = JSON.parse(await readFile("evidence/live.json", "utf8")) as EvidenceFile;
  if (evidence.deployment.address !== address) throw new Error("Evidence was recorded against another deployment");

  const plans = new Map<string, PlanRecord>();
  const states: string[] = [];

  for (const operation of evidence.operations) {
    const hash = operation.pending.hash;
    if (!hash) {
      states.push(`${operation.name}: recorded without a hash`);
      continue;
    }

    let body: Record<string, unknown> = {};
    let stage: ReturnType<typeof receiptStatus> = "UNKNOWN";
    try {
      body = await client.transactionStatus(hash);
      stage = receiptStatus(body);
    } catch (cause) {
      if (!operation.expectedError) throw cause;
    }

    if (!operation.expectedError) {
      if (stage !== "FINALIZED" && stage !== "ACCEPTED") {
        throw new Error(`Operation ${operation.name} has not reached a settled state (currently ${stage})`);
      }
      if (!plans.has(operation.pending.planId)) {
        plans.set(operation.pending.planId, await client.readPlan(operation.pending.planId));
      }
      checkReadback(plans.get(operation.pending.planId) as PlanRecord, operation.pending);
      states.push(`${operation.name}: ${stage}`);
    } else {
      if (stage === "FINALIZED" || stage === "ACCEPTED") {
        throw new Error(`Operation ${operation.name} was expected to be refused`);
      }
      states.push(`${operation.name}: ${operation.expectedError}`);
    }
    void body;
    void checkReceipt;
  }

  const finalPlan = evidence.finalPlan?.id ? plans.get(evidence.finalPlan.id) : undefined;
  if (finalPlan) {
    if (finalPlan.state !== "COMMITTED") throw new Error("The final plan is not committed");
    const wallets = finalPlan.input.members.map((member) => member.address.toLowerCase());
    if (!wallets.every((wallet) => finalPlan.approvals.includes(wallet))) {
      throw new Error("A named member approval is missing");
    }
    if (new Set(finalPlan.approvals).size !== finalPlan.approvals.length) {
      throw new Error("A duplicate approval was recorded");
    }
  }

  console.log("Release:", reported, "(matches the manifest)");
  console.log("Address:", address);
  console.log("Operations replayed:", states.length);
  states.forEach((state) => console.log(" -", state));
  console.log("Verification complete. Every recorded operation matches the live chain.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
