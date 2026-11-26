import { useCallback, useEffect, useState } from "react";
import { ms, type PlanRecord, type PlanState } from "@/domain/types";
import { isAddress } from "@/domain/validation";
import { CONTRACT_METHODS, methodForTransaction, looksLikeHash } from "@/lib/call";
import { deployment, explorerUrlFor } from "@/config/contracts";
import { readOwnedPlans, readPlan } from "@/lib/chain";
import { shorten, type WalletSession } from "@/lib/state";
import { ScheduleTimeline } from "./ScheduleTimeline";
import { PlanActions } from "./PlanActions";
import { Field, Notice, Pill, Spinner, StatePill } from "./ui";

interface Row {
  id: string;
  record: PlanRecord | null;
  error?: string;
}

export function Ledger({
  wallet,
  onNotify,
  version = 0,
  focusId = null,
  focusNonce = 0,
}: {
  wallet: WalletSession;
  onNotify: (tone: "good" | "warn" | "bad", title: string, detail: string) => void;
  /** Bumped by the planner after a write so this list re-reads the chain. */
  version?: number;
  /** Plan the planner asked us to show. */
  focusId?: string | null;
  /** Incremented on every request so re-inspecting the same plan re-runs. */
  focusNonce?: number;
}) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [pendingScroll, setPendingScroll] = useState(false);
  const [ledgerNonce, setLedgerNonce] = useState(0);
  const [lookupOwner, setLookupOwner] = useState("");
  const [lookupTag, setLookupTag] = useState("");
  const [txHash, setTxHash] = useState("");
  const [txMethod, setTxMethod] = useState<string | null>(null);
  const [txBusy, setTxBusy] = useState(false);

  const loadOwned = useCallback(async () => {
    if (!wallet.account) {
      setRows([]);
      return;
    }
    setLoading(true);
    try {
      const ids = await readOwnedPlans(wallet.account);
      const detailed = await Promise.all(
        ids.map(async (id) => {
          try {
            return { id, record: (await readPlan(id)) as PlanRecord } as Row;
          } catch {
            return { id, record: null, error: "unavailable" } as Row;
          }
        }),
      );
      setRows((prev) => {
        const owned = new Set(detailed.map((row) => row.id));
        return [...detailed, ...prev.filter((row) => !owned.has(row.id))];
      });
      setSelected((current) => current ?? detailed[0]?.id ?? null);
    } catch {
      // Keep whatever is already on screen; a transient failure must not hide a
      // record the user is looking at.
      onNotify("warn", "Ledger unavailable", "The endpoint did not answer. Try again in a moment.");
    } finally {
      setLoading(false);
    }
  }, [wallet.account, onNotify, version]);

  useEffect(() => {
    void loadOwned();
  }, [loadOwned]);

  /** Shows a plan and brings it into view once it has actually rendered. */
  const inspect = (id: string) => {
    setSelected(id);
    setPendingScroll(true);
  };

  // The planner can hand us a plan that is not in our own list yet (for example
  // one sealed by another wallet we are looking up). Read it directly.
  useEffect(() => {
    if (!focusId) return;
    inspect(focusId);
    let cancelled = false;
    (async () => {
      try {
        const record = (await readPlan(focusId)) as PlanRecord;
        if (cancelled) return;
        setRows((prev) => [{ id: focusId, record }, ...prev.filter((row) => row.id !== focusId)]);
      } catch {
        if (!cancelled) onNotify("warn", "Not readable yet", "That plan could not be read back from the chain.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [focusId, focusNonce, ledgerNonce, onNotify]);

  // The record only exists once the read resolves and PlanDetail mounts, so the
  // scroll is retried on every state change until the element is really there.
  useEffect(() => {
    if (!pendingScroll) return;
    const element = document.getElementById("ledger-record");
    if (!element) return;
    element.scrollIntoView({ behavior: "smooth", block: "start" });
    setPendingScroll(false);
  }, [pendingScroll, rows, selected]);

  const runLookup = async () => {
    if (!isAddress(lookupOwner)) {
      onNotify("warn", "Check the address", "A plan is stored under the wallet that sealed it.");
      return;
    }
    const id = `${lookupOwner.trim().toLowerCase()}:${lookupTag.trim()}`;
    setLoading(true);
    try {
      const record = (await readPlan(id)) as PlanRecord;
      setRows((prev) => [{ id, record }, ...prev.filter((row) => row.id !== id)]);
      setSelected(id);
      onNotify("good", "Record found", "The ledger returned this plan.");
    } catch {
      onNotify("bad", "Nothing stored there", "No plan exists for that wallet and reference combination.");
    } finally {
      setLoading(false);
    }
  };

  const active = rows.find((row) => row.id === selected) ?? null;

  /**
   * The explorer only carries compressed calldata, so a hash pasted in there
   * carries no function label. Read the payload back and name the entry point.
   */
  const decodeTransaction = async () => {
    setTxBusy(true);
    setTxMethod(null);
    try {
      const method = await methodForTransaction(txHash, deployment.network().rpcUrl);
      setTxMethod(method);
      if (!method) {
        onNotify(
          "warn",
          "No entry point found",
          "That payload does not contain a known entry point. Check the hash, or that it belongs to this contract.",
        );
      }
    } catch {
      onNotify("bad", "Could not read the transaction", "The endpoint did not return that hash.");
    } finally {
      setTxBusy(false);
    }
  };

  return (
    <div className="space-y-10">
      <div className="grid-2">
        <div className="panel">
          <div className="panel-head">
            <div>
              <p className="t-kicker">Public lookup</p>
              <h3 className="mt-2 text-[22px]">Find a published plan</h3>
            </div>
            <Pill tone="night">Read only</Pill>
          </div>
          <p className="mb-5 text-[13px] leading-[1.7] text-[var(--t-muted)]">
            Every committed plan is public. Enter the wallet that sealed it and the reference it was published under to
            read the full schedule and its approvals.
          </p>
          <div className="grid-2 -mx-[26px] border-t border-[var(--t-line)]">
            <div className="p-[22px]">
              <Field label="Sealing wallet">
                <input
                  value={lookupOwner}
                  spellCheck={false}
                  placeholder="0x…"
                  onChange={(event) => setLookupOwner(event.target.value)}
                />
              </Field>
            </div>
            <div className="p-[22px]">
              <Field label="Reference">
                <input value={lookupTag} placeholder="weekly-reporting" onChange={(event) => setLookupTag(event.target.value)} />
              </Field>
            </div>
          </div>
          <div className="mt-5 flex flex-wrap gap-3">
            <button type="button" className="t-btn primary" onClick={runLookup} disabled={loading}>
              {loading ? <Spinner /> : null}
              Read the ledger
            </button>
            <button type="button" className="t-btn" onClick={loadOwned} disabled={loading || !wallet.account}>
              Refresh my records
            </button>
          </div>

          <div className="mt-6 border-t border-[var(--t-line)] pt-5">
            <Field label="Label a transaction" hint="paste a hash from the explorer">
              <input
                value={txHash}
                spellCheck={false}
                placeholder="0x…"
                onChange={(event) => {
                  setTxHash(event.target.value);
                  setTxMethod(null);
                }}
              />
            </Field>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button
                type="button"
                className="t-btn"
                onClick={() => void decodeTransaction()}
                disabled={txBusy || !looksLikeHash(txHash)}
              >
                {txBusy ? <Spinner /> : null}
                Show the entry point
              </button>
              {txMethod ? (
                <Pill tone="good">called {txMethod}</Pill>
              ) : txHash && !looksLikeHash(txHash) ? (
                <span className="t-label text-[var(--t-warn)]">That is not a transaction hash</span>
              ) : null}
            </div>
            <p className="mt-3 text-[12px] leading-[1.7] text-[var(--t-muted)]">
              Entry points: {CONTRACT_METHODS.join(" · ")}.
            </p>
          </div>
        </div>

        <div className="panel">
          <div className="panel-head">
            <div>
              <p className="t-kicker">Your records</p>
              <h3 className="mt-2 text-[22px]">Plans this wallet sealed</h3>
            </div>
            {loading ? <Spinner /> : <Pill tone="idle">{rows.length} held</Pill>}
          </div>

          {!wallet.account ? (
            <Notice tone="warn" title="No wallet connected">
              Connect a wallet to list the plans it sealed. Public lookups work without one.
            </Notice>
          ) : rows.length === 0 ? (
            <Notice tone="good" title="Nothing sealed yet">
              Draft a plan in the planner and seal it. It will appear here straight after the network accepts it.
            </Notice>
          ) : (
            <div className="border-t border-[var(--t-line)]">
              <div className="table-row head">
                <span>Plan</span>
                <span>State</span>
                <span>Consent</span>
                <span>Last admission</span>
                <span>Open</span>
              </div>
              {rows.map((row) => (
                <div className="table-row" key={row.id}>
                  <div>
                    <strong className="block text-[15px]">{row.record?.input.title ?? row.id}</strong>
                    <small className="t-label text-[var(--t-muted)]">
                      reference {row.id.split(":")[1] ?? row.id}
                    </small>
                  </div>
                  <span>{row.record ? <StatePill state={row.record.state as PlanState} /> : "—"}</span>
                  <span>
                    {row.record ? `${row.record.approvals.length} of ${row.record.input.members.length}` : "—"}
                  </span>
                  <span>{row.record?.proof ? ms(row.record.proof.finish_ms) : "—"}</span>
                  <button
                    type="button"
                    className="t-btn small"
                    disabled={!row.record}
                    onClick={() => inspect(row.id)}
                  >
                    {row.record ? "Inspect" : "Unavailable"}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {active?.record ? (
        <PlanDetail
          record={active.record}
          wallet={wallet}
          onNotify={onNotify}
          onChanged={() => setLedgerNonce((value) => value + 1)}
        />
      ) : active ? (
        <Notice tone="warn" title="This plan could not be read back">
          {`Nothing readable is stored under ${active.id}. Check the reference, or that the transaction reached finality.`}
        </Notice>
      ) : null}
    </div>
  );
}

function PlanDetail({
  record,
  wallet,
  onNotify,
  onChanged,
}: {
  record: PlanRecord;
  wallet: WalletSession;
  onNotify: (tone: "good" | "warn" | "bad", title: string, detail: string) => void;
  onChanged?: () => void;
}) {
  const input = record.input;
  const policy = record.observation?.policy ?? null;
  const proof = record.proof ?? null;

  return (
    <div className="space-y-8" id="ledger-record">
      <div className="panel">
        <div className="panel-head">
          <div>
            <p className="t-kicker">Record</p>
            <h3 className="mt-2 text-[26px]">{input.title}</h3>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <StatePill state={record.state as PlanState} />
            <button
              type="button"
              className="t-btn small"
              onClick={() => {
                void navigator.clipboard?.writeText(record.id);
                onNotify("good", "Reference copied", record.id);
              }}
            >
              Copy reference
            </button>
            <a className="t-btn small" href={explorerUrlFor(record.owner)} target="_blank" rel="noreferrer">
              Open in explorer
            </a>
          </div>
        </div>

        <dl className="grid-4 -mx-[26px] border-y border-[var(--t-line)]">
          {[
            { label: "Reference", value: record.id.split(":")[1] ?? record.id },
            { label: "Sealed by", value: shorten(record.owner, 10, 6) },
            { label: "Requester class", value: labelise(input.requester) },
            { label: "Allowance basis", value: labelise(input.basis) },
            { label: "Maximum window", value: ms(input.horizon_ms) },
            { label: "Members", value: String(input.members.length) },
            { label: "Batches", value: String(input.jobs.length) },
            { label: "Revision", value: String(record.revision) },
          ].map((item) => (
            <div className="p-[22px]" key={item.label}>
              <dt className="stat-label">{item.label}</dt>
              <dd className="mt-2 text-[17px] font-semibold tracking-[-0.02em]">{item.value}</dd>
            </div>
          ))}
        </dl>

        {record.cancelled_by ? (
          <div className="mt-5">
            <Notice tone="bad" title="Withdrawn">
              {`A named member withdrew this plan before commitment.`}
            </Notice>
          </div>
        ) : null}
      </div>

      <div className="grid-2">
        <div className="panel">
          <div className="panel-head">
            <div>
              <p className="t-kicker">Documented policy</p>
              <h3 className="mt-2 text-[22px]">What the network agreed</h3>
            </div>
            {policy ? <Pill tone={policy.status === "KNOWN" ? "good" : "warn"}>{policy.status === "KNOWN" ? "Established" : "Not established"}</Pill> : <Pill tone="idle">Awaiting assessment</Pill>}
          </div>

          {policy && policy.status === "KNOWN" ? (
            <dl className="grid-2 -mx-[26px] border-y border-[var(--t-line)]">
              {[
                { label: "Allowance", value: `${(policy.allowance ?? 0).toLocaleString()} points` },
                { label: "Refill window", value: ms(policy.window_label === "MINUTE" ? 60000 : 3600000) },
                { label: "Model", value: labelise(policy.algorithm ?? "") },
                { label: "Applies to", value: labelise(policy.scope ?? "") },
              ].map((item) => (
                <div className="p-[22px]" key={item.label}>
                  <dt className="stat-label">{item.label}</dt>
                  <dd className="mt-2 text-[17px] font-semibold">{item.value}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="text-[13px] leading-[1.7] text-[var(--t-muted)]">
              {policy?.reason ||
                "No assessment has been recorded for this plan yet. A named member must request one before members can approve a schedule."}
            </p>
          )}

          <div className="mt-6 border-t border-[var(--t-line)] pt-6">
            <PlanActions record={record} wallet={wallet} onNotify={onNotify} onChanged={onChanged} />
          </div>

          {policy && policy.status === "KNOWN" ? (
            <p className="mt-5 text-[13px] leading-[1.7] text-[var(--t-muted)]">
              Validators re-read the same public document and compared every field independently. The figure above is
              the one the schedule was computed from.
            </p>
          ) : null}
        </div>

        <div className="panel">
          <div className="panel-head">
            <div>
              <p className="t-kicker">Member consent</p>
              <h3 className="mt-2 text-[22px]">Who signed what</h3>
            </div>
            <Pill tone={record.approvals.length === input.members.length ? "good" : "warn"}>
              {record.approvals.length} of {input.members.length}
            </Pill>
          </div>

          <div className="mb-5">
            <div className="progress-copy mb-2 flex justify-between">
              <span className="stat-label">Approvals</span>
              <span className="stat-label">
                {Math.round((record.approvals.length / Math.max(1, input.members.length)) * 100)} percent
              </span>
            </div>
            <div className="progress-track" style={{ ["--progress" as string]: `${(record.approvals.length / Math.max(1, input.members.length)) * 100}%` }}>
              <i />
            </div>
          </div>

          <ul className="border-t border-[var(--t-line)]">
            {input.members.map((member) => {
              const signed = record.approvals.includes(member.address.toLowerCase());
              return (
                <li key={member.address} className="flex items-center justify-between gap-4 border-b border-[var(--t-line-soft)] py-4">
                  <div>
                    <strong className="block text-[15px]">{member.name}</strong>
                    <small className="t-label text-[var(--t-muted)]">{shorten(member.address, 10, 6)}</small>
                  </div>
                  <Pill tone={signed ? "good" : "idle"}>{signed ? "Approved" : "Pending"}</Pill>
                </li>
              );
            })}
          </ul>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <div>
            <p className="t-kicker">Admission schedule</p>
            <h3 className="mt-2 text-[22px]">When each batch may run</h3>
          </div>
          {proof ? <Pill tone={proof.status === "READY" ? "good" : proof.status === "REVIEW" ? "warn" : "bad"}>{proof.status}</Pill> : null}
        </div>

        {proof ? (
          <>
            <dl className="grid-3 -mx-[26px] mb-6 border-y border-[var(--t-line)]">
              {[
                { label: "Total requested", value: `${proof.total_points.toLocaleString()} points` },
                { label: "Bucket capacity", value: `${proof.allowance_points.toLocaleString()} points` },
                { label: "Residual credit", value: `${proof.remaining_points.toLocaleString()} points` },
                { label: "Last admission", value: ms(proof.finish_ms) },
                { label: "Batches scheduled", value: String(proof.rows.length) },
                { label: "Past the window", value: String(proof.blockers.length) },
              ].map((item) => (
                <div className="p-[22px]" key={item.label}>
                  <dt className="stat-label">{item.label}</dt>
                  <dd className="mt-2 text-[18px] font-semibold">{item.value}</dd>
                </div>
              ))}
            </dl>
            <ScheduleTimeline
              proof={proof}
              members={input.members}
              labels={input.jobs.map((job) => job.label)}
              horizon={input.horizon_ms}
            />
          </>
        ) : (
          <p className="text-[13px] leading-[1.7] text-[var(--t-muted)]">
            The schedule appears once an assessment completes. Until then the roster stays sealed.
          </p>
        )}
      </div>
    </div>
  );
}

function labelise(value: string): string {
  return value.replace(/_/g, " ").toLowerCase();
}
