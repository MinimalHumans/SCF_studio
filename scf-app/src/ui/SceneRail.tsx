/**
 * SceneRail — the script surface's nav rail.
 *
 * The script is a flat document, but it has a structure over it, so the
 * rail shows both: acts and sequences where they are defined, scenes
 * under them, in screenplay order. Structure here is derived from the
 * boundaries exactly as everywhere else (scf-core/src/structure.ts), so
 * a sequence that crosses an act boundary shows in both acts as the
 * part of it that belongs there — grouped by run, not by where it
 * starts.
 *
 * The filters answer the question the rail is usually being scanned
 * for: "which scenes have X in them". A scene is kept when it holds the
 * chosen character, prop, or location; an act or sequence is kept when
 * any of its scenes survive, so the tree collapses to just the places
 * that matter rather than going blank.
 */

import { Fragment, useMemo, useState } from "react";
import {
  actOutline, deriveStructure, orphanedScenes, sceneOrderHint,
} from "@scf-core/structure.ts";
import { sceneLabel } from "../state/displayName.ts";
import { exec, registry, useStore } from "../state/store.ts";
import { useQuery } from "./useQuery.ts";
import {
  describeChildren, planSceneRemoval, type RemovalImpact,
} from "../editor/sceneOps.ts";
import { scriptViewHandle } from "./ScriptView.tsx";

type FilterKind = "character" | "prop" | "location";

/*
 * The list is every subject of that kind, not only the ones already
 * placed in a scene.
 *
 * It used to INNER JOIN the junction, which meant a prop you had just
 * created — in the Schema tab, or from the script's right-click menu —
 * was missing from the filter it was created for, with no way to tell
 * whether it had been made at all. A subject with no scenes is a real
 * subject and a useful thing to notice; the rail says so rather than
 * pretending it does not exist.
 */
const FILTER_SQL: Record<FilterKind, { list: string; scenes: string }> = {
  character: {
    list: "SELECT id, name FROM character ORDER BY name",
    scenes: "SELECT scene_id FROM scene_character WHERE character_id = ?",
  },
  prop: {
    list: "SELECT id, name FROM prop ORDER BY name",
    scenes: "SELECT scene_id FROM scene_prop WHERE prop_id = ?",
  },
  location: {
    list: "SELECT id, name FROM location ORDER BY name",
    scenes: "SELECT id AS scene_id FROM scene WHERE location_id = ?",
  },
};

export function SceneRail(): JSX.Element {
  const { openEntityRow } = useStore();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [kind, setKind] = useState<FilterKind>("character");
  const [subjectId, setSubjectId] = useState<string>("");
  const [dragging, setDragging] = useState<number | null>(null);
  const [dropBefore, setDropBefore] = useState<number | "end" | null>(null);
  const [menu, setMenu] = useState<
    { sceneId: number; x: number; y: number } | null>(null);
  const [confirm, setConfirm] = useState<RemovalImpact & {
    sceneId: number } | null>(null);
  const [busy, setBusy] = useState(false);

  const headings = useQuery(
    "SELECT sl.line_order, sl.content, sl.scene_id " +
    "FROM screenplay_lines sl WHERE sl.line_type = 'heading' " +
    "ORDER BY sl.line_order");
  const scenes = useQuery("SELECT id, scene_number, name FROM scene");
  const acts = useQuery(
    "SELECT id, name, act_number, start_scene_id FROM act");
  const sequences = useQuery(
    "SELECT id, name, sequence_number, start_scene_id FROM sequence");

  const choices = useQuery(FILTER_SQL[kind].list);
  const matching = useQuery(
    subjectId === "" ? null : FILTER_SQL[kind].scenes, [Number(subjectId)]);
  const allowed = useMemo(
    () => subjectId === ""
      ? null : new Set(matching.map((r) => Number(r["scene_id"]))),
    [subjectId, matching]);

  // The script owns the order. Without this the rail kept rendering the
  // pre-move order after a drag, because scene_number had not changed.
  const orderHint = useMemo(() => sceneOrderHint(headings), [headings]);
  const structure = useMemo(
    () => deriveStructure(scenes, acts, sequences, orderHint),
    [scenes, acts, sequences, orderHint]);
  // Derived, never written. A scene cut from the script keeps its record
  // and everything linked to it; what it loses is a POSITION, and that
  // is what the badge says.
  const orphans = useMemo(
    () => new Set(orphanedScenes(scenes, orderHint)),
    [scenes, orderHint]);
  const sceneById = useMemo(
    () => new Map(scenes.map((s) => [Number(s["id"]), s])), [scenes]);
  const headingFor = useMemo(() => {
    const map = new Map<number, number>();
    for (const h of headings) {
      const id = h["scene_id"];
      if (id !== null && !map.has(Number(id))) {
        map.set(Number(id), Number(h["line_order"]));
      }
    }
    return map;
  }, [headings]);

  const keep = (sceneId: number): boolean =>
    allowed === null || allowed.has(sceneId);
  const toggle = (key: string): void => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const allKeys = useMemo(() => {
    const keys: string[] = [];
    for (const act of structure.acts) {
      keys.push(`act:${String(act.id)}`);
      for (const group of actOutline(structure, act)) {
        if (group.sequence !== null) {
          keys.push(`act:${String(act.id)}:seq:${String(group.sequence.id)}`);
        }
      }
    }
    return keys;
  }, [structure]);
  const allCollapsed = collapsed.size >= allKeys.length && allKeys.length > 0;

  /**
   * Drag a scene to reorder it.
   *
   * The drop moves the scene's whole block in the SCRIPT — heading plus
   * everything down to the next heading — and the scene entity is never
   * touched, so beats, shots and links follow with no work. Dragging is
   * disabled while a filter is on: "before this scene" is not a position
   * you can trust when scenes between them are hidden. It is also
   * disabled for a scene with no heading yet, since there is no block to
   * move.
   */
  const draggable = allowed === null;
  const dropOn = (target: number | "end"): void => {
    const source = dragging;
    setDragging(null);
    setDropBefore(null);
    if (source === null || source === target) return;
    scriptViewHandle.moveScene?.(
      source, target === "end" ? null : target);
  };

  const sceneRow = (sceneId: number): JSX.Element | null => {
    if (!keep(sceneId)) return null;
    const scene = sceneById.get(sceneId);
    const lineOrder = headingFor.get(sceneId);
    const number = scene?.["scene_number"];
    const canDrag = draggable && lineOrder !== undefined;
    const orphaned = orphans.has(sceneId);
    return (
      <li key={sceneId}
          className={"rail-scene" +
            (dragging === sceneId ? " rail-dragging" : "") +
            (dropBefore === sceneId ? " rail-drop-before" : "")}
          draggable={canDrag}
          onDragStart={(e) => {
            if (!canDrag) return;
            setDragging(sceneId);
            e.dataTransfer.effectAllowed = "move";
            // Firefox needs some payload for a drag to start at all.
            e.dataTransfer.setData("text/plain", String(sceneId));
          }}
          onDragEnd={() => {
            setDragging(null);
            setDropBefore(null);
          }}
          onDragOver={(e) => {
            if (dragging === null || dragging === sceneId) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            setDropBefore(sceneId);
          }}
          onDragLeave={() =>
            setDropBefore((x) => (x === sceneId ? null : x))}
          onDrop={(e) => {
            e.preventDefault();
            dropOn(sceneId);
          }}
          onContextMenu={(e) => {
            if (lineOrder === undefined) return;
            e.preventDefault();
            setMenu({ sceneId, x: e.clientX, y: e.clientY });
          }}>
        <span className="rail-number">
          {number === null || number === undefined ? "—" : String(number)}
        </span>
        <button className="scene-jump"
                disabled={lineOrder === undefined}
                title={lineOrder === undefined
                  ? "This scene has no heading in the script yet" : ""}
                onClick={() => {
                  if (lineOrder !== undefined) {
                    scriptViewHandle.scrollToLineOrder?.(lineOrder);
                  }
                }}>
          {String(scene?.["name"] ?? sceneLabel(scene))}
        </button>
        {orphaned && (
          <span className="rail-orphan"
                title={"Not in the screenplay. The scene record and " +
                       "everything linked to it are untouched — it has no " +
                       "number and belongs to no act until it is back in " +
                       "the script. Mark it 'cut' yourself if that is what " +
                       "you mean."}>
            not in script
          </span>
        )}
        <button className="scene-chip" title="Open the scene record"
                onClick={() => void openEntityRow("scene", sceneId)}>
          ⛭
        </button>
      </li>
    );
  };

  // Headings the structure knows nothing about: no scene link yet, or a
  // scene sitting before the first act boundary.
  const placed = new Set(structure.acts.flatMap((a) => a.sceneIds));
  const loose = headings
    .map((h) => (h["scene_id"] === null ? null : Number(h["scene_id"])))
    .filter((id): id is number => id !== null && !placed.has(id));
  const unlinked = headings.filter((h) => h["scene_id"] === null);

  return (
    <nav className="scene-rail" aria-label="scenes">
      <div className="rail-head">
        <span>Scenes ({headings.length})</span>
        {allKeys.length > 0 && (
          <button className="ghost tiny"
                  onClick={() => setCollapsed(
                    allCollapsed ? new Set() : new Set(allKeys))}>
            {allCollapsed ? "expand all" : "collapse all"}
          </button>
        )}
      </div>

      <div className="rail-filter">
        <select value={kind}
                onChange={(e) => {
                  setKind(e.target.value as FilterKind);
                  setSubjectId("");
                }}>
          <option value="character">character</option>
          <option value="prop">prop</option>
          <option value="location">location</option>
        </select>
        <select value={subjectId}
                onChange={(e) => setSubjectId(e.target.value)}>
          <option value="">all scenes</option>
          {choices.map((c) => (
            <option key={String(c["id"])} value={String(c["id"])}>
              {String(c["name"])}
            </option>
          ))}
        </select>
      </div>
      {allowed !== null && (
        <div className="rail-filter-note">
          {allowed.size} scene{allowed.size === 1 ? "" : "s"}
        </div>
      )}

      <ul className="rail-tree">
        {structure.acts.map((act) => {
          const visible = act.sceneIds.filter(keep);
          if (visible.length === 0) return null;
          const key = `act:${String(act.id)}`;
          const open = !collapsed.has(key);
          return (
            <li key={key}>
              <div className="rail-span rail-act">
                <button className="rail-caret" onClick={() => toggle(key)}
                        aria-expanded={open}>{open ? "▾" : "▸"}</button>
                <span className="rail-number">
                  {act.number === null ? "—" : String(act.number)}
                </span>
                <span className="rail-span-name">{act.name}</span>
                <button className="scene-chip" title="Open the act record"
                        onClick={() => void openEntityRow("act", act.id)}>
                  ⛭
                </button>
              </div>
              {open && (
                <ul>
                  {actOutline(structure, act).map((group, i) => {
                    const inGroup = group.sceneIds.filter(keep);
                    if (inGroup.length === 0) return null;
                    if (group.sequence === null) {
                      // No sequence over these scenes: list them at the
                      // act's level rather than indenting for an empty
                      // grouping.
                      // A run with no sequence lists its scenes at the
                      // act's level. They are already <li>s, so wrapping
                      // them in another one nested li inside li — invalid,
                      // and React says so on every render.
                      return (
                        <Fragment key={`bare:${String(i)}`}>
                          {group.sceneIds.map(sceneRow)}
                        </Fragment>
                      );
                    }
                    const seq = group.sequence;
                    const seqKey = `${key}:seq:${String(seq.id)}`;
                    const seqOpen = !collapsed.has(seqKey);
                    return (
                      <li key={seqKey}>
                        <div className="rail-span rail-seq">
                          <button className="rail-caret"
                                  onClick={() => toggle(seqKey)}
                                  aria-expanded={seqOpen}>
                            {seqOpen ? "▾" : "▸"}
                          </button>
                          <span className="rail-number">
                            {seq.number === null ? "—" : String(seq.number)}
                          </span>
                          <span className="rail-span-name">
                            {seq.name}
                            {group.continuesFrom && " …cont"}
                            {group.continuesInto && " cont…"}
                          </span>
                          <button className="scene-chip"
                                  title="Open the sequence record"
                                  onClick={() => void openEntityRow(
                                    "sequence", seq.id)}>⛭</button>
                        </div>
                        {seqOpen && <ul>{group.sceneIds.map(sceneRow)}</ul>}
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          );
        })}

        {loose.length > 0 && loose.some(keep) && (
          <li>
            <div className="rail-span rail-loose">
              <span className="rail-span-name">
                {structure.acts.length === 0
                  ? "No structure yet" : "Before the first act"}
              </span>
            </div>
            <ul>{loose.map(sceneRow)}</ul>
          </li>
        )}

        {allowed === null && unlinked.map((h) => (
          <li key={`u${String(h["line_order"])}`} className="rail-scene">
            <span className="rail-number">·</span>
            <button className="scene-jump"
                    title="This heading is not linked to a scene yet"
                    onClick={() => scriptViewHandle.scrollToLineOrder?.(
                      h["line_order"] as number)}>
              {String(h["content"])}
            </button>
          </li>
        ))}

        {dragging !== null && (
          <li className={"rail-drop-end" +
                (dropBefore === "end" ? " rail-drop-before" : "")}
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                setDropBefore("end");
              }}
              onDragLeave={() =>
                setDropBefore((x) => (x === "end" ? null : x))}
              onDrop={(e) => {
                e.preventDefault();
                dropOn("end");
              }}>
            drop here to move to the end
          </li>
        )}

        {headings.length === 0 && (
          <li className="muted rail-empty">no screenplay yet</li>
        )}
        {headings.length > 0 && allowed !== null && allowed.size === 0 && (
          <li className="muted rail-empty">
            Not in any scene yet. Tag it in the script, or link it from
            the record.
          </li>
        )}
      </ul>

      {allowed !== null && headings.length > 0 && (
        <div className="rail-filter-note muted">
          Clear the filter to drag scenes into a new order.
        </div>
      )}

      {menu !== null && (
        <>
          <div className="menu-scrim" onClick={() => setMenu(null)}
               onContextMenu={(e) => {
                 e.preventDefault();
                 setMenu(null);
               }} />
          <ul className="rail-menu"
              style={{ left: menu.x, top: menu.y }}>
            <li>
              <button onClick={() => {
                const sceneId = menu.sceneId;
                setMenu(null);
                setBusy(true);
                // Additive and immediately visible, so no confirmation
                // — a modal here would only dilute the one on Remove.
                void scriptViewHandle.duplicateScene?.(sceneId)
                  .finally(() => setBusy(false));
              }} disabled={busy}>
                Duplicate scene
              </button>
            </li>
            <li>
              <button className="danger" disabled={busy}
                      onClick={() => {
                        const sceneId = menu.sceneId;
                        setMenu(null);
                        setBusy(true);
                        const lineIds =
                          scriptViewHandle.sceneLineIds?.(sceneId) ?? [];
                        void planSceneRemoval(
                          exec, registry, sceneId, lineIds)
                          .then((impact) => {
                            setConfirm({ ...impact, sceneId });
                            setBusy(false);
                          });
                      }}>
                Remove scene…
              </button>
            </li>
          </ul>
        </>
      )}

      {confirm !== null && (
        <div className="modal-scrim" role="dialog" aria-modal="true">
          <div className="modal rail-confirm">
            <h3>Remove {confirm.sceneName || "this scene"}?</h3>
            <p>
              This deletes the scene record, its{" "}
              {confirm.lines} script line(s), and everything belonging to
              it. <b>It cannot be undone.</b>
            </p>
            {confirm.children.length > 0 && (
              <p className="revert-warn">
                Also deleted: {describeChildren(confirm.children)}.
              </p>
            )}
            {confirm.propTags > 0 && (
              <p className="revert-warn">
                {confirm.propTags} prop tag(s) on these lines go with
                them. The props themselves are untouched.
              </p>
            )}
            {confirm.references > 0 && (
              <p className="muted">
                {confirm.references} record(s) elsewhere point at this
                scene. They are kept — only the reference is cleared.
              </p>
            )}
            <div className="revert-actions">
              <button onClick={() => setConfirm(null)} disabled={busy}>
                Cancel
              </button>
              <button className="danger" disabled={busy}
                      onClick={() => {
                        const sceneId = confirm.sceneId;
                        setBusy(true);
                        void scriptViewHandle.removeScene?.(sceneId)
                          .finally(() => {
                            setConfirm(null);
                            setBusy(false);
                          });
                      }}>
                Remove
              </button>
            </div>
          </div>
        </div>
      )}
    </nav>
  );
}
