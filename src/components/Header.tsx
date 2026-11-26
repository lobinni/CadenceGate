import { deployment } from "@/config/contracts";
import { shorten, type WalletSession } from "@/lib/state";
import { cn } from "@/utils/cn";
import { Spinner } from "./ui";

export type SectionId = "planner" | "ledger" | "protocol";

const LINKS: { id: SectionId; label: string }[] = [
  { id: "planner", label: "Planner" },
  { id: "ledger", label: "Ledger" },
  { id: "protocol", label: "Protocol" },
];

export function Brand({ inverted = false }: { inverted?: boolean }) {
  return (
    <span className="t-brand">
      <span className="t-brand-mark" aria-hidden>
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8">
          <rect x="3" y="3" width="18" height="18" />
          <path d="M3 12h6l3-6 3 9 3-3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      <span className="t-brand-name" style={inverted ? { color: "#f8fcf9" } : undefined}>
        CadenceGate
      </span>
      <span className="sub" style={inverted ? { color: "var(--t-accent)" } : undefined}>
        Cadence
      </span>
    </span>
  );
}

function walletChainLabel(wallet: WalletSession): string {
  if (!wallet.account) return "Wallet";
  if (!wallet.chainId) return "Network unknown";
  return wallet.onExpectedChain ? `Chain ${deployment.network().chainId}` : "Wrong network";
}

export function Header({
  active,
  onSelect,
  wallet,
  onOpenDeployment,
  onOpenAccount,
}: {
  active: SectionId;
  onSelect: (id: SectionId) => void;
  wallet: WalletSession;
  onOpenDeployment: () => void;
  onOpenAccount: () => void;
}) {
  const target = deployment.get().contracts[0];

  return (
    <header className="t-header">
      <div className="t-shell">
        <nav className="t-nav" aria-label="CadenceGate navigation">
          <Brand />

          <div className="t-nav-links">
            {LINKS.map((link) => (
              <button
                key={link.id}
                type="button"
                className={cn(link.id === active && "active")}
                onClick={() => onSelect(link.id)}
              >
                {link.label}
              </button>
            ))}
          </div>

          <div className="t-account-wrap">
            <div className="flex items-center gap-2">
              <button type="button" className="t-account" onClick={onOpenDeployment}>
                <span
                  className={cn("t-dot", target?.address ? "" : "warn")}
                  aria-hidden
                  style={target?.address ? undefined : { background: "var(--t-warn)", boxShadow: "none" }}
                />
                <span className="identity">
                  <strong>{target?.address ? "Live contract" : "Undeployed"}</strong>
                  <small>{target?.address ? shorten(target.address, 6, 4) : "Set target"}</small>
                </span>
              </button>

              <button type="button" className="t-account" onClick={onOpenAccount}>
                {wallet.ready ? (
                  <span className="identity">
                    <strong>{wallet.account ? shorten(wallet.account, 8, 6) : "Connect"}</strong>
                    <small>{walletChainLabel(wallet)}</small>
                  </span>
                ) : (
                  <span className="identity">
                    <strong>Connecting</strong>
                    <small>Wallet</small>
                  </span>
                )}
                {!wallet.ready ? <Spinner /> : null}
              </button>
            </div>
          </div>
        </nav>
      </div>
    </header>
  );
}
