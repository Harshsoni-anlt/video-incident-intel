import { useCallback, useEffect, useRef, useState } from "react";
import { api, hms, type Run, type Video } from "../api";
import {
  Button,
  Card,
  Empty,
  ErrorNote,
  Field,
  inputClass,
  inputStyle,
  Progress,
  Spinner,
} from "../components/ui";

const MB = 1024 * 1024;

export default function Footage({ onOpenVideo }: { onOpenVideo: (id: number) => void }) {
  const [videos, setVideos] = useState<Video[] | null>(null);
  const [profiles, setProfiles] = useState<{ profile: string; active_count: number }[]>([]);
  const [profile, setProfile] = useState("Safety compliance");
  const [mode, setMode] = useState<"filtered" | "every_frame">("filtered");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const [runs, setRuns] = useState<Record<number, Run>>({});
  const [realFootage, setRealFootage] = useState<boolean | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    try {
      setVideos(await api.videos());
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    refresh();
    api.sampleStatus().then((s) => setRealFootage(s.has_real_footage)).catch(() => {});
    api.profiles().then((p) => {
      setProfiles(p);
      if (p.length && !p.some((x) => x.profile === "Safety compliance")) setProfile(p[0].profile);
    });
  }, [refresh]);

  // Poll only while something is actually running, and stop as soon as it isn't.
  useEffect(() => {
    const running = (videos ?? []).filter((v) => v.status === "analyzing");
    if (!running.length) return;
    const t = setInterval(async () => {
      for (const v of running) {
        if (!v.latest_run_id) continue;
        try {
          const r = await api.run(v.latest_run_id);
          setRuns((prev) => ({ ...prev, [v.id]: r }));
          if (r.status !== "running") refresh();
        } catch {
          /* transient: the next tick retries */
        }
      }
    }, 1500);
    return () => clearInterval(t);
  }, [videos, refresh]);

  const upload = async (file: File) => {
    setError("");
    setBusy(`Uploading ${file.name}…`);
    try {
      const v = await api.upload(file);
      await refresh();
      return v;
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  };

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files?.[0];
    if (f) await upload(f);
  };

  const analyze = async (id: number) => {
    setError("");
    try {
      await api.analyze(id, profile, mode);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const remove = async (id: number) => {
    if (!confirm("Delete this video, its frames and its incidents? This cannot be undone.")) return;
    try {
      await api.deleteVideo(id);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const sample = async () => {
    setBusy("Generating a sample clip…");
    try {
      await api.createSample();
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Footage</h1>
        <p className="text-sm mt-0.5" style={{ color: "var(--ink-muted)" }}>
          Upload your own video and run it through the same pipeline as the demo.
        </p>
      </header>

      {error && <ErrorNote onDismiss={() => setError("")}>{error}</ErrorNote>}

      <Card>
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          onClick={() => fileRef.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => e.key === "Enter" && fileRef.current?.click()}
          className="rounded-xl border-2 border-dashed px-6 py-10 text-center cursor-pointer transition-colors"
          style={{
            borderColor: dragging ? "var(--series-1)" : "var(--border-strong)",
            background: dragging ? "var(--surface-2)" : "transparent",
          }}
        >
          <input
            ref={fileRef}
            type="file"
            accept="video/mp4,video/quicktime,video/x-msvideo,video/x-matroska,video/webm"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
          />
          {busy ? (
            <div className="flex justify-center">
              <Spinner label={busy} />
            </div>
          ) : (
            <>
              <p className="text-sm font-medium">Drop a video here, or click to choose one</p>
              <p className="text-xs mt-1.5" style={{ color: "var(--ink-muted)" }}>
                MP4, MOV, AVI, MKV or WebM · up to 500 MB · nothing is uploaded anywhere but this machine
              </p>
              <div className="mt-4 flex items-center justify-center gap-2">
                <Button variant="primary">Choose a file</Button>
                {/* Sits inside the click-to-browse dropzone, so it must not
                    also open the file dialog. */}
                <Button
                  onClick={(e) => {
                    e.stopPropagation();
                    sample();
                  }}
                >
                  {realFootage === false ? "Use a test pattern" : "Use a sample clip"}
                </Button>
              </div>
              {realFootage === false && (
                // Without this, someone writes "how many people are visible?",
                // runs it against coloured rectangles, gets zero, and concludes
                // the app is broken. It isn't — there are no people in it.
                <p className="text-[11px] mt-3 max-w-lg mx-auto leading-relaxed" style={{ color: "var(--ink-muted)" }}>
                  No real footage downloaded yet, so the sample is an abstract test pattern —
                  moving shapes, no people or shelving. It proves the pipeline runs, but
                  questions about people or stock will honestly answer zero.
                  Run <code>python scripts/fetch_sample.py</code> for real warehouse footage.
                </p>
              )}
            </>
          )}
        </div>

        <div className="grid sm:grid-cols-2 gap-4 mt-5">
          <Field label="Check profile" hint="Which set of questions to ask of every frame">
            <select
              value={profile}
              onChange={(e) => setProfile(e.target.value)}
              className={inputClass}
              style={inputStyle}
            >
              {profiles.map((p) => (
                <option key={p.profile} value={p.profile}>
                  {p.profile} ({p.active_count} active)
                </option>
              ))}
            </select>
          </Field>
          <Field label="Mode" hint="The baseline exists so the saving can be measured, not asserted">
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value as never)}
              className={inputClass}
              style={inputStyle}
            >
              <option value="filtered">Filtered — skip frames where nothing changed</option>
              <option value="every_frame">Baseline — describe every sampled frame</option>
            </select>
          </Field>
        </div>
      </Card>

      {videos === null ? (
        <Spinner label="Loading footage…" />
      ) : videos.length === 0 ? (
        <Card>
          <Empty
            title="No footage yet"
            body="Drop in a clip above, or generate a synthetic sample to watch the whole pipeline run without downloading anything."
          />
        </Card>
      ) : (
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
          {videos.map((v) => {
            const run = runs[v.id];
            return (
              <Card key={v.id} pad={false}>
                <div className="px-5 pt-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="text-sm font-medium truncate" title={v.filename}>
                        {v.filename}
                      </h3>
                      <p className="text-xs mt-0.5 tnum" style={{ color: "var(--ink-muted)" }}>
                        {hms(v.duration_s ?? 0)} · {v.width}×{v.height} ·{" "}
                        {((v.size_bytes ?? 0) / MB).toFixed(1)} MB
                      </p>
                    </div>
                    <StatusPill status={v.status} />
                  </div>

                  {v.status === "analyzing" && (
                    <div className="mt-3.5">
                      <Progress value={run?.progress ?? 0.05} />
                      <p className="text-[11px] mt-1.5" style={{ color: "var(--ink-muted)" }}>
                        {run?.stage ?? "Starting…"}
                        {run?.api_calls ? ` · ${run.api_calls} API calls` : ""}
                      </p>
                    </div>
                  )}

                  {v.status === "failed" && v.error && (
                    <p className="text-xs mt-3 break-words" style={{ color: "var(--sev-critical)" }}>
                      {v.error}
                    </p>
                  )}

                  {v.status === "ready" && (
                    <div className="flex items-center gap-3 mt-3 text-xs" style={{ color: "var(--ink-2)" }}>
                      <span className="tnum">{v.frame_count} frames indexed</span>
                      {!!v.incident_count && (
                        // No severity badge here: the list endpoint returns a
                        // count, not a severity, and showing a guessed one
                        // would misreport how bad the findings are.
                        <span className="tnum">
                          {v.incident_count} incident{v.incident_count === 1 ? "" : "s"}
                        </span>
                      )}
                    </div>
                  )}
                </div>

                <div
                  className="flex items-center gap-2 px-5 py-3.5 mt-3.5 border-t"
                  style={{ borderColor: "var(--border)" }}
                >
                  {v.status === "ready" ? (
                    <Button size="sm" variant="primary" onClick={() => onOpenVideo(v.id)}>
                      Review
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="primary"
                      disabled={v.status === "analyzing"}
                      onClick={() => analyze(v.id)}
                    >
                      {v.status === "analyzing" ? "Analysing…" : "Analyse"}
                    </Button>
                  )}
                  {v.status === "ready" && (
                    <Button size="sm" onClick={() => analyze(v.id)} title="Run again with the current profile">
                      Re-run
                    </Button>
                  )}
                  <span className="flex-1" />
                  <Button size="sm" variant="danger" onClick={() => remove(v.id)}>
                    Delete
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

function StatusPill({ status }: { status: Video["status"] }) {
  const map: Record<Video["status"], { label: string; color: string }> = {
    uploaded: { label: "Not analysed", color: "var(--ink-muted)" },
    analyzing: { label: "Analysing", color: "var(--sev-medium)" },
    ready: { label: "Ready", color: "var(--good)" },
    failed: { label: "Failed", color: "var(--sev-critical)" },
  };
  const s = map[status];
  return (
    <span
      className="shrink-0 inline-flex items-center gap-1.5 text-[11px] px-2 py-1 rounded-md"
      style={{ background: "var(--surface-2)", color: "var(--ink-2)" }}
    >
      <span aria-hidden className="w-1.5 h-1.5 rounded-full" style={{ background: s.color }} />
      {s.label}
    </span>
  );
}
