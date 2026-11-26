import { deployment, explorerUrlFor } from "@/config/contracts";
import { shorten, type WalletSession } from "@/lib/state";
import { Brand } from "./Header";
import { Notice, Pill } from "./ui";

export function AccountPanel({
  open,
  onClose,
  wallet,
}: {
  open: boolean;
  onClose: () => void;
  wallet: WalletSession;
}) {
  const state = deployment.get();
  const target = state.contracts[0];

  return (
    <Modalish open={open} onClose={onClose} kicker="Member session" title="Your wallet">
      {wallet.account ? (
        <>
          <div className="border border-[var(--t-line)] p-5">
            <p className="stat-label">Connected account</p>
            <p className="mt-2 text-[18px] font-semibold tracking-[-0.02em]">{shorten(wallet.account, 12, 8)}</p>
          </div>
          <dl className="mt-4 grid-2 -mx-[34px] border-t border-[var(--t-line)]">
            <div className="p-5">
              <dt className="stat-label">Network</dt>
              <dd className="mt-2 text-[15px] font-semibold">
                {wallet.onExpectedChain ? state.network.chainName : "Wallet is on another network"}
              </dd>
            </div>
            <div className="p-5">
              <dt className="stat-label">Target contract</dt>
              <dd className="mt-2 text-[15px] font-semibold">
                {target?.address ? (
                  <a href={explorerUrlFor(target.address)} target="_blank" rel="noreferrer" className="hover:text-[var(--t-accent-dark)]">
                    {shorten(target.address, 8, 6)}
                  </a>
                ) : (
                  "Not set"
                )}
              </dd>
            </div>
          </dl>
          <Notice
            tone={wallet.onExpectedChain ? "good" : "warn"}
            title={wallet.onExpectedChain ? "Session active" : `Switch to ${state.network.chainName}`}
          >
            {wallet.onExpectedChain
              ? "Only wallets listed in a roster may seal, assess, approve or withdraw that plan."
              : `The wallet reports chain ${wallet.chainId ?? "unknown"} but this release targets chain ${state.network.chainId}. Writes stay blocked until it matches.`}
          </Notice>
          {!wallet.onExpectedChain ? (
            <div className="mt-4">
              <button type="button" className="t-btn primary" onClick={() => void wallet.switchChain()}>
                Switch to {state.network.chainName}
              </button>
            </div>
          ) : null}
          <div className="mt-6 flex flex-wrap gap-3">
            <button type="button" className="t-btn" onClick={wallet.release}>
              Forget this session
            </button>
            <button type="button" className="t-btn primary" onClick={onClose}>
              Done
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="text-[13px] leading-[1.75] text-[var(--t-muted)]">
            Connecting lets you seal a roster, request an assessment and approve a schedule with your own key. Nothing
            here needs custodial access, and no credentials are ever requested.
          </p>
          {wallet.error ? (
            <div className="mt-5">
              <Notice tone="bad" title="Connection failed">
                {wallet.error}
              </Notice>
            </div>
          ) : null}
          {!wallet.available ? (
            <div className="mt-5">
              <Notice tone="warn" title="No injected wallet">
                Install a browser wallet that speaks the standard provider interface, then reload this page.
              </Notice>
            </div>
          ) : null}
          <div className="mt-6 flex flex-wrap gap-3">
            <button type="button" className="t-btn primary" onClick={() => void wallet.connect()} disabled={!wallet.available}>
              Connect wallet
            </button>
            <button type="button" className="t-btn" onClick={onClose}>
              Not now
            </button>
          </div>
        </>
      )}
    </Modalish>
  );
}

function Modalish({
  open,
  onClose,
  kicker,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  kicker: string;
  title: string;
  children: React.ReactNode;
}) {
  if (!open) return null;
  return (
    <div
      className="t-modal"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="modal-panel fade-up">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="t-kicker">{kicker}</p>
            <h2 className="mt-2 text-[26px] tracking-[-0.05em]">{title}</h2>
          </div>
          <Pill tone="night">CadenceGate</Pill>
        </div>
        <div className="mt-6">{children}</div>
      </div>
    </div>
  );
}

export function Footer() {
  const network = deployment.get().network;
  return (
    <footer className="t-footer">
      <div className="t-shell t-footer-inner">
        <Brand inverted />
        <p className="t-label" style={{ color: "#f8fcf9a6" }}>
          {network.chainName} · source-grounded cadence planning
        </p>
        <div className="t-socials">
          <a href="#planner" aria-label="Planner">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M4 19h16M6 15V9m6 6V5m6 10v-4" strokeLinecap="round" />
            </svg>
          </a>
          <a href="#ledger" aria-label="Ledger">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8">
              <rect x="3" y="4" width="18" height="16" />
              <path d="M7 9h10M7 13h6" strokeLinecap="round" />
            </svg>
          </a>
          <a href="#protocol" aria-label="Protocol">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8">
              <circle cx="12" cy="12" r="9" />
              <path d="M12 3v18M3 12h18" strokeLinecap="round" />
            </svg>
          </a>
        </div>
      </div>
    </footer>
  );
}
