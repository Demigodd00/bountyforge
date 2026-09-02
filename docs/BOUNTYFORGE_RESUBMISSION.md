# BountyForge v3.2 resubmission

## What changed

1. Wallet connection now uses EIP-6963 provider discovery and selects the explicitly announced MetaMask provider when other browser wallets are enabled. Authorized sessions restore without another permission prompt.
2. Product areas are separate: landing `/`, marketplace `/bounties`, creation `/post`, wallet dashboard `/dashboard`, bounty detail `/bounties/[id]`, and protocol status `/admin`.
3. Only `deposit` can include GEN in the transaction request. `create_bounty` and every other non-payable method omit `value`; a runtime guard rejects any accidental attached value. Creation passes the required five arguments and debits recoverable app credit.

The contract remains at `0xf650cB608E02Ec03A0e524078A14C504b56e5c5B`, version 3.1.0. No contract replacement was required because the rejected review calls used the obsolete client format; the contract correctly enforced its non-payable interface.

## Reviewer retest

1. Open `https://bountyforge-web.vercel.app/post` with MetaMask and any other wallet extension enabled.
2. Connect MetaMask and fill the bounty form.
3. Select **1 · Deposit** and approve the reward deposit.
4. After the app balance updates, select **2 · Create bounty with 0 GEN attached**. The second wallet request must show 0 GEN.
5. Confirm the new bounty opens at `/bounties/bf-N`; then use `/dashboard` for the sponsor and hunter views.

## Verification

- Frontend: 74 tests, TypeScript, optimized production build, and production dependency audit passed.
- Contract: GenVM lint passed; 65 direct tests and 25 deployment-safety tests passed.
- Fresh StudioNet creation: `0xe84b8d351f61b79592871c859c89148cda4d87108f24992c65b210e5439014c5` finalized successfully after a separate deposit.
- Existing full hosted lifecycle: `bf-1` remains `SETTLED`, claim 0 is `PAID`, and the complete sponsor/hunter acceptance record remains in `deployments/bounty_forge_acceptance.json`.

StudioNet uses simulated GEN. BountyForge does not request, store, or deploy private keys in the browser or on Vercel.
