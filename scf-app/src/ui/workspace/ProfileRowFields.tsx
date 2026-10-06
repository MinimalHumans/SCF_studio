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
                                   gridTabs = [] }: {
  entity: string;
  characterId: number;
  /** Section title per registry tab; a tab not named keeps its own name. */
  titles: Record<string, string>;
  /** Tabs of short fields, laid out as a grid. */
  gridTabs?: string[];
}): JSX.Element | null {
  const edef = registry.entities.get(entity);
  const rows = useQuery(
    `SELECT * FROM ${q(entity)} WHERE character_id = ? ` +
    "AND (lifecycle_status IS NULL OR lifecycle_status <> 'cut') ORDER BY id",
    [characterId]);
  const creating = useRef<Promise<number> | null>(null);
  if (edef === undefined) return null;
  const row = rows[0];
  const id = row === undefined ? null : Number(row["id"]);

  const ensure = (): Promise<number> => {
    if (creating.current === null) {
      creating.current = (async () => {
        await exec(`INSERT INTO ${q(entity)} (uuid, character_id) VALUES (?, ?)`,
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
    if (f.name === "name" || f.name === "character_id") continue;
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
                             f.name !== "character_id")
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
