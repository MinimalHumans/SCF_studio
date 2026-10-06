// SPDX-License-Identifier: Apache-2.0
import { useEffect, useState } from "react";
import type { ImportCandidate } from "@scf-core/assetImport.ts";
import { exec, registry, useStore } from "../../state/store.ts";
import {
  attach, confirmIdentity, detach, loadBoard, PURPOSE_HELP, PURPOSE_LABEL,
  PURPOSES, registerFiles, repurpose, setTileRole, SharedSetError,
  withCreatedAssets, type BoardData, type BoardName, type Purpose,
  type Tile,
} from "../../editor/mediaOps.ts";
import type { ChangeUndo } from "../../state/undoChange.ts";
import { addressHandles, beginDrop } from "../../files/dropIntake.ts";
import { pickAssetFiles } from "../../files/assetLocator.ts";
import { AssetThumb } from "../AssetThumb.tsx";
import { useQuery } from "../useQuery.ts";

/** Files waiting for the writer to say what they are for. */
interface Incoming {
  /** New to the project: become asset rows when placed. */
  candidates: ImportCandidate[];
  /** Already assets in the project. */
  assetIds: number[];
  names: string[];
}

const fail = (what: string, e: unknown): void =>
  useStore.setState({ errorMessage: `${what}: ${
    e instanceof Error ? e.message : String(e)}` });

/**
 * A reference board: point at material, say what it is for, and the
 * rows behind it are written for you (mediaOps.ts). Nothing on this
 * board names a bundle, a binding or an anchor.
 */
export function ReferenceBoard({ characterId, board }: {
  characterId: number; board: BoardName;
}): JSX.Element {
  const { revision, projectRoot, rootPermission, attachFolder, regrantRoot,
          openEntityRow } = useStore();
  const [data, setData] = useState<BoardData | null>(null);
  const [incoming, setIncoming] = useState<Incoming | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [filter, setFilter] = useState<Purpose | "all">("all");
  const [dragging, setDragging] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const [shared, setShared] = useState<{ purpose: Purpose; role: string;
                                         names: string[] } | null>(null);
  const labels = PURPOSE_LABEL[board];

  useEffect(() => {
    let cancelled = false;
    void loadBoard(exec, registry, characterId, board).then((d) => {
      if (!cancelled) setData(d);
    }).catch((e: unknown) => fail("Could not read the board", e));
    return () => { cancelled = true; };
  }, [characterId, board, revision]);

  const root = rootPermission === "granted"
    ? projectRoot as FileSystemDirectoryHandle | null : null;

  const done = (change: ChangeUndo): void =>
    useStore.getState().recordChange(change);

  const receive = (candidates: ImportCandidate[], outside: string[],
                   folders: string[]): void => {
    const notes: string[] = [];
    if (outside.length > 0) {
      notes.push(`${outside.join(", ")} ${outside.length === 1 ? "is" : "are"} ` +
        "outside the project folder, so there is no address to point at. " +
        "Move the file into the folder, then drop it again.");
    }
    if (folders.length > 0) {
      notes.push(`Folders are not taken here (${folders.join(", ")}); drop the ` +
                 "files inside them.");
    }
    setNotice(notes.length === 0 ? null : notes.join(" "));
    if (candidates.length > 0) {
      setIncoming({ candidates, assetIds: [],
                    names: candidates.map((c) => c.name ?? c.identifier) });
    }
  };

  const place = async (purpose: Purpose, role: string,
                       shared?: "both" | "split"): Promise<void> => {
    if (incoming === null) return;
    try {
      const { assetIds, created } = await registerFiles(exec, incoming.candidates);
      const ids = [...incoming.assetIds, ...assetIds];
      let change: ChangeUndo;
      try {
        change = await attach(exec, registry, characterId, board, ids, purpose,
                              { role, shared });
      } catch (e) {
        if (e instanceof SharedSetError) {
          // Keep the new asset rows: they are the same files either way.
          setIncoming({ candidates: [], assetIds: ids, names: incoming.names });
          setShared({ purpose, role, names: e.sharedWith });
          if (created.length > 0) useStore.getState().noteWrite();
          return;
        }
        throw e;
      }
      done(withCreatedAssets(change, created));
      setIncoming(null);
      setShared(null);
    } catch (e) {
      fail("Could not add to the board", e);
    }
  };

  const tiles = (data?.tiles ?? []).filter((t) =>
    filter === "all" || t.purpose === filter);
  const counts = new Map<string, number>();
  for (const t of data?.tiles ?? []) {
    counts.set(t.purpose, (counts.get(t.purpose) ?? 0) + 1);
  }

  return (
    <div className="board">
      <div className={"board-drop" + (dragging ? " over" : "") +
                      (root === null ? " closed" : "")}
           onDragOver={(e) => {
             if (root === null) return;
             e.preventDefault();
             e.dataTransfer.dropEffect = "link";
             setDragging(true);
           }}
           onDragLeave={() => setDragging(false)}
           onDrop={(e) => {
             setDragging(false);
             if (root === null) return;
             e.preventDefault();
             const pending = beginDrop(e.dataTransfer);
             void addressHandles(root, pending).then((intake) =>
               receive(intake.candidates, intake.outside, intake.folders))
               .catch((err: unknown) => fail("Could not read the drop", err));
           }}>
        {root === null ? (
          <p>
            {projectRoot === null
              ? "Connect the project folder to drop files here."
              : "The project folder needs reconnecting before files can be dropped."}{" "}
            <button className="ghost tiny"
                    onClick={() => void (projectRoot === null
                      ? attachFolder() : regrantRoot())}>
              {projectRoot === null ? "Connect folder" : "Reconnect folder"}
            </button>
            {" "}Files already in the project can still be added.
          </p>
        ) : (
          <p>
            Drop files from the project folder here, or{" "}
            <button className="ghost tiny" onClick={() => {
              void pickAssetFiles(root).then((picked) => {
                if (picked !== null) receive(picked.candidates, picked.outsideRoot, []);
              }).catch((e: unknown) => fail("Could not pick files", e));
            }}>choose files</button>.
          </p>
        )}
        <button className="ghost tiny" onClick={() => setChoosing((v) => !v)}
                aria-expanded={choosing}>
          Use files already in the project
        </button>
      </div>

      {notice !== null && <p className="board-notice" role="alert">{notice}</p>}

      {choosing && (
        <AssetChooser exclude={new Set((data?.tiles ?? []).map((t) =>
                        Number(t.asset["id"])))}
                      onCancel={() => setChoosing(false)}
                      onChoose={(ids, names) => {
                        setChoosing(false);
                        setIncoming({ candidates: [], assetIds: ids, names });
                      }} />
      )}

      {incoming !== null && shared === null && (
        <PurposeDialog board={board} names={incoming.names}
                       onCancel={() => setIncoming(null)}
                       onChoose={(p, role) => void place(p, role)} />
      )}

      {shared !== null && (
        <div className="board-dialog" role="dialog" aria-label="Shared set">
          <p>
            This {board === "look" ? "look" : "voice"} set is also used by{" "}
            <strong>{shared.names.join(", ")}</strong>. Adding to it changes
            theirs too.
          </p>
          <div className="ws-create-actions">
            <button className="primary"
                    onClick={() => void place(shared.purpose, shared.role, "split")}>
              Give this character their own copy
            </button>
            <button onClick={() => void place(shared.purpose, shared.role, "both")}>
              Add for everyone using it
            </button>
            <button className="ghost" onClick={() => {
              setShared(null); setIncoming(null);
            }}>Cancel</button>
          </div>
        </div>
      )}

      {(data?.tiles.length ?? 0) > 0 && (
        <div className="board-filters" role="group" aria-label="Show">
          {(["all", ...PURPOSES] as const).map((p) => {
            const n = p === "all" ? data?.tiles.length ?? 0 : counts.get(p) ?? 0;
            if (p !== "all" && n === 0) return null;
            return (
              <button key={p} className={"chip" + (filter === p ? " on" : "")}
                      aria-pressed={filter === p} onClick={() => setFilter(p)}>
                {p === "all" ? "All" : labels[p]} {n}
              </button>
            );
          })}
        </div>
      )}

      {data !== null && data.tiles.length === 0 && (
        <p className="muted board-empty">
          Nothing here yet. Start with the one that is most like them.
        </p>
      )}

      <ul className="board-tiles">
        {tiles.map((t) => (
          <BoardTile key={t.key} tile={t} board={board}
                     characterId={characterId} onChange={done}
                     onOpen={() => void openEntityRow("asset",
                       Number(t.asset["id"]))} />
        ))}
      </ul>

      {data !== null && data.exceptions.length > 0 && (
        <div className="board-exceptions">
          <h4>Exceptions</h4>
          <p className="ws-section-note">
            Where something other than the baseline applies. Editing these
            here comes next; for now they open in the record editor.
          </p>
          <ul className="ws-records">
            {data.exceptions.map((x) => (
              <li key={x.bindingId}>
                <button className="row-link" onClick={() => void openEntityRow(
                  "character_asset_binding", x.bindingId)}>
                  <strong>{x.when}</strong>: {x.bundleName} —{" "}
                  {x.replaces ? "replaces" : "adds to"} the baseline
                  {" "}({x.assets} file{x.assets === 1 ? "" : "s"})
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {data !== null && data.sets.some((s) => s.sharedWith.length > 0) && (
        <p className="muted board-sets">
          {data.sets.filter((s) => s.sharedWith.length > 0).map((s) =>
            `“${s.name}” is shared with ${s.sharedWith.join(", ")}.`).join(" ")}
        </p>
      )}
    </div>
  );
}

function BoardTile({ tile, board, characterId, onChange, onOpen }: {
  tile: Tile; board: BoardName; characterId: number;
  onChange: (c: ChangeUndo) => void; onOpen: () => void;
}): JSX.Element {
  const [role, setRole] = useState(tile.role ?? "");
  useEffect(() => { setRole(tile.role ?? ""); }, [tile.role]);
  const identifier = tile.asset["identifier"];
  const name = String(tile.asset["name"] ?? identifier ?? "file");
  const run = (p: Promise<ChangeUndo>, what: string): void => {
    p.then(onChange).catch((e: unknown) => fail(what, e));
  };
  const primary = tile.purpose === "identity" && tile.status === "verified" &&
    tile.variant === null;

  return (
    <li className={"board-tile" + (primary ? " primary" : "")}>
      <div className="board-thumb">
        <AssetThumb identifier={typeof identifier === "string" ? identifier : null}
                    size="lg" alt={name} onClick={onOpen} />
        {primary && <span className="board-star" title="Their face">★</span>}
      </div>
      <div className="board-tile-meta">
        <span className="board-tile-name" title={String(identifier ?? "")}>{name}</span>
        {tile.variant !== null && (
          <span className="ws-chip ws-chip-variant">{tile.variant}</span>
        )}
        <label className="visually-hidden" htmlFor={`p-${tile.key}`}>
          What {name} is for
        </label>
        <select id={`p-${tile.key}`} value={tile.purpose}
                disabled={tile.variant !== null}
                title={tile.variant !== null
                  ? "A variant's reference: edit it in Schema for now" : undefined}
                onChange={(e) => {
                  const next = e.target.value as Purpose;
                  run(repurpose(exec, registry, characterId, board, tile, next),
                      "Could not change what it is for");
                }}>
          {tile.purpose === "other" && <option value="other">{tile.label}</option>}
          {PURPOSES.map((p) => (
            <option key={p} value={p}>{PURPOSE_LABEL[board][p]}</option>
          ))}
        </select>
        {tile.purpose === "set" && (
          <input aria-label={`Role of ${name}`} value={role}
                 placeholder="front, side, turnaround…"
                 onChange={(e) => setRole(e.target.value)}
                 onBlur={() => {
                   if (role.trim() === (tile.role ?? "")) return;
                   run(setTileRole(exec, tile.link.id, role), "Could not set the role");
                 }}
                 onKeyDown={(e) => {
                   if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                 }} />
        )}
        {tile.purpose === "identity" && tile.status !== "verified" && (
          <button className="tiny" title="Proposed, not yet confirmed. Tools ignore it until it is."
                  onClick={() => run(confirmIdentity(exec, tile.link.id),
                                     "Could not confirm")}>
            Confirm ({tile.status ?? "unconfirmed"})
          </button>
        )}
        <div className="ws-row-actions">
          <button className="ghost tiny" onClick={onOpen}>Show in Assets</button>
          <button className="ghost tiny"
                  onClick={() => run(detach(exec, tile), "Could not remove")}>
            Remove
          </button>
        </div>
      </div>
    </li>
  );
}

function PurposeDialog({ board, names, onChoose, onCancel }: {
  board: BoardName; names: string[];
  onChoose: (p: Purpose, role: string) => void; onCancel: () => void;
}): JSX.Element {
  const [role, setRole] = useState("");
  const n = names.length;
  return (
    <div className="board-dialog" role="dialog"
         aria-label="What are these files for?">
      <p>
        What {n === 1 ? <>is <strong>{names[0]}</strong></> :
          <>are these <strong>{n} files</strong></>} for?
      </p>
      <div className="board-purposes">
        {PURPOSES.map((p) => (
          <button key={p} className="board-purpose"
                  onClick={() => onChoose(p, role)}>
            <strong>{PURPOSE_LABEL[board][p]}</strong>
            <span>{PURPOSE_HELP[board][p]}</span>
          </button>
        ))}
      </div>
      <div className="ws-add-row">
        <input aria-label="Role, for a look or voice reference" value={role}
               placeholder={board === "look"
                 ? "Optional: what it shows — front, side, model sheet"
                 : "Optional: what it is — calm, shouting, whispered"}
               onChange={(e) => setRole(e.target.value)} />
        <button className="ghost" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

/** Pick assets already in the project, by name or path. */
function AssetChooser({ exclude, onChoose, onCancel }: {
  exclude: Set<number>;
  onChoose: (ids: number[], names: string[]) => void;
  onCancel: () => void;
}): JSX.Element {
  const [needle, setNeedle] = useState("");
  const [picked, setPicked] = useState<Map<number, string>>(new Map());
  const like = `%${needle.trim()}%`;
  const rows = useQuery(
    "SELECT id, name, identifier FROM asset WHERE " +
    "(name LIKE ? OR identifier LIKE ?) AND " +
    "(lifecycle_status IS NULL OR lifecycle_status <> 'cut') " +
    "ORDER BY name LIMIT 60", [like, like]);
  return (
    <div className="board-dialog board-chooser" role="dialog"
         aria-label="Files already in the project">
      <input type="search" autoFocus placeholder="Find by name or path"
             aria-label="Find a file" value={needle}
             onChange={(e) => setNeedle(e.target.value)} />
      <ul>
        {rows.filter((r) => !exclude.has(Number(r["id"]))).map((r) => {
          const id = Number(r["id"]);
          const name = String(r["name"] ?? r["identifier"]);
          return (
            <li key={id}>
              <label>
                <input type="checkbox" checked={picked.has(id)}
                       onChange={(e) => {
                         const next = new Map(picked);
                         if (e.target.checked) next.set(id, name); else next.delete(id);
                         setPicked(next);
                       }} />
                <span>{name}</span>
                <span className="muted mono">{String(r["identifier"] ?? "")}</span>
              </label>
            </li>
          );
        })}
      </ul>
      <div className="ws-create-actions">
        <button className="primary" disabled={picked.size === 0}
                onClick={() => onChoose([...picked.keys()], [...picked.values()])}>
          Add {picked.size === 0 ? "" : picked.size}
        </button>
        <button className="ghost" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
