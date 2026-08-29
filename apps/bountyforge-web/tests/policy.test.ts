import { describe, expect, it } from "vitest";
import {
  bountyActions, claimActions, isCompatibleConfig, isGithubIssueUrl, isGithubPrUrl,
  parseGen, sameAddress, validateChallengeInput, validateClaimInput, validateCreateInput,
} from "../src/lib/policy";
import { HUNTER, OTHER, SPONSOR, bounty, claim, config } from "./fixtures";

describe("contract policy", () => {
  const now = 2_000_000_000;
  const input = { title: "Fix the theme", criteria: "Persist the selected theme after a reload.", issueUrl: "https://github.com/acme/widgets/issues/42", deadlineUnix: now + 86400, potAtto: 10n ** 18n };
  it("requires the matching evidence schema and complete v3 limits", () => {
    expect(isCompatibleConfig(config)).toBe(true);
    expect(isCompatibleConfig({ ...config, version: "2.0.0" })).toBe(false);
    expect(isCompatibleConfig({ ...config, max_title_chars: "" })).toBe(false);
    expect(isCompatibleConfig({ ...config, evidence_schema: "unknown" })).toBe(false);
  });
  it("aligns all length boundaries with the contract", () => {
    expect(() => validateCreateInput({ ...input, title: "x".repeat(80), criteria: "x".repeat(600) }, config, now)).not.toThrow();
    expect(() => validateCreateInput({ ...input, title: "x".repeat(81) }, config, now)).toThrow("3–80");
    expect(() => validateCreateInput({ ...input, criteria: "x".repeat(601) }, config, now)).toThrow("20–600");
    expect(() => validateChallengeInput("x".repeat(600), config)).not.toThrow();
    expect(() => validateChallengeInput("x".repeat(601), config)).toThrow("10–600");
  });
  it.each([0n, 10n ** 15n - 1n, 100n * 10n ** 18n + 1n])("rejects reward outside contract bounds: %s", (potAtto) => {
    expect(() => validateCreateInput({ ...input, potAtto }, config, now)).toThrow("Reward");
  });
  it.each([NaN, Infinity, now + 299, now + 31536001, now + 86400.5])("rejects invalid deadline %s", (deadlineUnix) => {
    expect(() => validateCreateInput({ ...input, deadlineUnix }, config, now)).toThrow("deadline");
  });
  it("accepts exact monetary and deadline boundaries", () => {
    expect(() => validateCreateInput({ ...input, potAtto: 10n ** 15n, deadlineUnix: now + 300 }, config, now)).not.toThrow();
    expect(() => validateCreateInput({ ...input, potAtto: 100n * 10n ** 18n, deadlineUnix: now + 31536000 }, config, now)).not.toThrow();
  });
  it("validates the PR repository, SHA, and GitHub login before signing", () => {
    expect(() => validateClaimInput("acme/widgets", "https://github.com/ACME/widgets/pull/99/", "a".repeat(40), "valid-hunter")).not.toThrow();
    expect(() => validateClaimInput("acme/widgets", "https://github.com/other/repo/pull/99", "a".repeat(40), "hunter")).toThrow("acme/widgets");
    expect(() => validateClaimInput("acme/widgets", "https://github.com/acme/widgets/pull/99", "bad", "hunter")).toThrow("40-character");
    expect(() => validateClaimInput("acme/widgets", "https://github.com/acme/widgets/pull/99", "a".repeat(40), "@bad")).toThrow("GitHub login");
  });
  it("rejects lookalike hosts, query strings, zero IDs and alternate schemes", () => {
    expect(isGithubIssueUrl("https://github.com/acme/widgets/issues/42/")).toBe(true);
    expect(isGithubPrUrl("https://github.com/acme/widgets/pull/99/")).toBe(true);
    for (const url of ["https://github.com.evil.test/acme/widgets/issues/42", "https://github.com/acme/widgets/issues/0", "http://github.com/acme/widgets/issues/42", "https://github.com/acme/widgets/issues/42?x=1"]) expect(isGithubIssueUrl(url)).toBe(false);
  });
  it("parses GEN without floating-point rounding", () => {
    expect(parseGen("0.001")).toBe(10n ** 15n);
    expect(parseGen("1.000000000000000001")).toBe(10n ** 18n + 1n);
    for (const value of ["-1", "1e6", "Infinity", "0.0000000000000000001"]) expect(() => parseGen(value)).toThrow();
  });
});

describe("wallet roles and timed actions", () => {
  it("only offers payout to the winning hunter, regardless of address case", () => {
    const awarded = bounty({ status: "FINALIZED", cancellable: false, payable: true, winning_hunter: HUNTER.toUpperCase().replace("0X", "0x") });
    expect(bountyActions(awarded, HUNTER)).toEqual(["payout"]);
    expect(bountyActions(awarded, SPONSOR)).toEqual([]);
    expect(bountyActions(awarded, OTHER)).toEqual([]);
    expect(bountyActions(awarded)).toEqual([]);
  });
  it("allows permissionless finalization and sponsor-only cancellation", () => {
    expect(bountyActions(bounty({ cancellable: false, finalizable: true }), OTHER)).toEqual(["finalize"]);
    expect(bountyActions(bounty(), SPONSOR.toUpperCase())).toEqual(["cancel"]);
    expect(bountyActions(bounty(), OTHER)).toEqual([]);
    expect(sameAddress(undefined, undefined)).toBe(false);
  });
  it("gates review, appeal, expiry and timeout using current contract flags", () => {
    expect(claimActions(claim(), OTHER)).toEqual(["resolve"]);
    expect(claimActions(claim())).toEqual([]);
    expect(claimActions(claim({ resolvable: false, appealable: true }), HUNTER)).toEqual(["appeal"]);
    expect(claimActions(claim({ resolvable: false, appealable: true }), OTHER)).toEqual([]);
    expect(claimActions(claim({ resolvable: false, rejection_closable: true }), OTHER)).toEqual(["close-appeal"]);
    expect(claimActions(claim({ resolvable: false, timeout_available: true }), OTHER)).toEqual(["timeout"]);
    expect(claimActions(claim({ resolvable: false, refundable: true }), OTHER)).toEqual(["refund"]);
  });
});
