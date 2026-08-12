import { useEffect, useMemo, useState } from "react";
import { isDirty, registry, useStore } from "../state/store.ts";
import type { SqlValue } from "@scf-core/db.ts";
import {
  resolveIdentifier, type Resolution, type ResolutionState,
} from "@scf-core/assets.ts";
import { makeLocator } from "../files/assetLocator.ts";
import { Field } from "./fields/Field.tsx";

/**
 * The form generator — one component tree driven entirely by the registry.
 * Nothing here is hand-built per entity: tabs come from FieldDef.tab,
 * inputs from the field-type -> component map, help text rendered inline
 * (v1 buried it in tooltips; it is a third of the format's documentation).
 *
 * The footer shows the row's identity. `uuid` is a framework column on
 * all 99 entities (conventions §5) and is what survives export and
 * re-import, but it is hidden from the field list, so until now the only
 * way to see one was to open the file in a SQL client. It is read-only
 * here — identity is minted, never typed — and one click copies it.
 */
export function EntityForm(): JSX.Element | null {
  const { openRow, draft, setDraftValue, undoDraft, saveDraft, closeRow,
          deleteRow } = useStore();
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const edef = openRow !== null
    ? registry.entities.get(openRow.entity) : undefined;

  const tabs = useMemo(() => {
    if (edef === undefined) return [];
    const seen: string[] = [];
    for (const f of edef.fields) {
      if (f.hidden !== true && !seen.includes(f.tab)) seen.push(f.tab);
    }
    return seen;
  }, [edef]);

  if (openRow === null || draft === null || edef === undefined) return null;
  const tab = activeTab !== null && tabs.includes(activeTab)
    ? activeTab : tabs[0] ?? "General";
  const dirty = isDirty(draft);
  const creating = openRow.id === null;

  return (
    <div className="entity-form">
      <header className="form-header">
        <span className="tree-icon">{edef.icon}</span>
        <h2>
          {creating ? `New ${edef.label.toLowerCase()}` : edef.label}
          {dirty && <span className="dirty-dot" title="Unsaved changes" />}
        </h2>
        <div className="form-actions">
          <button onClick={undoDraft}
                  disabled={draft.undoStack.length === 0}>
            Undo
          </button>
          <button className="primary" disabled={!dirty && !creating}
                  onClick={() => void saveDraft()}>
            {creating ? "Create" : "Save changes"}
          </button>
          {!creating && (
            <button className="danger"
                    onClick={() => {
                      if (window.confirm(
                        `Delete this ${edef.label.toLowerCase()}? ` +
                        `Rows that reference it keep their reference.`)) {
                        void deleteRow(openRow.entity, openRow.id as number);
                      }
                    }}>
              Delete
            </button>
          )}
          <button className="ghost" onClick={closeRow}>Close</button>
        </div>
      </header>

      <div className="form-tabs" role="tablist">
        {tabs.map((t) => (
          <button key={t} role="tab" aria-selected={t === tab}
                  className={t === tab ? "active" : ""}
                  onClick={() => setActiveTab(t)}>
            {t}
          </button>
        ))}
      </div>

      <div className="form-fields">
        {edef.fields
          .filter((f) => f.hidden !== true && f.tab === tab)
          .map((f) => (
            <div key={f.name} className="field">
              <label htmlFor={`f-${f.name}`}>
                {f.label}
                {f.required && <span className="required">*</span>}
                {f.autoInjected && (
                  <span className="injected" title="Framework field">fw</span>
                )}
              </label>
              <Field def={f} value={draft.values[f.name] ?? null}
                     onChange={(v) => setDraftValue(f.name, v)} />
              {f.helpText !== undefined && f.helpText !== "" && (
                <p className="help">{f.helpText}</p>
              )}
            </div>
          ))}
      </div>

      {!creating && openRow.entity === "asset" && (
        <AssetResolution identifier={draft.values["identifier"]} />
      )}
      {!creating && <IdentityFooter values={draft.values} id={openRow.id} />}
    </div>
  );
}

const STATE_LABEL: Record<ResolutionState, string> = {
  resolved: "resolved",
  missing: "missing",
  unmaterialised: "not downloaded",
  "out-of-root": "outside the project",
  unaddressed: "no identifier",
};

/**
 * Where this asset's identifier actually points, shown on the row that
 * owns it.
 *
 * It lived only in the diagnostics panel at first, which was the wrong
 * place: resolution is a property of the row, and someone editing an
 * identifier wants to know whether it lands without going to look
 * somewhere else. Derived on every render of the field — never stored
 * (conventions §2, §9).
 */
function AssetResolution({ identifier }: {
  identifier: SqlValue | undefined;
}): JSX.Element | null {
  const { projectRoot } = useStore();
  const [state, setState] = useState<Resolution | null>(null);
  const raw = identifier === null || identifier === undefined
    ? null : String(identifier);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const root = projectRoot as FileSystemDirectoryHandle | null;
      const r = await resolveIdentifier(raw, makeLocator(root));
      if (!cancelled) setState(r);
    })();
    return () => { cancelled = true; };
  }, [raw, projectRoot]);

  if (state === null) return null;

  const size = state.sizeBytes === null
    ? null : `${Math.round(state.sizeBytes / 1024).toLocaleString()} KB`;

  return (
    <footer className={`form-resolution form-resolution-${state.state}`}>
      <span className="muted">resolves</span>
      <span>{STATE_LABEL[state.state]}</span>
      {size !== null && <span className="muted">{size}</span>}
      {state.format !== null && (
        <span className="muted mono">{state.format}</span>
      )}
      {state.detail !== null && (
        <span className="form-resolution-detail">{state.detail}</span>
      )}
      {projectRoot === null && state.state === "missing" && (
        <span className="form-resolution-detail">
          — this session has no project folder attached, so nothing can
          resolve
        </span>
      )}
    </footer>
  );
}

/**
 * Read-only identity, at the bottom of every saved row: the local id
 * (meaningless outside this file) and the uuid (the one that isn't).
 */
function IdentityFooter({ values, id }: {
  values: Record<string, SqlValue>;
  id: number | null;
}): JSX.Element {
  const [copied, setCopied] = useState(false);
  const raw = values["uuid"];
  const uuid = raw === null || raw === undefined || raw === ""
    ? null : String(raw);

  return (
    <footer className="form-identity">
      <span className="muted">row</span>
      <span className="mono">#{id}</span>
      <span className="muted">uuid</span>
      {uuid === null
        ? <span className="identity-finding">none — this row has no
            cross-file identity</span>
        : (
          <>
            <span className="mono">{uuid}</span>
            <button className="ghost tiny"
                    onClick={() => {
                      void navigator.clipboard.writeText(uuid);
                      setCopied(true);
                      window.setTimeout(() => setCopied(false), 1200);
                    }}>
              {copied ? "copied" : "copy"}
            </button>
          </>
        )}
    </footer>
  );
}
