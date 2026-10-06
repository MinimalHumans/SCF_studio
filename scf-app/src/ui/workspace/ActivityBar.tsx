// SPDX-License-Identifier: Apache-2.0
import { useEffect } from "react";
import { useStore, type NavMode } from "../../state/store.ts";

interface Section {
  mode: NavMode;
  label: string;
  /** Not built yet: shown so the shape of the app is visible, not clickable. */
  pending?: string;
}

/**
 * The sections, top to bottom in the order the work tends to flow:
 * write it, develop who and what is in it, then the tools.
 *
 * Always visible rather than a dropdown — the core loop is Script ↔
 * Characters, and a dropdown would make every switch two clicks and
 * hide where you are.
 */
export const SECTION_GROUPS: Array<{ name: string; sections: Section[] }> = [
  { name: "Story", sections: [
    { mode: "script", label: "Script" },
    { mode: "structure", label: "Structure" },
    { mode: "shoot", label: "Shoot" },
  ] },
  { name: "Narrative elements", sections: [
    { mode: "characters", label: "Characters" },
    { mode: "locations", label: "Locations",
      pending: "Locations get their own workspace after Characters." },
    { mode: "props", label: "Props",
      pending: "Props get their own workspace after Characters." },
  ] },
  { name: "Tools", sections: [
    { mode: "subject", label: "Subjects" },
    { mode: "queries", label: "Queries" },
    { mode: "schema", label: "Schema" },
    { mode: "assets", label: "Assets" },
  ] },
];

/** Alt+1 … Alt+0, in list order. Ctrl+digit is the browser's own. */
const SHORTCUTS: NavMode[] = SECTION_GROUPS
  .flatMap((g) => g.sections).map((s) => s.mode);

export function ActivityBar(): JSX.Element {
  const { navMode, setNavMode } = useStore();

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      const m = /^Digit(\d)$/.exec(e.code);
      if (m === null) return;
      const index = m[1] === "0" ? 9 : Number(m[1]) - 1;
      const mode = SHORTCUTS[index];
      const section = SECTION_GROUPS.flatMap((g) => g.sections)
        .find((s) => s.mode === mode);
      if (mode === undefined || section?.pending !== undefined) return;
      e.preventDefault();
      setNavMode(mode);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setNavMode]);

  let n = 0;
  return (
    <nav className="activity-bar" aria-label="Sections">
      {SECTION_GROUPS.map((g) => (
        <div key={g.name} className="activity-group" role="group"
             aria-label={g.name}>
          <span className="activity-group-name">{g.name}</span>
          {g.sections.map((s) => {
            n += 1;
            const key = n === 10 ? "0" : String(n);
            const active = navMode === s.mode;
            return (
              <button key={s.mode}
                      className={"activity-item" + (active ? " active" : "")}
                      aria-current={active ? "page" : undefined}
                      disabled={s.pending !== undefined}
                      title={s.pending ?? `${s.label} (Alt+${key})`}
                      onClick={() => setNavMode(s.mode)}>
                {s.label}
              </button>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
