import type { ReactNode } from "react";
import type { CallSummary } from "@/lib/call";
import { STATE_COPY, type PlanState } from "@/domain/types";
import { cn } from "@/utils/cn";

export function Pill({
  tone,
  children,
  className,
}: {
  tone: "good" | "idle" | "warn" | "bad" | "night";
  children: ReactNode;
  className?: string;
}) {
  return <span className={cn("pill", tone, className)}>{children}</span>;
}

export function StatePill({ state }: { state: PlanState }) {
  const copy = STATE_COPY[state];
  return (
    <Pill tone={copy.tone} className={cn(state === "SEALED" && "idle")}>
      {copy.label}
    </Pill>
  );
}

export function Stat({
  label,
  value,
  note,
}: {
  label: string;
  value: ReactNode;
  note?: ReactNode;
}) {
  return (
    <div className="stat">
      <p className="stat-label">{label}</p>
      <p className="stat-value">{value}</p>
      {note ? <p className="stat-note">{note}</p> : null}
    </div>
  );
}

export function Notice({
  tone,
  title,
  children,
}: {
  tone: "good" | "warn" | "bad";
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className={cn("notice", tone)}>
      <span aria-hidden className="mt-[3px]">
        {tone === "good" ? "✦" : tone === "warn" ? "▲" : "✕"}
      </span>
      <p>
        <strong className="text-[13px] font-semibold">{title}</strong>
        {children ? <span className="block text-[13px] text-[var(--t-muted)]">{children}</span> : null}
      </p>
    </div>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="field">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <span className="t-label text-[var(--t-muted)]">{label}</span>
        {hint ? <span className="t-label text-[var(--t-accent-dark)]">{hint}</span> : null}
      </div>
      {children}
    </label>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly T[];
  value: T;
  onChange: (next: T) => void;
}) {
  return (
    <div className="seg">
      {options.map((option) => (
        <button
          key={option}
          type="button"
          className={cn(option === value && "on")}
          onClick={() => onChange(option)}
        >
          {labelise(option)}
        </button>
      ))}
    </div>
  );
}

export function labelise(value: string): string {
  return value.replace(/_/g, " ").toLowerCase();
}

export function Modal({
  open,
  title,
  kicker,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  kicker: string;
  onClose: () => void;
  children: ReactNode;
}) {
  if (!open) return null;
  return (
    <div className="t-modal" role="dialog" aria-modal="true" aria-label={title}>
      <div className="modal-panel fade-up">
        <p className="t-kicker">{kicker}</p>
        <h2 className="mt-3 text-[26px] tracking-[-0.05em]">{title}</h2>
        <div className="mt-5">{children}</div>
        <button type="button" className="t-btn small mt-7" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}

/**
 * States which contract entry point a submission reached, and with what. The
 * explorer only carries compressed calldata, so this is where the function name
 * is made visible.
 */
export function CallBlock({ call }: { call: CallSummary | null }) {
  if (!call) return null;
  return (
    <div className="mt-4 border-l-2 border-[var(--t-accent)] pl-3">
      <p className="stat-label">Contract call</p>
      <p className="mt-1 text-[14px] font-semibold text-[var(--t-ink)]">{call.method}</p>
      {call.lines.length > 0 ? (
        <ul className="mt-1">
          {call.lines.map((line, index) => (
            <li key={index} className="break-all font-mono text-[11px] leading-[1.7] text-[var(--t-muted)]">
              {line}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function Spinner() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" className="spin" aria-hidden fill="none" stroke="currentColor">
      <circle cx="12" cy="12" r="9" strokeOpacity="0.25" strokeWidth="2.5" />
      <path d="M21 12a9 9 0 0 0-9-9" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}
