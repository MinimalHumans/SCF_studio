// SPDX-License-Identifier: Apache-2.0
import { useRef } from "react";
import { newUuid, q } from "@scf-core/db.ts";
import { exec, registry, useStore } from "../../state/store.ts";
import { useQuery } from "../useQuery.ts";
import { AutoField } from "./AutoField.tsx";

/**
 * The fields of a one-per-character row — appearance, color identity,
 * vocal profile — grouped by the registry's own tabs, each tab a
 * divider rather than a click.
 *
 * The row is not created by opening the page. It is created by the
 * first thing typed into it, so an untouched profile stays absent rather
 * than becoming an empty row that readiness would count as begun. Every
 * field shares one creation promise, so two fields typed into at once
 * still make one row.
 *
 * One row per character is a WORKSPACE convention, not a format rule:
 * nothing stops a file having two. If it does, this edits the first and
 * says so.
 */
export function ProfileRowFields({ entity, characterId, titles,
                                   gridTabs = [], where = null,
                                   exclude = [],
                                   ownerColumn = "character_id" }: {
  entity: string;
  /** The owner's id — a character's, or a location's or prop's when
   *  `ownerColumn` says so. */
  characterId: number;
  /** The column naming the owner: `location_id` for a location design. */
  ownerColumn?: string;
  /** Narrows which row is "the" row: `scene_id IS NULL` for a baseline
   *  makeup design, say. A literal condition, never user input. */
  where?: string | null;
  /** Fields not to show here. */
  exclude?: string[];
  /** Section title per registry tab; a tab not named keeps its own name. */
  titles: Record<string, string>;
  /** Tabs of short fields, laid out as a grid. */
  gridTabs?: string[];
}): JSX.Element | null {
  const edef = registry.entities.get(entity);
  const rows = useQuery(
    `SELECT * FROM ${q(entity)} WHERE ${q(ownerColumn)} = ? ` +
    (where === null ? "" : `AND (${where}) `) +
    "AND (lifecycle_status IS NULL OR lifecycle_status <> 'cut') ORDER BY id",
    [characterId]);
  const creating = useRef<Promise<number> | null>(null);
  if (edef === undefined) return null;
  const row = rows[0];
  const id = row === undefined ? null : Number(row["id"]);

  const ensure = (): Promise<number> => {
    if (creating.current === null) {
      creating.current = (async () => {
        await exec(`INSERT INTO ${q(entity)} (uuid, ${q(ownerColumn)}) ` +
                   "VALUES (?, ?)",
                   [newUuid(), characterId]);
        const made = Number((await exec(
          "SELECT last_insert_rowid() AS id"))[0]?.["id"]);
        useStore.getState().noteWrite();
        return made;
      })();
    }
    return creating.current;
  };

  const tabs: string[] = [];
  for (const f of edef.fields) {
    if (f.autoInjected === true || f.hidden === true) continue;
    if (f.name === "name" || f.name === ownerColumn) continue;
    if (exclude.includes(f.name)) continue;
    if (!tabs.includes(f.tab)) tabs.push(f.tab);
  }

  return (
    <div className="ws-rowfields">
      {rows.length > 1 && (
        <p className="ws-field-error">
          This character has {rows.length} {edef.labelPlural.toLowerCase()};
          these fields edit the first. Open Schema to merge them.
        </p>
      )}
      {tabs.map((tab) => (
        <div key={tab} className="rel-group">
          <h4>{titles[tab] ?? tab}</h4>
          <div className={gridTabs.includes(tab) ? "ws-grid" : "ws-stack"}>
            {edef.fields
              .filter((f) => f.tab === tab && f.autoInjected !== true &&
                             f.hidden !== true && f.name !== "name" &&
                             f.name !== ownerColumn &&
                             !exclude.includes(f.name))
              .map((f) => (
                <AutoField key={f.name} entity={entity}
                           id={id} ensure={ensure} field={f.name}
                           value={row?.[f.name] ?? null} showHelp={false} />
              ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * The fields of an existing row, grouped by the registry's tabs — the
 * body of a costume card or a habit card.
 */
export function RowFields({ entity, row, titles = {}, gridTabs = [],
                            exclude = [] }: {
  entity: string;
  row: Record<string, unknown>;
  titles?: Record<string, string>;
  gridTabs?: string[];
  exclude?: string[];
}): JSX.Element | null {
  const edef = registry.entities.get(entity);
  if (edef === undefined) return null;
  const id = Number(row["id"]);
  const shown = edef.fields.filter((f) => f.autoInjected !== true &&
    f.hidden !== true && !exclude.includes(f.name));
  const tabs = [...new Set(shown.map((f) => f.tab))];
  return (
    <div className="ws-rowfields">
      {tabs.map((tab) => (
        <div key={tab} className="rel-group">
          {tabs.length > 1 && <h4>{titles[tab] ?? tab}</h4>}
          <div className={gridTabs.includes(tab) ? "ws-grid" : "ws-stack"}>
            {shown.filter((f) => f.tab === tab).map((f) => (
              <AutoField key={f.name} entity={entity} id={id} field={f.name}
                         value={(row[f.name] ?? null) as never}
                         showHelp={false} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
