import { deployment } from "@/config/contracts";
import type { PlanRecord } from "@/domain/types";
import type { WalletSession } from "@/lib/state";
import { cn } from "@/utils/cn";
import { Pill } from "./ui";

type StepState = "done" | "current" | "todo";

interface Step {
  label: string;
  hint: string;
  state: StepState;
}

/**
 * Live test rail: shows exactly where the walkthrough stands and what to do
 * next. Every node maps to a real precondition, so nothing on this rail is
 * decorative.
 */
export function TestFlow({
  wallet,
  configured,
  guardOk,
  record,
  rosterFilled,
}: {
  wallet: WalletSession;
  configured: boolean;
  guardOk: boolean;
  record: PlanRecord | null;
  rosterFilled: boolean;
}) {
  const steps: Step[] = [
    {
      label: "Wallet",
      hint: "Connect an account you control",
      state: wallet.account ? "done" : "current",
    },
    {
      label: `Chain ${deployment.network().chainId}`,
      hint: wallet.account ? "Switch the wallet to the right network" : "Comes with the wallet step",
      state: !wallet.account ? "todo" : wallet.onExpectedChain ? "done" : "current",
    },
    {
      label: "Contract",
      hint: configured ? "Live target selected" : "Set an address in the top bar",
      state: configured ? (wallet.account && wallet.onExpectedChain ? "done" : "current") : "current",
    },
    {
      label: "Roster",
      hint: rosterFilled ? "Every member has a wallet and a batch" : "Fill the member addresses",
      state: !configured
        ? "todo"
        : rosterFilled
          ? guardOk
            ? "done"
            : "current"
          : "current",
    },
    {
      label: "Seal",
      hint: record ? "Frozen on the ledger" : "Freeze the roster on chain",
      state: record ? "done" : guardOk ? "current" : "todo",
    },
    {
      label: "Assess",
      hint: record?.observation ? "Allowance agreed by consensus" : "Ask the network to read the source",
      state: !record
        ? "todo"
        : record.observation
          ? record.state === "REVIEW" || record.state === "BLOCKED"
            ? "done"
            : "done"
          : "current",
    },
    {
      label: "Commit",
      hint: record?.state === "COMMITTED" ? "Every member approved" : "Each member approves the schedule",
      state:
        record?.state === "COMMITTED"
          ? "done"
          : record?.state === "READY"
            ? "current"
            : record?.state === "REVIEW" || record?.state === "BLOCKED"
              ? "todo"
              : "todo",
    },
  ];

  const firstTodo = steps.findIndex((step) => step.state !== "done");
  const progress = Math.round((steps.filter((step) => step.state === "done").length / steps.length) * 100);

  return (
    <div className="panel">
      <div className="panel-head">
        <div>
          <p className="t-kicker">Live walkthrough</p>
          <h3 className="mt-2 text-[24px]">Where you are</h3>
        </div>
        <div className="flex items-center gap-3">
          <Pill tone={progress === 100 ? "good" : "night"}>{progress}% complete</Pill>
        </div>
      </div>

      <ol className="grid grid-cols-2 border-t border-[var(--t-line)] sm:grid-cols-4 lg:grid-cols-7">
        {steps.map((step, index) => (
          <li
            key={step.label}
            className={cn(
              "border-r border-b border-[var(--t-line-soft)] p-4 last:border-r-0",
              step.state === "done" && "bg-[var(--t-accent-soft)]",
              step.state === "current" && index === firstTodo && "bg-[#fbfcf9]",
            )}
          >
            <div className="flex items-center gap-2">
              <span
                aria-hidden
                className={cn(
                  "grid h-6 w-6 shrink-0 place-items-center border font-mono text-[10px] font-medium",
                  step.state === "done"
                    ? "border-[var(--t-accent-dark)] bg-[var(--t-accent-dark)] text-[#f8fcf9]"
                    : step.state === "current"
                      ? "border-[var(--t-accent-dark)] text-[var(--t-accent-dark)]"
                      : "border-[var(--t-line)] text-[var(--t-muted)]",
                )}
              >
                {step.state === "done" ? "✓" : index + 1}
              </span>
              <span
                className={cn(
                  "t-label",
                  step.state === "done"
                    ? "text-[var(--t-accent-dark)]"
                    : step.state === "current"
                      ? "text-[var(--t-ink)]"
                      : "text-[var(--t-muted)]",
                )}
              >
                {step.label}
              </span>
            </div>
            <p className="mt-2 text-[11px] leading-[1.55] text-[var(--t-muted)]">{step.hint}</p>
          </li>
        ))}
      </ol>

      <div className="progress-track mt-4" style={{ ["--progress" as string]: `${progress}%` }}>
        <i />
      </div>

      {firstTodo >= 0 ? (
        <p className="mt-4 text-[13px] leading-[1.7] text-[var(--t-muted)]">
          <span className="text-[var(--t-ink)]">Next:</span> {steps[firstTodo].hint}.
        </p>
      ) : (
        <p className="mt-4 text-[13px] leading-[1.7] text-[var(--t-muted)]">
          <span className="text-[var(--t-ink)]">Complete.</span> Every step of the walkthrough has been exercised
          against the live contract.
        </p>
      )}
    </div>
  );
}
