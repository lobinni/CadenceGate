# Operation receipts

One file per write you performed during the walkthrough. Copy the template and fill it in as you go:

```sh
cp ../../templates/evidence-operation.template.json seal.json
```

| Step | `method` | Expected revision before |
| --- | --- | --- |
| Seal the roster | `seal` | none |
| Assess under consensus | `assess` | `0` |
| Approve the schedule | `approve` | the revision shown on the ledger |
| Withdraw the plan | `cancel` | the revision shown on the ledger |

Keep the `hash` exactly as your wallet displayed it. The verifier replays every file here against the live chain and
fails if a plan is missing, a state disagrees, or a named approval is absent.
