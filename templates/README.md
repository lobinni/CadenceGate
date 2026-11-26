# Templates

Copy these files rather than editing them in place.

| Template | Copy to | Why |
| --- | --- | --- |
| `plan.template.json` | your own payload file | The exact shape the contract's `seal` method accepts. |
| `deployment.template.json` | `deployment.json` | Starts a clean release record with a fresh address slot. |
| `env.template` | `.env` | Sets the contract address and network for both the interface and the scripts. |
| `evidence-operation.template.json` | `evidence/receipts/<step>.json` | Records one live operation for the read-only verifier to replay. |

## Address precedence

One rule governs the whole repository: no file hard-codes a contract address. When you need to point at a different
deployment, use whichever of these is least disruptive, listed from most to least specific:

1. Pass the address explicitly: `npx tsx scripts/verify.ts -- --address 0x…`
2. Export `CADENCEGATE_ADDRESS` in the shell.
3. Fill `contracts.cadenceGate.address` in `deployment.json`.
4. Type the address into the deployment panel in the interface (stored locally, overrides the build default).

The interface also accepts `VITE_CADENCEGATE_ADDRESS` at build time, which is the right choice when you publish a
static bundle for a specific release.
