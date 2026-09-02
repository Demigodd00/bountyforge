export type Address = `0x${string}`;
export type ProtocolConfig = Record<string, string>;
export type Page<T> = { items: T[]; total: number };

export interface BountySummary {
  id: string; sponsor: string; title: string; owner_repo: string; issue_number: string;
  acceptance_criteria?: string; pot_atto: string; deadline_unix: string; status: string; claim_count: string;
}

export interface BountyView extends BountySummary {
  acceptance_criteria: string; issue_url: string; payout_preview_atto: string; fee_atto: string;
  created_at_iso: string; claims_remaining: string; active_claim_count: string;
  has_accepted_claim: boolean; accepted_claim_index: string; winning_hunter: string;
  next_claim_index: string; review_deadline_unix: string; awarded_at_unix: string;
  challenge_deadline_unix: string; challenged: boolean; has_open_appeal: boolean;
  open_appeal_claim_index: string; cancellable: boolean; expirable: boolean;
  accepting_claims: boolean; challenge_open: boolean; finalizable: boolean; payable: boolean;
}

export interface ClaimView {
  index: string; bounty_id: string; bounty_title: string; hunter: string; pr_url: string; pr_number: string;
  pr_head_sha: string; pr_base_sha: string; github_login: string; github_user_id: string;
  source_digest: string; status: string; verdict: string; confidence_bucket: string; reason: string;
  stake_atto: string; created_at_iso: string; rejection_deadline_unix: string; review_deadline_unix: string;
  stake_released: boolean; appeal_count: string; resolvable: boolean; timeout_available: boolean;
  appealable: boolean; rejection_closable: boolean; refundable: boolean;
}

export type CreateInput = { title: string; criteria: string; issueUrl: string; deadlineUnix: number; potAtto: bigint };
export type BountyAction = "cancel" | "expire" | "finalize" | "payout";
export type ClaimAction = "resolve" | "appeal" | "close-appeal" | "timeout" | "refund";

const numericPolicy = [
  "min_title_chars", "max_title_chars", "min_criteria_chars", "max_criteria_chars",
  "min_statement_chars", "max_statement_chars", "max_url_chars", "min_deadline_lead_secs",
  "max_deadline_secs", "max_claims_per_bounty", "max_page_size", "review_window_secs",
  "appeal_window_secs", "challenge_window_secs", "max_patch_files", "max_patch_chars",
];

export function isCompatibleConfig(config: ProtocolConfig | null): boolean {
  return Boolean(config && config.version === "3.1.1"
    && config.funding_model === "WITHDRAWABLE_DEPOSIT_CREDIT_V1"
    && config.evidence_schema === "bountyforge-evidence-v3"
    && config.adjudication_policy === "COMPARATIVE_CONSENSUS_ON_VERIFIED_IMMUTABLE_EVIDENCE"
    && numericPolicy.every((key) => /^\d+$/.test(config[key] ?? "") && Number.isSafeInteger(Number(config[key])) && Number(config[key]) > 0)
    && ["min_pot_atto", "max_pot_atto", "claim_stake_atto"].every((key) => /^\d+$/.test(config[key] ?? "") && BigInt(config[key]) > 0n));
}

export function assertCompatible(config: ProtocolConfig): void {
  if (!isCompatibleConfig(config)) throw new Error("Contract upgrade pending. Transactions are paused.");
}

export function isAddress(value: string): value is Address { return /^0x[0-9a-fA-F]{40}$/.test(value); }
export function sameAddress(a?: string | null, b?: string | null): boolean { return Boolean(a && b && a.toLowerCase() === b.toLowerCase()); }
export function isBountyId(value: string): boolean { return /^bf-[1-9]\d{0,19}$/.test(value); }
export function isCommitSha(value: string): boolean { return /^[0-9a-fA-F]{40}$/.test(value.trim()); }
export function isGithubLogin(value: string): boolean { return /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/.test(value.trim()); }

const issuePattern = /^https:\/\/github\.com\/([A-Za-z0-9][A-Za-z0-9_.-]*)\/([A-Za-z0-9_.-]+)\/issues\/(\d+)\/?$/;
const prPattern = /^https:\/\/github\.com\/([A-Za-z0-9][A-Za-z0-9_.-]*)\/([A-Za-z0-9_.-]+)\/pull\/(\d+)\/?$/;

function githubReference(value: string, pattern: RegExp): RegExpMatchArray | null {
  const cleaned = value.trim();
  const match = cleaned.length <= 200 ? cleaned.match(pattern) : null;
  return match && BigInt(match[3]) > 0n ? match : null;
}

export function isGithubIssueUrl(value: string): boolean { return Boolean(githubReference(value, issuePattern)); }
export function isGithubPrUrl(value: string): boolean { return Boolean(githubReference(value, prPattern)); }
export function shorten(value: string): string { return value.length > 14 ? `${value.slice(0, 7)}…${value.slice(-5)}` : value; }

export function parseGen(value: string): bigint {
  const trimmed = value.trim();
  if (!/^\d+(\.\d{0,18})?$/.test(trimmed)) throw new Error("Enter a GEN amount with at most 18 decimal places.");
  const [whole, fraction = ""] = trimmed.split(".");
  return BigInt(whole) * 10n ** 18n + BigInt(fraction.padEnd(18, "0"));
}

export function formatGen(value: string | bigint, precision = 4): string {
  const atto = typeof value === "bigint" ? value : BigInt(value || "0");
  const whole = atto / 10n ** 18n;
  const fraction = (atto % 10n ** 18n).toString().padStart(18, "0").slice(0, precision).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

export function formatDuration(seconds: string | number): string {
  const value = Number(seconds);
  if (!Number.isFinite(value) || value <= 0) return "—";
  if (value % 86400 === 0) return `${value / 86400}d`;
  if (value % 3600 === 0) return `${value / 3600}h`;
  if (value % 60 === 0) return `${value / 60}m`;
  return `${value}s`;
}

function lengthWithin(value: string, min: string, max: string, label: string): void {
  const length = Array.from(value.trim()).length;
  if (length < Number(min) || length > Number(max)) throw new Error(`${label} must be ${min}–${max} characters.`);
}

export function validateCreateInput(input: CreateInput, config: ProtocolConfig, now = Math.floor(Date.now() / 1000)): void {
  assertCompatible(config);
  lengthWithin(input.title, config.min_title_chars, config.max_title_chars, "Title");
  lengthWithin(input.criteria, config.min_criteria_chars, config.max_criteria_chars, "Criteria");
  if (!isGithubIssueUrl(input.issueUrl)) throw new Error("Enter a public GitHub issue URL.");
  if (input.potAtto < BigInt(config.min_pot_atto) || input.potAtto > BigInt(config.max_pot_atto)) {
    throw new Error(`Reward must be ${formatGen(config.min_pot_atto)}–${formatGen(config.max_pot_atto)} GEN.`);
  }
  const lead = input.deadlineUnix - now;
  if (!Number.isSafeInteger(input.deadlineUnix) || lead < Number(config.min_deadline_lead_secs) || lead > Number(config.max_deadline_secs)) {
    throw new Error("Choose a deadline within the contract's allowed range.");
  }
}

export function validateClaimInput(repo: string, prUrl: string, sha: string, login: string): void {
  const match = githubReference(prUrl, prPattern);
  if (!match) throw new Error("Enter a public GitHub PR URL.");
  if (`${match[1]}/${match[2]}`.toLowerCase() !== repo.toLowerCase()) throw new Error(`Use a PR in ${repo}.`);
  if (!isCommitSha(sha)) throw new Error("Enter the full 40-character head commit SHA.");
  if (!isGithubLogin(login)) throw new Error("Enter a valid GitHub login.");
}

export function validateChallengeInput(statement: string, config: ProtocolConfig): void {
  assertCompatible(config);
  lengthWithin(statement, config.min_statement_chars, config.max_statement_chars, "Challenge");
}

export function bountyActions(bounty: BountyView, address?: string | null): BountyAction[] {
  if (!address) return [];
  const actions: BountyAction[] = [];
  if (bounty.cancellable && sameAddress(bounty.sponsor, address)) actions.push("cancel");
  if (bounty.expirable) actions.push("expire");
  if (bounty.finalizable) actions.push("finalize");
  if (bounty.payable && sameAddress(bounty.winning_hunter, address)) actions.push("payout");
  return actions;
}

export function claimActions(claim: ClaimView, address?: string | null): ClaimAction[] {
  if (!address) return [];
  const actions: ClaimAction[] = [];
  if (claim.resolvable) actions.push("resolve");
  if (claim.appealable && sameAddress(claim.hunter, address)) actions.push("appeal");
  if (claim.rejection_closable) actions.push("close-appeal");
  if (claim.timeout_available) actions.push("timeout");
  if (claim.refundable) actions.push("refund");
  return actions;
}

export function friendlyError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const expected = message.match(/\[EXPECTED\]\s*([^"\n]+)/);
  if (expected?.[1]) return expected[1].trim();
  if (/user rejected|user denied|request rejected|request cancelled/i.test(message)) return "Wallet request cancelled. Your inputs are saved.";
  if (/timeout|timed out/i.test(message)) return "Confirmation is delayed. Check the transaction before retrying.";
  return message.length > 240 ? `${message.slice(0, 237)}…` : message;
}
