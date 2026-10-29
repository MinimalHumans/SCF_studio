// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "vitest";
import {
  actionLabel, actorLabel, baseName, buildFilter, DEFAULT_CONTROLS, formatTime,
  itemLabel, parseSummary, sortEvents, splitHeadline,
} from "../src/state/eventLogFormat.ts";
import type { AuditEvent } from "@scf-host/auditStore.ts";

const now = new Date(2026, 9, 28, 15, 0, 0);

const event = (over: Partial<AuditEvent> = {}): AuditEvent => ({
  id: 1, at: "2026-10-28T12:00:00.000Z", actorKind: "user", actorName: null,
  scope: "project", projectUuid: null, projectPath: null,
  action: "op.record.update", targetEntity: null, targetUuid: null,
  summary: null, prevHash: "", hash: "", ...over,
});

describe("buildFilter", () => {
  test("defaults to all time and hides lifecycle noise", () => {
    expect(buildFilter(DEFAULT_CONTROLS, now)).toEqual({ hideLifecycle: true });
  });

  test("each control becomes its part of the query", () => {
    expect(buildFilter({
      actor: "agent", project: "C:\\a\\b.scf", search: "  name ",
      range: "all", showLifecycle: true, targetUuid: "abc", targetLabel: "Marcus Cade",
      sortKey: "time", sortDir: "desc",
    }, now)).toEqual({
      actorKind: "agent", projectPath: "C:\\a\\b.scf",
      search: "name", targetUuid: "abc",
    });
  });

  test("today counts from local midnight, not 24 hours back", () => {
    const f = buildFilter({ ...DEFAULT_CONTROLS, range: "today" }, now);
    expect(f.since).toBe(new Date(2026, 9, 28).toISOString());
  });

  test("a week counts back from now", () => {
    const f = buildFilter({ ...DEFAULT_CONTROLS, range: "week" }, now);
    expect(f.since).toBe(new Date(now.getTime() - 7 * 86_400_000).toISOString());
  });

  test("a blank search is no search", () => {
    expect(buildFilter({ ...DEFAULT_CONTROLS, search: "   " }, now).search)
      .toBeUndefined();
  });
});

describe("actorLabel", () => {
  test("names who did it in the app's own terms, not the raw actor kind", () => {
    expect(actorLabel("user")).toBe("Editor");
    expect(actorLabel("agent")).toBe("MCP");
    expect(actorLabel("external")).toBe("System");
    expect(actorLabel("media")).toBe("Media server");
  });
});

describe("actionLabel", () => {
  test("record writes read the same by name or by call", () => {
    expect(actionLabel("op.record.update")).toBe("Record Update");
    expect(actionLabel("call.record.update")).toBe("Record Update");
    expect(actionLabel("project.open")).toBe("Project Open");
  });

  test("every dotted segment is split and capitalized, nothing renamed", () => {
    expect(actionLabel("op.scene.removeCascade")).toBe("Scene Remove Cascade");
    expect(actionLabel("call.shoot.removeShot")).toBe("Shoot Remove Shot");
    expect(actionLabel("call.structure.commit")).toBe("Structure Commit");
  });

  test("no segment is dropped, since one can flip the meaning", () => {
    // "undo.delete" read as just "Delete" looks like the opposite of
    // what happened — restoring a row, not deleting one. There is no
    // curated override for this (a hand-picked word can drift from
    // the real name); the fix is that the real name itself always
    // keeps every segment.
    expect(actionLabel("call.undo.delete")).toBe("Undo Delete");
    expect(actionLabel("call.undo.change")).toBe("Undo Change");
  });
});

describe("parseSummary", () => {
  test("a field-by-field update becomes a headline and a diff", () => {
    const { headline, diff, fields } = parseSummary(
      "op.record.update",
      'character "Marcus Cade" — hair: ∅ → "short"; age: "30" → "32"',
      "character");
    expect(headline).toBe("Updated character: Marcus Cade");
    expect(diff).toEqual([
      { field: "hair", before: "(empty)", after: "short" },
      { field: "age", before: "30", after: "32" },
    ]);
    expect(fields).toEqual([]);
  });

  test("create and delete with no snapshot read as a plain sentence", () => {
    expect(parseSummary("op.record.create", 'created character "Marcus Cade"',
      "character")).toEqual({
      headline: "Created character: Marcus Cade", diff: [], fields: [],
    });
    expect(parseSummary("op.record.delete", 'deleted character "Marcus Cade"',
      "character")).toEqual({
      headline: "Deleted character: Marcus Cade", diff: [], fields: [],
    });
  });

  test("a create with nothing read back says so, not that one was made", () => {
    // `describeTarget` writes the literal word "create" (not "created")
    // when it could not read the new row back. The verb is capitalized
    // as written, never normalized to "Created" — that would claim
    // more than the data backs up.
    expect(parseSummary("op.record.create", "create character", "character"))
      .toEqual({ headline: "Create character", diff: [], fields: [] });
  });

  test("a create or delete's field snapshot becomes a field table, not a diff", () => {
    expect(parseSummary("op.record.create",
      'created character "Marcus Cade" — name: "Marcus Cade"; role: "lead"',
      "character")).toEqual({
      headline: "Created character: Marcus Cade", diff: [],
      fields: [{ field: "name", value: "Marcus Cade" }, { field: "role", value: "lead" }],
    });
    expect(parseSummary("op.record.delete",
      'deleted character "Marcus Cade" — name: "Marcus Cade"',
      "character")).toEqual({
      headline: "Deleted character: Marcus Cade", diff: [],
      fields: [{ field: "name", value: "Marcus Cade" }],
    });
  });

  test("a restored delete reads as a restore, name clickable like the rest", () => {
    const { headline, diff, fields } = parseSummary(
      "call.undo.delete", 'restored character "Marcus Cade"', "character");
    expect(headline).toBe("Restored character: Marcus Cade");
    expect(diff).toEqual([]);
    expect(fields).toEqual([]);
  });

  test("an undone change has no entity grammar to parse — shown as written", () => {
    expect(parseSummary("call.undo.change",
      "Undid: Added 2 files to Eleanor's look", null))
      .toEqual({
        headline: "Undid: Added 2 files to Eleanor's look", diff: [], fields: [],
      });
  });

  test("no field actually changed reads as such", () => {
    expect(parseSummary("op.record.update",
      'character "Marcus Cade": no field changed', "character").headline)
      .toBe("No change — character: Marcus Cade");
  });

  test("a lifecycle note with no summary falls back to the action label", () => {
    expect(parseSummary("project.close", null, null))
      .toEqual({ headline: "Project Close", diff: [], fields: [] });
  });

  test("a plain sentence outside the record grammar is shown as written", () => {
    expect(parseSummary("file.external_change",
      "noticed when window tried to write", null))
      .toEqual({ headline: "noticed when window tried to write", diff: [], fields: [] });
  });

  test("a raw argument dump becomes a headline, not a blob", () => {
    expect(parseSummary("call.scene.rename", '["uuid-1","New Name"]', "scene"))
      .toEqual({
        headline: "Scene Rename: scene", diff: [],
        fields: [{ field: "[0]", value: "uuid-1" }, { field: "[1]", value: "New Name" }],
      });
  });

  test("a write the host couldn't target still names its entity and id, "
      + "and the full arguments land in the field table", () => {
    // The shape left behind when `planTarget` misses a write (an id it
    // didn't recognize, say): targetEntity is null and the summary is
    // the raw args, but the entity and id are still sitting right there.
    expect(parseSummary("op.record.update",
      '{"entity":"character","id":5,"patch":{"age":31}}', null))
      .toEqual({
        headline: "Record Update: character #5", diff: [],
        fields: [
          { field: "entity", value: "character" }, { field: "id", value: "5" },
          { field: "patch.age", value: "31" },
        ],
      });
    expect(parseSummary("call.record.update",
      '["character",5,{"age":31}]', null))
      .toEqual({
        headline: "Record Update: character #5", diff: [],
        fields: [
          { field: "entity", value: "character" }, { field: "id", value: "5" },
          { field: "patch.age", value: "31" },
        ],
      });
  });

  test("a value that merely looks like an id is not mistaken for one", () => {
    expect(parseSummary("call.scene.rename", '["uuid-1","New Name"]', null).headline)
      .toBe("Scene Rename");
  });

  test("a write failure is shown verbatim, not re-parsed", () => {
    const summary = "failed: row not found create character";
    expect(parseSummary("op.record.create", summary, "character"))
      .toEqual({ headline: summary, diff: [], fields: [] });
  });
});

describe("splitHeadline", () => {
  test("splits the name off the end for a clickable cell", () => {
    expect(splitHeadline("Updated character: Marcus Cade"))
      .toEqual({ prefix: "Updated character: ", name: "Marcus Cade" });
  });

  test("a headline with no name has nothing to split", () => {
    expect(splitHeadline("Closed project"))
      .toEqual({ prefix: "Closed project", name: null });
  });
});

describe("itemLabel", () => {
  test("names the chip after the row, not its uuid", () => {
    expect(itemLabel("character", "Updated character: Marcus Cade"))
      .toBe("Character: Marcus Cade");
  });

  test("does not double the entity when the headline already names it", () => {
    expect(itemLabel("character", "Updated: character #5")).toBe("Character #5");
  });

  test("falls back to the whole headline when there is no name to split off", () => {
    expect(itemLabel(null, "Closed project")).toBe("Closed project");
  });
});

describe("sortEvents", () => {
  const events = [
    event({ id: 1, at: "2026-10-28T10:00:00.000Z", actorKind: "agent",
             action: "project.open", projectPath: "C:\\b.scf" }),
    event({ id: 2, at: "2026-10-28T12:00:00.000Z", actorKind: "user",
             action: "op.record.create", projectPath: "C:\\a.scf" }),
  ];

  test("time, descending by default", () => {
    expect(sortEvents(events, "time", "desc").map((e) => e.id)).toEqual([2, 1]);
    expect(sortEvents(events, "time", "asc").map((e) => e.id)).toEqual([1, 2]);
  });

  test("who ranks the user ahead of an assistant", () => {
    expect(sortEvents(events, "who", "asc").map((e) => e.id)).toEqual([2, 1]);
  });

  test("project sorts by file name", () => {
    expect(sortEvents(events, "project", "asc").map((e) => e.id)).toEqual([2, 1]);
  });

  test("sorting does not mutate the input", () => {
    const copy = [...events];
    sortEvents(events, "time", "asc");
    expect(events).toEqual(copy);
  });
});

describe("formatting", () => {
  test("today is a time, another day carries its date", () => {
    expect(formatTime(new Date(2026, 9, 28, 9, 5, 7).toISOString(), now))
      .toBe("09:05:07");
    expect(formatTime(new Date(2026, 9, 27, 23, 59, 1).toISOString(), now))
      .toBe("Oct 27 23:59:01");
  });

  test("a bad time is left alone", () => {
    expect(formatTime("not a time", now)).toBe("not a time");
  });

  test("file names in either spelling", () => {
    expect(baseName("C:\\Users\\jesse\\Desktop\\v2.scf")).toBe("v2.scf");
    expect(baseName("/films/a.scf")).toBe("a.scf");
  });
});
