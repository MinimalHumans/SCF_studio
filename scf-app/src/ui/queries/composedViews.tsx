import type { Row } from "@scf-core/db.ts";
import { registry, useStore } from "../../state/store.ts";
import { AuthoredFields } from "./QueryRunner.tsx";
import {
  MOTIF_DENSITY_THRESHOLD, type ContextLayer, type Q00Payload,
  type Q01Payload, type Q02Payload, type Q04Payload, type Q09Payload,
  type Q10Payload, type Q11Payload, type Q15Payload,
} from "./runnersComposed.ts";

const name = (r: Row | null | undefined, fallback = "—"): string =>
  r === null || r === undefined ? fallback
    : String(r["name"] ?? `#${String(r["id"])}`);

function EntityHeading({ entity }: { entity: string }): JSX.Element {
  const edef = registry.entities.get(entity);
  return (
    <h3>
      {edef?.icon} {edef?.label ?? entity}
    </h3>
  );
}

// ---------------------------------------------------------------------------

export function BriefView({ p }: { p: Q00Payload }): JSX.Element {
  return (
    <div className="qview brief">
      {p.layers.map((l) => (
        <section key={l.entity} className="brief-layer">
          <EntityHeading entity={l.entity} />
          {l.row !== null
            ? <AuthoredFields row={l.row} />
            : <p className="muted">not yet authored</p>}
        </section>
      ))}
      <section className="brief-layer">
        <h3>Themes</h3>
        <ul className="qlist">
          {p.themes.map((t) => (
            <li key={String(t["id"])}>
              <b>{String(t["name"])}</b>
              {t["description"] !== null && t["description"] !== "" && (
                <span className="muted"> — {String(t["description"])}</span>
              )}
            </li>
          ))}
          {p.themes.length === 0 && (
            <li className="muted">no themes declared</li>
          )}
        </ul>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------

export function DossierView({ p }: { p: Q01Payload }): JSX.Element {
  const { openEntityRow } = useStore();
  return (
    <div className="qview">
      {p.groups.map((g) => (
        <section key={g.entity}>
          <EntityHeading entity={g.entity} />
          <ul className="qlist">
            {g.rows.map((r) => (
              <li key={String(r["id"])} className="dossier-row">
                <button className="row-link"
                        onClick={() =>
                          void openEntityRow(g.entity,
                                             r["id"] as number)}>
                  {name(r)}
                </button>
                <AuthoredFields row={r} />
              </li>
            ))}
          </ul>
        </section>
      ))}
      {p.groups.length === 0 && (
        <p className="muted">No global-scope depth entities authored for
           this subject yet.</p>
      )}
      {p.motifCarriage.length > 0 && (
        <section>
          <h3>Motif carriage</h3>
          <ul className="qlist">
            {p.motifCarriage.map((m) => (
              <li key={String(m.appearance["id"])}>
                {name(m.motif, "motif")}
                {m.appearance["domain"] !== null &&
                 m.appearance["domain"] !== undefined && (
                  <span className="scope-tag">
                    {String(m.appearance["domain"])}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
      {p.thematicConnections.length > 0 && (
        <section>
          <h3>Thematic connections</h3>
          <ul className="qlist">
            {p.thematicConnections.map((t) => (
              <li key={String(t["id"])}>
                {String(t["nature_of_connection"] ?? "connected")}
                <span className="scope-tag">
                  subtlety: {String(t["subtlety_level"] ?? "—")}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

export function ContextStackView({ p }: { p: Q02Payload }): JSX.Element {
  return (
    <div className="qview">
      <p className="muted">
        Resolve down, most specific wins, everything above is context.
      </p>
      <ol className="cascade">
        {p.stack.map((layer, i) => (
          <li key={i} className={i === p.stack.length - 1 ? "in-force" : ""}>
            <div className="cascade-head">
              <span className="cascade-entity">{layer.scope}</span>
              <span className="cascade-name">{layer.label}</span>
              {i === p.stack.length - 1 && (
                <span className="in-force-tag">most specific</span>
              )}
            </div>
            <LayerBody layer={layer} />
          </li>
        ))}
      </ol>
    </div>
  );
}

function LayerBody({ layer }: { layer: ContextLayer }): JSX.Element {
  if (layer.kind === "dossier") {
    return (
      <ul className="qlist">
        {(layer.groups ?? []).map((g) => (
          <li key={g.entity}>
            <span className="cascade-entity">{g.entity}</span>{" "}
            {g.rows.map((r) => name(r)).join(", ")}
          </li>
        ))}
        {(layer.groups ?? []).length === 0 && (
          <li className="muted">nothing authored</li>
        )}
      </ul>
    );
  }
  if (layer.kind === "media") {
    const assets = layer.media?.assets_most_specific_first ?? [];
    return (
      <ul className="qlist">
        {assets.map((a) => (
          <li key={String(a["id"])}>{String(a["name"])}</li>
        ))}
        {assets.length === 0 && (
          <li className="muted">nothing resolves</li>
        )}
      </ul>
    );
  }
  const rows_ = layer.rows ?? [];
  return rows_.length > 0 ? (
    <ul className="qlist">
      {rows_.map((r) => (
        <li key={String(r["id"])} className="dossier-row">
          <b>{name(r)}</b>
          <AuthoredFields row={r} />
        </li>
      ))}
    </ul>
  ) : <p className="muted">none — well-defined absence</p>;
}

// ---------------------------------------------------------------------------

export function PackageView({ p }: { p: Q04Payload }): JSX.Element {
  const { openEntityRow } = useStore();
  return (
    <div className="qview">
      {p.lineage.length > 0 && (
        <p className="lineage">
          {p.lineage.map((l) => `${l.entity}: ${name(l.row)}`)
            .join("  ›  ")}
          {"  ›  "}
          <b>{name(p.scene)}</b>
        </p>
      )}
      <h3>Story beats</h3>
      <ol className="qlist">
        {p.storyBeats.map((b) => (
          <li key={String(b["id"])}>
            <b>{name(b)}</b>
            <span className="scope-tag">
              {String(b["beat_type"] ?? "beat")}
            </span>
            {b["value_shift"] !== null && b["value_shift"] !== "" && (
              <span className="muted">{String(b["value_shift"])}</span>
            )}
          </li>
        ))}
        {p.storyBeats.length === 0 && (
          <li className="muted">no beats authored</li>
        )}
      </ol>
      <h3>Cast & props</h3>
      <ul className="qlist">
        {p.cast.map((c) => (
          <li key={`c${String(c["id"])}`}>
            <button className="row-link" onClick={() =>
              void openEntityRow("character", c["id"] as number)}>
              {name(c)}
            </button>
          </li>
        ))}
        {p.props.map((x) => (
          <li key={`p${String(x["id"])}`}>
            <button className="row-link" onClick={() =>
              void openEntityRow("prop", x["id"] as number)}>
              {name(x)}
            </button>
            <span className="scope-tag">prop</span>
          </li>
        ))}
      </ul>
      <h3>Location</h3>
      {p.location !== null ? (
        <p>
          {name(p.location)}
          {p.variant !== null && (
            <>
              {" — variant in force: "}<b>{name(p.variant)}</b>
            </>
          )}
          {p.variantMismatches.map((m) => (
            <span key={m} className="invalid-note"> {m}</span>
          ))}
        </p>
      ) : <p className="muted">no location set</p>}
      {p.detail.map((d) => (
        <section key={d.entity}>
          <EntityHeading entity={d.entity} />
          {d.rows.map((r) => (
            <div key={String(r["id"])} className="dossier-row">
              <b>{name(r)}</b>
              <AuthoredFields row={r} />
            </div>
          ))}
        </section>
      ))}
      <h3>Staging</h3>
      {p.blocking.length > 0 ? (
        <ul className="qlist">
          {p.blocking.map((b) => <li key={String(b["id"])}>{name(b)}</li>)}
          {p.stagingBeats.map((b) => (
            <li key={`sb${String(b["id"])}`} className="muted">
              beat {String(b["beat_order"] ?? "")}:{" "}
              {String(b["name"] ?? b["description"] ?? "")}
            </li>
          ))}
        </ul>
      ) : <p className="muted">no blocking authored</p>}
      <p className="muted planned-note">
        Screenplay text joins this package when Part 3 lands.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------

export function ManifestView({ p }: { p: Q09Payload }): JSX.Element {
  return (
    <div className="qview">
      {p.dense && (
        <p className="density-warning">
          {p.manifest.length} motifs in one scene — above the density
          threshold ({MOTIF_DENSITY_THRESHOLD}, heuristic). Meaning
          competes.
        </p>
      )}
      <table className="qtable">
        <thead>
          <tr>
            <th>motif</th><th>domain</th><th>subtlety (as of here)</th>
            <th>notes</th>
          </tr>
        </thead>
        <tbody>
          {p.manifest.map((m) => (
            <tr key={String(m.appearance["id"])}>
              <td>{name(m.motif, "motif")}</td>
              <td>{String(m.appearance["domain"] ?? "—")}</td>
              <td>{String(m.state?.["subtlety_level"] ??
                    m.motif?.["subtlety_level"] ?? "—")}</td>
              <td className="muted">
                {String(m.appearance["manifestation_notes"] ?? "")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {p.manifest.length === 0 && (
        <p className="muted">No motifs placed here.</p>
      )}
      {p.candidates.length > 0 && (
        <>
          <h3>Cross-modality candidates</h3>
          <ul className="qlist">
            {p.candidates.map((c) => (
              <li key={String(c["id"])}>
                {name(c)}
                <span className="muted"> — related to a motif in frame,
                  not yet placed</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

export function AccountingView({ p }: { p: Q10Payload }): JSX.Element {
  const max = Math.max(1, ...p.spine.map((s) => s.count));
  return (
    <div className="qview">
      <h3>Distribution across the spine</h3>
      <div className="spine accounting-spine" role="img"
           aria-label="theme carriage per scene">
        {p.spine.map((s) => (
          <span key={String(s.scene["id"])}
                title={`sc ${String(s.scene["scene_number"] ?? "?")}: ` +
                       `${s.count} carrier(s)`}
                className={"spine-cell" + (s.count > 0 ? " keyed" : "")}
                style={{ opacity: s.count > 0
                  ? 0.45 + 0.55 * (s.count / max) : 1 }} />
        ))}
      </div>
      <h3>Carriers</h3>
      <table className="qtable">
        <thead>
          <tr><th>target</th><th>connection</th><th>scenes</th></tr>
        </thead>
        <tbody>
          {p.connections.map((c) => (
            <tr key={String(c.connection["id"])}>
              <td>{c.targetName}</td>
              <td>{String(
                c.connection["nature_of_connection"] ?? "connected")}</td>
              <td>{c.sceneIds.length}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {p.connections.length === 0 && (
        <p className="muted">This theme has no declared carriers —
           aspiration, not presence.</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

export function AudienceView({ p }: { p: Q11Payload }): JSX.Element {
  return (
    <div className="qview">
      <h3>Known / withheld</h3>
      {p.information !== null
        ? <AuthoredFields row={p.information} />
        : <p className="muted">No information strategy authored.</p>}
      <h3>Identification</h3>
      {p.identification !== null ? (
        <>
          <p>
            Primary: <b>{name(p.identification.primary)}</b>
            {p.identification.secondary !== null && (
              <> · Secondary: {name(p.identification.secondary)}</>
            )}
          </p>
          <AuthoredFields row={p.identification.row} />
        </>
      ) : <p className="muted">No identification strategy authored.</p>}
      {p.emotionalBeats.length > 0 && (
        <>
          <h3>Emotional beats</h3>
          <ul className="qlist">
            {p.emotionalBeats.map((e) => (
              <li key={String(e.beat["id"])}>
                <b>{String(e.beat["target_emotion"] ?? name(e.beat))}</b>
                {e.arc !== null && (
                  <span className="scope-tag">arc: {name(e.arc)}</span>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
      {p.toneMarkers.length > 0 && (
        <>
          <h3>Tone</h3>
          {p.toneMarkers.map((t) => (
            <div key={String(t["id"])} className="dossier-row">
              <b>{String(t["tone_descriptor"] ?? name(t))}</b>
              <AuthoredFields row={t} />
            </div>
          ))}
        </>
      )}
      <h3>Emotional direction cascade</h3>
      <ol className="cascade">
        {p.emotionalCascade.map(([entity, row], i) => (
          <li key={entity}
              className={i === p.emotionalCascade.length - 1
                ? "in-force" : ""}>
            <div className="cascade-head">
              <span className="cascade-entity">
                {registry.entities.get(entity)?.label ?? entity}
              </span>
              <span className="cascade-name">{name(row)}</span>
              {i === p.emotionalCascade.length - 1 && (
                <span className="in-force-tag">in force</span>
              )}
            </div>
            <AuthoredFields row={row} />
          </li>
        ))}
      </ol>
    </div>
  );
}

// ---------------------------------------------------------------------------

export function ProvenanceView({ p }: { p: Q15Payload }): JSX.Element {
  const card = (r: Row): JSX.Element => (
    <div key={String(r["id"])} className="provenance-card">
      <b>{name(r)}</b>
      <AuthoredFields row={r} />
    </div>
  );
  return (
    <div className="qview">
      <h3>Lifecycle</h3>
      {p.row !== null && (
        <dl className="kv-out">
          <div><dt>lifecycle_status</dt>
            <dd>{String(p.row["lifecycle_status"] ?? "—")}</dd></div>
          <div><dt>created</dt>
            <dd>{String(p.row["created_at"] ?? "—")}</dd></div>
          <div><dt>updated</dt>
            <dd>{String(p.row["updated_at"] ?? "—")}</dd></div>
          <div><dt>uuid</dt>
            <dd className="mono">{String(p.row["uuid"] ?? "—")}</dd></div>
        </dl>
      )}
      {p.versionChain.length > 1 && (
        <>
          <h3>Version chain</h3>
          <ol className="trail">
            {p.versionChain.map((v) => (
              <li key={String(v["id"])}>
                {String(v["version_label"] ?? `#${String(v["id"])}`)}
                {v["id"] === p.row?.["id"] && (
                  <span className="in-force-tag">this row</span>
                )}
              </li>
            ))}
          </ol>
        </>
      )}
      <h3>Attached decisions</h3>
      {p.attached.decisions.map(card)}
      {p.attached.decisions.length === 0 && (
        <p className="muted">None attached to this row.</p>
      )}
      <h3>Attached notes</h3>
      {p.attached.notes.map(card)}
      {p.attached.notes.length === 0 && (
        <p className="muted">None attached to this row.</p>
      )}
      {(p.unattached.decisions.length > 0 ||
        p.unattached.notes.length > 0) && (
        <>
          <h3>Unattached (no affected_entities recorded)</h3>
          {p.unattached.decisions.map(card)}
          {p.unattached.notes.map(card)}
        </>
      )}
    </div>
  );
}
