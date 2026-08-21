// SPDX-License-Identifier: Apache-2.0
import { useEffect, useRef } from "react";
import type { FieldDef } from "@scf-core/registry.ts";
import type { SqlValue } from "@scf-core/db.ts";
import { JsonField } from "./JsonField.tsx";
import { ReferenceField } from "./ReferenceField.tsx";

export interface FieldProps {
  def: FieldDef;
  value: SqlValue;
  onChange: (value: SqlValue) => void;
}

const str = (v: SqlValue): string =>
  v === null || v === undefined ? "" : String(v);

/** The field-type -> component map. */
export function Field(props: FieldProps): JSX.Element {
  switch (props.def.fieldType) {
    case "textarea": return <AutoGrowTextArea {...props} />;
    case "select": return <SelectField {...props} />;
    case "multiselect": return <MultiselectField {...props} />;
    case "integer": return <NumberField {...props} integer />;
    case "float": return <NumberField {...props} />;
    case "boolean": return <BooleanField {...props} />;
    case "json": return <JsonField {...props} />;
    case "reference": return <ReferenceField {...props} />;
    case "timestamp":
    case "text":
    default: return <TextField {...props} />;
  }
}

function TextField({ def, value, onChange }: FieldProps): JSX.Element {
  return (
    <input id={`f-${def.name}`} type="text" value={str(value)}
           placeholder={def.placeholder ?? ""}
           onChange={(e) =>
             onChange(e.target.value === "" ? null : e.target.value)} />
  );
}

function AutoGrowTextArea({ def, value, onChange }: FieldProps):
    JSX.Element {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el !== null) {
      el.style.height = "auto";
      el.style.height = `${el.scrollHeight + 2}px`;
    }
  }, [value]);
  return (
    <textarea id={`f-${def.name}`} ref={ref} rows={2} value={str(value)}
              placeholder={def.placeholder ?? ""}
              onChange={(e) =>
                onChange(e.target.value === "" ? null : e.target.value)} />
  );
}

function SelectField({ def, value, onChange }: FieldProps): JSX.Element {
  const options = def.options ?? [];
  // Long option lists get a datalist combobox; short ones a plain select.
  if (options.length > 12) {
    return (
      <>
        <input id={`f-${def.name}`} list={`dl-${def.name}`}
               value={str(value)}
               placeholder={def.placeholder ?? ""}
               onChange={(e) =>
                 onChange(e.target.value === "" ? null : e.target.value)} />
        <datalist id={`dl-${def.name}`}>
          {options.map((o) => <option key={o} value={o} />)}
        </datalist>
      </>
    );
  }
  return (
    <select id={`f-${def.name}`} value={str(value)}
            onChange={(e) =>
              onChange(e.target.value === "" ? null : e.target.value)}>
      <option value="">—</option>
      {options.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}

/** Stored as comma-separated text, as in v1. */
function MultiselectField({ def, value, onChange }: FieldProps):
    JSX.Element {
  const selected = new Set(
    str(value).split(",").map((s) => s.trim()).filter((s) => s !== ""));
  const toggle = (option: string): void => {
    const next = new Set(selected);
    if (next.has(option)) next.delete(option);
    else next.add(option);
    onChange(next.size === 0 ? null : [...next].join(", "));
  };
  return (
    <div className="multiselect" id={`f-${def.name}`}>
      {(def.options ?? []).map((o) => (
        <button key={o} type="button"
                className={"chip" + (selected.has(o) ? " on" : "")}
                aria-pressed={selected.has(o)}
                onClick={() => toggle(o)}>
          {o}
        </button>
      ))}
    </div>
  );
}

function NumberField({ def, value, onChange, integer = false }:
    FieldProps & { integer?: boolean }): JSX.Element {
  return (
    <input id={`f-${def.name}`} type="number"
           step={integer ? 1 : "any"} value={str(value)}
           placeholder={def.placeholder ?? ""}
           onChange={(e) => {
             const raw = e.target.value;
             if (raw === "") {
               onChange(null);
               return;
             }
             const n = integer ? parseInt(raw, 10) : parseFloat(raw);
             onChange(Number.isNaN(n) ? null : n);
           }} />
  );
}

function BooleanField({ def, value, onChange }: FieldProps): JSX.Element {
  const checked = value === 1 || value === true || value === "1";
  return (
    <label className="bool">
      <input id={`f-${def.name}`} type="checkbox" checked={checked}
             onChange={(e) => onChange(e.target.checked ? 1 : 0)} />
      <span>{checked ? "yes" : "no"}</span>
    </label>
  );
}
