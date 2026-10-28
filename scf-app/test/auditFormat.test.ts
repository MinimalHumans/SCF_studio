// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "vitest";
import {
  actionLabel, baseName, buildFilter, formatTime, NO_CONTROLS, shortUuid,
} from "../src/state/auditFormat.ts";

const now = new Date(2026, 9, 28, 15, 0, 0);

describe("buildFilter", () => {
  test("untouched controls hide only the open/close noise", () => {
    expect(buildFilter(NO_CONTROLS, now)).toEqual({ hideLifecycle: true });
  });

  test("each control becomes its part of the query", () => {
    expect(buildFilter({
      scope: "project", actor: "agent", project: "C:\\a\\b.scf",
      search: "  name ", range: "all", showLifecycle: true,
      targetUuid: "abc",
    }, now)).toEqual({
      scope: "project", actorKind: "agent", projectPath: "C:\\a\\b.scf",
      search: "name", targetUuid: "abc",
    });
  });

  test("a range counts back from now", () => {
    const f = buildFilter({ ...NO_CONTROLS, range: "day" }, now);
    expect(f.since).toBe(new Date(now.getTime() - 86_400_000).toISOString());
  });

  test("a blank search is no search", () => {
    expect(buildFilter({ ...NO_CONTROLS, search: "   " }, now).search)
      .toBeUndefined();
  });
});

describe("actionLabel", () => {
  test("record writes read the same by name or by call", () => {
    expect(actionLabel("op.record.update")).toBe("Updated");
    expect(actionLabel("call.record.update")).toBe("Updated");
    expect(actionLabel("project.open")).toBe("Opened project");
  });

  test("an action with no name of its own is shown as it is", () => {
    expect(actionLabel("call.script.commit")).toBe("call.script.commit");
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

  test("file names in either spelling, and short uuids", () => {
    expect(baseName("C:\\Users\\jesse\\Desktop\\v2.scf")).toBe("v2.scf");
    expect(baseName("/films/a.scf")).toBe("a.scf");
    expect(shortUuid("11111111-1111-4111-8111-111111111111")).toBe("11111111");
  });
});
