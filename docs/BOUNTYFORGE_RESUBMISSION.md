# BountyForge steward resubmission

## What was corrected

The production frontend, CI configuration, deployment records, tests, and reviewer evidence now reference one canonical StudioNet contract: `0xCD7E3bad31F1C26F139907621A569940C2AD70Bd` (version `3.1.1`). Its deployment transaction is `0x35680db1278be15b0841e21ccb995e5cc80b0ba19c6c61ebaad23962489c9184`, finalized with successful execution. The deployed source exactly matches SHA-256 `56de7fb1b41a93bb42de48d43fddbefbf60fbaac340dc17345fa752db6536bb3`.

The frontend verifies all 23 deployed methods before signing. `deposit()` is the only payable method. It waits for finalized successful execution and visible app credit before calling non-payable `create_bounty(title, acceptance_criteria, issue_url, deadline_unix, pot_atto)` with five arguments and no transaction `value`. Receipt handling supports both SDK camel-case and StudioNet snake-case lifecycle fields and verifies the leader execution result. A finalized contract error is never shown as success.

The contract now passes `genvm-lint check` and `genvm-lint typecheck` with zero diagnostics. The mobile `/admin` layout also constrains long onchain addresses to the viewport and has a permanent regression test.

## Canonical frontend-generated proof

The production frontend adapter ran against the exact contract above:

- Deposit: `0x3de624bdf84ab0f8dcbf4c318cb10756fd7eb96cd10884906a70b77b0a71137a`
- Five-argument creation with attached value `0`: `0x10e4607dbc7a53f9b162d824776456b653b3c592694deed72d5d50e4b06e660b`
- Created bounty: `bf-3`
- Cancellation/refund: `0x8f09c329ae1d80cd523814c84d64f44cfbd4d7c2b9ed49192b2ede55e69d1202`
- Result: every write finalized with successful execution; `bf-3` ended `CANCELLED`

## Canonical end-to-end proof

Two disposable StudioNet wallets completed the full workflow against the same contract using public [issue #3](https://github.com/Demigodd00/bountyforge/issues/3) and pinned [PR #4](https://github.com/Demigodd00/bountyforge/pull/4):

| Stage | Transaction |
| --- | --- |
| Sponsor deposit | `0xab5aa4db4035b35edd24d73c11aabe589e230863bb9e77373aebd90b38ac9fcd` |
| Create `bf-4` | `0xf59202e7af58f1d9bfbe77a4e4c87c78848511f2ebd4eaad5986569946629724` |
| Hunter stake deposit | `0xc9178c70052a25573b5b58307e0fbee6eb4467c2ad0b46cc7406f284a23b1705` |
| Capture aligned claim evidence | `0x63aa0c456764ea29dbcdeb161377749012a31118831f0ec18bcf4e8e3d8917cf` |
| GenLayer adjudication | `0x25edc48e489f72dee061ac55f4f94b2192bca041069357565bc160cc677d27e4` |
| Finalize after challenge window | `0x9df8fac04803cf93aa0c6d75c9340b083383fd077239dacbca4413fded72dc99` |
| Hunter payout | `0x95389bbc5086182d02ee47c9d4cd3fa0c8b2b9221de845bf254bf803df6d22c8` |

Every transaction above reached `FINALIZED` with successful leader execution. `create_bounty` and every other non-deposit action attached zero GEN. Issue #3 and PR #4 both name the canonical contract, and evidence pins PR head `337ab6934eb9aafb591eb765cc636f6a0228a17d`. The verdict was `FIXES_ISSUE` at confidence 90. Final state is bounty `SETTLED`, claim 0 `PAID`; the hunter recovered the 0.001 GEN stake and received the 0.001 GEN reward. Both participant app-credit balances are zero and the lifecycle's contract-balance delta is zero.

## Reviewer retest

1. Open `https://bountyforge-web.vercel.app/admin` and confirm the address above, version `3.1.1`, withdrawable app balance, 0% fee, and 300-second review/appeal/challenge windows.
2. Open `https://bountyforge-web.vercel.app/bounties/bf-4` and confirm `SETTLED`, claim 0 `PAID`, and the public issue/PR evidence.
3. Open `https://bountyforge-web.vercel.app/post`, connect MetaMask on StudioNet, complete Step 1 deposit, then Step 2 creation. The second transaction must show 0 GEN attached.
4. Review the contract and deployment in the StudioNet explorer:
   - `https://explorer-studio.genlayer.com/address/0xCD7E3bad31F1C26F139907621A569940C2AD70Bd`
   - `https://explorer-studio.genlayer.com/tx/0x35680db1278be15b0841e21ccb995e5cc80b0ba19c6c61ebaad23962489c9184`

This is a StudioNet test release using simulated GEN, not a mainnet deployment or security-audit claim.
