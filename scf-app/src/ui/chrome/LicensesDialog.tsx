// SPDX-License-Identifier: Apache-2.0
/**
 * LicensesDialog — third-party attributions for every npm and Cargo
 * package SCF Editor ships with. The list comes from
 * src/generated/licenses.json, written by `tools/gen_licenses.mjs`
 * from package-lock.json and `cargo metadata`; nothing here fetches
 * or computes a license, so a new dependency only shows up once that
 * script is run again and the result is committed.
 *
 * Grouped by the directly-declared dependency that pulled each
 * package in (`group`), since a flat list of hundreds of transitive
 * crates says nothing about why any one of them is there. Groups
 * collapse by default — `tauri` alone accounts for over a third of
 * the Cargo list — and a search expands only the groups that match.
 */

import { useMemo, useState } from "react";
import licenses from "../../generated/licenses.json";

interface PackageRow {
  name: string;
  version: string;
  license: string;
  group: string;
  isRoot: boolean;
}

type Ecosystem = "npm" | "cargo";

const manifest = licenses as {
  generatedAt: string;
  npm: PackageRow[];
  cargo: PackageRow[];
};

interface Group {
  name: string;
  root: PackageRow | null;
  members: PackageRow[];
}

function groupRows(rows: PackageRow[]): Group[] {
  const byGroup = new Map<string, PackageRow[]>();
  for (const r of rows) {
    const list = byGroup.get(r.group);
    if (list === undefined) byGroup.set(r.group, [r]);
    else list.push(r);
  }
  return [...byGroup.entries()].map(([name, members]) => ({
    name,
    root: members.find((m) => m.isRoot) ?? null,
    members: members.filter((m) => !m.isRoot),
  })).sort((a, b) =>
    b.members.length + (b.root !== null ? 1 : 0) -
    (a.members.length + (a.root !== null ? 1 : 0)));
}

function PackageRowView({ p }: { p: PackageRow }): JSX.Element {
  return (
    <li className="licenses-row">
      <span className="mono">{p.name}</span>
      <span className="muted small mono">{p.version}</span>
      <span className="licenses-tag">{p.license}</span>
    </li>
  );
}

function GroupView({ group, expanded, onToggle, forceOpen }: {
  group: Group; expanded: boolean; onToggle: () => void; forceOpen: boolean;
}): JSX.Element {
  const open = expanded || forceOpen;
  const total = group.members.length + (group.root !== null ? 1 : 0);
  return (
    <li className="licenses-group">
      <button className="licenses-group-head" onClick={onToggle}
              aria-expanded={open}>
        <span className="licenses-group-caret">{open ? "▾" : "▸"}</span>
        <span className="mono">{group.name}</span>
        <span className="muted small">
          {total === 1 ? "direct dependency" : `pulls in ${String(total - 1)}`}
        </span>
      </button>
      {open && (
        <ul className="licenses-list">
          {group.root !== null && <PackageRowView p={group.root} />}
          {group.members.map((p) => (
            <PackageRowView key={`${p.name}@${p.version}`} p={p} />
          ))}
        </ul>
      )}
    </li>
  );
}

export function LicensesDialog({ onClose }: { onClose: () => void }):
    JSX.Element {
  const [query, setQuery] = useState("");
  const [ecosystem, setEcosystem] = useState<Ecosystem>("npm");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const groups = useMemo(
    () => groupRows(ecosystem === "npm" ? manifest.npm : manifest.cargo),
    [ecosystem]);

  const q = query.trim().toLowerCase();
  const visible = q === "" ? groups
    : groups
        .map((g) => ({
          ...g,
          members: g.members.filter((m) => m.name.toLowerCase().includes(q)),
        }))
        .filter((g) =>
          (g.root !== null && g.root.name.toLowerCase().includes(q)) ||
          g.members.length > 0);

  const toggle = (name: string): void => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  };

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
          Third-party packages SCF Editor is built on, grouped by the
          direct dependency that brought each one in. Generated{" "}
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
          {visible.length === 0 && <p className="muted small">No packages match.</p>}
          {visible.length > 0 && (
            <ul className="licenses-groups">
              {visible.map((g) => (
                <GroupView key={g.name} group={g} forceOpen={q !== ""}
                           expanded={expanded.has(g.name)}
                           onToggle={() => toggle(g.name)} />
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
