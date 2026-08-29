"""Permanent regressions for the v2 release blockers and v3 queue invariants."""

import copy
import hashlib
import json

import pytest

from test_bounty_forge import (
    APPEAL_WINDOW, BASE_SHA, CHALLENGE_WINDOW, DAY, FILES_JSON, GITHUB_LOGIN,
    HEAD_SHA, PR_URL, STAKE, TEST_NOW_UNIX, _create, _deploy, _mock_github,
    _mock_verdict, _submit, _warp_to, _deposit,
)


def register(vm, contract, hunter, bounty_id, *, pr=99, author_id=123, **evidence):
    vm.sender = hunter
    _deposit(vm, contract, STAKE)
    _mock_github(vm, hunter, pr_number=pr, author_id=author_id, **evidence)
    try:
        return contract.submit_claim(bounty_id, f"https://github.com/acme/widgets/pull/{pr}", HEAD_SHA, GITHUB_LOGIN)
    finally:
        vm.value = 0


def test_copied_pr_cannot_reserve_fingerprint_or_any_of_eight_slots(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    contract = _deploy(direct_deploy)
    bounty_id = _create(direct_vm, contract, direct_alice)
    for number in range(99, 107):
        _mock_github(direct_vm, direct_charlie, pr_number=number)
        direct_vm.sender = direct_bob
        _deposit(direct_vm, contract, STAKE)
        with pytest.raises(Exception, match="exactly one BountyForge-Wallet"):
            contract.submit_claim(bounty_id, f"https://github.com/acme/widgets/pull/{number}", HEAD_SHA, GITHUB_LOGIN)
    direct_vm.value = 0
    assert contract.get_bounty(bounty_id)["claim_count"] == "0"
    assert contract.get_bounty(bounty_id)["claims_remaining"] == "8"
    assert contract.list_hunter_claims("0x" + direct_bob.hex(), 0, 25)["total"] == "0"
    assert register(direct_vm, contract, direct_charlie, bounty_id) == "0"


@pytest.mark.parametrize("field,match", [
    ({"head": {"sha": "d" * 40}}, "PR head changed"),
    ({"user": {"login": "impostor", "id": 456}}, "PR author does not match"),
    ({"body": "No wallet authorization."}, "exactly one BountyForge-Wallet"),
    ({"base": {"sha": BASE_SHA, "repo": {"full_name": "other/repo"}}}, "different repository"),
])
def test_invalid_identity_is_atomic(field, match, direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = _deploy(direct_deploy)
    bounty_id = _create(direct_vm, contract, direct_alice)
    with pytest.raises(Exception, match=match):
        register(direct_vm, contract, direct_bob, bounty_id, pull_overrides=field)
    assert contract.get_bounty(bounty_id)["claim_count"] == "0"
    assert register(direct_vm, contract, direct_bob, bounty_id) == "0"


def test_multiple_wallet_markers_are_rejected(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = _deploy(direct_deploy)
    bounty_id = _create(direct_vm, contract, direct_alice)
    body = "\n".join("BountyForge-Wallet: 0x" + account.hex() for account in (direct_alice, direct_bob))
    with pytest.raises(Exception, match="exactly one BountyForge-Wallet"):
        register(direct_vm, contract, direct_bob, bounty_id, pull_overrides={"body": body})


def test_one_active_claim_per_wallet_and_stable_github_identity(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    contract = _deploy(direct_deploy)
    bounty_id = _create(direct_vm, contract, direct_alice)
    register(direct_vm, contract, direct_bob, bounty_id)
    with pytest.raises(Exception, match="wallet already has an active claim"):
        register(direct_vm, contract, direct_bob, bounty_id, pr=100, author_id=124)
    with pytest.raises(Exception, match="GitHub author already has an active claim"):
        register(direct_vm, contract, direct_charlie, bounty_id, pr=100)
    assert register(direct_vm, contract, direct_charlie, bounty_id, pr=100, author_id=124) == "1"


def test_only_active_slots_are_capped(direct_vm, direct_deploy, direct_alice):
    contract = _deploy(direct_deploy)
    bounty_id = _create(direct_vm, contract, direct_alice)
    for number in range(8):
        register(direct_vm, contract, bytes([number + 10]) * 20, bounty_id, pr=99 + number, author_id=100 + number)
    assert contract.get_bounty(bounty_id)["accepting_claims"] is False
    with pytest.raises(Exception, match="active claim slots are occupied"):
        register(direct_vm, contract, bytes([30]) * 20, bounty_id, pr=200, author_id=200)
    _mock_verdict(direct_vm, verdict="INCONCLUSIVE", confidence=50)
    contract.resolve_claim(bounty_id, 0)
    assert contract.get_bounty(bounty_id)["claims_remaining"] == "1"
    assert register(direct_vm, contract, bytes([30]) * 20, bounty_id, pr=200, author_id=200) == "8"


def test_pending_claims_cannot_bypass_or_overwrite_appeals(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    contract = _deploy(direct_deploy)
    bounty_id = _create(direct_vm, contract, direct_alice)
    register(direct_vm, contract, direct_bob, bounty_id)
    register(direct_vm, contract, direct_charlie, bounty_id, pr=100, author_id=124)
    _mock_verdict(direct_vm, verdict="NOT_FIXED")
    contract.resolve_claim(bounty_id, 0)
    for verdict in ("FIXES_ISSUE", "NOT_FIXED"):
        _mock_verdict(direct_vm, verdict=verdict, clear=True)
        with pytest.raises(Exception, match="resolve the open appeal"):
            contract.resolve_claim(bounty_id, 1)
        assert contract.get_claim(bounty_id, 1)["status"] == "PENDING"
        assert contract.get_bounty(bounty_id)["open_appeal_claim_index"] == "0"
    direct_vm.sender = direct_bob
    _mock_verdict(direct_vm, verdict="NOT_FIXED", clear=True)
    contract.appeal_claim(bounty_id, 0)
    contract.resolve_claim(bounty_id, 1)
    with pytest.raises(Exception, match="not appealable"):
        contract.appeal_claim(bounty_id, 0)
    assert contract.get_bounty(bounty_id)["has_open_appeal"] is True
    assert contract.get_bounty(bounty_id)["open_appeal_claim_index"] == "1"


def test_claims_are_reviewed_in_submission_order(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    contract = _deploy(direct_deploy)
    bounty_id = _create(direct_vm, contract, direct_alice)
    register(direct_vm, contract, direct_bob, bounty_id)
    register(direct_vm, contract, direct_charlie, bounty_id, pr=100, author_id=124)
    _mock_verdict(direct_vm)
    with pytest.raises(Exception, match="earlier claim must finish"):
        contract.resolve_claim(bounty_id, 1)
    with pytest.raises(Exception, match="earlier claim must finish"):
        contract.timeout_claim(bounty_id, 1)
    assert contract.get_claim(bounty_id, 1)["review_deadline_unix"] == "0"


def test_queued_claim_survives_challenge_and_gets_fresh_review_window(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    contract = _deploy(direct_deploy)
    bounty_id = _create(direct_vm, contract, direct_alice)
    register(direct_vm, contract, direct_bob, bounty_id)
    register(direct_vm, contract, direct_charlie, bounty_id, pr=100, author_id=124)
    _mock_verdict(direct_vm)
    contract.resolve_claim(bounty_id, 0)
    with pytest.raises(Exception, match="queued claims are preserved"):
        contract.resolve_claim(bounty_id, 1)
    _warp_to(direct_vm, TEST_NOW_UNIX + CHALLENGE_WINDOW - 1)
    _mock_verdict(direct_vm, verdict="NOT_FIXED", clear=True)
    direct_vm.sender = direct_alice
    _deposit(direct_vm, contract, STAKE)
    contract.challenge_claim(bounty_id, "The implementation omits the required persisted toggle.")
    direct_vm.value = 0
    assert contract.get_claim(bounty_id, 1)["resolvable"] is True
    assert int(contract.get_claim(bounty_id, 1)["review_deadline_unix"]) == TEST_NOW_UNIX + CHALLENGE_WINDOW - 1 + DAY


def test_challenge_uses_snapshot_after_pr_and_issue_are_changed_or_deleted(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = _deploy(direct_deploy)
    bounty_id = _create(direct_vm, contract, direct_alice)
    _mock_verdict(direct_vm)
    _submit(direct_vm, contract, direct_bob, bounty_id)
    before = contract.get_claim_evidence(bounty_id, 0)
    direct_vm.clear_mocks()
    direct_vm.mock_web(r".*", {"status": 404, "body": "gone"})
    _mock_verdict(direct_vm, verdict="NOT_FIXED")
    direct_vm.sender = direct_alice
    _deposit(direct_vm, contract, STAKE)
    contract.challenge_claim(bounty_id, "The original code does not implement the required toggle.")
    direct_vm.value = 0
    assert contract.get_claim(bounty_id, 0)["status"] == "OVERTURNED"
    assert contract.get_claim_evidence(bounty_id, 0) == before
    assert direct_vm._web_mocks_hit == set()


def test_appeal_uses_original_evidence_without_refetch(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = _deploy(direct_deploy)
    bounty_id = _create(direct_vm, contract, direct_alice)
    _mock_verdict(direct_vm, verdict="NOT_FIXED")
    _submit(direct_vm, contract, direct_bob, bounty_id)
    before = contract.get_claim_evidence(bounty_id, 0)
    direct_vm.clear_mocks()
    direct_vm.mock_web(r".*", {"status": 500, "body": "unavailable"})
    _mock_verdict(direct_vm)
    direct_vm.sender = direct_bob
    contract.appeal_claim(bounty_id, 0)
    assert contract.get_claim(bounty_id, 0)["status"] == "ACCEPTED"
    assert contract.get_claim_evidence(bounty_id, 0) == before
    assert direct_vm._web_mocks_hit == set()


def test_expiry_cannot_bypass_timely_pending_claim(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = _deploy(direct_deploy)
    bounty_id = _create(direct_vm, contract, direct_alice, deadline=TEST_NOW_UNIX + 300)
    _warp_to(direct_vm, TEST_NOW_UNIX + 299)
    register(direct_vm, contract, direct_bob, bounty_id)
    _warp_to(direct_vm, TEST_NOW_UNIX + 301)
    direct_vm.sender = direct_alice
    assert contract.get_bounty(bounty_id)["expirable"] is False
    with pytest.raises(Exception, match="pending claims before refunding"):
        contract.expire_bounty(bounty_id)
    _mock_verdict(direct_vm)
    contract.resolve_claim(bounty_id, 0)
    assert contract.get_bounty(bounty_id)["status"] == "AWARDED"


def test_review_outage_has_bounded_refund_exit(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = _deploy(direct_deploy)
    bounty_id = _create(direct_vm, contract, direct_alice, deadline=TEST_NOW_UNIX + 300)
    register(direct_vm, contract, direct_bob, bounty_id)
    with pytest.raises(Exception, match="review window is still open"):
        contract.timeout_claim(bounty_id, 0)
    _warp_to(direct_vm, TEST_NOW_UNIX + DAY + 1)
    assert contract.get_claim(bounty_id, 0)["timeout_available"] is True
    with pytest.raises(Exception, match="review window expired"):
        contract.resolve_claim(bounty_id, 0)
    direct_vm.sender = direct_alice
    contract.timeout_claim(bounty_id, 0)
    assert contract.get_claim(bounty_id, 0)["stake_released"] is True
    assert contract.get_bounty(bounty_id)["active_claim_count"] == "0"
    with pytest.raises(Exception, match="not awaiting review"):
        contract.timeout_claim(bounty_id, 0)
    contract.expire_bounty(bounty_id)
    assert contract.get_bounty(bounty_id)["status"] == "REFUNDED"


def test_losing_queue_stakes_are_refundable_only_after_finalization(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    contract = _deploy(direct_deploy)
    bounty_id = _create(direct_vm, contract, direct_alice)
    register(direct_vm, contract, direct_bob, bounty_id)
    register(direct_vm, contract, direct_charlie, bounty_id, pr=100, author_id=124)
    _mock_verdict(direct_vm)
    contract.resolve_claim(bounty_id, 0)
    assert contract.get_claim(bounty_id, 1)["refundable"] is False
    _warp_to(direct_vm, TEST_NOW_UNIX + CHALLENGE_WINDOW + 1)
    contract.finalize_bounty(bounty_id)
    assert contract.get_claim(bounty_id, 1)["refundable"] is True
    contract.resolve_claim(bounty_id, 1)
    assert contract.get_claim(bounty_id, 1)["stake_released"] is True
    with pytest.raises(Exception, match="not pending"):
        contract.resolve_claim(bounty_id, 1)


@pytest.mark.parametrize("defect", ["ninth_file", "missing_patch", "truncated_hunk", "omitted_hunk", "too_long", "missing_file", "wrong_counts", "duplicate_file", "long_issue", "long_pr"])
def test_incomplete_or_oversized_evidence_never_reaches_jury(defect, direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = _deploy(direct_deploy)
    bounty_id = _create(direct_vm, contract, direct_alice)
    files = json.loads(FILES_JSON)
    pull = {}
    issue = {}
    if defect == "ninth_file":
        files = [{**copy.deepcopy(files[0]), "filename": f"file-{i}.ts"} for i in range(9)]
    elif defect == "missing_patch":
        del files[0]["patch"]
    elif defect == "truncated_hunk":
        files[0]["patch"] = "@@ -0,0 +1,2 @@\n+partial"
    elif defect == "omitted_hunk":
        files[0].update(additions=2, changes=2)
    elif defect == "too_long":
        files[0]["patch"] = "@@ -0,0 +1 @@\n+" + "x" * 6000
    elif defect == "missing_file":
        pull["changed_files"] = 2
    elif defect == "wrong_counts":
        pull["additions"] = 999
    elif defect == "duplicate_file":
        files.append(copy.deepcopy(files[0]))
    elif defect == "long_issue":
        issue["body"] = "x" * 4001
    elif defect == "long_pr":
        pull["body"] = "x" * 2501
    _mock_verdict(direct_vm, verdict="FIXES_ISSUE")
    with pytest.raises(Exception, match=r"\[EXPECTED\]"):
        register(direct_vm, contract, direct_bob, bounty_id, files=files, pull_overrides=pull, issue_overrides=issue)
    assert contract.get_bounty(bounty_id)["claim_count"] == "0"
    assert direct_vm._llm_mocks_hit == set()


def test_empty_diff_cannot_be_awarded_by_positive_model(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = _deploy(direct_deploy)
    bounty_id = _create(direct_vm, contract, direct_alice)
    register(direct_vm, contract, direct_bob, bounty_id, files=[])
    _mock_verdict(direct_vm)
    contract.resolve_claim(bounty_id, 0)
    assert contract.get_claim(bounty_id, 0)["status"] == "REJECTED_PENDING_APPEAL"
    assert direct_vm._llm_mocks_hit == set()


def test_registration_consensus_compares_complete_snapshot(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = _deploy(direct_deploy)
    bounty_id = _create(direct_vm, contract, direct_alice)
    register(direct_vm, contract, direct_bob, bounty_id)
    assert direct_vm.run_validator() is True
    evidence = contract.get_claim_evidence(bounty_id, 0)
    serialized = json.dumps(evidence["snapshot"], sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    assert hashlib.sha256(serialized.encode()).hexdigest() == evidence["source_digest"]
    _mock_github(direct_vm, direct_bob, issue_overrides={"body": "Different issue requirements."})
    assert direct_vm.run_validator() is False


@pytest.mark.parametrize("confidence", ["NaN", "Infinity", "not a number"])
def test_malformed_jury_confidence_does_not_award(confidence, direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = _deploy(direct_deploy)
    bounty_id = _create(direct_vm, contract, direct_alice)
    register(direct_vm, contract, direct_bob, bounty_id)
    _mock_verdict(direct_vm, confidence=confidence)
    with pytest.raises(Exception, match="non-numeric confidence"):
        contract.resolve_claim(bounty_id, 0)
    assert contract.get_claim(bounty_id, 0)["status"] == "PENDING"


def test_newest_first_pagination_and_complete_claim_dtos(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = _deploy(direct_deploy)
    for _ in range(26):
        bounty_id = _create(direct_vm, contract, direct_alice)
    first = contract.list_bounties(0, 25)
    second = contract.list_bounties(25, 25)
    assert first["total"] == "26"
    assert first["items"][0]["id"] == "bf-26"
    assert [b["id"] for b in second["items"]] == ["bf-1"]
    assert contract.list_sponsor_bounties("0x" + direct_alice.hex(), 25, 25)["items"] == second["items"]
    register(direct_vm, contract, direct_bob, bounty_id)
    expected = contract.get_claim(bounty_id, 0)
    assert contract.list_claims(bounty_id, 0, 25)["items"][0] == expected
    assert contract.list_hunter_claims("0x" + direct_bob.hex(), 0, 25)["items"][0] == expected
    assert expected["bounty_id"] == bounty_id
    assert "evidence_json" not in expected


def test_deployment_signer_has_no_treasury_or_sponsor_privileges(direct_vm, direct_deploy, direct_alice, direct_bob):
    direct_vm.sender = direct_bob
    treasury = "0x" + direct_alice.hex()
    contract = direct_deploy("contracts/bounty_forge.py", 0, 300, 300, 300, treasury)
    assert contract.get_config()["treasury"].lower() == treasury
    bounty_id = _create(direct_vm, contract, direct_alice)
    direct_vm.sender = direct_bob
    with pytest.raises(Exception, match="only the sponsor"):
        contract.cancel_bounty(bounty_id)


@pytest.mark.parametrize("address", ["bad", "0x" + "0" * 40, "0x" + "x" * 40])
def test_invalid_treasury_is_rejected(address, direct_deploy):
    with pytest.raises(Exception, match="invalid treasury"):
        direct_deploy("contracts/bounty_forge.py", 0, 300, 300, 300, address)


def test_native_payout_emissions_conserve_pot_and_stake(direct_vm, direct_deploy, direct_alice, direct_bob):
    transfers = []

    def capture(_vm, request):
        if "EthSend" in request:
            transfer = request["EthSend"]
            transfers.append((str(transfer["address"]).lower(), int(transfer["value"]), transfer["calldata"]))
            return {"ok": None}
        return None

    direct_vm._gl_call_hook = capture
    contract = direct_deploy("contracts/bounty_forge.py", 250, CHALLENGE_WINDOW, APPEAL_WINDOW)
    treasury = contract.get_config()["treasury"].lower()
    bounty_id = _create(direct_vm, contract, direct_alice)
    _mock_verdict(direct_vm)
    _submit(direct_vm, contract, direct_bob, bounty_id)
    assert transfers == []
    _warp_to(direct_vm, TEST_NOW_UNIX + CHALLENGE_WINDOW + 1)
    contract.finalize_bounty(bounty_id)
    assert transfers == []
    direct_vm.sender = direct_bob
    contract.claim_payout(bounty_id)
    hunter = "0x" + direct_bob.hex()
    fee = 10**18 * 250 // 10000
    assert transfers == [(hunter, STAKE, b""), (hunter, 10**18 - fee, b""), (treasury, fee, b"")]
    assert sum(value for _, value, _ in transfers) == 10**18 + STAKE
    with pytest.raises(Exception, match="payout is not available"):
        contract.claim_payout(bounty_id)
    assert len(transfers) == 3


def test_capture_and_jury_closures_support_genvm_serialization(direct_vm, direct_deploy, direct_alice, direct_bob):
    direct_vm.check_pickling = True
    contract = _deploy(direct_deploy)
    bounty_id = _create(direct_vm, contract, direct_alice)
    _mock_verdict(direct_vm)
    _submit(direct_vm, contract, direct_bob, bounty_id)
    assert contract.get_claim(bounty_id, 0)["status"] == "ACCEPTED"


def test_failed_bounty_creation_keeps_owner_credit_withdrawable(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = _deploy(direct_deploy)
    direct_vm.sender = direct_alice
    _deposit(direct_vm, contract, 10**18)
    with pytest.raises(Exception, match="title must be"):
        contract.create_bounty("no", "A complete and testable set of requirements.", "https://github.com/acme/widgets/issues/42", TEST_NOW_UNIX + DAY, 10**18)
    assert contract.get_credit("0x" + direct_alice.hex()) == str(10**18)
    assert contract.get_stats()["total_created"] == "0"
    direct_vm.sender = direct_bob
    with pytest.raises(Exception, match="no available balance"):
        contract.withdraw_credit()
    assert contract.get_credit("0x" + direct_alice.hex()) == str(10**18)
    direct_vm.sender = direct_alice
    contract.withdraw_credit()
    assert contract.get_credit("0x" + direct_alice.hex()) == "0"
    with pytest.raises(Exception, match="no available balance"):
        contract.withdraw_credit()


def test_rejected_identity_never_consumes_prepaid_stake(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = _deploy(direct_deploy)
    bounty_id = _create(direct_vm, contract, direct_alice)
    with pytest.raises(Exception, match="BountyForge-Wallet"):
        register(direct_vm, contract, direct_bob, bounty_id, pull_overrides={"body": "No authorization"})
    assert contract.get_credit("0x" + direct_bob.hex()) == str(STAKE)
    assert contract.get_bounty(bounty_id)["claim_count"] == "0"
    contract.withdraw_credit()
    assert contract.get_credit("0x" + direct_bob.hex()) == "0"
    assert register(direct_vm, contract, direct_bob, bounty_id) == "0"
    assert contract.get_credit("0x" + direct_bob.hex()) == "0"


def test_inconclusive_challenge_leaves_bond_withdrawable(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = _deploy(direct_deploy)
    bounty_id = _create(direct_vm, contract, direct_alice)
    _mock_verdict(direct_vm)
    _submit(direct_vm, contract, direct_bob, bounty_id)
    _mock_verdict(direct_vm, verdict="INCONCLUSIVE", clear=True, hunter=direct_bob)
    direct_vm.sender = direct_alice
    _deposit(direct_vm, contract, STAKE)
    with pytest.raises(Exception, match="inconclusive"):
        contract.challenge_claim(bounty_id, "The diff cannot establish that every required behavior is satisfied.")
    assert contract.get_credit("0x" + direct_alice.hex()) == str(STAKE)
    contract.withdraw_credit()
    assert contract.get_credit("0x" + direct_alice.hex()) == "0"
    assert contract.get_bounty(bounty_id)["status"] == "AWARDED"


def test_unused_credit_is_separate_from_bounty_escrow(direct_vm, direct_deploy, direct_alice):
    transfers = []
    def capture(_vm, request):
        if "EthSend" in request:
            transfers.append(int(request["EthSend"]["value"]))
            return {"ok": None}
        return None
    direct_vm._gl_call_hook = capture
    contract = _deploy(direct_deploy)
    direct_vm.sender = direct_alice
    _deposit(direct_vm, contract, 10**18 + 3 * STAKE)
    bounty_id = contract.create_bounty("Fix theme persistence", "Persist the selected theme after reloading the app.", "https://github.com/acme/widgets/issues/42", TEST_NOW_UNIX + DAY, 10**18)
    assert contract.get_credit("0x" + direct_alice.hex()) == str(3 * STAKE)
    contract.withdraw_credit()
    assert transfers == [3 * STAKE]
    assert contract.get_bounty(bounty_id)["status"] == "OPEN"
    contract.cancel_bounty(bounty_id)
    assert transfers == [3 * STAKE, 10**18]
    assert sum(transfers) == 10**18 + 3 * STAKE


def test_bounty_cannot_spend_another_wallet_credit(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = _deploy(direct_deploy)
    direct_vm.sender = direct_alice
    _deposit(direct_vm, contract, 10**18)
    direct_vm.sender = direct_bob
    with pytest.raises(Exception, match="insufficient available balance"):
        contract.create_bounty("Spend sponsor balance", "Persist the selected theme after reloading the app.", "https://github.com/acme/widgets/issues/42", TEST_NOW_UNIX + DAY, 10**18)
    assert contract.get_credit("0x" + direct_alice.hex()) == str(10**18)
    assert contract.get_credit("0x" + direct_bob.hex()) == "0"
