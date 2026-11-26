/**
 * Validates every sample and template payload in the repository against the
 * contract's own input rules, and prints the schedule the contract would return.
 *
 * Run it with no arguments to check all payloads, or pass a file to inspect one.
 */

import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { buildProof } from "../sdk/schedule.js";
import type { PlanInput, Policy } from "../sdk/types.js";

const DIRECTORIES = ["samples", "templates"];
const ALLOWED_CLASSES = ["USER_TOKEN", "APP_INSTALLATION", "OAUTH_APP", "WORKFLOW_TOKEN"];
const ALLOWED_BASES = ["PUBLIC_DEFAULT", "ACCOUNT_CUSTOM", "ENTERPRISE_AGREEMENT"];

function need(ok: boolean, code: string): void {
  if (!ok) throw new Error(code);
}

function address(value: string): string {
  need(typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value) && BigInt(value) !== 0n, "ADDRESS");
  return value.toLowerCase();
}

/** Same validation the contract performs on `seal`. */
export function specification(raw: PlanInput): PlanInput {
  need(typeof raw.title === "string" && raw.title.length >= 3 && raw.title.length <= 100, "TITLE_BOUND");
  need(ALLOWED_CLASSES.includes(raw.requester), "REQUESTER_CLASS");
  need(ALLOWED_BASES.includes(raw.basis), "BASIS");
  need(Number.isInteger(raw.horizon_ms) && raw.horizon_ms >= 1 && raw.horizon_ms <= 60000, "HORIZON");
  need(Array.isArray(raw.members) && raw.members.length >= 2 && raw.members.length <= 4, "MEMBER_COUNT");
  for (const member of raw.members) {
    need(typeof member.name === "string" && member.name.length >= 1 && member.name.length <= 40, "TEXT_BOUND");
    member.address = address(member.address);
  }
  const wallets = raw.members.map((member) => member.address);
  need(new Set(wallets).size === wallets.length, "DUPLICATE_WALLET");
  need(new Set(raw.members.map((m) => m.name.toLowerCase())).size === raw.members.length, "DUPLICATE_NAME");
  need(Array.isArray(raw.jobs) && raw.jobs.length >= raw.members.length && raw.jobs.length <= 8, "JOB_COUNT");
  for (const job of raw.jobs) {
    need(typeof job.label === "string" && job.label.length >= 1 && job.label.length <= 60, "TEXT_BOUND");
    need(Number.isInteger(job.member) && job.member >= 0 && job.member < raw.members.length, "JOB_MEMBER");
    need(Number.isInteger(job.points) && job.points >= 1 && job.points <= 1000000, "JOB_POINTS");
    need(Number.isInteger(job.arrival_ms) && job.arrival_ms >= 0 && job.arrival_ms <= 60000, "JOB_ARRIVAL");
  }
  need(new Set(raw.jobs.map((job) => job.member)).size === raw.members.length, "MISSING_MEMBER_WORKLOAD");
  return raw;
}

const KNOWN_POLICY: Policy = {
  status: "KNOWN",
  allowance: 5000,
  window_label: "HOUR",
  algorithm: "WINDOWED_ALLOWANCE",
  scope: "REQUESTER_CLASS_DOCUMENTED_DEFAULT",
  qualified: true,
  evidence: {},
  reason: "",
};

async function filesIn(directory: string): Promise<string[]> {
  try {
    const entries = await readdir(directory);
    return entries.filter((entry) => entry.endsWith(".json")).map((entry) => join(directory, entry));
  } catch {
    return [];
  }
}

async function main(): Promise<void> {
  const targets = process.argv.slice(2).length > 0
    ? process.argv.slice(2)
    : [...(await filesIn("samples")), ...(await filesIn("templates"))];

  let checked = 0;
  let skipped = 0;

  for (const path of targets) {
    const raw = await readFile(path, "utf8");
    const body = JSON.parse(raw) as Partial<PlanInput> | { payload?: PlanInput };
    const payload = ("payload" in body && body.payload ? body.payload : body) as PlanInput;

    if (typeof payload.title !== "string") {
      console.log(`${path}\n   skipped: not a plan payload`);
      skipped += 1;
      continue;
    }

    if (/<0x-[a-z-]+>/.test(raw)) {
      // Prove the template's shape with distinct stand-in wallets; the
      // placeholders are meant to be replaced by the person running the
      // walkthrough, so each one needs its own probe address.
      let counter = 0;
      const probe = JSON.parse(
        raw.replace(/<0x-[a-z-]+>/g, () => {
          counter += 1;
          return "0x" + String(counter).padStart(40, "0");
        }),
      ) as PlanInput;
      specification(probe);
      console.log(`${path}\n   template: guards pass once the placeholders are replaced`);
      skipped += 1;
      continue;
    }

    specification(payload);
    const proof = buildProof(
      payload,
      payload.basis === "PUBLIC_DEFAULT"
        ? KNOWN_POLICY
        : { ...KNOWN_POLICY, status: "UNKNOWN", allowance: null, window_label: null },
    );
    console.log(`${path}`);
    console.log(`   members ${payload.members.length}, batches ${payload.jobs.length}, window ${payload.horizon_ms} ms`);
    console.log(
      `   outcome ${proof.status}, last admission ${proof.finish_ms} ms, requested ${proof.total_points} points`,
    );
    checked += 1;
  }

  console.log(`\nValidated ${checked} payload${checked === 1 ? "" : "s"}. All contract guards passed.`);
  if (skipped > 0) console.log(`${skipped} file${skipped === 1 ? "" : "s"} skipped (templates or non-plan records).`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
