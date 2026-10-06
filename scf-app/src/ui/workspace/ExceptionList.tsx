// SPDX-License-Identifier: Apache-2.0
import { useEffect, useState } from "react";
import { exec, registry, useStore } from "../../state/store.ts";
import {
  addException, moveException, removeException, updateException,
  type BoardName, type Exception, type Owner, type When,
} from "../../editor/mediaOps.ts";
import type { ChangeUndo } from "../../state/undoChange.ts";
import { useQuery } from "../useQuery.ts";
import {
  BoardTile, fail, FileIntake, placeFiles, type InForce,
} from "./BoardParts.tsx";
import { useStoryScenes } from "./StoryStrip.tsx";

type Kind = When["kind"];

/** Read a stored exception back as one condition, if it is one. */
function whenOf(x: Exception): When | "several" | null {
  const f = x.filters;
  const set = (c: string): boolean =>
    f[c] !== null && f[c] !== undefined && f[c] !== "";
  const kinds: When[] = [];
  if (set("variant_id")) {
    kinds.push({ kind: "variant", variantId: Number(f["variant_id"]) });
  }
  if (set("physical_state_filter")) {
    kinds.push({ kind: "physical", state: String(f["physical_state_filter"]) });
  }
  if (set("vocal_state_filter")) {
    kinds.push({ kind: "vocal", state: String(f["vocal_state_filter"]) });
  }
  if (set("scene_range_start_id") || set("scene_range_end_id")) {
    kinds.push({
      kind: "scenes",
      startId: set("scene_range_start_id")
        ? Number(f["scene_range_start_id"]) : null,
      endId: set("scene_range_end_id") ? Number(f["scene_range_end_id"]) : null,
    });
  }
  if (kinds.length > 1) return "several";
  return kinds[0] ?? null;
}

const KIND_LABEL: Record<Kind, string> = {
  scenes: "In certain scenes",
  physical: "While in a physical state",
  vocal: "While in a vocal state",
  variant: "As a variant",
};

/**
 * Exceptions: where something other than the baseline applies. Listed in
 * the order they win, highest first — the order IS the precedence, and
 * moving a card renumbers it. Each says, in plain words, when it
 * applies, and whether it adds to the baseline or replaces it.
 */
export function ExceptionList({ owner, board, exceptions, inForce, asOf }: {
  owner: Owner; board: BoardName; exceptions: Exception[];
  inForce: InForce | null; asOf: number | null;
}): JSX.Element {
  const [adding, setAdding] = useState(false);
  const done = (c: ChangeUndo): void => useStore.getState().recordChange(c);
  const run = (p: Promise<ChangeUndo>, what: string): void => {
    p.then(done).catch((e: unknown) => fail(what, e));
  };

  return (
    <div className="board-exceptions">
      <div className="strip-head">
        <h4>Exceptions</h4>
        {!adding && (
          <button className="ghost tiny" onClick={() => setAdding(true)}>
            Add an exception
          </button>
        )}
      </div>
      <p className="ws-section-note">
        {exceptions.length === 0
          ? "Where something other than the baseline should apply — a " +
            "scene, a state, a variant."
          : "Highest wins. Where two apply at once, the one above wins, " +
            "and one that replaces hides everything below it."}
      </p>

      {adding && (
        <NewException owner={owner}
                      onCancel={() => setAdding(false)}
                      onAdd={(when, replaces) => {
                        addException(exec, registry, owner, board, when, replaces)
                          .then(({ change }) => { done(change); setAdding(false); })
                          .catch((e: unknown) => fail("Could not add the exception", e));
                      }} />
      )}

      <ol className="exc-list">
        {exceptions.map((x, i) => {
          const applies = inForce?.bindings.get(x.bindingId);
          return (
            <li key={x.bindingId} className={"ws-card exc-card" +
                                             (applies === false ? " dim" : "")}>
              <div className="exc-head">
                <strong className="exc-when">{x.when}</strong>
                {asOf !== null && applies !== undefined && (
                  <span className={"ws-chip" + (applies ? " exc-live" : "")}>
                    {applies ? "in force here" : "not here"}
                  </span>
                )}
                <div className="ws-row-actions">
                  <button className="ghost tiny" disabled={i === 0}
                          aria-label="Move up: wins over more"
                          onClick={() => run(moveException(exec, registry, owner,
                            board, x.bindingId, "up"), "Could not move it")}>
                    ↑
                  </button>
                  <button className="ghost tiny"
                          disabled={i === exceptions.length - 1}
                          aria-label="Move down"
                          onClick={() => run(moveException(exec, registry, owner,
                            board, x.bindingId, "down"), "Could not move it")}>
                    ↓
                  </button>
                </div>
              </div>
              {x.stale.length > 0 && (
                <p className="ws-field-error">
                  No state of this character is called “{x.stale.join("”, “")}”,
                  so this never applies. Was the state renamed? Pick it again
                  below.
                </p>
              )}
              <ExceptionEditor owner={owner} exception={x} onChange={run} />
              <ul className="board-tiles exc-tiles">
                {x.tiles.map((t) => (
                  <BoardTile key={t.key} tile={t} board={board} owner={owner}
                             purposes={["set"]} live={null} onChange={done}
                             onOpen={() => void useStore.getState()
                               .openEntityRow("asset", Number(t.asset["id"]))} />
                ))}
              </ul>
              <FileIntake compact
                          exclude={new Set(x.tiles.map((t) => Number(t.asset["id"])))}
                          onFiles={(incoming) => {
                            placeFiles(incoming, owner, board, "set",
                                       { bundleId: x.bundleId })
                              .then(done)
                              .catch((e: unknown) => fail("Could not add the files", e));
                          }} />
              <div className="ws-row-actions">
                <button className="ghost tiny" onClick={() => void useStore
                  .getState().openEntityRow(`${owner.kind}_asset_binding`,
                                            x.bindingId)}>
                  Open record
                </button>
                <button className="ghost tiny" onClick={() => run(
                  removeException(exec, registry, owner, x.bindingId),
                  "Could not remove it")}>
                  Remove exception
                </button>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function ExceptionEditor({ owner, exception, onChange }: {
  owner: Owner; exception: Exception;
  onChange: (p: Promise<ChangeUndo>, what: string) => void;
}): JSX.Element {
  const when = whenOf(exception);
  const set = (patch: { when?: When; replaces?: boolean }): void =>
    onChange(updateException(exec, registry, owner, exception.bindingId, patch),
             "Could not change the exception");
  return (
    <div className="exc-editor">
      {when === "several" ? (
        <p className="muted">
          This one has several conditions at once. Edit it in the record
          editor.
        </p>
      ) : (
        <WhenPicker owner={owner} value={when}
                    onChange={(w) => set({ when: w })} />
      )}
      <fieldset className="rel-direction">
        <legend>With the baseline</legend>
        {([[false, "Adds to it"], [true, "Replaces it"]] as const).map(
          ([v, text]) => (
            <label key={text} className={exception.replaces === v ? "on" : ""}>
              <input type="radio" name={`exc-${String(exception.bindingId)}`}
                     checked={exception.replaces === v}
                     onChange={() => set({ replaces: v })} />
              {text}
            </label>
          ))}
      </fieldset>
    </div>
  );
}

function NewException({ owner, onAdd, onCancel }: {
  owner: Owner;
  onAdd: (when: When, replaces: boolean) => void;
  onCancel: () => void;
}): JSX.Element {
  const [when, setWhen] = useState<When | null>(null);
  const [replaces, setReplaces] = useState(false);
  return (
    <div className="board-dialog" role="dialog" aria-label="New exception">
      <WhenPicker owner={owner} value={when} onChange={setWhen} draft />
      <label className="strip-toggle exc-replaces">
        <input type="checkbox" checked={replaces}
               onChange={(e) => setReplaces(e.target.checked)} />
        Replaces the baseline there, instead of adding to it
      </label>
      <div className="ws-create-actions">
        <button className="primary" disabled={when === null}
                onClick={() => { if (when !== null) onAdd(when, replaces); }}>
          Add exception
        </button>
        <button className="ghost" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

/**
 * Choose a condition from what the story actually has: its scenes, this
 * character's named states and variants. Choosing from the list rather
 * than typing is what keeps a state filter matching a state — Q13
 * matches the state's name.
 */
function WhenPicker({ owner, value, onChange, draft = false }: {
  owner: Owner; value: When | null; onChange: (w: When) => void;
  draft?: boolean;
}): JSX.Element {
  const scenes = useStoryScenes();
  const character = owner.kind === "character";
  const states = useQuery(character
    ? "SELECT DISTINCT name, modality FROM performance_state " +
      "WHERE character_id = ? AND name IS NOT NULL AND name <> '' ORDER BY name"
    : null, [owner.id]);
  const variants = useQuery(character
    ? "SELECT id, name FROM character_variant WHERE character_id = ? " +
      "AND (lifecycle_status IS NULL OR lifecycle_status <> 'cut') ORDER BY id"
    : null, [owner.id]);
  const kinds: Kind[] = character
    ? ["scenes", "physical", "vocal", "variant"] : ["scenes"];
  const [kind, setKind] = useState<Kind>(value?.kind ?? "scenes");
  useEffect(() => { if (value !== null) setKind(value.kind); }, [value]);

  const emit = (w: When | null): void => { if (w !== null) onChange(w); };
  const scenesValue = value?.kind === "scenes" ? value
    : { kind: "scenes" as const, startId: null, endId: null };
  const sceneSelect = (label: string, current: number | null,
                       pick: (id: number | null) => void): JSX.Element => (
    <label className="exc-pick">
      <span>{label}</span>
      <select value={current === null ? "" : String(current)}
              onChange={(e) => pick(e.target.value === "" ? null
                                    : Number(e.target.value))}>
        <option value="">—</option>
        {scenes.map((s) => (
          <option key={s.id} value={s.id}>sc {s.number} — {s.name}</option>
        ))}
      </select>
    </label>
  );
  const modalityStates = (m: string): string[] =>
    states.filter((s) => s["modality"] === m).map((s) => String(s["name"]));

  return (
    <div className="exc-when-picker">
      <label className="exc-pick">
        <span>Applies</span>
        <select value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
          {kinds.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
        </select>
      </label>
      {kind === "scenes" && (
        <>
          {sceneSelect("From", scenesValue.startId, (id) => {
            if (id !== null || scenesValue.endId !== null) {
              emit({ ...scenesValue, startId: id });
            }
          })}
          {sceneSelect("Until", scenesValue.endId, (id) => {
            if (id !== null || scenesValue.startId !== null) {
              emit({ ...scenesValue, endId: id });
            }
          })}
        </>
      )}
      {(kind === "physical" || kind === "vocal") && (
        modalityStates(kind).length === 0 ? (
          <span className="muted">
            This character has no {kind} states yet — add one under{" "}
            {kind === "vocal" ? "Voice" : "Physicality"}, Shifts.
          </span>
        ) : (
          <label className="exc-pick">
            <span>State</span>
            <select value={value?.kind === kind ? value.state : ""}
                    onChange={(e) => {
                      if (e.target.value !== "") {
                        emit({ kind, state: e.target.value });
                      }
                    }}>
              <option value="">{draft ? "Pick a state" : "—"}</option>
              {modalityStates(kind).map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </label>
        )
      )}
      {kind === "variant" && (
        variants.length === 0 ? (
          <span className="muted">
            No variants yet — add one on Profile, Variants.
          </span>
        ) : (
          <label className="exc-pick">
            <span>Variant</span>
            <select value={value?.kind === "variant" ? String(value.variantId) : ""}
                    onChange={(e) => {
                      if (e.target.value !== "") {
                        emit({ kind: "variant", variantId: Number(e.target.value) });
                      }
                    }}>
              <option value="">{draft ? "Pick a variant" : "—"}</option>
              {variants.map((v) => (
                <option key={String(v["id"])} value={String(v["id"])}>
                  {String(v["name"])}
                </option>
              ))}
            </select>
          </label>
        )
      )}
    </div>
  );
}
