# Deploying CadenceGate

## Build and publish the interface

```sh
npm ci
npx tsc --noEmit
npm run build
```

The build produces a single self-contained bundle in `dist/`. Publish it to any static host. Set
`VITE_CADENCEGATE_ADDRESS` at build time when the bundle belongs to one specific release, otherwise leave it unset and
let the deployment panel carry the address.

## Publish the contract

```sh
npx tsx scripts/deploy.ts
```

The script reads `contracts/cadencegate.py`, hashes it, tries to publish through the deployment SDK, and writes the
resulting identity back into `deployment.json`. If the SDK is not installed in your checkout it does not fail: it
records the digest and tells you which environment variable to set instead.

Two equivalent ways to record the address by hand:

```sh
export CADENCEGATE_ADDRESS=0xBCA8c56FD5D2f8dcABA997FDc601b0A4E5CF2E32
```

or fill `contracts.cadenceGate.address` in `deployment.json`. Both are picked up by the interface, the SDK, the
scripts and the tests, because none of them reads an address from anywhere else.

## Fees on every write

Writes are not free on this network. Both the interface and `sdk/client.ts` call
`estimateTransactionFeesForWrite` first and pass `{distribution, feeValue}` into `writeContract`. Any new write path must
do the same, or the SDK refuses the transaction with a fee error.

## Release cadencegate-2

The recorded address runs **cadencegate-2** and reports it from `protocol()`:

| Field | Value |
| --- | --- |
| Address | `0xBCA8c56FD5D2f8dcABA997FDc601b0A4E5CF2E32` |
| Chain | `61999` |
| Reported version | `cadencegate-2` |
| Source digest | `724f4c1356a5bca47b0683b2c5c9f7fe061543a8b7c6e7093c28a8d5e0a4b8c6` |
| Explorer | https://explorer-studio.genlayer.com/address/0xBCA8c56FD5D2f8dcABA997FDc601b0A4E5CF2E32 |

cadencegate-2 carries two changes over the first release:

1. **Evidence grounding tolerates decoration.** A quote is normalised on both sides before the containment test, so a
   span copied faithfully from a Markdown document with template markers still grounds, while a paraphrase is still
   refused. This is what `UNGROUNDED_QUOTE` was reporting.
2. **Each anchor proves what it is named after.** The requester-class quote must name a class such as *per user* or
   *per installation*, rather than an unrelated phrase, and the prompt asks for it explicitly. This is what
   `CLASS_ANCHOR` was reporting.

The digest above is computed from `contracts/cadencegate.py` in this repository. Record it in `deployment.json` when
you redeploy, because the read-only verifier refuses to pass if the local source and the manifest disagree.

## ## Verify what you published

```sh
npx tsx scripts/verify.ts
```

The verifier is read-only. It checks that the local source digest matches the release record, that the contract
identifies itself, that every recorded operation reached finality, and that each recorded plan still reads back with
the state and approvals it claimed.

## Evidence layout

| Path | Contents |
| --- | --- |
| `deployment.json` | Release identity, address slot, source digest, filled plan references. |
| `evidence/live.json` | Operations performed against the live contract, written by `scripts/live.ts`. |
| `evidence/receipts/` | One file per operation, using `templates/evidence-operation.template.json`. |
| `evidence/source-verification.json` | Source digest of the contract and the document it reads. |

Keep evidence for each release separate. If you redeploy, start a new manifest from
`templates/deployment.template.json` rather than overwriting the previous record.

## Checklist

1. Contract published and the address recorded.
2. Source digest recorded and matching `npx tsx scripts/verify.ts`.
3. Four walkthroughs completed from `docs/LIVE-TESTING.md`: ready, blocked, review, cancelled.
4. `fills` entries in `deployment.json` point at real plan references.
5. Evidence recorded in `evidence/live.json` and replayed successfully.
