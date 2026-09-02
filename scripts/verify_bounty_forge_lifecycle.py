"""Run a two-wallet BountyForge lifecycle on the canonical StudioNet contract.

The disposable sponsor and hunter keys live only in this process. The script
pauses after printing the hunter's public wallet marker so the named public PR
can be bound to that wallet before immutable evidence capture begins.
"""

import argparse
import json
import re
import socket
import time
from contextlib import contextmanager
from functools import partial

import requests
import urllib3.util.connection
from eth_account import Account
from eth_utils import to_checksum_address
from genlayer_py import create_client
from genlayer_py.assertions import tx_execution_succeeded
from genlayer_py.chains import studionet
from genlayer_py.exceptions import GenLayerError
from genlayer_py.types import TransactionHashVariant, TransactionStatus

POT = 10**15
FINAL = TransactionStatus.FINALIZED
ADDRESS_RE = re.compile(r"^0x[0-9a-fA-F]{40}$")
SHA_RE = re.compile(r"^[0-9a-fA-F]{40}$")


@contextmanager
def bounded_rpc_session():
    previous_post = requests.post
    previous_family = urllib3.util.connection.allowed_gai_family
    with requests.Session() as session:
        try:
            urllib3.util.connection.allowed_gai_family = lambda: socket.AF_INET
            requests.post = partial(session.post, timeout=(10, 40))
            yield
        finally:
            requests.post = previous_post
            urllib3.util.connection.allowed_gai_family = previous_family


def read(client, address, account, function_name, args=None):
    for attempt in range(12):
        try:
            return client.read_contract(
                address=address,
                function_name=function_name,
                args=args or [],
                account=account,
                transaction_hash_variant=TransactionHashVariant.LATEST_FINAL,
            )
        except (GenLayerError, requests.RequestException) as error:
            if attempt == 11:
                raise
            print(f"Transient {function_name} read error; retrying same read: {error}", flush=True)
            time.sleep(5)
    raise RuntimeError("unreachable")


def wait_receipt(client, tx_hash, *, full_transaction=False):
    for attempt in range(12):
        try:
            return client.wait_for_transaction_receipt(
                transaction_hash=tx_hash,
                status=FINAL,
                interval=3000,
                retries=120,
                full_transaction=full_transaction,
            )
        except (GenLayerError, requests.RequestException) as error:
            if attempt == 11:
                raise
            print(f"Transient receipt error for {tx_hash}; resuming the same hash: {error}", flush=True)
            time.sleep(5)
    raise RuntimeError("unreachable")


def balance(client, address):
    for attempt in range(12):
        try:
            return client.w3.eth.get_balance(address)
        except (GenLayerError, requests.RequestException) as error:
            if attempt == 11:
                raise
            print(f"Transient balance read error; retrying: {error}", flush=True)
            time.sleep(5)
    raise RuntimeError("unreachable")


def transact(client, address, account, function_name, args=None, *, value=0):
    tx_hash = client.write_contract(
        address=address,
        function_name=function_name,
        args=args or [],
        account=account,
        value=value,
    )
    print(f"{function_name} submitted: {tx_hash}", flush=True)
    receipt = wait_receipt(client, tx_hash, full_transaction=True)
    if receipt.get("status_name") != "FINALIZED" or not tx_execution_succeeded(receipt):
        raise RuntimeError(f"{function_name} did not finalize with successful execution: {receipt}")
    print(f"{function_name}: {tx_hash} FINALIZED SUCCESS", flush=True)
    return str(tx_hash)


def fund(client, account, label):
    submitted = client.fund_account(account.address, 3 * POT)
    tx_hash = "0x" + bytes(submitted).hex()
    print(f"{label} StudioNet funding: {tx_hash}", flush=True)
    receipt = wait_receipt(client, tx_hash)
    if receipt.get("status_name") != "FINALIZED" or receipt.get("value_credited") is not True:
        raise RuntimeError(f"{label} StudioNet funding failed: {receipt}")
    return tx_hash


def wait_until_finalizable(client, address, account, bounty_id):
    while True:
        bounty = read(client, address, account, "get_bounty", [bounty_id])
        if bounty["finalizable"] is True:
            return
        remaining = max(1, int(bounty["challenge_deadline_unix"]) - int(time.time()) + 1)
        print(f"Challenge window: {remaining}s remaining", flush=True)
        time.sleep(min(15, remaining))


def normalized_address(value):
    if ADDRESS_RE.fullmatch(value) is None or int(value[2:], 16) == 0:
        raise ValueError("--contract must be a valid nonzero address")
    return to_checksum_address(value)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--contract", required=True)
    parser.add_argument("--issue-url", default="https://github.com/Demigodd00/bountyforge/issues/3")
    parser.add_argument("--pr-url", default="https://github.com/Demigodd00/bountyforge/pull/4")
    parser.add_argument("--pr-head-sha", default="337ab6934eb9aafb591eb765cc636f6a0228a17d")
    parser.add_argument("--github-login", default="Demigodd00")
    args = parser.parse_args()
    address = normalized_address(args.contract)
    if SHA_RE.fullmatch(args.pr_head_sha) is None:
        parser.error("--pr-head-sha must be a full 40-character commit SHA")

    sponsor, hunter = Account.create(), Account.create()
    marker = f"BountyForge-Wallet: {hunter.address}"
    print(json.dumps({"phase": "fixture_required", "contract": address, "sponsor": sponsor.address, "hunter": hunter.address,
                      "pr": args.pr_url, "marker": marker}), flush=True)
    input("Update the PR to the exact wallet marker above, then press Enter: ")

    client = create_client(chain=studionet, account=sponsor)
    hunter_client = create_client(chain=studionet, account=hunter)
    config = read(client, address, sponsor, "get_config")
    if config.get("version") != "3.1.1" or config.get("funding_model") != "WITHDRAWABLE_DEPOSIT_CREDIT_V1":
        raise RuntimeError(f"Canonical contract config mismatch: {config}")

    evidence = {
        "contract": address,
        "sponsor": sponsor.address,
        "hunter": hunter.address,
        "sponsor_fund_transaction": fund(client, sponsor, "sponsor"),
        "hunter_fund_transaction": fund(hunter_client, hunter, "hunter"),
    }
    sponsor_before = balance(client, sponsor.address)
    hunter_before = balance(client, hunter.address)
    contract_balance_before = balance(client, address)

    evidence["sponsor_deposit_transaction"] = transact(client, address, sponsor, "deposit", value=POT)
    evidence["create_bounty_transaction"] = transact(client, address, sponsor, "create_bounty", [
        "Complete BountyForge StudioNet acceptance flow",
        "Complete every requirement in issue #3 and submit the exact one-file public pull request with the required heading, sentence, and contract address.",
        args.issue_url,
        int(time.time()) + 7200,
        POT,
    ])
    listing = read(client, address, sponsor, "list_sponsor_bounties", [sponsor.address, 0, 25])
    bounty_id = listing["items"][0]["id"]
    evidence["bounty_id"] = bounty_id

    evidence["hunter_deposit_transaction"] = transact(hunter_client, address, hunter, "deposit", value=POT)
    evidence["submit_claim_transaction"] = transact(hunter_client, address, hunter, "submit_claim", [
        bounty_id, args.pr_url, args.pr_head_sha.lower(), args.github_login,
    ])
    evidence["resolve_claim_transaction"] = transact(client, address, sponsor, "resolve_claim", [bounty_id, 0])

    awarded = read(client, address, sponsor, "get_bounty", [bounty_id])
    accepted = read(client, address, sponsor, "get_claim", [bounty_id, 0])
    if awarded["status"] != "AWARDED" or accepted["status"] != "ACCEPTED" or accepted["verdict"] != "FIXES_ISSUE":
        raise RuntimeError(f"Canonical claim was not awarded: {json.dumps({'bounty': awarded, 'claim': accepted})}")

    wait_until_finalizable(client, address, sponsor, bounty_id)
    evidence["finalize_bounty_transaction"] = transact(client, address, sponsor, "finalize_bounty", [bounty_id])
    evidence["claim_payout_transaction"] = transact(hunter_client, address, hunter, "claim_payout", [bounty_id])

    final_bounty = read(client, address, sponsor, "get_bounty", [bounty_id])
    final_claim = read(client, address, sponsor, "get_claim", [bounty_id, 0])
    stats = read(client, address, sponsor, "get_stats")
    sponsor_credit = read(client, address, sponsor, "get_credit", [sponsor.address])
    hunter_credit = read(client, address, sponsor, "get_credit", [hunter.address])
    contract_balance = balance(client, address)
    sponsor_after = balance(client, sponsor.address)
    hunter_after = balance(client, hunter.address)
    if final_bounty["status"] != "SETTLED" or final_claim["status"] != "PAID":
        raise RuntimeError(f"Final lifecycle state mismatch: {final_bounty}, {final_claim}")
    if sponsor_credit != "0" or hunter_credit != "0" or contract_balance != contract_balance_before:
        raise RuntimeError("Canonical lifecycle left participant credit or changed the contract balance baseline")
    if sponsor_after != sponsor_before - POT or hunter_after != hunter_before + POT:
        raise RuntimeError("Canonical lifecycle did not conserve the reward and returned stake")

    evidence.update({
        "issue_url": args.issue_url,
        "pr_url": args.pr_url,
        "pr_head_sha": args.pr_head_sha.lower(),
        "all_contract_transactions": "FINALIZED with successful leader execution",
        "all_non_deposit_attached_value_atto": "0",
        "verdict": final_claim["verdict"],
        "confidence_bucket": final_claim["confidence_bucket"],
        "reason": final_claim["reason"],
        "source_digest": final_claim["source_digest"],
        "bounty_status": final_bounty["status"],
        "claim_status": final_claim["status"],
        "reward_atto": final_bounty["payout_preview_atto"],
        "returned_stake_atto": final_claim["stake_atto"],
        "hunter_balance_increase_atto": str(hunter_after - hunter_before),
        "contract_balance_before_atto": str(contract_balance_before),
        "contract_balance_after_atto": str(contract_balance),
        "contract_balance_delta_atto": str(contract_balance - contract_balance_before),
        "final_sponsor_credit_atto": sponsor_credit,
        "final_hunter_credit_atto": hunter_credit,
        "stats": stats,
    })
    print("CANONICAL_FULL_LIFECYCLE " + json.dumps(evidence, sort_keys=True), flush=True)


if __name__ == "__main__":
    with bounded_rpc_session():
        main()
