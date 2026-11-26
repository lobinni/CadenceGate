import { ms, type Proof } from "@/domain/types";
import { timelineBounds } from "@/domain/scheduler";
import { Notice, Pill } from "./ui";

interface Props {
  proof: Proof;
  members: { name: string; address: string }[];
  labels: string[];
  horizon: number;
}

export function ScheduleTimeline({ proof, members, labels, horizon }: Props) {
  if (proof.status === "REVIEW") {
    return (
      <Notice tone="warn" title="No schedule to draw">
        {proof.reason}
      </Notice>
    );
  }

  if (proof.rows.length === 0) {
    return <Notice tone="warn" title="Nothing scheduled">Add at least one batch to see the admission line.</Notice>;
  }

  const { start, end } = timelineBounds(proof);
  const span = Math.max(end - start, 1);
  const scale = Math.max(span, horizon, 1);
  const place = (value: number) => `${Math.min(100, Math.max(0, ((value - start) / scale) * 100))}%`;

  const ticks = [0, 0.25, 0.5, 0.75, 1].map((ratio) => Math.round(start + span * ratio));

  return (
    <div className="fade-up">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Pill tone={proof.status === "READY" ? "good" : "bad"}>{proof.status === "READY" ? "Fits the window" : "Exceeds the window"}</Pill>
        <span className="t-label text-[var(--t-muted)]">
          Finished at {ms(proof.finish_ms)} of a {ms(horizon)} window
        </span>
      </div>

      <div className="mb-2 flex justify-between border-b border-[var(--t-line)] pb-2">
        {ticks.map((tick, index) => (
          <span key={index} className="t-label text-[var(--t-muted)]">
            {ms(tick)}
          </span>
        ))}
      </div>

      <div className="tl">
        {proof.rows.map((row) => {
          const member = members[row.member];
          const waitWidth = Math.max(0, ((row.admit_ms - Math.max(row.arrival_ms, start)) / scale) * 100);
          const batchWidth = Math.max(0.4, (Math.max(1, row.window_used_points) / Math.max(1, proof.allowance_points)) * 26);
          return (
            <div className="tl-row" key={row.job}>
              <div className="tl-name">
                <strong>{labels[row.job] ?? `Batch ${row.job + 1}`}</strong>
                <small>{member ? member.name : "Unassigned"}</small>
              </div>

              <div className="tl-track">
                <span className="tl-bar mark" style={{ left: place(row.arrival_ms) }} aria-hidden />
                {row.wait_ms > 0 ? (
                  <span
                    className="tl-bar wait"
                    style={{ left: place(Math.max(row.arrival_ms, start)), width: `${Math.min(100, waitWidth)}%` }}
                    aria-hidden
                  />
                ) : null}
                <span
                  className="tl-bar"
                  style={{ left: place(row.admit_ms), width: `${batchWidth}%` }}
                  aria-hidden
                />
              </div>

              <div className="tl-fig">
                <strong>{ms(row.admit_ms)}</strong>
                admitted
                {row.wait_ms > 0 ? <span className="block">waited {ms(row.wait_ms)}</span> : null}
              </div>
            </div>
          );
        })}
      </div>

      {proof.blockers.length > 0 ? (
        <div className="mt-5 space-y-3">
          {proof.blockers.map((blocker) => (
            <Notice
              key={blocker.job}
              tone="bad"
              title={`${labels[blocker.job] ?? `Batch ${blocker.job + 1}`} cannot fit`}
            >
              {blocker.over_capacity
                ? "A single batch this large is bigger than the whole documented allowance."
                : `The earliest possible slot lands ${ms(blocker.excess_ms ?? 0)} past the agreed window.`}
            </Notice>
          ))}
        </div>
      ) : (
        <Notice tone="good" title="Every batch lands inside the window">
          Members can approve this exact sequence. The contract reproduces the same numbers from the same inputs.
        </Notice>
      )}
    </div>
  );
}
