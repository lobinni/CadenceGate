import { useEffect, useState } from "react";
import { deployment, explorerUrlFor, type ContractKey } from "@/config/contracts";
import { isAddress } from "@/domain/validation";
import { useDeployment } from "@/lib/state";
import { Field, Modal, Notice } from "./ui";

export function DeploymentPanel({
  open,
  onClose,
  onNotify,
}: {
  open: boolean;
  onClose: () => void;
  onNotify: (tone: "good" | "warn", title: string, detail: string) => void;
}) {
  const state = useDeployment();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [network, setNetwork] = useState({ rpcUrl: state.network.rpcUrl, chainName: state.network.chainName });
  const [explorer, setExplorer] = useState(state.network.explorerUrl);

  useEffect(() => {
    if (!open) return;
    setDrafts(Object.fromEntries(state.contracts.map((entry) => [entry.key, entry.address])));
    setNetwork({ rpcUrl: state.network.rpcUrl, chainName: state.network.chainName });
    setExplorer(state.network.explorerUrl);
  }, [open, state]);

  const save = () => {
    let applied = 0;
    state.contracts.forEach((entry) => {
      const draft = (drafts[entry.key] ?? "").trim();
      if (draft === entry.address) return;
      if (draft === "") {
        deployment.clearContractAddress(entry.key as ContractKey);
        applied += 1;
        return;
      }
      if (isAddress(draft)) {
        deployment.setContractAddress(entry.key as ContractKey, draft);
        applied += 1;
      }
    });

    const nextNetwork: Record<string, string> = {};
    if (network.rpcUrl && network.rpcUrl !== state.network.rpcUrl) nextNetwork.rpcUrl = network.rpcUrl;
    if (network.chainName && network.chainName !== state.network.chainName) nextNetwork.chainName = network.chainName;
    if (explorer && explorer !== state.network.explorerUrl) nextNetwork.explorerUrl = explorer;
    if (Object.keys(nextNetwork).length > 0) deployment.setNetwork(nextNetwork);

    onNotify(
      applied > 0 ? "good" : "warn",
      applied > 0 ? "Deployment updated" : "Nothing to change",
      applied > 0
        ? "Every read and write now targets the address you entered."
        : "Enter a complete 40 digit hexadecimal address to switch target.",
    );
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} kicker="Deployment target" title="Point at a release">
      <p className="mb-6 text-[13px] leading-[1.7] text-[var(--t-muted)]">
        The whole application resolves the contract through one registry. Enter a different address here and every
        panel follows immediately, without a rebuild.
      </p>

      <div className="space-y-5">
        {state.contracts.map((entry) => {
          const draft = drafts[entry.key] ?? "";
          const valid = draft === "" || isAddress(draft);
          return (
            <Field
              key={entry.key}
              label={entry.label}
              hint={entry.defaultAddress ? "Build default" : "No build default"}
            >
              <input
                value={draft}
                spellCheck={false}
                placeholder="Paste the deployed contract address"
                onChange={(event) => setDrafts((prev) => ({ ...prev, [entry.key]: event.target.value }))}
                style={!valid ? { borderColor: "var(--t-danger)" } : undefined}
              />
              {/^0x[0-9a-fA-F]{40}$/.test(draft) ? (
                <a
                  className="mt-2 inline-block text-[11px] text-[var(--t-accent-dark)] underline underline-offset-2 hover:text-[var(--t-ink)]"
                  href={explorerUrlFor(draft)}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open this address in the explorer
                </a>
              ) : null}
            </Field>
          );
        })}

        <div className="grid-2 -mx-[26px] -mb-[26px] border-t border-[var(--t-line)]">
          <div className="p-[22px]">
            <Field label="Endpoint">
              <input value={network.rpcUrl} onChange={(event) => setNetwork({ ...network, rpcUrl: event.target.value })} />
            </Field>
          </div>
          <div className="p-[22px]">
            <Field label="Network">
              <input
                value={network.chainName}
                onChange={(event) => setNetwork({ ...network, chainName: event.target.value })}
              />
            </Field>
          </div>
        </div>

        {state.contracts.some((entry) => entry.address) ? (
          <Notice tone="good" title="Live target selected">
            Reads use the public endpoint. Writes are signed by the wallet you connect.
          </Notice>
        ) : (
          <Notice tone="warn" title="No live target yet">
            Set the address of a deployed contract, or follow the release guide to publish one.
          </Notice>
        )}
      </div>

      <div className="mt-7 flex flex-wrap gap-3">
        <button type="button" className="t-btn primary" onClick={save}>
          Apply target
        </button>
        <button
          type="button"
          className="t-btn"
          onClick={() => {
            deployment.reset();
            onNotify("good", "Registry reset", "The application is back to its build defaults.");
          }}
        >
          Reset registry
        </button>
        <button type="button" className="t-btn" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}
