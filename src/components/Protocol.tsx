const STEPS = [
  {
    n: "01",
    title: "Seal the roster",
    copy: "Between two and four wallets, one requester class, one allowance basis, one maximum window and a strictly ordered list of batches are frozen under a plan reference.",
  },
  {
    n: "02",
    title: "Assess the policy",
    copy: "The sealing member asks the network to read one fixed public document. Validators fetch and interpret it on their own, then compare every field that scheduling depends on.",
  },
  {
    n: "03",
    title: "Approve the schedule",
    copy: "A feasible assessment produces a schedule and a binding fingerprint. Each member approves that exact fingerprint with their own wallet; the final distinct approval commits the plan.",
  },
  {
    n: "04",
    title: "Release on cadence",
    copy: "The committed record is public. Anyone can read the allowance it was built on, the admission time of every batch and the residual credit it left behind.",
  },
];

const FACTS = [
  {
    label: "Integer exact",
    copy: "Credits are tracked in units where one point equals three thousand six hundred units, so an hourly allowance refills at exactly its own figure each millisecond with no rounding drift.",
  },
  {
    label: "First in, first out",
    copy: "Batches are never reordered. Each one is admitted at the earliest moment its predecessor has finished and the bucket holds enough credit.",
  },
  {
    label: "Three outcomes",
    copy: "A feasible workload is ready, an impossible one is blocked with the exact excess, and an unprovable allowance basis is returned for review.",
  },
  {
    label: "One revision at a time",
    copy: "Every write carries the revision it expects, so two members cannot act on a stale copy of the same plan.",
  },
];

const LIMITS = [
  "CadenceGate sends no requests to any API and never asks for credentials.",
  "It models the public documented default, not the entitlement of a private account.",
  "Concurrent traffic from other consumers can reduce real capacity below the model.",
  "A public document can change between node reads, which may prevent consensus.",
];

export function Protocol() {
  return (
    <div className="space-y-14">
      <div className="grid-4">
        {STEPS.map((step) => (
          <div className="panel lift" key={step.n}>
            <p className="step-num">{step.n}</p>
            <h3 className="mt-4 text-[22px]">{step.title}</h3>
            <p className="mt-3 text-[13px] leading-[1.75] text-[var(--t-muted)]">{step.copy}</p>
          </div>
        ))}
      </div>

      <div className="grid-2">
        <div className="panel">
          <p className="t-kicker">The model</p>
          <h3 className="mt-3 text-[30px]">One bucket, one hour, one class</h3>
          <p className="mt-4 text-[13px] leading-[1.8] text-[var(--t-muted)]">
            The contract treats the documented allowance for a requester class as a bucket that starts full. Credit
            refills continuously across the documented window until the bucket is full again. A batch is admitted at the
            first millisecond where the bucket holds enough credit, and the same arithmetic is reproduced by the browser
            so you can see the answer before you spend a transaction.
          </p>
          <dl className="mt-6 space-y-0 border-t border-[var(--t-line)]">
            {FACTS.map((fact) => (
              <div className="border-b border-[var(--t-line)] py-5" key={fact.label}>
                <dt className="t-label text-[var(--t-accent-dark)]">{fact.label}</dt>
                <dd className="mt-2 text-[13px] leading-[1.75] text-[var(--t-muted)]">{fact.copy}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="panel">
          <p className="t-kicker">Honest boundaries</p>
          <h3 className="mt-3 text-[30px]">What this tool does not claim</h3>
          <ul className="mt-4 space-y-0 border-t border-[var(--t-line)]">
            {LIMITS.map((limit) => (
              <li key={limit} className="flex gap-4 border-b border-[var(--t-line)] py-5">
                <span className="t-label text-[var(--t-accent-dark)]">Bound</span>
                <span className="text-[13px] leading-[1.75] text-[var(--t-muted)]">{limit}</span>
              </li>
            ))}
          </ul>
          <div className="mt-6">
            <p className="t-kicker">Swapping deployments</p>
            <p className="mt-3 text-[13px] leading-[1.8] text-[var(--t-muted)]">
              The interface never hard-codes a contract address. It reads one registry that can be set at build time, in
              local storage, or from the deployment panel in the top bar. Publishing a new release therefore means
              typing one address rather than editing the application.
            </p>
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <div>
            <p className="t-kicker">Living with the network</p>
            <h3 className="mt-2 text-[26px]">If a request does not settle</h3>
          </div>
        </div>
        <div className="grid-3">
          {[
            {
              title: "Consensus takes time",
              copy: "Assessments ask validators to fetch and interpret a document independently. Polling can end before they finish.",
            },
            {
              title: "Nothing is lost",
              copy: "The submission is stored under its own hash. Reopen the plan from the ledger and continue from the same point.",
            },
            {
              title: "Reads are always safe",
              copy: "Reading a plan never costs anything and never needs a wallet, so you can check progress at any time.",
            },
          ].map((item) => (
            <div className="p-[22px]" key={item.title}>
              <h4 className="text-[18px]">{item.title}</h4>
              <p className="mt-2 text-[13px] leading-[1.75] text-[var(--t-muted)]">{item.copy}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
