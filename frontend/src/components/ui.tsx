import type { ReactNode } from "react";
import { SEVERITY_COLOR, type Severity } from "../api";

export function Card({
  title,
  subtitle,
  actions,
  children,
  className = "",
  pad = true,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  pad?: boolean;
}) {
  return (
    <section
      className={`rounded-xl border overflow-hidden ${className}`}
      style={{ background: "var(--surface)", borderColor: "var(--border)" }}
    >
      {(title || actions) && (
        <header className="flex items-start justify-between gap-4 px-5 pt-4 pb-3">
          <div className="min-w-0">
            {title && <h2 className="text-sm font-semibold tracking-tight">{title}</h2>}
            {subtitle && (
              <p className="text-xs mt-0.5" style={{ color: "var(--ink-muted)" }}>
                {subtitle}
              </p>
            )}
          </div>
          {actions && <div className="shrink-0 flex items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={pad ? "px-5 pb-5" : ""}>{children}</div>
    </section>
  );
}

/** A headline number. Not a chart — a single value has no shape worth plotting. */
export function Stat({
  label,
  value,
  hint,
  accent,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  accent?: string;
}) {
  return (
    <div
      className="rounded-xl border px-4 py-3.5"
      style={{ background: "var(--surface)", borderColor: "var(--border)" }}
    >
      <div className="text-[11px] uppercase tracking-wider" style={{ color: "var(--ink-muted)" }}>
        {label}
      </div>
      <div
        className="text-2xl font-semibold mt-1.5 leading-none"
        style={{ color: accent ?? "var(--ink)" }}
      >
        {value}
      </div>
      {hint && (
        <div className="text-xs mt-1.5" style={{ color: "var(--ink-2)" }}>
          {hint}
        </div>
      )}
    </div>
  );
}

export function Button({
  children,
  onClick,
  variant = "default",
  disabled,
  size = "md",
  type = "button",
  title,
}: {
  children: ReactNode;
  onClick?: (e: React.MouseEvent) => void;
  variant?: "default" | "primary" | "ghost" | "danger";
  disabled?: boolean;
  size?: "sm" | "md";
  type?: "button" | "submit";
  title?: string;
}) {
  const base =
    "inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2";
  const sizing = size === "sm" ? "text-xs px-2.5 py-1.5" : "text-sm px-3.5 py-2";
  const styles: Record<string, React.CSSProperties> = {
    default: { background: "var(--surface-2)", color: "var(--ink)", border: "1px solid var(--border)" },
    primary: { background: "var(--series-1)", color: "#fff", border: "1px solid transparent" },
    ghost: { background: "transparent", color: "var(--ink-2)", border: "1px solid transparent" },
    danger: { background: "transparent", color: "var(--sev-critical)", border: "1px solid var(--border)" },
  };
  return (
    <button
      type={type}
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={`${base} ${sizing} hover:opacity-85`}
      style={{ ...styles[variant], outlineColor: "var(--series-1)" }}
    >
      {children}
    </button>
  );
}

/** Severity always ships as colour *plus* its name — never colour alone. */
export function SeverityBadge({ severity, small }: { severity: Severity; small?: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md font-medium capitalize ${
        small ? "text-[11px] px-1.5 py-0.5" : "text-xs px-2 py-1"
      }`}
      style={{ background: "var(--surface-2)", color: "var(--ink-2)" }}
    >
      <span
        aria-hidden
        className="w-1.5 h-1.5 rounded-full shrink-0"
        style={{ background: SEVERITY_COLOR[severity] }}
      />
      {severity}
    </span>
  );
}

export function Empty({ title, body, action }: { title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="text-center py-12 px-6">
      <p className="text-sm font-medium">{title}</p>
      {body && (
        <p className="text-xs mt-1.5 max-w-md mx-auto leading-relaxed" style={{ color: "var(--ink-muted)" }}>
          {body}
        </p>
      )}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

export function ErrorNote({ children, onDismiss }: { children: ReactNode; onDismiss?: () => void }) {
  return (
    <div
      role="alert"
      className="rounded-lg border px-3.5 py-2.5 text-sm flex items-start justify-between gap-3"
      style={{ borderColor: "var(--sev-critical)", background: "var(--surface-2)" }}
    >
      <span className="min-w-0 break-words">{children}</span>
      {onDismiss && (
        <button onClick={onDismiss} className="shrink-0 text-xs" style={{ color: "var(--ink-muted)" }}>
          Dismiss
        </button>
      )}
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center gap-2.5 text-sm" style={{ color: "var(--ink-2)" }}>
      <span
        className="w-3.5 h-3.5 rounded-full border-2 animate-spin"
        style={{ borderColor: "var(--border-strong)", borderTopColor: "var(--series-1)" }}
      />
      {label}
    </div>
  );
}

export function Progress({ value }: { value: number }) {
  return (
    <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "var(--surface-2)" }}>
      <div
        className="h-full rounded-full transition-[width] duration-500 ease-out"
        style={{ width: `${Math.max(2, Math.min(100, value * 100))}%`, background: "var(--series-1)" }}
      />
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs font-medium">{label}</span>
      {hint && (
        <span className="block text-[11px] mt-0.5" style={{ color: "var(--ink-muted)" }}>
          {hint}
        </span>
      )}
      <div className="mt-1.5">{children}</div>
    </label>
  );
}

export const inputStyle: React.CSSProperties = {
  background: "var(--surface-2)",
  borderColor: "var(--border)",
  color: "var(--ink)",
};

export const inputClass =
  "w-full rounded-lg border px-3 py-2 text-sm outline-none focus:border-[var(--series-1)] transition-colors";
