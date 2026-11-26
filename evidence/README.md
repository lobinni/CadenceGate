# Evidence

Everything in this directory was produced by running the walkthrough in `docs/LIVE-TESTING.md` against the live
contract. Nothing here is a fixture and nothing is hand-written: each file is a record of a real read or a real
receipt.

| Path | Produced by | Contents |
| --- | --- | --- |
| `contract-tests.txt` | `python3 -m unittest discover -s tests` | The contract suite output for this release. |
| `source-verification.json` | local sha256 of `contracts/cadencegate.py` | Source digest and the address it was published to. |
| `genvm-check.json` | the deployment SDK | Runtime identity of the published contract. |
| `live.json` | `npx tsx scripts/live.ts` | Read operations performed against the live contract. |
| `receipts/` | your browser wallet during the walkthrough | One file per operation. |
| `history/` | a previous release | Kept separately so a redeploy never overwrites the last record. |

## Current state

`live.json` holds the deployment identity and an empty operation list. That is deliberate: the file is filled by
actually running the walkthrough, and a fabricated list would make `scripts/verify.ts` worthless.

Fill it, then replay:

```sh
export CADENCEGATE_ADDRESS=0xBCA8c56FD5D2f8dcABA997FDc601b0A4E5CF2E32
npx tsx scripts/live.ts
npx tsx scripts/verify.ts
```

## Recording a receipt

Copy `templates/evidence-operation.template.json` to `receipts/<step>.json` and replace every placeholder with the
values your wallet showed. The verifier checks the plan identity, the revision it expected, and that the transaction
reached finality with the state the file claims.
