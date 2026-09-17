// SPDX-License-Identifier: Apache-2.0
/**
 * BundleAssets — the missing half of the bundle editor.
 *
 * `bundle_asset` is a link entity, so nothing in the generic entity form
 * showed it: the bundle row had a name and an intent and no way to say
 * what was in it. This is that.
 *
 * Order is `bundle_asset."order"`, continued rather than restarted when
 * a batch is appended (see scf-core/bundling.ts). Removing a membership
 * deletes the link and never the asset.
 *
 * Roles are free text on purpose — what an asset is for varies by
 * production — so the input suggests the file's existing roles and
 * adopts an existing spelling when the typed one differs only in case
 * or spacing. A member whose media kind contradicts the bundle's intent
 * is marked, because retrieval is by intent and the miss is silent.
 */

import { useEffect, useMemo, useState } from "react";
import {
  applyBundleAdd, bundleMembers, bundlesForAsset, planBundleAdd,
  removeBundleMember, setMemberRole, unboundBundleIds, type BundleMember,
} from "@scf-core/bundling.ts";
import { listAssets, type AssetRow } from "@scf-core/assetIndex.ts";
import { q } from "@scf-core/db.ts";
import {
  adoptSpelling, columnValues, intentConflict, mediaKindOf,
} from "../editor/mediaChecks.ts";
import { exec, registry, useStore } from "../state/store.ts";
import { AssetThumb } from "./AssetThumb.tsx";
import { BundleReachSection } from "./BundleReach.tsx";

/** Membership list plus a searchable multi-select picker. */
export function BundleAssets({ bundleId }: {
  bundleId: number;
}): JSX.Element {
  const { openEntityRow, noteWrite, revision } = useStore();
  const [members, setMembers] = useState<BundleMember[]>([]);
  const [all, setAll] = useState<AssetRow[]>([]);
  const [picking, setPicking] = useState(false);
  const [chosen, setChosen] = useState<Set<number>>(new Set());
  const [role, setRole] = useState("");
  const [filter, setFilter] = useState("");
  const [intent, setIntent] = useState<string | null>(null);
  const [roles, setRoles] = useState<string[]>([]);

  useEffect(() => {
    void (async () => {
      setMembers(await bundleMembers(exec, bundleId));
      setAll(await listAssets(exec));
      const [row] = await exec(
        `SELECT intent FROM ${q("bundle")} WHERE id = ?`, [bundleId]);
      setIntent(row?.["intent"] === null || row?.["intent"] === undefined
        ? null : String(row["intent"]));
      setRoles(await columnValues(exec, "bundle_asset", "role_in_bundle"));
    })();
  }, [bundleId, revision]);

  const roleListId = `bundle-roles-${bundleId}`;

  const inBundle = useMemo(
    () => new Set(members.map((m) => m.assetId)), [members]);

  const candidates = useMemo(() => {
    const text = filter.trim().toLowerCase();
    return all.filter((a) => {
      if (inBundle.has(a.id)) return false;
      if (text === "") return true;
      return `${a.name ?? ""} ${a.identifier ?? ""}`.toLowerCase()
        .includes(text);
    });
  }, [all, inBundle, filter]);

  const add = (): void => {
    void (async () => {
      const plan = await planBundleAdd(exec, bundleId, [...chosen]);
      const typed = adoptSpelling(role, roles);
      await applyBundleAdd(exec, bundleId, plan.add,
                           typed === "" ? null : typed);
      setChosen(new Set());
      setPicking(false);
      setRole("");
      noteWrite();
    })();
  };

  const toggle = (id: number): void => setChosen((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });

  return (
    <section className="bundle-assets">
      <datalist id={roleListId}>
        {roles.map((r) => <option key={r} value={r} />)}
      </datalist>
      <BundleReachSection bundleId={bundleId} />
      <h4>Assets in this bundle</h4>

      {members.length === 0 && (
        <p className="muted">
          Nothing yet. A bundle with no assets resolves to nothing.
        </p>
      )}

      <ul className="bundle-member-list">
        {members.map((m) => (
          <li key={m.linkId}>
            <AssetThumb identifier={m.identifier} size="sm"
                        alt={m.assetName ?? `#${m.assetId}`}
                        onClick={() => {
                          void openEntityRow("asset", m.assetId);
                        }} />
            <button className="ghost tiny bundle-member-name"
                    onClick={() => { void openEntityRow("asset",
                                                        m.assetId); }}>
              {m.assetName ?? `#${m.assetId}`}
            </button>
            <span className="mono muted bundle-member-id">
              {m.identifier ?? "no identifier"}
            </span>
            {intentConflict(intent, mediaKindOf(m.identifier)) !== null && (
              <span className="bundle-member-conflict"
                    title={intentConflict(intent,
                                          mediaKindOf(m.identifier)) ?? ""}>
                wrong kind for {intent}
              </span>
            )}
            <input className="bundle-member-role"
                   placeholder="role"
                   list={roleListId}
                   defaultValue={m.role ?? ""}
                   key={`${m.linkId}-${m.role ?? ""}`}
                   onBlur={(e) => {
                     void (async () => {
                       const typed = adoptSpelling(e.target.value, roles);
                       if (typed === (m.role ?? "")) return;
                       await setMemberRole(exec, m.linkId, typed);
                       setMembers(await bundleMembers(exec, bundleId));
                       noteWrite();
                     })();
                   }} />
            <button className="ghost tiny"
                    title="Remove from this bundle. The asset itself stays."
                    onClick={() => {
                      void (async () => {
                        await removeBundleMember(exec, m.linkId);
                        setMembers(await bundleMembers(exec, bundleId));
                        noteWrite();
                      })();
                    }}>×</button>
          </li>
        ))}
      </ul>

      {!picking && (
        <button className="tiny" onClick={() => setPicking(true)}>
          Add assets…
        </button>
      )}

      {picking && (
        <div className="bundle-picker">
          <input placeholder="filter assets" value={filter}
                 onChange={(e) => setFilter(e.target.value)} />
          <ul className="bundle-picker-list">
            {candidates.slice(0, 200).map((a) => (
              <li key={a.id}>
                <label>
                  <input type="checkbox" checked={chosen.has(a.id)}
                         onChange={() => toggle(a.id)} />
                  <AssetThumb identifier={a.identifier} size="sm"
                              alt={a.name ?? `#${a.id}`} />
                  <span>{a.name ?? `#${a.id}`}</span>
                  <span className="mono muted">{a.identifier ?? ""}</span>
                </label>
              </li>
            ))}
            {candidates.length === 0 && (
              <li className="muted">
                {all.length === 0
                  ? "No assets in this file yet."
                  : "Every matching asset is already in this bundle."}
              </li>
            )}
          </ul>
          <div className="bundle-picker-actions">
            <input placeholder="role for all (optional)" value={role}
                   list={roleListId}
                   onChange={(e) => setRole(e.target.value)} />
            <button className="tiny primary" disabled={chosen.size === 0}
                    onClick={add}>
              Add {chosen.size}
            </button>
            <button className="ghost tiny"
                    onClick={() => { setPicking(false);
                                     setChosen(new Set()); }}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

/** The reverse view, on the asset row: where does this thing get used? */
export function AssetBundles({ assetId }: { assetId: number }): JSX.Element {
  const { openEntityRow, revision } = useStore();
  const [rows, setRows] = useState<Awaited<
    ReturnType<typeof bundlesForAsset>>>([]);
  const [unbound, setUnbound] = useState<ReadonlySet<number>>(new Set());

  useEffect(() => {
    void (async () => {
      setRows(await bundlesForAsset(exec, assetId));
      setUnbound(await unboundBundleIds(exec, registry));
    })();
  }, [assetId, revision]);

  // In bundles, and every one of them bound to nothing: referenced, so
  // not an orphan (§8.6), and still reachable by no media query.
  const unreachable = rows.length > 0
    && rows.every((b) => unbound.has(b.bundleId));

  return (
    <section className="asset-bundles">
      <h4>Bundles</h4>
      {rows.length === 0
        ? (
          <p className="muted">
            In no bundle, so nothing resolves to it. Add it from a
            bundle, or from the Assets tab.
          </p>
        )
        : (
          <>
          {unreachable && (
            <p className="bundle-unbound">
              Every bundle holding this asset is bound to nothing, so no
              subject resolves to it.
            </p>
          )}
          <ul className="bundle-member-list">
            {rows.map((b) => (
              <li key={b.bundleId}>
                <button className="ghost tiny bundle-member-name"
                        onClick={() => { void openEntityRow("bundle",
                                                            b.bundleId); }}>
                  {b.name ?? `#${b.bundleId}`}
                </button>
                <span className="muted">{b.intent ?? "no intent"}</span>
                {b.role !== null && (
                  <span className="muted">{b.role}</span>
                )}
                {unbound.has(b.bundleId) && (
                  <span className="bundle-member-conflict">
                    bound to nothing
                  </span>
                )}
              </li>
            ))}
          </ul>
          </>
        )}
    </section>
  );
}
