// SPDX-License-Identifier: Apache-2.0
/**
 * SuggestionDialog.tsx — "use an asset folder from another project?"
 * (file-management-plan.md §3.2 point 3, §3.5).
 *
 * Shown only when the open film's path is new to `app.db` but its
 * uuid, title or file name matches another row's — never applied on
 * its own. Strong (uuid) matches come first; `useStore`'s
 * `suggestions` is already in that order.
 */

import { useStore } from "../state/store.ts";

export function SuggestionDialog(): JSX.Element | null {
  const { suggestions, chooseSuggestion, dismissSuggestions,
          forgetSuggestion, attachFolder } = useStore();
  if (suggestions === null || suggestions.length === 0) return null;

  return (
    <div className="modal-scrim" role="dialog" aria-modal="true"
         aria-labelledby="suggestion-dialog-title"
         onKeyDown={(e) => { if (e.key === "Escape") dismissSuggestions(); }}>
      <div className="modal suggestion-dialog">
        <h3 id="suggestion-dialog-title">
          Use an asset folder from another project?
        </h3>
        <p className="muted">
          This file has not been opened before, but {suggestions.length === 1
            ? "one project looks" : "some projects look"} like it. Nothing
          is attached until you choose one.
        </p>
        <ul className="suggestion-list">
          {suggestions.map((s) => (
            <li key={s.pathKey} className="suggestion-row">
              <div className="suggestion-row-info">
                <strong>{s.title ?? s.baseName ?? "Untitled"}</strong>
                {s.strength === "uuid" && (
                  <span className="suggestion-strength" title="Same project, by its own identity">
                    same project
                  </span>
                )}
                <div className="muted small">{s.scfPath}</div>
                <div className="muted small">
                  {s.assetRoot ?? "(no folder attached there either)"}
                </div>
              </div>
              <div className="suggestion-row-actions">
                <button disabled={s.assetRoot === null}
                        onClick={() => void chooseSuggestion(s)}>
                  Use this folder
                </button>
                <button className="ghost tiny" title="Forget this entry"
                        onClick={() => void forgetSuggestion(s)}>
                  ✕
                </button>
              </div>
            </li>
          ))}
        </ul>
        <div className="suggestion-dialog-actions">
          <button className="ghost" onClick={() => void attachFolder()}>
            Choose a different folder…
          </button>
          <button className="ghost" onClick={dismissSuggestions}>
            Open without assets
          </button>
        </div>
      </div>
    </div>
  );
}
