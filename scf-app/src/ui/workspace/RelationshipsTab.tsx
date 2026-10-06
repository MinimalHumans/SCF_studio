// SPDX-License-Identifier: Apache-2.0
import { useEffect, useRef, useState } from "react";
import type { Row } from "@scf-core/db.ts";
import { exec, registry, useStore } from "../../state/store.ts";
import {
  cleanName, createCharacter, fromPointOfView, relate, setDirection,
} from "../../editor/elementOps.ts";
import { RELATIONSHIP_SECTIONS } from "../../state/characterLayout.ts";
import { useQuery } from "../useQuery.ts";
import { AutoField } from "./AutoField.tsx";
import { initials } from "./CharacterFace.tsx";
import { StoryStrip, useStoryScenes, type Lane } from "./StoryStrip.tsx";
import {
  AddStageForm, StageEditor, usePresenceLane, type PendingStage,
} from "./StageParts.tsx";

const NOT_CUT = "(lifecycle_status IS NULL OR lifecycle_status <> 'cut')";

const short = (t: string): string =>
  t.length > 32 ? `${t.slice(0, 31)}…` : t;

/** What an edge says about a relationship, shortest first. */
function edgeLabel(r: Row): string {
  for (const k of ["specific_relationship", "relationship_type"]) {
    const v = r[k];
    if (typeof v === "string" && v.trim() !== "") return v;
  }
  return "related";
}

export function RelationshipsTab({ characterId }: { characterId: number }):
    JSX.Element {
  const { deleteRow, openEntityRow } = useStore();
  const characters = useQuery(
    `SELECT id, name FROM character WHERE ${NOT_CUT} ORDER BY name`);
  const rels = useQuery(
    "SELECT * FROM character_relationship WHERE " +
    `(character_a_id = ? OR character_b_id = ?) AND ${NOT_CUT} ORDER BY id`,
    [characterId, characterId]);
  const [selected, setSelected] = useState<number | null>(null);
  // A relationship just made is selected before the list re-reads; until
  // it shows up there, the selection is not "invalid", only early.
  const justMade = useRef<number | null>(null);

  // Keep a valid selection: the first relationship, until one is picked.
  useEffect(() => {
    if (selected !== null && rels.some((r) => Number(r["id"]) === selected)) {
      if (justMade.current === selected) justMade.current = null;
      return;
    }
    if (selected !== null && justMade.current === selected) return;
    const first = rels[0];
    setSelected(first === undefined ? null : Number(first["id"]));
  }, [rels, selected]);

  const nameOf = (id: number): string =>
    String(characters.find((c) => Number(c["id"]) === id)?.["name"] ?? "?");
  const me = nameOf(characterId);
  const relatedIds = new Set(rels.map((r) =>
    fromPointOfView(r, characterId).otherId));

  const doRelate = (otherId: number): void => {
    relate(exec, characterId, otherId).then(({ id }) => {
      justMade.current = id;
      setSelected(id);
      useStore.getState().noteWrite();
    }).catch((e: unknown) => useStore.setState({
      errorMessage: `Could not relate them: ${
        e instanceof Error ? e.message : String(e)}` }));
  };

  const current = rels.find((r) => Number(r["id"]) === selected);

  return (
    <div className="ws-page">
      <section className="ws-section" aria-labelledby="ws-s-map">
        <h3 id="ws-s-map">Who {me} is tied to</h3>
        <p className="ws-section-note">
          Click a line or a name to open that relationship. A faint name
          has no relationship with {me} yet — click it to make one.
        </p>
        <RelationshipMap viewerId={characterId} viewerName={me}
                         characters={characters} rels={rels}
                         selected={selected} onSelect={setSelected}
                         onRelate={doRelate} />
        <AddRelationship characters={characters} viewerId={characterId}
                         related={relatedIds} onRelate={doRelate} />
      </section>

      {current !== undefined && (
        <RelationshipEditor key={Number(current["id"])} row={current}
                            viewerId={characterId} nameOf={nameOf}
                            onOpen={() => void openEntityRow(
                              "character_relationship", Number(current["id"]))}
                            onRemove={() => void deleteRow(
                              "character_relationship", Number(current["id"]))} />
      )}
    </div>
  );
}

/**
 * The selected character in the middle, everyone else around them. A
 * relationship is a line labelled with what they are to each other,
 * drawn by valence — colour AND line style, so it reads without colour —
 * with an arrowhead where it runs one way.
 */
function RelationshipMap({ viewerId, viewerName, characters, rels,
                           selected, onSelect, onRelate }: {
  viewerId: number; viewerName: string; characters: Row[]; rels: Row[];
  selected: number | null; onSelect: (id: number) => void;
  onRelate: (otherId: number) => void;
}): JSX.Element {
  const others = characters.filter((c) => Number(c["id"]) !== viewerId);
  const W = 640, H = 320, cx = W / 2, cy = H / 2, rx = 230, ry = 100;
  const pos = new Map(others.map((c, i) => {
    const t = -Math.PI / 2 + (2 * Math.PI * i) / Math.max(others.length, 1);
    return [Number(c["id"]), { x: cx + rx * Math.cos(t), y: cy + ry * Math.sin(t) }];
  }));
  const relFor = new Map(rels.map((r) =>
    [fromPointOfView(r, viewerId).otherId, r]));

  if (others.length === 0) {
    return <p className="muted">There is nobody else in the story yet to relate {viewerName} to.</p>;
  }

  return (
    <svg className="rel-map" viewBox={`0 0 ${String(W)} ${String(H)}`}
         role="group" aria-label={`Relationships of ${viewerName}`}>
      <defs>
        {["positive", "negative", "complex", "neutral", "none"].map((v) => (
          <marker key={v} id={`rel-arrow-${v}`} viewBox="0 0 10 10" refX="9"
                  refY="5" markerWidth="7" markerHeight="7"
                  orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" className={`rel-arrow rel-v-${v}`} />
          </marker>
        ))}
      </defs>
      {others.map((c) => {
        const id = Number(c["id"]);
        const r = relFor.get(id);
        const p = pos.get(id);
        if (r === undefined || p === undefined) return null;
        const relId = Number(r["id"]);
        const { direction } = fromPointOfView(r, viewerId);
        const valence = typeof r["emotional_valence"] === "string"
          ? r["emotional_valence"] : "none";
        // Stop short of the circles so arrowheads are visible.
        const dx = p.x - cx, dy = p.y - cy;
        const len = Math.hypot(dx, dy) || 1;
        const x1 = cx + (dx / len) * 34, y1 = cy + (dy / len) * 34;
        const x2 = p.x - (dx / len) * 22, y2 = p.y - (dy / len) * 22;
        const arrow = `url(#rel-arrow-${valence})`;
        const isSel = relId === selected;
        const label = edgeLabel(r);
        return (
          <g key={relId} className={"rel-edge" + (isSel ? " selected" : "")}
             role="button" tabIndex={0}
             aria-label={`${label}, ${valence === "none" ? "" : valence}` +
                         `${direction === "mutual" ? ", mutual" : ""}`}
             onClick={() => onSelect(relId)}
             onKeyDown={(e) => {
               if (e.key === "Enter" || e.key === " ") onSelect(relId);
             }}>
            <line x1={x1} y1={y1} x2={x2} y2={y2} className="rel-hit" />
            <line x1={x1} y1={y1} x2={x2} y2={y2}
                  className={`rel-line rel-v-${valence}`}
                  markerEnd={direction === "from" ? arrow : undefined}
                  markerStart={direction === "to" ? arrow : undefined} />
          </g>
        );
      })}
      <g className="rel-node rel-node-viewer">
        <circle cx={cx} cy={cy} r={32} />
        <text x={cx} y={cy + 5} textAnchor="middle">{initials(viewerName)}</text>
      </g>
      {others.map((c) => {
        const id = Number(c["id"]);
        const p = pos.get(id);
        if (p === undefined) return null;
        const r = relFor.get(id);
        const name = String(c["name"] ?? "");
        const act = (): void => {
          if (r !== undefined) onSelect(Number(r["id"]));
          else onRelate(id);
        };
        const below = p.y >= cy;
        return (
          <g key={id} role="button" tabIndex={0}
             className={"rel-node" + (r === undefined ? " unrelated" : "") +
                        (r !== undefined && Number(r["id"]) === selected
                          ? " selected" : "")}
             aria-label={r === undefined
               ? `Relate ${viewerName} to ${name}` : name}
             onClick={act}
             onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") act(); }}>
            <title>{r === undefined ? `Relate ${viewerName} to ${name}` : name}</title>
            <circle cx={p.x} cy={p.y} r={20} />
            <text x={p.x} y={p.y + 4} textAnchor="middle">{initials(name)}</text>
            {/* The label sits on the far side of the node from the
                centre, so it never crosses a line. */}
            <text x={p.x} y={below ? p.y + 36 : p.y - 42} textAnchor="middle"
                  className="rel-node-name">{name}</text>
            {r !== undefined && (
              <text x={p.x} y={below ? p.y + 51 : p.y - 28}
                    textAnchor="middle" className="rel-edge-label">
                {short(edgeLabel(r))}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

/** Relate to someone in the list, or to a character made on the spot. */
function AddRelationship({ characters, viewerId, related, onRelate }: {
  characters: Row[]; viewerId: number; related: Set<number>;
  onRelate: (otherId: number) => void;
}): JSX.Element {
  const [choice, setChoice] = useState("");
  const [newName, setNewName] = useState("");
  const candidates = characters.filter((c) =>
    Number(c["id"]) !== viewerId && !related.has(Number(c["id"])));
  return (
    <form className="ws-add-row"
          onSubmit={(e) => {
            e.preventDefault();
            if (choice === "new") {
              const name = cleanName(newName);
              if (name === null) return;
              createCharacter(exec, name).then((id) => {
                setNewName(""); setChoice("");
                onRelate(id);
              }).catch((err: unknown) => useStore.setState({
                errorMessage: `Could not create the character: ${
                  err instanceof Error ? err.message : String(err)}` }));
              return;
            }
            if (choice !== "") { onRelate(Number(choice)); setChoice(""); }
          }}>
      <label htmlFor="ws-add-rel" className="visually-hidden">Relate to</label>
      <select id="ws-add-rel" value={choice}
              onChange={(e) => setChoice(e.target.value)}>
        <option value="">Relate to…</option>
        {candidates.map((c) => (
          <option key={String(c["id"])} value={String(c["id"])}>
            {String(c["name"])}
          </option>
        ))}
        <option value="new">A new character…</option>
      </select>
      {choice === "new" && (
        <input aria-label="New character's name" autoFocus value={newName}
               placeholder="Their name"
               onChange={(e) => setNewName(e.target.value)} />
      )}
      <button type="submit"
              disabled={choice === "" ||
                        (choice === "new" && cleanName(newName) === null)}>
        Add relationship
      </button>
    </form>
  );
}

function RelationshipEditor({ row, viewerId, nameOf, onOpen, onRemove }: {
  row: Row; viewerId: number; nameOf: (id: number) => string;
  onOpen: () => void; onRemove: () => void;
}): JSX.Element {
  const id = Number(row["id"]);
  const { otherId, direction } = fromPointOfView(row, viewerId);
  const me = nameOf(viewerId);
  const other = nameOf(otherId);
  const scenes = useStoryScenes();
  const stages = useQuery(
    "SELECT id, scene_id, stage_label, name FROM relationship_state " +
    `WHERE character_relationship_id = ? AND ${NOT_CUT}`, [id]);
  const [pending, setPending] = useState<PendingStage | null>(null);
  const [selectedStage, setSelectedStage] = useState<number | null>(null);
  const mine = usePresenceLane(viewerId, `${me} in the scene`);
  const theirs = usePresenceLane(otherId, `${other} in the scene`);
  const exists = (f: string): boolean =>
    registry.entities.get("character_relationship")?.fields
      .some((d) => d.name === f) ?? false;

  const point = (d: "mutual" | number): void => {
    setDirection(exec, id, d === "mutual" ? "mutual" : { fromId: d })
      .then(() => useStore.getState().noteWrite())
      .catch((e: unknown) => useStore.setState({
        errorMessage: `Could not change the direction: ${
          e instanceof Error ? e.message : String(e)}` }));
  };

  const lane: Lane = {
    kind: "stages", key: `rel-${String(id)}`, label: "Stages",
    stages: stages.map((s) => ({
      id: Number(s["id"]),
      sceneId: s["scene_id"] === null ? null : Number(s["scene_id"]),
      label: String(s["stage_label"] ?? s["name"] ?? "stage"),
    })),
    onAddAt: (sceneId) => {
      setSelectedStage(null);
      setPending({ table: "relationship_state", parentId: id, sceneId,
                   laneLabel: `${me} and ${other}` });
    },
    onSelect: (s) => { setPending(null); setSelectedStage(s); },
  };

  return (
    <>
      <section className="ws-section rel-editor" aria-labelledby="ws-s-rel">
        <div className="strip-head">
          <h3 id="ws-s-rel">{me} and {other}</h3>
          <div className="ws-row-actions">
            <button className="ghost tiny" onClick={onOpen}>Open record</button>
            <button className="ghost tiny" onClick={onRemove}>
              Remove relationship
            </button>
          </div>
        </div>
        <fieldset className="rel-direction">
          <legend>Which way it runs</legend>
          {([["mutual", "Both ways"], [viewerId, `${me} → ${other}`],
             [otherId, `${other} → ${me}`]] as const).map(([value, text]) => {
            const on = value === "mutual" ? direction === "mutual"
              : value === viewerId ? direction === "from" : direction === "to";
            return (
              <label key={String(value)} className={on ? "on" : ""}>
                <input type="radio" name={`rel-dir-${String(id)}`}
                       checked={on} onChange={() => point(value)} />
                {text}
              </label>
            );
          })}
        </fieldset>
        {RELATIONSHIP_SECTIONS.slice(0, 1).map((s, i) => (
          <div key={i} className="rel-group">
            {s.title !== "" && <h4>{s.title}</h4>}
            <div className={s.grid === true ? "ws-grid" : "ws-stack"}>
              {s.fields.filter(exists).map((f) => (
                <AutoField key={f} entity="character_relationship" id={id}
                           field={f} value={row[f] ?? null} showHelp={false} />
              ))}
            </div>
          </div>
        ))}
      </section>

      <section className="ws-section" aria-labelledby="ws-s-relstages">
        <h3 id="ws-s-relstages">How it changes</h3>
        <p className="ws-section-note">
          Click a scene in the Stages row to start a stage there. The rows
          below show where each of them appears.
        </p>
        <StoryStrip scenes={scenes} lanes={[lane, mine, theirs]}
                    selectedStage={selectedStage}
                    caption={`${me} and ${other} across the scenes`} />
        {pending !== null && (
          <AddStageForm pending={pending} scenes={scenes}
                        onCancel={() => setPending(null)}
                        onDone={(s) => { setPending(null); setSelectedStage(s); }} />
        )}
        {selectedStage !== null &&
         stages.some((s) => Number(s["id"]) === selectedStage) && (
          <StageEditor table="relationship_state" id={selectedStage}
                       onRemoved={() => setSelectedStage(null)} />
        )}
      </section>

      <section className="ws-section" aria-label="Relationship details">
        {RELATIONSHIP_SECTIONS.slice(1).map((s, i) => (
          <div key={i} className="rel-group">
            {s.title !== "" && <h4>{s.title}</h4>}
            <div className={s.grid === true ? "ws-grid" : "ws-stack"}>
              {s.fields.filter(exists).map((f) => (
                <AutoField key={f} entity="character_relationship" id={id}
                           field={f} value={row[f] ?? null} showHelp={false} />
              ))}
            </div>
          </div>
        ))}
      </section>
    </>
  );
}
