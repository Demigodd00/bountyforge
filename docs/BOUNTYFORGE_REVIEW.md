# BountyForge v3.3 steward remediation and release review

Updated: 2026-09-02. Contract v3.1 retains the verified GenLayer protocol. Frontend v3.3 corrects the production contract/ABI mismatch and raw StudioNet receipt handling identified during the second steward review. This remains a StudioNet test release with the acceptance boundary below, not an independent security audit, mainnet approval, or guarantee of financial safety.

## Steward-requested v3.3 remediation

| Steward blocker | v3.3 correction | Permanent proof |
| --- | --- | --- |
| Production still used the prior contract | Deployed one clean canonical contract and pinned its address in Vercel, CI, active deployment records, documentation, and tests | Deployment `0xe3f33b86b2d623595af8b1f3ae483048f792571b3aad3ab9ac2540718f664ea1`; address `0x7Be34BCded4e2C57bF14F6f9D474eCDAA35e32c8` |
| Frontend ABI could drift from the configured address | Read and verify all 23 public method signatures from StudioNet before any write, including payable deposit and non-payable five-argument creation | ABI mismatch regression plus canonical `genlayer-js` schema verification |
| Finalized transactions could appear unresolved | Normalize camel-case SDK receipts and raw snake-case StudioNet receipts; inspect the finalized leader execution result | Raw-success and raw-contract-error regression tests using observed StudioNet receipt shapes |
| Deposit/create sequence was not proven on the production address | Repeatable frontend-client smoke enforces deposit finality and credit before a zero-value create, then verifies state and refund | Deposit `0x7cad…1072`, create `0xa146…31e9`, cancel `0xf047…3cfa`, all finalized successfully on the canonical address |
| Client stopped polling while valid transactions were still accepted | Poll every three seconds for up to 120 attempts and retain the public hash throughout confirmation | Live production-adapter test initially reproduced the timeout at `ACCEPTED`, then passed deposit `0xa27f…c04a`, create `0xfc52…779e`, state reads, and refund `0x02cb…55d8` in 130.43 seconds |

The final canonical two-wallet run used public issue #3 and PR #4. `bf-3` completed sponsor deposit and zero-value creation, hunter deposit and claim, immutable evidence capture, GenLayer review, the full challenge window, permissionless finalization, and hunter-only payout. All seven contract transactions finalized with successful leader execution; the verdict was `FIXES_ISSUE` at confidence 100; final states are `SETTLED` and `PAID`; the hunter received exactly 0.002 GEN; the contract balance returned to zero. Full hashes are recorded in `deployments/bounty_forge_acceptance.json` and `docs/BOUNTYFORGE_RESUBMISSION.md`.

## Historical first steward remediation (v3.2)

| Steward blocker | v3.2 correction | Permanent proof |
| --- | --- | --- |
| Multiple browser wallets conflict | Discover providers through EIP-6963 and legacy provider arrays; select the explicitly announced MetaMask provider; restore authorized sessions without a new access prompt | Tests announce MetaMask and a competing provider together, assert only MetaMask is used, and verify passive session restoration |
| Landing, creation, discovery, and other areas are merged | Dedicated `/`, `/bounties`, `/post`, `/dashboard`, `/bounties/[id]`, and `/admin` routes; old bounty query links redirect to their canonical route | Route-isolation component tests plus the production Next.js route manifest |
| Creation sends GEN to non-payable `create_bounty` | Only `deposit` may carry `value`; non-payable calls omit the field entirely; creation uses five arguments and spends recoverable contract credit | Transaction-adapter tests, a runtime attached-value guard, and finalized StudioNet transaction `0xe84b8d351f61b79592871c859c89148cda4d87108f24992c65b210e5439014c5` |

The two failed review transactions (`0xf8030a1b9063a76a6ee7f3d94d7f546df9d1eab46a30ae729d16fcc03fe3b2b9` and `0xd4ea845ddb764a613984bebea9d00960f3553dc945247eb1c24933cf41a27145`) each carried 1 GEN and supplied the obsolete four-argument call. The active contract correctly rejected both as non-payable. By contrast, the previously completed hosted flow used five arguments, attached 0 GEN, and created `bf-1` successfully in transaction `0xec523a89bd61f5df5c39be6fd68764352d25cbb47dcf00fa31acbd5b32205a8d`. On 2 September, a fresh isolated StudioNet integration repeated deposit → five-argument creation → authorization checks → sponsor refund and passed in 243.45 seconds.

Frontend release gates now pass 74 tests, TypeScript, the optimized production build, and the production dependency audit. GenVM lint, 65 direct contract tests, and 25 deployment-safety tests also pass. See `docs/BOUNTYFORGE_RESUBMISSION.md` for the concise reviewer retest path.

## Implemented remediation

| Finding | v3.1 change | Permanent coverage |
| --- | --- | --- |
| R1: payout roles | Winner-only collection; permissionless finalization; normalized wallet roles | Rendered controls, session propagation, contract payout authorization |
| R2: unauthenticated slot reservation | Validate ownership and complete evidence before storage; stable GitHub identity lock; eight reusable active slots | Copied commits, eight invalid claims, identity races, reusable capacity |
| R3: appeal interference | FIFO queue; head-only review; open appeals block later resolution | Concurrent pending claims, rejection/appeal sequences, rival preservation |
| R4: mutable challenge evidence | Store complete immutable JSON and its hash at submission; every review uses that snapshot | Changed/deleted GitHub after award and during appeal/challenge |
| R5: premature sponsor refund | Active claims block expiry; each head gets a bounded review window; permissionless timeout refunds stake | Deadline crossing, queue advancement, timeout and refund authorization |
| R6: incomplete diff awards | Verify pinned base/head, all file and line counts, and complete patch hunks; reject unsupported evidence before reservation | Missing, binary, oversized, incomplete, empty, and raced evidence |
| R7: invalid form limits | Read policy from the contract and validate before signing | Limits, reward bounds, SHA/URL validation, version guard |
| R8: lost drafts / unsafe retries | Success-only reset, account/network rechecks, pending-hash recovery, duplicate-write lock | Rejected signatures, failed execution, timeout recovery, refresh failure |
| R9: inaccessible later records | Newest-first pagination, total counts, personal views, direct IDs/links, restart on shifted offsets | Beyond page 25, deep links, personal claims, concurrent insertion |
| R10: failed payable calls retained GEN on StudioNet | Minimal deposit entry point, per-wallet withdrawable credit, nonpayable business actions | Invalid claim leaves its prepaid stake withdrawable; ownership, double withdrawal, escrow isolation, explicit two-step UI |

Regression files: `tests/direct/test_bounty_forge.py`, `tests/direct/test_bounty_forge_regressions.py`, `tests/unit/test_bountyforge_deployment.py`, and `apps/bountyforge-web/tests/`.

The deployment script now requires finalized successful execution, exact source, expected settings, and the intended treasury before changing the active address. It preserves previous deployment records. On StudioNet, an explicit public treasury allows a disposable signer with no admin rights and no treasury-key export.

## Verified v3.1 release

- GenVM lint passed: 23 public methods, including 10 views and 13 writes. The concrete runner remains pinned; the newer-runner notice is informational.
- Repository direct tests: 123 passed, including 65 BountyForge cases. Deployment safeguards: 25 passed. Frontend tests: 69 passed. TypeScript, the production build with the new address, and the production dependency audit passed; the audit reported no known vulnerabilities.
- Live StudioNet integration: 3 passed. Tests checked actual wallet and contract balances for cancellation, expiry, and withdrawal of unused credit after a real public PR failed wallet-identity validation. Unauthorized and duplicate withdrawals were rejected; escrow remained isolated.
- Canonical contract: `0x7Be34BCded4e2C57bF14F6f9D474eCDAA35e32c8`, version `3.1.0`. Deployment transaction: `0xe3f33b86b2d623595af8b1f3ae483048f792571b3aad3ab9ac2540718f664ea1`, finalized with successful execution. The deployed source, schema, and requested settings were verified before activation.
- Source SHA-256, with LF normalization: `ff8eeae368d5896eefb1d51eea95781158e9bcd1070aeedc703cd82ee54ca3ca`.
- Treasury is `0xA1e3A40bdC63305b5C6fd86276bBE967c5D78698`; fee is 0%, and challenge/appeal/review windows are five minutes each for StudioNet review. Previous deployment records are preserved under `deployments/history/`.
- Vercel deployment `dpl_83v66nqWUEg9bGpEjUsepS4fPExp` is READY. Both public routes return HTTP 200. The upload contained 18 allowlisted app files, excluding local environment files, keys, dependencies, and unrelated workspace files. No Git commit or push was performed.
- The 2026-08-29 recovery release culminated in Vercel deployment `dpl_j9caajgCTKydGcbrYCVtgJobLyKy`. Every new write now records an exact method-specific state fingerprint and uses bounded receipt plus finalized-state checks, so a successful StudioNet write can recover without a duplicate transaction when receipt polling lags. A hash-matched, user-confirmed clear control handles older markers that predate the fingerprints. All 69 frontend tests, TypeScript, the production build, and the production dependency audit passed; the StudioNet contract address and source are unchanged.
- Final browser and direct contract checks confirmed version 3.1, the intended treasury, funding model, and exactly one live bounty. Separate sponsor and hunter wallets completed the hosted lifecycle for `bf-1`: GenLayer accepted PR #2 with a 90-confidence `FIXES_ISSUE` verdict, the award survived its challenge window, and the hunter finalized payout. Final state is `SETTLED`; claim 0 is `PAID`; the contract balance and hunter app credit are zero. The hunter balance increased by 0.002 GEN during payout, representing the returned 0.001 GEN stake plus the 0.001 GEN reward. No duplicate bounty or claim was created.

Machine-readable results and test transaction hashes are in `deployments/bounty_forge_acceptance.json`; hosting and active-contract records are in `deployments/bounty_forge_vercel.json` and `deployments/bounty_forge_studionet.json`.

## Live-test finding R10 — incoming value is not an EVM-style revert guarantee

The unactivated v3.0 test contract at `0x337F9c2C452D4cE9129E402EB2A650daF123d9ff` rejected a real PR without its required wallet marker. Transaction `0x47eebd698a2c04a5e5e972880b10ae7f3170200113b77d491e1ba1a7e4b15797` finalized with failed execution and no claim reserved, but its attached 0.001 simulated GEN remained in the contract. Checking execution and storage alone would have missed this.

Version 3.1 separates funding from validation. `deposit()` only credits the sender's available balance. Creating a bounty, registering a claim, and challenging an award attach zero value and spend that balance only after their validations succeed. Rejected operations leave credit unchanged; only its owner can withdraw unused credit. Existing escrow cannot be withdrawn through this balance. The UI makes funding an explicit separate step, retains the draft, and never automatically retries a deposit whose result is unknown. The version/funding-model guard prevents an older contract from using this flow.

This addresses normal app operations; it does not promise recovery of arbitrary direct transfers, incorrect manually composed calls, or infrastructure-level failure of a deposit itself. StudioNet funds are simulated.

## Remaining acceptance boundary

The canonical two-wallet happy path is complete on the exact production address: sponsor funding and creation, hunter funding and claim submission, immutable public-PR evidence capture, GenLayer review, challenge-window finalization, and winner payout were all verified against finalized StudioNet state. Live appeal and sponsor-challenge outcomes remain optional extended-path evidence; their contract and UI paths have automated regression coverage. Public GitHub evidence is limited to small, complete text diffs; there is no private-repository support, automated review keeper, or guarantee of model correctness.

## Historical v2 findings

The sections below preserve the original pre-fix review, including its original source line numbers and test results. They describe v2, not the remediated v3 implementation. At that time, only a copy/hosting update had been published and no fixes had been applied.

## High-priority blockers

### R1 — P1: the winning hunter cannot finish settlement through the UI

Source: `apps/bountyforge-web/src/components/BountyForgeApp.tsx:111`; `contracts/bounty_forge.py:674`.

Both “Finalize award” and the payout button are inside the sponsor-only panel. The winning hunter sees neither. The sponsor sees “Pay winning hunter”, but `claim_payout` rejects anyone except the winning hunter. Consequently, the normal two-person lifecycle cannot complete through this app. Isolated component checks reproduced both missing hunter actions; the existing direct contract test confirms the sponsor's payout call reverts.

Required: expose permissionless finalization to connected users and payout to the winning hunter. Normalize wallet addresses when deriving roles. Test distinct sponsor and hunter wallets through actual settlement.

### R2 — P1: unverified submissions can reserve another hunter's commit or exhaust every slot

Source: `contracts/bounty_forge.py:428`, `contracts/bounty_forge.py:440`, and `contracts/bounty_forge.py:466`.

`submit_claim` reserves the PR/commit fingerprint and consumes one of eight slots before checking PR ownership, the actual head, or the wallet marker. Those checks happen later in `resolve_claim`; failure leaves the claim pending and its reservation intact. A different wallet can reserve a legitimate PR's commit first, causing the real author to receive “this PR commit was already submitted”. Eight unverifiable submissions can prevent all legitimate claims until the bounty closes. The initial stakes total 0.008 GEN and can be recovered via pending-claim resolution after expiry, so they are not a lasting penalty.

Required: prevent unauthenticated permanent reservations, provide a terminal invalid-submission path, and prevent invalid attempts from exhausting legitimate claim capacity. Regression-test both copied commits and eight invalid claims.

### R3 — P1: concurrent pending claims can bypass or erase appeal protection

Source: `contracts/bounty_forge.py:477`, `contracts/bounty_forge.py:515`, and `contracts/bounty_forge.py:575`.

New submissions are blocked during an appeal, but previously submitted pending claims can still be resolved. Resolving one as accepted changes the bounty to `AWARDED`, making another hunter's still-open appeal unusable because `appeal_claim` requires `OPEN`. If two pending claims are rejected, the single appeal pointer is overwritten; appealing one can clear `has_open_appeal` while the other is still appealable. Both sequences were reproduced locally.

Required: serialize resolution while an appeal is open, or track every active appeal consistently and gate awards/refunds on that complete state.

### R4 — P1: changing the live PR can disable a sponsor's challenge

Source: `contracts/bounty_forge.py:623` and `contracts/bounty_forge.py:750`.

Challenges re-fetch the current PR and require its current head and wallet marker to match the original claim. After an award, a hunter can change the PR head or remove the marker; the sponsor's challenge then reverts before reviewing the original work, while the award remains eligible for finalization after the window. A changed-head challenge was reproduced. The stored source digest is not an immutable copy of the evidence needed to review the original award.

Required: preserve and adjudicate immutable evidence for the awarded commit, or define a safe dispute outcome when that evidence is unavailable. Do not allow later PR edits to eliminate the original challenge right.

### R5 — P1: a sponsor can refund a bounty before a timely pending claim is reviewed

Source: `contracts/bounty_forge.py:395` and `contracts/bounty_forge.py:483`.

`expire_bounty` checks the deadline and appeal flag, but not unresolved submissions. A hunter can submit before the deadline, then the sponsor can expire the bounty before anyone resolves that claim. The pot is refunded and later resolution cancels the claim instead of evaluating it. The expiry was reproduced with a timely pending submission.

Required: define a bounded resolution/grace/timeout process for timely claims. Simply blocking expiry forever is insufficient because invalid or unavailable evidence also needs an exit path.

### R6 — P1: incomplete diffs can receive definitive awards

Source: `contracts/bounty_forge.py:758`.

The jury receives at most eight files and 6,000 characters; missing patches and remaining files are silently omitted. The contract does not prevent a definitive award when that evidence is incomplete. A nine-file fixture demonstrated that the ninth file never reached the jury prompt, yet a mocked positive verdict produced `ACCEPTED`. This confirms the missing completeness guard, not a prediction that every real model would approve the fixture. The GitHub files endpoint is also paginated, but the implementation fetches only one page. [GitHub's endpoint documentation](https://docs.github.com/en/rest/pulls/pulls#list-pull-requests-files).

Required: verify complete, commit-pinned evidence before accepting an award. Oversized, missing, binary, or truncated evidence needs an explicit safe policy, such as an inconclusive result, rather than silent omission.

## Additional functional defects

### R7 — P2: form limits exceed the contract's accepted limits

Source: `apps/bountyforge-web/src/components/BountyForgeApp.tsx:115` and `apps/bountyforge-web/src/components/BountyForgeApp.tsx:117`.

The title input permits 120 characters while the contract permits 80; acceptance criteria permit 2,000 versus 600; challenge statements permit 1,000 versus 600. A form can therefore pass browser validation and still fail after the user signs. An isolated component check reproduced the title-limit mismatch; the other limits are directly visible in source. Align the limits and validate before requesting a signature.

### R8 — P2: rejected transactions close forms and erase the user's work

Source: `apps/bountyforge-web/src/components/BountyForgeApp.tsx:75`, `apps/bountyforge-web/src/components/BountyForgeApp.tsx:87`, and `apps/bountyforge-web/src/components/BountyForgeApp.tsx:96`.

`run` catches transaction errors without returning failure or rethrowing. The create and claim handlers then close their forms and clear input even when the wallet was rejected or execution failed. An isolated component check reproduced this with a rejected create transaction. Preserve the form and values unless the action actually succeeds.

### R9 — P2: later bounties become unreachable through the marketplace

Source: `apps/bountyforge-web/src/lib/contract.ts:125` and `contracts/bounty_forge.py:964`.

The client always requests offset 0/count 25, discards `total`, and exposes no pagination or direct bounty route. The contract returns creation order. Once there are 26 bounties, newly funded ones do not appear in the app, including for their sponsors. This finding is from the source trace, not a live 26-bounty test. Add paging or a load-more flow, plus direct access to a bounty and personal activity.

## Historical v2 verification and limits

- GenVM lint: passed, 18 public methods. The pinned runner has a newer available version; that warning alone is not a blocker.
- Existing BountyForge direct tests: 22 passed.
- TypeScript check and production build: passed after the copy update. The production dependency audit reported no known vulnerabilities; dependencies were not changed.
- Additional isolated review checks: seven contract safety assertions and four component assertions failed, reproducing the defects above. These files were kept outside the repository; they do not alter the contract or production app behavior.
- The deployed contract source matched local source after normalizing line endings. SHA-256: `83a0f2c2f144a27a3a5376970b0645ee8a98d4d10630a57ba3e83189a1893796`.
- Live read-only calls confirmed contract version 2.0.0 and zero bounties/claims at review time. Both public routes returned HTTP 200.
- The copy update passed local and Vercel production builds and browser checks on the homepage and protocol console. It is live at [BountyForge](https://bountyforge-web.vercel.app). Deployment: `dpl_8noLHF6jjGnpm1bRTQXcG9f4XsK6`. Escrow, stake, wallet-marker, and appeal warnings were retained, and the app is labeled as a test release.
- Direct tests use controlled GitHub/LLM fixtures. They do not prove real hosted consensus, wallet signing, transfer delivery, or economic safety. Existing hosted smoke tests cover cancellation and expiry, not the full claim/dispute/payout lifecycle.

## Historical v2 release gate

Fix R1–R6 before approving the product for broader use; address R7–R9 before onboarding users. Add permanent regressions for these cases, then exercise the full flow with separate sponsor and hunter wallets, including rejection, appeal, challenge, expiry, and actual receipt of payout. Contract fixes will require a new deployment and a corresponding frontend address update; a Vercel-only redeploy cannot repair the currently deployed contract.
