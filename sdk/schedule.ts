/**
 * Canonical schedule mirror, shared by the browser, the SDK and the scripts.
 *
 * The deployed contract performs the identical integer arithmetic, so a preview
 * computed here always matches the receipt produced on chain. The model is a
 * documented windowed allowance: a bucket that starts full and refills across
 * the named window, measured purely in whole points and whole milliseconds.
 */

import type { Job, PlanInput, Policy, Proof, ScheduleRow } from "./types.js";

export const WINDOW_LABELS: Record<"HOUR" | "MINUTE", number> = {
  HOUR: 3600000,
  MINUTE: 60000,
};

/**
 * FIFO order is the order the owner listed the batches in. Nothing is reordered:
 * the contract walks the list exactly as written, and this mirror does too, so a
 * preview here always matches the receipt on chain.
 */
function ordered(jobs: Job[]): { job: Job; index: number }[] {
  return jobs.map((job, index) => ({ job, index }));
}

function spentWithin(history: { admit_ms: number; points: number }[], at: number, windowMs: number): number {
  return history
    .filter((entry) => entry.admit_ms > at - windowMs)
    .reduce((sum, entry) => sum + entry.points, 0);
}

export function buildProof(input: PlanInput, policy: Policy): Proof {
  const total = input.jobs.reduce((sum, job) => sum + job.points, 0);

  if (policy.status !== "KNOWN" || policy.allowance === null || policy.window_label === null) {
    return {
      status: "REVIEW",
      reason:
        policy.reason ||
        "The documented allowance for this requester class could not be established from the public document.",
      rows: [],
      blockers: [],
      finish_ms: 0,
      total_points: total,
      allowance_points: 0,
      remaining_points: 0,
      window_ms: 0,
    };
  }

  const allowance = policy.allowance;
  const windowMs = WINDOW_LABELS[policy.window_label];
  const rows: ScheduleRow[] = [];
  const blockers: Proof["blockers"] = [];
  const history: { admit_ms: number; points: number }[] = [];
  let cursor = 0;
  let remaining = allowance;

  for (const { job, index } of ordered(input.jobs)) {
    if (job.points > allowance) {
      blockers.push({ job: index, earliest_ms: null, excess_ms: null, over_capacity: true });
      rows.push({
        job: index,
        member: job.member,
        arrival_ms: job.arrival_ms,
        admit_ms: job.arrival_ms,
        wait_ms: 0,
        before_points: 0,
        after_points: 0,
        window_used_points: job.points,
      });
      cursor = Math.max(cursor, job.arrival_ms);
      continue;
    }

    const floor = Math.max(cursor, job.arrival_ms);
    const expiries = history
      .filter((entry) => entry.admit_ms + windowMs > floor)
      .map((entry) => entry.admit_ms + windowMs);
    const candidates = [...new Set([floor, ...expiries])].sort((a, b) => a - b);

    // The set of admissions still counting only changes when one expires, so the
    // earliest feasible moment is one of this short ascending candidate list.
    let admit = floor;
    let before = 0;
    for (const candidate of candidates) {
      const used = spentWithin(history, candidate, windowMs);
      admit = candidate;
      before = allowance - used;
      if (used + job.points <= allowance) break;
    }

    const after = before - job.points;
    rows.push({
      job: index,
      member: job.member,
      arrival_ms: job.arrival_ms,
      admit_ms: admit,
      wait_ms: admit - job.arrival_ms,
      before_points: before,
      after_points: after,
      window_used_points: spentWithin(history, admit, windowMs) + job.points,
    });

    if (admit > input.horizon_ms) {
      blockers.push({ job: index, earliest_ms: admit, excess_ms: admit - input.horizon_ms, over_capacity: false });
    }

    history.push({ admit_ms: admit, points: job.points });
    remaining = after;
    cursor = admit;
  }

  return {
    status: blockers.length > 0 ? "BLOCKED" : "READY",
    reason: blockers.length > 0 ? "At least one batch lands after the agreed window." : "",
    rows,
    blockers,
    finish_ms: cursor,
    total_points: total,
    allowance_points: allowance,
    remaining_points: remaining,
    window_ms: windowMs,
  };
}

export function timelineBounds(proof: Proof): { start: number; end: number } {
  const candidates = [
    ...proof.rows.map((row) => row.admit_ms),
    ...proof.rows.map((row) => row.arrival_ms),
    proof.finish_ms,
  ];
  const start = Math.min(...candidates, 0);
  const end = Math.max(...candidates, 1);
  return { start, end: end === start ? start + 1 : end };
}
