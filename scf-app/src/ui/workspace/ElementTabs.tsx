// SPDX-License-Identifier: Apache-2.0
/**
 * ElementTabs.tsx — tabs shared by the Location and Prop workspaces.
 */
import { useEffect, useState } from "react";
import { q } from "@scf-core/db.ts";
import { exec, registry, useStore } from "../../state/store.ts";
import { KINDS, type SubjectKind } from "../../state/subjectKinds.ts";
import { addVariantOf, cleanName } from "../../editor/elementOps.ts";
import {
  addException, loadBoard, type Exception, type Owner,
} from "../../editor/mediaOps.ts";
import { useQuery } from "../useQuery.ts";
import { mergeChanges, type ChangeUndo } from "../../state/undoChange.ts";
import { AutoField } from "./AutoField.tsx";
import { RowFields } from "./ProfileRowFields.tsx";
import {
  BoardTile, fail, FileIntake, placeFiles,
} from "./BoardParts.tsx";

/** The subject's own row, grouped by the registry's tabs. */
export function MainRowFields({ kind, id, titles, gridTabs = [] }: {
  kind: SubjectKind; id: number;
  titles: Record<string, string>; gridTabs?: string[];
}): JSX.Element {
  const row = useQuery(`SELECT * FROM ${q(kind)} WHERE id = ?`, [id])[0];
  if (row === undefined) return <p className="muted">Loading…</p>;
  return (
    <div className="ws-page">
      <section className="ws-section">
        <RowFields entity={kind} row={row} exclude={["name"]}
                   titles={titles} gridTabs={gridTabs} />
      </section>
    </div>
  );
}

/**
 * Variants: other versions of this place or thing, built or dressed
 * separately — the kitchen at night in a storm, the chime once it is
 * bent. Each card holds the variant's description and its own
 * references.
 *
 * A variant's references are an exception on the Look board with the
 * variant as its condition (§4.8, §12.8.1) — exactly what the Look tab's
 * exception list shows. Here the writer only adds pictures to the
 * variant; the binding is made on the first file.
 */
export function VariantsTab({ kind, id, note }: {
  kind: SubjectKind; id: number; note: string;
}): JSX.Element {
  const spec = KINDS[kind];
  const { deleteRow, openEntityRow, revision } = useStore();
  const variants = useQuery(
    `SELECT * FROM ${q(spec.variantEntity)} WHERE ${q(`${kind}_id`)} = ? ` +
    "AND (lifecycle_status IS NULL OR lifecycle_status <> 'cut') ORDER BY id",
    [id]);
  const [exceptions, setExceptions] = useState<Exception[]>([]);
  const [name, setName] = useState("");
  const owner: Owner = { kind, id };

  useEffect(() => {
    let cancelled = false;
    void loadBoard(exec, registry, owner, "look").then((b) => {
      if (!cancelled) setExceptions(b.exceptions);
    });
    return () => { cancelled = true; };
  }, [kind, id, revision]);  // eslint-disable-line react-hooks/exhaustive-deps

  /** The exception that is just "as this variant", if there is one. */
  const forVariant = (variantId: number): Exception | undefined =>
    exceptions.find((x) => Number(x.filters["variant_id"]) === variantId &&
      Object.entries(x.filters).every(([k, v]) => k === "variant_id" ||
        v === null || v === undefined || v === ""));

  return (
    <div className="ws-page">
      <section className="ws-section">
        <p className="ws-section-note">{note}</p>
        <div className="ws-variants">
          {variants.map((v) => {
            const vid = Number(v["id"]);
            const x = forVariant(vid);
            return (
              <details key={vid} className="ws-card costume-card"
                       open={variants.length <= 2}>
                <summary>
                  <strong>{String(v["name"] ?? "Variant")}</strong>
                  {v["is_baseline"] === 1 && (
                    <span className="ws-chip">baseline</span>
                  )}
                  <span className="ws-card-meta">
                    {x === undefined ? "no references yet"
                      : `${String(x.tiles.length)} reference` +
                        `${x.tiles.length === 1 ? "" : "s"}`}
                  </span>
                </summary>
                <div className="costume-body">
                  <div className="ws-grid">
                    <AutoField entity={spec.variantEntity} id={vid} field="name"
                               value={(v["name"] ?? null) as never}
                               showHelp={false} />
                  </div>
                  <RowFields entity={spec.variantEntity} row={v}
                             exclude={["name", `${kind}_id`]}
                             gridTabs={["State"]}
                             titles={{ General: "How it differs", State: "When",
                                       Notes: "Notes" }} />
                  <div className="rel-group">
                    <h4>References for this variant</h4>
                    {x !== undefined && (
                      <ul className="board-tiles exc-tiles">
                        {x.tiles.map((t) => (
                          <BoardTile key={t.key} tile={t} board="look"
                                     owner={owner} purposes={["set"]} live={null}
                                     onChange={(c) =>
                                       useStore.getState().recordChange(c)}
                                     onOpen={() => void openEntityRow("asset",
                                       Number(t.asset["id"]))} />
                        ))}
                      </ul>
                    )}
                    <FileIntake compact
                                exclude={new Set(x?.tiles.map((t) =>
                                  Number(t.asset["id"])) ?? [])}
                                onFiles={(incoming) => {
                                  void (async () => {
                                    let bundleId = x?.bundleId;
                                    let made: ChangeUndo | null = null;
                                    if (bundleId === undefined) {
                                      // First file: the variant's exception.
                                      // It replaces the baseline where the
                                      // variant is in force; change that under
                                      // Look, Exceptions.
                                      const added = await addException(
                                        exec, registry, owner, "look",
                                        { kind: "variant", variantId: vid }, true);
                                      made = added.change;
                                      const b = await loadBoard(exec, registry,
                                                                owner, "look");
                                      bundleId = b.exceptions.find((e) =>
                                        e.bindingId === added.bindingId)?.bundleId;
                                    }
                                    if (bundleId === undefined) return;
                                    const files = await placeFiles(
                                      incoming, owner, "look", "set", { bundleId });
                                    // One drop, one undo — the exception made
                                    // for it goes with the files.
                                    useStore.getState().recordChange(made === null
                                      ? files : mergeChanges(made, files));
                                  })().catch((e: unknown) =>
                                    fail("Could not add the references", e));
                                }} />
                  </div>
                  <div className="ws-row-actions">
                    <button className="ghost tiny" onClick={() =>
                      void openEntityRow(spec.variantEntity, vid)}>
                      Open record
                    </button>
                    <button className="ghost tiny" onClick={() =>
                      void deleteRow(spec.variantEntity, vid)}>
                      Remove variant
                    </button>
                  </div>
                </div>
              </details>
            );
          })}
          <form className="ws-add-row" onSubmit={(e) => {
            e.preventDefault();
            addVariantOf(exec, kind, id, name).then(() => {
              useStore.getState().noteWrite(); setName("");
            }).catch((err: unknown) => fail("Could not add the variant", err));
          }}>
            <label htmlFor={`ws-add-${kind}-variant`} className="visually-hidden">
              New variant
            </label>
            <input id={`ws-add-${kind}-variant`} value={name}
                   placeholder="Name a variant"
                   onChange={(e) => setName(e.target.value)} />
            <button type="submit" disabled={cleanName(name) === null}>
              Add variant
            </button>
          </form>
        </div>
      </section>
    </div>
  );
}
