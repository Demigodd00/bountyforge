import hashlib
import json
from datetime import datetime, timezone

import pytest

POT = 10**18
STAKE = 10**15
CHALLENGE_WINDOW = 3600
APPEAL_WINDOW = 300
DAY = 86400
TEST_NOW_UNIX = 2_000_000_000

ISSUE_URL = "https://github.com/acme/widgets/issues/42"
PR_URL = "https://github.com/acme/widgets/pull/99"
HEAD_SHA = "a" * 40
BASE_SHA = "b" * 40
GITHUB_LOGIN = "safety-hunter"
TEST_WALLET_MARKERS = (
    "0x2bd806c97f0e00af1a1fc3328fa763a92697c3c8",
    "0x81b637d8fcd2c6da6359e6963113a1170de795e4",
    "0xb9dd960c1753459a78115d3cb845a57d924b6877",
)

ISSUE_JSON = json.dumps(
    {
        "number": 42,
        "title": "Add dark mode toggle",
        "state": "OPEN",
        "body": "The settings screen must offer a persisted dark theme toggle.",
    }
)
PR_JSON = json.dumps(
    {
        "title": "Add dark mode toggle",
        "state": "open",
        "merged": False,
         "body": "Implements the persisted theme switch.\nBountyForge-Wallet: 0x0000000000000000000000000000000000000000",
         "user": {"login": GITHUB_LOGIN},
         "head": {"sha": HEAD_SHA},
    }
)
FILES_JSON = json.dumps(
    [
        {
            "sha": "c" * 40,
            "filename": "src/settings.ts",
            "status": "added",
            "additions": 1,
            "deletions": 0,
            "changes": 1,
            "patch": "@@ -0,0 +1 @@\n+const theme = localStorage.getItem('theme') ?? 'dark'",
        }
    ]
)
DIFF_DIGEST = hashlib.sha256(FILES_JSON.encode("utf-8")).hexdigest()


def _warp_to(direct_vm, unix_ts: int) -> None:
    direct_vm.warp(datetime.fromtimestamp(unix_ts, tz=timezone.utc).isoformat())


def _deadline() -> int:
    return TEST_NOW_UNIX + 7 * DAY


def _deploy(direct_deploy):
    return direct_deploy("contracts/bounty_forge.py", 0, CHALLENGE_WINDOW, APPEAL_WINDOW)


def _deposit(direct_vm, contract, amount):
    direct_vm.value = amount
    contract.deposit()
    direct_vm.value = 0


def _create(direct_vm, contract, sponsor, *, pot=POT, issue_url=ISSUE_URL, deadline=None):
    direct_vm.sender = sponsor
    _deposit(direct_vm, contract, pot)
    bounty_id = contract.create_bounty(
        "Fix dark mode regression",
        "Settings screen must offer a persisted dark theme toggle.",
        issue_url,
        deadline if deadline is not None else _deadline(),
        pot,
    )
    direct_vm.value = 0
    return bounty_id


def _mock_github(direct_vm, hunter=None, *, pr_number=99, login=GITHUB_LOGIN, author_id=123, files=None, pull_overrides=None, issue_overrides=None):
    # gltest 0.29 has no web-only clear method. Replace web fixtures without
    # discarding the independently configured jury response.
    direct_vm._web_mocks.clear()
    direct_vm._web_mocks_hit.clear()
    hunter = hunter if hunter is not None else direct_vm.sender
    body = "Implements the persisted theme switch."
    body += "\nBountyForge-Wallet: 0x" + hunter.hex()
    files = json.loads(FILES_JSON) if files is None else files
    pull = {
            "number": pr_number,
            "title": "Add dark mode toggle",
            "state": "open",
            "merged": False,
            "body": body,
            "user": {"login": login, "id": author_id},
            "head": {"sha": HEAD_SHA},
            "base": {"sha": BASE_SHA, "repo": {"full_name": "acme/widgets"}},
            "changed_files": len(files),
            "additions": sum(f.get("additions", 0) for f in files),
            "deletions": sum(f.get("deletions", 0) for f in files),
        }
    pull.update(pull_overrides or {})
    issue = json.loads(ISSUE_JSON)
    issue.update(issue_overrides or {})
    direct_vm.mock_web(
        r"https://api\.github\.com/repos/acme/widgets/issues/42$",
        {"status": 200, "body": json.dumps(issue)},
    )
    direct_vm.mock_web(
        rf"https://api\.github\.com/repos/acme/widgets/compare/{BASE_SHA}\.\.\.{HEAD_SHA}\?per_page=1&page=1$",
        {"status": 200, "body": json.dumps({"base_commit": {"sha": BASE_SHA}, "merge_base_commit": {"sha": BASE_SHA}, "files": files})},
    )
    direct_vm.mock_web(
        r"https://api\.github\.com/repos/acme/widgets/pulls/\d+$",
        {"status": 200, "body": json.dumps(pull)},
    )


def _mock_verdict(direct_vm, verdict="FIXES_ISSUE", confidence=90, clear=False, hunter=None):
    if clear:
        direct_vm.clear_mocks()
        _mock_github(direct_vm, hunter)
    direct_vm.mock_llm(
        r"open-source bounty jury",
        json.dumps(
            {
                "verdict": verdict,
                "confidence": confidence,
                "reason": "The diff implements the persisted toggle described in the issue.",
            }
        ),
    )


def _submit(direct_vm, contract, hunter, bounty_id, pr_url=PR_URL, value=STAKE):
    direct_vm.sender = hunter
    _deposit(direct_vm, contract, value)
    _mock_github(direct_vm, hunter, pr_number=int(pr_url.rsplit("/", 1)[-1]))
    claim_index = contract.submit_claim(bounty_id, pr_url, HEAD_SHA, GITHUB_LOGIN)
    direct_vm.value = 0
    contract.resolve_claim(bounty_id, claim_index)


def test_create_bounty_is_open_and_indexed(direct_vm, direct_deploy, direct_alice):
    contract = _deploy(direct_deploy)
    bounty_id = _create(direct_vm, contract, direct_alice)

    bounty = contract.get_bounty(bounty_id)
    assert bounty["status"] == "OPEN"
    assert bounty["sponsor"].lower() == "0x" + direct_alice.hex()
    assert bounty["owner_repo"] == "acme/widgets"
    assert bounty["issue_number"] == "42"
    assert bounty["pot_atto"] == str(POT)
    assert bounty["claim_count"] == "0"
    assert bounty["accepting_claims"] is True
    assert bounty["cancellable"] is True

    mine = contract.list_sponsor_bounties("0x" + direct_alice.hex(), 0, 25)
    assert mine["total"] == "1"
    assert mine["items"][0]["id"] == bounty_id


def test_create_bounty_rejects_invalid_input(direct_vm, direct_deploy, direct_alice):
    contract = _deploy(direct_deploy)

    with pytest.raises(Exception, match="pot must be between"):
        _create(direct_vm, contract, direct_alice, pot=10**14)
    _deposit(direct_vm, contract, POT)

    with pytest.raises(Exception, match="title must be"):
        direct_vm.sender = direct_alice
        contract.create_bounty("no", "x" * 30, ISSUE_URL, _deadline(), POT)

    with pytest.raises(Exception, match="only github.com"):
        contract.create_bounty("Valid title", "x" * 30, "https://gitlab.com/a/b/-/issues/1", _deadline(), POT)

    with pytest.raises(Exception, match="expected GitHub format"):
        contract.create_bounty("Valid title", "x" * 30, "https://github.com/acme/widgets/blob/main/x.ts", _deadline(), POT)

    with pytest.raises(Exception, match="deadline is too soon"):
        contract.create_bounty("Valid title", "x" * 30, ISSUE_URL, TEST_NOW_UNIX + 10, POT)

    direct_vm.value = 0


def test_cancel_refunds_and_blocks_double_cancel(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = _deploy(direct_deploy)
    bounty_id = _create(direct_vm, contract, direct_alice)

    direct_vm.sender = direct_bob
    with pytest.raises(Exception, match="only the sponsor can cancel"):
        contract.cancel_bounty(bounty_id)

    direct_vm.sender = direct_alice
    contract.cancel_bounty(bounty_id)
    assert contract.get_bounty(bounty_id)["status"] == "CANCELLED"

    with pytest.raises(Exception, match="no longer open"):
        contract.cancel_bounty(bounty_id)


def test_accepted_claim_full_lifecycle_to_payout(
    direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie
):
    contract = _deploy(direct_deploy)
    bounty_id = _create(direct_vm, contract, direct_alice)
    _mock_github(direct_vm)
    _mock_verdict(direct_vm, verdict="FIXES_ISSUE", confidence=90)

    _submit(direct_vm, contract, direct_bob, bounty_id)

    bounty = contract.get_bounty(bounty_id)
    assert bounty["status"] == "AWARDED"
    assert bounty["has_accepted_claim"] is True
    assert bounty["challenge_open"] is True
    assert int(bounty["challenge_deadline_unix"]) > int(bounty["awarded_at_unix"])

    direct_vm.sender = direct_charlie
    with pytest.raises(Exception, match="challenge window is still open"):
        contract.finalize_bounty(bounty_id)

    _warp_to(direct_vm, TEST_NOW_UNIX + CHALLENGE_WINDOW + 5)
    contract.finalize_bounty(bounty_id)
    assert contract.get_bounty(bounty_id)["status"] == "FINALIZED"

    direct_vm.sender = direct_alice
    with pytest.raises(Exception, match="only the winning hunter"):
        contract.claim_payout(bounty_id)

    direct_vm.sender = direct_bob
    contract.claim_payout(bounty_id)

    bounty = contract.get_bounty(bounty_id)
    assert bounty["status"] == "SETTLED"
    claim = contract.get_claim(bounty_id, 0)
    assert claim["status"] == "PAID"
    stats = contract.get_stats()
    assert stats["total_settled"] == "1"
    assert stats["total_payout_atto"] == str(POT)

    with pytest.raises(Exception, match="payout is not available"):
        contract.claim_payout(bounty_id)


def test_rejected_claim_keeps_bounty_open(
    direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie
):
    contract = _deploy(direct_deploy)
    bounty_id = _create(direct_vm, contract, direct_alice)
    _mock_github(direct_vm)
    _mock_verdict(direct_vm, verdict="NOT_FIXED", confidence=85)

    _submit(direct_vm, contract, direct_bob, bounty_id)
    bounty = contract.get_bounty(bounty_id)
    assert bounty["status"] == "OPEN"
    assert bounty["accepting_claims"] is False
    assert bounty["claim_count"] == "1"
    assert contract.get_claim(bounty_id, 0)["status"] == "REJECTED_PENDING_APPEAL"

    _warp_to(direct_vm, TEST_NOW_UNIX + APPEAL_WINDOW + 5)
    direct_vm.sender = direct_charlie
    contract.release_rejected_stake(bounty_id, 0)

    _mock_verdict(direct_vm, verdict="FIXES_ISSUE", confidence=90, clear=True)
    _submit(direct_vm, contract, direct_charlie, bounty_id, pr_url="https://github.com/acme/widgets/pull/100")
    assert contract.get_bounty(bounty_id)["status"] == "AWARDED"

    stats = contract.get_stats()
    assert stats["total_rejected"] == "1"
    assert stats["total_accepted"] == "1"

    claims = contract.list_hunter_claims("0x" + direct_bob.hex(), 0, 25)
    assert claims["total"] == "1"
    assert claims["items"][0]["status"] == "REJECTED_FINAL"


def test_inconclusive_adjudication_rolls_back(
    direct_vm, direct_deploy, direct_alice, direct_bob
):
    contract = _deploy(direct_deploy)
    bounty_id = _create(direct_vm, contract, direct_alice)
    _mock_github(direct_vm)
    _mock_verdict(direct_vm, verdict="INCONCLUSIVE", confidence=55)

    _submit(direct_vm, contract, direct_bob, bounty_id)

    bounty = contract.get_bounty(bounty_id)
    assert bounty["status"] == "OPEN"
    assert bounty["claim_count"] == "1"
    assert contract.get_claim(bounty_id, 0)["status"] == "INCONCLUSIVE"


def test_hunter_can_appeal_a_rejected_claim(
    direct_vm, direct_deploy, direct_alice, direct_bob
):
    contract = _deploy(direct_deploy)
    bounty_id = _create(direct_vm, contract, direct_alice)
    _mock_verdict(direct_vm, verdict="NOT_FIXED", confidence=85)
    _submit(direct_vm, contract, direct_bob, bounty_id)
    assert contract.get_claim(bounty_id, 0)["status"] == "REJECTED_PENDING_APPEAL"
    assert contract.get_bounty(bounty_id)["has_open_appeal"] is True

    _mock_verdict(direct_vm, verdict="FIXES_ISSUE", confidence=92, clear=True, hunter=direct_bob)
    direct_vm.sender = direct_bob
    contract.appeal_claim(bounty_id, 0)

    assert contract.get_bounty(bounty_id)["status"] == "AWARDED"
    assert contract.get_bounty(bounty_id)["has_open_appeal"] is False
    assert contract.get_claim(bounty_id, 0)["status"] == "ACCEPTED"


def test_inconclusive_challenge_does_not_overturn_award(
    direct_vm, direct_deploy, direct_alice, direct_bob
):
    contract = _deploy(direct_deploy)
    bounty_id = _create(direct_vm, contract, direct_alice)
    _mock_verdict(direct_vm, verdict="FIXES_ISSUE", confidence=90)
    _submit(direct_vm, contract, direct_bob, bounty_id)

    _mock_verdict(direct_vm, verdict="INCONCLUSIVE", confidence=50, clear=True, hunter=direct_bob)
    direct_vm.sender = direct_alice
    _deposit(direct_vm, contract, STAKE)
    with pytest.raises(Exception, match="challenge adjudication was inconclusive"):
        contract.challenge_claim(bounty_id, "The submitted diff does not prove the required behavior.")
    direct_vm.value = 0

    assert contract.get_bounty(bounty_id)["status"] == "AWARDED"
    assert contract.get_bounty(bounty_id)["challenged"] is False


def test_duplicate_pr_commit_cannot_be_claimed_twice(
    direct_vm, direct_deploy, direct_alice, direct_bob
):
    contract = _deploy(direct_deploy)
    bounty_id = _create(direct_vm, contract, direct_alice)
    _mock_github(direct_vm, direct_bob)
    direct_vm.sender = direct_bob
    _deposit(direct_vm, contract, STAKE)
    contract.submit_claim(bounty_id, PR_URL, HEAD_SHA, GITHUB_LOGIN)
    with pytest.raises(Exception, match="already has an active claim|already submitted"):
        contract.submit_claim(bounty_id, PR_URL, HEAD_SHA, GITHUB_LOGIN)
    direct_vm.value = 0


def test_claim_requires_deposited_stake(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = _deploy(direct_deploy)
    bounty_id = _create(direct_vm, contract, direct_alice)
    _mock_github(direct_vm)
    _mock_verdict(direct_vm)

    with pytest.raises(Exception, match="insufficient available balance"):
        _submit(direct_vm, contract, direct_bob, bounty_id, value=STAKE - 1)


def test_pr_from_other_repo_is_rejected_before_adjudication(
    direct_vm, direct_deploy, direct_alice, direct_bob
):
    contract = _deploy(direct_deploy)
    bounty_id = _create(direct_vm, contract, direct_alice)
    _mock_verdict(direct_vm)

    with pytest.raises(Exception, match="not in the bounty repository"):
        _submit(direct_vm, contract, direct_bob, bounty_id, pr_url="https://github.com/other/repo/pull/99")


def test_deadline_gates_new_claims(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = _deploy(direct_deploy)
    deadline = _deadline()
    bounty_id = _create(direct_vm, contract, direct_alice, deadline=deadline)
    _mock_github(direct_vm)
    _mock_verdict(direct_vm)

    _warp_to(direct_vm, deadline + 1)
    with pytest.raises(Exception, match="deadline has passed"):
        _submit(direct_vm, contract, direct_bob, bounty_id)


def test_completed_claims_do_not_exhaust_lifetime_slots(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = _deploy(direct_deploy)
    bounty_id = _create(direct_vm, contract, direct_alice)
    _mock_github(direct_vm)
    _mock_verdict(direct_vm, verdict="NOT_FIXED", confidence=80)

    for index in range(10):
        _submit(direct_vm, contract, direct_bob, bounty_id, pr_url=f"https://github.com/acme/widgets/pull/{99 + index}")
        _warp_to(direct_vm, TEST_NOW_UNIX + (index + 1) * (APPEAL_WINDOW + 10))
        contract.release_rejected_stake(bounty_id, index)
    assert contract.get_bounty(bounty_id)["claim_count"] == "10"
    assert contract.get_bounty(bounty_id)["claims_remaining"] == "8"


def test_sponsor_challenge_overturns_award(
    direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie
):
    contract = _deploy(direct_deploy)
    bounty_id = _create(direct_vm, contract, direct_alice)
    _mock_github(direct_vm)
    _mock_verdict(direct_vm, verdict="FIXES_ISSUE", confidence=90)
    _submit(direct_vm, contract, direct_bob, bounty_id)

    _mock_verdict(direct_vm, verdict="NOT_FIXED", confidence=80, clear=True)
    direct_vm.sender = direct_bob
    _deposit(direct_vm, contract, STAKE)
    with pytest.raises(Exception, match="only the sponsor can challenge"):
        contract.challenge_claim(bounty_id, "The diff never touches the settings screen.")

    direct_vm.sender = direct_alice
    _deposit(direct_vm, contract, STAKE)
    contract.challenge_claim(bounty_id, "The diff never touches the settings screen.")
    direct_vm.value = 0

    bounty = contract.get_bounty(bounty_id)
    assert bounty["status"] == "OPEN"
    assert bounty["has_accepted_claim"] is False
    assert contract.get_claim(bounty_id, 0)["status"] == "OVERTURNED"
    assert contract.get_stats()["total_overturned"] == "1"

    direct_vm.sender = direct_charlie
    with pytest.raises(Exception, match="no provisional award"):
        contract.finalize_bounty(bounty_id)

    _mock_verdict(direct_vm, verdict="FIXES_ISSUE", confidence=95, clear=True)
    _submit(direct_vm, contract, direct_bob, bounty_id, pr_url="https://github.com/acme/widgets/pull/100")
    assert contract.get_bounty(bounty_id)["challenged"] is False
    assert contract.get_claim(bounty_id, 1)["status"] == "ACCEPTED"


def test_upheld_challenge_keeps_award_once(
    direct_vm, direct_deploy, direct_alice, direct_bob
):
    contract = _deploy(direct_deploy)
    bounty_id = _create(direct_vm, contract, direct_alice)
    _mock_github(direct_vm)
    _mock_verdict(direct_vm, verdict="FIXES_ISSUE", confidence=90)
    _submit(direct_vm, contract, direct_bob, bounty_id)

    _mock_verdict(direct_vm, verdict="FIXES_ISSUE", confidence=95, clear=True)
    direct_vm.sender = direct_alice
    _deposit(direct_vm, contract, STAKE)
    contract.challenge_claim(bounty_id, "Please double-check the persistence logic.")
    direct_vm.value = 0
    assert contract.get_bounty(bounty_id)["status"] == "AWARDED"
    assert contract.get_bounty(bounty_id)["challenged"] is True

    with pytest.raises(Exception, match="already used"):
        contract.challenge_claim(bounty_id, "One more look at the persistence logic.")


def test_challenge_window_expiry_blocks_challenges(
    direct_vm, direct_deploy, direct_alice, direct_bob
):
    contract = _deploy(direct_deploy)
    bounty_id = _create(direct_vm, contract, direct_alice)
    _mock_github(direct_vm)
    _mock_verdict(direct_vm, verdict="FIXES_ISSUE", confidence=90)
    _submit(direct_vm, contract, direct_bob, bounty_id)

    _warp_to(direct_vm, TEST_NOW_UNIX + CHALLENGE_WINDOW + 5)
    direct_vm.sender = direct_alice
    _deposit(direct_vm, contract, STAKE)
    with pytest.raises(Exception, match="challenge window has closed"):
        contract.challenge_claim(bounty_id, "Too late to matter but here goes.")


def test_expire_refunds_sponsor_after_deadline(
    direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie
):
    contract = _deploy(direct_deploy)
    deadline = _deadline()
    bounty_id = _create(direct_vm, contract, direct_alice, deadline=deadline)

    direct_vm.sender = direct_charlie
    with pytest.raises(Exception, match="deadline has not passed"):
        contract.expire_bounty(bounty_id)

    _warp_to(direct_vm, deadline + 1)
    contract.expire_bounty(bounty_id)
    assert contract.get_bounty(bounty_id)["status"] == "REFUNDED"

    with pytest.raises(Exception, match="no longer open"):
        contract.expire_bounty(bounty_id)

    _mock_github(direct_vm)
    _mock_verdict(direct_vm)
    with pytest.raises(Exception, match="no longer accepting claims"):
        _submit(direct_vm, contract, direct_bob, bounty_id)


def test_validator_agrees_on_same_verdict_with_different_reason(
    direct_vm, direct_deploy, direct_alice, direct_bob
):
    contract = _deploy(direct_deploy)
    bounty_id = _create(direct_vm, contract, direct_alice)
    _mock_github(direct_vm)
    _mock_verdict(direct_vm, verdict="FIXES_ISSUE", confidence=90)
    _submit(direct_vm, contract, direct_bob, bounty_id)

    direct_vm.clear_mocks()
    _mock_github(direct_vm)
    _mock_verdict(direct_vm, verdict="FIXES_ISSUE", confidence=92)
    assert direct_vm.run_validator() is True


def test_validator_disagrees_on_conflicting_verdicts(
    direct_vm, direct_deploy, direct_alice, direct_bob
):
    contract = _deploy(direct_deploy)
    bounty_id = _create(direct_vm, contract, direct_alice)
    _mock_github(direct_vm)
    _mock_verdict(direct_vm, verdict="FIXES_ISSUE", confidence=90)
    _submit(direct_vm, contract, direct_bob, bounty_id)

    direct_vm.clear_mocks()
    _mock_github(direct_vm)
    _mock_verdict(direct_vm, verdict="NOT_FIXED", confidence=90)
    assert direct_vm.run_validator() is False


def test_validator_disagrees_when_confidence_buckets_diverge(
    direct_vm, direct_deploy, direct_alice, direct_bob
):
    contract = _deploy(direct_deploy)
    bounty_id = _create(direct_vm, contract, direct_alice)
    _mock_github(direct_vm)
    _mock_verdict(direct_vm, verdict="FIXES_ISSUE", confidence=90)
    _submit(direct_vm, contract, direct_bob, bounty_id)

    direct_vm.clear_mocks()
    _mock_github(direct_vm)
    _mock_verdict(direct_vm, verdict="INCONCLUSIVE", confidence=40)
    assert direct_vm.run_validator() is False


def test_validator_rejects_leader_error_while_own_fetch_succeeds(
    direct_vm, direct_deploy, direct_alice, direct_bob
):
    contract = _deploy(direct_deploy)
    bounty_id = _create(direct_vm, contract, direct_alice)
    _mock_github(direct_vm)
    _mock_verdict(direct_vm, verdict="FIXES_ISSUE", confidence=90)
    _submit(direct_vm, contract, direct_bob, bounty_id)

    assert direct_vm.run_validator(leader_error=Exception("[TRANSIENT] github down")) is False


def test_config_exposes_policy_and_limits(direct_deploy):
    contract = _deploy(direct_deploy)
    config = contract.get_config()
    assert config["version"] == "3.1.0"
    assert config["review_window_secs"] == str(DAY)
    assert config["max_title_chars"] == "80"
    assert config["max_criteria_chars"] == "600"
    assert config["max_statement_chars"] == "600"
    assert config["fee_bps"] == "0"
    assert config["challenge_window_secs"] == str(CHALLENGE_WINDOW)
    assert config["claim_stake_atto"] == str(STAKE)
    assert config["max_claims_per_bounty"] == "8"
    assert config["supported_host"] == "https://github.com/"
