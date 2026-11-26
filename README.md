# CadenceGate

Source-grounded cadence planning with independently approved allowance schedules on GenLayer.

A team agrees on **when** a shared batch of API work may run. CadenceGate reads one fixed public document, asks the
network to interpret it independently, computes the earliest feasible first-in-first-out schedule for the documented
allowance, and lets each named member sign that exact schedule with a separate wallet.

- Live contract: `0xBCA8c56FD5D2f8dcABA997FDc601b0A4E5CF2E32` on chain `61999`
- Release: `cadencegate-2`, reported by the contract itself from `protocol()`
- Source digest: `724f4c1356a5bca47b0683b2c5c9f7fe061543a8b7c6e7093c28a8d5e0a4b8c6`
- Explorer: <https://explorer-studio.genlayer.com/address/0xBCA8c56FD5D2f8dcABA997FDc601b0A4E5CF2E32>
- Release identity: [deployment.json](deployment.json) · [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)
- How the protocol works: [docs/PROTOCOL.md](docs/PROTOCOL.md)
- Walkthrough against the live contract: [docs/LIVE-TESTING.md](docs/LIVE-TESTING.md)
- Interface: one static, self-contained bundle in `dist/`

## What it does

1. **Seal.** Two to four wallets, one requester class, one allowance basis, one maximum window and a strictly ordered
   list of batches are frozen under a plan reference.
2. **Assess.** The network reads one fixed public document, extracts the documented allowance for the chosen requester
   class, and validators check it independently before the contract computes the schedule.
3. **Approve.** A feasible assessment produces a schedule and a binding fingerprint. Every member approves that exact
   fingerprint with their own wallet.
4. **Commit.** The final distinct approval commits the plan. The committed record is public and readable by anyone.

Three outcomes are possible: `READY` (feasible), `BLOCKED` (does not fit the window) and `REVIEW` (the allowance basis
cannot be proven from a public document).

## Repository layout

```
contracts/cadencegate.py     the deployed GenLayer contract
sdk/                         typed client, config resolution and the shared scheduler mirror
scripts/                     deploy, live walkthrough, read-only verification, payload validation
samples/                     payloads for the live walkthrough, each with its expected outcome
templates/                   plan, deployment, env and evidence templates
docs/                        protocol, live testing, deployment and address management
tests/                       contract unit tests and SDK tests
evidence/                    release evidence produced by a live walkthrough
src/                         the interface
```

## Quick start

```sh
npm ci
npx tsc --noEmit
npm run build
```

The build produces a single self-contained bundle in `dist/`. Open it with any static server:

```sh
npx serve dist
```

The bundle already targets the deployed contract above. To point it somewhere else, see
[docs/CONTRACT-ADDRESSES.md](docs/CONTRACT-ADDRESSES.md).

## Tests

```sh
python3 -m unittest discover -s tests        # contract guards, policy validator, scheduler
npx tsx --test tests/sdk.test.ts             # shared scheduler mirror and SDK helpers
```

The Python suite loads `contracts/cadencegate.py` through a stub runtime and proves the pure logic without a node:
input guards, policy grounding, conservation of credit, FIFO ordering and the exact excess of a blocked plan.

## Live contract testing

Read `docs/LIVE-TESTING.md` before you start. The short version:

1. Set the address: `export CADENCEGATE_ADDRESS=0xBCA8c56FD5D2f8dcABA997FDc601b0A4E5CF2E32`
2. Validate every payload: `npx tsx scripts/schema.ts`
3. Open the interface, seal a roster, assess it, then approve it from every member wallet.
4. Record each hash in `evidence/receipts/`.
5. Replay: `npx tsx scripts/verify.ts`

`samples/` contains four payloads, one per outcome, and each `_expected` block states what the contract must return.

## Wallet and network

Connecting asks the wallet for an account, then checks `eth_chainId` against `61999`. If it differs, the interface
requests a network switch and adds Studionet first when the wallet has never seen it. It re-reads `eth_chainId`
afterwards and fails closed if the wallet still reports another chain, so nothing is ever signed against the wrong
network. The account panel offers the same switch by hand.

The published address must keep its exact casing: the GenLayer node resolves contracts case-sensitively.

## Fees

Studionet charges a fee on every write. The interface estimates it with the network for the exact call you are about to
make, then passes the resulting distribution and value with the transaction, so the estimate and the write can never
disagree. A wallet with no GEN fails at the estimate step, before anything is signed. The built-in faucet in the Studio
account selector tops an account up for free.

## Changing the contract address

No file hard-codes a contract address. One registry resolves it for every read, write, script and test, in this
order: explicit argument, `CADENCEGATE_ADDRESS`, `CONTRACT_ADDRESS`, `VITE_CADENCEGATE_ADDRESS`, `deployment.json`,
then the value typed into the in-app deployment panel.

Change it in the shell:

```sh
export CADENCEGATE_ADDRESS=0xYourOtherDeployment
npx tsx scripts/verify.ts
```

Change it in a running interface: open the deployment panel from the top bar, paste the address, choose **Apply
target**. Every panel follows immediately, with no rebuild. See
[docs/CONTRACT-ADDRESSES.md](docs/CONTRACT-ADDRESSES.md).

## Publish to GitHub

```sh
git init
git add .
git commit -m "CadenceGate: source-grounded cadence planning on GenLayer"
git branch -M main
git remote add origin https://github.com/<your-account>/cadencegate-genlayer.git
git push -u origin main
```

If the repository already exists, replace the last two commands with `git push -u origin main`.

Enable Pages from `gh-pages` after a build, or use the GitHub Actions workflow in `.github/workflows/` to build on
every push and publish `dist/`.

## Publish to Vercel

No database, no serverless functions and no environment variables are required at runtime: the contract address is
already baked into the bundle.

1. Push the repository to GitHub, then import it in Vercel.
2. Leave the framework preset on **Vite**.
3. Build command: `npm run build`
4. Output directory: `dist`
5. Root directory: leave blank.
6. Environment variables: none required. Add `VITE_CADENCEGATE_ADDRESS` only if you want the deployment to target a
   different contract than the one recorded in `src/config/contracts.ts`.

Local preview of exactly what Vercel will serve:

```sh
npm run build && npx serve dist
```

## License

ISC.
