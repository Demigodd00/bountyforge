"""Deploy and verify BountyForge before updating the active deployment record.

A normal deployment prompts for a recoverable signer key. On gasless StudioNet,
--ephemeral-studionet-deployer --treasury <public address> uses a deployment-only
signer with no retained funds or admin role. It never needs the treasury key.
"""

import argparse
import base64
import hashlib
import json
import os
import re
import sys
import tempfile
import socket
from contextlib import contextmanager
from datetime import datetime, timezone
from functools import partial
from getpass import getpass
from pathlib import Path

from eth_account import Account
from eth_utils import to_checksum_address
from genlayer_py import create_client
from genlayer_py.assertions import tx_execution_succeeded
from genlayer_py.chains import localnet, studionet
from genlayer_py.types import TransactionHashVariant, TransactionStatus
import requests
import urllib3.util.connection

ROOT = Path(__file__).resolve().parents[1]
CODE_PATH = ROOT / "contracts" / "bounty_forge.py"
DEPLOYMENTS_DIR = ROOT / "deployments"


@contextmanager
def rpc_connections():
    """Bound requests and reuse TLS connections; never retry signed writes."""
    previous_post = requests.post
    previous_family = urllib3.util.connection.allowed_gai_family
    with requests.Session() as session:
        try:
            if os.environ.get("BOUNTYFORGE_PREFER_IPV4") == "1":
                urllib3.util.connection.allowed_gai_family = lambda: socket.AF_INET
            requests.post = partial(session.post, timeout=(10, 40))
            yield
        finally:
            requests.post = previous_post
            urllib3.util.connection.allowed_gai_family = previous_family


def normalized_address(value: str) -> str:
    if not isinstance(value, str) or re.fullmatch(r"0x[0-9a-fA-F]{40}", value) is None or int(value[2:], 16) == 0:
        raise ValueError("A valid, nonzero public address is required")
    return to_checksum_address(value)


def extract_contract_address(receipt: dict) -> str:
    for key in ("tx_data_decoded", "data"):
        data = receipt.get(key)
        if isinstance(data, dict) and data.get("contract_address"):
            return normalized_address(data["contract_address"])
    raise ValueError("Finalized deployment receipt is missing its contract address")


def verify_receipt(receipt: dict) -> None:
    status = receipt.get("status_name") or receipt.get("statusName")
    if status != TransactionStatus.FINALIZED.value:
        raise RuntimeError("Deployment is not finalized; active deployment record was not changed")
    if not tx_execution_succeeded(receipt):
        raise RuntimeError("Deployment execution failed; active deployment record was not changed")


def source_digest(code: str) -> str:
    return hashlib.sha256(code.replace("\r\n", "\n").encode("utf-8")).hexdigest()


def verify_source(client, address: str, expected_code: str) -> str:
    response = client.provider.make_request(method="gen_getContractCode", params=[address])
    encoded = response.get("result")
    if not isinstance(encoded, str):
        raise RuntimeError("Could not retrieve deployed source; refusing to activate this address")
    try:
        deployed_code = base64.b64decode(encoded, validate=True).decode("utf-8")
    except (ValueError, UnicodeError):
        raise RuntimeError("Deployed source was not valid encoded Python") from None
    digest = source_digest(expected_code)
    if source_digest(deployed_code) != digest:
        raise RuntimeError("Deployed source does not match validated local source")
    return digest


def record_deployment(out_path: Path, record: dict) -> None:
    """Keep the previous public record and atomically replace only the pointer."""
    out_path.parent.mkdir(parents=True, exist_ok=True)
    if out_path.exists():
        previous = json.loads(out_path.read_text(encoding="utf-8"))
        previous_address = normalized_address(previous["address"])
        if previous_address.lower() != record["address"].lower():
            history_dir = out_path.parent / "history"
            history_dir.mkdir(exist_ok=True)
            history_path = history_dir / (out_path.stem + "_" + previous_address[2:].lower() + ".json")
            if history_path.exists():
                if json.loads(history_path.read_text(encoding="utf-8")) != previous:
                    raise RuntimeError("Existing deployment history differs; refusing to overwrite it")
            else:
                history_path.write_text(json.dumps(previous, indent=2) + "\n", encoding="utf-8")
            record["previous_address"] = previous_address
    with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=out_path.parent, prefix="bountyforge-record-", suffix=".json.tmp", delete=False) as temporary:
        json.dump(record, temporary, indent=2)
        temporary.write("\n")
        pending_path = Path(temporary.name)
    pending_path.replace(out_path)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("fee_bps", type=int, nargs="?", default=0)
    parser.add_argument("challenge_window_secs", type=int, nargs="?", default=3600)
    parser.add_argument("appeal_window_secs", type=int, nargs="?", default=86400)
    parser.add_argument("review_window_secs", type=int, nargs="?", default=86400)
    parser.add_argument("--treasury", help="Public wallet address that receives fees and final rejected stakes")
    parser.add_argument("--ephemeral-studionet-deployer", action="store_true", help="Use a disposable, unprivileged signer on gasless StudioNet; requires --treasury")
    args = parser.parse_args()
    if not 0 <= args.fee_bps <= 500:
        parser.error("fee_bps must be 0..500")
    for window in (args.challenge_window_secs, args.appeal_window_secs, args.review_window_secs):
        if not 300 <= window <= 604800:
            parser.error("each window must be 300..604800 seconds")

    network_name = os.environ.get("BOUNTYFORGE_NETWORK", "studionet")
    if network_name not in ("studionet", "localnet"):
        parser.error("BOUNTYFORGE_NETWORK must be studionet or localnet")
    chain = {"studionet": studionet, "localnet": localnet}[network_name]
    if args.ephemeral_studionet_deployer:
        if network_name != "studionet" or not args.treasury:
            parser.error("a disposable signer is permitted only on StudioNet with an explicit public treasury")
        treasury = normalized_address(args.treasury)
        account = Account.create()
        signer_mode = "disposable_studionet_deployment_only"
    else:
        private_key = os.environ.get("BOUNTYFORGE_PRIVATE_KEY") or getpass(
            "Enter the dedicated BountyForge deployment key (input hidden): "
        ).strip()
        if not private_key:
            raise RuntimeError("A recoverable signer key is required for this deployment mode")
        try:
            account = Account.from_key(private_key)
        except (ValueError, TypeError):
            raise RuntimeError("Private key format is invalid") from None
        del private_key
        treasury = normalized_address(args.treasury or account.address)
        signer_mode = "recoverable_signer"

    code = CODE_PATH.read_text(encoding="utf-8")
    client = create_client(chain=chain, account=account)
    constructor_args = [args.fee_bps, args.challenge_window_secs, args.appeal_window_secs, args.review_window_secs, treasury]
    print(f"network={network_name} signer={account.address} treasury={treasury}", flush=True)
    print("Deployment signer has no admin role. Treasury key is not used or stored.", flush=True)
    tx_hash = client.deploy_contract(code=code, account=account, args=constructor_args)
    print(f"tx={tx_hash}", flush=True)
    # A timeout must be investigated using this hash, never blindly redeployed.
    receipt = client.wait_for_transaction_receipt(
        transaction_hash=tx_hash, status=TransactionStatus.FINALIZED,
        interval=3000, retries=120, full_transaction=True,
    )
    verify_receipt(receipt)
    address = extract_contract_address(receipt)
    digest = verify_source(client, address, code)
    config = client.read_contract(
        address=address, function_name="get_config", args=[], account=account,
        transaction_hash_variant=TransactionHashVariant.LATEST_FINAL,
    )
    expected = {
        "version": "3.1.0", "evidence_schema": "bountyforge-evidence-v3", "funding_model": "WITHDRAWABLE_DEPOSIT_CREDIT_V1",
        "fee_bps": str(args.fee_bps), "challenge_window_secs": str(args.challenge_window_secs),
        "appeal_window_secs": str(args.appeal_window_secs), "review_window_secs": str(args.review_window_secs),
    }
    if not isinstance(config, dict) or any(config.get(key) != value for key, value in expected.items()):
        raise RuntimeError("Deployed settings do not match the requested release")
    if normalized_address(config.get("treasury", "")) != treasury:
        raise RuntimeError("Deployed treasury does not match the requested wallet")

    record = {
        "contract": "BountyForge", "version": config["version"], "network": network_name,
        "address": address, "transaction_hash": str(tx_hash),
        "deployer": account.address, "deployer_role": "deployment_only_no_privileged_access",
        "signer_mode": signer_mode, "treasury": treasury,
        "constructor_args": {
            "fee_bps": args.fee_bps, "challenge_window_secs": args.challenge_window_secs,
            "appeal_window_secs": args.appeal_window_secs, "review_window_secs": args.review_window_secs,
            "treasury_address": treasury,
        },
        "source_sha256": digest, "receipt_status": "FINALIZED", "execution_result": "SUCCESS",
        "verified_source_and_config": True, "deployed_at": datetime.now(timezone.utc).isoformat(),
    }
    out_path = DEPLOYMENTS_DIR / f"bounty_forge_{network_name}.json"
    record_deployment(out_path, record)
    print(f"Verified BountyForge {config['version']} at {address}", flush=True)
    print(f"Source SHA-256: {digest}", flush=True)
    print(f"Updated {out_path}; previous deployment preserved in history.", flush=True)


if __name__ == "__main__":
    with rpc_connections():
        main()
