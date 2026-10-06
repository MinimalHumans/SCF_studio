// SPDX-License-Identifier: Apache-2.0
import { useEffect, useRef, useState } from "react";
import type { SqlValue } from "@scf-core/db.ts";
import type { FieldDef } from "@scf-core/registry.ts";
import { exec, registry, useStore } from "../../state/store.ts";
import { setField } from "../../editor/elementOps.ts";
import { Field } from "../fields/Field.tsx";

/** Quiet time after the last keystroke before a text field is written. */
const SETTLE_MS = 700;

/** Field types a writer types into; everything else commits on change. */
const TYPED = new Set(["text", "textarea", "integer", "float", "timestamp"]);

/**
 * One field of one row, saved as the writer works.
 *
 * The schema form keeps a draft and a Save button; a workspace is meant
 * to be used like a word processor, so each field writes itself — typed
 * fields once typing pauses or focus leaves, choices immediately. Only
 * THIS column is written (`setField`), so two fields saving close
 * together cannot overwrite each other.
 *
 * The local value wins while the field is focused or a write is
 * pending: the project's revision bump re-reads the row, and that read
 * must not snap the text back under the cursor.
 */
export function AutoField({ entity, id, ensure, field, value, inputId,
                            label, showHelp = true }: {
  entity: string;
  /** Null while the row does not exist yet; `ensure` makes it. */
  id: number | null;
  /** Creates the row on the first write, for one-per-character rows
   *  (a vocal profile) that should not exist until something is in them. */
  ensure?: () => Promise<number>;
  field: string;
  value: SqlValue;
  inputId?: string;
  /** Overrides the registry label where the section says it better. */
  label?: string;
  showHelp?: boolean;
}): JSX.Element | null {
  const def: FieldDef | undefined = registry.entities.get(entity)?.fields
    .find((f) => f.name === field);
  const [local, setLocal] = useState<SqlValue>(value);
  const [failed, setFailed] = useState<string | null>(null);
  const timer = useRef<number | null>(null);
  const focused = useRef(false);
  const latest = useRef<SqlValue>(value);
  const saved = useRef<SqlValue>(value);

  useEffect(() => {
    if (!focused.current && timer.current === null) {
      setLocal(value);
      latest.current = value;
      saved.current = value;
    }
  }, [value]);

  const commit = async (): Promise<void> => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    const next = latest.current;
    if ((next ?? null) === (saved.current ?? null)) return;
    try {
      const target = id ?? (ensure === undefined ? null : await ensure());
      if (target === null) throw new Error("Nothing to save this to yet.");
      await setField(exec, registry, entity, target, field, next);
      saved.current = next;
      setFailed(null);
      useStore.getState().noteWrite();
    } catch (e) {
      // Shown beside the field, and the stored value put back: a field
      // that silently keeps text the file does not have is worse than
      // one that refuses it.
      setFailed(e instanceof Error ? e.message : String(e));
      latest.current = saved.current;
      setLocal(saved.current);
    }
  };

  // Leaving the workspace mid-sentence still saves the sentence.
  useEffect(() => () => {
    if (timer.current !== null) void commit();
  }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  if (def === undefined) return null;
  const typed = TYPED.has(def.fieldType);
  const id_ = inputId ?? `ws-${entity}-${String(id ?? "new")}-${field}`;

  return (
    <div className={"ws-field" + (def.fieldType === "textarea"
                                  ? " ws-field-long" : "")}
         onFocus={() => { focused.current = true; }}
         onBlur={() => {
           focused.current = false;
           if (typed) void commit();
         }}>
      <label htmlFor={id_}>{label ?? def.label}</label>
      <Field def={def} value={local} inputId={id_}
             onChange={(v) => {
               setLocal(v);
               latest.current = v;
               if (!typed) {
                 void commit();
                 return;
               }
               if (timer.current !== null) window.clearTimeout(timer.current);
               timer.current = window.setTimeout(() => {
                 timer.current = null;
                 void commit();
               }, SETTLE_MS);
             }} />
      {failed !== null && <p className="ws-field-error" role="alert">{failed}</p>}
      {showHelp && def.helpText !== undefined && def.helpText !== "" && (
        <p className="help">{def.helpText}</p>
      )}
    </div>
  );
}
