// SPDX-License-Identifier: Apache-2.0
import { useEffect, useState } from "react";
import { exec, registry, useStore } from "../../state/store.ts";
import {
  loadBoard, purposeHelp, purposeLabel, purposesFor, SharedSetError,
  type BoardData, type BoardName, type Owner, type Purpose, type Tile,
} from "../../editor/mediaOps.ts";
import type { ChangeUndo } from "../../state/undoChange.ts";
import { ExceptionList } from "./ExceptionList.tsx";
import {
  BoardTile, fail, FileIntake, placeFiles, useInForce, type Incoming,
} from "./BoardParts.tsx";

/**
 * A reference board: point at material, say what it is for, and the
 * rows behind it are written for you (mediaOps.ts). Nothing on this
 * board names a bundle, a binding or an anchor.
 */
export function ReferenceBoard({ owner, board }: {
  owner: Owner; board: BoardName;
}): JSX.Element {
  const { revision, asOfSceneId, openEntityRow } = useStore();
  const [data, setData] = useState<BoardData | null>(null);
  const [incoming, setIncoming] = useState<Incoming | null>(null);
  const [shared, setShared] = useState<{ purpose: Purpose; role: string;
                                         names: string[] } | null>(null);
  const [filter, setFilter] = useState<Purpose | "all">("all");
  const inForce = useInForce(owner, board);
  const purposes = purposesFor(owner, board);
  const label = (p: Purpose): string => purposeLabel(owner.kind, board, p);

  useEffect(() => {
    let cancelled = false;
    void loadBoard(exec, registry, owner, board).then((d) => {
      if (!cancelled) setData(d);
    }).catch((e: unknown) => fail("Could not read the board", e));
    return () => { cancelled = true; };
  }, [owner.kind, owner.id, board, revision]);

  const done = (change: ChangeUndo): void =>
    useStore.getState().recordChange(change);

  const place = async (purpose: Purpose, role: string,
                       sharedChoice?: "both" | "split"): Promise<void> => {
    if (incoming === null) return;
    try {
      done(await placeFiles(incoming, owner, board, purpose,
                            { role, shared: sharedChoice }));
      setIncoming(null);
      setShared(null);
    } catch (e) {
      if (e instanceof SharedSetError) {
        const ids = (e as SharedSetError & { assetIds: number[] }).assetIds;
        setIncoming({ candidates: [], assetIds: ids, names: incoming.names });
        setShared({ purpose, role, names: e.sharedWith });
        useStore.getState().noteWrite();
        return;
      }
      fail("Could not add to the board", e);
    }
  };

  const tiles = (data?.tiles ?? []).filter((t) =>
    filter === "all" || t.purpose === filter);
  const counts = new Map<string, number>();
  for (const t of data?.tiles ?? []) {
    counts.set(t.purpose, (counts.get(t.purpose) ?? 0) + 1);
  }
  const live = (t: Tile): boolean | null => {
    if (inForce === null) return null;
    if (t.purpose === "identity") return inForce.anchorIds.has(t.link.id);
    if (t.purpose === "set") return inForce.assetIds.has(Number(t.asset["id"]));
    return null;
  };

  return (
    <div className="board">
      <FileIntake onFiles={setIncoming}
                  exclude={new Set((data?.tiles ?? []).map((t) =>
                    Number(t.asset["id"])))} />

      {incoming !== null && shared === null && (
        <PurposeDialog board={board} kind={owner.kind} names={incoming.names}
                       purposes={purposes}
                       onCancel={() => setIncoming(null)}
                       onChoose={(p, role) => void place(p, role)} />
      )}

      {shared !== null && (
        <div className="board-dialog" role="dialog" aria-label="Shared set">
          <p>
            This set is also used by <strong>{shared.names.join(", ")}</strong>.
            Adding to it changes theirs too.
          </p>
          <div className="ws-create-actions">
            <button className="primary"
                    onClick={() => void place(shared.purpose, shared.role, "split")}>
              Give this one its own copy
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

      {inForce !== null && (data?.tiles.length ?? 0) > 0 && (
        <p className="board-asof">
          Showing what is in force at the scene picked above. Dimmed files
          do not apply there.
        </p>
      )}

      {(data?.tiles.length ?? 0) > 0 && (
        <div className="board-filters" role="group" aria-label="Show">
          {(["all", ...purposes] as const).map((p) => {
            const n = p === "all" ? data?.tiles.length ?? 0 : counts.get(p) ?? 0;
            if (p !== "all" && n === 0) return null;
            return (
              <button key={p} className={"chip" + (filter === p ? " on" : "")}
                      aria-pressed={filter === p} onClick={() => setFilter(p)}>
                {p === "all" ? "All" : label(p)} {n}
              </button>
            );
          })}
        </div>
      )}

      {data !== null && data.tiles.length === 0 && (
        <p className="muted board-empty">
          Nothing here yet. Start with the one that is most like {owner.kind ===
            "character" ? "them" : "it"}.
        </p>
      )}

      <ul className="board-tiles">
        {tiles.map((t) => (
          <BoardTile key={t.key} tile={t} board={board} owner={owner}
                     purposes={purposes} live={live(t)} onChange={done}
                     onOpen={() => void openEntityRow("asset",
                       Number(t.asset["id"]))} />
        ))}
      </ul>

      {data !== null && data.sets.some((s) => s.sharedWith.length > 0) && (
        <p className="muted board-sets">
          {data.sets.filter((s) => s.sharedWith.length > 0).map((s) =>
            `“${s.name}” is shared with ${s.sharedWith.join(", ")}.`).join(" ")}
        </p>
      )}

      {data !== null && (
        <ExceptionList owner={owner} board={board} exceptions={data.exceptions}
                       inForce={inForce} asOf={asOfSceneId} />
      )}
    </div>
  );
}

function PurposeDialog({ board, kind, names, purposes, onChoose, onCancel }: {
  board: BoardName; kind: string; names: string[]; purposes: Purpose[];
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
        {purposes.map((p) => (
          <button key={p} className="board-purpose"
                  onClick={() => onChoose(p, role)}>
            <strong>{purposeLabel(kind, board, p)}</strong>
            <span>{purposeHelp(kind, board, p)}</span>
          </button>
        ))}
      </div>
      <div className="ws-add-row">
        <input aria-label="Role, for a reference set" value={role}
               placeholder="Optional: what it shows — front, side, model sheet"
               onChange={(e) => setRole(e.target.value)} />
        <button className="ghost" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

