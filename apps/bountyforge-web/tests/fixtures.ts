import { Address, BountyView, ClaimView, ProtocolConfig } from "../src/lib/policy";

export const SPONSOR: Address = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
export const HUNTER: Address = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
export const OTHER: Address = "0xcccccccccccccccccccccccccccccccccccccccc";
export const HASH = "0x" + "d".repeat(64);
export const config: ProtocolConfig = {
  version: "3.1.0", evidence_schema: "bountyforge-evidence-v3", funding_model: "WITHDRAWABLE_DEPOSIT_CREDIT_V1",
  adjudication_policy: "COMPARATIVE_CONSENSUS_ON_VERIFIED_IMMUTABLE_EVIDENCE",
  treasury: SPONSOR, fee_bps: "0", claim_stake_atto: "1000000000000000",
  min_pot_atto: "1000000000000000", max_pot_atto: "100000000000000000000",
  min_title_chars: "3", max_title_chars: "80", min_criteria_chars: "20", max_criteria_chars: "600",
  min_statement_chars: "10", max_statement_chars: "600", max_url_chars: "200",
  min_deadline_lead_secs: "300", max_deadline_secs: "31536000", max_claims_per_bounty: "8",
  max_page_size: "25", review_window_secs: "86400", appeal_window_secs: "86400",
  challenge_window_secs: "3600", max_patch_files: "8", max_patch_chars: "6000",
  max_pr_body_chars: "2500", max_issue_body_chars: "4000",
};

export function bounty(overrides: Partial<BountyView> = {}): BountyView {
  return {
    id: "bf-1", sponsor: SPONSOR, title: "Fix dark mode", owner_repo: "acme/widgets", issue_number: "42",
    issue_url: "https://github.com/acme/widgets/issues/42", acceptance_criteria: "Persist the selected theme after a page reload.",
    pot_atto: "1000000000000000000", payout_preview_atto: "1000000000000000000", fee_atto: "0",
    created_at_iso: "2026-08-28T12:00:00Z", deadline_unix: "2000604800", status: "OPEN", claim_count: "0",
    claims_remaining: "8", active_claim_count: "0", has_accepted_claim: false, accepted_claim_index: "",
    winning_hunter: "", next_claim_index: "", review_deadline_unix: "0", awarded_at_unix: "0",
    challenge_deadline_unix: "0", challenged: false, has_open_appeal: false, open_appeal_claim_index: "0",
    cancellable: true, expirable: false, accepting_claims: true, challenge_open: false, finalizable: false, payable: false,
    ...overrides,
  };
}

export function claim(overrides: Partial<ClaimView> = {}): ClaimView {
  return {
    index: "0", bounty_id: "bf-1", bounty_title: "Fix dark mode", hunter: HUNTER,
    pr_url: "https://github.com/acme/widgets/pull/99", pr_number: "99", pr_head_sha: "a".repeat(40), pr_base_sha: "b".repeat(40),
    github_login: "hunter", github_user_id: "123", source_digest: "f".repeat(64), status: "PENDING",
    verdict: "", confidence_bucket: "0", reason: "", stake_atto: "1000000000000000", created_at_iso: "2026-08-28T12:00:00Z",
    rejection_deadline_unix: "0", review_deadline_unix: "2000086400", stake_released: false, appeal_count: "0",
    resolvable: true, timeout_available: false, appealable: false, rejection_closable: false, refundable: false,
    ...overrides,
  };
}
