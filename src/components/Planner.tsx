import { useCallback, useEffect, useMemo, useState } from "react";
import { deployment } from "@/config/contracts";
import {
  ALLOWANCE_BASES,
  REQUESTER_CLASSES,
  STATE_COPY,
  ms,
  type AllowanceBasis,
  type Job,
  type Member,
  type PlanInput,
  type PlanRecord,
  type PlanState,
  type Proof,
  type RequesterClass,
} from "@/domain/types";
import { buildProof } from "@/domain/scheduler";
import { SAMPLES, cloneSample, type Sample } from "@/domain/samples";
import { isAddress } from "@/domain/validation";
import { guardPlan, guardTag, guardTitle, guardMembers, messageFor, ok, type Guard } from "@/domain/validation";
import {
  awaitReceipt,
  describeError,
  explorerUrlForHash,
  readOwnedPlans,
  readPlan,
  sendWrite,
} from "@/lib/chain";
import { describeCall, type CallSummary } from "@/lib/call";
import { shorten, type WalletSession } from "@/lib/state";
import { ScheduleTimeline } from "./ScheduleTimeline";
import { PlanActions } from "./PlanActions";
import { TestFlow } from "./TestFlow";
import { CallBlock, Field, Notice, Pill, Segmented, Spinner, StatePill } from "./ui";
import { cn } from "@/utils/cn";

/**
 * Published default allowances per requester class. These are the documented
 * public figures the contract re-reads under consensus; the browser uses them
 * only to preview feasibility before a transaction is spent.
 */
const PUBLISHED_DEFAULTS: Record<RequesterClass, number> = {
  USER_TOKEN: 5000,
  APP_INSTALLATION: 5000,
  OAUTH_APP: 5000,
  WORKFLOW_TOKEN: 1000,
};

const DOCUMENTED_WINDOW_MS = 3600000;

interface Draft {
  tag: string;
  title: string;
  requester: RequesterClass;
  basis: AllowanceBasis;
  horizon_ms: number;
  members: Member[];
  jobs: Job[];
}

const EMPTY_DRAFT: Draft = {
  tag: "",
  title: "",
  requester: "USER_TOKEN",
  basis: "PUBLIC_DEFAULT",
  horizon_ms: 20000,
  members: [
    { name: "", address: "" },
    { name: "", address: "" },
  ],
  jobs: [
    { label: "", member: 0, points: 40, arrival_ms: 0 },
    { label: "", member: 1, points: 40, arrival_ms: 0 },
  ],
};

function emptyJob(member: number): Job {
  return { label: "", member, points: 20, arrival_ms: 0 };
}

export function Planner({
  wallet,
  onNotify,
  onGoLedger,
  onPlanPublished,
}: {
  wallet: WalletSession;
  onNotify: (tone: "good" | "warn" | "bad", title: string, detail: string) => void;
  onGoLedger: (planId?: string) => void;
  onPlanPublished?: () => void;
}) {
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [busy, setBusy] = useState<string | null>(null);
  const [record, setRecord] = useState<PlanRecord | null>(null);
  const [hash, setHash] = useState<string | null>(null);
  const [stage, setStage] = useState<string>("");
  const [stageLabel, setStageLabel] = useState<string>("");
  const [elapsed, setElapsed] = useState<number | null>(null);
  const [call, setCall] = useState<CallSummary | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadedSample, setLoadedSample] = useState<string | null>(null);
  const [owned, setOwned] = useState<PlanRecord[]>([]);
  const [ownedNonce, setOwnedNonce] = useState(0);

  const patch = useCallback((next: Partial<Draft>) => setDraft((prev) => ({ ...prev, ...next })), []);

  const input: PlanInput = useMemo(
    () => ({
      title: draft.title,
      requester: draft.requester,
      basis: draft.basis,
      horizon_ms: draft.horizon_ms,
      members: draft.members,
      jobs: draft.jobs,
    }),
    [draft],
  );

  const guard: Guard = useMemo(() => {
    const tag = guardTag(draft.tag);
    if (!tag.ok) return tag;
    const title = guardTitle(draft.title);
    if (!title.ok) return title;
    const members = guardMembers(draft.members);
    if (!members.ok) return members;
    return guardPlan(input);
  }, [draft, input]);

  const preview: Proof = useMemo(() => {
    const allowance = PUBLISHED_DEFAULTS[draft.requester];
    return buildProof(
      input,
      draft.basis === "PUBLIC_DEFAULT"
        ? {
            status: "KNOWN",
            allowance,
            window_label: "HOUR",
            algorithm: "WINDOWED_ALLOWANCE",
            scope: "REQUESTER_CLASS_DOCUMENTED_DEFAULT",
            qualified: true,
            evidence: {},
            reason: "",
          }
        : {
            status: "UNKNOWN",
            allowance: null,
            window_label: null,
            algorithm: null,
            scope: null,
            qualified: null,
            evidence: {},
            reason: "Custom entitlements cannot be proven from a public document.",
          },
    );
  }, [input, draft.requester, draft.basis]);

  const planId = wallet.account ? `${wallet.account}:${draft.tag}` : "";

  const reload = useCallback(async () => {
    if (!planId || !guardTag(draft.tag).ok) return;
    setLoadError(null);

    // A write can be accepted before the read path catches up, and a single
    // failed read must never hide a plan that already exists on the ledger.
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        const body = (await readPlan(planId)) as PlanRecord;
        setRecord(body);
        return;
      } catch (cause) {
        const code = cause instanceof Error ? cause.message : "";
        if (code === "NO_CONTRACT") {
          setLoadError("NO_CONTRACT");
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 1200 * (attempt + 1)));
      }
    }
  }, [planId, draft.tag]);

  useEffect(() => {
    setRecord(null);
    void reload();
  }, [reload]);

  /**
   * Everything this wallet has published, so a member with several plans can
   * pick the one to assess instead of guessing which tag is in the form.
   */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!wallet.account) {
        if (!cancelled) setOwned([]);
        return;
      }
      try {
        const ids = await readOwnedPlans(wallet.account);
        const records = await Promise.all(
          ids.map((id) => readPlan(id).then((body) => body as PlanRecord).catch(() => null)),
        );
        if (!cancelled) setOwned(records.filter((entry): entry is PlanRecord => Boolean(entry)));
      } catch {
        if (!cancelled) setOwned([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [wallet.account, ownedNonce]);

  /** Re-read the published list after any write settles. */
  const notePublished = useCallback(() => {
    onPlanPublished?.();
    setOwnedNonce((value) => value + 1);
  }, [onPlanPublished]);

  const run = useCallback(
    async (
      label: string,
      action: () => Promise<string>,
      after?: () => Promise<void>,
      sent?: { method: string; args: unknown[] },
    ) => {
      setBusy(label);
      setHash(null);
      setElapsed(null);
      setCall(sent ? describeCall(sent.method, sent.args) : null);
      setStageLabel("Waiting for you");
      setStage("Confirm the request in your wallet.");
      try {
        const txHash = await action();
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
        } else if (receipt.stage === "FAILED") {
          setStageLabel("Refused");
          setStage(receipt.detail);
          onNotify("bad", "The network refused the request", receipt.detail);
        } else {
          setStageLabel("Still settling");
          setStage(
            `Consensus has not settled after ${receipt.elapsedSeconds}s. Nothing was lost - follow the hash below or reopen the plan from the ledger.`,
          );
          onNotify(
            "warn",
            "Still settling",
            `Consensus is still running after ${receipt.elapsedSeconds}s. The submission is recorded under its own hash; do not resubmit it.`,
          );
        }

        if (receipt.stage === "FINALIZED") notePublished();
        await after?.();
        await reload();
      } catch (cause) {
        const described = describeError(cause);
        setStageLabel("Not sent");
        setStage(described.detail);
        onNotify("bad", described.title, described.detail);
      } finally {
        setBusy(null);
      }
    },
    [onNotify, reload, notePublished],
  );

  const seal = () =>
    run(
      "seal",
      () => sendWrite({ method: "seal", args: [draft.tag, JSON.stringify(input)] }),
      reload,
      { method: "seal", args: [draft.tag, JSON.stringify(input)] },
    );

  const onRoster = Boolean(
    wallet.account && draft.members.some((member) => member.address.trim().toLowerCase() === wallet.account),
  );

  /** Puts the connected wallet on the roster, adding a batch for it when needed. */
  const addSelf = () => {
    if (!wallet.account) return;
    const members = [...draft.members];
    const jobs = [...draft.jobs];
    let index = members.findIndex((member) => member.address.trim() === "");

    if (index === -1) {
      if (members.length >= 4) return;
      index = members.length;
      members.push({ name: `Member ${index + 1}`, address: wallet.account });
      jobs.push({ label: `Batch ${jobs.length + 1}`, member: index, points: 50, arrival_ms: 0 });
    } else {
      members[index] = {
        ...members[index],
        name: members[index].name.trim() || `Member ${index + 1}`,
        address: wallet.account,
      };
      if (!jobs.some((job) => job.member === index)) {
        jobs.push({ label: `Batch ${jobs.length + 1}`, member: index, points: 50, arrival_ms: 0 });
      }
    }
    patch({ members, jobs });
  };

  const recordTitle = record ? (record.input.title || record.id.split(":")[1] || "This plan") : "This plan";

  /** Every member must hold a wallet and at least one batch before sealing. */
  const rosterFilled =
    draft.members.length >= 2 &&
    draft.members.every((member) => isAddress(member.address)) &&
    draft.members.every((_, index) => draft.jobs.some((job) => job.member === index));

  const configured = deployment.isConfigured();

  /**
   * Fills the whole payload from a catalogue entry. Member addresses stay blank
   * on purpose: they must be wallets the tester controls, because the sealing
   * wallet has to be on the roster and every member signs separately.
   */
  const loadSample = (sample: Sample) => {
    const payload = cloneSample(sample);
    patch({
      tag: sample.tag,
      title: payload.title,
      requester: payload.requester,
      basis: payload.basis,
      horizon_ms: payload.horizon_ms,
      members: payload.members.map((member) => ({ ...member, address: "" })),
      jobs: payload.jobs,
    });
    setLoadedSample(sample.key);
    onNotify(
      "good",
      `${sample.label} loaded`,
      `${sample.expected}. Add a wallet to each member slot, then seal.`,
    );
  };

  const useMyWallet = (index: number) => {
    if (!wallet.account) return;
    const members = [...draft.members];
    members[index] = { ...members[index], address: wallet.account };
    patch({ members });
  };

  const wrongChain = Boolean(wallet.account) && !wallet.onExpectedChain;

  return (
    <div className="space-y-10">
      {wrongChain ? (
        <Notice tone="warn" title={`Your wallet is not on ${deployment.network().chainName}`}>
          {`Switch it to chain ${deployment.network().chainId} before sealing, assessing or approving. Nothing is signed until the wallet reports the right network.`}
          <span className="mt-3 flex flex-wrap gap-3">
            <button type="button" className="t-btn primary small" onClick={() => void wallet.switchChain()}>
              Switch to {deployment.network().chainName}
            </button>
            <span className="t-label text-[var(--t-muted)]">wallet reports {wallet.chainId ?? "nothing"}</span>
          </span>
        </Notice>
      ) : null}

      <TestFlow
        wallet={wallet}
        configured={configured}
        guardOk={guard.ok}
        record={record}
        rosterFilled={rosterFilled}
      />

      {owned.length > 0 ? (
        <div className="panel">
          <div className="panel-head">
            <div>
              <p className="t-kicker">Your published plans</p>
              <h3 className="mt-2 text-[24px]">Choose the one to work on</h3>
            </div>
            <Pill tone="night">
              {owned.length} {owned.length === 1 ? "plan" : "plans"}
            </Pill>
          </div>

          <p className="mb-5 max-w-[640px] text-[13px] leading-[1.7] text-[var(--t-muted)]">
            Every plan this wallet sealed lives under its own reference. Selecting one puts that reference in the form
            below and loads its record, so the actions that follow always target the plan you can see.
          </p>

          <div className="border-t border-[var(--t-line)]">
            {owned.map((entry) => {
              const tag = entry.id.split(":").slice(1).join(":");
              const selected = planId === entry.id;
              return (
                <button
                  key={entry.id}
                  type="button"
                  className={cn(
                    "table-row w-full border-b border-[var(--t-line-soft)] text-left",
                    selected && "bg-[var(--t-accent-soft)]",
                  )}
                  onClick={() => patch({ tag })}
                >
                  <span className="min-w-0">
                    <strong className="block truncate text-[15px]">{entry.input.title}</strong>
                    <small className="t-label text-[var(--t-muted)]">reference {tag}</small>
                  </span>
                  <span>
                    <StatePill state={entry.state as PlanState} />
                  </span>
                  <span className="t-label text-[var(--t-muted)]">
                    {entry.observation ? "assessed" : "not assessed"}
                  </span>
                  <span className="t-label text-[var(--t-muted)]">
                    {entry.approvals.length} of {entry.input.members.length} approvals
                  </span>
                  <span className="t-label text-[var(--t-accent-dark)]">
                    {selected ? "working on this" : "select"}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      {/* ---------------- sample loader ---------------- */}
      <div className="panel">
        <div className="panel-head">
          <div>
            <p className="t-kicker">Start from a payload</p>
            <h3 className="mt-2 text-[24px]">Load a live test sample</h3>
          </div>
          <Pill tone="night">Addresses left blank</Pill>
        </div>

        <p className="mb-5 max-w-[640px] text-[13px] leading-[1.7] text-[var(--t-muted)]">
          Each sample fills the title, reference, requester class, allowance basis, window, member names and ordered
          batches, and states the outcome the contract must return. Only the member wallet slots are left empty, because
          they have to be accounts you control: the sealing wallet must be on the roster and every member signs with its
          own key.
        </p>

        <div className="flex flex-wrap gap-3">
          {SAMPLES.map((sample) => (
            <button
              key={sample.key}
              type="button"
              className={cn("t-btn", loadedSample === sample.key && "primary")}
              onClick={() => loadSample(sample)}
            >
              {sample.label}
            </button>
          ))}
        </div>

        {loadedSample ? (
          <div className="mt-5">
            <Notice tone="good" title={`${SAMPLES.find((s) => s.key === loadedSample)?.label} is in the form`}>
              {`Expected outcome: ${SAMPLES.find((s) => s.key === loadedSample)?.expected}. Fill the member wallets below, then choose Seal the roster.`}
            </Notice>
          </div>
        ) : (
          <div className="mt-5">
            <Notice tone="warn" title="Nothing loaded yet">
              Pick a sample above, or fill the form by hand. Either way the member wallets must be yours.
            </Notice>
          </div>
        )}
      </div>

      {/* ---------------- identity ---------------- */}
      <div className="grid-2">
        <div className="panel">
          <div className="panel-head">
            <div>
              <p className="t-kicker">Step one</p>
              <h3 className="mt-2 text-[24px]">Plan identity</h3>
            </div>
            <Pill tone={guard.ok ? "good" : "warn"}>
              {guard.ok ? "Contract ready" : `Needs a fix · ${guard.field}`}
            </Pill>
          </div>

          <div className="space-y-4">
            <Field label="Title">
              <input
                value={draft.title}
                placeholder="Weekly reporting sweep"
                onChange={(event) => patch({ title: event.target.value })}
              />
            </Field>

            <Field label="Plan reference" hint="lowercase letters, digits, hyphens">
              <input
                value={draft.tag}
                placeholder="weekly-reporting"
                onChange={(event) => patch({ tag: event.target.value })}
              />
            </Field>

            <Field label="Requester class">
              <Segmented
                options={REQUESTER_CLASSES}
                value={draft.requester}
                onChange={(next) => patch({ requester: next })}
              />
            </Field>

            <Field label="Allowance basis">
              <Segmented options={ALLOWANCE_BASES} value={draft.basis} onChange={(next) => patch({ basis: next })} />
            </Field>

            <Field label="Maximum window" hint={ms(draft.horizon_ms)}>
              <input
                type="range"
                min={1000}
                max={60000}
                step={500}
                value={draft.horizon_ms}
                onChange={(event) => patch({ horizon_ms: Number(event.target.value) })}
              />
            </Field>
          </div>
        </div>

        <div className="panel">
          <div className="panel-head">
            <div>
              <p className="t-kicker">Step two</p>
              <h3 className="mt-2 text-[24px]">Named roster</h3>
            </div>
            <Pill tone={draft.members.length >= 2 && draft.members.length <= 4 ? "good" : "warn"}>
              {draft.members.length} of 4
            </Pill>
          </div>

          <p className="mb-5 text-[13px] leading-[1.7] text-[var(--t-muted)]">
            Between two and four wallets may belong to a plan. The wallet that seals the roster has to appear in this
            list, and each member signs the final schedule with their own key.
          </p>

          <div className="space-y-4">
            {draft.members.map((member, index) => (
              <div key={index} className="border border-[var(--t-line)] p-4">
                <div className="mb-3 flex items-center justify-between">
                  <span className="t-label text-[var(--t-accent-dark)]">Member {index + 1}</span>
                  {draft.members.length > 2 ? (
                    <button
                      type="button"
                      className="t-btn small"
                      onClick={() => {
                        const members = draft.members.filter((_, i) => i !== index);
                        const jobs = draft.jobs
                          .filter((job) => job.member !== index)
                          .map((job) => ({ ...job, member: job.member > index ? job.member - 1 : job.member }));
                        patch({ members, jobs });
                      }}
                    >
                      Remove
                    </button>
                  ) : null}
                </div>

                {wallet.account && member.address.toLowerCase() !== wallet.account ? (
                  <div className="mb-3">
                    <button type="button" className="t-btn small" onClick={() => useMyWallet(index)}>
                      Use my wallet for this slot
                    </button>
                  </div>
                ) : null}

                <div className="grid-2 -mx-4 -mt-2 border-0">
                  <div className="p-4 pb-0">
                    <Field label="Name">
                      <input
                        value={member.name}
                        placeholder="Reporting service"
                        onChange={(event) => {
                          const members = [...draft.members];
                          members[index] = { ...members[index], name: event.target.value };
                          patch({ members });
                        }}
                      />
                    </Field>
                  </div>
                  <div className="p-4 pb-0">
                    <Field label="Wallet">
                      <input
                        value={member.address}
                        spellCheck={false}
                        placeholder="0x…"
                        onChange={(event) => {
                          const members = [...draft.members];
                          members[index] = { ...members[index], address: event.target.value.trim() };
                          patch({ members });
                        }}
                      />
                    </Field>
                  </div>
                </div>
              </div>
            ))}

            {draft.members.length < 4 ? (
              <button
                type="button"
                className="t-btn"
                onClick={() => patch({ members: [...draft.members, { name: "", address: "" }] })}
              >
                Add member
              </button>
            ) : null}
          </div>
        </div>
      </div>

      {/* ---------------- batches ---------------- */}
      <div className="panel">
        <div className="panel-head">
          <div>
            <p className="t-kicker">Step three</p>
            <h3 className="mt-2 text-[24px]">Ordered batches</h3>
          </div>
          <Pill tone={draft.jobs.length >= draft.members.length ? "good" : "warn"}>
            {draft.jobs.length} batches
          </Pill>
        </div>

        <p className="mb-5 max-w-[620px] text-[13px] leading-[1.7] text-[var(--t-muted)]">
          List the batches in the order they should run. Each one carries a size in points and the moment it becomes
          available. Admission is first in, first out; nothing is reordered.
        </p>

        <div className="grid-3">
          {draft.jobs.map((job, index) => (
            <div className="panel" key={index}>
              <div className="panel-head">
                <span className="t-label text-[var(--t-accent-dark)]">Batch {index + 1}</span>
                {draft.jobs.length > draft.members.length ? (
                  <button
                    type="button"
                    className="t-btn small"
                    onClick={() => patch({ jobs: draft.jobs.filter((_, i) => i !== index) })}
                  >
                    Remove
                  </button>
                ) : null}
              </div>

              <div className="space-y-4">
                <Field label="Label">
                  <input
                    value={job.label}
                    placeholder="Nightly reconcile"
                    onChange={(event) => {
                      const jobs = [...draft.jobs];
                      jobs[index] = { ...job, label: event.target.value };
                      patch({ jobs });
                    }}
                  />
                </Field>

                <Field label="Member">
                  <select
                    value={job.member}
                    onChange={(event) => {
                      const jobs = [...draft.jobs];
                      jobs[index] = { ...job, member: Number(event.target.value) };
                      patch({ jobs });
                    }}
                  >
                    {draft.members.map((member, mIndex) => (
                      <option key={mIndex} value={mIndex}>
                        {member.name || `Member ${mIndex + 1}`}
                      </option>
                    ))}
                  </select>
                </Field>

                <Field label="Size in points">
                  <input
                    type="number"
                    min={1}
                    value={job.points}
                    onChange={(event) => {
                      const jobs = [...draft.jobs];
                      jobs[index] = { ...job, points: Number(event.target.value) };
                      patch({ jobs });
                    }}
                  />
                </Field>

                <Field label="Arrival" hint={ms(job.arrival_ms)}>
                  <input
                    type="range"
                    min={0}
                    max={60000}
                    step={250}
                    value={job.arrival_ms}
                    onChange={(event) => {
                      const jobs = [...draft.jobs];
                      jobs[index] = { ...job, arrival_ms: Number(event.target.value) };
                      patch({ jobs });
                    }}
                  />
                </Field>
              </div>
            </div>
          ))}

          {draft.jobs.length < 8 ? (
            <div className="panel flex flex-col items-start justify-center gap-3">
              <p className="text-[13px] text-[var(--t-muted)]">Attach another batch to the roster.</p>
              <button type="button" className="t-btn" onClick={() => patch({ jobs: [...draft.jobs, emptyJob(0)] })}>
                Add batch
              </button>
            </div>
          ) : null}
        </div>
      </div>

      {/* ---------------- preview + publish ---------------- */}
      <div className="grid-2">
        <div className="panel">
          <div className="panel-head">
            <div>
              <p className="t-kicker">Step four</p>
              <h3 className="mt-2 text-[24px]">Feasibility preview</h3>
            </div>
            <Pill tone="night">Computed here</Pill>
          </div>

          {draft.basis === "PUBLIC_DEFAULT" ? (
            <p className="mb-5 text-[13px] leading-[1.7] text-[var(--t-muted)]">
              This preview uses the published default allowance for the {labelise(draft.requester)} class, which refills
              across one documented hour. The deployed contract re-reads the same document under independent consensus
              before it commits a schedule.
            </p>
          ) : (
            <p className="mb-5 text-[13px] leading-[1.7] text-[var(--t-muted)]">
              Custom entitlements and enterprise agreements cannot be proven from a public document, so the contract
              will return this plan for review rather than schedule it.
            </p>
          )}

          <dl className="grid-3 -mx-[26px] mb-6 border-y border-[var(--t-line)]">
            {[
              { label: "Allowance", value: `${preview.allowance_points.toLocaleString()} points` },
              { label: "Window", value: ms(preview.window_ms || DOCUMENTED_WINDOW_MS) },
              { label: "Total requested", value: `${preview.total_points.toLocaleString()} points` },
              {
                label: "Bucket capacity",
                value: `${preview.allowance_points.toLocaleString()} points`,
              },
              { label: "Last admission", value: ms(preview.finish_ms) },
              {
                label: "Residual credit",
                value: `${preview.remaining_points.toLocaleString()} points`,
              },
            ].map((item) => (
              <div className="p-[22px]" key={item.label}>
                <dt className="stat-label">{item.label}</dt>
                <dd className="mt-2 text-[20px] font-semibold tracking-[-0.02em]">{item.value}</dd>
              </div>
            ))}
          </dl>

          <ScheduleTimeline
            proof={preview}
            members={draft.members}
            labels={draft.jobs.map((job) => job.label)}
            horizon={draft.horizon_ms}
          />
        </div>

        <div className="panel">
          <div className="panel-head">
            <div>
              <p className="t-kicker">Step five</p>
              <h3 className="mt-2 text-[24px]">Put it on the ledger</h3>
            </div>
            {record ? <StatePill state={record.state as PlanState} /> : <Pill tone="idle">Not on chain</Pill>}
          </div>

          {!deployment.isConfigured() || loadError === "NO_CONTRACT" ? (
            <Notice tone="warn" title="Choose a deployment first">
              Open the deployment target from the top bar and enter the address of a published contract. Every write
              resolves through that one setting.
            </Notice>
          ) : !wallet.account ? (
            <Notice tone="warn" title="No member wallet">
              Connect the wallet of a named member. Only listed wallets may seal, assess, approve or withdraw.
            </Notice>
          ) : record ? (
            <div className="space-y-5">
              <Notice
                tone={record.state === "CANCELLED" ? "bad" : record.state === "SEALED" ? "warn" : "good"}
                title={`${recordTitle} is on the ledger`}
              >
                {STATE_COPY[record.state].note}
              </Notice>

              <dl className="grid-2 -mx-[26px] border-y border-[var(--t-line)]">
                {[
                  { label: "State", value: STATE_COPY[record.state].label },
                  { label: "Revision", value: String(record.revision) },
                  { label: "Approvals", value: `${record.approvals.length} of ${record.input.members.length}` },
                  { label: "Batches", value: String(record.input.jobs.length) },
                ].map((item) => (
                  <div className="p-[22px]" key={item.label}>
                    <dt className="stat-label">{item.label}</dt>
                    <dd className="mt-2 text-[20px] font-semibold">{item.value}</dd>
                  </div>
                ))}
              </dl>

              {record.observation ? (
                <Notice
                  tone={record.observation.policy.status === "KNOWN" ? "good" : "warn"}
                  title={
                    record.observation.policy.status === "KNOWN"
                      ? `Allowance ${(record.observation.policy.allowance ?? 0).toLocaleString()} points per ${
                          record.observation.policy.window_label === "MINUTE" ? "minute" : "hour"
                        }`
                      : "Allowance not established"
                  }
                >
                  {record.observation.policy.status === "KNOWN"
                    ? `Assessed under consensus. The schedule is bound to fingerprint ${shorten(
                        record.allocation_hash ?? "",
                        10,
                        6,
                      )}.`
                    : record.observation.policy.reason}
                </Notice>
              ) : (
                <Notice tone="warn" title="Not assessed yet">
                  The roster is frozen. A named member must request an assessment before anyone can approve a schedule.
                </Notice>
              )}

              <PlanActions
                record={record}
                wallet={wallet}
                onNotify={onNotify}
                onChanged={() => {
                  notePublished();
                  void reload();
                }}
              />

              <div className="flex flex-wrap gap-3">
                <button type="button" className="t-btn primary" onClick={() => onGoLedger(record.id)}>
                  Inspect in the ledger
                </button>
                <button type="button" className="t-btn" onClick={() => onGoLedger()}>
                  Open the ledger
                </button>
              </div>
            </div>
          ) : !onRoster ? (
            <Notice tone="warn" title="The connected wallet is not on this roster">
              Only a wallet listed in the roster may seal it, which is why the contract reports
              <span className="text-[var(--t-ink)]"> OWNER_MUST_BE_MEMBER</span>. Add this wallet to an empty slot, or
              switch to one that is already listed.
              <span className="mt-3 flex flex-wrap gap-3">
                <button type="button" className="t-btn primary small" onClick={addSelf}>
                  Add this wallet to the roster
                </button>
                <span className="t-label text-[var(--t-muted)]">{shorten(wallet.account, 10, 6)}</span>
              </span>
            </Notice>
          ) : !guard.ok ? (
            <Notice tone="warn" title="The contract would refuse this draft">
              {messageFor(guard.code)}
            </Notice>
          ) : (
            <div className="space-y-5">
              <Notice tone="good" title="Ready to seal">
                Sealing freezes the roster, the requester class, the allowance basis, the window and the ordered batches.
                Nothing can change afterwards without a fresh reference.
              </Notice>
              <button
                type="button"
                className="t-btn primary"
                disabled={busy !== null}
                onClick={seal}
              >
                {busy === "seal" ? <Spinner /> : null}
                {busy === "seal" ? stage : "Seal the roster"}
              </button>
            </div>
          )}

          {hash ? (
            <div className="mt-6 border border-[var(--t-line)] p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="stat-label">Submission</p>
                <Pill tone={elapsed === null ? "night" : "good"}>{stageLabel || "Submitted"}</Pill>
              </div>
              <p className="mt-3 text-[13px] leading-[1.65] text-[var(--t-muted)]">{stage}</p>
              <CallBlock call={call} />
              <p className="mt-3 break-all text-[12px] leading-[1.6] text-[var(--t-accent-dark)]">
                {shorten(hash, 22, 12)}
              </p>
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <a className="t-btn small" href={explorerUrlForHash(hash)} target="_blank" rel="noreferrer">
                  Follow in explorer
                </a>
                {elapsed !== null ? (
                  <span className="t-label text-[var(--t-muted)]">elapsed {elapsed}s</span>
                ) : null}
              </div>
            </div>
          ) : null}

          {!guard.ok && guard.code && wallet.account ? (
            <div className="mt-6">
              <Notice tone="warn" title={`Fix the ${guard.field.toLowerCase()} before sending`}>
                {messageFor(guard.code)}
              </Notice>
            </div>
          ) : (
            <p className="mt-6 t-label text-[var(--t-muted)]">Every contract guard is satisfied</p>
          )}
        </div>
      </div>
    </div>
  );
}

function labelise(value: string): string {
  return value.replace(/_/g, " ").toLowerCase();
}

export { ok as plannerOk };
