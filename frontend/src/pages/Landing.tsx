import { useEffect, useRef, useState } from "react";
import { HERO_FRAME } from "../heroFrame";

/**
 * The first thing anyone sees. It has to answer "what is this and why should I
 * care" before it asks for a single click.
 *
 * Depth here is CSS only — perspective, translateZ and layered shadow. A WebGL
 * library would be a megabyte of dependency for a page that renders once.
 */

const CAPABILITIES = [
  {
    title: "Ask in plain language",
    body: "“Was the fire exit blocked?” “How many pallets are on the floor?” No query language, no dashboard to configure.",
    icon: "M11 3a8 8 0 1 0 5.3 14L21 21.7 22.4 20l-4.6-4.6A8 8 0 0 0 11 3m0 2a6 6 0 1 1 0 12 6 6 0 0 1 0-12",
  },
  {
    title: "You write the checks",
    body: "A check is a question plus the answer shape it expects — yes/no, a count, one of a list. Safety, stock, product type, anything.",
    icon: "M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z",
  },
  {
    title: "Every answer cites its frame",
    body: "The model writes the sentence; the evidence is a real frame with a real timestamp. Click it and the player jumps there.",
    icon: "M4 5h16v14H4zm5 3.5v7l6-3.5z",
  },
  {
    title: "Incidents open themselves",
    body: "A check that trips with enough confidence files an incident with the clip attached. Consecutive frames merge into one event.",
    icon: "M12 2 1 21h22zm0 4.5L18.5 19h-13zM11 10h2v5h-2zm0 6h2v2h-2z",
  },
  {
    title: "Bring your own footage",
    body: "Drag in an MP4 and point it at your own problem. The file never leaves your machine — only small, downscaled frames do.",
    icon: "M5 20h14v-2H5zM12 4 6.5 9.5 7.9 10.9 11 7.8V16h2V7.8l3.1 3.1 1.4-1.4z",
  },
  {
    title: "Runs on a laptop, free",
    body: "No GPU, no vector database, no monthly bill. Free-tier vision API, or fully offline with a local model.",
    icon: "M4 6h16v10H4zm-2 12h20v2H2zM6 8v6h12V8z",
  },
];

const PIPELINE = [
  { n: "1,080,000", label: "frames in ten hours", note: "30 fps, one camera", tone: "muted" },
  { n: "36,000", label: "sampling at 1 fps", note: "−96.5%, on any footage", tone: "muted" },
  { n: "~12,000", label: "motion filter", note: "−66% measured, 10–88% by clip", tone: "accent" },
  { n: "~1,000", label: "vision requests", note: "12 frames packed per call", tone: "accent" },
];

const QUESTIONS = [
  "Was anyone working without a hi-vis vest?",
  "How many pallets are on the floor right now?",
  "Was the loading bay ever blocked this shift?",
  "Did a forklift come close to a person?",
  "What kind of goods are in this aisle?",
  "Is any packaging damaged?",
];

/** Card that leans toward the pointer. Subtle — 6 degrees, not a carnival. */
function TiltCard({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [t, setT] = useState("");

  return (
    <div
      ref={ref}
      onMouseMove={(e) => {
        const r = ref.current!.getBoundingClientRect();
        const px = (e.clientX - r.left) / r.width - 0.5;
        const py = (e.clientY - r.top) / r.height - 0.5;
        setT(`perspective(900px) rotateY(${px * 6}deg) rotateX(${-py * 6}deg) translateZ(6px)`);
      }}
      onMouseLeave={() => setT("")}
      className={`transition-transform duration-300 ease-out will-change-transform ${className}`}
      style={{ transform: t }}
    >
      {children}
    </div>
  );
}

function Reveal({ children, delay = 0 }: { children: React.ReactNode; delay?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => e.isIntersecting && setShown(true),
      { threshold: 0.15 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div
      ref={ref}
      style={{
        opacity: shown ? 1 : 0,
        transform: shown ? "none" : "translateY(18px)",
        transition: `opacity .6s ease ${delay}ms, transform .6s cubic-bezier(.2,.7,.3,1) ${delay}ms`,
      }}
    >
      {children}
    </div>
  );
}

export default function Landing({ onLaunch }: { onLaunch: () => void }) {
  const [q, setQ] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setQ((i) => (i + 1) % QUESTIONS.length), 2600);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="min-h-full" style={{ background: "var(--plane)", color: "var(--ink)" }}>
      <style>{`
        @keyframes drift { 0%,100%{transform:translate3d(0,0,0) scale(1)} 50%{transform:translate3d(0,-18px,0) scale(1.03)} }
        @keyframes sheen { 0%{background-position:0% 50%} 100%{background-position:200% 50%} }
        .mesh::before, .mesh::after {
          content:""; position:absolute; border-radius:50%; filter:blur(80px); opacity:.30; pointer-events:none;
          animation: drift 13s ease-in-out infinite;
        }
        .mesh::before { width:520px; height:520px; left:-120px; top:-160px; background:var(--series-1); }
        .mesh::after  { width:460px; height:460px; right:-140px; top:40px; background:var(--series-3); animation-delay:-6s; }
        .gradtext {
          background: linear-gradient(100deg, var(--ink) 20%, var(--series-1) 45%, var(--ink) 70%);
          background-size: 200% auto; -webkit-background-clip: text; background-clip: text;
          color: transparent; animation: sheen 7s linear infinite;
        }
      `}</style>

      {/* ---- Hero ---------------------------------------------------- */}
      <header className="relative overflow-hidden mesh">
        <nav className="relative max-w-6xl mx-auto px-6 sm:px-8 py-5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="var(--series-1)" aria-hidden>
              <path d="M4 5h16v14H4zm5 3.5v7l6-3.5z" />
            </svg>
            <span className="font-semibold text-sm tracking-tight">Incident Intel</span>
          </div>
          <div className="flex items-center gap-2">
            <a
              href="https://github.com/Harshsoni-anlt/video-incident-intel"
              target="_blank"
              rel="noreferrer"
              className="text-xs px-3 py-2 rounded-lg border transition-colors hover:opacity-75"
              style={{ borderColor: "var(--border)", color: "var(--ink-2)" }}
            >
              View source
            </a>
            <button
              onClick={onLaunch}
              className="text-xs font-medium px-3.5 py-2 rounded-lg text-white transition-opacity hover:opacity-85"
              style={{ background: "var(--series-1)" }}
            >
              Open the app
            </button>
          </div>
        </nav>

        <div className="relative max-w-6xl mx-auto px-6 sm:px-8 pt-14 pb-20 grid lg:grid-cols-[1.05fr_1fr] gap-14 items-center">
          <div>
            <span
              className="inline-flex items-center gap-2 text-[11px] px-2.5 py-1 rounded-full border"
              style={{ borderColor: "var(--border)", color: "var(--ink-2)" }}
            >
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: "var(--good)" }} />
              Runs on a laptop · free tier · no GPU
            </span>

            <h1 className="mt-5 text-[2.6rem] sm:text-6xl font-semibold leading-[1.04] tracking-[-0.03em]">
              <span className="gradtext">A warehouse has cameras.</span>
              <br />
              Nobody watches them.
            </h1>

            <p className="mt-5 text-base sm:text-lg leading-relaxed max-w-xl" style={{ color: "var(--ink-2)" }}>
              Footage only gets reviewed after something has gone wrong, by scrubbing hours of
              video looking for the moment. This asks the footage instead — in a sentence — and
              answers with the frame that proves it.
            </p>

            <div
              className="mt-6 rounded-xl border px-4 py-3.5 max-w-xl overflow-hidden"
              style={{ borderColor: "var(--border)", background: "var(--surface)" }}
            >
              <div className="text-[11px] uppercase tracking-wider mb-1.5" style={{ color: "var(--ink-muted)" }}>
                Ask it anything
              </div>
              <div className="relative h-6">
                {QUESTIONS.map((text, i) => (
                  <div
                    key={text}
                    className="absolute inset-0 text-sm transition-all duration-500"
                    style={{
                      opacity: i === q ? 1 : 0,
                      transform: i === q ? "none" : "translateY(8px)",
                    }}
                  >
                    {text}
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-7 flex flex-wrap items-center gap-3">
              <button
                onClick={onLaunch}
                className="text-sm font-medium px-5 py-2.5 rounded-lg text-white transition-transform hover:-translate-y-0.5"
                style={{ background: "var(--series-1)", boxShadow: "0 10px 30px -12px var(--series-1)" }}
              >
                Open the app →
              </button>
              <span className="text-xs" style={{ color: "var(--ink-muted)" }}>
                A demo is already analysed and waiting
              </span>
            </div>
          </div>

          {/* Floating 3D stack: the product, abstracted */}
          <Reveal delay={120}>
            <div className="relative" style={{ perspective: "1400px" }}>
              <div
                className="relative"
                style={{ transformStyle: "preserve-3d", transform: "rotateY(-17deg) rotateX(9deg)" }}
              >
                <MockPanel />
              </div>
            </div>
          </Reveal>
        </div>
      </header>

      {/* ---- The engineering problem --------------------------------- */}
      <section className="max-w-6xl mx-auto px-6 sm:px-8 py-16">
        <Reveal>
          <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight">
            Ten hours of footage is a million frames.
          </h2>
          <p className="mt-3 max-w-2xl leading-relaxed" style={{ color: "var(--ink-2)" }}>
            Sending them all to a vision model is impossible on a free tier and pointless besides —
            an aisle at 3am is the same frame ten thousand times. So the engineering is all in
            deciding what <em>not</em> to send.
          </p>
        </Reveal>

        <div className="mt-9 grid sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
          {PIPELINE.map((s, i) => (
            <Reveal key={s.label} delay={i * 90}>
              <TiltCard>
                <div
                  className="rounded-xl border px-5 py-5 h-full relative overflow-hidden"
                  style={{
                    borderColor: s.tone === "accent" ? "var(--series-1)" : "var(--border)",
                    background: "var(--surface)",
                    boxShadow: s.tone === "accent" ? "0 18px 40px -28px var(--series-1)" : "none",
                  }}
                >
                  <div
                    className="text-2xl font-semibold tnum tracking-tight"
                    style={{ color: s.tone === "accent" ? "var(--series-1)" : "var(--ink)" }}
                  >
                    {s.n}
                  </div>
                  <div className="text-sm mt-1.5">{s.label}</div>
                  <div className="text-xs mt-1 leading-snug" style={{ color: "var(--ink-muted)" }}>
                    {s.note}
                  </div>
                  <span
                    aria-hidden
                    className="absolute right-3 top-3 text-[11px] tnum"
                    style={{ color: "var(--ink-muted)" }}
                  >
                    {i + 1}
                  </span>
                </div>
              </TiltCard>
            </Reveal>
          ))}
        </div>

        <Reveal delay={200}>
          <p className="mt-5 text-xs max-w-2xl leading-relaxed" style={{ color: "var(--ink-muted)" }}>
            Two different reductions, and it matters which is which. Sampling is arithmetic — it
            removes 96.5% of frames on any footage, guaranteed. The motion filter is a judgement
            about your specific video: measured across four real warehouse clips it removed a
            further 66%, but the spread was 10% on ten seconds of continuous action to 88% on a
            mostly-undisturbed aisle. Real overnight CCTV looks much more like the second.
            The dashboard shows what your own runs cost against what they would have cost with
            the filter off, so you never have to take that on trust.
          </p>
        </Reveal>
      </section>

      {/* ---- Capabilities -------------------------------------------- */}
      <section className="max-w-6xl mx-auto px-6 sm:px-8 py-16">
        <Reveal>
          <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight">What it does</h2>
          <p className="mt-3 max-w-2xl leading-relaxed" style={{ color: "var(--ink-2)" }}>
            It isn't a safety detector with a fixed list of classes. It's a frame-reading pipeline
            you point at your own problem.
          </p>
        </Reveal>

        <div className="mt-9 grid sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
          {CAPABILITIES.map((c, i) => (
            <Reveal key={c.title} delay={i * 70}>
              <TiltCard className="h-full">
                <div
                  className="rounded-xl border px-5 py-5 h-full"
                  style={{ borderColor: "var(--border)", background: "var(--surface)" }}
                >
                  <div
                    className="w-9 h-9 rounded-lg grid place-items-center mb-3.5"
                    style={{ background: "var(--surface-2)" }}
                  >
                    <svg width="17" height="17" viewBox="0 0 24 24" fill="var(--series-1)" aria-hidden>
                      <path d={c.icon} />
                    </svg>
                  </div>
                  <h3 className="text-sm font-semibold">{c.title}</h3>
                  <p className="text-xs mt-1.5 leading-relaxed" style={{ color: "var(--ink-2)" }}>
                    {c.body}
                  </p>
                </div>
              </TiltCard>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ---- How a check works --------------------------------------- */}
      <section className="max-w-6xl mx-auto px-6 sm:px-8 py-16">
        <div className="grid lg:grid-cols-2 gap-12 items-center">
          <Reveal>
            <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight">
              A check is one sentence.
            </h2>
            <p className="mt-3 leading-relaxed" style={{ color: "var(--ink-2)" }}>
              Write the question, say what kind of answer you expect, and say what counts as a
              problem. That's the whole configuration. It gets asked of every frame that survives
              the filter, and anything that trips opens an incident.
            </p>
            <ul className="mt-5 space-y-2.5 text-sm" style={{ color: "var(--ink-2)" }}>
              {[
                "No labelled data, no training, no model to fine-tune",
                "Add a new one by typing it — results on the next run",
                "Group them into profiles and pick one per analysis",
              ].map((t) => (
                <li key={t} className="flex gap-2.5">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="var(--good)" className="mt-0.5 shrink-0" aria-hidden>
                    <path d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z" />
                  </svg>
                  {t}
                </li>
              ))}
            </ul>
          </Reveal>

          <Reveal delay={140}>
            <div style={{ perspective: "1200px" }}>
              <div
                className="rounded-xl border overflow-hidden"
                style={{
                  borderColor: "var(--border)",
                  background: "var(--surface)",
                  transform: "rotateY(8deg) rotateX(4deg)",
                  transformStyle: "preserve-3d",
                  boxShadow: "0 40px 80px -50px rgba(0,0,0,.8)",
                }}
              >
                <div className="px-5 py-3.5 border-b" style={{ borderColor: "var(--border)" }}>
                  <div className="text-xs font-semibold">New check</div>
                </div>
                <div className="px-5 py-4 space-y-3.5 text-xs">
                  <Row label="Question" value="How many pallets are stacked in this frame?" />
                  <Row label="Answer type" value="Count" />
                  <Row label="Short name" value="Pallets on the floor" />
                  <Row label="File an incident when" value="> 3" accent />
                  <Row label="Severity" value="Medium" />
                </div>
                <div
                  className="px-5 py-3 border-t text-[11px]"
                  style={{ borderColor: "var(--border)", color: "var(--ink-muted)" }}
                >
                  Asked of every analysed frame · cited answers · auto-filed incidents
                </div>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ---- CTA ------------------------------------------------------ */}
      <section className="max-w-6xl mx-auto px-6 sm:px-8 pb-24">
        <Reveal>
          <div
            className="relative overflow-hidden rounded-2xl border px-8 py-14 text-center mesh"
            style={{ borderColor: "var(--border)", background: "var(--surface)" }}
          >
            <div className="relative">
              <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight">
                Point it at your own footage.
              </h2>
              <p className="mt-3 max-w-xl mx-auto leading-relaxed" style={{ color: "var(--ink-2)" }}>
                A demo clip is already analysed and waiting. When you want to try it properly, drag
                in your own video and write your own checks.
              </p>
              <button
                onClick={onLaunch}
                className="mt-7 text-sm font-medium px-6 py-3 rounded-lg text-white transition-transform hover:-translate-y-0.5"
                style={{ background: "var(--series-1)", boxShadow: "0 14px 36px -14px var(--series-1)" }}
              >
                Open the app →
              </button>
            </div>
          </div>
        </Reveal>

        <p className="mt-6 text-center text-[11px]" style={{ color: "var(--ink-muted)" }}>
          Apache 2.0 · Demo footage is fully synthetic, rendered in simulation — no real people
        </p>
      </section>
    </div>
  );
}

function Row({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider mb-1" style={{ color: "var(--ink-muted)" }}>
        {label}
      </div>
      <div
        className="rounded-lg border px-3 py-2"
        style={{
          borderColor: accent ? "var(--series-1)" : "var(--border)",
          background: "var(--surface-2)",
          color: accent ? "var(--series-1)" : "var(--ink)",
        }}
      >
        {value}
      </div>
    </div>
  );
}

/** An abstracted view of the review screen, floating in 3D. */
function MockPanel() {
  const marks = [
    { at: 12, sev: "var(--sev-high)" },
    { at: 41, sev: "var(--sev-critical)" },
    { at: 68, sev: "var(--sev-medium)" },
  ];
  return (
    <div
      className="rounded-2xl border overflow-hidden"
      style={{
        borderColor: "var(--border-strong)",
        background: "var(--surface)",
        boxShadow: "0 60px 120px -60px rgba(0,0,0,.9), 0 0 0 1px var(--border)",
      }}
    >
      {/* A real analysed frame, at the moment the check trips. */}
      <div className="relative aspect-video overflow-hidden" style={{ background: "var(--plane)" }}>
        <img
          src={HERO_FRAME}
          alt="Warehouse camera frame: a forklift passing close to a worker"
          className="absolute inset-0 w-full h-full object-cover"
        />
        <div
          className="absolute inset-0"
          style={{ background: "linear-gradient(180deg, rgba(0,0,0,.45) 0%, transparent 38%, rgba(0,0,0,.30) 100%)" }}
        />
        {/* No bounding box: this system makes frame-level findings, it does not
            localise objects. Drawing one would advertise a capability that does
            not exist. */}
        <div
          className="absolute left-3 top-3 text-[10px] px-2 py-1 rounded-md flex items-center gap-1.5 backdrop-blur-sm"
          style={{ background: "rgba(10,10,12,.78)", color: "#fff" }}
        >
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: "var(--sev-critical)" }} />
          Person near a moving forklift · 00:04 · 0.90
        </div>
        <div
          className="absolute right-3 bottom-3 text-[10px] px-2 py-1 rounded-md"
          style={{ background: "rgba(10,10,12,.78)", color: "rgba(255,255,255,.72)" }}
        >
          nearmiss.mp4
        </div>
      </div>

      {/* timeline */}
      <div className="px-4 py-3.5">
        <div className="relative h-8 rounded-lg overflow-hidden" style={{ background: "var(--surface-2)" }}>
          {Array.from({ length: 26 }).map((_, i) => (
            <span
              key={i}
              className="absolute top-0 bottom-0 w-px"
              style={{ left: `${(i / 25) * 100}%`, background: "var(--border-strong)" }}
            />
          ))}
          {marks.map((m) => (
            <span
              key={m.at}
              className="absolute top-1 bottom-1 w-1 rounded-full"
              style={{ left: `${m.at}%`, background: m.sev, boxShadow: "0 0 0 2px var(--surface-2)" }}
            />
          ))}
        </div>
        <div className="flex justify-between mt-1.5 text-[10px] tnum" style={{ color: "var(--ink-muted)" }}>
          <span>00:00</span>
          <span>9 analysed frames · 3 flagged</span>
          <span>10:00</span>
        </div>
      </div>

      {/* answer */}
      <div className="px-4 pb-4">
        <div
          className="rounded-lg border px-3 py-2.5 text-[11px] leading-relaxed"
          style={{ borderColor: "var(--border)", background: "var(--surface-2)", color: "var(--ink-2)" }}
        >
          <span style={{ color: "var(--ink)" }}>
            Yes — the forklift passes within two metres of the worker
          </span>{" "}
          <span style={{ color: "var(--series-1)" }}>[00:00:04]</span>, and the person steps back{" "}
          <span style={{ color: "var(--series-1)" }}>[00:00:05]</span>.
        </div>
      </div>
    </div>
  );
}
