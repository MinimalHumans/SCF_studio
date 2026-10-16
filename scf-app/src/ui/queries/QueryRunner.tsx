// SPDX-License-Identifier: Apache-2.0
import { useEffect, useMemo, useState } from "react";
import type { SqlValue } from "@scf-core/db.ts";
import { q } from "@scf-core/db.ts";
import type { ProjectedRow, QueryResult } from "@scf-core/queryResult.ts";
import type {
  Q00Result, Q01Result, Q02Result, Q03Result, Q04Result, Q05Result,
  Q07Result, Q09Result, Q10Result, Q11Result, Q12Result, Q13Result,
  Q14Result, Q15Result,
} from "@scf-core/canonicalQueries.ts";
import { exec, registry, rowName, useStore } from "../../state/store.ts";
import { useQuery } from "../useQuery.ts";
import {
  INTENT_OPTIONS, QUERIES, SUBJECT_TYPE_OPTIONS, WALKABLE_TARGETS,
  uuidKey, type ParamDef, type ParamValues, type QuerySpec,
} from "./runners.ts";
import { authoredEntries, field, nameOf } from "./fields.ts";
import { trailLine } from "@scf-core/resolution.ts";
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
           a designed view, the normative JSON result (what scf-mcp
           serves), and a prompt-ready context block.</p>
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
  // Q13 reports what resolves, which depends on the session's root and
  // not on any row in the file. Without this a query run before a
  // folder was attached keeps its `rootMapped: false` answer on screen.
  const environmentRevision = useStore((s) => s.environmentRevision);
  const [values, setValues] = useState<ParamValues>({});
  const [payload, setPayload] = useState<QueryResult<unknown> | null>(null);
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
  }, [JSON.stringify(values), ready, revision, environmentRevision]);

  const markdown = payload !== null
    ? spec.toMarkdown(payload, registry) : "";

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
          {mode === "human" &&
            <HumanView spec={spec} result={payload.result} />}
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
                     onChange={(v, uuid) =>
                       onChange({ ...values, [p.key]: v,
                                  [uuidKey(p.key)]: uuid })} />
      ))}
    </div>
  );
}

function ParamPicker({ def, value, values, onChange }: {
  def: ParamDef; value: SqlValue; values: ParamValues;
  /** A row pick passes its uuid too; the result's envelope needs it. */
  onChange: (v: SqlValue, uuid: string | null) => void;
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
    if (!rows.some((r) => Number(r["id"]) === Number(value))) {
      onChange(null, null);
    }
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
                  onChange(e.target.value === "" ? null : e.target.value,
                           null)}>
          <option value="">—</option>
          {options.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      ) : (
        <select value={value === null ? "" : String(value)}
                onChange={(e) => {
                  if (e.target.value === "") {
                    onChange(null, null);
                    return;
                  }
                  const id = Number(e.target.value);
                  const row = rows.find((r) => Number(r["id"]) === id);
                  const uuid = row?.["uuid"];
                  onChange(id, typeof uuid === "string" ? uuid : null);
                }}>
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
// Human views — each renders the result body of its query (§12)
// ---------------------------------------------------------------------------

function HumanView({ spec, result }: {
  spec: QuerySpec; result: unknown;
}): JSX.Element {
  switch (spec.id) {
    case "Q00": return <BriefView p={result as Q00Result} />;
    case "Q01": return <DossierView p={result as Q01Result} />;
    case "Q02": return <ContextStackView p={result as Q02Result} />;
    case "Q03": return <Q03View p={result as Q03Result} />;
    case "Q04": return <PackageView p={result as Q04Result} />;
    case "Q05": return <DescriptionView p={result as Q05Result}
                                        profileEntity="vocal_profile" />;
    case "Q06": return <DescriptionView p={result as Q05Result}
                          profileEntity="physical_character_profile" />;
    case "Q07":
    case "Q08": return <CascadeView p={result as Q07Result} />;
    case "Q09": return <ManifestView p={result as Q09Result} />;
    case "Q10": return <AccountingView p={result as Q10Result} />;
    case "Q11": return <AudienceView p={result as Q11Result} />;
    case "Q12": return <Q12View p={result as Q12Result} />;
    case "Q13": return <MediaView p={result as Q13Result} />;
    case "Q14": return <ReadinessView p={result as Q14Result} />;
    case "Q15": return <ProvenanceView p={result as Q15Result} />;
    default: return <pre>{JSON.stringify(result, null, 2)}</pre>;
  }
}

/** A projected row's authored fields, in the registry's column order. */
export function AuthoredFields({ entity, row, includeName = false }: {
  entity: string | null; row: ProjectedRow; includeName?: boolean;
}): JSX.Element {
  return (
    <dl className="kv-out">
      {authoredEntries(registry, entity, row, includeName).map(([k, v]) => (
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
 * parse is left exactly as stored. A `string_list` arrives already an
 * array (§2.5).
 */
function FieldValue({ value }: { value: unknown }): JSX.Element {
  const parsed = Array.isArray(value) ? value : parseJsonish(String(value));
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
  return <>{String(value)}</>;
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

/** Seen is the plain case; heard or mentioned, or a version, is noted. */
function presenceText(presence: string | null,
                      variant: ProjectedRow | null): string {
  const bits = [
    ...(presence !== null && presence !== "seen" ? [presence] : []),
    ...(variant !== null ? [`as ${nameOf(variant)}`] : []),
  ];
  return bits.length > 0 ? ` (${bits.join(", ")})` : "";
}

function Q03View({ p }: { p: Q03Result }): JSX.Element {
  return (
    <div className="qview">
      <h3>Characters present</h3>
      <table className="qtable">
        <thead>
          <tr><th>character</th><th>states in force</th><th>wearing</th></tr>
        </thead>
        <tbody>
          {p.characters.map((c, i) => (
            <tr key={c.character.uuid ?? i}>
              <td>{nameOf(c.character)}
                <span className="muted">
                  {presenceText(c.presence, c.variant)}
                </span>
              </td>
              <td>{c.states.map((s) => nameOf(s)).join(", ") ||
                   "baseline"}</td>
              <td>{c.costumes.map((x) => nameOf(x)).join(", ") || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h3>Props present</h3>
      <table className="qtable">
        <thead><tr><th>prop</th><th>whereabouts</th></tr></thead>
        <tbody>
          {p.props.map((x, i) => (
            <tr key={x.prop.uuid ?? i}>
              <td>{nameOf(x.prop)}
                <span className="muted">
                  {presenceText(x.presence, x.variant)}
                </span>
              </td>
              <td>{field(x.state, "whereabouts") ??
                   "state not yet established"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {p.motifs.length > 0 && (
        <>
          <h3>Motifs appearing</h3>
          <ul className="qlist">
            {p.motifs.map((m, i) => (
              <li key={i}>
                {m.name}
                {m.domain !== null && (
                  <span className="scope-tag">{m.domain}</span>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function DescriptionView({ p, profileEntity }: {
  p: Q05Result; profileEntity: string;
}): JSX.Element {
  return (
    <div className="qview">
      <h3>Baseline</h3>
      {p.baseline !== null
        ? <AuthoredFields entity={profileEntity} row={p.baseline} />
        : <p className="muted">No baseline profile — a Q14 blocker.</p>}
      <h3>States in force</h3>
      {p.states.length > 0 ? (
        <ul className="qlist">
          {p.states.map((s, i) => (
            <li key={s.uuid ?? i}>
              {nameOf(s)}
              <span className="scope-tag">
                {field(s, "persistence") ?? "scene_only"}
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
          {p.beats.map((b, i) => (
            <li key={b.uuid ?? i}>
              <AuthoredFields entity="performance_beat" row={b}
                              includeName />
            </li>
          ))}
        </ul>
      ) : <p className="muted">No beats — renders on baseline+state
           alone.</p>}
    </div>
  );
}

function CascadeView({ p }: { p: Q07Result }): JSX.Element {
  return (
    <div className="qview">
      <ol className="cascade">
        {p.layers.map((l, i) => (
          <li key={l.entity}
              className={i === p.layers.length - 1 ? "in-force" : ""}>
            <div className="cascade-head">
              <span className="cascade-entity">
                {registry.entities.get(l.entity)?.label ?? l.entity}
              </span>
              <span className="cascade-name">
                {nameOf(l.row, "(unnamed)")}
              </span>
              {i === p.layers.length - 1 && (
                <span className="in-force-tag">in force</span>
              )}
            </div>
            <AuthoredFields entity={l.entity} row={l.row} />
          </li>
        ))}
      </ol>
      {p.layers.length === 0 && (
        <p className="muted">Nothing on this cascade yet.</p>
      )}
    </div>
  );
}

function Q12View({ p }: { p: Q12Result }): JSX.Element {
  const cell = (a: string | null, b: string | null): JSX.Element =>
    a === b
      ? <td className="muted">{a ?? "—"}</td>
      : <td><s className="muted">{a ?? "—"}</s> → <b>{b ?? "—"}</b></td>;
  const versioned = p.characters.some((c) =>
    c.variantFrom !== null || c.variantTo !== null) ||
    p.props.some((x) => x.variantFrom !== null || x.variantTo !== null);
  return (
    <div className="qview">
      <h3>Character states</h3>
      <table className="qtable">
        <thead>
          <tr><th>character</th><th>change</th>
            {versioned && <th>version</th>}</tr>
        </thead>
        <tbody>
          {p.characters.map((c, i) => (
            <tr key={c.character.uuid ?? i}>
              <td>{nameOf(c.character)}</td>
              {cell(c.statesFrom.join(", ") || "baseline",
                    c.statesTo.join(", ") || "baseline")}
              {versioned && cell(c.variantFrom, c.variantTo)}
            </tr>
          ))}
        </tbody>
      </table>
      <h3>Relationships</h3>
      <table className="qtable">
        <thead><tr><th>relationship</th><th>stage</th></tr></thead>
        <tbody>
          {p.relationships.map((r, i) => (
            <tr key={r.relationship.uuid ?? i}>
              <td>{nameOf(r.relationship, "relationship")}</td>
              {cell(r.stageFrom, r.stageTo)}
            </tr>
          ))}
        </tbody>
      </table>
      <h3>Props</h3>
      <table className="qtable">
        <thead>
          <tr><th>prop</th><th>whereabouts</th>
            {versioned && <th>version</th>}</tr>
        </thead>
        <tbody>
          {p.props.map((x, i) => (
            <tr key={x.prop.uuid ?? i}>
              <td>{nameOf(x.prop)}</td>
              {cell(x.whereFrom, x.whereTo)}
              {versioned && cell(x.variantFrom, x.variantTo)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The report line, from the result's counts (§8.3). */
function q13Summary(p: Q13Result): string {
  const n = (state: string): number => p.counts[state] ?? 0;
  if (p.references.length === 0) return "No assets referenced.";
  const parts = [`${p.references.length} referenced`,
                 `${n("resolved")} resolved`];
  if (n("missing") > 0) parts.push(`${n("missing")} missing`);
  if (n("unmaterialised") > 0) {
    parts.push(`${n("unmaterialised")} not downloaded`);
  }
  if (n("out-of-root") > 0) {
    parts.push(`${n("out-of-root")} outside the project`);
  }
  if (n("unaddressed") > 0) parts.push(`${n("unaddressed")} unresolvable`);
  const line = parts.join(" · ");
  return p.rootMapped ? line : `${line} — no project folder attached`;
}

function MediaView({ p }: { p: Q13Result }): JSX.Element {
  return (
    <div className="qview">
      <h3>References, most specific first</h3>
      <p className="muted">{q13Summary(p)}</p>
      <ul className="qref-list">
        {p.references.map((r, i) => (
          <li key={r.uuid ?? i}>
            <span>{r.name ?? r.anchorName ?? "asset"}</span>
            <span className="mono muted">
              {r.identifier ?? "no identifier"}
            </span>
            <span className="muted">
              {r.provenance === "anchor" && r.anchorName !== null
                ? `anchor: ${r.anchorName}` : r.provenance}
            </span>
            {r.role !== null && <span className="scope-tag">{r.role}</span>}
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
        {p.trail.map((t, i) => (
          <li key={t.uuid ?? i}
              className={t.excluded !== null ? "muted" : ""}>
            {trailLine({ layer: t.layer, name: t.name,
                         bundleName: t.bundle?.name ?? null,
                         reason: t.excluded?.reason ?? null })}
            {t.excluded !== null && (
              <span className="scope-tag">{t.excluded.by}</span>
            )}
          </li>
        ))}
        {p.trail.length === 0 && (
          <p className="muted">Nothing resolves — no binding for this
             intent.</p>
        )}
      </ol>
    </div>
  );
}

function ReadinessView({ p }: { p: Q14Result }): JSX.Element {
  return (
    <div className="qview">
      <p className="muted">Readiness for {p.target} — {p.targetName}</p>
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
