/**
 * AssetBrowser — navigating a project's assets (P4).
 *
 * Three things sit side by side, and none of them is the structure:
 *
 *   The path tree is a DERIVED view of the identifiers, and it lives in
 *   the nav rail with every other tab's navigation — Script has its
 *   scenes there, Schema its categories, so Assets has its paths.
 *   Clicking a folder sets a prefix filter; it is not a place you are
 *   "in", and nothing is stored to make it exist.
 *
 *   Facets compose. Format, root, orphaned, unaddressed and free text
 *   all narrow the same list at once, because a single imposed
 *   hierarchy is wrong for half its users.
 *
 *   Relink is plan-then-apply, on whatever prefix is selected. Bulk
 *   re-rooting is the common repair and a repair nobody can preview is
 *   one nobody will run on a thousand rows.
 *
 * The authored structure remains the bundle graph, which lives in the
 * bundles themselves and is deliberately not duplicated here.
 */

import { useEffect, useMemo, useState } from "react";
import {
  applyFilter, facetsOf, listAssets, orphanIds, pathTree,
  type AssetFilter, type AssetRow, type TreeNode,
} from "@scf-core/assetIndex.ts";
import { applyRelink, planRelink, type RelinkChange }
  from "@scf-core/assets.ts";
import { exec, registry, useStore } from "../state/store.ts";

function Folder({ node, depth, selected, onSelect }: {
  node: TreeNode; depth: number; selected: string;
  onSelect: (prefix: string) => void;
}): JSX.Element {
  const [open, setOpen] = useState(depth < 2);
  const hasChildren = node.children.length > 0;

  return (
    <li>
      <div className={`asset-folder${
        selected === node.prefix ? " selected" : ""}`}
           style={{ paddingLeft: `${depth * 10}px` }}>
        <button className="ghost tiny asset-folder-twist"
                onClick={() => setOpen((v) => !v)}
                disabled={!hasChildren}>
          {hasChildren ? (open ? "▾" : "▸") : "·"}
        </button>
        <button className="ghost tiny asset-folder-name"
                onClick={() => onSelect(node.prefix)}>
          {node.name === "" ? "all" : node.name}
        </button>
        <span className="muted">{node.totalCount}</span>
      </div>
      {open && hasChildren && (
        <ul>
          {node.children.map((child) => (
            <Folder key={child.prefix} node={child} depth={depth + 1}
                    selected={selected} onSelect={onSelect} />
          ))}
        </ul>
      )}
    </li>
  );
}

function Relink({ prefix, onDone }: {
  prefix: string; onDone: () => void;
}): JSX.Element {
  const [to, setTo] = useState(prefix);
  const [plan, setPlan] = useState<RelinkChange[] | null>(null);
  const [applied, setApplied] = useState(0);

  useEffect(() => { setTo(prefix); setPlan(null); setApplied(0); },
            [prefix]);

  return (
    <div className="asset-relink">
      <h4>Re-root</h4>
      <p className="muted">
        Every identifier starting <span className="mono">{prefix}</span>{" "}
        moves. Nothing on disk is touched — this rewrites addresses, not
        files.
      </p>
      <input className="mono" value={to} spellCheck={false}
             onChange={(e) => { setTo(e.target.value); setPlan(null); }} />
      <div className="asset-relink-actions">
        <button className="tiny"
                disabled={to === prefix || to.trim() === ""}
                onClick={() => {
                  void (async () => {
                    setPlan(await planRelink(exec, prefix, to));
                  })();
                }}>
          Preview
        </button>
        {plan !== null && plan.length > 0 && (
          <button className="tiny primary"
                  onClick={() => {
                    void (async () => {
                      setApplied(await applyRelink(exec, plan));
                      setPlan(null);
                      onDone();
                    })();
                  }}>
            Apply to {plan.length}
          </button>
        )}
      </div>
      {plan !== null && plan.length === 0 && (
        <p className="muted">Nothing matches that prefix.</p>
      )}
      {plan !== null && plan.length > 0 && (
        <ul className="asset-relink-plan">
          {plan.slice(0, 8).map((c) => (
            <li key={c.id} className="mono">{c.from} → {c.to}</li>
          ))}
          {plan.length > 8 && (
            <li className="muted">…and {plan.length - 8} more</li>
          )}
        </ul>
      )}
      {applied > 0 && (
        <p className="muted">{applied} identifiers rewritten.</p>
      )}
    </div>
  );
}

/**
 * The index, loaded once and shared by the rail and the main panel.
 *
 * Both halves need the same rows, and loading them twice would mean two
 * scans of the asset table and two orphan sweeps on every open.
 */
function useAssetIndex(): {
  assets: AssetRow[]; orphans: ReadonlySet<number>; loading: boolean;
  reload: () => void;
} {
  const { revision } = useStore();
  const [assets, setAssets] = useState<AssetRow[]>([]);
  const [orphans, setOrphans] = useState<ReadonlySet<number>>(new Set());
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      setAssets(await listAssets(exec));
      setOrphans(await orphanIds(exec, registry));
      setLoading(false);
    })();
  }, [revision, nonce]);

  return { assets, orphans, loading,
           reload: () => setNonce((n) => n + 1) };
}

/** The path tree and relink, for the nav rail. */
export function AssetPathRail(): JSX.Element {
  const { assets, loading, reload } = useAssetIndex();
  const { assetPrefix, setAssetPrefix } = useStore();
  const tree = useMemo(() => pathTree(assets), [assets]);

  if (loading) return <p className="rail-empty">Loading…</p>;
  if (assets.length === 0) {
    return <p className="rail-empty">No assets yet.</p>;
  }

  return (
    <div className="asset-tree">
      <h4>Paths</h4>
      <p className="muted">
        Derived from the identifiers. Nothing here is authored.
      </p>
      <ul>
        <Folder node={tree} depth={0} selected={assetPrefix}
                onSelect={setAssetPrefix} />
      </ul>
      {assetPrefix !== "" && (
        <Relink prefix={assetPrefix} onDone={reload} />
      )}
    </div>
  );
}

export function AssetBrowser(): JSX.Element {
  const { openEntityRow, assetPrefix, setAssetPrefix } = useStore();
  const { assets, orphans, loading } = useAssetIndex();
  const [filter, setFilter] = useState<AssetFilter>({});

  const facets = useMemo(() => facetsOf(assets, orphans),
                         [assets, orphans]);
  const shown = useMemo(
    () => applyFilter(assets, { ...filter, prefix: assetPrefix }, orphans),
    [assets, filter, assetPrefix, orphans]);

  if (loading) return <div className="asset-browser">Loading assets…</div>;

  if (assets.length === 0) {
    return (
      <div className="asset-browser asset-browser-empty">
        <p className="muted">
          No assets in this file yet. An asset is a reference to
          something outside it — an image, a recording, a model weight —
          addressed as <span className="mono">@project/…</span> and
          resolved against the project folder.
        </p>
      </div>
    );
  }

  const toggle = (key: "orphansOnly" | "unaddressedOnly"): void =>
    setFilter((f) => ({ ...f, [key]: f[key] === true ? undefined : true }));

  return (
    <div className="asset-browser">
      <div className="asset-main">
        <div className="asset-filters">
          <input placeholder="filter by name or identifier"
                 value={filter.text ?? ""}
                 onChange={(e) =>
                   setFilter((f) => ({ ...f, text: e.target.value }))} />
          <button className={`tiny${
            filter.orphansOnly === true ? " primary" : ""}`}
                  onClick={() => toggle("orphansOnly")}
                  title="Assets nothing points at — no bundle, no anchor,
no relationship. These are what rot at scale.">
            unreferenced {facets.orphans}
          </button>
          <button className={`tiny${
            filter.unaddressedOnly === true ? " primary" : ""}`}
                  onClick={() => toggle("unaddressedOnly")}>
            no identifier {facets.unaddressed}
          </button>
          {assetPrefix !== "" && (
            <button className="ghost tiny"
                    onClick={() => setAssetPrefix("")}>
              clear path: <span className="mono">{assetPrefix}</span>
            </button>
          )}
        </div>

        <div className="asset-facets">
          {facets.formats.slice(0, 12).map((f) => (
            <button key={f.value}
                    className={`ghost tiny${
                      filter.format === f.value ? " primary" : ""}`}
                    onClick={() => setFilter((prev) => ({
                      ...prev,
                      format: prev.format === f.value
                        ? undefined
                        : (f.value === "no extension" ? null : f.value),
                    }))}>
              {f.value} {f.count}
            </button>
          ))}
        </div>

        <p className="muted asset-count">
          {shown.length} of {facets.total}
        </p>

        <ul className="asset-list">
          {shown.slice(0, 300).map((a) => (
            <li key={a.id}>
              <button className="ghost asset-row"
                      onClick={() => { void openEntityRow("asset", a.id); }}>
                <span className="asset-row-name">
                  {a.name ?? <em className="muted">unnamed</em>}
                </span>
                <span className="mono muted asset-row-id">
                  {a.identifier ?? "no identifier"}
                </span>
                {orphans.has(a.id) && (
                  <span className="asset-row-orphan">unreferenced</span>
                )}
              </button>
            </li>
          ))}
          {shown.length > 300 && (
            <li className="muted">
              …{shown.length - 300} more. Narrow the filters.
            </li>
          )}
        </ul>
      </div>
    </div>
  );
}
