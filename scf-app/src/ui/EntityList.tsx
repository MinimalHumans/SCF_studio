import { useMemo } from "react";
import { q } from "@scf-core/db.ts";
import type { Row } from "@scf-core/db.ts";
import { registry, rowName, useStore } from "../state/store.ts";
import {
  isComposedLink, linkLabel, linkQualifiers, referenceFields,
} from "../state/displayName.ts";
import { useQuery } from "./useQuery.ts";
import { useRefNames } from "./useRefNames.ts";
import { storyOrder } from "@scf-core/structure.ts";
import {
  ORDER_FALLBACKS, STORY_ORDERED, sceneRefFor,
} from "../state/listOrder.ts";

/**
 * Which entities have a STORY order, and how to reach it.
 *
 * Alphabetical is the wrong default wherever a row has a place in the
 * film: acts sorted by name put Act 3 first if it happens to be called
 * "Aftermath", and the number that actually identifies it was not shown
 * at all. Story order comes from the script — the position of the
 * heading for the scene each row is anchored to — never from the stored
 * number, which is a label for that position rather than the position
 * itself.
 */


export function EntityList({ entity }: { entity: string }): JSX.Element {
  const edef = registry.entities.get(entity);
  const { openEntityRow, listSort, setListSort } = useStore();
  const nameField = edef?.nameField ?? "name";
  const composedEntity = edef !== undefined && isComposedLink(edef);
  const scenePlacedEntity = edef !== undefined && !composedEntity &&
    edef.fields.some((f) => f.name === "scene_id");
  // A link entity has a place in the film too — a costume in a scene, a
  // motif appearance — so it gets the same control. Six of the twelve
  // hold a scene reference; the rest (an actor's role, a bundle's
  // contents) have no position in the film and are simply A-Z.
  const sceneRef = edef === undefined ? undefined : sceneRefFor(edef);
  const orderSpec = STORY_ORDERED[entity] ??
    (sceneRef !== undefined && (scenePlacedEntity || composedEntity)
      ? { sceneRef,
          fallbacks: ORDER_FALLBACKS
            .filter((f) => edef!.fields.some((x) => x.name === f))
            .map((f) => `t.${f}`) }
      : undefined);
  const canSortByStory = orderSpec !== undefined;
  const byStory = canSortByStory && listSort === "story";

  // A sequence shows the act it starts in, so the join comes along.
  const extraSelect = entity === "sequence"
    ? ", (SELECT act_number FROM act WHERE act.id = t.act_id) " +
      "AS _act_number" : "";

  const rows = useQuery(
    edef === undefined ? null :
    byStory
      ? (() => {
          const order = storyOrder({
            alias: "t", sceneRef: orderSpec!.sceneRef,
            fallbacks: orderSpec!.fallbacks,
          });
          return `SELECT t.*${extraSelect} FROM ${q(entity)} t ` +
            `${order.join} ${order.orderBy} LIMIT 500`;
        })()
    : composedEntity
      ? `SELECT * FROM ${q(entity)} ORDER BY id LIMIT 500`
      : `SELECT t.*${extraSelect} FROM ${q(entity)} t ` +
        `ORDER BY t.${q(nameField)} LIMIT 500`);

  /**
   * The number, left of the name — the same shape a scene-placed row
   * already uses for its scene. For a sequence it is act.sequence,
   * because a sequence number alone says nothing about where you are.
   */
  const numberLead = (r: Record<string, unknown>): string | null => {
    const n = (v: unknown): string | null =>
      typeof v === "number" ? String(v) : null;
    if (entity === "scene") return n(r["scene_number"]);
    if (entity === "act") return n(r["act_number"]);
    if (entity === "sequence") {
      const seq = n(r["sequence_number"]);
      if (seq === null) return null;
      const act = n(r["_act_number"]);
      return act === null ? seq : `${act}.${seq}`;
    }
    return null;
  };

  // With no anchor here, a link shows both of its ends.
  const composed = composedEntity;
  // ...and anything that sits IN a scene says which one. Twelve rows
  // called "Beat A" are indistinguishable without it.
  const scenePlaced = scenePlacedEntity;
  const targets = useMemo(() => edef === undefined ? []
    : composed
      ? referenceFields(edef).map((f) => f.referenceEntity as string)
      : scenePlaced ? ["scene"] : [],
    [edef, composed, scenePlaced]);
  const refNames = useRefNames(targets);

  /**
   * A link's A-Z is sorted here, not in SQL.
   *
   * Its visible label is composed from the names of the rows it joins,
   * which live in other tables — `ORDER BY` on this one cannot reach
   * them, which is why link lists used to come back in insertion order
   * with no way to change it. Sorting on the same string that renders
   * guarantees the order matches what is on screen, and the row id
   * breaks ties so the result is stable rather than reshuffling as
   * names load.
   */
  const shown = useMemo(() => {
    if (edef === undefined || !composed || byStory) return rows;
    const label = (r: Row): string =>
      (linkLabel(edef, r, refNames) ?? rowName(entity, r)).toLowerCase();
    return [...rows].sort((a, b) => {
      const cmp = label(a).localeCompare(label(b));
      return cmp !== 0 ? cmp : Number(a["id"]) - Number(b["id"]);
    });
  }, [rows, edef, entity, composed, byStory, refNames]);

  if (edef === undefined) return <p className="muted">Unknown entity.</p>;

  return (
    <div className="entity-list">
      <header className="list-header">
        <span className="tree-icon">{edef.icon}</span>
        <h2>{edef.labelPlural}</h2>
        <span className="tree-count">{shown.length}</span>
        {canSortByStory && (
          <button className="sort-toggle"
                  title={byStory
                    ? "Ordered by position in the script. Click for A–Z."
                    : "Ordered A–Z. Click for position in the script."}
                  onClick={() =>
                    setListSort(byStory ? "name" : "story")}>
            {byStory ? "↓ story order" : "↓ A–Z"}
          </button>
        )}
        <button className="primary"
                onClick={() => void openEntityRow(entity, null)}>
          New {edef.label.toLowerCase()}
        </button>
      </header>
      {edef.description !== "" && (
        <p className="entity-description">{edef.description}</p>
      )}
      <ul className="rows">
        {shown.map((r) => (
          <li key={String(r["id"])}>
            {/* Left of the name, not floated right: it reads as part of
                the identity, which for a beat or a shot it is. */}
            {scenePlaced && (
              <span className="row-scene row-scene-lead">
                {refNames("scene", r["scene_id"]) ?? "—"}
              </span>
            )}
            {numberLead(r) !== null && (
              <span className="row-scene row-number-lead"
                    title={entity === "sequence"
                      ? "Act . sequence" : undefined}>
                {numberLead(r)}
              </span>
            )}
            <button className="row-link"
                    onClick={() =>
                      void openEntityRow(entity, r["id"] as number)}>
              {/* The number is its own badge now, so the name is the
                  name — sceneLabel would repeat it inline. */}
              {(composed ? linkLabel(edef, r, refNames) : null)
                ?? (numberLead(r) !== null
                  ? String(r[nameField] ?? rowName(entity, r))
                  : rowName(entity, r))}
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
        {shown.length === 0 && (
          <p className="muted">
            No {edef.labelPlural.toLowerCase()} yet — create the first one.
          </p>
        )}
      </ul>
    </div>
  );
}
