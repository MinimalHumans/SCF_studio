// SPDX-License-Identifier: Apache-2.0
import { registry } from "../../state/store.ts";
import logoBigCloud from "../../assets/logoBig_cloud.svg";

/** Schema and build, which used to sit in the top bar all the time. */
export function AboutDialog({ onClose }: { onClose: () => void }):
    JSX.Element {
  return (
    <div className="modal-scrim" role="dialog" aria-modal="true"
         aria-labelledby="about-dialog-title"
         onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}
         onClick={onClose}>
      <div className="modal about-dialog"
           onClick={(e) => { e.stopPropagation(); }}>
        <img className="about-logo" src={logoBigCloud} alt="SCF" />
        <h3 id="about-dialog-title">SCF Editor</h3>
        <dl className="about-facts">
          <dt>Editor version</dt><dd>{__APP_VERSION__}</dd>
          <dt>Schema version</dt><dd>{registry.schemaVersion}</dd>
          <dt>Commit</dt><dd className="mono">{__APP_COMMIT__}</dd>
          <dt>Built</dt><dd>{__APP_BUILT__}</dd>
        </dl>
        <div className="suggestion-dialog-actions">
          <button autoFocus onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
