import time
import os
import socket
from functools import partial

import pytest
import requests
import urllib3.util.connection
from eth_account import Account
from gltest import get_contract_factory
from gltest.assertions import tx_execution_succeeded
from gltest.clients import get_gl_client
from gltest.types import TransactionHashVariant, TransactionStatus
from gltest.utils import extract_contract_address

POT = 10**15
CHALLENGE_WINDOW_SECS = 300
APPEAL_WINDOW_SECS = 300
DEADLINE_LEAD_SECS = 360
FINAL = TransactionStatus.FINALIZED


@pytest.fixture(autouse=True)
def bounded_rpc_session(monkeypatch):
    # genlayer-py 0.16 opens a new HTTP connection for every RPC and has no
    # request timeout. Reuse a bounded session, without retrying signed writes.
    with requests.Session() as session:
        if os.environ.get("BOUNTYFORGE_PREFER_IPV4") == "1":
            monkeypatch.setattr(urllib3.util.connection, "allowed_gai_family", lambda: socket.AF_INET)
        monkeypatch.setattr(requests, "post", partial(session.post, timeout=(10, 40)))
        yield


def _read(method):
    return method.call(transaction_hash_variant=TransactionHashVariant.LATEST_FINAL)


def _transact(method, *, value=0, succeeds=True):
    receipt = method.transact(
        value=value, wait_transaction_status=FINAL, wait_interval=3000,
        wait_retries=120, wait_triggered_transactions=True,
        wait_triggered_transactions_status=FINAL,
    )
    assert receipt.get("status_name") == "FINALIZED"
    assert tx_execution_succeeded(receipt) is succeeds
    print(f"{method.method_name}: {receipt.get('hash')} FINALIZED success={succeeds}", flush=True)
    return receipt


def _deploy():
    client = get_gl_client()
    # Isolated, disposable test actors and simulated GEN; never user wallets.
    alice, bob, treasury = (Account.create() for _ in range(3))
    print("Requesting simulated GEN for an isolated test actor", flush=True)
    funding = client.fund_account(alice.address, 2 * POT)
    funding_hash = "0x" + bytes(funding).hex()
    print(f"Funding isolated StudioNet test actor: {funding_hash}", flush=True)
    funded = client.wait_for_transaction_receipt(funding_hash, status=FINAL, interval=3000, retries=120)
    assert funded.get("status_name") == "FINALIZED"
    print("Test funding finalized; deploying BountyForge v3.1", flush=True)
    factory = get_contract_factory("BountyForge")
    tx_hash = client.deploy_contract(
        code=factory.contract_code,
        args=[0, CHALLENGE_WINDOW_SECS, APPEAL_WINDOW_SECS, 300, treasury.address],
        account=alice,
    )
    print(f"Test deployment submitted: {tx_hash}", flush=True)
    receipt = client.wait_for_transaction_receipt(tx_hash, status=FINAL, interval=3000, retries=120)
    assert tx_execution_succeeded(receipt), "Deployment execution must succeed before reading schema/state"
    assert receipt.get("status_name") == "FINALIZED"
    contract = factory.build_contract(extract_contract_address(receipt), account=alice)
    config = _read(contract.get_config())
    assert config["version"] == "3.1.1"
    assert config["funding_model"] == "WITHDRAWABLE_DEPOSIT_CREDIT_V1"
    assert config["evidence_schema"] == "bountyforge-evidence-v3"
    assert config["review_window_secs"] == "300"
    assert config["treasury"].lower() == treasury.address.lower()
    print(f"Verified v3 test deployment {contract.address}", flush=True)
    return contract, alice, bob


def _balance(address):
    return get_gl_client().w3.eth.get_balance(address)


def _wait_until(unix_ts: int) -> None:
    while time.time() < unix_ts + 2:
        time.sleep(5)


def test_cancel_refund_path_on_studionet():
    contract, alice, bob = _deploy()
    before = _balance(alice.address)
    _transact(contract.deposit(), value=POT)
    _transact(contract.create_bounty(
        args=[
            "Fix flaky CI on main",
            "Main branch must pass the full test suite three consecutive times.",
            "https://github.com/genlayerlabs/genvm/issues/1",
            int(time.time()) + DEADLINE_LEAD_SECS + 3600,
            POT,
        ]
    ))
    assert _read(contract.get_credit(args=[alice.address])) == "0"
    assert _balance(contract.address) == POT
    assert _balance(alice.address) == before - POT

    listing = _read(contract.list_bounties(args=[0, 25]))
    bounty_id = listing["items"][0]["id"]
    bounty = _read(contract.get_bounty(args=[bounty_id]))
    assert bounty["status"] == "OPEN"
    assert bounty["cancellable"] is True

    _transact(contract.connect(bob).cancel_bounty(args=[bounty_id]), succeeds=False)
    assert _balance(contract.address) == POT

    _transact(contract.connect(alice).cancel_bounty(args=[bounty_id]))

    bounty = _read(contract.get_bounty(args=[bounty_id]))
    assert bounty["status"] == "CANCELLED"
    assert _read(contract.get_stats())["total_cancelled"] == "1"
    assert _balance(contract.address) == 0
    assert _balance(alice.address) == before

    _transact(contract.connect(alice).cancel_bounty(args=[bounty_id]), succeeds=False)
    assert _balance(alice.address) == before


def test_expire_refund_path_on_studionet():
    resume_address = os.environ.get("BOUNTYFORGE_RESUME_EXPIRY")
    if resume_address:
        # Resume our already-funded negative/early-expiry test after an RPC
        # outage. Expiry is permissionless; no original wallet key is needed.
        contract = get_contract_factory("BountyForge").build_contract(resume_address, account=Account.create())
        bounty = _read(contract.get_bounty(args=["bf-1"]))
        assert _read(contract.get_config())["version"] == "3.1.1"
        assert bounty["title"] == "Document the storage layout"
        assert bounty["status"] == "OPEN" and bounty["claim_count"] == "0"
        assert int(bounty["deadline_unix"]) < time.time()
        assert int(bounty["pot_atto"]) == POT and _balance(contract.address) == POT
        before = _balance(bounty["sponsor"])
        _transact(contract.expire_bounty(args=["bf-1"]))
        assert _read(contract.get_bounty(args=["bf-1"]))["status"] == "REFUNDED"
        assert _balance(contract.address) == 0
        assert _balance(bounty["sponsor"]) == before + POT
        print(f"Resumed expiry and verified sponsor receipt at {resume_address}", flush=True)
        return
    contract, alice, bob = _deploy()
    before = _balance(alice.address)
    _transact(contract.deposit(), value=POT)
    deadline = int(time.time()) + DEADLINE_LEAD_SECS
    _transact(contract.create_bounty(
        args=[
            "Document the storage layout",
            "README section describing every storage slot and its format.",
            "https://github.com/genlayerlabs/genvm/issues/2",
            deadline,
            POT,
        ]
    ))
    assert _balance(contract.address) == POT

    listing = _read(contract.list_bounties(args=[0, 25]))
    bounty_id = listing["items"][0]["id"]

    _transact(contract.expire_bounty(args=[bounty_id]), succeeds=False)

    print(f"Waiting for the actual on-chain deadline {deadline}", flush=True)
    _wait_until(deadline)
    _transact(contract.connect(bob).expire_bounty(args=[bounty_id]))

    bounty = _read(contract.get_bounty(args=[bounty_id]))
    assert bounty["status"] == "REFUNDED"
    assert _read(contract.get_stats())["total_refunded"] == "1"
    assert _balance(contract.address) == 0
    assert _balance(alice.address) == before


def test_unverified_public_pr_cannot_reserve_a_claim_on_studionet():
    """Exercise real GenVM web consensus without publishing or editing a PR."""
    contract, alice, bob = _deploy()
    before = _balance(alice.address)
    response = requests.get(
        "https://api.github.com/repos/genlayerlabs/genvm/pulls/314",
        headers={"User-Agent": "BountyForge-integration-test"}, timeout=30,
    )
    response.raise_for_status()
    pull = response.json()
    assert "BountyForge-Wallet:" not in (pull.get("body") or ""), "The public negative-test fixture changed"
    assert len(pull.get("body") or "") <= 2500
    _transact(contract.deposit(), value=POT)
    _transact(contract.create_bounty(args=[
        "Ownership rejection smoke test",
        "The submitted code must meet all requirements in the referenced issue.",
        "https://github.com/genlayerlabs/genvm/issues/1", int(time.time()) + 3600, POT,
    ]))
    _transact(contract.deposit(), value=POT)
    rejected = _transact(contract.submit_claim(args=[
        "bf-1", pull["html_url"], pull["head"]["sha"], pull["user"]["login"],
    ]), succeeds=False)
    assert "BountyForge-Wallet" in str(rejected), "Must reject the missing wallet binding, not a web/consensus failure"
    bounty = _read(contract.get_bounty(args=["bf-1"]))
    assert bounty["claim_count"] == "0"
    assert bounty["claims_remaining"] == "8"
    assert _read(contract.list_hunter_claims(args=[alice.address, 0, 25]))["total"] == "0"
    # The failed operation carried no GEN. Its prepaid stake remains owned by
    # the depositor and can be withdrawn without touching bounty escrow.
    assert _balance(contract.address) == 2 * POT
    assert _read(contract.get_credit(args=[alice.address])) == str(POT)
    _transact(contract.connect(bob).withdraw_credit(), succeeds=False)
    assert _read(contract.get_credit(args=[alice.address])) == str(POT)
    _transact(contract.connect(alice).withdraw_credit())
    assert _read(contract.get_credit(args=[alice.address])) == "0"
    assert _balance(contract.address) == POT
    assert _balance(alice.address) == before - POT
    _transact(contract.connect(alice).withdraw_credit(), succeeds=False)
    _transact(contract.connect(alice).cancel_bounty(args=["bf-1"]))
    assert _balance(alice.address) == before
