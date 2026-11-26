/**
 * Explains a transaction the network refused.
 *
 * A failed write arrives as a bare "execution failed", and the status alone only
 * says consensus did not accept it. The leader receipt still carries the exact
 * contract exception and the vote tally, so read it back and say what happened.
 */

import { hasReason, messageFor } from "@/lib/reasons";

export interface FailureDetail {
  /** Contract exception, for example CLASS_ANCHOR. */
  code: string | null;
  /** Infrastructure error, for example LLM_RATE_LIMITED. */
  errorCode: string | null;
  votes: { agree: number; disagree: number; idle: number } | null;
  message: string;
}

function tally(votes: unknown): FailureDetail["votes"] {
  if (!votes || typeof votes !== "object") return null;
  const counts = { agree: 0, disagree: 0, idle: 0 };
  for (const value of Object.values(votes as Record<string, string>)) {
    const key = String(value).toLowerCase();
    if (key === "agree" || key === "disagree" || key === "idle") counts[key] += 1;
  }
  return counts;
}

function fromReceipt(receipt: Record<string, unknown>): { code: string | null; errorCode: string | null } {
  const consensus = (receipt.consensus_data ?? {}) as Record<string, unknown>;
  const leaders = (consensus.leader_receipt ?? []) as Record<string, unknown>[];
  for (const leader of leaders) {
    const genvm = (leader.genvm_result ?? {}) as Record<string, unknown>;
    const stderr = typeof genvm.stderr === "string" ? genvm.stderr : "";
    const match = stderr.match(/Exception:\s*([A-Z0-9_]+)/);
    const errorCode = typeof genvm.error_code === "string" ? genvm.error_code : null;
    if (match || errorCode) return { code: match?.[1] ?? null, errorCode };
  }
  return { code: null, errorCode: null };
}

/**
 * Renders only the facts this fetch actually recovered. The caller prepends the
 * status-level explanation, so an empty result here means "nothing extra to
 * add" rather than a placeholder sentence.
 */
function compose(detail: FailureDetail): string {
  const parts: string[] = [];

  if (detail.errorCode === "LLM_RATE_LIMITED") {
    parts.push(
      "The document reading step was rate limited while consensus was running, so no policy could be produced. " +
        "That is transient: the plan is unchanged, so run the assessment again in a moment.",
    );
  }
  if (detail.code) {
    parts.push(
      hasReason(detail.code)
        ? messageFor(detail.code)
        : `The contract raised ${detail.code}. Check the roster, the reference and the revision, then try again.`,
    );
  }

  const total = detail.votes ? detail.votes.agree + detail.votes.disagree + detail.votes.idle : 0;
  if (detail.votes && total > 0) {
    const verdict =
      detail.votes.disagree > 0
        ? `${detail.votes.disagree} of ${total} validators voted against it.`
        : `All ${total} validators agreed.`;
    parts.push(verdict);
  }

  return parts.join(" ");
}

/**
 * Reads the leader receipt for a settled transaction. Returns null when the
 * endpoint does not carry it, so callers can fall back to the status detail.
 */
export async function fetchFailureDetail(hash: string, rpcUrl: string): Promise<FailureDetail | null> {
  const value = hash.trim();
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) return null;

  try {
    const base = rpcUrl.replace(/\/$/, "");
    const response = await fetch(`${base}/explorer/transactions/${value}`, {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as { transaction?: Record<string, unknown> };
    const transaction = payload.transaction;
    if (!transaction) return null;

    const consensus = (transaction.consensus_data ?? {}) as Record<string, unknown>;
    const { code, errorCode } = fromReceipt(transaction);
    const votes = tally(consensus.votes);

    const hasVotes = votes ? votes.agree + votes.disagree + votes.idle > 0 : false;
    if (!code && !errorCode && !hasVotes) return null;
    const detail: FailureDetail = { code, errorCode, votes, message: "" };
    detail.message = compose(detail);
    return detail;
  } catch {
    return null;
  }
}
