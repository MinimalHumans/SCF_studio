// SPDX-License-Identifier: Apache-2.0
import { q } from "@scf-core/db.ts";
import { PENDING_SOURCES, type RecordSource } from
  "../../state/characterLayout.ts";
import { registry, rowName, useStore, type CharacterTab } from
  "../../state/store.ts";
import { useQuery } from "../useQuery.ts";

const WHAT_IT_WILL_BE: Partial<Record<CharacterTab, string>> = {
  Look: "A reference board you drop images onto, the appearance " +
        "fields, color identity and per-scene exceptions.",
  Wardrobe: "Costume cards with their own references, wardrobe stages " +
            "on the story strip, and makeup and hair by scene.",
  Voice: "Voice references with a waveform to mark the clip, the vocal " +
         "profile, and how the voice shifts through the story.",
  Physicality: "Motion references, the physical profile, habits and " +
               "physical shifts.",
  Relationships: "A map of everyone this character is tied to, with " +
                 "each relationship's stages on the story strip.",
  Arc: "The arc summary and each arc as a lane across the scenes.",
  "Scenes & Lines": "Where they appear, every line they speak, and the " +
                    "shots they are in.",
};

export function PendingTab({ tab, characterId }: {
  tab: CharacterTab; characterId: number;
}): JSX.Element {
  const sources = (PENDING_SOURCES[tab] ?? [])
    .filter((s) => registry.entities.has(s.entity));
  return (
    <div className="ws-page">
      <div className="ws-pending">
        <p>
          <strong>{tab}</strong> is still the plain record view.{" "}
          {WHAT_IT_WILL_BE[tab]}
        </p>
        <p className="muted">
          Until then, everything it will cover is here and opens in the
          record editor.
        </p>
      </div>
      {sources.map((s) => (
        <SourceList key={s.entity + s.where} source={s}
                    characterId={characterId} />
      ))}
    </div>
  );
}

function SourceList({ source, characterId }: {
  source: RecordSource; characterId: number;
}): JSX.Element {
  const { openEntityRow, setDraftValue } = useStore();
  const edef = registry.entities.get(source.entity);
  const params = Array.from(
    { length: (source.where.match(/\?/g) ?? []).length },
    () => characterId);
  // Cut rows stay out of the friendly views, as they do everywhere
  // (§6.6.1); not every entity can be cut, so the clause is conditional.
  const cuttable = edef?.fields.some((f) => f.name === "lifecycle_status")
    === true;
  const list = useQuery(
    `SELECT * FROM ${q(source.entity)} WHERE (${source.where})` +
    (cuttable
      ? " AND (lifecycle_status IS NULL OR lifecycle_status <> 'cut')"
      : "") + " ORDER BY id",
    params);
  const label = source.label;

  return (
    <section className="ws-section">
      <h3>{label}</h3>
      {list.length === 0
        ? <p className="muted">None yet.</p>
        : (
          <ul className="ws-records">
            {list.map((r) => (
              <li key={String(r["id"])}>
                <button className="row-link"
                        onClick={() => void openEntityRow(
                          source.entity, Number(r["id"]))}>
                  {rowName(source.entity, r)}
                </button>
              </li>
            ))}
          </ul>
        )}
      <button className="ghost tiny"
              onClick={() => {
                void openEntityRow(source.entity, null).then(() => {
                  for (const [k, v] of Object.entries(
                    source.prefill(characterId))) setDraftValue(k, v);
                });
              }}>
        New {edef?.label.toLowerCase() ?? source.entity}
      </button>
    </section>
  );
}
