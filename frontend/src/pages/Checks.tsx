import { useCallback, useEffect, useState } from "react";
import { api, type Check, type Severity } from "../api";
import {
  Button,
  Card,
  Empty,
  ErrorNote,
  Field,
  inputClass,
  inputStyle,
  SeverityBadge,
  Spinner,
} from "../components/ui";

const KINDS = [
  { id: "bool", label: "Yes / no", hint: 'Model answers "true", "false", or "n/a" when nothing relevant is in shot' },
  { id: "count", label: "Count", hint: "Model answers with a number" },
  { id: "category", label: "One of a list", hint: "Model picks a single option you define" },
  { id: "text", label: "Free text", hint: "Model answers with a short phrase" },
] as const;

const TRIP_HINT: Record<Check["kind"], string> = {
  bool: 'Type "true" to flag when it IS the case, or "false" to flag when it is not. Leave empty to only record.',
  count: 'A comparison, e.g. ">3" or "<1". Leave empty to only record the number.',
  category: "Comma-separated values that should flag, e.g. damaged,crushed",
  text: "Comma-separated exact answers that should flag. Usually left empty.",
};

const blank = (profile: string): Partial<Check> => ({
  profile,
  question: "",
  kind: "bool",
  severity: "medium",
  trips_when: "",
  active: 1,
  options: null,
});

export default function Checks() {
  const [checks, setChecks] = useState<Check[] | null>(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<Partial<Check> | null>(null);
  const [profileFilter, setProfileFilter] = useState<string>("");

  const refresh = useCallback(async () => {
    try {
      setChecks(await api.checks());
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const save = async () => {
    if (!editing?.question?.trim() || !editing.profile?.trim()) {
      setError("A check needs a profile and a question.");
      return;
    }
    try {
      const body = {
        ...editing,
        options: editing.kind === "category" ? (editing.options ?? []) : null,
        active: editing.active ? true : false,
      };
      if (editing.id) await api.updateCheck(editing.id, body as never);
      else await api.createCheck(body as never);
      setEditing(null);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const toggle = async (c: Check) => {
    try {
      await api.updateCheck(c.id, { ...c, active: c.active ? false : true } as never);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const remove = async (c: Check) => {
    if (!confirm(`Delete this check?\n\n${c.question}`)) return;
    try {
      await api.deleteCheck(c.id);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  if (checks === null) return <Spinner label="Loading checks…" />;

  const profiles = [...new Set(checks.map((c) => c.profile))].sort();
  const shown = profileFilter ? checks.filter((c) => c.profile === profileFilter) : checks;
  const grouped = shown.reduce<Record<string, Check[]>>((acc, c) => {
    (acc[c.profile] ??= []).push(c);
    return acc;
  }, {});

  return (
    <div className="space-y-5">
      <header className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Checks</h1>
          <p className="text-sm mt-0.5 max-w-2xl" style={{ color: "var(--ink-muted)" }}>
            The questions asked of every frame. This is the part you build — safety, stock counts,
            product types, anything you can phrase in a sentence. Group them into profiles and pick
            a profile when you analyse.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={profileFilter}
            onChange={(e) => setProfileFilter(e.target.value)}
            className="rounded-lg border px-3 py-2 text-sm"
            style={inputStyle}
          >
            <option value="">All profiles</option>
            {profiles.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
          <Button variant="primary" onClick={() => setEditing(blank(profileFilter || "My checks"))}>
            New check
          </Button>
        </div>
      </header>

      {error && <ErrorNote onDismiss={() => setError("")}>{error}</ErrorNote>}

      {editing && (
        <Card title={editing.id ? "Edit check" : "New check"} className="fade-up">
          <div className="grid md:grid-cols-2 gap-4">
            <Field label="Profile" hint="A named set of checks you run together">
              <input
                list="profile-list"
                value={editing.profile ?? ""}
                onChange={(e) => setEditing({ ...editing, profile: e.target.value })}
                className={inputClass}
                style={inputStyle}
                placeholder="Safety compliance"
              />
              <datalist id="profile-list">
                {profiles.map((p) => (
                  <option key={p} value={p} />
                ))}
              </datalist>
            </Field>

            <Field label="Answer type">
              <select
                value={editing.kind}
                onChange={(e) => setEditing({ ...editing, kind: e.target.value as Check["kind"] })}
                className={inputClass}
                style={inputStyle}
              >
                {KINDS.map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.label}
                  </option>
                ))}
              </select>
              <p className="text-[11px] mt-1" style={{ color: "var(--ink-muted)" }}>
                {KINDS.find((k) => k.id === editing.kind)?.hint}
              </p>
            </Field>

            <div className="md:col-span-2">
              <Field label="Question" hint="Written exactly as it will be asked of every frame">
                <textarea
                  value={editing.question ?? ""}
                  onChange={(e) => setEditing({ ...editing, question: e.target.value })}
                  rows={2}
                  className={inputClass}
                  style={inputStyle}
                  placeholder="Is a marked walkway or fire exit blocked by anything?"
                />
              </Field>
            </div>

            {editing.kind === "category" && (
              <div className="md:col-span-2">
                <Field label="Options" hint="Comma-separated. The model must pick exactly one.">
                  <input
                    value={(editing.options ?? []).join(", ")}
                    onChange={(e) =>
                      setEditing({
                        ...editing,
                        options: e.target.value.split(",").map((s) => s.trim()).filter(Boolean),
                      })
                    }
                    className={inputClass}
                    style={inputStyle}
                    placeholder="cardboard boxes, pallets, crates, none visible"
                  />
                </Field>
              </div>
            )}

            <Field label="File an incident when" hint={TRIP_HINT[editing.kind ?? "bool"]}>
              <input
                value={editing.trips_when ?? ""}
                onChange={(e) => setEditing({ ...editing, trips_when: e.target.value })}
                className={inputClass}
                style={inputStyle}
                placeholder={editing.kind === "count" ? ">3" : "true"}
              />
            </Field>

            <Field label="Severity" hint="Only matters if the check can file an incident">
              <select
                value={editing.severity}
                onChange={(e) => setEditing({ ...editing, severity: e.target.value as Severity })}
                className={inputClass}
                style={inputStyle}
              >
                {(["low", "medium", "high", "critical"] as Severity[]).map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <div className="flex items-center gap-2 mt-5">
            <Button variant="primary" onClick={save}>
              {editing.id ? "Save changes" : "Add check"}
            </Button>
            <Button onClick={() => setEditing(null)}>Cancel</Button>
          </div>
        </Card>
      )}

      {Object.keys(grouped).length === 0 ? (
        <Card>
          <Empty title="No checks yet" body="Add one to start asking your own questions of footage." />
        </Card>
      ) : (
        Object.entries(grouped).map(([profile, list]) => (
          <Card
            key={profile}
            title={profile}
            subtitle={`${list.filter((c) => c.active).length} of ${list.length} active`}
            actions={
              <Button size="sm" onClick={() => setEditing(blank(profile))}>
                Add to this profile
              </Button>
            }
            pad={false}
          >
            <ul>
              {list.map((c) => (
                <li
                  key={c.id}
                  className="border-t px-5 py-3 flex items-start gap-3"
                  style={{ borderColor: "var(--border)", opacity: c.active ? 1 : 0.45 }}
                >
                  <input
                    type="checkbox"
                    checked={!!c.active}
                    onChange={() => toggle(c)}
                    className="mt-1 shrink-0"
                    aria-label={`${c.active ? "Disable" : "Enable"} this check`}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm leading-snug">{c.question}</p>
                    <div className="flex items-center gap-2 mt-1.5 flex-wrap text-[11px]" style={{ color: "var(--ink-muted)" }}>
                      <span
                        className="px-1.5 py-0.5 rounded"
                        style={{ background: "var(--surface-2)", color: "var(--ink-2)" }}
                      >
                        {KINDS.find((k) => k.id === c.kind)?.label ?? c.kind}
                      </span>
                      {c.trips_when ? (
                        <>
                          <SeverityBadge severity={c.severity} small />
                          <span>flags when answer is “{c.trips_when}”</span>
                        </>
                      ) : (
                        <span>records only — never files an incident</span>
                      )}
                      {!!c.builtin && <span>· built in</span>}
                    </div>
                  </div>
                  <div className="shrink-0 flex items-center gap-1">
                    <Button size="sm" variant="ghost" onClick={() => setEditing({ ...c, active: c.active })}>
                      Edit
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => remove(c)}>
                      Delete
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        ))
      )}
    </div>
  );
}
