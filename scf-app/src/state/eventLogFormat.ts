// SPDX-License-Identifier: Apache-2.0
/**
 * eventLogFormat.ts — what the event log viewer shows, apart from showing
 * it: the filter the controls describe, how an event reads in a row, and
 * how its summary reads as a headline plus a before/after diff.
 */

import type {
  AuditActor, AuditEvent, AuditFilter,
} from "@scf-host/auditStore.ts";

export type EventRange = "hour" | "today" | "week" | "all";
/** "" is Anyone; set by clicking an actor badge in the Who column,
 *  same as the Project column sets the project filter. */
export type EventActor = "" | AuditActor;
export type EventSortKey = "time" | "who" | "what" | "project";
export type EventSortDir = "asc" | "desc";

/** What the viewer's controls say, before it is a query. */
export interface EventLogControls {
  actor: EventActor;
  /** A project's path, or "" for all. Set by clicking a row's project. */
  project: string;
  search: string;
  range: EventRange;
  /** Open, close and reload events, which bury the changes. */
  showLifecycle: boolean;
  /** Only the events on one row, by uuid. */
  targetUuid: string | null;
  /** How that row reads in the chip ("Character: Marcus Cade"), captured
   *  from the row clicked rather than looked up again by uuid. */
  targetLabel: string | null;
  sortKey: EventSortKey;
  sortDir: EventSortDir;
}

export const DEFAULT_CONTROLS: EventLogControls = {
  actor: "", project: "", search: "", range: "all",
  showLifecycle: false, targetUuid: null, targetLabel: null,
  sortKey: "time", sortDir: "desc",
};

const RANGE_MS: Record<"hour" | "week", number> = {
  hour: 3_600_000, week: 7 * 86_400_000,
};

function startOfToday(now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

export function buildFilter(c: EventLogControls, now: Date): AuditFilter {
  const search = c.search.trim();
  const since = c.range === "all" ? undefined
    : c.range === "today" ? startOfToday(now).toISOString()
    : new Date(now.getTime() - RANGE_MS[c.range]).toISOString();
  return {
    ...(c.actor === "" ? {} : { actorKind: c.actor }),
    ...(c.project === "" ? {} : { projectPath: c.project }),
    ...(search === "" ? {} : { search }),
    ...(since === undefined ? {} : { since }),
    ...(c.showLifecycle ? {} : { hideLifecycle: true }),
    ...(c.targetUuid === null ? {} : { targetUuid: c.targetUuid }),
  };
}

/** "user" is the window itself, never a login a person would recognize
 *  by that name — these name who actually did it, in the app's own
 *  terms: the editor, an assistant over MCP, something outside either. */
const ACTOR_LABELS: Record<AuditActor, string> = {
  user: "Editor", agent: "MCP", external: "System", media: "Media server",
};

export function actorLabel(kind: AuditActor): string {
  return ACTOR_LABELS[kind];
}

/** "undo.removeShot" -> "Undo Remove Shot"; "rename" -> "Rename". Every
 *  dotted segment matters — dropping any of them can flip the meaning
 *  (an "undo.delete" that read as "Delete" looked like the opposite of
 *  what happened), so none are dropped, only turned into words. No
 *  curated synonyms either: a hand-picked word ("Restored") can drift
 *  from what the action is actually called, or just be missing for
 *  whatever this hasn't been told about yet. This is always the real
 *  name, just split and capitalized — accurate by construction. */
function humanize(path: string): string {
  return path
    .split(".")
    .flatMap((seg) => seg.replace(/([a-z0-9])([A-Z])/g, "$1 $2").split(/[\s_]+/))
    .filter((w) => w !== "")
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join(" ");
}

/** The action's real name, read out loud: every dotted segment turned
 *  into words, nothing renamed or dropped. */
export function actionLabel(action: string): string {
  return humanize(action.replace(/^(op|call)\./, ""));
}

/** Actions whose summary follows the "entity label [— field changes]"
 *  grammar written by scf-host's `describeTarget` — the only shapes this
 *  module knows how to turn into a headline and a diff table. Everything
 *  else (lifecycle notes, failures, raw argument dumps) is shown as the
 *  plain sentence it already is, or falls back to the action's label. */
const STRUCTURED = new Set([
  "record.create", "record.update", "record.delete",
  "element.setField", "shoot.updateField", "undo.delete",
]);

export interface EventDiffRow { field: string; before: string; after: string }
export interface EventFieldRow { field: string; value: string }
export interface EventSummary {
  headline: string;
  diff: EventDiffRow[];
  /** The write's full arguments, flattened to rows, when the summary was
   *  the raw argument dump rather than a sentence: a nice table beats
   *  both a wall of JSON and losing the data outright. */
  fields: EventFieldRow[];
}

/** Undo `auditTarget.ts`'s `show()`: strip the quoting back off a value,
 *  and spell out its "no value" marker. */
function label(raw: string): string {
  const v = raw.trim();
  if (v === "∅") return "(empty)";
  if (v.startsWith('"') && v.endsWith('"')) {
    try { return JSON.parse(v) as string; } catch { /* keep as written */ }
  }
  return v;
}

const cap = (s: string): string => s.length === 0 ? s : s[0]!.toUpperCase() + s.slice(1);

/** `"character \"Marcus Cade\""` under a verb reads as `Created
 *  character: Marcus Cade`; with no verb word, `Updated` is assumed.
 *  The verb is capitalized, never substituted: `describeTarget` writes
 *  "create" (not "created") for the one case with no row to read back
 *  (a create whose write failed), and that distinction is real — it
 *  says a row could not be confirmed, not that one was made. */
function headlineFor(verb: string, entityAndLabel: string): string {
  const m = /^(\S+)\s+(.+)$/.exec(entityAndLabel);
  return m === null ? `${verb} ${entityAndLabel}` : `${verb} ${m[1]}: ${label(m[2]!)}`;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
/** A plausible id: a number, or a digit-only string (ids travel as
 *  numbers over `op`, and MCP tool calls sometimes stringify them) —
 *  never arbitrary text like a new name or a patch value. */
const idLike = (v: unknown): v is string | number =>
  typeof v === "number" || (typeof v === "string" && /^\d+$/.test(v));

/**
 * When the host couldn't tell which row a write touched (an id shaped
 * oddly, an entity it didn't recognize — still a real write, just one
 * the audit trail's own target-tracking missed), its summary is the
 * raw call arguments rather than a sentence. There is no describing an
 * arbitrary write's arguments in general, but `op.*` and `call.*` calls
 * that name an entity and an id are the overwhelming common case, and
 * that much can be lifted straight out of the JSON instead of showing
 * it verbatim or dropping it on the floor.
 */
function gleanArgs(
    action: string, raw: string): { entity: string | null; id: string | number | null } {
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return { entity: null, id: null }; }
  if (action.startsWith("call.") && Array.isArray(parsed)) {
    const [entity, id] = parsed as unknown[];
    return { entity: typeof entity === "string" ? entity : null,
             id: idLike(id) ? id : null };
  }
  if (isRecord(parsed)) {
    return { entity: typeof parsed["entity"] === "string" ? parsed["entity"] : null,
             id: idLike(parsed["id"]) ? parsed["id"] : null };
  }
  return { entity: null, id: null };
}

const show = (v: unknown): string => {
  if (v === null || v === undefined) return "(empty)";
  if (typeof v === "object") return Array.isArray(v) && v.length === 0 ? "[]"
    : Object.keys(v as object).length === 0 ? "{}" : "";
  return String(v);
};

/** Flattens parsed JSON into rows a table can show: nested objects as
 *  dotted keys ("patch.age"), arrays by index. A call's positional args
 *  are named `entity`/`id`/`patch` (or `field`/`value`) when the action
 *  is one `gleanArgs` already knows the shape of; anything else keeps
 *  its bare position, which is still legible, just not labelled. */
function flattenFields(action: string, parsed: unknown): EventFieldRow[] {
  const bare = action.replace(/^(op|call)\./, "");
  const named = action.startsWith("call.") && Array.isArray(parsed) && STRUCTURED.has(bare)
    ? (bare === "element.setField" || bare === "shoot.updateField"
        ? { entity: parsed[0], id: parsed[1], field: parsed[2], value: parsed[3] }
        : { entity: parsed[0], id: parsed[1], ...(parsed[2] === undefined
            ? {} : { patch: parsed[2] }) })
    : parsed;

  const rows: EventFieldRow[] = [];
  const walk = (v: unknown, prefix: string): void => {
    if (isRecord(v) && Object.keys(v).length > 0) {
      for (const [k, sub] of Object.entries(v)) {
        walk(sub, prefix === "" ? k : `${prefix}.${k}`);
      }
    } else if (Array.isArray(v) && v.length > 0) {
      v.forEach((sub, i) => walk(sub, `${prefix}[${String(i)}]`));
    } else {
      rows.push({ field: prefix, value: show(v) });
    }
  };
  walk(named, "");
  return rows;
}

function parseJson(raw: string): unknown {
  try { return JSON.parse(raw); } catch { return undefined; }
}

/** The event's summary as a headline sentence, plus either a before/after
 *  diff (a real field-by-field change) or a flattened field table (the
 *  write's raw arguments, when that is all there was to show). Never a
 *  raw action id or a wall of JSON — those fall back to `actionLabel`,
 *  filled out with whatever entity and id can be lifted from the
 *  arguments. */
export function parseSummary(
    action: string, summary: string | null, targetEntity: string | null,
): EventSummary {
  const fallback = (glean: { entity: string | null; id: string | number | null }
      = { entity: null, id: null }, fields: EventFieldRow[] = []): EventSummary => {
    const entity = targetEntity ?? glean.entity;
    const id = glean.id === null ? "" : ` #${String(glean.id)}`;
    return {
      headline: actionLabel(action) + (entity === null ? "" : `: ${entity}${id}`),
      diff: [], fields,
    };
  };
  if (summary === null || summary === "") return fallback();
  if (summary.startsWith("failed: ")) return { headline: summary, diff: [], fields: [] };
  if (summary === "null") return fallback();
  const bare = action.replace(/^(op|call)\./, "");
  if (/^[[{]/.test(summary)) {
    // The entity+id convention below only holds for the ops that
    // actually address one row by (entity, id); for anything else,
    // array[0] being a string proves nothing about what it names.
    const parsed = parseJson(summary);
    return fallback(
      STRUCTURED.has(bare) ? gleanArgs(action, summary) : undefined,
      parsed === undefined ? [] : flattenFields(action, parsed));
  }
  if (!STRUCTURED.has(bare)) return { headline: summary, diff: [], fields: [] };

  const dash = summary.indexOf(" — ");
  const headPart = dash === -1 ? summary : summary.slice(0, dash);
  const diffPart = dash === -1 ? null : summary.slice(dash + 3);

  const noChange = /^(.+): no field changed$/.exec(headPart);
  const verbed = noChange === null
    ? /^(created|create|deleted|changed|restored)\s+(.+)$/.exec(headPart) : null;

  const headline = noChange !== null
    ? headlineFor("No change —", noChange[1]!)
    : verbed !== null
    ? headlineFor(cap(verbed[1]!), verbed[2]!)
    : headlineFor("Updated", headPart);

  // A change has a before and an after to show as a diff; a create or
  // delete has only the one value the row held, which reads better as
  // a field table than as a diff with an empty side.
  const diff: EventDiffRow[] = [];
  const fields: EventFieldRow[] = [];
  if (diffPart !== null) {
    for (const part of diffPart.split("; ")) {
      const changed = /^(.+): (.+) → (.+)$/.exec(part);
      if (changed !== null) {
        diff.push({ field: changed[1]!, before: label(changed[2]!), after: label(changed[3]!) });
        continue;
      }
      const valued = /^(.+): (.+)$/.exec(part);
      if (valued !== null) fields.push({ field: valued[1]!, value: label(valued[2]!) });
    }
  }
  return { headline, diff, fields };
}

/** Splits a headline's trailing name off from the rest ("Updated
 *  character: " / "Marcus Cade"), so the row can make just the name
 *  clickable — the way the Project column makes just the file name
 *  clickable — rather than the whole sentence or nothing at all. */
export function splitHeadline(
    headline: string): { prefix: string; name: string | null } {
  const idx = headline.lastIndexOf(": ");
  return idx === -1 ? { prefix: headline, name: null }
    : { prefix: headline.slice(0, idx + 2), name: headline.slice(idx + 2) };
}

/** What to put in the "Only this item" chip: the row's own name, not
 *  its uuid — "Character: Marcus Cade", lifted from the headline
 *  already computed for it. Falls back to the whole headline when
 *  there was no name to split off (a lifecycle note, a raw-args event
 *  with no better name than "character #5"). */
export function itemLabel(targetEntity: string | null, headline: string): string {
  const idx = headline.lastIndexOf(": ");
  const name = idx === -1 ? headline : headline.slice(idx + 2);
  if (targetEntity === null || name.toLowerCase().startsWith(targetEntity.toLowerCase())) {
    return cap(name);
  }
  return `${cap(targetEntity)}: ${name}`;
}

const ACTOR_RANK: Record<AuditActor, number> = {
  user: 0, agent: 1, external: 2, media: 3,
};

/** Sorts the already-loaded page; the query underneath always fetches
 *  newest-first so paging and the live poll keep their place. */
export function sortEvents(
    events: AuditEvent[], key: EventSortKey, dir: EventSortDir,
): AuditEvent[] {
  const sign = dir === "asc" ? 1 : -1;
  const cmp: Record<EventSortKey, (a: AuditEvent, b: AuditEvent) => number> = {
    time: (a, b) => a.at.localeCompare(b.at),
    who: (a, b) => ACTOR_RANK[a.actorKind] - ACTOR_RANK[b.actorKind] ||
      (a.actorName ?? "").localeCompare(b.actorName ?? ""),
    what: (a, b) => actionLabel(a.action).localeCompare(actionLabel(b.action)),
    project: (a, b) =>
      (a.projectPath === null ? "" : baseName(a.projectPath))
        .localeCompare(b.projectPath === null ? "" : baseName(b.projectPath)),
  };
  return [...events].sort((a, b) => sign * cmp[key](a, b));
}

const pad = (n: number): string => String(n).padStart(2, "0");
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug",
                "Sep", "Oct", "Nov", "Dec"];

/** Local time; the date too when it is not today. */
export function formatTime(iso: string, now: Date): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}:${
    pad(d.getSeconds())}`;
  const today = d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  return today ? time : `${MONTHS[d.getMonth()]!} ${String(d.getDate())} ${time}`;
}

/** The file name of a path in either spelling. */
export function baseName(path: string): string {
  return path.split(/[\\/]/).filter((p) => p !== "").pop() ?? path;
}
