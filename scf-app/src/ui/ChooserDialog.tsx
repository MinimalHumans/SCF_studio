// SPDX-License-Identifier: Apache-2.0
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getHost } from "../host/hostClient.ts";
import {
  rememberFolder, startingFolder, useChooser, type ChooserRequest,
} from "../files/hostChooser.ts";
import {
  badFileName, chooserResult, withScfExtension, type Listing,
} from "../files/projectChooser.ts";

/**
 * The host-side file chooser: folders and `.scf` files under the
 * folders the host was started with. Mounted once, near the root; it
 * renders only while a `ProjectChooser` request is pending.
 */
export function ChooserDialog(): JSX.Element | null {
  const request = useChooser((s) => s.request);
  return request === null ? null : <Chooser request={request} />;
}

function Chooser({ request }: { request: ChooserRequest }): JSX.Element {
  const finish = useChooser((s) => s.finish);
  const [listing, setListing] = useState<Listing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState(request.suggestedName);
  const input = useRef<HTMLInputElement>(null);

  const go = useCallback(async (path?: string): Promise<void> => {
    setError(null);
    try {
      const host = await getHost();
      const next = await host.list(path);
      setListing(next);
      rememberFolder(next.path);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    const start = startingFolder();
    void go(start ?? undefined).then(() => undefined);
    input.current?.focus();
  }, [go]);

  const existing = useMemo(() => new Set(
    (listing?.entries ?? []).filter((e) => e.kind === "scf")
      .map((e) => e.name.toLowerCase())), [listing]);
  const result = chooserResult(request.mode, listing, name, existing);
  const nameProblem = request.mode === "new" && name !== ""
    ? (badFileName(name) ?? (existing.has(withScfExtension(name)
        .toLowerCase()) ? "A file with that name is already here." : null))
    : null;
  const opening = request.mode === "open";

  return (
    <div className="modal-scrim" role="dialog" aria-modal="true"
         aria-labelledby="chooser-title"
         onKeyDown={(e) => { if (e.key === "Escape") finish(null); }}>
      <div className="modal chooser">
        <div className="modal-head">
          <h2 id="chooser-title">
            {opening ? "Open an SCF file" : "Save the new project as"}
          </h2>
          <button onClick={() => finish(null)}>Cancel</button>
        </div>
        <div className="chooser-path">
          <button disabled={listing === null || listing.path === null}
                  onClick={() => void go(listing?.parent ?? undefined)}
                  title="Up one folder">↑</button>
          <code>{listing?.path ?? "Folders"}</code>
        </div>
        {error !== null && <p className="start-error">{error}</p>}
        <ul className="chooser-list" aria-label="Folders and files">
          {listing?.entries.map((e) => (
            <li key={e.path}>
              <button
                className={e.kind === "scf" && e.name === name
                  ? "chooser-entry selected" : "chooser-entry"}
                onClick={() => {
                  if (e.kind === "dir") void go(e.path);
                  else if (opening) setName(e.name);
                }}
                onDoubleClick={() => {
                  if (e.kind === "scf" && opening) finish(e.path);
                }}
                disabled={e.kind === "scf" && !opening}>
                <span aria-hidden="true">
                  {e.kind === "dir" ? "📁" : "🎞"}
                </span> {e.name}
              </button>
            </li>
          ))}
          {listing !== null && listing.entries.length === 0 && (
            <li className="rail-empty">Nothing here.</li>
          )}
        </ul>
        {!opening && (
          <label className="chooser-name">
            File name
            <input ref={input} value={name}
                   onChange={(e) => setName(e.target.value)}
                   onKeyDown={(e) => {
                     if (e.key === "Enter" && result !== null) finish(result);
                   }} />
          </label>
        )}
        {nameProblem !== null && <p className="start-error">{nameProblem}</p>}
        <div className="modal-actions">
          <button className="primary" disabled={result === null}
                  onClick={() => finish(result)}>
            {opening ? "Open" : "Create"}
          </button>
          {listing?.path === null && (
            <span className="muted">Pick a folder to begin.</span>
          )}
        </div>
      </div>
    </div>
  );
}
