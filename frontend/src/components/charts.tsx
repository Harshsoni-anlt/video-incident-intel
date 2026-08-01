import type { ReactNode } from "react";

/** Shared tooltip shell. Every chart ships hover — an SVG chart is interactive. */
export function TooltipBox({ title, rows }: { title: string; rows: { label: string; value: ReactNode; color?: string }[] }) {
  return (
    <div
      className="rounded-lg border px-3 py-2 text-xs shadow-lg pointer-events-none"
      style={{ background: "var(--surface)", borderColor: "var(--border-strong)", color: "var(--ink)" }}
    >
      <div className="font-medium mb-1 max-w-64 break-words">{title}</div>
      {rows.map((r) => (
        <div key={r.label} className="flex items-center gap-2 justify-between">
          <span className="flex items-center gap-1.5" style={{ color: "var(--ink-2)" }}>
            {r.color && (
              <span aria-hidden className="w-2 h-2 rounded-[2px]" style={{ background: r.color }} />
            )}
            {r.label}
          </span>
          <span className="tnum font-medium">{r.value}</span>
        </div>
      ))}
    </div>
  );
}

export const axisProps = {
  stroke: "var(--axis)",
  tick: { fill: "var(--ink-muted)", fontSize: 11 },
  tickLine: false,
} as const;

/**
 * The cost story as one bar: how much of the sampled footage never reached the
 * model. Two segments, both directly labelled, 2px surface gap between them —
 * so it needs no legend and no colour-only reading.
 */
export function SavingsBar({ sent, sampled }: { sent: number; sampled: number }) {
  if (!sampled) return null;
  const sentPct = (sent / sampled) * 100;
  const skipped = sampled - sent;

  return (
    <div>
      <div className="flex h-9 rounded-lg overflow-hidden" style={{ background: "var(--surface-2)" }}>
        <div
          className="flex items-center px-3 text-xs font-medium transition-[width] duration-700"
          style={{
            width: `${Math.max(sentPct, 6)}%`,
            background: "var(--series-1)",
            color: "#fff",
            marginRight: 2,
          }}
          title={`${sent.toLocaleString()} frames sent to the model`}
        >
          <span className="tnum truncate">{sent.toLocaleString()}</span>
        </div>
        <div
          className="flex items-center px-3 text-xs font-medium flex-1"
          style={{ background: "var(--surface-2)", color: "var(--ink-2)" }}
          title={`${skipped.toLocaleString()} frames dropped by the motion filter`}
        >
          <span className="tnum truncate">{skipped.toLocaleString()}</span>
        </div>
      </div>
      <div className="flex justify-between mt-2 text-[11px]" style={{ color: "var(--ink-muted)" }}>
        <span>Sent to the vision model</span>
        <span>Dropped locally — nothing changed in frame</span>
      </div>
    </div>
  );
}
