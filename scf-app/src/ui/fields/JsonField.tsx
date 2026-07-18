import { useState } from "react";
import type { FieldDef } from "@scf-core/registry.ts";
import type { SqlValue } from "@scf-core/db.ts";

/**
 * JSON fields have known shapes documented in help_text (design doc):
 * string arrays (palette / material lists) get a chips editor, flat
 * objects of scalars (modulations / emotional_manifestations) get a
 * key-value grid, and anything else — or on demand — the raw-JSON escape
 * hatch. Which editor applies is detected from the value, not hand-coded
 * per field.
 */
export function JsonField({ def, value, onChange }: {
  def: FieldDef; value: SqlValue; onChange: (v: SqlValue) => void;
}): JSX.Element {
  const [forceRaw, setForceRaw] = useState(false);
  const text = value === null || value === undefined ? "" : String(value);

  let parsed: unknown = undefined;
  let valid = true;
  if (text.trim() !== "") {
    try {
      parsed = JSON.parse(text);
    } catch {
      valid = false;
    }
  }

  const isStringArray = Array.isArray(parsed) &&
    parsed.every((x) => typeof x === "string");
  const isFlatObject = parsed !== null && typeof parsed === "object" &&
    !Array.isArray(parsed) &&
    Object.values(parsed as object).every(
      (v) => ["string", "number", "boolean"].includes(typeof v));

  const editor = forceRaw || !valid ? "raw"
    : isStringArray || text.trim() === "" && looksListy(def) ? "chips"
    : isFlatObject ? "kv"
    : "raw";

  return (
    <div className="json-field">
      {editor === "chips" && (
        <ChipsEditor items={isStringArray ? parsed as string[] : []}
                     onChange={(items) =>
                       onChange(items.length === 0
                         ? null : JSON.stringify(items))} />
      )}
      {editor === "kv" && (
        <KvEditor obj={parsed as Record<string, unknown>}
                  onChange={(obj) =>
                    onChange(Object.keys(obj).length === 0
                      ? null : JSON.stringify(obj))} />
      )}
      {editor === "raw" && (
        <textarea id={`f-${def.name}`} rows={3} value={text}
                  className={valid ? "" : "invalid"}
                  placeholder={def.placeholder !== "" ? def.placeholder
                    : '{"key": "value"} or ["item", "item"]'}
                  onChange={(e) =>
                    onChange(e.target.value === ""
                      ? null : e.target.value)} />
      )}
      <div className="json-meta">
        {!valid && <span className="invalid-note">not valid JSON yet</span>}
        <button type="button" className="ghost tiny"
                onClick={() => setForceRaw((r) => !r)}>
          {editor === "raw" && valid && !forceRaw
            ? "" : forceRaw ? "structured editor" : "raw JSON"}
        </button>
      </div>
    </div>
  );
}

/** Empty JSON fields whose docs read like lists default to chips. */
function looksListy(def: FieldDef): boolean {
  const hint = `${def.name} ${def.helpText ?? ""}`.toLowerCase();
  return ["palette", "list", "array", "colors", "materials", "words"]
    .some((k) => hint.includes(k));
}

function ChipsEditor({ items, onChange }: {
  items: string[]; onChange: (items: string[]) => void;
}): JSX.Element {
  const [entry, setEntry] = useState("");
  const add = (): void => {
    const v = entry.trim();
    if (v !== "" && !items.includes(v)) onChange([...items, v]);
    setEntry("");
  };
  return (
    <div className="chips-editor">
      {items.map((item) => (
        <span key={item} className="chip on">
          {item}
          <button type="button" aria-label={`Remove ${item}`}
                  onClick={() =>
                    onChange(items.filter((x) => x !== item))}>
            ×
          </button>
        </span>
      ))}
      <input value={entry} placeholder="add + Enter"
             onChange={(e) => setEntry(e.target.value)}
             onKeyDown={(e) => {
               if (e.key === "Enter") {
                 e.preventDefault();
                 add();
               }
             }}
             onBlur={add} />
    </div>
  );
}

function KvEditor({ obj, onChange }: {
  obj: Record<string, unknown>;
  onChange: (obj: Record<string, unknown>) => void;
}): JSX.Element {
  const [newKey, setNewKey] = useState("");
  const entries = Object.entries(obj);
  return (
    <div className="kv-editor">
      {entries.map(([k, v]) => (
        <div key={k} className="kv-row">
          <span className="kv-key">{k}</span>
          <input value={String(v)}
                 onChange={(e) =>
                   onChange({ ...obj, [k]: e.target.value })} />
          <button type="button" aria-label={`Remove ${k}`}
                  onClick={() => {
                    const next = { ...obj };
                    delete next[k];
                    onChange(next);
                  }}>
            ×
          </button>
        </div>
      ))}
      <div className="kv-row">
        <input className="kv-newkey" value={newKey} placeholder="new key"
               onChange={(e) => setNewKey(e.target.value)}
               onKeyDown={(e) => {
                 if (e.key === "Enter" && newKey.trim() !== "") {
                   e.preventDefault();
                   onChange({ ...obj, [newKey.trim()]: "" });
                   setNewKey("");
                 }
               }} />
      </div>
    </div>
  );
}
