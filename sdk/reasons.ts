/**
 * Turns a GenLayer refusal into something a person can act on.
 *
 * A rejected write arrives wrapped in a generic viem error, but the contract's
 * own exception is still sitting in the simulation receipt's stderr. These
 * helpers walk that cause chain and map the code to plain language.
 */

interface Node {
  data?: { receipt?: { genvm_result?: { stderr?: string } } };
  cause?: Node;
}

/** Finds the contract's exception code inside the nested error payload. */
export function contractReason(error: unknown): string | null {
  let node = error as Node | undefined | null;
  for (let depth = 0; depth < 6 && node; depth += 1) {
    const stderr = node.data?.receipt?.genvm_result?.stderr;
    if (typeof stderr === "string") {
      const match = stderr.match(/Exception:\s*([A-Z0-9_]+)/);
      if (match) return match[1];
    }
    node = node.cause ?? null;
  }
  return null;
}

const REASONS: Record<string, string> = {
  OWNER_MUST_BE_MEMBER:
    "Only a wallet that appears in the roster may seal it. Add the connected wallet to the roster, or switch to one that is already listed.",
  MEMBER_ONLY: "Only wallets listed in this roster may take this step. Switch to a member wallet.",
  OWNER_LIMIT: "This wallet already holds the maximum number of published plans. Reuse or withdraw one of them.",
  ID_CONFLICT: "That reference already holds a different plan under this wallet. Choose another one.",
  NOT_FOUND: "Nothing is stored under that plan reference yet.",
  STALE_REVISION: "Another member advanced this plan. Re-read it from the ledger and act on the new revision.",
  NOT_SEALED: "This plan has already been assessed, so it cannot be assessed again.",
  NOT_READY: "Only a feasible plan can be approved. Assess it first, or resolve what is blocking it.",
  ALREADY_APPROVED: "This wallet has already approved this schedule. Each member approves once.",
  ALLOCATION_MISMATCH: "The schedule changed since you opened it. Re-read the plan and approve the current one.",
  PROOF_MISMATCH: "The stored schedule no longer matches its inputs. Withdraw the plan and draft it again.",
  TERMINAL: "This plan is already committed or cancelled, so it can no longer change.",
  TAG: "Plan references use three to thirty-two lowercase letters, digits and hyphens.",
  TITLE_BOUND: "The title must hold between 3 and 100 characters.",
  INPUT_SCHEMA: "The plan payload does not match the shape the contract expects.",
  MEMBER_COUNT: "A plan needs between 2 and 4 named members.",
  JOB_COUNT: "A plan needs at least one batch per member, and at most eight.",
  MISSING_MEMBER_WORKLOAD: "Every member needs at least one batch assigned.",
  DUPLICATE_WALLET: "Two members share the same wallet address.",
  DUPLICATE_NAME: "Two members share the same name.",
  ADDRESS: "That wallet address is not a valid hexadecimal account.",
  CONTROL_CHARACTER: "Remove invisible control characters from this field.",
  HORIZON: "The maximum window must stay between 1 and 60,000 milliseconds.",
  SOURCE_HTTP: "The source document could not be fetched. Try the assessment again.",
  SOURCE_DOCUMENT: "The fetched document did not contain the expected rate limit section.",
  SOURCE_SNAPSHOT_DISAGREEMENT:
    "Validators read different versions of the document. Try the assessment again.",
  UNGROUNDED_QUOTE: "An evidence quote does not appear in the source document.",
  QUOTE_BOUND: "An evidence quote is too long for the contract.",
  NUMBER_ANCHOR: "An evidence quote does not contain the number it is supposed to prove.",
  ALGORITHM_ANCHOR: "The quote for the model does not show that it describes a published limit.",
  CLASS_ANCHOR:
    "The quote for the requester class does not name the class it belongs to, such as per user or per installation.",
  WINDOW_ANCHOR: "The quote for the window does not contain hour or minute, so the refill period is unproven.",
  PRIVATE_QUOTA_UNVERIFIABLE:
    "A custom entitlement cannot be proven from a public document. Use a public basis, or withdraw the plan.",
  LLM_RATE_LIMITED:
    "The document reading step was rate limited while consensus ran, so no policy could be produced. It is transient: the plan is unchanged, so try again in a moment.",
  POLICY_SCOPE: "The model returned a policy this contract cannot schedule from.",
};

/** True when the code has a specific explanation rather than the fallback. */
export function hasReason(code: string): boolean {
  return code in REASONS;
}

export function messageFor(code: string): string {
  return (
    REASONS[code] ??
    "The contract refused this request. Check the roster, the reference and the revision, then try again."
  );
}

export const REASON_CODES = Object.keys(REASONS);
