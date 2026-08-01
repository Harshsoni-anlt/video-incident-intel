import { useCallback, useEffect, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api, compact, footage, hms, SEVERITY_COLOR, SEVERITY_ORDER, thumbUrl, type Stats } from "../api";
import { Button, Card, Empty, ErrorNote, SeverityBadge, Spinner, Stat } from "../components/ui";
import { axisProps, SavingsBar, TooltipBox } from "../components/charts";

export default function Dashboard({
  onOpenVideo,
  goto,
}: {
  onOpenVideo: (id: number) => void;
  goto: (p: "footage") => void;
}) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [seeding, setSeeding] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const [s, h] = await Promise.all([api.stats(), api.health()]);
      setStats(s);
      setSeeding(h.seeding);
      return h.seeding;
    } catch (e) {
      setError((e as Error).message);
      return false;
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // On a fresh install the backend analyses a demo clip in the background, so
  // the first thing anyone sees is the product working rather than an empty
  // dashboard. Poll until it lands.
  useEffect(() => {
    if (!seeding) return;
    const t = setInterval(() => load(), 2000);
    return () => clearInterval(t);
  }, [seeding, load]);

  if (error) return <ErrorNote>{error}</ErrorNote>;
  if (!stats) return <Spinner label="Loading…" />;

  if (!stats.videos) {
    return (
      <Card>
        {seeding ? (
          <div className="py-12 text-center">
            <div className="flex justify-center">
              <Spinner label="Preparing your demo…" />
            </div>
            <p className="text-xs mt-3 max-w-md mx-auto leading-relaxed" style={{ color: "var(--ink-muted)" }}>
              Sampling frames, filtering out everything that didn't change, and asking the
              vision model about what's left. This is a real analysis, not a fixture — about
              ten seconds.
            </p>
          </div>
        ) : (
          <Empty
            title="No footage yet"
            body="Upload a clip, or generate a synthetic sample to see the whole pipeline run end to end without downloading anything."
            action={<Button variant="primary" onClick={() => goto("footage")}>Add footage</Button>}
          />
        )}
      </Card>
    );
  }

  const severityData = SEVERITY_ORDER.map((s) => ({
    severity: s,
    count: stats.by_severity.find((r) => r.severity === s)?.count ?? 0,
  })).filter((d) => d.count > 0);

  const checkData = stats.top_checks.map((c) => ({
    ...c,
    short: c.question.length > 52 ? c.question.slice(0, 52) + "…" : c.question,
  }));

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-sm mt-0.5" style={{ color: "var(--ink-muted)" }}>
          {stats.videos} video{stats.videos === 1 ? "" : "s"} · {footage(stats.seconds_of_footage)} of footage ·{" "}
          {stats.runs} completed run{stats.runs === 1 ? "" : "s"}
        </p>
      </header>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat
          label="Frames skipped"
          value={`${stats.frames_skipped_pct}%`}
          hint={`${compact(stats.frames_sampled - stats.frames_sent)} never left this machine`}
          accent="var(--good)"
        />
        <Stat label="Incidents found" value={stats.incidents_total} hint="Across all footage" />
        <Stat
          label="API calls"
          value={compact(stats.api_calls)}
          hint={`${compact(stats.tokens)} tokens billed to the free tier`}
        />
        <Stat
          label="Analysis time"
          value={`${stats.compute_seconds.toFixed(0)}s`}
          hint={`${footage(stats.seconds_of_footage)} of footage reviewed`}
        />
      </div>

      <Card
        title="What the motion filter saved"
        subtitle="Sampled frames are cheap; described frames are not. Only what changed gets sent."
      >
        <SavingsBar sent={stats.frames_sent} sampled={stats.frames_sampled} />
      </Card>

      <div className="grid lg:grid-cols-2 gap-5">
        <Card title="Incidents by severity" subtitle="Every bar is labelled — colour is never the only cue">
          {severityData.length === 0 ? (
            <Empty title="No incidents filed" body="Nothing in the analysed footage tripped a check." />
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={severityData} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                <CartesianGrid stroke="var(--grid)" vertical={false} />
                <XAxis dataKey="severity" {...axisProps} />
                <YAxis allowDecimals={false} {...axisProps} />
                <Tooltip
                  cursor={{ fill: "var(--surface-2)" }}
                  content={({ active, payload }) =>
                    active && payload?.length ? (
                      <TooltipBox
                        title={String(payload[0].payload.severity)}
                        rows={[
                          {
                            label: "Incidents",
                            value: payload[0].value as number,
                            color: SEVERITY_COLOR[payload[0].payload.severity as never],
                          },
                        ]}
                      />
                    ) : null
                  }
                />
                <Bar dataKey="count" radius={[4, 4, 0, 0]} maxBarSize={56} isAnimationActive={false}>
                  {severityData.map((d) => (
                    <Cell key={d.severity} fill={SEVERITY_COLOR[d.severity]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>

        <Card title="Checks that flag most often" subtitle="Where your footage is actually failing">
          {checkData.length === 0 ? (
            <Empty title="Nothing has tripped yet" />
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart
                data={checkData}
                layout="vertical"
                margin={{ top: 4, right: 16, left: 4, bottom: 0 }}
              >
                <CartesianGrid stroke="var(--grid)" horizontal={false} />
                <XAxis type="number" allowDecimals={false} {...axisProps} />
                <YAxis type="category" dataKey="short" width={190} {...axisProps} />
                <Tooltip
                  cursor={{ fill: "var(--surface-2)" }}
                  content={({ active, payload }) =>
                    active && payload?.length ? (
                      <TooltipBox
                        title={String(payload[0].payload.question)}
                        rows={[
                          { label: "Frames flagged", value: payload[0].value as number, color: "var(--series-1)" },
                          { label: "Severity", value: payload[0].payload.severity },
                        ]}
                      />
                    ) : null
                  }
                />
                <Bar
                  dataKey="trips"
                  fill="var(--series-1)"
                  radius={[0, 4, 4, 0]}
                  maxBarSize={18}
                  isAnimationActive={false}
                />
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>
      </div>

      <Card title="Latest incidents" pad={false}>
        {stats.recent_incidents.length === 0 ? (
          <Empty title="Nothing filed yet" />
        ) : (
          <ul>
            {stats.recent_incidents.map((i) => (
              <li key={i.id} className="border-t first:border-t-0" style={{ borderColor: "var(--border)" }}>
                <button
                  onClick={() => onOpenVideo(i.video_id)}
                  className="w-full flex items-center gap-3 px-5 py-3 text-left hover:opacity-80 transition-opacity"
                >
                  {i.thumb ? (
                    <img
                      src={thumbUrl(i.thumb)}
                      alt=""
                      className="w-20 h-12 object-cover rounded-md shrink-0"
                      style={{ background: "var(--surface-2)" }}
                    />
                  ) : (
                    <div className="w-20 h-12 rounded-md shrink-0" style={{ background: "var(--surface-2)" }} />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm truncate">{i.description}</p>
                    <p className="text-xs mt-0.5" style={{ color: "var(--ink-muted)" }}>
                      {i.filename} · {hms(i.ts_s)}
                    </p>
                  </div>
                  <SeverityBadge severity={i.severity} small />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
