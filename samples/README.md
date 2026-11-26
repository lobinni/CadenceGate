# Live test payloads

These files are inputs for the live walkthrough in `docs/LIVE-TESTING.md`. They are not fixtures that a test
harness replays offline: every one of them is meant to be sealed, assessed, approved or withdrawn against a real
deployment, and each `_expected` block states the result the contract must produce on chain.

Before you use one, do two things:

1. Replace every member `address` with a wallet you actually control. The contract refuses a plan whose sealing
   wallet is not on the roster, and the wallets in these files are nobody's.
2. Keep at least two of those wallets funded, because `assess` and `approve` are separate signed transactions and
   each named member must sign with their own key.

| File | Purpose | Expected on chain |
| --- | --- | --- |
| `plan-ready.json` | Feasible workload, three ordered batches | `READY`, last admission 3,000 ms |
| `plan-blocked.json` | Second batch waits for the documented window to roll over | `BLOCKED`, 3,580,000 ms past the window |
| `plan-review.json` | Custom entitlement that a public document cannot prove | `REVIEW` |
| `plan-cancelled.json` | Feasible workload withdrawn before commitment | `CANCELLED` |

Validate the shapes without spending anything:

```
npx tsx scripts/schema.ts
```

Read a plan back after the network has settled:

```
npx tsx scripts/live.ts -- <wallet>:<reference>
```
