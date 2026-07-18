import { useMemo, useState } from "react";
import { isDirty, registry, useStore } from "../state/store.ts";
import { Field } from "./fields/Field.tsx";

/**
 * The form generator — one component tree driven entirely by the registry.
 * Nothing here is hand-built per entity: tabs come from FieldDef.tab,
 * inputs from the field-type -> component map, help text rendered inline
 * (v1 buried it in tooltips; it is a third of the format's documentation).
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
    </div>
  );
}
