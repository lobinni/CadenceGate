import type { PlanInput } from "./types";

/**
 * Payloads for the live walkthrough.
 *
 * Everything except the member addresses is pre-filled, because those must be
 * wallets the tester actually controls: the contract refuses a seal from a
 * wallet that is not on the roster, and every member has to sign with its own
 * key. Each sample is paired with the outcome the contract must produce.
 */

export interface Sample {
  key: string;
  label: string;
  summary: string;
  expected: string;
  /** Plan reference used when this sample is loaded. */
  tag: string;
  input: PlanInput;
}

export const SAMPLES: Sample[] = [
  {
    key: "ready",
    tag: "weekly-reporting",
    label: "Feasible workload",
    summary: "Three ordered batches inside a twenty second window.",
    expected: "READY, last admission at 3,000 ms",
    input: {
      title: "Weekly reporting sweep",
      requester: "USER_TOKEN",
      basis: "PUBLIC_DEFAULT",
      horizon_ms: 20000,
      members: [
        { name: "Reporting service", address: "" },
        { name: "Analytics worker", address: "" },
      ],
      jobs: [
        { label: "Morning reconcile", member: 0, points: 900, arrival_ms: 0 },
        { label: "Summary digest", member: 1, points: 1200, arrival_ms: 1500 },
        { label: "Evening reconcile", member: 0, points: 900, arrival_ms: 3000 },
      ],
    },
  },
  {
    key: "blocked",
    tag: "quarterly-archive",
    label: "Over the window",
    summary: "A second batch that must wait for the documented window to roll over.",
    expected: "BLOCKED, 3,580,000 ms past the window",
    input: {
      title: "Quarterly archive push",
      requester: "APP_INSTALLATION",
      basis: "PUBLIC_DEFAULT",
      horizon_ms: 20000,
      members: [
        { name: "Archive writer", address: "" },
        { name: "Index builder", address: "" },
      ],
      jobs: [
        { label: "Bulk export", member: 0, points: 3000, arrival_ms: 0 },
        { label: "Bulk reindex", member: 1, points: 3000, arrival_ms: 500 },
      ],
    },
  },
  {
    key: "review",
    tag: "enterprise-archive",
    label: "Unprovable basis",
    summary: "A custom entitlement that no public document can establish.",
    expected: "REVIEW, refused with PRIVATE_QUOTA_UNVERIFIABLE",
    input: {
      title: "Enterprise archive push",
      requester: "OAUTH_APP",
      basis: "ACCOUNT_CUSTOM",
      horizon_ms: 20000,
      members: [
        { name: "Archive writer", address: "" },
        { name: "Index builder", address: "" },
      ],
      jobs: [
        { label: "Bulk export", member: 0, points: 800, arrival_ms: 0 },
        { label: "Bulk reindex", member: 1, points: 800, arrival_ms: 1000 },
      ],
    },
  },
  {
    key: "cancelled",
    tag: "daily-digest",
    label: "Withdrawn early",
    summary: "A feasible workload that any member cancels before the last approval.",
    expected: "SEALED, then CANCELLED",
    input: {
      title: "Daily digest refresh",
      requester: "USER_TOKEN",
      basis: "PUBLIC_DEFAULT",
      horizon_ms: 15000,
      members: [
        { name: "Digest writer", address: "" },
        { name: "Digest reader", address: "" },
      ],
      jobs: [
        { label: "Collect headlines", member: 0, points: 400, arrival_ms: 0 },
        { label: "Render digest", member: 1, points: 400, arrival_ms: 2000 },
      ],
    },
  },
];

export function sampleByKey(key: string): Sample | undefined {
  return SAMPLES.find((sample) => sample.key === key);
}

/** Deep copy so loading a sample never mutates the catalogue. */
export function cloneSample(sample: Sample): PlanInput {
  return JSON.parse(JSON.stringify(sample.input)) as PlanInput;
}
