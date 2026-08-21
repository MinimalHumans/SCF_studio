// SPDX-License-Identifier: Apache-2.0
import { useEffect, useMemo, useState } from "react";
import type { Row, SqlValue } from "@scf-core/db.ts";
import { q } from "@scf-core/db.ts";
import type { ReadinessReport } from "@scf-core/readiness.ts";
import { summaryLine } from "@scf-core/mediaReferences.ts";
import type { MediaPayload } from "./runners.ts";
import type { ResolvedDescription }
  from "@scf-core/resolution.ts";
import { exec, registry, rowName, useStore } from "../../state/store.ts";
import { useQuery } from "../useQuery.ts";
import {
  INTENT_OPTIONS, QUERIES, SUBJECT_TYPE_OPTIONS, WALKABLE_TARGETS,
  type ParamDef, type ParamValues, type Q03Payload, type Q12Payload,
  type QuerySpec,
} from "./runners.ts";
import type {
  Q00Payload, Q01Payload, Q02Payload, Q04Payload, Q09Payload,
  Q10Payload, Q11Payload, Q15Payload,
} from "./runnersComposed.ts";
import {
  BriefView, DossierView, ContextStackView, PackageView, ManifestView,
  AccountingView, AudienceView, ProvenanceView,
} from "./composedViews.tsx";
import {
  SCENE_ORDER_BY, SCENE_ORDER_JOIN,
} from "@scf-core/structure.ts";

/** Rail: the sixteen canonical queries; supported ones run, the rest are
 * listed as planned so the page states its own scope honestly. */
export function QueryIndex(): JSX.Element {
  const { selectedQuery, selectQuery } = useStore();
  return (
    <div className="query-index">
      {QUERIES.map((spec) => (
        <button key={spec.id}
                className={"query-item" +
                  (selectedQuery === spec.id ? " active" : "")}
                onClick={() => selectQuery(spec.id)}>
          <span className="query-id">{spec.id}</span>
          <span>{spec.name}</span>
        </button>
      ))}
    </div>
  );
}

export function QueryRunner(): JSX.Element {
  const selectedQuery = useStore((s) => s.selectedQuery);
  const spec = QUERIES.find((x) => x.id === selectedQuery);
  if (spec === undefined) {
    return (
      <div className="empty-main">
        <p>Pick a canonical query. Each answer comes in three forms:
           a designed view, the raw JSON (the future MCP payload), and a
           prompt-ready context block.</p>
      </div>
    );
  }
  // key = query id: switching queries REMOUNTS the body, so params,
  // payload, and error can never leak across queries. (The original
  // effect-based reset ran one render too late — Q01's markdown builder
  // received Q00's payload for a frame and crashed on the shape
  // mismatch. Remounting removes the stale frame entirely.)
  return <QueryBody key={spec.id} spec={spec} />;
}

function QueryBody({ spec }: { spec: QuerySpec }): JSX.Element {
  const revision = useStore((s) => s.revision);
  const [values, setValues] = useState<ParamValues>({});
  const [payload, setPayload] = useState<unknown>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"human" | "json" | "context">("human");
  const [copied, setCopied] = useState(false);

  const ready = spec !== undefined &&
    spec.params.every((p) => p.optional === true ||
      (values[p.key] !== undefined && values[p.key] !== null &&
       values[p.key] !== ""));

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    spec.run({ exec, registry }, values).then((p) => {
      if (!cancelled) {
        setPayload(p);
        setError(null);
      }
    }).catch((e: unknown) => {
      if (!cancelled) {
        setError(e instanceof Error ? e.message : String(e));
        setPayload(null);
      }
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(values), ready, revision]);

  const markdown = payload !== null
    ? spec.toMarkdown(payload, values) : "";

  return (
    <div className="query-runner">
      <header className="list-header">
        <span className="query-id big">{spec.id}</span>
        <h2>{spec.name}</h2>
      </header>
      <p className="entity-description">{spec.description}</p>
      <ParamsBar spec={spec} values={values} onChange={setValues} />
      {error !== null && <p className="start-error">{error}</p>}
      {payload !== null && (
        <>
          <div className="form-tabs" role="tablist">
            {(["human", "json", "context"] as const).map((m) => (
              <button key={m} role="tab" aria-selected={mode === m}
                      className={mode === m ? "active" : ""}
                      onClick={() => setMode(m)}>
                {m === "human" ? "View" : m === "json" ? "JSON"
                  : "Copy as context"}
              </button>
            ))}
          </div>
          {mode === "human" && <HumanView spec={spec} payload={payload} />}
          {mode === "json" && (
            <pre className="json-out">
              {JSON.stringify(payload, null, 2)}
            </pre>
          )}
          {mode === "context" && (
            <div className="context-out">
              <button className="primary"
                      onClick={() => {
                        void navigator.clipboard.writeText(markdown);
                        setCopied(true);
                        window.setTimeout(() => setCopied(false), 1500);
                      }}>
                {copied ? "Copied" : "Copy to clipboard"}
              </button>
              <pre>{markdown}</pre>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Params
// ---------------------------------------------------------------------------

function ParamsBar({ spec, values, onChange }: {
  spec: QuerySpec; values: ParamValues;
  onChange: (v: ParamValues) => void;
}): JSX.Element {
  return (
    <div className="params-bar">
      {spec.params.map((p) => (
        <ParamPicker key={p.key} def={p} value={values[p.key] ?? null}
                     values={values}
                     onChange={(v) =>
                       onChange({ ...values, [p.key]: v })} />
      ))}
    </div>
  );
}

function ParamPicker({ def, value, values, onChange }: {
  def: ParamDef; value: SqlValue; values: ParamValues;
  onChange: (v: SqlValue) => void;
}): JSX.Element {
  const table = def.kind === "character" ? "character"
    : def.kind === "scene" || def.kind === "sceneB" ? "scene"
    : def.kind === "shot" ? "shot"
    : def.kind === "theme" ? "theme"
    : def.kind === "subjectId" ? String(values["subject"] ?? "character")
    : def.kind === "entityRow"
      ? (registry.entities.has(String(values["entity_type"] ?? ""))
          ? String(values["entity_type"]) : null)
    : null;
  const edef = table !== null ? registry.entities.get(table) : undefined;
  const isScene = table === "scene";
  // A shot belongs to a scene, so once a scene is chosen the shot list
  // is the coverage of that scene. Offering every shot in the film here
  // invites a pairing the query cannot answer — a shot from sc 3 asked
  // about in sc 12.
  const isShot = def.kind === "shot";
  const sceneFilter = isShot ? values["scene_id"] ?? null : null;
  const rows = useQuery(
    edef === undefined ? null :
    isScene
      ? `SELECT s.* FROM scene s ${SCENE_ORDER_JOIN} ${SCENE_ORDER_BY}`
    : isShot
      ? (sceneFilter === null
          ? "SELECT * FROM shot ORDER BY scene_id, shot_order, id LIMIT 500"
          : "SELECT * FROM shot WHERE scene_id = ? " +
            "ORDER BY shot_order, id")
      : `SELECT * FROM ${q(edef.name)} ` +
        `ORDER BY ${q(edef.nameField)} LIMIT 500`,
    sceneFilter === null ? [] : [sceneFilter]);

  // Changing the scene can strand a shot from the previous one.
  useEffect(() => {
    if (!isShot || value === null || sceneFilter === null) return;
    if (rows.length === 0) return;
    if (!rows.some((r) => Number(r["id"]) === Number(value))) onChange(null);
  }, [isShot, value, sceneFilter, rows]);

  const options = useMemo(() => {
    if (def.kind === "intent") return [...INTENT_OPTIONS];
    if (def.kind === "subjectType") return [...SUBJECT_TYPE_OPTIONS];
    if (def.kind === "target") return [...WALKABLE_TARGETS];
    if (def.kind === "entityType") return [...registry.order];
    return null;
  }, [def.kind]);

  return (
    <label className="param">
      <span>
        {def.label}{def.optional === true ? "" : " *"}
        {def.kind === "shot" && values["scene_id"] !== null &&
         values["scene_id"] !== undefined && (
          <span className="param-scope"> in scene</span>
        )}
      </span>
      {options !== null ? (
        <select value={String(value ?? "")}
                onChange={(e) =>
                  onChange(e.target.value === "" ? null : e.target.value)}>
          <option value="">—</option>
          {options.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      ) : (
        <select value={value === null ? "" : String(value)}
                onChange={(e) =>
                  onChange(e.target.value === ""
                    ? null : Number(e.target.value))}>
          <option value="">—</option>
          {rows.map((r) => (
            <option key={String(r["id"])} value={String(r["id"])}>
              {rowName(table ?? "", r)}
            </option>
          ))}
        </select>
      )}
    </label>
  );
}

// ---------------------------------------------------------------------------
// Human views
// ---------------------------------------------------------------------------

function HumanView({ spec, payload }: {
  spec: QuerySpec; payload: unknown;
}): JSX.Element {
  switch (spec.id) {
    case "Q00": return <BriefView p={payload as Q00Payload} />;
    case "Q01": return <DossierView p={payload as Q01Payload} />;
    case "Q02": return <ContextStackView p={payload as Q02Payload} />;
    case "Q04": return <PackageView p={payload as Q04Payload} />;
    case "Q09": return <ManifestView p={payload as Q09Payload} />;
    case "Q10": return <AccountingView p={payload as Q10Payload} />;
    case "Q11": return <AudienceView p={payload as Q11Payload} />;
    case "Q15": return <ProvenanceView p={payload as Q15Payload} />;
    case "Q03": return <Q03View p={payload as Q03Payload} />;
    case "Q05":
    case "Q06": return <DescriptionView p={payload as ResolvedDescription} />;
    case "Q07":
    case "Q08": return <CascadeView p={payload as {
      leaf: string; layers: Array<[string, Row]>; }} />;
    case "Q12": return <Q12View p={payload as Q12Payload} />;
    case "Q13": return <MediaView p={payload as MediaPayload} />;
    case "Q14": return <ReadinessView p={payload as ReadinessReport} />;
    default: return <pre>{JSON.stringify(payload, null, 2)}</pre>;
  }
}

export function AuthoredFields({ row, skipRefs = true }: {
  row: Row; skipRefs?: boolean;
}): JSX.Element {
  const skip = new Set(["id", "uuid", "created_at", "updated_at",
                        "lifecycle_status", "name", "external_id",
                        "external_id_namespace", "parent_id",
                        "version_label", "superseded_at",
                        "superseded_by_id"]);
  const entries = Object.entries(row).filter(([k, v]) =>
    !skip.has(k) && v !== null && v !== "" &&
    (!skipRefs || !k.endsWith("_id")));
  return (
    <dl className="kv-out">
      {entries.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd><FieldValue value={v} /></dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * Values are text as authored, with one concession: a field whose text
 * is a JSON object or array (emotional_manifestations, verbal_tics)
 * reads as one unbroken serialized line. Arrays collapse to a comma
 * list; objects become nested key/value lines. Anything that does not
 * parse is left exactly as stored.
 */
function FieldValue({ value }: { value: SqlValue }): JSX.Element {
  const text = String(value);
  const parsed = parseJsonish(text);
  if (Array.isArray(parsed)) {
    return <>{parsed.map((x) => scalarText(x)).join(", ")}</>;
  }
  if (parsed !== null) {
    return (
      <ul className="kv-json">
        {Object.entries(parsed).map(([k, v]) => (
          <li key={k}>
            <span className="kv-json-key">{k}</span>
            <span className="kv-json-val">{scalarText(v)}</span>
          </li>
        ))}
      </ul>
    );
  }
  return <>{text}</>;
}

function parseJsonish(text: string):
    Record<string, unknown> | unknown[] | null {
  const t = text.trim();
  if (!t.startsWith("{") && !t.startsWith("[")) return null;
  try {
    const value: unknown = JSON.parse(t);
    if (Array.isArray(value)) return value;
    if (typeof value === "object" && value !== null) {
      return value as Record<string, unknown>;
    }
    return null;
  } catch {
    return null; // authored text that merely starts with a brace
  }
}

/** One nesting level deeper is flattened; beyond that, JSON is honest. */
function scalarText(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (Array.isArray(value)) return value.map((x) => scalarText(x)).join(", ");
  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .map(([k, v]) => `${k}: ${scalarText(v)}`).join(" · ");
  }
  return String(value);
}

function Q03View({ p }: { p: Q03Payload }): JSX.Element {
  return (
    <div className="qview">
      <h3>Characters present</h3>
      <table className="qtable">
        <thead>
          <tr><th>character</th><th>states in force</th><th>wearing</th></tr>
        </thead>
        <tbody>
          {p.characters.map((c) => (
            <tr key={String(c.character["id"])}>
              <td>{String(c.character["name"])}</td>
              <td>{c.states.map((s) => String(s["name"])).join(", ") ||
                   "baseline"}</td>
              <td>{c.costumes.map((x) => String(x["name"])).join(", ") ||
                   "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h3>Props present</h3>
      <table className="qtable">
        <thead><tr><th>prop</th><th>whereabouts</th></tr></thead>
        <tbody>
          {p.props.map((x) => (
            <tr key={String(x.prop["id"])}>
              <td>{String(x.prop["name"])}</td>
              <td>{String(x.state?.["whereabouts"] ??
                    "state not yet established")}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {p.motifs.length > 0 && (
        <>
          <h3>Motifs appearing</h3>
          <ul className="qlist">
            {p.motifs.map((m) => (
              <li key={String(m["id"])}>
                {String(m["name"])}
                {m["domain"] !== null && (
                  <span className="scope-tag">{String(m["domain"])}</span>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function DescriptionView({ p }: { p: ResolvedDescription }): JSX.Element {
  return (
    <div className="qview">
      <h3>Baseline</h3>
      {p.profile !== null
        ? <AuthoredFields row={p.profile} />
        : <p className="muted">No baseline profile — a Q14 blocker.</p>}
      <h3>States in force</h3>
      {p.states.length > 0 ? (
        <ul className="qlist">
          {p.states.map((s) => (
            <li key={String(s["id"])}>
              {String(s["name"])}
              <span className="scope-tag">
                {String(s["persistence"] ?? "scene_only")}
              </span>
            </li>
          ))}
        </ul>
      ) : <p className="muted">None — baseline holds (by design).</p>}
      {Object.keys(p.modulations).length > 0 && (
        <>
          <h3>Merged modulations (newest wins per key)</h3>
          <dl className="kv-out">
            {Object.entries(p.modulations).map(([k, v]) => (
              <div key={k}><dt>{k}</dt><dd>{String(v)}</dd></div>
            ))}
          </dl>
        </>
      )}
      <h3>Beats</h3>
      {p.beats.length > 0 ? (
        <ul className="qlist">
          {p.beats.map((b) => (
            <li key={String(b["id"])}>
              <AuthoredFields row={b} />
            </li>
          ))}
        </ul>
      ) : <p className="muted">No beats — renders on baseline+state
           alone.</p>}
    </div>
  );
}

function CascadeView({ p }: {
  p: { leaf: string; layers: Array<[string, Row]> };
}): JSX.Element {
  return (
    <div className="qview">
      <ol className="cascade">
        {p.layers.map(([entity, row], i) => (
          <li key={entity}
              className={i === p.layers.length - 1 ? "in-force" : ""}>
            <div className="cascade-head">
              <span className="cascade-entity">
                {registry.entities.get(entity)?.label ?? entity}
              </span>
              <span className="cascade-name">
                {String(row["name"] ?? `#${String(row["id"])}`)}
              </span>
              {i === p.layers.length - 1 && (
                <span className="in-force-tag">in force</span>
              )}
            </div>
            <AuthoredFields row={row} />
          </li>
        ))}
      </ol>
      {p.layers.length === 0 && (
        <p className="muted">Nothing on this cascade yet.</p>
      )}
    </div>
  );
}

function Q12View({ p }: { p: Q12Payload }): JSX.Element {
  const cell = (a: string | null, b: string | null): JSX.Element =>
    a === b
      ? <td className="muted">{a ?? "—"}</td>
      : <td><s className="muted">{a ?? "—"}</s> → <b>{b ?? "—"}</b></td>;
  return (
    <div className="qview">
      <h3>Character states</h3>
      <table className="qtable">
        <thead><tr><th>character</th><th>change</th></tr></thead>
        <tbody>
          {p.characters.map((c) => (
            <tr key={String(c.character["id"])}>
              <td>{String(c.character["name"])}</td>
              {cell(c.statesA.join(", ") || "baseline",
                    c.statesB.join(", ") || "baseline")}
            </tr>
          ))}
        </tbody>
      </table>
      <h3>Relationships</h3>
      <table className="qtable">
        <thead><tr><th>relationship</th><th>stage</th></tr></thead>
        <tbody>
          {p.relationships.map((r) => (
            <tr key={String(r.relationship["id"])}>
              <td>{String(r.relationship["name"] ?? "relationship")}</td>
              {cell(r.stageA, r.stageB)}
            </tr>
          ))}
        </tbody>
      </table>
      <h3>Props</h3>
      <table className="qtable">
        <thead><tr><th>prop</th><th>whereabouts</th></tr></thead>
        <tbody>
          {p.props.map((x) => (
            <tr key={String(x.prop["id"])}>
              <td>{String(x.prop["name"])}</td>
              {cell(x.whereA, x.whereB)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MediaView({ p }: { p: MediaPayload }): JSX.Element {
  return (
    <div className="qview">
      <h3>References</h3>
      <p className="muted">{summaryLine(p.summary, p.has_root)}</p>
      <ul className="qref-list">
        {p.references.map((r) => (
          <li key={r.id}>
            <span>{r.name ?? `#${r.id}`}</span>
            <span className="mono muted">
              {r.identifier ?? "no identifier"}
            </span>
            <span className="muted">{r.provenance}</span>
            {r.state !== "resolved" && (
              <span className="qref-bad" title={r.detail ?? ""}>
                {r.state}
              </span>
            )}
          </li>
        ))}
      </ul>
      <h3>Resolution trail</h3>
      <ol className="trail">
        {p.trail.map((t, i) => <li key={i}>{t}</li>)}
        {p.trail.length === 0 && (
          <p className="muted">Nothing resolves — no binding for this
             intent.</p>
        )}
      </ol>
      <h3>Assets, most specific first</h3>
      <ul className="qlist">
        {p.assets_most_specific_first.map((a) => (
          <li key={String(a["id"])}>
            {String(a["name"])}
            {p.override_assets.some((o) => o["id"] === a["id"]) && (
              <span className="in-force-tag">override</span>
            )}
            {a["role_in_bundle"] !== null &&
             a["role_in_bundle"] !== undefined && (
              <span className="scope-tag">
                {String(a["role_in_bundle"])}
              </span>
            )}
          </li>
        ))}
      </ul>
      <h3>Anchors</h3>
      <ul className="qlist">
        {p.anchors.map((a) => (
          <li key={String(a["id"])}>
            {String(a["name"] ?? `#${String(a["id"])}`)}
            <span className="scope-tag">
              {String(a["canonical_status"] ?? "unverified")}
            </span>
          </li>
        ))}
        {p.anchors.length === 0 && (
          <li className="muted">No anchors — identity is unpinned.</li>
        )}
      </ul>
    </div>
  );
}

function ReadinessView({ p }: { p: ReadinessReport }): JSX.Element {
  return (
    <div className="qview">
      <p className="muted">{p.meta.description}</p>
      <ul className="findings standalone">
        {p.findings.map((f, i) => (
          <li key={i} className={`finding sev-${f.severity}`}>
            <span className={`sev-dot sev-${f.severity}`} />
            <span className="finding-entity">{f.entity}</span>
            <span className="finding-message">{f.message}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
