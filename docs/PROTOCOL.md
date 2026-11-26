# CadenceGate protocol

`seal` fixes the member addresses, requester class, allowance basis, maximum window and the strict FIFO workload
under one plan reference. Only named wallets may assess, approve or cancel. Every write carries the revision it
expects, so two members cannot act on a stale copy of the same plan. Approvals additionally bind the policy snapshot
and the schedule digest, and each member may approve once.

## The model

The contract models one documented public allowance as a bucket that starts full and refills across the documented
window. For the `USER_TOKEN`, `APP_INSTALLATION` and `OAUTH_APP` classes the window is one hour; `WORKFLOW_TOKEN`
uses the same hour with a smaller allowance. Nothing else is modelled.

The schedule is computed in whole points and whole milliseconds. There is no floating point and no rounding
drift anywhere in the arithmetic.

- A batch is admitted at the earliest millisecond that is at or after its arrival, at or after the admission of its
  predecessor, and at which the credit still counting from the documented window covers the batch.
- The set of admissions still counting only changes when one of them leaves the window, so the earliest feasible
  moment is always one of a short ascending candidate list: the floor itself plus each pending expiry.
- Each row records the credit before and after admission and the total consumed inside the window, which proves both
  conservation and minimality for every batch.
- A single batch larger than the whole allowance can never be admitted, and is reported as an over-capacity blocker
  rather than an infinite wait.

## Outcomes

| Outcome | Meaning |
| --- | --- |
| `READY` | Every batch lands inside the agreed window. Members may approve. |
| `BLOCKED` | At least one batch lands after the window, or is bigger than the whole allowance. |
| `REVIEW` | The allowance basis cannot be proven from a public document. |
| `COMMITTED` | Every named member approved the same schedule and the same fingerprint. |
| `CANCELLED` | A named member withdrew the plan before commitment. |

## Consensus

For an assessment the sealing member asks the network to read one fixed public document and extract the allowance for
the chosen requester class with a JSON model prompt. Validators fetch and interpret that same document independently,
then compare the byte digest, the literal source excerpts quoted by the leader, and every field the scheduler needs.

A final chain receipt records whether a consensus-backed call succeeded. It does not authenticate a private cloud
account. Live documents can change between node reads, and different interpretations or unavailable source data can
prevent consensus.

## Approvals

`assess` writes the policy, the schedule and an allocation fingerprint. `approve` refuses to act unless the caller
supplies that exact fingerprint and re-computes the schedule from the stored policy and input. Because the scheduler
is deterministic, the fingerprint pins the whole plan: input, policy and every admission time.

## Honest boundaries

- CadenceGate sends no requests to any API and never asks for credentials.
- It models the published default, not the entitlement of a private account.
- Concurrent traffic from other consumers can reduce real capacity below the model.
- A public document can change between node reads, which may prevent consensus.
