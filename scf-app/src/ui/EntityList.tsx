import { useMemo } from "react";
import { q } from "@scf-core/db.ts";
import { registry, rowName, useStore } from "../state/store.ts";
import {
  isComposedLink, linkLabel, linkQualifiers, referenceFields,
} from "../state/displayName.ts";
import { useQuery } from "./useQuery.ts";
import { useRefNames } from "./useRefNames.ts";
import {
  SCENE_ORDER_BY, SCENE_ORDER_JOIN,
} from "@scf-core/structure.ts";

export function EntityList({ entity }: { entity: string }): JSX.Element {
  const edef = registry.entities.get(entity);
  const { openEntityRow } = useStore();
  const nameField = edef?.nameField ?? "name";
  // Scenes list in story order — sorting headings alphabetically buries
  // the number that identifies them.
  const rows = useQuery(
    edef === undefined ? null :
    entity === "scene"
      ? `SELECT s.* FROM scene s ${SCENE_ORDER_JOIN} ${SCENE_ORDER_BY} ` +
        "LIMIT 500"
    : isComposedLink(edef)
      ? `SELECT * FROM ${q(entity)} ORDER BY id LIMIT 500`
      : `SELECT * FROM ${q(entity)} ORDER BY ${q(nameField)} LIMIT 500`);

  // With no anchor here, a link shows both of its ends.
  const composed = isComposedLink(edef);
  // ...and anything that sits IN a scene says which one. Twelve rows
  // called "Beat A" are indistinguishable without it.
  const scenePlaced = edef !== undefined && !composed &&
    edef.fields.some((f) => f.name === "scene_id");
  const targets = useMemo(() => edef === undefined ? []
    : composed
      ? referenceFields(edef).map((f) => f.referenceEntity as string)
      : scenePlaced ? ["scene"] : [],
    [edef, composed, scenePlaced]);
  const refNames = useRefNames(targets);

  if (edef === undefined) return <p className="muted">Unknown entity.</p>;

  return (
    <div className="entity-list">
      <header className="list-header">
        <span className="tree-icon">{edef.icon}</span>
        <h2>{edef.labelPlural}</h2>
        <span className="tree-count">{rows.length}</span>
        <button className="primary"
                onClick={() => void openEntityRow(entity, null)}>
          New {edef.label.toLowerCase()}
        </button>
      </header>
      {edef.description !== "" && (
        <p className="entity-description">{edef.description}</p>
      )}
      <ul className="rows">
        {rows.map((r) => (
          <li key={String(r["id"])}>
            {/* Left of the name, not floated right: it reads as part of
                the identity, which for a beat or a shot it is. */}
            {scenePlaced && (
              <span className="row-scene row-scene-lead">
                {refNames("scene", r["scene_id"]) ?? "—"}
              </span>
            )}
            <button className="row-link"
                    onClick={() =>
                      void openEntityRow(entity, r["id"] as number)}>
              {(composed ? linkLabel(edef, r, refNames) : null)
                ?? rowName(entity, r)}
            </button>
            {composed && linkQualifiers(edef, r).map((qual) => (
              <span key={qual} className="scope-tag">{qual}</span>
            ))}
            {r["lifecycle_status"] !== null &&
             r["lifecycle_status"] !== undefined &&
             r["lifecycle_status"] !== "active" && (
              <span className="lifecycle-tag">
                {String(r["lifecycle_status"])}
              </span>
            )}
          </li>
        ))}
        {rows.length === 0 && (
          <p className="muted">
            No {edef.labelPlural.toLowerCase()} yet — create the first one.
          </p>
        )}
      </ul>
    </div>
  );
}
