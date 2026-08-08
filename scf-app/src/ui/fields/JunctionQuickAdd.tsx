import { useState } from "react";
import type { EntityDef } from "@scf-core/registry.ts";
import { newUuid, q } from "@scf-core/db.ts";
import { exec, registry, rowName, useStore } from "../../state/store.ts";
import { useQuery } from "../useQuery.ts";
import {
  SCENE_ORDER_BY, SCENE_ORDER_JOIN,
} from "@scf-core/structure.ts";

/**
 * Junction quick-add — v1's link panel pattern, generalized. Any
 * link-subject entity (scene_character, motif_appearance, costume_scene…)
 * gets an inline add/remove editor from *either* end: the anchored side is
 * prefilled from the subject being viewed, the other side is a picker.
 * Junctions with extra reference ends or authored fields open the full
 * form via the row link as usual.
 */
export function JunctionQuickAdd({ edef, anchorField, anchorId }: {
  edef: EntityDef;
  /** The reference field pointing at the subject in view. */
  anchorField: string;
  anchorId: number;
}): JSX.Element | null {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const bump = useStore((s) => s.revision);
  const setRevision = useStore.setState;

  // The "other end": the first non-injected reference field that is not
  // the anchor. Junctions are pairs by design; extras stay form-only.
  const other = edef.fields.find(
    (f) => f.fieldType === "reference" && !f.autoInjected &&
           f.name !== anchorField);
  const target = other?.referenceEntity !== undefined
    ? registry.entities.get(other.referenceEntity) : undefined;
  const nameField = target?.nameField ?? "name";

  // Scene candidates come in story order; every other target is
  // alphabetical, which is what a name is for.
  const candidates = useQuery(
    open && target !== undefined
      ? (target.name === "scene"
          ? `SELECT s.* FROM scene s ${SCENE_ORDER_JOIN} ` +
            `WHERE s.${q(nameField)} LIKE ? ${SCENE_ORDER_BY}`
          : `SELECT * FROM ${q(target.name)} ` +
            `WHERE ${q(nameField)} LIKE ? ORDER BY ${q(nameField)}`) +
        " LIMIT 30"
      : null,
    [`%${filter}%`]);

  if (other === undefined || target === undefined) return null;

  const add = async (otherId: number): Promise<void> => {
    await exec(
      `INSERT INTO ${q(edef.name)} ` +
      `(${q(anchorField)}, ${q(other.name)}, uuid) VALUES (?, ?, ?)`,
      [anchorId, otherId, newUuid()]);
    setOpen(false);
    setFilter("");
    setRevision((s) => ({ revision: s.revision + 1 }));
  };

  return (
    <div className="junction-add" data-revision={bump}>
      {!open ? (
        <button className="ghost tiny" onClick={() => setOpen(true)}>
          + link {target.label.toLowerCase()}
        </button>
      ) : (
        <div className="ref-picker junction-picker">
          <input autoFocus value={filter}
                 placeholder={`search ${target.labelPlural.toLowerCase()}`}
                 onChange={(e) => setFilter(e.target.value)}
                 onKeyDown={(e) => {
                   if (e.key === "Escape") setOpen(false);
                 }} />
          <ul>
            {candidates.map((r) => (
              <li key={String(r["id"])}>
                <button type="button"
                        onClick={() => void add(r["id"] as number)}>
                  {rowName(target.name, r)}
                </button>
              </li>
            ))}
            {candidates.length === 0 && (
              <li className="muted">no match</li>
            )}
          </ul>
          <button className="ghost tiny" onClick={() => setOpen(false)}>
            cancel
          </button>
        </div>
      )}
    </div>
  );
}
