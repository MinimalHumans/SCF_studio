// SPDX-License-Identifier: Apache-2.0
/**
 * LicensesDialog — third-party attributions for every npm and Cargo
 * package SCF Editor ships with. The list comes from
 * src/generated/licenses.json, written by `tools/gen_licenses.mjs`
 * from package-lock.json and `cargo metadata`; nothing here fetches
 * or computes a license, so a new dependency only shows up once that
 * script is run again and the result is committed.
 */

import { useMemo, useState } from "react";
import licenses from "../../generated/licenses.json";

interface PackageRow {
  name: string;
  version: string;
  license: string;
}

type Ecosystem = "npm" | "cargo";

const manifest = licenses as {
  generatedAt: string;
  npm: PackageRow[];
  cargo: PackageRow[];
};

function PackageList({ rows }: { rows: PackageRow[] }): JSX.Element {
  if (rows.length === 0) {
    return <p className="muted small">No packages match.</p>;
  }
  return (
    <ul className="licenses-list">
      {rows.map((p) => (
        <li key={`${p.name}@${p.version}`} className="licenses-row">
          <span className="mono">{p.name}</span>
          <span className="muted small mono">{p.version}</span>
          <span className="licenses-tag">{p.license}</span>
        </li>
      ))}
    </ul>
  );
}

export function LicensesDialog({ onClose }: { onClose: () => void }):
    JSX.Element {
  const [query, setQuery] = useState("");
  const [ecosystem, setEcosystem] = useState<Ecosystem>("npm");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = ecosystem === "npm" ? manifest.npm : manifest.cargo;
    return q === "" ? rows
      : rows.filter((p) => p.name.toLowerCase().includes(q));
  }, [query, ecosystem]);

  return (
    <div className="modal-scrim" role="dialog" aria-modal="true"
         aria-labelledby="licenses-dialog-title"
         onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}
         onClick={onClose}>
      <div className="modal licenses-dialog"
           onClick={(e) => { e.stopPropagation(); }}>
        <div className="modal-head">
          <h2 id="licenses-dialog-title">Open Source Licenses</h2>
          <button className="ghost tiny" aria-label="Close" autoFocus
                  onClick={onClose}>
            ×
          </button>
        </div>
        <p className="muted small">
          Third-party packages SCF Editor is built on. Generated{" "}
          {new Date(manifest.generatedAt).toLocaleDateString()} from
          package-lock.json and cargo metadata — run{" "}
          <code>tools/gen_licenses.mjs</code> after changing dependencies
          to refresh this list.
        </p>
        <div className="licenses-controls">
          <nav className="licenses-tabs" aria-label="Package ecosystem">
            <button role="tab" aria-selected={ecosystem === "npm"}
                    className={"licenses-tab" +
                               (ecosystem === "npm" ? " active" : "")}
                    onClick={() => setEcosystem("npm")}>
              npm ({manifest.npm.length})
            </button>
            <button role="tab" aria-selected={ecosystem === "cargo"}
                    className={"licenses-tab" +
                               (ecosystem === "cargo" ? " active" : "")}
                    onClick={() => setEcosystem("cargo")}>
              Cargo ({manifest.cargo.length})
            </button>
          </nav>
          <input type="search" placeholder="Filter by name…" value={query}
                 onChange={(e) => setQuery(e.target.value)}
                 aria-label="Filter packages" />
        </div>
        <div className="licenses-content">
          <PackageList rows={filtered} />
        </div>
      </div>
    </div>
  );
}
