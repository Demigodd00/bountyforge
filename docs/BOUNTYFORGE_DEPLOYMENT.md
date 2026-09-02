# BountyForge deployment runbook

This runbook separates the one-time contract deployment from public frontend hosting. The frontend is non-custodial and must never receive the deployment private key.

## Current StudioNet deployment

Verified on 2026-09-02:

- App: [bountyforge-web.vercel.app](https://bountyforge-web.vercel.app)
- Read-only protocol console: [bountyforge-web.vercel.app/admin](https://bountyforge-web.vercel.app/admin)
- Contract: `0x7Be34BCded4e2C57bF14F6f9D474eCDAA35e32c8`, version `3.1.0`, on StudioNet.
- Funding: withdrawable app balance; only `deposit()` accepts attached GEN.
- Treasury: `0xA1e3A40bdC63305b5C6fd86276bBE967c5D78698`; fee 0%, challenge/appeal/review windows 5 minutes each.
- Deployment transaction: `0xe3f33b86b2d623595af8b1f3ae483048f792571b3aad3ab9ac2540718f664ea1`, finalized successfully.
- Hosting: the stable production alias tracks `Demigodd00/bountyforge` branch `main`, root `apps/bountyforge-web`. Immutable release build `dpl_8ueoREVY3WUTrESn8s4NKRJJMnsw` is READY; equivalent Git-linked deployments may supersede it at the alias without changing the canonical contract configuration.
- Canonical frontend-client smoke: deposit, zero-value five-argument creation, and cancellation/refund all finalized successfully on this exact address.
- Canonical two-wallet acceptance: `bf-3` is `SETTLED` and claim 0 is `PAID` after public issue/PR evidence, a 100-confidence `FIXES_ISSUE` verdict, challenge-window finalization, and hunter payout. The hunter balance increased by the 0.001 GEN stake plus 0.001 GEN reward; contract balance and both app credits ended at zero.
- Records: `deployments/bounty_forge_studionet.json`, `deployments/bounty_forge_vercel.json`, and `deployments/bounty_forge_acceptance.json`. Prior records are preserved under `deployments/history/`.

This is a StudioNet development release, not a mainnet deployment. Vercel's production URL describes the hosting environment; it does not change the contract's network.

The v3.1 remediation and its verification limits are tracked in [BOUNTYFORGE_REVIEW.md](BOUNTYFORGE_REVIEW.md). A frontend build alone is not approval: verify the current contract version, recoverable funding model, source, and live balance behavior before activating a new address.

## 1. Deploy the GenLayer contract

StudioNet is gasless for deployment. The contract has no admin-only signer privileges, so a disposable deployment signer can preserve your existing wallet as the treasury without using its private key. In PowerShell, from the repository root:

```powershell
$env:BOUNTYFORGE_NETWORK="studionet"
python scripts/deploy_bounty_forge.py 0 300 300 300 --ephemeral-studionet-deployer --treasury 0xA1e3A40bdC63305b5C6fd86276bBE967c5D78698
```

The public treasury receives protocol fees and final rejected stakes; the deployment signer has no retained privilege. Disposable mode is restricted to StudioNet and requires an explicit nonzero public treasury. Without that flag, the script uses `BOUNTYFORGE_PRIVATE_KEY` or hidden input for a recoverable signer. Never paste keys into chat or source files.

The script verifies finalized successful execution, the actual deployed Python source hash, version 3.1, funding model, all windows, fees, and treasury. Only then does it atomically update `deployments/bounty_forge_studionet.json`, archiving the prior public record under `deployments/history/`. It prints the transaction hash before waiting. If a timeout occurs after broadcast, investigate that hash; do not blindly deploy again.

RPC calls reuse a bounded HTTPS session without automatically retrying signed writes. On this Windows host, intermittent unreachable-host errors were resolved with the process-only setting `$env:BOUNTYFORGE_PREFER_IPV4="1"`; it does not change Windows network settings or disable TLS verification.

## 2. Configure the frontend

Create `apps/bountyforge-web/.env.local` locally, or add these as Vercel project environment variables:

```env
NEXT_PUBLIC_BOUNTYFORGE_ADDRESS=0xDEPLOYED_CONTRACT_ADDRESS
NEXT_PUBLIC_NETWORK_NAME=StudioNet
```

Only the public contract address belongs in Vercel. Never add `BOUNTYFORGE_PRIVATE_KEY` to Vercel.

## 3. Deploy to Vercel

Import the repository into Vercel and set:

- Root Directory: `apps/bountyforge-web`
- Framework Preset: Next.js
- Node.js Version: `24.x`
- Install Command: `corepack pnpm install --frozen-lockfile`
- Build Command: `corepack pnpm build`
- Production, Preview, and Development environment variables: the two `NEXT_PUBLIC_` values above plus `ENABLE_EXPERIMENTAL_COREPACK=1` to honor the pinned `pnpm@11.19.0` package manager.

The repository includes `apps/bountyforge-web/vercel.json` with the install and build settings. The explicit Corepack commands use the app-level package-manager pin when the enclosing repository has no root `package.json`. The project `demi17/bountyforge-web` is linked to the repository, and its Root Directory is configured for future Git-based builds. No Git commit or push was performed as part of this deployment.

The first release was uploaded directly from the app folder before configuring the Git Root Directory. For future CLI uploads, stage only the allowlisted app files under `apps/bountyforge-web`, put the project link at the staging root, and inspect that file list before publishing. Vercel CLI 59.9 does not provide a dry-run flag. Do not upload the entire workspace. The app's `.vercelignore` excludes local environment files, dependency folders, and build output. The Vercel CLI may add a local OIDC token to `.env.local`; keep that file private and excluded from uploads and Git.

After a deployment, open the production URL and verify the app loads live bounties, wallet connection switches to StudioNet, and `/admin` loads contract configuration. Loading the page alone does not verify wallet signing or contract write operations.

Run the frontend-compatible canonical smoke before publishing. It verifies the network schema, lifecycle receipts, attached values, and finalized state using the same SDK version as the web app:

```powershell
cd apps/bountyforge-web
$env:NEXT_PUBLIC_BOUNTYFORGE_ADDRESS="0x7Be34BCded4e2C57bF14F6f9D474eCDAA35e32c8"
pnpm verify:studionet
```

## Funding in v3.1

Users need simulated GEN in their StudioNet wallet for deposits (the Studio account selector has a faucet). In a bounty or claim form, **Add GEN** deposits the shortfall to the caller's withdrawable app balance. The form stays open. The user then separately signs the bounty/claim/challenge action, which attaches zero value and spends credit only if validation succeeds. The app exposes **Withdraw unused GEN** for the connected owner.

The production UI now labels these explicitly as **Step 1 · Deposit** and **Step 2 · Post bounty / Submit claim / Challenge award**. A confirmed deposit is recoverable app credit; it does not create a bounty by itself.

The 2026-08-29 hosted acceptance used separate sponsor and hunter wallets. The sponsor funded and created `bf-1`; the hunter deposited the 0.001 GEN stake, submitted public PR #2, received a 90-confidence `FIXES_ISSUE` verdict, waited through the challenge window, finalized, and claimed the reward. Finalized state shows `SETTLED`, a `PAID` claim, zero contract balance, zero hunter app credit, and a 0.002 GEN hunter balance increase from the returned stake plus reward.

Every new write stores its expected method-specific state change. On page load, the UI performs bounded receipt and finalized-state lookups, then clears a saved marker when that exact deposit, withdrawal, bounty, claim, review, appeal, challenge, finalization, payout, cancellation, or expiry effect is already onchain. A stale deposit marker is also reconciled from finalized app credit. Older markers created before this metadata existed can be removed with **Clear saved check** only after the public hash or contract state has been independently verified; the clear operation is hash-matched and does not cancel or retry a transaction. Disabled write buttons state the missing requirement—StudioNet loading, wallet connection, balance loading, or Step 1 funding—instead of appearing unexplained. The StudioNet bounty form defaults to a 0.001 GEN test reward.

Do not send GEN directly to `create_bounty`, `submit_claim`, or `challenge_claim`: they are nonpayable in v3.1. The only payable method is `deposit()`. Failed payable operations on StudioNet were observed to retain attached funds, which is why the release uses this separate, minimal funding entry point. Once a transaction hash has been returned, an unknown confirmation result retains that public hash and blocks another write until its receipt or exact finalized state is checked. Never resubmit merely because StudioNet receipt polling is delayed. If the wallet fails before returning a hash, inspect its activity before retrying.

## 4. Release gate

Before approving a new release:

```powershell
genvm-lint check contracts/bounty_forge.py
pytest tests/direct -q
pytest tests/unit/test_bountyforge_deployment.py -q
gltest tests/integration/test_bounty_forge_studionet.py --network studionet -v -s
cd apps/bountyforge-web
pnpm install --frozen-lockfile
pnpm check
pnpm audit:prod
```

Integration tests assert finality and execution separately and check actual simulated wallet/contract balances. Coverage includes deposit-to-bounty funding, authorized/unauthorized cancellation, expiry, and a real public PR lacking wallet authorization: failed registration must leave prepaid credit withdrawable by its owner while bounty escrow remains intact. They use isolated test actors, not the user's wallet. The exact current release results belong in the review and deployment records.

Wallet connection, bounty creation, claim resolution, appeals, and payout have not been tested end-to-end through this hosted UI in this release verification. Keep the release labeled as StudioNet testing until those user and sponsor flows have been verified; these checks are not a security audit or a guarantee of financial safety.
