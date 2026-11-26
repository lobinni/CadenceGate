"""Minimal stand-in for the GenLayer runtime, used only by the local unit tests.

The tests exercise the pure logic of contracts/cadencegate.py: input guards,
policy validation and the scheduler. Nothing here touches a network or a node.
"""

import hashlib
import types


class _Web:
    """Records the requested document instead of fetching it."""

    def __init__(self, body: bytes = b""):
        self.body = body
        self.status = 200
        self.requests = []

    def get(self, url):
        self.requests.append(url)
        return types.SimpleNamespace(status=self.status, body=self.body)


class _Nondet:
    def __init__(self, web):
        self.web = web

    def exec_prompt(self, prompt, response_format=None):
        raise RuntimeError("exec_prompt is not available in unit tests")


class _VM:
    class Return:
        def __init__(self, calldata):
            self.calldata = calldata

    def __init__(self):
        self.messages = []

    def run_nondet_unsafe(self, leader, validator):
        raise RuntimeError("run_nondet_unsafe is not available in unit tests")


class _Message:
    def __init__(self, sender="0x" + "0" * 40):
        self.sender_address = sender


class TreeMap:
    """Generic container used by the contract for typed storage declarations."""

    def __class_getitem__(cls, item):
        return cls


class _Contract:
    def __init__(self, *args, **kwargs):
        self._storage = {}
        self.plans = _TreeMap(self._storage, "plans")
        self.catalogues = _TreeMap(self._storage, "catalogues")


class _TreeMap:
    def __init__(self, storage, prefix):
        self._storage = storage
        self._prefix = prefix

    def get(self, key, default=""):
        return self._storage.get(self._prefix + key, default)

    def __setitem__(self, key, value):
        self._storage[self._prefix + key] = value

    def __getitem__(self, key):
        return self._storage[self._prefix + key]

    def __contains__(self, key):
        return (self._prefix + key) in self._storage


def install(body: bytes = b"", sender: str = "0x" + "0" * 40):
    """Install the stub modules and return the namespace they expose."""
    web = _Web(body)
    package = types.ModuleType("genlayer")
    package.nondet = _Nondet(web)
    package.vm = _VM()
    package.message = _Message(sender)
    package.Contract = _Contract
    package.TreeMap = TreeMap
    package.public = types.SimpleNamespace(
        view=lambda *a, **k: (lambda fn: fn), write=lambda *a, **k: (lambda fn: fn)
    )
    # The contract addresses the runtime through the short `gl` alias.
    package.gl = package
    import sys

    sys.modules.setdefault("genlayer", package)
    return package
