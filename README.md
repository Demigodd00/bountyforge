# BountyForge

AI-adjudicated open-source bounties, settled on GenLayer.

[![BountyForge CI](https://github.com/Demigodd00/bountyforge/actions/workflows/ci.yml/badge.svg)](https://github.com/Demigodd00/bountyforge/actions/workflows/ci.yml)

- Live app: [bountyforge-web.vercel.app](https://bountyforge-web.vercel.app)
- Explore bounties: [bountyforge-web.vercel.app/bounties](https://bountyforge-web.vercel.app/bounties)
- Create bounty: [bountyforge-web.vercel.app/post](https://bountyforge-web.vercel.app/post)
- Wallet dashboard: [bountyforge-web.vercel.app/dashboard](https://bountyforge-web.vercel.app/dashboard)
- Protocol console: [bountyforge-web.vercel.app/admin](https://bountyforge-web.vercel.app/admin)
- StudioNet contract: `0x7Be34BCded4e2C57bF14F6f9D474eCDAA35e32c8`
- Contract version: `3.1.0`
- Frontend release: `3.3.0`

> BountyForge is a StudioNet test release using simulated GEN. It is not a mainnet deployment or a guarantee of financial safety.

## What it does

BountyForge turns a public GitHub issue into an onchain bounty:

1. A sponsor deposits recoverable app credit and escrows a reward against an issue.
2. A hunter opens a public pull request and binds its exact head commit and GitHub identity to a wallet marker.
3. GenLayer validators capture a complete, immutable evidence snapshot from GitHub.
4. Comparative consensus judges the saved evidence against the sponsor's acceptance criteria.
5. Appeals and sponsor challenges protect both sides before permissionless finalization.
6. Only the winning hunter can claim the finalized reward and recover the claim stake.

GenLayer is central to the workflow: the Intelligent Contract owns deposits, escrow, evidence capture, validator adjudication, queues, disputes, finality, and payout. The frontend only forms transactions and renders finalized state.

Frontend release 3.3 pins the app to the canonical StudioNet deployment and verifies its complete public schema before allowing a wallet signature. It normalizes both typed camel-case receipts and the raw snake-case lifecycle fields returned by StudioNet, including the leader execution result. Only `deposit` carries GEN; the five-argument `create_bounty` and every other business action omit transaction value and spend recoverable app credit.

The canonical release was exercised with the same `genlayer-js` client used by the web app: deposit `0x7cad6cd1a2920c22e7cf2bb6e5ed9ade9e579ad27ad0ae02c2a9d2d691fd1072`, zero-value creation `0xa146fcb6e2919707d09a6d1d6e8620fd8604aa31b041dd147cc175d2dcd031e9`, and cancellation/refund `0xf047553099eb89e4c0be3abe5df703fa1c51486120887d848ad60d87452e3cfa` all finalized with successful execution.

A separate two-wallet acceptance run completed the full workflow on this exact production contract using public [issue #3](https://github.com/Demigodd00/bountyforge/issues/3) and [PR #4](https://github.com/Demigodd00/bountyforge/pull/4). Bounty `bf-3` progressed through funding, zero-value creation, claim registration, immutable evidence capture, a 100-confidence `FIXES_ISSUE` verdict, the five-minute challenge window, finalization, and hunter payout. Its final state is `SETTLED`; claim 0 is `PAID`; the contract balance returned to zero.

## Historical hosted lifecycle on the prior v3.1 deployment

On 29 August 2026, separate sponsor and hunter wallets completed the full production-frontend flow on StudioNet:

| Evidence | Verified result |
| --- | --- |
| Bounty | `bf-1`, `SETTLED` |
| GitHub evidence | [Issue #1](https://github.com/Demigodd00/bountyforge/issues/1) and [PR #2](https://github.com/Demigodd00/bountyforge/pull/2) |
| Verdict | `FIXES_ISSUE`, confidence bucket `90` |
| Claim | Claim 0, `PAID` |
| Reward | 0.001 GEN paid |
| Stake | 0.001 GEN returned |
| Final contract balance | 0 GEN |

Machine-readable evidence is in [`deployments/bounty_forge_acceptance.json`](deployments/bounty_forge_acceptance.json).

## Repository layout

```text
apps/bountyforge-web/       Next.js wallet-connected dApp
contracts/bounty_forge.py  GenLayer Intelligent Contract
tests/direct/               Deterministic contract and regression tests
tests/integration/          Isolated StudioNet balance tests
tests/unit/                 Deployment safety tests
scripts/                    Verified deployment and runner tooling
deployments/                Active deployment and acceptance records
docs/                       Architecture, review, runbook, and submission copy
```

## Run the contract checks

Python 3.12 is recommended.

```powershell
python -m pip install -r requirements-deploy.txt
python scripts/prepare_gltest_runner.py
genvm-lint check contracts/bounty_forge.py
pytest tests/direct -q
pytest tests/unit/test_bountyforge_deployment.py -q
```

The hosted integration suite deploys isolated contracts and uses simulated StudioNet funds:

```powershell
gltest tests/integration/test_bounty_forge_studionet.py --network studionet -v -s
```

## Run the frontend

```powershell
cd apps/bountyforge-web
corepack pnpm install --frozen-lockfile
Copy-Item .env.example .env.local
# Set NEXT_PUBLIC_BOUNTYFORGE_ADDRESS to the active StudioNet contract.
corepack pnpm dev
```

Release gate:

```powershell
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
corepack pnpm audit:prod
```

Canonical StudioNet transaction smoke test (uses a generated, disposable test actor and simulated GEN):

```powershell
$env:NEXT_PUBLIC_BOUNTYFORGE_ADDRESS="0x7Be34BCded4e2C57bF14F6f9D474eCDAA35e32c8"
corepack pnpm verify:studionet
```

Never put a private key in the frontend, Vercel, source files, issues, or chat. The frontend needs only the public contract address.

## Documentation

- [Architecture](docs/architecture/bountyforge.md)
- [Deployment runbook](docs/BOUNTYFORGE_DEPLOYMENT.md)
- [Release review](docs/BOUNTYFORGE_REVIEW.md)
- [Steward resubmission response](docs/BOUNTYFORGE_RESUBMISSION.md)
- [GenLayer submission](docs/BOUNTYFORGE_SUBMISSION.md)

## StudioNet acceptance

BountyForge end-to-end validation passed.
