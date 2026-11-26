# Live contract walkthrough

This guide exercises every write path against a real deployment. Nothing is mocked and no fixture is replayed: the
values you record come from wallets you control and from receipts the network returns.

## 0. Prerequisites

- Node 22.13 or newer.
- A browser wallet that speaks the standard injected provider interface.
- At least two funded wallets you control. Assessments and approvals are separate transactions and every named member
  must sign with its own key.
- Some GEN in each of those wallets. Studionet charges a fee on every write; the built-in faucet in the Studio account
  selector tops an account up for free.

Before any write is signed, the interface asks the network to estimate the fee for that exact call and then passes the
resulting distribution and value along with the transaction. That is why a seal costs a little GEN rather than nothing,
and why the estimate always matches the call you are about to make. If a wallet holds no GEN the estimate itself fails,
and the panel reports it before anything is signed.
- The deployed contract for this release: `0xBCA8c56FD5D2f8dcABA997FDc601b0A4E5CF2E32` on chain `61999`.
  Inspect it at <https://explorer-studio.genlayer.com/address/0xBCA8c56FD5D2f8dcABA997FDc601b0A4E5CF2E32>.

The interface already targets that address, so you only need to export it when you work from a clean shell:

```sh
export CADENCEGATE_ADDRESS=0xBCA8c56FD5D2f8dcABA997FDc601b0A4E5CF2E32
```

Every script, test and read helper follows it. Typing the address into the deployment panel in the interface is
equivalent. See `docs/CONTRACT-ADDRESSES.md` for the full precedence list.

## 1. Confirm the release

```sh
npx tsc --noEmit
python3 -m unittest discover -s tests
npx tsx --test tests/sdk.test.ts
npx tsx scripts/schema.ts
npx tsx scripts/verify.ts
```

`scripts/schema.ts` validates every payload in `samples/` and `templates/` against the same guards the contract
applies on `seal`. `scripts/verify.ts` is read-only: it re-reads the published plans and confirms each recorded
operation reached finality.

## 1b. Wallet and network

Connecting does two things, in this order:

1. Asks the wallet for an account.
2. Checks `eth_chainId` against `61999`. If it differs, the interface requests
   `wallet_switchEthereumChain`, and if the wallet has never seen the network it requests `wallet_addEthereumChain` with
   the documented Studionet parameters and then switches again.
3. Reads `eth_chainId` once more. If it still reports another chain, the connection fails closed and every write stays
   blocked. Nothing is signed against the wrong network.

You can also switch manually from the account panel, which shows a **Switch to GenLayer Studio Testnet** button whenever
the wallet reports a different chain. The header shows the chain the wallet is on.

**Address casing matters.** The GenLayer node resolves contracts case-sensitively, so the published address
`0xBCA8c56FD5D2f8dcABA997FDc601b0A4E5CF2E32` must be kept exactly as written. Do not paste a lower-cased copy: every
call would report the contract as missing.

## 2. Seal a roster

Open the interface, choose **Planner**, and fill in:

1. A title and a plan reference. The reference is lowercase letters, digits and hyphens, and it is what makes the plan
   addressable later.
2. A requester class and an allowance basis. Use `PUBLIC_DEFAULT` for the first pass; the other two bases exist to
   demonstrate the `REVIEW` path.
3. A maximum window. 20,000 milliseconds is enough to see waiting behaviour without a long poll.
4. Between two and four members. The wallet you connect has to be one of them.
5. Between two and five ordered batches. Every member needs at least one batch.

The feasibility preview is computed in your browser with the published default for the class you chose. When it
matches what you expect, choose **Seal the roster** and confirm in your wallet.

Record the submission hash that the panel shows. You will need it if the poll ends before consensus settles.

## 2b. Working with several plans

Each plan lives under `<sealing-wallet>:<reference>`, so the plan you act on is the one whose reference is in the
form. The planner lists every plan the connected wallet sealed, showing its title, state and approval count; picking
one puts that reference in the form and loads its record, and the buttons below always act on exactly that plan.

The ledger is the other way round: select any row and its record opens underneath with the same buttons. A plan sealed
by another wallet is reachable there through **public lookup**, and its actions appear once your wallet is one of its
members.

Only a member of the selected plan can assess, approve or withdraw it. If the connected wallet is not on that roster,
the panel says so instead of sending a transaction.

## 3. Assess under consensus

The submission box reports the network's own state while consensus runs, and the elapsed seconds tick up next to it:

| Reported | What is happening |
| --- | --- |
| Queued | Waiting for a leader to pick the request up. |
| Proposing | The leader is executing it. |
| Committing | Validators are casting votes. |
| Reveal / Reveal | Votes are being revealed. |
| Accepted | Consensus agreed, waiting to finalize. |
| Finalized | Done. The ledger now holds the result. |
| Refused | The network cancelled it, or a validator or leader timed out. |

The endpoint answers status queries in two different shapes, and both are handled: `gen_getTransactionStatus`
returns a bare string such as `FINALIZED`, while `eth_getTransactionByHash` returns an object carrying `status`,
`txExecutionResultName` and `result_name`. Names arrive upper case on Studionet and title case elsewhere, so every
lookup is case-insensitive. A transaction that finalizes but fails to execute is reported as a refusal rather than a
success, because the contract state did not change.

**Reading a refusal.** A failed write shows the exact contract exception and the vote tally, taken back from the
leader receipt, so you see *why* rather than a generic rejection. Two causes are common:

| Shown | Meaning | What to do |
| --- | --- | --- |
| `CLASS_ANCHOR` | A quote did not name the class it belongs to, such as *per user* or *per installation*. | Live on `cadencegate-2`, which asks for a class word explicitly. Retry if it still appears. |
| `LLM_RATE_LIMITED` | The document reading step was rate limited while consensus ran. | Transient. Run the assessment again in a moment. |

Either way the plan stays `SEALED` at the same revision, so a retry costs only the fee.

**A failed assessment changes nothing.** If the assessment is refused, the plan stays `SEALED` at the same revision, so
retrying is free apart from the fee. An `UNGROUNDED_QUOTE` refusal means the model paraphrased a source excerpt.
`cadencegate-2`, which is what the live contract reports, grounds a faithfully copied span while still refusing a
paraphrase, so retrying is usually enough.

**Assessment cannot be dry-run.** Every other step is estimated by replaying the exact call against the network, which
also catches contract refusals early. `assess` is different: it fetches a document and runs a model call under
consensus, so the node refuses to simulate it and answers with a bare internal error. For that step the fee is quoted
without executing the call instead. A genuine contract refusal is never swallowed this way, because it still arrives
with its own exception code and is shown to you in plain language.

Studionet finalization regularly takes one to several minutes, and an assessment is the slowest step because every
validator re-reads and re-interprets the source document. The poll backs off from two to eight seconds and keeps
reporting elapsed time, so a long wait always looks alive rather than stuck.

If it does not settle, nothing is lost: the submission is recorded under its own hash, and the **Follow in explorer**
link next to it opens the same transaction outside the interface. Do not resubmit.



With the same wallet still connected and the same reference typed in, choose **Assess under consensus**. This is the
only step that runs a model call, so it is also the only step that can end without a settled receipt.

- If the receipt finalises, the plan moves to `READY`, `BLOCKED` or `REVIEW` and the ledger shows the allowance the
  network agreed on.
- If polling times out, **do not resubmit**. The submission is already recorded under its own hash. Run the read-only
  check below until it settles:

```sh
npx tsx scripts/live.ts -- <sealing-wallet>:<plan-reference>
```

Record the allowance, the window and the allocation fingerprint that appears on the ledger.

## 4. Approve with every member

Switch the browser wallet to the first member other than the sealer, re-open the ledger, and choose **Approve this
schedule**. Then repeat for each remaining member. The final distinct approval moves the plan to `COMMITTED`.

## 3b. Reading a refusal

A rejected write arrives from the wallet as a generic message such as *"Missing or invalid parameters ... execution
failed"*. That wording comes from the transport, not from the contract. The real reason is still in the simulation
receipt, so the interface recovers it and shows the contract's own code in plain language instead:

| Recovered from the receipt | Shown to the writer |
| --- | --- |
| `OWNER_MUST_BE_MEMBER` | The sealing wallet is not on the roster. |
| `MEMBER_ONLY` | Only listed members may take this step. |
| `STALE_REVISION` | Another member already advanced the plan. |
| `ALREADY_APPROVED` | This wallet already approved this schedule. |
| `NOT_READY` | The plan is not feasible yet, so it cannot be approved. |

The planner also refuses to offer **Seal the roster** while the connected wallet is missing from the roster, and offers
**Add this wallet to the roster** right there, so the most common refusal cannot be reached by accident.

Guard rails you should expect to hit on purpose:

- Approving twice from the same wallet is refused.
- Approving with a wallet that is not on the roster is refused.
- Approving a stale revision is refused.
- Approving with a fingerprint that does not match the stored one is refused.

Record each approval hash in `evidence/receipts/`, using `templates/evidence-operation.template.json`.

## 5. Exercise the remaining paths

Repeat the walkthrough once per sample payload in `samples/`. Each one is designed to reach a different outcome, and
each `_expected` block states what the contract must return.

| Payload | What it proves |
| --- | --- |
| `plan-ready.json` | A feasible workload reaches `READY` and then `COMMITTED`. |
| `plan-blocked.json` | A batch that cannot fit produces a `BLOCKED` result with an exact excess. |
| `plan-review.json` | A custom entitlement produces `REVIEW` instead of a schedule. |
| `plan-cancelled.json` | A named member can withdraw before commitment. |

Withdraw the cancelled case from the planner with any named member wallet before the last approval.

## 6. Record the release

Fill the four `fills` entries in `deployment.json` with the plans you actually committed, blocked, reviewed and
cancelled, then run:

```sh
npx tsx scripts/live.ts
npx tsx scripts/verify.ts
```

`scripts/live.ts` writes the read operations it performed into `evidence/live.json`. `scripts/verify.ts` replays them against
the current deployment and refuses to pass if a plan is missing, a state disagrees, or a named approval is absent.

## 7. Troubleshooting

| Symptom | Cause | What to do |
| --- | --- | --- |
| The planner says no live contract is selected | No address resolved | Set `CADENCEGATE_ADDRESS`, or use the deployment panel. |
| Assessment never finalises | Validators are still reading the document | Keep polling with `npx tsx scripts/live.ts`. Never resubmit the same plan. |
| `OWNER_MUST_BE_MEMBER` | The wallet sealing is not on the roster | Choose **Add this wallet to the roster** in the planner, or switch to a wallet you listed. |
| `STALE_REVISION` | Another member already advanced the plan | Re-read the plan from the ledger and act on the new revision. |
| `MEMBER_ONLY` | The connected wallet is not on the roster | Switch to a wallet you listed when sealing. |
| `OWNER_MUST_BE_MEMBER` | You tried to seal with an outside wallet | Add that wallet to the roster first. |
| Ledger shows nothing | The reference is stored under the sealing wallet | Look it up by the wallet that sealed it, not your own. |
