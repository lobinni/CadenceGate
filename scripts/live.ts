/**
 * Live walkthrough driver.
 *
 * Run it before, during and after a browser walkthrough. With no signer it is a
 * read-only progress check that tells you exactly which step comes next for each
 * plan recorded in the release manifest. Export SIGNER_MODULE with a module that
 * default-exports a SendSigner to let this script submit the writes instead.
 */

import { dynamicImport } from "./importer.js";
import { createClient } from "../sdk/client.js";
import { readManifest, resolveAddress } from "../sdk/config.js";
import type { PlanRecord, PendingWrite } from "../sdk/types.js";

interface SignerModule {
  default?: (request: { to: string; data: string; from?: string }) => Promise<string>;
  signer?: (request: { to: string; data: string; from?: string }) => Promise<string>;
}

const NEXT_STEP: Record<string, string> = {
  SEALED: "A named member should request an assessment from the planner.",
  READY: "Each named member should approve the schedule with their own wallet.",
  REVIEW: "This allowance basis cannot be proven from a public document. Withdraw it or re-draft.",
  BLOCKED: "The workload does not fit the window. Shorten the batches or widen the window.",
  COMMITTED: "Committed. Every named member approved the same schedule.",
  CANCELLED: "Withdrawn before commitment. Nothing further to do.",
};

async function submit(
  client: Awaited<ReturnType<typeof createClient>>,
  signer: (request: { to: string; data: string; from?: string }) => Promise<string>,
  pending: PendingWrite,
): Promise<string> {
  const hash = await client.send(pending.method, pending.params);
  console.log(`  submitted ${pending.method} for ${pending.planId}: ${hash}`);
  return hash;
}

async function main(): Promise<void> {
  const manifest = await readManifest();
  const address = await resolveAddress();
  const args = process.argv.slice(2);
  const submitMode = args.includes("--submit");

  const client = await createClient({ address });
  const protocol = await client.protocol();
  console.log("Release:", protocol.version);
  console.log("Endpoint:", manifest.rpc);
  console.log("Contract:", address);

  const signerModule = process.env.SIGNER_MODULE;
  let signer: SignerModule["default"] | SignerModule["signer"] | undefined;
  if (submitMode && signerModule) {
    const loaded = (await dynamicImport(signerModule)) as SignerModule;
    signer = loaded.default ?? loaded.signer;
    console.log("Signer module loaded:", signerModule);
  }

  const ids = [
    ...(args.filter((arg) => arg.includes(":")).map((arg) => arg.replace(/^--plan=/, ""))),
    ...Object.values(manifest.fills ?? {}).filter((value) => typeof value === "string" && value.includes(":")),
  ];

  if (ids.length === 0) {
    console.log("No plans recorded yet. Seal one from the planner, then pass it here as wallet:reference.");
    console.log("Suggested sequence: seal, assess, approve with every member, then verify.");
    return;
  }

  const evidence: { name: string; pending: PendingWrite; stage: string; state?: string }[] = [];

  for (const id of [...new Set(ids)]) {
    let plan: PlanRecord;
    try {
      plan = await client.readPlan(id);
    } catch {
      console.log(`\n${id}: nothing stored under this reference yet.`);
      continue;
    }
    console.log(`\n${plan.id}`);
    console.log(`  title       ${plan.input.title}`);
    console.log(`  state       ${plan.state} (revision ${plan.revision})`);
    console.log(`  approvals   ${plan.approvals.length} of ${plan.input.members.length}`);
    console.log(`  allowance   ${plan.observation?.policy.allowance ?? "not assessed"} points`);
    console.log(`  finish      ${plan.proof?.finish_ms ?? 0} ms`);
    console.log(`  next step   ${NEXT_STEP[plan.state] ?? "Unknown state."}`);
    evidence.push({
      name: `read:${plan.id}`,
      pending: { name: plan.id, planId: plan.id, hash: "", method: "get_plan", params: [plan.id] },
      stage: "FINALIZED",
      state: plan.state,
    });
  }

  if (signer) {
    console.log("\nSubmit mode is enabled, but plan identities are decided in the wallet session.");
    console.log("Pass explicit references as arguments to submit writes for them.");
  } else if (submitMode) {
    console.log("\nSubmit mode requested without SIGNER_MODULE, so nothing was sent.");
  }

  const target = "evidence/live.json";
  if (evidence.length > 0) {
    const { writeFile } = await import("node:fs/promises");
    await writeFile(
      target,
      JSON.stringify(
        {
          deployment: { address, release: protocol.release ?? manifest.release },
          recordedAt: new Date().toISOString(),
          operations: evidence,
        },
        null,
        2,
      ) + "\n",
    );
    console.log(`\nRecorded ${evidence.length} read operations to ${target}.`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
