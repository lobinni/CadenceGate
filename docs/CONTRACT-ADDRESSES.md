# Changing the contract address

This repository never hard-codes a contract address. One registry resolves the address for every read, every write,
every script and every test, so moving to a new deployment is a one-line change.

## Where the address comes from

Resolution stops at the first non-empty value:

| Priority | Source | Scope |
| --- | --- | --- |
| 1 | Explicit argument to a helper or script | That one call |
| 2 | `CADENCEGATE_ADDRESS` environment variable | The whole shell session, interface and scripts |
| 3 | `CONTRACT_ADDRESS` environment variable | Same, only when the first is unset |
| 4 | `VITE_CADENCEGATE_ADDRESS` | Interface build only |
| 5 | `contracts.cadenceGate.address` in `deployment.json` | Committed release record |
| 6 | The value typed into the in-app deployment panel | Stored locally, overrides the build default |
| 7 | Empty, meaning "not deployed yet" | The interface shows a warning instead of writing |

## The modules that own resolution

- `sdk/config.ts` — `resolveAddress()` for scripts, tests and the SDK.
- `src/config/contracts.ts` — the browser registry, with `deployment.address()` as the only accessor.

No component, hook or script reads an address from anywhere else. If you search the codebase for a `0x` literal you
will only find documentation and templates.

## Swapping a deployment

### In the shell

```sh
export CADENCEGATE_ADDRESS=0xNewDeployment
npx tsx scripts/verify.ts
```

### In a running interface

Open the deployment panel from the top bar, paste the new address, and choose **Apply target**. Every panel re-reads
the registry immediately, without a rebuild and without reloading the page. **Reset registry** removes the override.

### At build time

```sh
VITE_CADENCEGATE_ADDRESS=0xNewDeployment npm run build
```

### For a fresh release record

```sh
cp templates/deployment.template.json deployment.json
```

Then fill `contracts.cadenceGate.address`, `sourceSha256` and the four `fills` entries as you complete the walkthrough
in `docs/LIVE-TESTING.md`.

## Keep the published casing

The GenLayer node looks a contract up case-sensitively. Every resolver in this repository therefore validates an
address but never rewrites it, so `0xBCA8c56FD5D2f8dcABA997FDc601b0A4E5CF2E32` stays exactly as published. Pasting a
lower-cased copy makes every read and write report the contract as missing.

Case-insensitive comparison is used only where identities are matched against each other, such as member approvals,
because the contract itself normalises those to lower case.

## Multi-contract layouts

The registry is keyed, not singular. Adding a second contract means adding one entry to
`src/config/contracts.ts` and one to `sdk/config.ts`; every call site already passes a `contractKey`.

## What to check after a swap

1. The top bar shows the new address.
2. `npx tsx scripts/schema.ts` still passes, because payload rules are independent of the deployment.
3. `npx tsx scripts/verify.ts` passes against the new address, which proves the release identity and the recorded evidence
   agree.
4. If you keep several deployments, record each one in its own manifest rather than editing one file back and forth.
