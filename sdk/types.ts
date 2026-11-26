/** Shared types for the CadenceGate SDK and scripts. */

export type Address = string;
export type TransactionHash = string;

export type RequesterClass = "USER_TOKEN" | "APP_INSTALLATION" | "OAUTH_APP" | "WORKFLOW_TOKEN";
export type AllowanceBasis = "PUBLIC_DEFAULT" | "ACCOUNT_CUSTOM" | "ENTERPRISE_AGREEMENT";
export type PlanState = "SEALED" | "READY" | "REVIEW" | "BLOCKED" | "COMMITTED" | "CANCELLED";

export interface Member {
  name: string;
  address: Address;
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
  allowance: number | null;
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
  owner: Address;
  input: PlanInput;
  input_hash: string;
  state: PlanState;
  revision: number;
  approvals: Address[];
  observation?: Observation;
  proof?: Proof;
  allocation_hash?: string;
  cancelled_by?: Address;
}

export interface PendingWrite {
  name: string;
  planId: string;
  hash: TransactionHash;
  method: string;
  params: unknown[];
  expectedRevision?: number;
  expectedError?: string;
  verified?: boolean;
}
