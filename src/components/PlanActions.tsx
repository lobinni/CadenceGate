import { useState } from "react";
import { awaitReceipt, describeError, explorerUrlForHash, sendWrite } from "@/lib/chain";
import { STATE_COPY, type PlanRecord } from "@/domain/types";
import { shorten, type WalletSession } from "@/lib/state";
import { describeCall, type CallSummary } from "@/lib/call";
import { fetchFailureDetail, type FailureDetail } from "@/lib/failure";
import { deployment } from "@/config/contracts";
import { CallBlock, Notice, Pill, Spinner } from "./ui";

/**
 * Every write a named member can take on an existing plan.
 *
 * The planner and the ledger render the same component, so a plan can always be
 * acted on from wherever it is being read. Nothing here is decorative: each
 * button submits the real call, follows consensus and reports what happened.
 */
export function PlanActions({
  record,
  wallet,
  onNotify,
  onChanged,
}: {
  record: PlanRecord;
  wallet: WalletSession;
  onNotify: (tone: "good" | "warn" | "bad", title: string, detail: string) => void;
  /** Called after a write settles, so the caller can re-read the plan. */
  onChanged?: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [stage, setStage] = useState("");
  const [stageLabel, setStageLabel] = useState("");
  const [hash, setHash] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState<number | null>(null);
  const [call, setCall] = useState<CallSummary | null>(null);
  const [failure, setFailure] = useState<FailureDetail | null>(null);

  const account = wallet.account;
  const isMember = Boolean(
    account && record.input.members.some((member) => member.address.toLowerCase() === account),
  );
  const signed = Boolean(account && record.approvals.includes(account));
  const terminal = record.state === "COMMITTED" || record.state === "CANCELLED";
  const revision = record.revision;

  const run = async (label: string, method: string, args: unknown[]) => {
    setBusy(label);
    setHash(null);
    setElapsed(null);
    setCall(describeCall(method, args));
    setFailure(null);
    setStageLabel("Waiting for you");
    setStage("Confirm the request in your wallet.");
    try {
      const txHash = await sendWrite({ method, args });
      setHash(txHash);
      setStageLabel("Submitted");
      setStage("The network has the request. Consensus is running.");

      const receipt = await awaitReceipt(txHash, (snapshot, seconds) => {
        setStageLabel(snapshot.label);
        setStage(snapshot.detail);
        setElapsed(seconds);
      });

      if (receipt.stage === "FINALIZED") {
        setStageLabel("Finalized");
        setStage(`Finalized after ${receipt.elapsedSeconds}s. The ledger now holds the result.`);
        onNotify("good", "Finalized by consensus", `The network settled this request in ${receipt.elapsedSeconds}s.`);
        onChanged?.();
      } else if (receipt.stage === "FAILED") {
        setStageLabel(receipt.stage === "FAILED" && receipt.label ? receipt.label : "Refused");
        // The status only says consensus declined. The leader receipt still
        // holds the exact contract exception and the vote tally.
        const detail = await fetchFailureDetail(txHash, deployment.network().rpcUrl);
        const explanation = [receipt.detail, detail?.message].filter(Boolean).join(" ");
        setFailure(detail);
        setStage(explanation || "The network did not accept this request, so nothing was stored.");
        onNotify("bad", "The network refused this request", explanation || receipt.detail);
        onChanged?.();
      } else {
        setStageLabel("Still settling");
        setStage(`Consensus has not settled after ${receipt.elapsedSeconds}s. Follow the hash below; do not resubmit.`);
        onNotify(
          "warn",
          "Still settling",
          `Consensus is still running after ${receipt.elapsedSeconds}s. The submission is recorded under its own hash.`,
        );
        onChanged?.();
      }
    } catch (cause) {
      const described = describeError(cause);
      setStageLabel("Not sent");
      setStage(described.detail);
      onNotify("bad", described.title, described.detail);
    } finally {
      setBusy(null);
    }
  };

  if (terminal) {
    return (
      <Notice
        tone={record.state === "COMMITTED" ? "good" : "bad"}
        title={record.state === "COMMITTED" ? "Committed" : "Withdrawn"}
      >
        {record.state === "COMMITTED"
          ? `Every named member approved this schedule. It is final and can no longer change.`
          : `A named member withdrew this plan before commitment. Nothing further can be done with it.`}
      </Notice>
    );
  }

  if (!wallet.account) {
    return (
      <Notice tone="warn" title="Connect a member wallet">
        Only wallets listed in this roster may assess it, approve it or withdraw it.
      </Notice>
    );
  }

  if (!isMember) {
    return (
      <Notice tone="warn" title="This wallet is not on the roster">
        {`Only the ${record.input.members.length} named members may act on this plan. Switch to one of them to continue.`}
        <span className="mt-3 block t-label text-[var(--t-muted)]">{shorten(wallet.account, 10, 6)}</span>
      </Notice>
    );
  }

  return (
    <div className="space-y-5">
      {record.state === "SEALED" ? (
        <Notice tone="warn" title="Waiting for an assessment">
          The roster is frozen. Ask the network to read the documented allowance and compute the schedule; only then
          can members approve.
        </Notice>
      ) : null}

      {record.state === "REVIEW" ? (
        <Notice tone="warn" title="Returned for review">
          {record.observation?.policy.reason ||
            "The documented allowance for this basis could not be established, so no schedule was produced."}
        </Notice>
      ) : null}

      {record.state === "BLOCKED" ? (
        <Notice tone="bad" title="The workload does not fit">
          {record.proof?.reason || "At least one batch lands after the agreed window."}
        </Notice>
      ) : null}

      {record.state === "READY" && signed ? (
        <Notice tone="good" title="This wallet has already approved">
          Waiting for the remaining members. The plan commits on the final distinct approval.
        </Notice>
      ) : null}

      {record.state === "READY" ? (
        <div className="border border-[var(--t-line)] p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="stat-label">Approvals still needed</p>
            <Pill tone="night">
              {record.approvals.length} of {record.input.members.length}
            </Pill>
          </div>
          <ul className="mt-3">
            {record.input.members.map((member) => {
              const address = member.address.toLowerCase();
              const done = record.approvals.includes(address);
              const mine = Boolean(account && address === account);
              return (
                <li
                  key={address}
                  className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--t-line-soft)] py-3 last:border-b-0"
                >
                  <span className="min-w-0">
                    <strong className="block text-[14px]">{member.name}</strong>
                    <small className="t-label text-[var(--t-muted)]">{shorten(address, 10, 6)}</small>
                  </span>
                  <span className="flex items-center gap-2">
                    {mine ? <Pill tone="night">This wallet</Pill> : null}
                    <Pill tone={done ? "good" : "idle"}>{done ? "Approved" : "Waiting"}</Pill>
                  </span>
                </li>
              );
            })}
          </ul>
          {signed && record.approvals.length < record.input.members.length ? (
            <p className="mt-3 text-[13px] leading-[1.7] text-[var(--t-muted)]">
              Switch your wallet to one of the members still waiting, reopen this plan, and approve again. Each member
              signs with its own key, which is what makes the commitment independent.
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-3">
        {record.state === "SEALED" ? (
          <button
            type="button"
            className="t-btn primary"
            disabled={busy !== null}
            onClick={() => void run("assess", "assess", [record.id, revision])}
          >
            {busy === "assess" ? <Spinner /> : null}
            {busy === "assess" ? stage : "Assess under consensus"}
          </button>
        ) : null}

        {record.state === "READY" && !signed ? (
          <button
            type="button"
            className="t-btn primary"
            disabled={busy !== null}
            onClick={() =>
              void run("approve", "approve", [record.id, revision, record.allocation_hash ?? ""])
            }
          >
            {busy === "approve" ? <Spinner /> : null}
            {busy === "approve" ? stage : "Approve this schedule"}
          </button>
        ) : null}

        {record.state !== "SEALED" || busy === "cancel" ? (
          <button
            type="button"
            className="t-btn"
            disabled={busy !== null}
            onClick={() => void run("cancel", "cancel", [record.id, revision])}
          >
            {busy === "cancel" ? <Spinner /> : null}
            {busy === "cancel" ? stage : "Withdraw the plan"}
          </button>
        ) : null}
      </div>

      {record.state === "SEALED" && !busy ? (
        <p className="t-label text-[var(--t-muted)]">
          Assessing asks every validator to re-read the source document, so it is the slowest step.
        </p>
      ) : null}

      {hash ? (
        <div className="border border-[var(--t-line)] p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="stat-label">Submission</p>
            <Pill tone={elapsed === null ? "night" : "good"}>{stageLabel || "Submitted"}</Pill>
          </div>
          <p className="mt-3 text-[13px] leading-[1.65] text-[var(--t-muted)]">{stage}</p>

          {failure ? (
            <div className="mt-4 border border-[var(--t-danger)] p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="t-label text-[var(--t-danger)]">Refused by the contract</span>
                {failure.code ? <Pill tone="bad">{failure.code}</Pill> : null}
                {failure.errorCode ? <Pill tone="warn">{failure.errorCode}</Pill> : null}
              </div>
              <p className="mt-2 text-[13px] leading-[1.7] text-[var(--t-muted)]">{stage}</p>
            </div>
          ) : null}

          <CallBlock call={call} />

          <p className="mt-3 break-all text-[12px] leading-[1.6] text-[var(--t-accent-dark)]">
            {shorten(hash, 22, 12)}
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <a className="t-btn small" href={explorerUrlForHash(hash)} target="_blank" rel="noreferrer">
              Follow in explorer
            </a>
            {elapsed !== null ? <span className="t-label text-[var(--t-muted)]">elapsed {elapsed}s</span> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export { STATE_COPY };
