import { useEffect, useMemo, useState } from "react";
import { q, type Row } from "@scf-core/db.ts";
import { exec, registry, useStore } from "../state/store.ts";
import { rowLabel, type NameLookup } from "../state/displayName.ts";

/**
 * Labels for the rows a set of reference fields point at.
 *
 * One query per referenced TABLE, not per row: a character's thirty
 * scene links resolve with a single `SELECT id, scene_number, name FROM
 * scene`. Re-runs on the store revision, so a scene rename shows up in
 * every link label that mentions it without any denormalized copy to
 * keep in step.
 */
export function useRefNames(entities: string[]): NameLookup {
  const revision = useStore((s) => s.revision);
  const key = [...new Set(entities)].sort().join(",");
  const [maps, setMaps] =
    useState<Map<string, Map<string, string>>>(new Map());

  useEffect(() => {
    const wanted = key === "" ? [] : key.split(",");
    if (wanted.length === 0) {
      setMaps(new Map());
      return;
    }
    let cancelled = false;
    const load = async (): Promise<Map<string, Map<string, string>>> => {
      const out = new Map<string, Map<string, string>>();
      for (const entity of wanted) {
        const edef = registry.entities.get(entity);
        if (edef === undefined) continue;
        const cols = ["id", q(edef.nameField)];
        if (entity === "scene") cols.splice(1, 0, "scene_number");
        const rows: Row[] = await exec(
          `SELECT ${cols.join(", ")} FROM ${q(entity)} LIMIT 5000`);
        out.set(entity, new Map(rows.map((r) =>
          [String(r["id"]), rowLabel(edef, entity, r)])));
      }
      return out;
    };
    load().then((out) => {
      if (!cancelled) setMaps(out);
    }).catch((e: unknown) => {
      console.error("reference labels failed:", key, e);
      if (!cancelled) setMaps(new Map());
    });
    return () => {
      cancelled = true;
    };
  }, [key, revision]);

  return useMemo<NameLookup>(() => (entity, id) => {
    if (id === null || id === undefined) return null;
    return maps.get(entity)?.get(String(id)) ?? null;
  }, [maps]);
}
