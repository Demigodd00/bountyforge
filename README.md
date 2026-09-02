# BountyForge

AI-adjudicated open-source bounties, settled on GenLayer.

[![BountyForge CI](https://github.com/Demigodd00/bountyforge/actions/workflows/ci.yml/badge.svg)](https://github.com/Demigodd00/bountyforge/actions/workflows/ci.yml)

- Live app: [bountyforge-web.vercel.app](https://bountyforge-web.vercel.app)
- Explore bounties: [bountyforge-web.vercel.app/bounties](https://bountyforge-web.vercel.app/bounties)
- Create bounty: [bountyforge-web.vercel.app/post](https://bountyforge-web.vercel.app/post)
- Wallet dashboard: [bountyforge-web.vercel.app/dashboard](https://bountyforge-web.vercel.app/dashboard)
- Protocol console: [bountyforge-web.vercel.app/admin](https://bountyforge-web.vercel.app/admin)
- StudioNet contract: `0xf650cB608E02Ec03A0e524078A14C504b56e5c5B`
- Contract version: `3.1.0`
- Frontend release: `3.2.0`

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

Frontend release 3.2 separates the landing page, marketplace, creation flow, dashboard, and bounty details into dedicated routes. It discovers MetaMask with EIP-6963 when multiple wallets are installed, restores an already-authorized wallet without another prompt, and includes a transaction `value` field only for `deposit`. Every business action, including the five-argument `create_bounty`, omits attached GEN and spends recoverable app credit.

## Verified hosted lifecycle

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

Never put a private key in the frontend, Vercel, source files, issues, or chat. The frontend needs only the public contract address.

## Documentation

- [Architecture](docs/architecture/bountyforge.md)
- [Deployment runbook](docs/BOUNTYFORGE_DEPLOYMENT.md)
- [Release review](docs/BOUNTYFORGE_REVIEW.md)
- [Steward resubmission response](docs/BOUNTYFORGE_RESUBMISSION.md)
- [GenLayer submission](docs/BOUNTYFORGE_SUBMISSION.md)

## StudioNet acceptance

BountyForge end-to-end validation passed.
