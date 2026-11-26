/**
 * Shared domain vocabulary. The browser mirror and the deployed contract both
 * speak these exact shapes, so a plan drafted here is byte-comparable on chain.
 */

export type RequesterClass = "USER_TOKEN" | "APP_INSTALLATION" | "OAUTH_APP" | "WORKFLOW_TOKEN";

export type AllowanceBasis = "PUBLIC_DEFAULT" | "ACCOUNT_CUSTOM" | "ENTERPRISE_AGREEMENT";

export type PlanState = "SEALED" | "READY" | "REVIEW" | "BLOCKED" | "COMMITTED" | "CANCELLED";

export interface Member {
  name: string;
  address: string;
}

export interface Job {
  label: string;
  member: number;
  points: number;
  arrival_ms: number;
}

export interface PlanInput {
  title: string;
  requester: RequesterClass;
  basis: AllowanceBasis;
  horizon_ms: number;
  members: Member[];
  jobs: Job[];
}

export interface Policy {
  status: "KNOWN" | "UNKNOWN";
  /** Documented points granted per documented window. */
  allowance: number | null;
  /** Named length of the documented window; resolved to milliseconds in code. */
  window_label: "HOUR" | "MINUTE" | null;
  algorithm: string | null;
  scope: string | null;
  qualified: boolean | null;
  evidence: Record<string, string>;
  reason: string;
}

export interface Observation {
  policy: Policy;
  source_sha256: string;
}

export interface ScheduleRow {
  job: number;
  member: number;
  arrival_ms: number;
  admit_ms: number;
  wait_ms: number;
  before_points: number;
  after_points: number;
  window_used_points: number;
}

export interface Blocker {
  job: number;
  earliest_ms: number | null;
  excess_ms: number | null;
  over_capacity: boolean;
}

export interface Proof {
  status: "READY" | "REVIEW" | "BLOCKED";
  reason: string;
  rows: ScheduleRow[];
  blockers: Blocker[];
  finish_ms: number;
  total_points: number;
  allowance_points: number;
  remaining_points: number;
  window_ms: number;
}

export interface PlanRecord {
  id: string;
  owner: string;
  input: PlanInput;
  input_hash: string;
  state: PlanState;
  revision: number;
  approvals: string[];
  observation?: Observation;
  proof?: Proof;
  allocation_hash?: string;
  cancelled_by?: string;
}

export const REQUESTER_CLASSES: RequesterClass[] = [
  "USER_TOKEN",
  "APP_INSTALLATION",
  "OAUTH_APP",
  "WORKFLOW_TOKEN",
];

export const ALLOWANCE_BASES: AllowanceBasis[] = [
  "PUBLIC_DEFAULT",
  "ACCOUNT_CUSTOM",
  "ENTERPRISE_AGREEMENT",
];

export const STATE_COPY: Record<PlanState, { label: string; tone: "idle" | "good" | "warn" | "bad"; note: string }> = {
  SEALED: { label: "Sealed", tone: "idle", note: "Roster and workload are frozen and awaiting assessment." },
  READY: { label: "Ready", tone: "good", note: "A feasible schedule exists and every member can now approve it." },
  REVIEW: { label: "Review", tone: "warn", note: "The documented policy could not establish this allowance." },
  BLOCKED: { label: "Blocked", tone: "bad", note: "The workload cannot fit inside the agreed window." },
  COMMITTED: { label: "Committed", tone: "good", note: "Every named member approved the same schedule." },
  CANCELLED: { label: "Cancelled", tone: "bad", note: "A named member withdrew the plan before commitment." },
};

export const UNITS_PER_POINT = 3600;

/** Human readable millisecond figure used across the interface. */
export function ms(value: number): string {
  if (value < 1000) return `${value} ms`;
  return `${(value / 1000).toFixed(value % 1000 === 0 ? 0 : 1)} s`;
}
