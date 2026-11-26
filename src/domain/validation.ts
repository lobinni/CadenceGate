/**
 * Client-side guard that mirrors the contract's own input rules. The codes match
 * the contract one for one, so a rejected draft here would be rejected there too.
 */

import { ALLOWANCE_BASES, REQUESTER_CLASSES, type PlanInput } from "./types";
import { messageFor as sharedMessageFor } from "@/lib/reasons";

export interface Guard {
  ok: boolean;
  code: string;
  field: string;
}

const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;

export function isAddress(value: string): boolean {
  return ADDRESS_PATTERN.test(value.trim()) && BigInt(value.trim()) !== 0n;
}

function pass(): Guard {
  return { ok: true, code: "", field: "" };
}

function fail(code: string, field: string): Guard {
  return { ok: false, code, field };
}

function cleanText(value: string): boolean {
  return value.length > 0 && value.trim() === value && !value.split("").some((c) => c.charCodeAt(0) < 32);
}

export function guardTitle(value: string): Guard {
  if (typeof value !== "string" || value.length < 3 || value.length > 100) return fail("TITLE_BOUND", "Title");
  if (!cleanText(value)) return fail("CONTROL_CHARACTER", "Title");
  return pass();
}

export function guardMembers(members: { name: string; address: string }[]): Guard {
  if (members.length < 2 || members.length > 4) return fail("MEMBER_COUNT", "Members");
  for (const member of members) {
    if (member.name.length < 1 || member.name.length > 40) return fail("TEXT_BOUND", "Member name");
    if (!cleanText(member.name)) return fail("CONTROL_CHARACTER", "Member name");
    if (!isAddress(member.address)) return fail("ADDRESS", "Member wallet");
  }
  const wallets = members.map((m) => m.address.toLowerCase());
  if (new Set(wallets).size !== wallets.length) return fail("DUPLICATE_WALLET", "Member wallet");
  if (new Set(members.map((m) => m.name.toLowerCase())).size !== members.length)
    return fail("DUPLICATE_NAME", "Member name");
  return pass();
}

export function guardJobs(input: PlanInput): Guard {
  if (input.jobs.length < input.members.length || input.jobs.length > 8) return fail("JOB_COUNT", "Batches");
  for (const job of input.jobs) {
    if (job.label.length < 1 || job.label.length > 60) return fail("TEXT_BOUND", "Batch label");
    if (!cleanText(job.label)) return fail("CONTROL_CHARACTER", "Batch label");
    if (!Number.isInteger(job.member) || job.member < 0 || job.member >= input.members.length)
      return fail("JOB_MEMBER", "Batch owner");
    if (!Number.isInteger(job.points) || job.points < 1 || job.points > 1000000)
      return fail("JOB_POINTS", "Batch size");
    if (!Number.isInteger(job.arrival_ms) || job.arrival_ms < 0 || job.arrival_ms > 60000)
      return fail("JOB_ARRIVAL", "Batch arrival");
  }
  const owners = new Set(input.jobs.map((job) => job.member));
  for (let i = 0; i < input.members.length; i += 1) {
    if (!owners.has(i)) return fail("MISSING_MEMBER_WORKLOAD", "Batches");
  }
  return pass();
}

/** Full contract-equivalent check for a drafted plan. */
export function guardPlan(input: PlanInput): Guard {
  const title = guardTitle(input.title);
  if (!title.ok) return title;
  if (!REQUESTER_CLASSES.includes(input.requester)) return fail("REQUESTER_CLASS", "Requester class");
  if (!ALLOWANCE_BASES.includes(input.basis)) return fail("BASIS", "Allowance basis");
  if (!Number.isInteger(input.horizon_ms) || input.horizon_ms < 1 || input.horizon_ms > 60000)
    return fail("HORIZON", "Maximum window");
  const members = guardMembers(input.members);
  if (!members.ok) return members;
  return guardJobs(input);
}

export function guardTag(tag: string): Guard {
  if (typeof tag !== "string" || tag.length < 3 || tag.length > 32) return fail("TAG", "Plan reference");
  if (!/^[a-z0-9-]+$/.test(tag)) return fail("TAG", "Plan reference");
  return pass();
}

export function messageFor(code: string): string {
  const table: Record<string, string> = {
    TITLE_BOUND: "The title must hold between 3 and 100 characters.",
    CONTROL_CHARACTER: "Remove invisible control characters from this field.",
    REQUESTER_CLASS: "Choose one of the four documented requester classes.",
    BASIS: "Choose a recognised allowance basis.",
    HORIZON: "The maximum window must stay between 1 and 60,000 milliseconds.",
    MEMBER_COUNT: "A plan needs between 2 and 4 named members.",
    TEXT_BOUND: "This label is too long for the contract.",
    ADDRESS: "That wallet address is not a valid hexadecimal account.",
    DUPLICATE_WALLET: "Two members share the same wallet address.",
    DUPLICATE_NAME: "Two members share the same name.",
    JOB_COUNT: "A plan needs at least one batch per member, and at most eight.",
    JOB_MEMBER: "Every batch must point at a listed member.",
    JOB_POINTS: "Batch size must be a whole number between 1 and 1,000,000 points.",
    JOB_ARRIVAL: "Arrival must fall between 0 and 60,000 milliseconds.",
    MISSING_MEMBER_WORKLOAD: "Every member needs at least one batch assigned.",
    TAG: "Plan references use lowercase letters, digits and hyphens.",
    NOT_CONNECTED: "Connect a wallet that the network recognises first.",
    NO_CONTRACT: "Point the application at a deployed contract address first.",
    OWNER_MUST_BE_MEMBER:
      "Only a wallet that appears in the roster may seal it. Add the connected wallet to the roster, or switch to one that is already listed.",
    MEMBER_ONLY: "Only wallets listed in this roster may take this step. Switch to a member wallet.",
    OWNER_LIMIT: "This wallet already holds the maximum number of published plans. Withdraw or reuse one of them.",
    ID_CONFLICT: "That reference already holds a different plan under this wallet. Choose another one.",
    NOT_FOUND: "Nothing is stored under that plan reference yet.",
    STALE_REVISION: "Another member advanced this plan. Re-read it from the ledger and act on the new revision.",
    NOT_SEALED: "This plan has already been assessed, so it cannot be assessed again.",
    NOT_READY: "Only a feasible plan can be approved. Assess it first, or resolve what is blocking it.",
    ALREADY_APPROVED: "This wallet has already approved this schedule. Each member approves once.",
    ALLOCATION_MISMATCH: "The schedule changed since you opened it. Re-read the plan and approve the current one.",
    PROOF_MISMATCH: "The stored schedule no longer matches its inputs. Withdraw the plan and draft it again.",
    TERMINAL: "This plan is already committed or cancelled, so it can no longer change.",
    QUOTE_BOUND: "An evidence quote is too long for the contract.",
    UNGROUNDED_QUOTE: "An evidence quote does not appear in the source document.",
    SOURCE_HTTP: "The source document could not be fetched. Try the assessment again.",
    SOURCE_DOCUMENT: "The fetched document did not contain the expected rate limit section.",
    PRIVATE_QUOTA_UNVERIFIABLE: "A custom entitlement cannot be proven from a public document. Use a public basis or withdraw the plan.",
    INPUT_SCHEMA: "The plan payload does not match the shape the contract expects.",
  };
  return table[code] ?? sharedMessageFor(code);
}

export const ok: Guard = { ok: true, code: "", field: "" };
