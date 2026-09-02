# BountyForge release architecture

BountyForge contract v3.1 and frontend v3.3 form a GenLayer-native settlement protocol for public GitHub work. The contract owns recoverable deposits, escrow, verified claim identity, immutable evidence snapshots, validator agreement, FIFO review, appeal/challenge windows, and terminal payout state. The web app forms transactions and displays finalized state; it never decides whether work is complete.

## Recoverable funding

```text
Wallet ── deposit() + GEN ──> owner's available app balance
                              ├─ withdraw_credit() ──> same wallet
                              ├─ create_bounty(..., pot_atto) ──> bounty escrow
                              └─ valid submit/challenge ──> claim stake / challenge bond
                                  rejected validation ──> balance unchanged
```

Only `deposit()` is payable. It performs one deterministic balance credit with no business validation or external requests. All other methods attach zero GEN. Creating a bounty debits the explicit pot from the caller's credit after validation; registration debits the fixed stake only after verified evidence is captured. A decisive challenge spends and returns its bond; an unsuccessful/inconclusive call does not consume its prepaid credit. Only the depositor can withdraw unused credit, and this never includes locked bounty pots or stakes.

This separation is necessary because live StudioNet testing showed attached value could remain in a contract after a rejected payable call. No EVM-style refund assumption is made. The frontend requires version 3.1 and `WITHDRAWABLE_DEPOSIT_CREDIT_V1`, shows the app balance and withdrawal control, and asks for funding as a separate explicit step before the business action. Drafts survive that funding step and any subsequent failed action.

## State flow

```text
OPEN
 ├─ cancel (sponsor, no claims) ───────────────> CANCELLED
 ├─ expire (deadline + empty queue + no appeal) > REFUNDED
 ├─ submit_claim (verified identity + complete immutable evidence)
 │    └─ PENDING (FIFO, at most 8 active slots)
 │         ├─ head review timeout ─────────────> TIMED_OUT + stake refund
 │         └─ resolve_claim (permissionless, head only)
 │              ├─ INCONCLUSIVE ──────────────> terminal + stake refund
 │              ├─ NOT_FIXED ────────────────> REJECTED_PENDING_APPEAL
 │              │    ├─ appeal + FIXES ──────> AWARDED
 │              │    ├─ appeal + NOT_FIXED ──> REJECTED_FINAL
 │              │    └─ window expiry ──────> REJECTED_FINAL
 │              └─ FIXES ───────────────────> AWARDED
 │                                             ├─ challenge + NOT_FIXED -> OPEN
 │                                             ├─ challenge + FIXES -----> AWARDED
 │                                             └─ window expiry ----------> FINALIZED -> SETTLED
```

## User and sponsor boundaries

- Hunters publish exactly one whole-line wallet marker in the PR body and provide the current head SHA. Before storage is reserved, validators check the PR author (including stable numeric GitHub ID), SHA, repository, marker, and evidence completeness. One active claim is allowed per wallet and GitHub author per bounty. Slots are reusable; claim history remains available.
- Sponsors define criteria and fund escrow. They cannot rewrite an adjudication, seize a stake, or bypass a finalized payout. Their only dispute action is a bonded challenge during the explicit challenge window.
- Anyone can review the head claim, refund its stake after a review timeout, close an expired rejection appeal, finalize an award, and expire an eligible bounty. A review or timeout still requires somebody to submit the transaction: this release does not include an automated keeper or notifications.
- The queue cannot advance through an open appeal or provisional award. Rival claims stay pending during a sponsor challenge and become reviewable if the award is overturned. Expiry requires no active claims. The head review window starts when that claim reaches the front, even if the submission deadline has passed.
- The dApp never handles private keys. It discovers injected providers through EIP-6963, deterministically prefers MetaMask when several wallets coexist, and falls back to the legacy provider list. An already-authorized StudioNet session is restored with `eth_accounts`; explicit connection alone uses `eth_requestAccounts`. Before signing, the app rechecks the exact account and network, then waits for finalized successful execution. A confirmation timeout preserves the returned public hash and blocks another write until status is reconciled. If the wallet fails before returning a hash, its activity must be inspected before retrying. Failed forms keep their inputs; confirmed writes are not reported as failed just because refreshing the feed failed.
- Product areas use dedicated routes: `/` for the landing page, `/bounties` for discovery, `/post` for creation, `/dashboard` for wallet activity, `/bounties/[id]` for one bounty, and `/admin` for protocol state. Legacy `?bounty=bf-N` links redirect to the canonical detail route.
- The transaction adapter adds `value` only to `deposit`. It omits the property for `create_bounty` and every other non-payable business method, and a runtime guard rejects any attempted nonzero value outside `deposit`.
- Before any write, the adapter retrieves the configured address's StudioNet schema and verifies every public method name, positional parameter, read/write mode, and payable flag expected by this release.
- Finality handling normalizes both the SDK's camel-case receipt fields and StudioNet's raw snake-case payload, then verifies the leader execution result rather than equating `FINALIZED` with success.
- Only the winning hunter can collect the reward. The sponsor cannot collect on the hunter's behalf. Permissionless finalization and stake-return controls are visible to other connected users when eligible.

## Evidence and consensus

Registration captures the issue, PR metadata, explicit wallet binding, base/head SHAs, and complete text patches from GitHub's immutable commit-comparison endpoint. PR metadata is rechecked after capture to reject an update racing the fetch. Validators independently capture and require the same canonical JSON snapshot. Both that JSON and its SHA-256 digest are stored with the claim.

The supported envelope is deliberately small: eight changed text files, 6,000 total patch characters, bounded issue/PR text and response sizes. File counts, individual and aggregate line counts, and diff hunk lengths must match. Binary, patchless, truncated, and oversized changes fail before a fingerprint or slot is reserved. This is not support for arbitrary-size repositories or executing test suites.

Initial review, appeal, and challenge all judge the saved snapshot without re-fetching GitHub. Later edits, force pushes, or deletion cannot remove the saved evidence or the sponsor's challenge right. The jury treats repository text and dispute statements as data, not instructions. Validators compare verdict, source digest, and confidence bucket; an inconclusive result cannot produce an award. This reduces specific failure modes but is not a guarantee of AI judgment accuracy.

The issue snapshot is captured at claim submission, not bounty creation. The sponsor's on-chain acceptance criteria remain fixed throughout.

## Deployment boundary

Deploy the contract first. Its constructor accepts fee, challenge/appeal/review windows, and an optional explicit public treasury. There are no admin-only methods or retained deployment privileges. A normal deployment uses a recoverable signer; gasless StudioNet additionally supports a disposable deployment-only signer with an explicit treasury. No treasury private key is needed for that mode.

The script verifies successful finalized execution, the deployed source hash, and all selected settings before atomically replacing the active deployment record. Prior public records are archived. Only then update `NEXT_PUBLIC_BOUNTYFORGE_ADDRESS` and deploy the frontend to the existing Vercel project. The frontend requires the current version, evidence schema/policy, and recoverable funding model before enabling writes; older addresses are read-only.

Native GEN transfers to EOAs use GenLayer's external-message EVM interface and execute on finalization. StudioNet simulates balances; it is not the chain-layer delivery guarantee of a funded mainnet release. See [GenLayer value transfers](https://docs.genlayer.com/developers/intelligent-contracts/features/value-transfers).

Redeployment creates a separate contract, not a migration of existing escrow. Check the previous address for live funds/claims and preserve access/history. Never upload wallet keys or local `.env` files to Vercel or Git.
