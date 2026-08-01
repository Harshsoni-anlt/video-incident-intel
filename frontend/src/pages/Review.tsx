import { useEffect, useRef, useState } from "react";
import {
  api,
  hms,
  SEVERITY_COLOR,
  streamUrl,
  thumbUrl,
  type Citation,
  type Frame,
  type Incident,
  type Video,
} from "../api";
import {
  Button,
  Card,
  Empty,
  ErrorNote,
  inputClass,
  inputStyle,
  SeverityBadge,
  Spinner,
} from "../components/ui";

const SUGGESTIONS = [
  "Summarise what happened in this footage",
  "Was a walkway or exit ever blocked?",
  "When was the area busiest?",
  "Did anything unsafe happen?",
];

export default function Review({
  videoId,
  onPickVideo,
}: {
  videoId: number | null;
  onPickVideo: (id: number) => void;
}) {
  const [videos, setVideos] = useState<Video[]>([]);
  const [data, setData] = useState<{ video: Video; frames: Frame[]; incidents: Incident[] } | null>(null);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<Frame | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [answer, setAnswer] = useState<{ answer: string; citations: Citation[] } | null>(null);

  useEffect(() => {
    api.videos().then((vs) => {
      setVideos(vs.filter((v) => v.status === "ready"));
    });
  }, []);

  useEffect(() => {
    if (!videoId) return;
    setData(null);
    setAnswer(null);
    setSelected(null);
    api
      .timeline(videoId)
      .then((d) => {
        setData(d);
        setSelected(d.frames[0] ?? null);
      })
      .catch((e) => setError(e.message));
  }, [videoId]);

  const seek = (ts: number) => {
    if (videoRef.current) {
      videoRef.current.currentTime = ts;
      videoRef.current.play().catch(() => {
        /* autoplay blocked: the frame still moves */
      });
    }
    const f = data?.frames.reduce((best, cur) =>
      Math.abs(cur.ts_s - ts) < Math.abs(best.ts_s - ts) ? cur : best,
    );
    if (f) setSelected(f);
  };

  const ask = async (q: string) => {
    if (!videoId || !q.trim()) return;
    setAsking(true);
    setError("");
    setAnswer(null);
    try {
      setAnswer(await api.ask(videoId, q));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setAsking(false);
    }
  };

  if (!videoId) {
    return (
      <div className="space-y-5">
        <h1 className="text-xl font-semibold tracking-tight">Review</h1>
        <Card>
          {videos.length === 0 ? (
            <Empty
              title="Nothing analysed yet"
              body="Analyse a video on the Footage page and it will show up here for review."
            />
          ) : (
            <ul className="divide-y" style={{ borderColor: "var(--border)" }}>
              {videos.map((v) => (
                <li key={v.id}>
                  <button
                    onClick={() => onPickVideo(v.id)}
                    className="w-full text-left py-3 px-1 hover:opacity-75 transition-opacity flex items-center justify-between gap-3"
                  >
                    <span className="text-sm truncate">{v.filename}</span>
                    <span className="text-xs tnum shrink-0" style={{ color: "var(--ink-muted)" }}>
                      {hms(v.duration_s ?? 0)} · {v.frame_count} frames
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    );
  }

  if (error) return <ErrorNote onDismiss={() => setError("")}>{error}</ErrorNote>;
  if (!data) return <Spinner label="Loading timeline…" />;

  const duration = data.video.duration_s || 1;

  return (
    <div className="space-y-5">
      <header className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{data.video.filename}</h1>
          <p className="text-sm mt-0.5" style={{ color: "var(--ink-muted)" }}>
            {hms(duration)} · {data.frames.length} frames indexed · {data.incidents.length} incident
            {data.incidents.length === 1 ? "" : "s"}
          </p>
        </div>
        <select
          value={videoId}
          onChange={(e) => onPickVideo(Number(e.target.value))}
          className="rounded-lg border px-3 py-2 text-sm"
          style={inputStyle}
        >
          {videos.map((v) => (
            <option key={v.id} value={v.id}>
              {v.filename}
            </option>
          ))}
        </select>
      </header>

      <div className="grid lg:grid-cols-[1.6fr_1fr] gap-5 items-start">
        <div className="space-y-5">
          <Card pad={false}>
            <video
              ref={videoRef}
              src={streamUrl(videoId)}
              controls
              className="w-full aspect-video bg-black"
              onTimeUpdate={(e) => {
                const t = e.currentTarget.currentTime;
                const f = data.frames.reduce(
                  (best, cur) => (Math.abs(cur.ts_s - t) < Math.abs(best.ts_s - t) ? cur : best),
                  data.frames[0],
                );
                if (f && f.id !== selected?.id) setSelected(f);
              }}
            />

            {/* Timeline: incident markers over the clip's duration. Click to seek. */}
            <div className="px-5 py-4">
              <div
                className="relative h-10 rounded-lg overflow-hidden cursor-pointer"
                style={{ background: "var(--surface-2)" }}
                onClick={(e) => {
                  const r = e.currentTarget.getBoundingClientRect();
                  seek(((e.clientX - r.left) / r.width) * duration);
                }}
                role="slider"
                aria-label="Seek through detected events"
                aria-valuemin={0}
                aria-valuemax={duration}
                aria-valuenow={selected?.ts_s ?? 0}
                tabIndex={0}
              >
                {/* Every analysed frame, as a faint tick */}
                {data.frames.map((f) => (
                  <span
                    key={f.id}
                    className="absolute top-0 bottom-0 w-px"
                    style={{ left: `${(f.ts_s / duration) * 100}%`, background: "var(--border-strong)" }}
                  />
                ))}
                {/* Incidents, in severity colour, sitting above the ticks */}
                {data.incidents.map((i) => (
                  <span
                    key={i.id}
                    title={`${i.severity} · ${hms(i.ts_s)} — ${i.description}`}
                    className="absolute top-1 bottom-1 w-1 rounded-full"
                    style={{
                      left: `${(i.ts_s / duration) * 100}%`,
                      background: SEVERITY_COLOR[i.severity],
                      boxShadow: "0 0 0 2px var(--surface-2)",
                    }}
                  />
                ))}
                {selected && (
                  <span
                    className="absolute top-0 bottom-0 w-0.5"
                    style={{ left: `${(selected.ts_s / duration) * 100}%`, background: "var(--ink)" }}
                  />
                )}
              </div>
              <div className="flex justify-between mt-1.5 text-[11px] tnum" style={{ color: "var(--ink-muted)" }}>
                <span>00:00</span>
                <span>{data.frames.length} analysed frames · {data.incidents.length} flagged</span>
                <span>{hms(duration)}</span>
              </div>
            </div>
          </Card>

          <Card
            title="Ask this footage"
            subtitle="Answers cite the frames they came from — the model writes the sentence, the evidence is real"
          >
            <form
              onSubmit={(e) => {
                e.preventDefault();
                ask(question);
              }}
              className="flex gap-2"
            >
              <input
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="Was anyone working without a hi-vis vest?"
                className={inputClass}
                style={inputStyle}
              />
              <Button type="submit" variant="primary" disabled={asking || !question.trim()}>
                {asking ? "Asking…" : "Ask"}
              </Button>
            </form>

            <div className="flex flex-wrap gap-1.5 mt-3">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => {
                    setQuestion(s);
                    ask(s);
                  }}
                  className="text-[11px] px-2 py-1 rounded-md border transition-colors hover:opacity-70"
                  style={{ borderColor: "var(--border)", color: "var(--ink-2)" }}
                >
                  {s}
                </button>
              ))}
            </div>

            {asking && (
              <div className="mt-4">
                <Spinner label="Searching the indexed frames…" />
              </div>
            )}

            {answer && (
              <div className="mt-4 fade-up">
                <p className="text-sm leading-relaxed whitespace-pre-wrap">{answer.answer}</p>
                {answer.citations.length > 0 && (
                  <>
                    <p className="text-[11px] uppercase tracking-wider mt-4 mb-2" style={{ color: "var(--ink-muted)" }}>
                      Evidence
                    </p>
                    <div className="flex gap-2 overflow-x-auto pb-1">
                      {answer.citations.map((c) => (
                        <button
                          key={c.frame_id}
                          onClick={() => seek(c.ts_s)}
                          title={c.description}
                          className="shrink-0 text-left hover:opacity-80 transition-opacity"
                        >
                          <img
                            src={thumbUrl(c.thumb)}
                            alt={c.description}
                            className="w-28 h-16 object-cover rounded-md"
                            style={{ background: "var(--surface-2)" }}
                          />
                          <span className="text-[11px] tnum block mt-1" style={{ color: "var(--ink-muted)" }}>
                            {c.time}
                          </span>
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}
          </Card>
        </div>

        <div className="space-y-5">
          <Card title="Incidents" subtitle="Click to jump to the moment" pad={false}>
            {data.incidents.length === 0 ? (
              <Empty title="Nothing flagged" body="No check tripped on this footage." />
            ) : (
              <ul className="max-h-80 overflow-y-auto">
                {data.incidents.map((i) => (
                  <li key={i.id} className="border-t first:border-t-0" style={{ borderColor: "var(--border)" }}>
                    <button
                      onClick={() => seek(i.ts_s)}
                      className="w-full flex gap-3 px-5 py-3 text-left hover:opacity-80 transition-opacity"
                    >
                      {i.thumb && (
                        <img src={thumbUrl(i.thumb)} alt="" className="w-16 h-10 object-cover rounded shrink-0" />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <SeverityBadge severity={i.severity} small />
                          <span className="text-[11px] tnum" style={{ color: "var(--ink-muted)" }}>
                            {hms(i.ts_s)}
                          </span>
                        </div>
                        <p className="text-xs mt-1 leading-snug">{i.description}</p>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Frame detail" subtitle={selected ? hms(selected.ts_s) : undefined}>
            {!selected ? (
              <Empty title="No frame selected" />
            ) : (
              <>
                <img
                  src={thumbUrl(selected.thumb)}
                  alt={selected.description ?? ""}
                  className="w-full aspect-video object-cover rounded-lg"
                  style={{ background: "var(--surface-2)" }}
                />
                <p className="text-sm mt-3 leading-relaxed">{selected.description || "No description."}</p>
                {selected.observations.length > 0 && (
                  <ul className="mt-3 space-y-1.5">
                    {selected.observations.map((o) => (
                      <li key={o.id} className="flex items-start gap-2 text-xs">
                        <span
                          aria-hidden
                          className="w-1.5 h-1.5 rounded-full mt-1.5 shrink-0"
                          style={{ background: o.tripped ? SEVERITY_COLOR[o.severity] : "var(--border-strong)" }}
                        />
                        <span className="flex-1" style={{ color: "var(--ink-2)" }} title={o.question}>
                          {o.label || o.question}
                        </span>
                        <span className="font-medium shrink-0" style={{ color: o.tripped ? SEVERITY_COLOR[o.severity] : "var(--ink)" }}>
                          {o.value}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
