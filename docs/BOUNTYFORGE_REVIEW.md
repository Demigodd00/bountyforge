# BountyForge release 3.4 review

Verified 2 September 2026 for a GenLayer Projects resubmission.

## Review blockers closed

| Blocker | Correction | Evidence |
| --- | --- | --- |
| Production contract/ABI mismatch | One immutable StudioNet contract is pinned in frontend, CI, docs, and deployment records; the client verifies all 23 methods before signing | Contract `0xCD7E3bad31F1C26F139907621A569940C2AD70Bd`; deployment `0x35680db1278be15b0841e21ccb995e5cc80b0ba19c6c61ebaad23962489c9184` |
| GEN sent to non-payable creation | Two-step flow waits for successful `deposit`, then sends five `create_bounty` arguments and omits `value` | Frontend-generated creation `0x10e4607dbc7a53f9b162d824776456b653b3c592694deed72d5d50e4b06e660b` attached 0 GEN |
| Finalized failures could appear successful | Receipt adapter normalizes both field shapes and requires a successful leader execution result | Wallet-client regression suite and canonical frontend smoke |
| Downstream path was unverified | Fresh two-wallet run completed aligned evidence capture, AI review, challenge window, finalization, and payout | `bf-4 SETTLED`, claim 0 `PAID`; all seven hashes in `BOUNTYFORGE_RESUBMISSION.md` |
| Multiple-wallet provider ambiguity | EIP-6963 discovery selects the explicitly announced MetaMask provider and restores only authorized sessions | Multi-provider and passive-restore frontend tests |
| Product areas were merged into one page | Dedicated `/`, `/bounties`, `/post`, `/dashboard`, `/bounties/[id]`, and `/admin` routes | Route-isolation tests and production build manifest |
| Contract type diagnostics | Optional web response bodies and queued-claim narrowing are explicit; typecheck is mandatory in CI | `genvm-lint typecheck` reports zero diagnostics |
| Mobile admin overflow | Grid children can shrink and long addresses wrap within the card | Responsive CSS regression plus live 375px browser check |
| Stale submission evidence | Current contract, source hash, lifecycle, tests, clean URLs, and copy-paste form text are centralized | `BOUNTYFORGE_SUBMISSION.md` and `deployments/bounty_forge_acceptance.json` |

## Release gates

- Pinned GenVM runner; lint passed with 23 methods (10 view, 13 write)
- GenVM typecheck passed with zero diagnostics
- 65 direct contract tests passed
- 25 deployment-safety tests passed
- 78 frontend tests passed
- TypeScript and optimized seven-route Next.js build passed
- Production dependency audit found no known vulnerabilities
- Canonical frontend adapter smoke passed in 133.78 seconds
- Canonical two-wallet lifecycle passed with exact value conservation and zero residual balance

## Scope

GenLayer owns the escrow, immutable GitHub evidence capture, comparative validator adjudication, queues, disputes, finality, and payout. The frontend only validates input, forms transactions, and renders finalized state. The release supports public GitHub repositories and bounded complete text diffs. It remains a StudioNet demonstration using simulated GEN and is not presented as audited mainnet software.
