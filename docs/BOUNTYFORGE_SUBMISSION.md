# BountyForge GenLayer Projects submission

Use the clean URLs below. Do not submit a Vercel URL containing an obsolete `?release=` query.

## Copy-paste form values

- Category: `Projects`
- Contribution date: `29/08/2026` (retain the original date when resubmitting the existing contribution)
- Title: `BountyForge — AI-Adjudicated GitHub Bounties on GenLayer`
- Required GitHub repository: `https://github.com/Demigodd00/bountyforge`

Notes / Description (under 1,000 characters):

> BountyForge is a StudioNet dApp for AI-adjudicated public GitHub bounties. Sponsors deposit recoverable app credit, create issue-linked escrows, and hunters bind a pinned PR commit to their wallet. The Intelligent Contract captures immutable GitHub evidence, uses comparative validator consensus to assess every acceptance criterion, supports FIFO claims, bounded review, appeals/challenges, permissionless finalization, and winner-only payout. Release 3.4 uses canonical contract 0xCD7E3bad31F1C26F139907621A569940C2AD70Bd; only deposit is payable and create_bounty is a five-argument zero-value call. Canonical frontend smoke completed creation/refund. Canonical two-wallet proof bf-4 reached SETTLED, claim 0 reached PAID, verdict FIXES_ISSUE (90), participant credits ended at 0, and lifecycle balance delta was 0. StudioNet uses simulated GEN only. Retest guide: https://github.com/Demigodd00/bountyforge/blob/main/docs/BOUNTYFORGE_RESUBMISSION.md

## Add these five evidence items

1. GitHub Repository: `https://github.com/Demigodd00/bountyforge`
2. Live Product: `https://bountyforge-web.vercel.app`
3. Intelligent Contract: `https://explorer-studio.genlayer.com/address/0xCD7E3bad31F1C26F139907621A569940C2AD70Bd`
4. Deployment Transaction: `https://explorer-studio.genlayer.com/tx/0x35680db1278be15b0841e21ccb995e5cc80b0ba19c6c61ebaad23962489c9184`
5. Settled Lifecycle: `https://bountyforge-web.vercel.app/bounties/bf-4`

CI is linked by the repository badge and can also be reviewed at `https://github.com/Demigodd00/bountyforge/actions/workflows/ci.yml`.

## Verified release facts

- Network: StudioNet, chain ID 61999, simulated GEN only
- Contract: `0xCD7E3bad31F1C26F139907621A569940C2AD70Bd`, version `3.1.1`
- Contract source SHA-256: `56de7fb1b41a93bb42de48d43fddbefbf60fbaac340dc17345fa752db6536bb3`
- Frontend: `3.4.0`
- Verified app source: `d43c3a62d14a8f6c00442efa80887eb58ac22de6`; [CI passed](https://github.com/Demigodd00/bountyforge/actions/runs/33664417621); Vercel deployment `dpl_7RLEkc7TfN3662ZiKcw8TDnzww2g` is `READY`
- Canonical lifecycle: `bf-4 SETTLED`; claim 0 `PAID`; `FIXES_ISSUE`, confidence 90
- Local gates: GenVM lint and typecheck; 65 direct tests; 25 deployment tests; 79 frontend tests; TypeScript; production build; dependency audit
- Live adapter gate: deposit, five-argument zero-value creation, finalized state, and cancellation/refund passed on the canonical contract

The submission is a StudioNet project demonstration, not a mainnet or financial-safety claim.
