# BountyForge: GenLayer Projects submission

## Form values

- Contribution date: `29/08/2026`
- Category: `Projects`
- Title: `BountyForge — AI-Adjudicated GitHub Bounties on GenLayer`
- GitHub evidence: `https://github.com/Demigodd00/bountyforge`
- Live app: `https://bountyforge-web.vercel.app`
- StudioNet contract: `0xf650cB608E02Ec03A0e524078A14C504b56e5c5B`

## Notes / description

BountyForge is a GenLayer-native marketplace that turns public GitHub issues into onchain bounties. Sponsors escrow GEN through a StudioNet Intelligent Contract, while hunters submit a pull request, exact commit SHA, GitHub identity, and wallet marker. GenLayer validators capture immutable GitHub evidence and use comparative consensus to determine whether the work satisfies the acceptance criteria. The contract manages recoverable deposits, claim stakes, FIFO review, appeals, sponsor challenges, finalization, and winner-only payouts. A live two-wallet run created and funded bf-1, verified PR #2, produced a 90-confidence FIXES_ISSUE verdict, survived the challenge window, returned the hunter stake, paid the reward, and reached SETTLED state.

## Verified evidence

- Public release commit: `8262a473fe513134f7ce742be4394825d78f5fce`
- Public CI: `https://github.com/Demigodd00/bountyforge/actions/runs/33267823322` (`passed`)
- Contract version: `3.1.0`
- Funding model: `WITHDRAWABLE_DEPOSIT_CREDIT_V1`
- Live bounty: `bf-1`, `SETTLED`
- Live claim: claim 0, `PAID`
- Verdict: `FIXES_ISSUE`, confidence bucket `90`
- Reward paid: `0.001 GEN`
- Stake returned: `0.001 GEN`
- Final contract balance: `0 GEN`
- Frontend tests: `74 passed` (including multi-wallet selection, passive reconnect, route isolation, and zero-value omission)
- Contract direct tests: `65 BountyForge cases passed`
- StudioNet balance integration tests: `3 passed`
- Production dependency audit: no known vulnerabilities

Detailed machine-readable evidence is in `deployments/bounty_forge_acceptance.json`.

## 2 September steward resubmission

Frontend release 3.2 resolves the requested wallet, navigation, and creation blockers without weakening the contract. MetaMask is discovered through EIP-6963 when other wallets are enabled. The landing page, marketplace, creation form, dashboard, bounty detail, and protocol console now have separate routes. Only `deposit` includes transaction value; `create_bounty` omits `value`, passes all five arguments, and spends the caller's recoverable app balance.

A fresh isolated StudioNet run finalized deposit `0x509692c20f5e995acb0b2e478055bfb43caa48254e8225bab6d349f87c122b6e`, successful creation `0xe84b8d351f61b79592871c859c89148cda4d87108f24992c65b210e5439014c5`, rejected foreign cancellation, successful sponsor refund, and rejected duplicate cancellation. The complete steward response and retest path are in `docs/BOUNTYFORGE_RESUBMISSION.md`.
