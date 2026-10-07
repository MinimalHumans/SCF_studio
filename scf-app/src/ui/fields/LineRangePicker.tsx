// SPDX-License-Identifier: Apache-2.0
import { useState } from "react";
import type { Row, SqlValue } from "@scf-core/db.ts";
import { SCENE_SCRIPT_SQL } from "@scf-core/screenplay/sceneScript.ts";
import { useQuery } from "../useQuery.ts";

/**
 * The lines a shot (or clip) covers, picked from its scene's script
 * rather than typed as two uuids.
 *
 * The range is stored as two line anchors (§3.5, §4.7) — the uuid of the
 * first line and of the last, inclusive, in the row's own scene. Nobody
 * can author a uuid, but the scene is known, so the candidates are known:
 * the scene's lines, located by its heading as Q04 locates them. Pick
 * from the two lists, or click the first line in the scene and then the
 * last.
 *
 * Lines get their uuid when the script is committed, so a line typed
 * since the last commit is not offered yet.
 */
export function LineRangePicker({ sceneId, start, end, onChange }: {
  sceneId: SqlValue;
  start: SqlValue;
  end: SqlValue;
  onChange: (field: "line_start_ref" | "line_end_ref",
             value: string | null) => void;
}): JSX.Element {
  const scene = sceneId === null || sceneId === undefined || sceneId === ""
    ? null : Number(sceneId);
  const all = useQuery(scene === null ? null : SCENE_SCRIPT_SQL,
                       [scene, scene, scene]);
  // A blank line is layout, not something a shot covers; as an end it
  // would only hide which line the range really stops on.
  const lines = all.filter((l) => l["line_type"] !== "blank" &&
                                  l["uuid"] !== null);
  // The first click of a click-click selection, until the second lands.
  const [pending, setPending] = useState<number | null>(null);

  const s = text(start);
  const e = text(end);
  const at = (uuid: string | null): number =>
    uuid === null ? -1 : lines.findIndex((l) => String(l["uuid"]) === uuid);
  const first = at(s);
  const last = e === null ? first : at(e);

  const set = (from: number | null, to: number | null): void => {
    onChange("line_start_ref",
             from === null ? null : String(lines[from]!["uuid"]));
    // An end on the start line is the same range as no end (§4.7), and
    // leaving it unset keeps a one-line range one anchor.
    onChange("line_end_ref", to === null || to === from
      ? null : String(lines[to]!["uuid"]));
  };

  const click = (i: number): void => {
    if (pending === null) {
      setPending(i);
      set(i, null);
    } else {
      set(Math.min(pending, i), Math.max(pending, i));
      setPending(null);
    }
  };

  if (scene === null) {
    return (
      <p className="muted line-range-note">
        Pick the shot's scene first — the lines it covers are chosen from
        that scene's script.
      </p>
    );
  }
  if (lines.length === 0) {
    return (
      <p className="muted line-range-note">
        This scene has no committed script lines yet. Write it in the
        Script tab and commit, and its lines will be offered here.
      </p>
    );
  }

  // Stored anchors this scene cannot account for: said plainly, with the
  // raw value, rather than shown as an empty pick that a save would keep.
  const stray = [
    ...(s !== null && first < 0 ? [["First line", s]] : []),
    ...(e !== null && last < 0 ? [["Last line", e]] : []),
  ];
  const reversed = first >= 0 && last >= 0 && last < first;
  const covered = (i: number): boolean =>
    first >= 0 && i >= first && i <= (last < 0 ? first : last);

  return (
    <div className="line-range">
      <div className="line-range-picks">
        <label>
          <span>First line</span>
          <select value={first >= 0 ? String(first) : ""}
                  onChange={(ev) => {
                    setPending(null);
                    const i = ev.target.value === ""
                      ? null : Number(ev.target.value);
                    if (i === null) set(null, null);
                    // Keep the end if it still follows the new start.
                    else set(i, e !== null && last >= i ? last : null);
                  }}>
            <option value="">— none —</option>
            {lines.map((l, i) => (
              <option key={String(l["uuid"])} value={i}>{optionText(l)}</option>
            ))}
          </select>
        </label>
        <label>
          <span>Last line</span>
          <select value={e !== null && last >= 0 ? String(last) : ""}
                  disabled={first < 0}
                  onChange={(ev) => {
                    setPending(null);
                    set(first, ev.target.value === ""
                      ? null : Number(ev.target.value));
                  }}>
            <option value="">same as first</option>
            {lines.map((l, i) => i > first && (
              <option key={String(l["uuid"])} value={i}>{optionText(l)}</option>
            ))}
          </select>
        </label>
        <button type="button" className="ghost tiny"
                disabled={s === null && e === null}
                onClick={() => { setPending(null); set(null, null); }}>
          Clear
        </button>
      </div>

      {stray.map(([label, uuid]) => (
        <p key={label} className="line-range-warn">
          {label} names a line that is not in this scene
          (<span className="mono">{uuid}</span>) — the line was deleted,
          or the shot moved scenes. Pick again to replace it.
        </p>
      ))}
      {reversed && (
        <p className="line-range-warn">
          The last line comes before the first. Pick again to fix it.
        </p>
      )}

      <p className="muted line-range-note">
        {pending === null
          ? "Click the first line this shot covers, then the last."
          : "Now click the last line (or the same line again for just one)."}
        {first >= 0 && ` ${String((last < 0 ? first : last) - first + 1)} ` +
                       `line${last === first || last < 0 ? "" : "s"} covered.`}
      </p>
      <div className="line-range-page">
        {lines.map((l, i) => (
          <p key={String(l["uuid"])}
             className={`sr sr-${String(l["line_type"])} line-range-line` +
                        (covered(i) ? " covered" : "") +
                        (i === first ? " first" : "") +
                        (i === (last < 0 ? first : last) ? " last" : "") +
                        (pending === i ? " pending" : "")}
             onClick={() => click(i)}>
            {String(l["content"] ?? "")}
          </p>
        ))}
      </div>
    </div>
  );
}

const text = (v: SqlValue): string | null =>
  v === null || v === undefined || String(v).trim() === ""
    ? null : String(v).trim();

/** A line as one option: its type where the text alone is ambiguous. */
function optionText(l: Row): string {
  const type = String(l["line_type"]);
  const content = String(l["content"] ?? "").replace(/\s+/g, " ").trim();
  const short = content.length > 70 ? `${content.slice(0, 69)}…` : content;
  return type === "action" || type === "heading"
    ? short : `${type.toUpperCase()}: ${short}`;
}
