// Typed client for the FastAPI backend. Vite proxies /api in dev.

export type Video = {
  id: number;
  filename: string;
  duration_s: number | null;
  fps: number | null;
  width: number | null;
  height: number | null;
  size_bytes: number | null;
  status: "uploaded" | "analyzing" | "ready" | "failed";
  error: string | null;
  created_at: string;
  incident_count?: number;
  frame_count?: number;
  latest_run_id?: number | null;
};

export type Run = {
  id: number;
  video_id: number;
  profile: string;
  mode: string;
  status: "running" | "done" | "failed";
  stage: string | null;
  progress: number;
  frames_total: number;
  frames_sampled: number;
  frames_kept: number;
  api_calls: number;
  tokens_est: number;
  seconds_elapsed: number;
  error: string | null;
};

export type Severity = "low" | "medium" | "high" | "critical";

export type Check = {
  id: number;
  profile: string;
  question: string;
  kind: "bool" | "count" | "category" | "text";
  options: string[] | null;
  severity: Severity;
  trips_when: string;
  active: number;
  builtin: number;
};

export type Observation = {
  id: number;
  check_id: number;
  ts_s: number;
  value: string;
  value_num: number | null;
  tripped: number;
  confidence: number | null;
  question: string;
  kind: string;
  severity: Severity;
};

export type Frame = {
  id: number;
  ts_s: number;
  thumb: string | null;
  description: string | null;
  motion_score: number | null;
  observations: Observation[];
};

export type Incident = {
  id: number;
  video_id: number;
  check_id: number | null;
  ts_s: number;
  severity: Severity;
  description: string;
  thumb: string | null;
  confidence: number | null;
  exported_at: string | null;
  created_at: string;
  filename?: string;
  question?: string;
};

export type Stats = {
  videos: number;
  hours_of_footage: number;
  runs: number;
  frames_sampled: number;
  frames_sent: number;
  frames_skipped_pct: number;
  api_calls: number;
  tokens: number;
  compute_seconds: number;
  incidents_total: number;
  by_severity: { severity: Severity; count: number }[];
  by_video: { id: number; filename: string; incidents: number }[];
  top_checks: { question: string; severity: Severity; trips: number }[];
  recent_incidents: Incident[];
};

export type Health = {
  status: "ok" | "needs_key";
  detail: string;
  provider: string;
  vision_model: string;
  sample_fps: number;
  motion_threshold: number;
  frames_per_call: number;
  max_frames: number;
  warehouse_export: boolean;
};

export type Citation = {
  frame_id: number;
  ts_s: number;
  thumb: string | null;
  description: string;
  time: string;
};

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    headers: init?.body instanceof FormData ? undefined : { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    // FastAPI puts the human-readable reason in `detail`; surface it rather
    // than a bare status code, because these are things a user can act on
    // ("set your API key", "that file type is not supported").
    let detail = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      if (typeof body.detail === "string") detail = body.detail;
      else if (Array.isArray(body.detail)) detail = body.detail.map((d: any) => d.msg).join("; ");
    } catch {
      /* non-JSON error body: keep the status line */
    }
    throw new Error(detail);
  }
  return res.json();
}

export const api = {
  health: () => req<Health>("/health"),
  stats: () => req<Stats>("/stats"),

  videos: () => req<Video[]>("/videos"),
  video: (id: number) => req<Video & { runs: Run[] }>(`/videos/${id}`),
  deleteVideo: (id: number) => req<{ deleted: number }>(`/videos/${id}`, { method: "DELETE" }),
  createSample: () => req<Video>("/videos/sample", { method: "POST" }),
  upload: (file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return req<Video>("/videos", { method: "POST", body: fd });
  },

  analyze: (id: number, profile: string, mode: "filtered" | "every_frame" = "filtered") =>
    req<{ run_id: number }>(`/videos/${id}/analyze`, {
      method: "POST",
      body: JSON.stringify({ profile, mode }),
    }),
  run: (id: number) => req<Run>(`/runs/${id}`),
  timeline: (id: number) =>
    req<{ video: Video; frames: Frame[]; incidents: Incident[] }>(`/videos/${id}/timeline`),
  ask: (id: number, question: string) =>
    req<{ answer: string; citations: Citation[] }>(`/videos/${id}/ask`, {
      method: "POST",
      body: JSON.stringify({ question, k: 8 }),
    }),

  profiles: () => req<{ profile: string; check_count: number; active_count: number }[]>("/profiles"),
  checks: (profile?: string) =>
    req<Check[]>(`/checks${profile ? `?profile=${encodeURIComponent(profile)}` : ""}`),
  createCheck: (c: Partial<Check>) =>
    req<Check>("/checks", { method: "POST", body: JSON.stringify(c) }),
  updateCheck: (id: number, c: Partial<Check>) =>
    req<Check>(`/checks/${id}`, { method: "PUT", body: JSON.stringify(c) }),
  deleteCheck: (id: number) => req<{ deleted: number }>(`/checks/${id}`, { method: "DELETE" }),

  incidents: (videoId?: number) =>
    req<Incident[]>(`/incidents${videoId ? `?video_id=${videoId}` : ""}`),
  dismissIncident: (id: number) =>
    req<{ dismissed: number }>(`/incidents/${id}`, { method: "DELETE" }),
  pushToWarehouse: () => req<{ exported: number }>("/incidents/push-to-warehouse", { method: "POST" }),
};

export const thumbUrl = (t: string | null) => (t ? `/api/thumbs/${t}` : "");
export const streamUrl = (id: number) => `/api/videos/${id}/stream`;

export const hms = (s: number) => {
  const t = Math.floor(s);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const sec = t % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h ? `${pad(h)}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
};

export const compact = (n: number) =>
  n >= 1_000_000 ? `${(n / 1e6).toFixed(1)}M` : n >= 1_000 ? `${(n / 1e3).toFixed(1)}k` : String(n);

export const SEVERITY_COLOR: Record<Severity, string> = {
  low: "var(--sev-low)",
  medium: "var(--sev-medium)",
  high: "var(--sev-high)",
  critical: "var(--sev-critical)",
};

export const SEVERITY_ORDER: Severity[] = ["low", "medium", "high", "critical"];
