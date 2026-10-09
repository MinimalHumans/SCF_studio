// SPDX-License-Identifier: Apache-2.0
import { useEffect, useRef, useState } from "react";
import type { SqlValue } from "@scf-core/db.ts";
import type { NumberingPolicy } from "@scf-core/numbering.ts";
import { exec } from "../state/store.ts";
import {
  previewDerivedNumbering, type NumberingPreview,
} from "../editor/structureCommit.ts";

/**
 * The warning before `project.numbering_policy` changes (spec §4.3).
 *
 * The setting is one select and its consequence is every number in the
 * production: `derived` rewrites scene numbers, shot codes, act and
 * sequence numbers at the next commit, and nothing brings the old ones
 * back. So the change is never made by the select alone. The dialog
 * says what will happen — counted, for a switch to derived, from the
 * same rules the commit runs — and the writer confirms or backs out.
 */
export function NumberingPolicyConfirm({ to, onConfirm, onCancel, onSave }: {
  to: NumberingPolicy;
  onConfirm: () => void;
  onCancel: () => void;
  /** True where the change waits for the record's Save button. */
  onSave?: boolean;
}): JSX.Element {
  const [preview, setPreview] = useState<NumberingPreview | null>(null);
  const [failed, setFailed] = useState(false);
  const cancel = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancel.current?.focus();
    if (to !== "derived") return;
    let cancelled = false;
    void previewDerivedNumbering(exec).then((p) => {
      if (!cancelled) setPreview(p);
    }).catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [to]);

  const when = onSave === true
    ? "once you save this record" : "as soon as you confirm";

  return (
    <div className="modal-scrim" role="dialog" aria-modal="true"
         aria-labelledby="numbering-confirm-title"
         onKeyDown={(e) => { if (e.key === "Escape") onCancel(); }}>
      <div className="modal numbering-confirm">
        {to === "fixed" ? (
          <>
            <h3 id="numbering-confirm-title">Freeze all numbering?</h3>
            <p>
              With <b>fixed</b> numbering the editor never renumbers
              anything again. Scene numbers, shot codes, and act and
              sequence numbers stay exactly as they are, whatever happens
              to the script.
            </p>
            <ul>
              <li>
                A scene you move keeps its number, so numbers stop
                matching script order: scene 12 can play after scene 45.
                That is correct once numbers are on schedules, call sheets
                and shot lists, and it is why imported scripts start out
                fixed.
              </li>
              <li>
                A scene you add to the script gets <b>no number</b>. You
                number it yourself, in whatever scheme the production
                uses (12A, A12…).
              </li>
              <li>
                A shot whose position no longer matches its code keeps
                its code; the Shoot tab shows the difference beside it.
              </li>
            </ul>
            <p>
              No number changes now. <b>There is no undo for this
              setting.</b> Switching back to derived later renumbers
              everything at the next commit, and that cannot be undone
              either.
            </p>
          </>
        ) : (
          <>
            <h3 id="numbering-confirm-title">
              Let the editor renumber everything?
            </h3>
            <p>
              With <b>derived</b> numbering, every commit of the script
              rewrites the numbers to match story order. The next commit
              after this change will:
            </p>
            {preview === null && !failed && <p className="muted">Counting…</p>}
            {failed && (
              <p className="muted">
                Could not count what would change. The rules below still
                apply.
              </p>
            )}
            {preview !== null && <DerivedPreview p={preview} />}
            <ul>
              <li>
                Scene numbers become 1, 2, 3… in script order. Gaps and
                lettered numbers such as 12A are lost.
              </li>
              <li>
                Shot codes in the standard form (scene number plus
                letters, such as 12A) follow their scene's new number.
                Codes in any other form are left alone.
              </li>
              <li>
                Adding or removing an act or sequence on the Structure
                tab renumbers acts and sequences straight away.
              </li>
            </ul>
            <p className="numbering-confirm-warn">
              <b>This cannot be undone.</b> Switching back to fixed stops
              further renumbering but does not bring back the old
              numbers. If these numbers are already on schedules, call
              sheets or shot lists, save a version of the project first.
            </p>
          </>
        )}
        <p className="muted">The setting changes {when}.</p>
        <div className="revert-actions">
          <button ref={cancel} onClick={onCancel}>Cancel</button>
          <button className={to === "derived" ? "danger" : "primary"}
                  disabled={to === "derived" && preview === null && !failed}
                  onClick={onConfirm}>
            {to === "derived" ? "Switch to derived" : "Switch to fixed"}
          </button>
        </div>
      </div>
    </div>
  );
}

function DerivedPreview({ p }: { p: NumberingPreview }): JSX.Element {
  const n = (count: number, one: string, many: string): string =>
    `${String(count)} ${count === 1 ? one : many}`;
  const nothing = p.scenesRenumbered + p.scenesCleared + p.shotsRestamped +
    p.spansRenumbered === 0;
  if (nothing) {
    return (
      <p>
        Change nothing yet: every number already matches the script. From
        then on, numbers follow the page.
      </p>
    );
  }
  return (
    <ul className="numbering-confirm-counts">
      {p.scenesRenumbered > 0 && (
        <li>renumber <b>{n(p.scenesRenumbered, "scene", "scenes")}</b> of {p.scenes}</li>
      )}
      {p.scenesCleared > 0 && (
        <li>
          clear the number of <b>{n(p.scenesCleared, "scene", "scenes")}</b>{" "}
          that {p.scenesCleared === 1 ? "is" : "are"} not in the script
        </li>
      )}
      {p.shotsRestamped > 0 && (
        <li>rewrite <b>{n(p.shotsRestamped, "shot code", "shot codes")}</b> of {p.shots}</li>
      )}
      {p.spansRenumbered > 0 && (
        <li>renumber <b>{n(p.spansRenumbered, "act or sequence", "acts and sequences")}</b></li>
      )}
    </ul>
  );
}

/** The stored value as a policy, or null where it is not one. */
export function asPolicy(v: SqlValue | undefined): NumberingPolicy | null {
  const s = v === null || v === undefined ? "" : String(v).trim();
  return s === "fixed" || s === "derived" ? s : null;
}
