import { useEffect, useState } from "react";
import { api, type Health } from "./api";
import Dashboard from "./pages/Dashboard";
import Footage from "./pages/Footage";
import Review from "./pages/Review";
import Checks from "./pages/Checks";
import Incidents from "./pages/Incidents";
import { ErrorNote } from "./components/ui";

type Page = "dashboard" | "footage" | "review" | "checks" | "incidents";

const NAV: { id: Page; label: string; icon: string }[] = [
  { id: "dashboard", label: "Dashboard", icon: "M3 13h4v8H3zM10 3h4v18h-4zM17 9h4v12h-4z" },
  { id: "footage", label: "Footage", icon: "M4 5h16v14H4zm5 3.5v7l6-3.5z" },
  { id: "review", label: "Review", icon: "M11 3a8 8 0 1 0 5.3 14L21 21.7 22.4 20l-4.6-4.6A8 8 0 0 0 11 3m0 2a6 6 0 1 1 0 12 6 6 0 0 1 0-12" },
  { id: "checks", label: "Checks", icon: "M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z" },
  { id: "incidents", label: "Incidents", icon: "M12 2 1 21h22zm0 4.5L18.5 19h-13zM11 10h2v5h-2zm0 6h2v2h-2z" },
];

function useTheme() {
  const [theme, setTheme] = useState<"dark" | "light">(
    () => (localStorage.getItem("theme") as "dark" | "light") ?? "dark",
  );
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("theme", theme);
  }, [theme]);
  return [theme, setTheme] as const;
}

const pageFromHash = (): Page => {
  const h = location.hash.replace("#", "") as Page;
  return NAV.some((n) => n.id === h) ? h : "dashboard";
};

export default function App() {
  const [page, setPage] = useState<Page>(pageFromHash);
  const [videoId, setVideoId] = useState<number | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [theme, setTheme] = useTheme();

  useEffect(() => {
    api.health().then(setHealth).catch(() => setHealth(null));
  }, []);

  // Keep the hash in step so pages are linkable and the back button works.
  useEffect(() => {
    if (pageFromHash() !== page) location.hash = page;
  }, [page]);

  useEffect(() => {
    const onHash = () => setPage(pageFromHash());
    addEventListener("hashchange", onHash);
    return () => removeEventListener("hashchange", onHash);
  }, []);

  // Opening a specific video from anywhere lands on the review screen.
  const openVideo = (id: number) => {
    setVideoId(id);
    setPage("review");
  };

  return (
    <div className="flex h-full">
      <nav
        className="w-56 shrink-0 border-r flex flex-col"
        style={{ borderColor: "var(--border)", background: "var(--surface)" }}
      >
        <div className="px-5 py-5">
          <div className="flex items-center gap-2">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="var(--series-1)" aria-hidden>
              <path d="M4 5h16v14H4zm5 3.5v7l6-3.5z" />
            </svg>
            <span className="font-semibold text-sm tracking-tight">Incident Intel</span>
          </div>
          <p className="text-[11px] mt-1.5 leading-snug" style={{ color: "var(--ink-muted)" }}>
            Plain-language search over camera footage
          </p>
        </div>

        <ul className="px-2.5 flex-1 space-y-0.5">
          {NAV.map((n) => (
            <li key={n.id}>
              <button
                onClick={() => setPage(n.id)}
                aria-current={page === n.id ? "page" : undefined}
                className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm transition-colors"
                style={{
                  background: page === n.id ? "var(--surface-2)" : "transparent",
                  color: page === n.id ? "var(--ink)" : "var(--ink-2)",
                  fontWeight: page === n.id ? 600 : 400,
                }}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                  <path d={n.icon} />
                </svg>
                {n.label}
              </button>
            </li>
          ))}
        </ul>

        <div className="px-4 py-4 border-t space-y-3" style={{ borderColor: "var(--border)" }}>
          {health && (
            <div className="text-[11px] leading-relaxed" style={{ color: "var(--ink-muted)" }}>
              <div className="flex items-center gap-1.5">
                <span
                  className="w-1.5 h-1.5 rounded-full"
                  style={{ background: health.status === "ok" ? "var(--good)" : "var(--sev-medium)" }}
                />
                {health.provider} · {health.vision_model}
              </div>
              <div className="mt-1">
                {health.sample_fps} fps sampling · {health.frames_per_call} frames/call
              </div>
            </div>
          )}
          <button
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            className="text-[11px] hover:opacity-70 transition-opacity"
            style={{ color: "var(--ink-muted)" }}
          >
            Switch to {theme === "dark" ? "light" : "dark"} theme
          </button>
        </div>
      </nav>

      <main className="flex-1 overflow-y-auto">
        <div className="max-w-[1400px] mx-auto px-8 py-7">
          {health?.status === "needs_key" && (
            <div className="mb-5">
              <ErrorNote>{health.detail}</ErrorNote>
            </div>
          )}

          <div key={page} className="fade-up">
            {page === "dashboard" && <Dashboard onOpenVideo={openVideo} goto={setPage} />}
            {page === "footage" && <Footage onOpenVideo={openVideo} />}
            {page === "review" && <Review videoId={videoId} onPickVideo={setVideoId} />}
            {page === "checks" && <Checks />}
            {page === "incidents" && <Incidents onOpenVideo={openVideo} />}
          </div>
        </div>
      </main>
    </div>
  );
}
