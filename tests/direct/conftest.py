"""Shared deterministic setup for GenLayer direct-mode tests."""

from datetime import datetime, timezone
import sys

import pytest

TEST_NOW_UNIX = 2_000_000_000


@pytest.fixture(autouse=True)
def deterministic_direct_time(direct_vm) -> None:
    """Keep contract time deterministic across gltest host implementations.

    genlayer-test 0.29.2 does not refresh the already-loaded contract module's
    ``gl.message_raw`` clock after ``warp`` on a clean Linux extraction. Mirror
    the VM timestamp into those mutable message dictionaries until the upstream
    direct runner fixes the refresh path.
    """

    original_warp = direct_vm.warp

    def compatible_warp(timestamp: str) -> None:
        original_warp(timestamp)
        for module in tuple(sys.modules.values()):
            contract_gl = getattr(module, "gl", None)
            message_raw = getattr(contract_gl, "message_raw", None)
            if isinstance(message_raw, dict) and "datetime" in message_raw:
                message_raw["datetime"] = timestamp

    direct_vm.warp = compatible_warp
    direct_vm.warp(datetime.fromtimestamp(TEST_NOW_UNIX, tz=timezone.utc).isoformat())
