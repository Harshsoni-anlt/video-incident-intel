import { useCallback, useEffect, useState } from "react";
import { api, hms, SEVERITY_ORDER, thumbUrl, type Incident, type Severity } from "../api";
import { Button, Card, Empty, ErrorNote, SeverityBadge, Spinner } from "../components/ui";

export default function Incidents({ onOpenVideo }: { onOpenVideo: (id: number) => void }) {
  const [incidents, setIncidents] = useState<Incident[] | null>(null);
  const [filter, setFilter] = useState<Severity | "">("");
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [webhookReady, setWebhookReady] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setIncidents(await api.incidents());
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    refresh();
    api.health().then((h) => setWebhookReady(h.webhook_configured)).catch(() => {});
  }, [refresh]);

  const dismiss = async (id: number) => {
    try {
      await api.dismissIncident(id);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const send = async () => {
    setError("");
    setNote("");
    try {
      const r = await api.sendIncidents();
      setNote(`Sent ${r.sent} incident${r.sent === 1 ? "" : "s"} to the webhook.`);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  if (incidents === null) return <Spinner label="Loading incidents…" />;

  const shown = filter ? incidents.filter((i) => i.severity === filter) : incidents;

  return (
    <div className="space-y-5">
      <header className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Incidents</h1>
          <p className="text-sm mt-0.5" style={{ color: "var(--ink-muted)" }}>
            Filed automatically when a check trips with enough confidence. Consecutive frames are
            merged into one event.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <a href="/api/incidents/export.csv" download>
            <Button size="sm">Export CSV</Button>
          </a>
          <a href="/api/incidents/export.json" download>
            <Button size="sm">Export JSON</Button>
          </a>
          <Button
            size="sm"
            variant="primary"
            onClick={send}
            title={
              webhookReady
                ? "POST these to the configured endpoint"
                : "Set INCIDENT_WEBHOOK_URL in .env to enable"
            }
          >
            Send to webhook
          </Button>
        </div>
      </header>

      {error && <ErrorNote onDismiss={() => setError("")}>{error}</ErrorNote>}
      {note && (
        <div
          className="rounded-lg border px-3.5 py-2.5 text-sm"
          style={{ borderColor: "var(--good)", background: "var(--surface-2)" }}
        >
          {note}
        </div>
      )}

      {/* Filters sit in one row above the content. */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <FilterChip active={filter === ""} onClick={() => setFilter("")}>
          All ({incidents.length})
        </FilterChip>
        {SEVERITY_ORDER.map((s) => {
          const n = incidents.filter((i) => i.severity === s).length;
          if (!n) return null;
          return (
            <FilterChip key={s} active={filter === s} onClick={() => setFilter(s)}>
              <SeverityBadge severity={s} small /> {n}
            </FilterChip>
          );
        })}
      </div>

      {shown.length === 0 ? (
        <Card>
          <Empty
            title="No incidents"
            body="Either nothing has been analysed yet, or nothing in the footage tripped a check. An empty list is a real result — it is not a failure."
          />
        </Card>
      ) : (
        <Card pad={false}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left" style={{ color: "var(--ink-muted)" }}>
                  <th className="font-medium text-xs px-5 py-2.5">Evidence</th>
                  <th className="font-medium text-xs px-3 py-2.5">Severity</th>
                  <th className="font-medium text-xs px-3 py-2.5">At</th>
                  <th className="font-medium text-xs px-3 py-2.5">What</th>
                  <th className="font-medium text-xs px-3 py-2.5">Confidence</th>
                  <th className="font-medium text-xs px-3 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {shown.map((i) => (
                  <tr key={i.id} className="border-t align-top" style={{ borderColor: "var(--border)" }}>
                    <td className="px-5 py-3">
                      {i.thumb ? (
                        <button onClick={() => onOpenVideo(i.video_id)}>
                          <img
                            src={thumbUrl(i.thumb)}
                            alt=""
                            className="w-24 h-14 object-cover rounded-md hover:opacity-80 transition-opacity"
                            style={{ background: "var(--surface-2)" }}
                          />
                        </button>
                      ) : (
                        <div className="w-24 h-14 rounded-md" style={{ background: "var(--surface-2)" }} />
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <SeverityBadge severity={i.severity} small />
                    </td>
                    <td className="px-3 py-3 tnum whitespace-nowrap">{hms(i.ts_s)}</td>
                    <td className="px-3 py-3 max-w-md">
                      <p className="leading-snug">{i.description}</p>
                      <button
                        onClick={() => onOpenVideo(i.video_id)}
                        className="text-xs mt-1 hover:underline"
                        style={{ color: "var(--ink-muted)" }}
                      >
                        {i.filename}
                      </button>
                    </td>
                    <td className="px-3 py-3 tnum">{((i.confidence ?? 0) * 100).toFixed(0)}%</td>
                    <td className="px-3 py-3 text-right whitespace-nowrap">
                      {i.exported_at && (
                        <span className="text-[11px] mr-2" style={{ color: "var(--ink-muted)" }}>
                          exported
                        </span>
                      )}
                      <Button size="sm" variant="ghost" onClick={() => dismiss(i.id)}>
                        Dismiss
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border transition-colors"
      style={{
        borderColor: active ? "var(--series-1)" : "var(--border)",
        background: active ? "var(--surface-2)" : "transparent",
        color: "var(--ink-2)",
      }}
    >
      {children}
    </button>
  );
}
