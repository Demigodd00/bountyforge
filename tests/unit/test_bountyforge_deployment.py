"""Release-pointer safeguards; no network, wallet secrets, or real transactions."""

import base64
import importlib.util
import json
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

import pytest


spec = importlib.util.spec_from_file_location(
    "bountyforge_deployment", Path(__file__).resolve().parents[2] / "scripts" / "deploy_bounty_forge.py"
)
deploy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deploy)

OLD = "0x" + "11" * 20
NEW = "0x" + "22" * 20
TREASURY = "0x" + "33" * 20
SIGNER = "0x" + "44" * 20
HASH = "0x" + "ab" * 32


def test_rpc_connections_are_bounded_and_restored_after_error(monkeypatch):
    previous = deploy.requests.post
    previous_family = deploy.urllib3.util.connection.allowed_gai_family
    monkeypatch.setenv("BOUNTYFORGE_PREFER_IPV4", "1")
    with pytest.raises(RuntimeError, match="test interruption"):
        with deploy.rpc_connections():
            assert deploy.requests.post.keywords["timeout"] == (10, 40)
            assert deploy.urllib3.util.connection.allowed_gai_family() == deploy.socket.AF_INET
            raise RuntimeError("test interruption")
    assert deploy.requests.post is previous
    assert deploy.urllib3.util.connection.allowed_gai_family is previous_family


def receipt(status="FINALIZED", result="SUCCESS"):
    return {
        "status_name": status,
        "consensus_data": {"leader_receipt": [{"execution_result": result}]},
        "tx_data_decoded": {"contract_address": NEW},
    }


@pytest.mark.parametrize("value", ["", None, "0x" + "00" * 20, "0x1234", "not an address"])
def test_requires_explicit_valid_nonzero_public_address(value):
    with pytest.raises(ValueError, match="nonzero public address"):
        deploy.normalized_address(value)


@pytest.mark.parametrize("status,result", [("ACCEPTED", "SUCCESS"), ("PENDING", "SUCCESS"), ("FINALIZED", "ERROR"), ("FINALIZED", None)])
def test_lifecycle_status_alone_does_not_activate_failed_execution(status, result):
    with pytest.raises(RuntimeError):
        deploy.verify_receipt(receipt(status, result))


def test_requires_successful_finalized_receipt_and_valid_address():
    tx = receipt()
    deploy.verify_receipt(tx)
    assert deploy.extract_contract_address(tx) == NEW
    with pytest.raises(ValueError, match="missing its contract address"):
        deploy.extract_contract_address({})


def test_verifies_the_actual_deployed_source_and_normalizes_windows_line_endings():
    client = SimpleNamespace(provider=Mock())
    client.provider.make_request.return_value = {"result": base64.b64encode(b"line one\nline two\n").decode()}
    assert deploy.verify_source(client, NEW, "line one\r\nline two\r\n") == deploy.source_digest("line one\nline two\n")
    client.provider.make_request.assert_called_once_with(method="gen_getContractCode", params=[NEW])
    with pytest.raises(RuntimeError, match="does not match"):
        deploy.verify_source(client, NEW, "different source")


@pytest.mark.parametrize("response", [{}, {"error": {"message": "unavailable"}}, {"result": "invalid base64!!"}])
def test_missing_or_malformed_source_is_not_activated(response):
    client = SimpleNamespace(provider=Mock())
    client.provider.make_request.return_value = response
    with pytest.raises(RuntimeError):
        deploy.verify_source(client, NEW, "source")


def test_previous_deployment_is_archived_before_pointer_changes(tmp_path):
    target = tmp_path / "bounty_forge_studionet.json"
    previous = {"address": OLD, "version": "2.0.0"}
    target.write_text(json.dumps(previous), encoding="utf-8")
    deploy.record_deployment(target, {"address": NEW, "version": "3.0.0"})
    archive = tmp_path / "history" / (target.stem + "_" + OLD[2:] + ".json")
    assert json.loads(archive.read_text(encoding="utf-8")) == previous
    assert json.loads(target.read_text(encoding="utf-8"))["previous_address"] == OLD
    assert not list(tmp_path.glob("*.tmp"))


def test_conflicting_history_never_overwrites_active_record(tmp_path):
    target = tmp_path / "bounty_forge_studionet.json"
    previous = {"address": OLD, "version": "2.0.0"}
    target.write_text(json.dumps(previous), encoding="utf-8")
    archive = tmp_path / "history" / (target.stem + "_" + OLD[2:] + ".json")
    archive.parent.mkdir()
    archive.write_text(json.dumps({"address": OLD, "version": "different"}), encoding="utf-8")
    with pytest.raises(RuntimeError, match="history differs"):
        deploy.record_deployment(target, {"address": NEW})
    assert json.loads(target.read_text(encoding="utf-8")) == previous


@pytest.mark.parametrize("network,args", [
    ("localnet", ["--treasury", TREASURY]),
    ("studionet", []),
    ("mainnet", ["--treasury", TREASURY]),
])
def test_disposable_signer_requires_studionet_and_explicit_treasury(monkeypatch, network, args):
    monkeypatch.setenv("BOUNTYFORGE_NETWORK", network)
    monkeypatch.setattr(deploy.sys, "argv", ["deploy", "--ephemeral-studionet-deployer", *args])
    create = Mock()
    monkeypatch.setattr(deploy.Account, "create", create)
    with pytest.raises(SystemExit):
        deploy.main()
    create.assert_not_called()


@pytest.mark.parametrize("failure", [None, "execution", "source", "config", "treasury"])
def test_release_pointer_changes_only_after_all_verification(monkeypatch, tmp_path, failure):
    code_path = tmp_path / "contract.py"
    code_path.write_text("validated contract\n", encoding="utf-8")
    target = tmp_path / "bounty_forge_studionet.json"
    target.write_text(json.dumps({"address": OLD, "version": "2.0.0"}), encoding="utf-8")
    account = SimpleNamespace(address=SIGNER)
    client = Mock()
    client.deploy_contract.return_value = HASH
    client.wait_for_transaction_receipt.return_value = receipt(result="ERROR" if failure == "execution" else "SUCCESS")
    client.provider.make_request.return_value = {"result": base64.b64encode(b"different\n" if failure == "source" else b"validated contract\n").decode()}
    client.read_contract.return_value = {
        "version": "2.0.0" if failure == "config" else "3.1.1",
        "funding_model": "WITHDRAWABLE_DEPOSIT_CREDIT_V1",
        "evidence_schema": "bountyforge-evidence-v3", "fee_bps": "0",
        "challenge_window_secs": "3600", "appeal_window_secs": "86400",
        "review_window_secs": "86400", "treasury": SIGNER if failure == "treasury" else TREASURY,
    }
    monkeypatch.setattr(deploy, "CODE_PATH", code_path)
    monkeypatch.setattr(deploy, "DEPLOYMENTS_DIR", tmp_path)
    create_client = Mock(return_value=client)
    monkeypatch.setattr(deploy, "create_client", create_client)
    monkeypatch.setattr(deploy.Account, "create", lambda: account)
    monkeypatch.setattr(deploy, "getpass", Mock(side_effect=AssertionError("Treasury key must never be requested")))
    monkeypatch.setenv("BOUNTYFORGE_NETWORK", "studionet")
    monkeypatch.setattr(deploy.sys, "argv", ["deploy", "--ephemeral-studionet-deployer", "--treasury", TREASURY])
    if failure:
        with pytest.raises(RuntimeError):
            deploy.main()
        assert json.loads(target.read_text(encoding="utf-8"))["address"] == OLD
    else:
        deploy.main()
        active = json.loads(target.read_text(encoding="utf-8"))
        assert active["address"] == NEW
        assert active["treasury"] == TREASURY
        assert active["deployer"] != active["treasury"]
        assert active["verified_source_and_config"] is True
        assert active["previous_address"] == OLD
    client.deploy_contract.assert_called_once_with(code="validated contract\n", account=account, args=[0, 3600, 86400, 86400, TREASURY])
    create_client.assert_called_once_with(chain=deploy.studionet, account=account)
