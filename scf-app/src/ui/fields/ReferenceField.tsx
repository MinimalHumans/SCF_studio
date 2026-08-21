// SPDX-License-Identifier: Apache-2.0
import { useState } from "react";
import type { FieldDef } from "@scf-core/registry.ts";
import { newUuid, q, type SqlValue } from "@scf-core/db.ts";
import { exec, registry, rowName, useStore } from "../../state/store.ts";
import { useQuery } from "../useQuery.ts";

/**
 * Reference field: entity picker with search + create-inline. The current
 * value renders as a navigable chip (cross-links everywhere); the picker
 * filters the referenced entity's rows and can create a named stub on the
 * spot — stub-first is the format's authoring model.
 */
export function ReferenceField({ def, value, onChange }: {
  def: FieldDef; value: SqlValue; onChange: (v: SqlValue) => void;
}): JSX.Element {
  const target = def.referenceEntity ?? "";
  const targetDef = registry.entities.get(target);
  const { openEntityRow } = useStore();
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const nameField = targetDef?.nameField ?? "name";

  const current = useQuery(
    typeof value === "number" && targetDef !== undefined
      ? `SELECT * FROM ${q(target)} WHERE id = ?` : null,
    typeof value === "number" ? [value] : []);
  const candidates = useQuery(
    open && targetDef !== undefined
      ? `SELECT * FROM ${q(target)} WHERE ${q(nameField)} LIKE ? ` +
        `ORDER BY ${q(nameField)} LIMIT 30`
      : null,
    [`%${filter}%`]);

  if (targetDef === undefined) {
    return <p className="muted">unknown reference target: {target}</p>;
  }

  const createInline = async (): Promise<void> => {
    const name = filter.trim();
    if (name === "") return;
    await exec(
      `INSERT INTO ${q(target)} (${q(nameField)}, uuid) VALUES (?, ?)`,
      [name, newUuid()]);
    const idRow = await exec("SELECT last_insert_rowid() AS id");
    const id = idRow[0]?.["id"];
    if (typeof id === "number") {
      onChange(id);
      setOpen(false);
      setFilter("");
    }
  };

  return (
    <div className="reference-field">
      {typeof value === "number" && current[0] !== undefined ? (
        <span className="ref-chip">
          <button type="button" className="ref-name"
                  title={`Open ${targetDef.label.toLowerCase()}`}
                  onClick={() => void openEntityRow(target, value)}>
            {targetDef.icon} {rowName(target, current[0])}
          </button>
          <button type="button" aria-label="Clear reference"
                  onClick={() => onChange(null)}>×</button>
        </span>
      ) : (
        <button type="button" className="ref-empty"
                onClick={() => setOpen(true)}>
          choose {targetDef.label.toLowerCase()}…
        </button>
      )}
      {typeof value === "number" && (
        <button type="button" className="ghost tiny"
                onClick={() => setOpen((o) => !o)}>change</button>
      )}
      {open && (
        <div className="ref-picker">
          <input autoFocus value={filter}
                 placeholder={`search ${targetDef.labelPlural.toLowerCase()}`}
                 onChange={(e) => setFilter(e.target.value)}
                 onKeyDown={(e) => {
                   if (e.key === "Escape") setOpen(false);
                 }} />
          <ul>
            {candidates.map((r) => (
              <li key={String(r["id"])}>
                <button type="button"
                        onClick={() => {
                          onChange(r["id"] as number);
                          setOpen(false);
                          setFilter("");
                        }}>
                  {rowName(target, r)}
                </button>
              </li>
            ))}
            {candidates.length === 0 && filter.trim() !== "" && (
              <li className="muted">no match</li>
            )}
          </ul>
          {filter.trim() !== "" && (
            <button type="button" className="ghost"
                    onClick={() => void createInline()}>
              Create “{filter.trim()}” as new{" "}
              {targetDef.label.toLowerCase()}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
