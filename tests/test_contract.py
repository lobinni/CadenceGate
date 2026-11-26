"""Unit tests for the pure logic inside contracts/cadencegate.py.

These tests run without a node and without the GenLayer runtime. They prove the
input guards, the policy validator and the scheduler behave exactly as the
protocol document says, so a failure here means the contract would fail on chain.
"""

import json
import os
import sys
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
for path in (ROOT, os.path.join(ROOT, "contracts"), os.path.dirname(os.path.abspath(__file__))):
    if path not in sys.path:
        sys.path.insert(0, path)

import genlayer_stub  # noqa: E402

genlayer_stub.install()
import cadencegate  # noqa: E402

WALLET_A = "0x" + "11" * 20
WALLET_B = "0x" + "22" * 20
WALLET_C = "0x" + "33" * 20

KNOWN = {
    "status": "KNOWN",
    "allowance": 5000,
    "window_label": "HOUR",
    "algorithm": "WINDOWED_ALLOWANCE",
    "scope": "REQUESTER_CLASS_DOCUMENTED_DEFAULT",
    "qualified": True,
    "evidence": {
        "allowance": "5,000 points per hour per user",
        "window_label": "points per hour",
        "algorithm": "primary rate limit",
        "scope": "points per hour per user",
        "qualified": "primary rate limit for authenticated users",
    },
    "reason": "",
}


def spec(**overrides):
    base = {
        "title": "Weekly reporting sweep",
        "requester": "USER_TOKEN",
        "basis": "PUBLIC_DEFAULT",
        "horizon_ms": 20000,
        "members": [
            {"name": "Reporting service", "address": WALLET_A},
            {"name": "Analytics worker", "address": WALLET_B},
        ],
        "jobs": [
            {"label": "Morning reconcile", "member": 0, "points": 900, "arrival_ms": 0},
            {"label": "Summary digest", "member": 1, "points": 1200, "arrival_ms": 1500},
            {"label": "Evening reconcile", "member": 0, "points": 900, "arrival_ms": 3000},
        ],
    }
    base.update(overrides)
    return base


class InputGuards(unittest.TestCase):
    def test_valid_specification_passes(self):
        self.assertEqual(cadencegate.specification(json.dumps(spec())), spec())

    def test_rejects_short_title(self):
        with self.assertRaisesRegex(Exception, "TEXT_BOUND"):
            cadencegate.specification(json.dumps(spec(title="ab")))

    def test_rejects_unknown_requester_class(self):
        with self.assertRaisesRegex(Exception, "REQUESTER_CLASS"):
            cadencegate.specification(json.dumps(spec(requester="SOMETHING_ELSE")))

    def test_rejects_out_of_range_window(self):
        with self.assertRaisesRegex(Exception, "HORIZON"):
            cadencegate.specification(json.dumps(spec(horizon_ms=70000)))

    def test_rejects_one_member(self):
        payload = spec(members=[{"name": "Solo", "address": WALLET_A}])
        with self.assertRaisesRegex(Exception, "MEMBER_COUNT"):
            cadencegate.specification(json.dumps(payload))

    def test_rejects_duplicate_wallet(self):
        payload = spec(
            members=[
                {"name": "One", "address": WALLET_A},
                {"name": "Two", "address": WALLET_A},
            ]
        )
        with self.assertRaisesRegex(Exception, "DUPLICATE_WALLET"):
            cadencegate.specification(json.dumps(payload))

    def test_rejects_duplicate_name(self):
        payload = spec(
            members=[
                {"name": "Same", "address": WALLET_A},
                {"name": "same", "address": WALLET_B},
            ]
        )
        with self.assertRaisesRegex(Exception, "DUPLICATE_NAME"):
            cadencegate.specification(json.dumps(payload))

    def test_rejects_non_hex_address(self):
        payload = spec(
            members=[
                {"name": "One", "address": "not-a-wallet"},
                {"name": "Two", "address": WALLET_B},
            ]
        )
        with self.assertRaisesRegex(Exception, "ADDRESS"):
            cadencegate.specification(json.dumps(payload))

    def test_rejects_batch_with_unknown_member(self):
        payload = spec(jobs=[{"label": "Only", "member": 5, "points": 10, "arrival_ms": 0},
                             {"label": "Other", "member": 1, "points": 10, "arrival_ms": 0}])
        with self.assertRaisesRegex(Exception, "JOB_MEMBER"):
            cadencegate.specification(json.dumps(payload))

    def test_rejects_member_without_batch(self):
        payload = spec(jobs=[{"label": "Only", "member": 0, "points": 10, "arrival_ms": 0},
                             {"label": "Again", "member": 0, "points": 10, "arrival_ms": 10}])
        with self.assertRaisesRegex(Exception, "MISSING_MEMBER_WORKLOAD"):
            cadencegate.specification(json.dumps(payload))

    def test_rejects_unknown_basis(self):
        with self.assertRaisesRegex(Exception, "BASIS"):
            cadencegate.specification(json.dumps(spec(basis="SPECIAL_CASE")))


class PolicyValidation(unittest.TestCase):
    def test_known_policy_is_accepted(self):
        accepted = cadencegate.policy(json.dumps(KNOWN), spec())
        self.assertEqual(accepted["allowance"], 5000)

    def test_unknown_policy_keeps_only_reason(self):
        body = dict(status="UNKNOWN", allowance=None, window_label=None, algorithm=None,
                    scope=None, qualified=None, evidence={}, reason="The class is not documented.")
        accepted = cadencegate.policy(json.dumps(body), spec())
        self.assertEqual(accepted["status"], "UNKNOWN")

    def test_private_basis_is_refused(self):
        payload = spec(basis="ACCOUNT_CUSTOM")
        with self.assertRaisesRegex(Exception, "PRIVATE_QUOTA_UNVERIFIABLE"):
            cadencegate.policy(json.dumps(KNOWN), payload)

    def test_ungrounded_quote_is_refused(self):
        with self.assertRaisesRegex(Exception, "UNGROUNDED_QUOTE"):
            cadencegate.policy(json.dumps(KNOWN), spec(), source="this text contains none of the quotes")

    def test_number_must_appear_in_the_quote(self):
        broken = dict(KNOWN)
        broken["evidence"] = dict(KNOWN["evidence"], allowance="no number here at all")
        with self.assertRaisesRegex(Exception, "NUMBER_ANCHOR"):
            cadencegate.policy(json.dumps(broken), spec())

    def test_window_word_must_match_the_label(self):
        broken = dict(KNOWN)
        broken["evidence"] = dict(KNOWN["evidence"], window_label="per minute")
        with self.assertRaisesRegex(Exception, "WINDOW_ANCHOR"):
            cadencegate.policy(json.dumps(broken), spec())


class Scheduler(unittest.TestCase):
    def schedule(self, payload, policy=None):
        return cadencegate.schedule(payload, policy or KNOWN)

    def test_ready_plan_admits_immediately(self):
        proof = self.schedule(spec())
        self.assertEqual(proof["status"], "READY")
        self.assertEqual([row["admit_ms"] for row in proof["rows"]], [0, 1500, 3000])
        self.assertEqual(proof["finish_ms"], 3000)
        self.assertEqual(proof["remaining_points"], 2000)

    def test_bucket_starts_full(self):
        proof = self.schedule(spec())
        self.assertEqual(proof["rows"][0]["before_points"], 5000)

    def test_listing_order_is_the_fifo_order(self):
        """The owner's listing decides admission order; arrivals never reorder it."""
        payload = spec(
            jobs=[
                {"label": "Listed first", "member": 0, "points": 10, "arrival_ms": 4000},
                {"label": "Listed second", "member": 1, "points": 10, "arrival_ms": 100},
            ]
        )
        proof = self.schedule(payload)
        self.assertEqual([row["job"] for row in proof["rows"]], [0, 1])
        self.assertEqual(proof["rows"][0]["admit_ms"], 4000)
        self.assertEqual(proof["rows"][1]["admit_ms"], 4000)
        self.assertEqual(proof["rows"][1]["before_points"], 4990)
        self.assertEqual(proof["rows"][1]["after_points"], 4980)

    def test_arrival_delays_admission_within_the_listing(self):
        payload = spec(
            jobs=[
                {"label": "First", "member": 0, "points": 10, "arrival_ms": 0},
                {"label": "Second", "member": 1, "points": 10, "arrival_ms": 2500},
            ]
        )
        proof = self.schedule(payload)
        self.assertEqual(proof["rows"][1]["admit_ms"], 2500)
        self.assertEqual(proof["rows"][1]["wait_ms"], 0)

    def test_batch_larger_than_allowance_is_over_capacity(self):
        payload = spec(jobs=[{"label": "Huge", "member": 0, "points": 6000, "arrival_ms": 0},
                             {"label": "Small", "member": 1, "points": 10, "arrival_ms": 0}])
        proof = self.schedule(payload)
        self.assertEqual(proof["status"], "BLOCKED")
        self.assertTrue(proof["blockers"][0]["over_capacity"])

    def test_window_rollover_produces_exact_excess(self):
        payload = spec(jobs=[{"label": "First", "member": 0, "points": 3000, "arrival_ms": 0},
                             {"label": "Second", "member": 1, "points": 3000, "arrival_ms": 500}])
        proof = self.schedule(payload)
        self.assertEqual(proof["status"], "BLOCKED")
        self.assertEqual(proof["blockers"][0]["excess_ms"], 3580000)

    def test_review_when_policy_is_unknown(self):
        proof = self.schedule(spec(), {"status": "UNKNOWN", "reason": "not documented"})
        self.assertEqual(proof["status"], "REVIEW")
        self.assertEqual(proof["rows"], [])

    def test_credit_conservation_across_rows(self):
        payload = spec()
        proof = self.schedule(payload)
        for row, job in zip(proof["rows"], payload["jobs"]):
            self.assertEqual(row["before_points"] - row["after_points"], job["points"])
            self.assertLessEqual(row["before_points"], proof["allowance_points"])
            self.assertGreaterEqual(row["after_points"], 0)
            self.assertGreaterEqual(row["window_used_points"], job["points"])
        self.assertEqual(proof["rows"][0]["before_points"], 5000)
        self.assertEqual(proof["remaining_points"], proof["rows"][-1]["after_points"])

    def test_minimum_delay_is_honoured(self):
        payload = spec(jobs=[{"label": "First", "member": 0, "points": 3000, "arrival_ms": 0},
                             {"label": "Second", "member": 1, "points": 3000, "arrival_ms": 0}])
        proof = self.schedule(payload)
        second = proof["rows"][1]
        self.assertEqual(second["admit_ms"], cadencegate.WINDOW_MS["HOUR"])
        self.assertEqual(second["before_points"], 5000)
        self.assertEqual(second["after_points"], 2000)

    def test_schedule_is_deterministic(self):
        payload = spec()
        self.assertEqual(self.schedule(payload), self.schedule(payload))


class Digests(unittest.TestCase):
    def test_digest_is_stable_and_key_order_free(self):
        first = cadencegate.digest({"a": 1, "b": 2})
        second = cadencegate.digest({"b": 2, "a": 1})
        self.assertEqual(first, second)
        self.assertEqual(len(first), 64)


if __name__ == "__main__":
    unittest.main()


class Grounding(unittest.TestCase):
    """Evidence must come from the document, decoration aside."""

    SOURCE = (
        "--- title: Rate limits and query limits for the GraphQL API --- "
        "* _For users_: 5,000 points per hour per user. This includes requests made with a "
        "{% data variables.product.pat_generic %} token."
    )

    def test_plain_strips_decoration_and_collapses_space(self):
        self.assertEqual(
            cadencegate.plain("  **5,000**\tpoints   per `hour` "),
            "5,000 points per hour",
        )

    def test_a_faithful_span_with_dropped_markers_still_matches(self):
        quote = "requests made with a token"
        self.assertIn(cadencegate.plain(quote), cadencegate.plain(self.SOURCE))

    def test_a_faithful_span_keepng_markers_still_matches(self):
        quote = "requests made with a {% data variables.product.pat_generic %} token"
        self.assertIn(cadencegate.plain(quote), cadencegate.plain(self.SOURCE))

    def test_a_paraphrase_is_still_rejected(self):
        with self.assertRaisesRegex(Exception, "UNGROUNDED_QUOTE"):
            cadencegate.policy(
                json.dumps(dict(KNOWN, evidence=dict(
                    KNOWN["evidence"],
                    allowance="five thousand points every hour",
                ))),
                spec(),
                source=self.SOURCE,
            )

    def test_a_decoration_only_quote_is_rejected(self):
        with self.assertRaisesRegex(Exception, "UNGROUNDED_QUOTE"):
            cadencegate.policy(
                json.dumps(dict(KNOWN, evidence=dict(KNOWN["evidence"], allowance="`**`"))),
                spec(),
                source=self.SOURCE,
            )

    def test_grounding_is_skipped_when_no_source_is_supplied(self):
        accepted = cadencegate.policy(json.dumps(KNOWN), spec(), source=None)
        self.assertEqual(accepted["allowance"], 5000)
