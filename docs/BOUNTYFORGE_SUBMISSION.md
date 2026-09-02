# BountyForge: GenLayer Projects submission

## Form values

- Contribution date: `29/08/2026`
- Category: `Projects`
- Title: `BountyForge — AI-Adjudicated GitHub Bounties on GenLayer`
- GitHub evidence: `https://github.com/Demigodd00/bountyforge`
- Live app: `https://bountyforge-web.vercel.app`
- StudioNet contract: `0x7Be34BCded4e2C57bF14F6f9D474eCDAA35e32c8`

## Notes / description

BountyForge is a GenLayer-native marketplace that turns public GitHub issues into onchain bounties. Sponsors escrow GEN through a StudioNet Intelligent Contract, while hunters submit a pull request, exact commit SHA, GitHub identity, and wallet marker. GenLayer validators capture immutable GitHub evidence and use comparative consensus to determine whether the work satisfies the acceptance criteria. The contract manages recoverable deposits, claim stakes, FIFO review, appeals, sponsor challenges, finalization, and winner-only payouts. A live two-wallet run created and funded bf-1, verified PR #2, produced a 90-confidence FIXES_ISSUE verdict, survived the challenge window, returned the hunter stake, paid the reward, and reached SETTLED state.

## Verified evidence

- Public release commit: `8262a473fe513134f7ce742be4394825d78f5fce`
- Public CI: `https://github.com/Demigodd00/bountyforge/actions/runs/33267823322` (`passed`)
- Contract version: `3.1.0`
- Funding model: `WITHDRAWABLE_DEPOSIT_CREDIT_V1`
- Canonical contract smoke bounty: `bf-1`, `CANCELLED` after verified refund
- Historical full lifecycle on the prior v3.1 deployment: `bf-1` `SETTLED`, claim 0 `PAID`
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

Frontend release 3.3 corrects the production deployment mismatch and the StudioNet receipt-shape bug. Vercel, CI, deployment records, and evidence now use the single canonical contract above. Before signing, the client verifies all 23 deployed methods. It accepts both typed camel-case and raw snake-case receipts and checks the finalized leader execution result. Only `deposit` includes transaction value; `create_bounty` omits `value`, passes all five arguments, and spends the caller's recoverable app balance.

Using the production `genlayer-js` dependency against that exact contract, a fresh StudioNet run finalized deposit `0x7cad6cd1a2920c22e7cf2bb6e5ed9ade9e579ad27ad0ae02c2a9d2d691fd1072`, zero-value successful creation `0xa146fcb6e2919707d09a6d1d6e8620fd8604aa31b041dd147cc175d2dcd031e9`, and successful sponsor refund `0xf047553099eb89e4c0be3abe5df703fa1c51486120887d848ad60d87452e3cfa`. The complete steward response and retest path are in `docs/BOUNTYFORGE_RESUBMISSION.md`.

A second live test imported the production frontend adapter itself and passed deposit `0xa27f4d32be6e5f1642b5dad1b6e59ac7a8a05d3af51156f71f122b13fa02c04a`, five-argument zero-value creation `0xfc521440a9486171c36d689b7154ef8b70b69fc80eaefc987218055c8272779e`, finalized reads of `bf-2`, and cancellation/refund `0x02cbefbce9c97ee86a6cd885458cf86fe9b42406fb2655976e50c200391555d8`. It also permanently covers the raw StudioNet receipt shape and the longer accepted-to-finalized polling window.
