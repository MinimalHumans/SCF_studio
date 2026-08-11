import { useMemo, useState } from "react";
import { isDirty, registry, useStore } from "../state/store.ts";
import type { SqlValue } from "@scf-core/db.ts";
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

      {!creating && <IdentityFooter values={draft.values} id={openRow.id} />}
    </div>
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
