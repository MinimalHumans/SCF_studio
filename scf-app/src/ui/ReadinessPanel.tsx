import { useEffect, useMemo, useState } from "react";
import type { Row } from "@scf-core/db.ts";
import { readinessReport, type Finding, type ReadinessReport, type Severity }
  from "@scf-core/readiness.ts";
import { exec, registry, useStore } from "../state/store.ts";
import { sceneLabel } from "../state/displayName.ts";

/**
 * Readiness woven in, not bolted on: findings surface where the authoring
 * happens. A character's page shows their blockers (Q02/Q05/Q06 at a
 * position); a scene's page shows its look/sound gaps (Q07/Q08). All
 * semantics come from scf-core's conformance-tested readiness layer;
 * this component only renders.
 *
 * Scene pages can supply a shot for shot-level Q07.
 */

const QUERIES_FOR_SUBJECT: Record<string, string[]> = {
  character: ["Q02", "Q05", "Q06"],
  scene: ["Q07", "Q08"],
};

const SEVERITY_LABEL: Record<Severity, string> = {
  blocker: "blockers",
  warning: "warnings",
  suggestion: "suggestions",
  ok: "ok",
};

export function ReadinessPanel({ subjectEntity, subjectId, sceneId,
                                 shotId = null }: {
  subjectEntity: string;
  subjectId: number;
  /** Position context; for scene subjects this is the subject itself. */
  sceneId: number | null;
  /** Optional shot context — unlocks shot-level Q07. */
  shotId?: number | null;
}): JSX.Element | null {
  const revision = useStore((s) => s.revision);
  const [reports, setReports] = useState<ReadinessReport[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const queries = QUERIES_FOR_SUBJECT[subjectEntity] ?? [];

  useEffect(() => {
    if (queries.length === 0 || sceneId === null) {
      setReports([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      const ctx = { exec, registry };
      const out: ReadinessReport[] = [];
      for (const query of queries) {
        try {
          out.push(await readinessReport(ctx, query,
            subjectEntity === "character"
              ? { character_id: subjectId, scene_id: sceneId }
              : query === "Q07" && shotId !== null
                ? { scene_id: sceneId, shot_id: shotId }
                : { scene_id: sceneId }));
        } catch (e) {
          console.error(`readiness ${query} failed:`, e);
        }
      }
      if (!cancelled) setReports(out);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subjectEntity, subjectId, sceneId, shotId, revision]);

  if (queries.length === 0) return null;
  if (sceneId === null) {
    return (
      <div className="readiness">
        <p className="muted">Pick a position to see readiness.</p>
      </div>
    );
  }

  return (
    <div className="readiness">
      {reports.map((r) => (
        <ReportRow key={r.query} report={r}
                   open={expanded === r.query}
                   onToggle={() =>
                     setExpanded((e) => e === r.query ? null : r.query)} />
      ))}
    </div>
  );
}

function ReportRow({ report, open, onToggle }: {
  report: ReadinessReport; open: boolean; onToggle: () => void;
}): JSX.Element {
  const worst: Severity =
    report.counts.blocker > 0 ? "blocker"
    : report.counts.warning > 0 ? "warning"
    : report.counts.suggestion > 0 ? "suggestion" : "ok";
  return (
    <div className={`readiness-report sev-${worst}`}>
      <button className="readiness-head" onClick={onToggle}
              aria-expanded={open}>
        <span className={`sev-dot sev-${worst}`} />
        <span className="readiness-name">
          {report.query} · {report.meta.name}
        </span>
        <span className="readiness-counts">
          {(["blocker", "warning", "suggestion"] as Severity[])
            .filter((s) => report.counts[s] > 0)
            .map((s) => `${report.counts[s]} ${SEVERITY_LABEL[s]}`)
            .join(" · ") || "ready"}
        </span>
        <span className="tree-caret">{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <ul className="findings">
          {report.findings.map((f, i) => (
            <FindingRow key={i} finding={f} />
          ))}
        </ul>
      )}
    </div>
  );
}

function FindingRow({ finding }: { finding: Finding }): JSX.Element {
  return (
    <li className={`finding sev-${finding.severity}`}>
      <span className={`sev-dot sev-${finding.severity}`} />
      <span className="finding-entity">{finding.entity}</span>
      <span className="finding-message">{finding.message}</span>
    </li>
  );
}

/** Position picker: scenes in story order. */
export function PositionPicker({ scenes, sceneId, onChange }: {
  scenes: Row[];
  sceneId: number | null;
  onChange: (sceneId: number | null) => void;
}): JSX.Element {
  const options = useMemo(() => scenes.map((s) => ({
    id: s["id"] as number,
    label: sceneLabel(s),
  })), [scenes]);
  return (
    <label className="position-picker">
      <span>at</span>
      <select value={sceneId === null ? "" : String(sceneId)}
              onChange={(e) =>
                onChange(e.target.value === ""
                  ? null : Number(e.target.value))}>
        <option value="">— position —</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>{o.label}</option>
        ))}
      </select>
    </label>
  );
}
