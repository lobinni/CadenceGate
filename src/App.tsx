import { useCallback, useState } from "react";
import { AccountPanel, Footer } from "@/components/Chrome";
import { DeploymentPanel } from "@/components/DeploymentPanel";
import { Header, type SectionId } from "@/components/Header";
import { Hero } from "@/components/Hero";
import { Ledger } from "@/components/Ledger";
import { Planner } from "@/components/Planner";
import { Protocol } from "@/components/Protocol";
import { Notice, Pill } from "@/components/ui";
import { deployment } from "@/config/contracts";
import { useDeployment, useToasts, useWallet } from "@/lib/state";

const HERO_STATS: string[] = [
  "Two to four members",
  "Up to eight batches",
  "One documented allowance",
];

export default function App() {
  const [section, setSection] = useState<SectionId>("planner");
  const [deploymentOpen, setDeploymentOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [ledgerVersion, setLedgerVersion] = useState(0);
  const [ledgerFocus, setLedgerFocus] = useState<string | null>(null);
  const [ledgerFocusNonce, setLedgerFocusNonce] = useState(0);
  const wallet = useWallet();
  const toasts = useToasts();
  const state = useDeployment();

  const notify = toasts.push;

  const jump = useCallback((id: SectionId) => {
    setSection(id);
    window.requestAnimationFrame(() => {
      document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, []);

  const target = state.contracts[0];

  return (
    <div className="min-h-screen">
      <Header
        active={section}
        onSelect={jump}
        wallet={wallet}
        onOpenDeployment={() => setDeploymentOpen(true)}
        onOpenAccount={() => setAccountOpen(true)}
      />

      <main>
        <Hero
          onPrimary={() => jump("planner")}
          onSecondary={() => jump("ledger")}
          stats={HERO_STATS}
        />

        {!target?.address ? (
          <div className="t-shell mt-8">
            <Notice tone="warn" title="No live contract selected">
              Every panel resolves the deployed contract through one registry. Set the address from the top bar, or
              follow the release guide, and the planner and ledger will light up immediately.
              <span className="mt-3 flex flex-wrap items-center gap-3">
                <button type="button" className="t-btn primary small" onClick={() => setDeploymentOpen(true)}>
                  Set deployment target
                </button>
                <Pill tone="warn">{deployment.network().chainName}</Pill>
              </span>
            </Notice>
          </div>
        ) : null}

        <section id="planner" className="t-section">
          <div className="t-shell">
            <div className="zone-head">
              <div>
                <p className="t-kicker">Plan and publish</p>
                <h2>
                  Draft a <span>cadence</span>
                </h2>
                <p>
                  Freeze a roster, describe the workload in ordered batches, and let the network agree on the allowance
                  before any member signs the schedule.
                </p>
              </div>
              <Pill tone="good">{target?.address ? "Live target" : "Preview only"}</Pill>
            </div>

            <Planner
              wallet={wallet}
              onNotify={notify}
              onPlanPublished={() => setLedgerVersion((value) => value + 1)}
              onGoLedger={(planId) => {
                if (planId) {
                  setLedgerFocus(planId);
                  setLedgerFocusNonce((value) => value + 1);
                }
                jump("ledger");
              }}
            />
          </div>
        </section>

        <section id="ledger" className="t-section">
          <div className="t-shell">
            <div className="zone-head">
              <div>
                <p className="t-kicker">Public record</p>
                <h2>
                  The <span>ledger</span>
                </h2>
                <p>
                  Every published plan is readable by anyone. Inspect the allowance it was built on, the admission time
                  of each batch and who approved it.
                </p>
              </div>
              <Pill tone="night">Read only</Pill>
            </div>

            <Ledger
              wallet={wallet}
              onNotify={notify}
              version={ledgerVersion}
              focusId={ledgerFocus}
              focusNonce={ledgerFocusNonce}
            />
          </div>
        </section>

        <section id="protocol" className="t-section">
          <div className="t-shell">
            <div className="zone-head">
              <div>
                <p className="t-kicker">Under the surface</p>
                <h2>
                  The <span>protocol</span>
                </h2>
                <p>
                  A small, strict model: one documented allowance, one window, one ordering rule, and independent
                  consent from every named member.
                </p>
              </div>
              <Pill tone="good">Four steps</Pill>
            </div>

            <Protocol />
          </div>
        </section>
      </main>

      <Footer />

      <DeploymentPanel
        open={deploymentOpen}
        onClose={() => setDeploymentOpen(false)}
        onNotify={(tone, title, detail) => notify(tone, title, detail)}
      />
      <AccountPanel open={accountOpen} onClose={() => setAccountOpen(false)} wallet={wallet} />

      <div className="pointer-events-none fixed bottom-6 right-6 z-[120] flex w-[min(92vw,380px)] flex-col gap-3">
        {toasts.items.map((toast) => (
          <div key={toast.id} className="fade-up pointer-events-auto">
            <Notice tone={toast.tone} title={toast.title}>
              {toast.detail}
            </Notice>
          </div>
        ))}
      </div>
    </div>
  );
}
