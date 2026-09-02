# BountyForge v3.3 resubmission

## Root cause and correction

The earlier v3.2 response was incomplete: Vercel remained configured for the prior contract while its transaction proof came from a disposable integration deployment. The client also checked only the camel-case receipt properties declared by `genlayer-js`, although StudioNet currently returns raw lifecycle and leader execution fields in snake case.

Release 3.3 corrects both problems:

1. The frontend, CI, deployment records, and reviewer evidence all use one canonical StudioNet contract: `0x7Be34BCded4e2C57bF14F6f9D474eCDAA35e32c8`.
2. Before any wallet signature, the frontend reads that address's network schema and verifies all 23 public methods, including payable `deposit()` and non-payable five-argument `create_bounty(title, acceptance_criteria, issue_url, deadline_unix, pot_atto)`.
3. Receipt handling accepts the SDK's typed camel-case form and StudioNet's raw snake-case form, then checks the finalized leader execution result. A finalized contract error is never reported as success.
4. The transaction sequence is enforced as deposit first, wait for finalized successful execution and available credit, then call `create_bounty` with all five arguments and no `value` property.

## Canonical deployment

- Contract: `0x7Be34BCded4e2C57bF14F6f9D474eCDAA35e32c8`
- Deployment: `0xe3f33b86b2d623595af8b1f3ae483048f792571b3aad3ab9ac2540718f664ea1`
- Contract version: `3.1.0`
- Source SHA-256: `ff8eeae368d5896eefb1d51eea95781158e9bcd1070aeedc703cd82ee54ca3ca`
- Funding model: `WITHDRAWABLE_DEPOSIT_CREDIT_V1`
- Treasury: `0xA1e3A40bdC63305b5C6fd86276bBE967c5D78698`
- Challenge, appeal, and review windows: 300 seconds each

The deployment receipt finalized successfully. The deployed source, configuration, treasury, and schema were read back from the same address before activation.

## Frontend-compatible StudioNet proof

The repeatable `pnpm verify:studionet` check uses the production dependency `genlayer-js@1.1.8`, a generated disposable test actor, and the exact request shapes used by the web app. Against the canonical contract it verified:

- Deposit: `0x7cad6cd1a2920c22e7cf2bb6e5ed9ade9e579ad27ad0ae02c2a9d2d691fd1072` — `FINALIZED`, leader execution successful, value `0.001 GEN`.
- Create: `0xa146fcb6e2919707d09a6d1d6e8620fd8604aa31b041dd147cc175d2dcd031e9` — `FINALIZED`, leader execution successful, five arguments, attached value `0 GEN`; finalized state contained `bf-1` and consumed the actor's app credit.
- Cancellation/refund: `0xf047553099eb89e4c0be3abe5df703fa1c51486120887d848ad60d87452e3cfa` — `FINALIZED`, leader execution successful; `bf-1` became `CANCELLED` and its escrow was returned.

The script is at `apps/bountyforge-web/scripts/verify-studionet-flow.mjs` and does not persist or expose its generated private key.

The stronger live test at `apps/bountyforge-web/tests/live/studionet-frontend-flow.test.ts` imports the production frontend adapter itself. On the same canonical address it passed deposit `0xa27f4d32be6e5f1642b5dad1b6e59ac7a8a05d3af51156f71f122b13fa02c04a`, zero-value creation `0xfc521440a9486171c36d689b7154ef8b70b69fc80eaefc987218055c8272779e`, finalized-state reads for `bf-2`, and cancellation/refund `0x02cbefbce9c97ee86a6cd885458cf86fe9b42406fb2655976e50c200391555d8`. This test first exposed the premature polling timeout at `ACCEPTED`; after the fix it completed in 130.43 seconds.

## Reviewer retest

1. Open `https://bountyforge-web.vercel.app/admin` and confirm the contract address above, version 3.1.0, recoverable deposit-credit funding, and 300-second windows.
2. Open `https://bountyforge-web.vercel.app/post` and connect MetaMask on StudioNet.
3. Complete **Step 1 · Deposit** and wait for the displayed app balance.
4. Complete **Step 2 · Create bounty with 0 GEN attached**. The wallet request must show zero attached GEN.
5. Confirm the transaction reaches finalized successful execution and the new bounty opens at `/bounties/bf-N`.

StudioNet uses simulated GEN. BountyForge never requests or stores a private key in the browser, repository, or Vercel.
