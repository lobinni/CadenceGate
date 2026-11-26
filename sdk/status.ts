/**
 * One normalizer for GenLayer transaction status, shared by the interface and
 * the scripts.
 *
 * The endpoint answers in two different shapes: `gen_getTransactionStatus`
 * returns a bare string such as `"FINALIZED"`, while `eth_getTransactionByHash`
 * returns an object carrying `status`, `txExecutionResultName` and
 * `result_name`. Names arrive upper case on Studionet and title case elsewhere,
 * so every lookup is case-insensitive.
 */

export type ReceiptStage =
  | "QUEUED"
  | "PROPOSING"
  | "COMMITTING"
  | "REVEALING"
  | "ACCEPTED"
  | "FINALIZED"
  | "FAILED"
  | "UNKNOWN";

export interface StatusView {
  stage: ReceiptStage;
  label: string;
  detail: string;
  statusCode: number | null;
  execution: string | null;
  agreement: string | null;
}

interface Step {
  stage: ReceiptStage;
  label: string;
  detail: string;
}

const BY_CODE: Record<number, Step> = {
  0: { stage: "QUEUED", label: "Queued", detail: "Waiting for a leader to pick this up." },
  1: { stage: "QUEUED", label: "Pending", detail: "Waiting for activation." },
  2: { stage: "PROPOSING", label: "Proposing", detail: "The leader is executing the request." },
  3: { stage: "COMMITTING", label: "Committing", detail: "Validators are casting their votes." },
  4: { stage: "REVEALING", label: "Revealing", detail: "Votes are being revealed." },
  5: { stage: "ACCEPTED", label: "Accepted", detail: "Consensus agreed. Waiting to finalize." },
  6: { stage: "PROPOSING", label: "Undetermined", detail: "The round did not settle. Retrying." },
  7: { stage: "FINALIZED", label: "Finalized", detail: "Finalized by consensus." },
  8: { stage: "FAILED", label: "Cancelled", detail: "The network cancelled this request." },
  9: { stage: "REVEALING", label: "Appeal reveal", detail: "An appeal is being revealed." },
  10: { stage: "COMMITTING", label: "Appeal commit", detail: "An appeal vote is committing." },
  11: { stage: "FAILED", label: "Validator timeout", detail: "Validators ran out of time. Resubmit." },
  12: { stage: "FAILED", label: "Leader timeout", detail: "The leader ran out of time. Resubmit." },
  13: { stage: "PROPOSING", label: "Leader revealing", detail: "The leader is revealing its result." },
};

/** Lower-case status names, matching both Studionet and title-case spellings. */
const BY_NAME: Record<string, Step> = Object.fromEntries(
  Object.entries({
    uninitialized: BY_CODE[0],
    pending: BY_CODE[1],
    proposing: BY_CODE[2],
    committing: BY_CODE[3],
    revealing: BY_CODE[4],
    accepted: BY_CODE[5],
    undetermined: BY_CODE[6],
    finalized: BY_CODE[7],
    canceled: BY_CODE[8],
    cancelled: BY_CODE[8],
    appealrevealing: BY_CODE[9],
    appealcommitting: BY_CODE[10],
    validatorstimeout: BY_CODE[11],
    leadertimeout: BY_CODE[12],
    leaderrevealing: BY_CODE[13],
  }),
);

/** Execution verdicts that mean the contract did not change state. */
const BAD_EXECUTION: Record<string, string> = {
  finishedwitherror: "The contract rejected this request, so nothing was stored.",
  timeout: "The contract ran out of execution time, so nothing was stored.",
  notvoted: "",
};

const AGREEMENTS: Record<string, string> = {
  majoritydisagree: "Validators disagreed on the result.",
};

/** Lower-cases and drops separators so every spelling maps to one key. */
function norm(value: string): string {
  return value.trim().toLowerCase().replace(/[\s_-]/g, "");
}

function empty(over: Partial<StatusView> = {}): StatusView {
  return {
    stage: "UNKNOWN",
    label: "Reading status",
    detail: "The network has not reported a status yet.",
    statusCode: null,
    execution: null,
    agreement: null,
    ...over,
  };
}

function fromName(name: string): Step | null {
  return BY_NAME[norm(name)] ?? null;
}

function fromCode(code: number): Step | null {
  return BY_CODE[code] ?? null;
}

/**
 * Accepts a bare status string, a numeric code, or a full transaction object.
 * Returns null when the payload carries no recognisable status at all.
 */
export function readStatusValue(raw: unknown): StatusView | null {
  if (typeof raw === "string") {
    if (!raw.trim()) return null;
    const step = fromName(raw);
    return step ? empty({ ...step, statusCode: null }) : null;
  }

  if (typeof raw === "number") {
    const step = fromCode(raw);
    return step ? empty({ ...step, statusCode: raw }) : null;
  }

  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;

  const execution =
    typeof record.txExecutionResultName === "string"
      ? record.txExecutionResultName
      : typeof record.txExecutionResult === "string"
        ? record.txExecutionResult
        : null;

  const agreement =
    typeof record.result_name === "string"
      ? record.result_name
      : typeof record.resultName === "string"
        ? record.resultName
        : null;

  let step: Step | null = null;
  let code: number | null = null;

  if (typeof record.statusCode === "number") {
    code = record.statusCode;
    step = fromCode(code);
  } else if (typeof record.status === "number") {
    code = record.status;
    step = fromCode(code);
  } else if (typeof record.statusName === "string") {
    step = fromName(record.statusName);
  } else if (typeof record.status === "string") {
    step = fromName(record.status);
  } else if (typeof record.state === "string") {
    step = fromName(record.state);
  }

  if (!step) return null;

  const view = empty({ ...step, statusCode: code, execution, agreement });

  // A transaction can finalize by consensus and still fail to execute, and the
  // two explanations must not mask each other: disagreement is the reason the
  // network did not accept it, the execution verdict says the state is unchanged.
  const disagreement = agreement ? AGREEMENTS[norm(agreement)] : undefined;
  const verdict = execution ? BAD_EXECUTION[norm(execution)] : undefined;

  if (disagreement || verdict) {
    const detail = [disagreement, verdict].filter(Boolean).join(" ");
    return {
      ...view,
      stage: "FAILED",
      label: disagreement ? "Disagreed" : "Refused",
      detail: detail || "The network did not accept this request.",
    };
  }

  return view;
}

export function isWaiting(stage: ReceiptStage): boolean {
  return stage === "QUEUED" || stage === "PROPOSING" || stage === "COMMITTING" || stage === "REVEALING" || stage === "ACCEPTED" || stage === "UNKNOWN";
}
