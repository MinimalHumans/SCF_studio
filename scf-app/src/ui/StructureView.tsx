import { useMemo } from "react";
import type { Row } from "@scf-core/db.ts";
import {
  actOutline, deriveStructure, sceneOrderHint, structureFindings,
  type Span, type Structure,
} from "@scf-core/structure.ts";
import { sceneLabel } from "../state/displayName.ts";
import { exec, useStore } from "../state/store.ts";
import { renumberSpans } from "../editor/structureCommit.ts";
import { useQuery } from "./useQuery.ts";

/**
 * The script's spine: acts, the sequences inside them, the scenes
 * inside those.
 *
 * Everything here reads from ONE stored fact per span — the scene it
 * starts at. There is no membership to edit, no end to keep in step:
 * moving a boundary re-cuts both spans either side of it in a single
 * write, and a scene added to the script joins its act with no write at
 * all. The panel therefore only ever offers three verbs: start it
 * somewhere, move it, or unanchor it.
 */
export function StructureView(): JSX.Element {
  const { openEntityRow } = useStore();
  const scenes = useQuery(
    "SELECT id, scene_number, name FROM scene");
  const headings = useQuery(
    "SELECT scene_id, line_order FROM screenplay_lines " +
    "WHERE line_type = 'heading' ORDER BY line_order");
  const acts = useQuery(
    "SELECT id, name, act_number, start_scene_id FROM act ORDER BY id");
  const sequences = useQuery(
    "SELECT id, name, sequence_number, act_id, start_scene_id " +
    "FROM sequence ORDER BY id");

  // Same rule as the rail: when a screenplay exists it owns scene order.
  const orderHint = useMemo(() => sceneOrderHint(headings), [headings]);
  const structure = useMemo(
    () => deriveStructure(scenes, acts, sequences, orderHint),
    [scenes, acts, sequences, orderHint]);
  const findings = useMemo(
    () => structureFindings(structure, acts, sequences, orderHint),
    [structure, acts, sequences, orderHint]);

  const sceneById = useMemo(
    () => new Map(scenes.map((s) => [Number(s["id"]), s])), [scenes]);
  const unanchored = {
    act: acts.filter((r) => r["start_scene_id"] === null),
    sequence: sequences.filter((r) => r["start_scene_id"] === null),
  };

  const setBoundary = async (table: "act" | "sequence", id: number,
                             sceneId: number | null): Promise<void> => {
    await exec(
      `UPDATE ${table} SET start_scene_id = ?, ` +
      "updated_at = datetime('now') WHERE id = ?", [sceneId, id]);
    // Moving a boundary changes the derived order, so the numbers change
    // with it. This used to wait for the next SCRIPT commit, which meant
    // the tab you moved the boundary in showed stale numbers until you
    // went and typed something.
    await renumberSpans(exec);
    useStore.setState((s) => ({ revision: s.revision + 1 }));
  };

  const create = async (table: "act" | "sequence",
                        sceneId: number): Promise<void> => {
    // NOT "Act 3". A stored name built from a count is a label that
    // starts true and becomes a lie the moment a boundary moves — the
    // exact denormalization the number is there to avoid. The number is
    // derived and displayed beside the name; the name is a title.
    const label = table === "act" ? "Untitled act" : "Untitled sequence";
    await exec(
      `INSERT INTO ${table} (name, start_scene_id) VALUES (?, ?)`,
      [label, sceneId]);
    await renumberSpans(exec);
    useStore.setState((s) => ({ revision: s.revision + 1 }));
  };

  if (scenes.length === 0) {
    return (
      <div className="structure">
        <p className="muted">
          No scenes yet. Structure is built over the script, so import or
          write one first.
        </p>
      </div>
    );
  }

  return (
    <div className="structure">
      <div className="structure-head">
        <h2>Structure</h2>
        <StartHere label="+ act" scenes={scenes}
                   onPick={(id) => void create("act", id)} />
        <StartHere label="+ sequence" scenes={scenes}
                   onPick={(id) => void create("sequence", id)} />
      </div>

      {structure.acts.length === 0 && structure.sequences.length === 0 && (
        <p className="muted">
          Nothing placed yet. An act begins at a scene and runs until the
          next act begins — so two placements cover a three-act script.
          You can also write <code>#{" "}ACT II</code> in the script and
          commit.
        </p>
      )}

      {structure.unassignedSceneIds.length > 0 &&
       structure.acts.length > 0 && (
        <div className="structure-loose">
          <span className="structure-kind">before the first act</span>
          <span className="muted">
            {structure.unassignedSceneIds.length} scene(s)
          </span>
        </div>
      )}

      {structure.acts.map((act) => (
        <ActBlock key={act.id} act={act} structure={structure}
                  scenes={scenes} sceneById={sceneById}
                  onOpen={(table, id) => void openEntityRow(table, id)}
                  onMove={(table, id, sceneId) =>
                    void setBoundary(table, id, sceneId)} />
      ))}

      {/* Sequences that start before any act, so they hang off nothing. */}
      {structure.sequences
        .filter((s) => !structure.actOfScene.has(s.startSceneId))
        .map((seq) => (
          <SpanRow key={seq.id} kind="sequence" span={seq} scenes={scenes}
                   onOpen={() => void openEntityRow("sequence", seq.id)}
                   onMove={(sceneId) =>
                     void setBoundary("sequence", seq.id, sceneId)} />
        ))}

      {(unanchored.act.length > 0 || unanchored.sequence.length > 0) && (
        <div className="structure-unplaced">
          <h3>Not placed</h3>
          <p className="muted">
            These exist but have no start scene, so they appear nowhere
            in the script.
          </p>
          {[...unanchored.act.map((r) => ["act", r] as const),
            ...unanchored.sequence.map((r) => ["sequence", r] as const)]
            .map(([table, r]) => (
              <div key={`${table}:${String(r["id"])}`}
                   className="structure-loose">
                <span className="structure-kind">{table}</span>
                <button className="row-link"
                        onClick={() =>
                          void openEntityRow(table, Number(r["id"]))}>
                  {String(r["name"] ?? "")}
                </button>
                <StartHere label="starts at…" scenes={scenes}
                           onPick={(sceneId) =>
                             void setBoundary(table, Number(r["id"]),
                                              sceneId)} />
              </div>
            ))}
        </div>
      )}

      {findings.length > 0 && (
        <div className="structure-findings">
          <h3>Worth a look</h3>
          <ul>
            {findings.map((f, i) => (
              <li key={`${f.code}:${String(f.rowId)}:${String(i)}`}
                  className={`finding-${f.level}`}>
                {f.message}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function ActBlock({ act, structure, scenes, sceneById, onOpen, onMove }: {
  act: Span;
  structure: Structure;
  scenes: Row[];
  sceneById: Map<number, Row>;
  onOpen: (table: "act" | "sequence", id: number) => void;
  onMove: (table: "act" | "sequence", id: number,
           sceneId: number | null) => void;
}): JSX.Element {
  // Grouped by run: a sequence may cross an act boundary, so it shows
  // in each act as the part of it that belongs there.
  const groups = actOutline(structure, act);

  return (
    <div className="structure-act">
      <SpanRow kind="act" span={act} scenes={scenes}
               onOpen={() => onOpen("act", act.id)}
               onMove={(sceneId) => onMove("act", act.id, sceneId)} />
      {groups.map((group, i) => (
        group.sequence === null
          ? <ol key={`bare:${String(i)}`} className="structure-scenes">
              {group.sceneIds.map((id) => (
                <li key={id}>{sceneLabel(sceneById.get(id))}</li>
              ))}
            </ol>
          : <div key={group.sequence.id} className="structure-seq">
              <SpanRow kind="sequence" span={group.sequence} scenes={scenes}
                       partial={group.continuesFrom ? "continued"
                         : group.continuesInto ? "continues" : null}
                       onOpen={() => onOpen("sequence", group.sequence!.id)}
                       onMove={(sceneId) =>
                         onMove("sequence", group.sequence!.id, sceneId)} />
              <ol className="structure-scenes">
                {group.sceneIds.map((id) => (
                  <li key={id}>{sceneLabel(sceneById.get(id))}</li>
                ))}
              </ol>
            </div>
      ))}
    </div>
  );
}

function SpanRow({ kind, span, scenes, onOpen, onMove, partial = null }: {
  kind: "act" | "sequence";
  span: Span;
  scenes: Row[];
  onOpen: () => void;
  onMove: (sceneId: number | null) => void;
  partial?: "continued" | "continues" | null;
}): JSX.Element {
  const count = span.sceneIds.length;
  return (
    <div className={`structure-span structure-span-${kind}`}>
      <span className="structure-kind">{kind}</span>
      {/* The derived number was computed all along and never rendered,
          so a blank-written project read "unnumbered" everywhere. */}
      {span.number !== null && (
        <span className="structure-number">{span.number}</span>
      )}
      <button className="row-link" onClick={onOpen}>{span.name}</button>
      {partial !== null && (
        <span className="structure-kind"
              title={"Acts and sequences are independent spans; this one " +
                     "crosses an act boundary"}>
          {partial === "continued" ? "…cont" : "cont…"}
        </span>
      )}
      <span className="structure-extent">
        {count === 0
          ? "empty — another span starts on the same scene"
          : `${String(count)} scene${count === 1 ? "" : "s"}`}
      </span>
      <StartHere label="move…" scenes={scenes} onPick={onMove} />
      <button className="ghost tiny" title="Unanchor: the span above
              absorbs these scenes" onClick={() => onMove(null)}>×</button>
    </div>
  );
}

/** Scene picker rendered as a select, so no drag target is needed. */
function StartHere({ label, scenes, onPick }: {
  label: string;
  scenes: Row[];
  onPick: (sceneId: number) => void;
}): JSX.Element {
  return (
    <select className="structure-pick" value=""
            onChange={(e) => {
              if (e.target.value !== "") onPick(Number(e.target.value));
            }}>
      <option value="">{label}</option>
      {scenes.map((s) => (
        <option key={String(s["id"])} value={String(s["id"])}>
          {sceneLabel(s)}
        </option>
      ))}
    </select>
  );
}
