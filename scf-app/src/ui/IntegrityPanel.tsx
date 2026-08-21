// SPDX-License-Identifier: Apache-2.0
/**
 * IntegrityPanel — what the script left behind.
 *
 * The toolbar used to show "3 detached tags" and offer nothing, which is
 * a warning the author cannot act on. This lists every link whose text
 * is gone and gives each one a verb.
 *
 * Nothing here happens automatically. Removal is always the author's
 * click — particularly for scene/character links, where a row may have
 * been authored by hand for someone present and silent and no query can
 * tell that from a leftover (conventions §1: SCF reports, it does not
 * enforce).
 */

import { useEffect, useState } from "react";
import {
  EMPTY_REPORT, deleteBeat, deletePropTag, deleteSceneCharacter,
  scanIntegrity, unanchorBeat, type IntegrityReport,
} from "../editor/integrity.ts";
import { exec, useStore } from "../state/store.ts";

export function IntegrityPanel({ liveLineIds, onClose, onChanged }: {
  liveLineIds: ReadonlySet<string>;
  onClose: () => void;
  onChanged: () => void;
}): JSX.Element {
  const { openEntityRow } = useStore();
  const [report, setReport] = useState<IntegrityReport>(EMPTY_REPORT);
  const [busy, setBusy] = useState(true);

  const refresh = async (): Promise<void> => {
    setBusy(true);
    setReport(await scanIntegrity(exec, liveLineIds));
    setBusy(false);
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveLineIds]);

  const act = (work: () => Promise<void>): void => {
    void (async () => {
      await work();
      await refresh();
      onChanged();
    })();
  };

  return (
    <aside className="integrity-panel">
      <div className="integrity-head">
        <h3>Script integrity</h3>
        <button className="ghost tiny" onClick={onClose}
                aria-label="close">×</button>
      </div>

      {busy && <p className="muted">Checking…</p>}

      {!busy && report.total === 0 && (
        <p className="muted">
          Nothing dangling. Every prop tag, beat and cast link still has
          the script text it was made from.
        </p>
      )}

      {report.detachedTags.length > 0 && (
        <section>
          <h4>Prop tags with no line ({report.detachedTags.length})</h4>
          <p className="muted">
            The line these were anchored to no longer exists. The prop
            itself is untouched either way.
          </p>
          <ul className="integrity-list">
            {report.detachedTags.map((t) => (
              <li key={t.id}>
                <b>{t.propName}</b>
                <span className="muted"> tagged on “{t.taggedText}”</span>
                <span className="flex-spacer" />
                <button className="row-link"
                        onClick={() => void openEntityRow("prop", t.propId)}>
                  open prop
                </button>
                <button className="ghost tiny"
                        title="Remove the tag. The prop and its other tags stay."
                        onClick={() => act(() => deletePropTag(exec, t.id))}>
                  remove tag
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {report.orphanBeats.length > 0 && (
        <section>
          <h4>Beats with no line ({report.orphanBeats.length})</h4>
          <p className="muted">
            These performance beats point at a script line that is gone,
            so they show no gutter dot and cannot be found from the
            script. Keeping one drops only its line anchor — it stays on
            its scene and character.
          </p>
          <ul className="integrity-list">
            {report.orphanBeats.map((b) => (
              <li key={b.id}>
                <b>{b.characterName ?? "—"}</b>
                <span className="muted">
                  {" "}{b.modality} · “{b.lineText.slice(0, 40)}”
                </span>
                <span className="flex-spacer" />
                {b.sceneId !== null && (
                  <button className="row-link"
                          onClick={() =>
                            void openEntityRow("scene", b.sceneId!)}>
                    open scene
                  </button>
                )}
                <button className="ghost tiny"
                        title="Keep the beat, drop its dead line anchor."
                        onClick={() => act(() => unanchorBeat(exec, b.id))}>
                  keep, unanchor
                </button>
                <button className="ghost tiny"
                        onClick={() => act(() => deleteBeat(exec, b.id))}>
                  delete beat
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {report.unjustifiedLinks.length > 0 && (
        <section>
          <h4>
            Cast links the script no longer shows
            ({report.unjustifiedLinks.length})
          </h4>
          <p className="muted">
            This character is linked to this scene, but no cue line for
            them survives in it. That is usually a leftover from deleted
            dialogue — but it is also how you record someone present and
            silent, so nothing is removed unless you say so.
          </p>
          <ul className="integrity-list">
            {report.unjustifiedLinks.map((l) => (
              <li key={l.id}>
                <b>{l.characterName}</b>
                <span className="muted">
                  {" "}in {l.sceneNumber === null
                    ? l.sceneName : `sc ${l.sceneNumber} — ${l.sceneName}`}
                </span>
                <span className="flex-spacer" />
                <button className="row-link"
                        onClick={() =>
                          void openEntityRow("scene", l.sceneId)}>
                  open scene
                </button>
                <button className="ghost tiny"
                        onClick={() =>
                          act(() => deleteSceneCharacter(exec, l.id))}>
                  remove link
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </aside>
  );
}
