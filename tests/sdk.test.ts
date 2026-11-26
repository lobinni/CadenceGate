/**
 * Shared scheduler and configuration tests.
 *
 * Run with: npx tsx --test tests/sdk.test.ts
 *
 * These prove that the mirror the interface previews with is the same arithmetic
 * the contract performs, and that address resolution never depends on a literal.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { buildProof, timelineBounds, WINDOW_LABELS } from "../sdk/schedule.js";
import { isAddress, resolveAddress, ADDRESS_ENV_KEYS, MANIFEST_PATH } from "../sdk/config.js";
import type { PlanInput, Policy } from "../sdk/types.js";

const KNOWN: Policy = {
  status: "KNOWN",
  allowance: 5000,
  window_label: "HOUR",
  algorithm: "WINDOWED_ALLOWANCE",
  scope: "REQUESTER_CLASS_DOCUMENTED_DEFAULT",
  qualified: true,
  evidence: {},
  reason: "",
};

const WALLET_A = "0x" + "11".repeat(20);
const WALLET_B = "0x" + "22".repeat(20);

function spec(overrides: Partial<PlanInput> = {}): PlanInput {
  return {
    title: "Weekly reporting sweep",
    requester: "USER_TOKEN",
    basis: "PUBLIC_DEFAULT",
    horizon_ms: 20000,
    members: [
      { name: "Reporting service", address: WALLET_A },
      { name: "Analytics worker", address: WALLET_B },
    ],
    jobs: [
      { label: "Morning reconcile", member: 0, points: 900, arrival_ms: 0 },
      { label: "Summary digest", member: 1, points: 1200, arrival_ms: 1500 },
      { label: "Evening reconcile", member: 0, points: 900, arrival_ms: 3000 },
    ],
    ...overrides,
  };
}

test("window labels resolve to whole milliseconds", () => {
  assert.equal(WINDOW_LABELS.HOUR, 3600000);
  assert.equal(WINDOW_LABELS.MINUTE, 60000);
});

test("a feasible workload is ready and starts from a full bucket", () => {
  const proof = buildProof(spec(), KNOWN);
  assert.equal(proof.status, "READY");
  assert.deepEqual(
    proof.rows.map((row) => row.admit_ms),
    [0, 1500, 3000],
  );
  assert.equal(proof.rows[0].before_points, 5000);
  assert.equal(proof.finish_ms, 3000);
  assert.equal(proof.remaining_points, 2000);
});

test("credit is conserved on every row", () => {
  const input = spec();
  const proof = buildProof(input, KNOWN);
  input.jobs.forEach((job, index) => {
    const row = proof.rows[index];
    assert.equal(row.before_points - row.after_points, job.points);
    assert.ok(row.after_points >= 0);
    assert.ok(row.before_points <= proof.allowance_points);
  });
});

test("listing order is the admission order", () => {
  const input = spec({
    jobs: [
      { label: "Listed first", member: 0, points: 10, arrival_ms: 4000 },
      { label: "Listed second", member: 1, points: 10, arrival_ms: 100 },
    ],
  });
  const proof = buildProof(input, KNOWN);
  assert.deepEqual(
    proof.rows.map((row) => row.job),
    [0, 1],
  );
  assert.equal(proof.rows[1].admit_ms, 4000);
  assert.equal(proof.rows[1].before_points, 4990);
});

test("a batch that waits for the window to roll over reports the exact excess", () => {
  const input = spec({
    jobs: [
      { label: "Bulk export", member: 0, points: 3000, arrival_ms: 0 },
      { label: "Bulk reindex", member: 1, points: 3000, arrival_ms: 500 },
    ],
  });
  const proof = buildProof(input, KNOWN);
  assert.equal(proof.status, "BLOCKED");
  assert.equal(proof.blockers[0].earliest_ms, 3600000);
  assert.equal(proof.blockers[0].excess_ms, 3580000);
  assert.equal(proof.blockers[0].over_capacity, false);
});

test("a batch larger than the whole allowance is over capacity", () => {
  const input = spec({
    jobs: [
      { label: "Huge", member: 0, points: 6000, arrival_ms: 0 },
      { label: "Small", member: 1, points: 10, arrival_ms: 0 },
    ],
  });
  const proof = buildProof(input, KNOWN);
  assert.equal(proof.status, "BLOCKED");
  assert.equal(proof.blockers[0].over_capacity, true);
});

test("an unprovable basis returns review with no schedule", () => {
  const proof = buildProof(spec(), { ...KNOWN, status: "UNKNOWN", allowance: null, window_label: null });
  assert.equal(proof.status, "REVIEW");
  assert.deepEqual(proof.rows, []);
  assert.equal(proof.allowance_points, 0);
});

test("the scheduler is deterministic", () => {
  const input = spec();
  assert.deepEqual(buildProof(input, KNOWN), buildProof(input, KNOWN));
});

test("timeline bounds always span at least one millisecond", () => {
  const proof = buildProof(spec(), KNOWN);
  const bounds = timelineBounds(proof);
  assert.ok(bounds.end > bounds.start);
});

test("an address is accepted only in full hexadecimal form", () => {
  assert.ok(isAddress(WALLET_A));
  assert.ok(!isAddress(WALLET_A.slice(0, 30)));
  assert.ok(!isAddress("0x" + "0".repeat(40)));
  assert.ok(!isAddress(""));
});

test("an explicit address always wins over the manifest", async () => {
  const explicit = "0x" + "ab".repeat(20);
  assert.equal(await resolveAddress(explicit), explicit);

  const recorded = await resolveAddress();
  assert.ok(isAddress(recorded), "the manifest must carry a usable address");
  assert.notEqual(recorded, explicit, "an explicit argument must shadow the manifest");
  assert.notEqual(recorded, recorded.toLowerCase(), "published casing must survive resolution");
  assert.ok(MANIFEST_PATH.endsWith("deployment.json"));
  assert.ok(ADDRESS_ENV_KEYS.includes("CADENCEGATE_ADDRESS"));
});

test("an unresolvable address is reported instead of guessed", async () => {
  await assert.rejects(
    () => resolveAddress(undefined, "cadenceGate", "templates/deployment.template.json"),
    /No contract address resolved/,
  );
  await assert.rejects(() => resolveAddress("not-an-address"), /is not a valid contract address/);
  await assert.rejects(() => resolveAddress("0x" + "0".repeat(40)), /is not a valid contract address/);
});

/* ---------------- refusal reasons ---------------- */

test("a nested GenVM exception is recovered from the receipt", async () => {
  const { contractReason, messageFor } = await import("../src/lib/reasons.js");
  const stderr =
    '  File "/contract.py", line 283, in seal\n' +
    '    need(who in [m["address"] for m in data["members"]], "OWNER_MUST_BE_MEMBER")\n' +
    "Exception: OWNER_MUST_BE_MEMBER\n";

  const wrapped = {
    shortMessage: "Missing or invalid parameters.",
    details: "execution failed",
    cause: { code: -32000, message: "execution failed", data: { receipt: { genvm_result: { stderr } } } },
  };

  assert.equal(contractReason(wrapped), "OWNER_MUST_BE_MEMBER");
  assert.ok(messageFor("OWNER_MUST_BE_MEMBER").includes("roster"));
});

test("reasons fall back safely when nothing is recoverable", async () => {
  const { contractReason, messageFor } = await import("../src/lib/reasons.js");
  assert.equal(contractReason(new Error("boom")), null);
  assert.equal(contractReason(undefined), null);
  assert.ok(messageFor("SOMETHING_UNEXPECTED").length > 10);
  assert.notEqual(messageFor("STALE_REVISION"), messageFor("ALREADY_APPROVED"));
});

/* ---------------- transaction status normalization ---------------- */

test("a bare status string from gen_getTransactionStatus is understood", async () => {
  const { readStatusValue } = await import("../sdk/status.js");
  const view = readStatusValue("FINALIZED");
  assert.ok(view, "a bare string must still produce a status");
  assert.equal(view?.stage, "FINALIZED");
  assert.equal(view?.label, "Finalized");
});

test("status names are matched regardless of casing and shape", async () => {
  const { readStatusValue } = await import("../sdk/status.js");
  assert.equal(readStatusValue({ status: "FINALIZED" })?.stage, "FINALIZED");
  assert.equal(readStatusValue({ status: "Finalized" })?.stage, "FINALIZED");
  assert.equal(readStatusValue({ statusCode: 7 })?.stage, "FINALIZED");
  assert.equal(readStatusValue({ statusName: "Accepted" })?.stage, "ACCEPTED");
  assert.equal(readStatusValue({ status: "accepted" })?.stage, "ACCEPTED");
  assert.equal(readStatusValue({ status: "Proposing" })?.stage, "PROPOSING");
  assert.equal(readStatusValue({ statusCode: 2 })?.stage, "PROPOSING");
  assert.equal(readStatusValue(7)?.stage, "FINALIZED");
});

test("a failed execution is not reported as a success", async () => {
  const { readStatusValue } = await import("../sdk/status.js");
  const rejected = readStatusValue({
    status: "FINALIZED",
    txExecutionResultName: "FINISHED_WITH_ERROR",
    result_name: "MAJORITY_AGREE",
  });
  assert.equal(rejected?.stage, "FAILED");
  assert.ok(rejected?.detail.includes("rejected"));

  const agreed = readStatusValue({
    status: "FINALIZED",
    txExecutionResultName: "FINISHED_WITH_RETURN",
    result_name: "MAJORITY_AGREE",
  });
  assert.equal(agreed?.stage, "FINALIZED");
});

test("an unrecognised payload stays unknown instead of being guessed", async () => {
  const { readStatusValue } = await import("../sdk/status.js");
  assert.equal(readStatusValue(null), null);
  assert.equal(readStatusValue(undefined), null);
  assert.equal(readStatusValue(""), null);
  assert.equal(readStatusValue({ something: "else" }), null);
  assert.equal(readStatusValue({ status: "INVENTED" }), null);
});

test("the shared receipt helper accepts the bare-string shape too", async () => {
  const { receiptStatus } = await import("../sdk/client.js");
  assert.equal(receiptStatus("FINALIZED"), "FINALIZED");
  assert.equal(receiptStatus({ status: "FINALIZED", txExecutionResultName: "FINISHED_WITH_RETURN" }), "FINALIZED");
  assert.equal(receiptStatus({ status: "FINALIZED", txExecutionResultName: "FINISHED_WITH_ERROR" }), "FAILED");
  assert.equal(receiptStatus({ statusCode: 2 }), "PROPOSING");
  assert.equal(receiptStatus({ nonsense: true }), "UNKNOWN");
});

/* ---------------- fee estimation fallback trigger ---------------- */

test("a node-level internal error carries no contract reason, so fees are re-quoted", async () => {
  const { contractReason } = await import("../sdk/reasons.js");
  // This is the shape the node returns when it cannot dry-run a method that
  // executes a model call under consensus: no receipt, therefore no code.
  const internal = Object.assign(new Error("An internal error was received."), {
    code: -32603,
    details: "Internal error",
    shortMessage: "An internal error was received.",
  });
  assert.equal(contractReason(internal), null);
});

test("a real contract refusal still carries its code and must not be swallowed", async () => {
  const { contractReason } = await import("../sdk/reasons.js");
  const refused = {
    shortMessage: "Missing or invalid parameters.",
    cause: {
      message: "execution failed",
      data: { receipt: { genvm_result: { stderr: 'File "/contract.py", line 300\nException: MEMBER_ONLY\n' } } },
    },
  };
  assert.equal(contractReason(refused), "MEMBER_ONLY");
});

test("the non-executing quote matches the shape a write needs", async () => {
  const { createAccount, createClient, chains } = await import("genlayer-js");
  const client = createClient({ chain: chains.studionet, account: createAccount() });
  const estimate = await client.estimateTransactionFees();
  assert.equal(typeof estimate.feeValue, "bigint");
  assert.ok(estimate.feeValue > 0n, "a write must carry a non-zero fee value");
  assert.ok(estimate.distribution && typeof estimate.distribution === "object");
  assert.ok("leaderTimeunitsAllocation" in estimate.distribution);
  assert.ok("executionBudgetPerRound" in estimate.distribution);
});

/* ---------------- contract call labelling ---------------- */

test("the entry point is recovered from a real submitted payload", async () => {
  const { methodFromCalldata, describeCall } = await import("../src/lib/call.js");

  // A real seal submission from the live network.
  assert.equal(
    methodFromCalldata(
      "FgAkc2VhbARhcmdzFYQBd2Vla2x5LXJlcG9ydGluZ/waeyJ0aXRsZSI6IndlZWtseSByZXBvcnRpbmcgc3dlZXAi",
    ),
    "seal",
  );
  // A real assess submission, carried as base64.
  assert.equal(
    methodFromCalldata(
      "FgA0YXNzZXNzBGFyZ3MV3AMweGM3ODJhOWMxZWUxY2ZkYzdkMjZhYWEzYzA2NDljZDY4MjdmZDYyNDY6d2Vla2x5LXJlcG9ydGluZwE=",
    ),
    "assess",
  );
  // A zero-argument call has no args marker and still resolves.
  assert.equal(methodFromCalldata("0xcd8b0e004470726f746f636f6c00"), "protocol");
});

test("a payload that carries no known entry point is not guessed at", async () => {
  const { methodFromCalldata, looksLikeHash } = await import("../src/lib/call.js");
  assert.equal(methodFromCalldata("0xdeadbeef"), null);
  assert.equal(methodFromCalldata("not a payload"), null);
  assert.ok(looksLikeHash("0x" + "ab".repeat(32)));
  assert.ok(!looksLikeHash("0x" + "ab".repeat(20)));
});

test("a call summary keeps the plan reference readable", async () => {
  const { describeCall } = await import("../src/lib/call.js");
  const planId = "0xc782a9c1ee1cfdc7d26aaa3c0649cd6827fd6246:weekly-reporting";
  const summary = describeCall("assess", [planId, 0]);
  assert.equal(summary.method, "assess");
  assert.equal(summary.lines[0], planId, "a plan reference must never be truncated");
  assert.equal(summary.lines[1], "0");
});

/* ---------------- refusal explanation ---------------- */

test("a disagreement is reported as a disagreement, not as a generic rejection", async () => {
  const { readStatusValue } = await import("../sdk/status.js");
  // This is the exact shape of the failed assessment on the live network.
  const view = readStatusValue({
    status: "FINALIZED",
    txExecutionResultName: "FINISHED_WITH_ERROR",
    result_name: "MAJORITY_DISAGREE",
  });
  assert.equal(view?.stage, "FAILED");
  assert.equal(view?.label, "Disagreed", "the consensus outcome must not be masked by the execution verdict");
  assert.ok(view?.detail.includes("disagree"));
  assert.ok(view?.detail.includes("rejected"), "both explanations should be present");
});

test("a plain execution failure with agreed consensus is still a refusal", async () => {
  const { readStatusValue } = await import("../sdk/status.js");
  const view = readStatusValue({
    status: "FINALIZED",
    txExecutionResultName: "FINISHED_WITH_ERROR",
    result_name: "MAJORITY_AGREE",
  });
  assert.equal(view?.stage, "FAILED");
  assert.equal(view?.label, "Refused");
});

test("every contract refusal code reached by an assessment has plain language", async () => {
  const { messageFor } = await import("../sdk/reasons.js");
  for (const code of ["CLASS_ANCHOR", "ALGORITHM_ANCHOR", "WINDOW_ANCHOR", "SCOPE_ANCHOR", "NUMBER_ANCHOR",
                      "UNGROUNDED_QUOTE", "LLM_RATE_LIMITED"]) {
    const text = messageFor(code);
    assert.ok(text.length > 20, `${code} must explain itself`);
    assert.ok(!/^[A-Z_]+$/.test(text), `${code} must not be shown as a bare code`);
  }
});

/* ---------------- refusal explanation completeness ---------------- */

test("no receipt detail means no invented tally or placeholder sentence", async () => {
  const { fetchFailureDetail } = await import("../src/lib/failure.js");
  const original = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ transaction: { consensus_data: { votes: {}, leader_receipt: [] } } }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })) as typeof fetch;
  try {
    const detail = await fetchFailureDetail("0x" + "ab".repeat(32), "https://example.test/api");
    assert.equal(detail, null, "an empty receipt must not produce a message at all");
  } finally {
    globalThis.fetch = original;
  }
});

test("a recovered tally and contract code become one readable explanation", async () => {
  const { fetchFailureDetail } = await import("../src/lib/failure.js");
  const original = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        transaction: {
          consensus_data: {
            votes: { a: "disagree", b: "disagree", c: "disagree", d: "idle", e: "idle" },
            leader_receipt: [
              { genvm_result: { stderr: 'File "/contract.py", line 145\nException: CLASS_ANCHOR\n' } },
            ],
          },
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    )) as typeof fetch;
  try {
    const detail = await fetchFailureDetail("0x" + "cd".repeat(32), "https://example.test/api");
    assert.equal(detail?.code, "CLASS_ANCHOR");
    assert.ok(detail?.message.includes("per user"), "a known code must give plain language");
    assert.ok(detail?.message.includes("3 of 5 validators"));
    assert.ok(!detail?.message.includes("0 of 0"), "an empty tally must never be printed");
  } finally {
    globalThis.fetch = original;
  }
});

test("an unrecognised contract code names itself instead of hiding behind the fallback", async () => {
  const { fetchFailureDetail } = await import("../src/lib/failure.js");
  const original = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        transaction: {
          consensus_data: {
            votes: { a: "agree", b: "agree", c: "agree" },
            leader_receipt: [{ genvm_result: { stderr: "Exception: SOMETHING_NEW\n" } }],
          },
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    )) as typeof fetch;
  try {
    const detail = await fetchFailureDetail("0x" + "ef".repeat(32), "https://example.test/api");
    assert.equal(detail?.code, "SOMETHING_NEW");
    assert.ok(detail?.message.includes("SOMETHING_NEW"), "the exact code must reach the reader");
    assert.ok(!detail?.message.startsWith("The contract refused this request. Check the roster"));
  } finally {
    globalThis.fetch = original;
  }
});
