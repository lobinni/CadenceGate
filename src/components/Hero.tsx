interface NodeSpec {
  cls: string;
  glyph: string;
  name: string;
  caption: string;
  infoLeft?: boolean;
}

const NODES: NodeSpec[] = [
  { cls: "node-a", glyph: "01", name: "Allowance read", caption: "Documented policy" },
  { cls: "node-b", glyph: "02", name: "Workload seal", caption: "Roster frozen" },
  { cls: "node-c", glyph: "03", name: "Independent check", caption: "Validator consensus", infoLeft: true },
  { cls: "node-d", glyph: "04", name: "Schedule proof", caption: "Integer exact" },
  { cls: "node-e", glyph: "05", name: "Member consent", caption: "Separate wallet" },
  { cls: "node-f", glyph: "06", name: "Commitment", caption: "Final approval", infoLeft: true },
  { cls: "node-g", glyph: "07", name: "Ledger readback", caption: "Public record" },
  { cls: "node-h", glyph: "08", name: "Release window", caption: "Agreed cadence", infoLeft: true },
];

const LINKS: [number, number][] = [
  [0, 1],
  [1, 2],
  [3, 2],
  [4, 5],
  [5, 6],
  [7, 5],
  [0, 4],
  [3, 7],
];

const POSITIONS: Record<string, { top?: string; left?: string; right?: string; bottom?: string }> = {
  "node-a": { top: "9%", left: "5%" },
  "node-b": { top: "34%", left: "16%" },
  "node-c": { bottom: "26%", left: "5%" },
  "node-d": { bottom: "9%", left: "15%" },
  "node-e": { top: "9%", right: "5%" },
  "node-f": { top: "35%", right: "16%" },
  "node-g": { bottom: "25%", right: "5%" },
  "node-h": { bottom: "9%", right: "15%" },
};

const CENTRE: Record<string, { x: number; y: number }> = {
  "node-a": { x: 7, y: 16 },
  "node-b": { x: 18, y: 40 },
  "node-c": { x: 7, y: 66 },
  "node-d": { x: 18, y: 88 },
  "node-e": { x: 93, y: 16 },
  "node-f": { x: 82, y: 41 },
  "node-g": { x: 93, y: 67 },
  "node-h": { x: 82, y: 88 },
};

export function NetworkCanvas() {
  return (
    <div className="community-network" aria-hidden>
      <svg className="community-paths" viewBox="0 0 100 100" preserveAspectRatio="none">
        {LINKS.map(([a, b], index) => {
          const from = CENTRE[NODES[a].cls];
          const to = CENTRE[NODES[b].cls];
          const midX = (from.x + to.x) / 2;
          return (
            <path
              key={index}
              vectorEffect="non-scaling-stroke"
              d={`M ${from.x} ${from.y} Q ${midX} ${(from.y + to.y) / 2 + (index % 2 ? 6 : -6)} ${to.x} ${to.y}`}
              style={{ animationDelay: `${index * -2.4}s` }}
            />
          );
        })}
      </svg>

      {NODES.map((node, index) => {
        const position = POSITIONS[node.cls];
        return (
          <div
            key={node.cls}
            className={`community-node ${node.cls} ${node.infoLeft ? "info-left" : ""}`}
            style={{ ...position, animationDelay: `${index * -0.85}s` }}
          >
            <span>{node.glyph}</span>
            <span className="community-info">
              <strong>{node.name}</strong>
              <small>{node.caption}</small>
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function Hero({
  onPrimary,
  onSecondary,
  stats,
}: {
  onPrimary: () => void;
  onSecondary: () => void;
  stats: string[];
}) {
  return (
    <section className="t-shell">
      <div className="t-hero">
        <NetworkCanvas />

        <div className="hero-copy">
          <p className="t-kicker">Source-grounded allowance planning</p>
          <h1>
            Agree on your
            <br />
            <span>release cadence</span>
          </h1>
          <p className="lede">
            CadenceGate turns one documented public allowance into a schedule your whole team signs.
          </p>
          <div className="hero-actions">
            <button type="button" className="t-btn primary night" onClick={onPrimary}>
              Draft a plan
            </button>
            <button type="button" className="t-btn night" onClick={onSecondary}>
              Open the ledger
            </button>
          </div>
          <div className="hero-proof">
            {stats.map((stat) => (
              <span key={stat}>
                <i aria-hidden />
                {stat}
              </span>
            ))}
          </div>
        </div>

        <p className="hero-corner-meta">
          <span>Integer exact</span>
          <span>Consensus checked</span>
          <span>Member approved</span>
        </p>
      </div>
    </section>
  );
}
