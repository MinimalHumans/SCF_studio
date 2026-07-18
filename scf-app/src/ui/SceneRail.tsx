/**
 * SceneRail — the script surface's nav rail: headings in screenplay
 * order, click to jump. Scene-linked headings show their chip.
 */

import { useQuery } from "./useQuery.ts";
import { useStore } from "../state/store.ts";
import { scriptViewHandle } from "./ScriptView.tsx";

export function SceneRail(): JSX.Element {
  const headings = useQuery(
    "SELECT sl.line_order, sl.content, sl.scene_id, s.name AS scene_name " +
    "FROM screenplay_lines sl LEFT JOIN scene s ON s.id = sl.scene_id " +
    "WHERE sl.line_type = 'heading' ORDER BY sl.line_order");
  const { openEntityRow } = useStore();

  return (
    <nav className="scene-rail" aria-label="scenes">
      <div className="rail-head">Scenes ({headings.length})</div>
      <ul>
        {headings.map((h) => (
          <li key={String(h["line_order"])}>
            <button className="scene-jump"
                    onClick={() => scriptViewHandle.scrollToLineOrder?.(
                      h["line_order"] as number)}>
              {String(h["content"])}
            </button>
            {h["scene_id"] !== null && (
              <button className="scene-chip"
                      title={String(h["scene_name"] ?? "")}
                      onClick={() => void openEntityRow(
                        "scene", h["scene_id"] as number)}>
                ⛭
              </button>
            )}
          </li>
        ))}
        {headings.length === 0 && (
          <li className="muted rail-empty">no screenplay yet</li>
        )}
      </ul>
    </nav>
  );
}
