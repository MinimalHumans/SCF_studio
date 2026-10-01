// SPDX-License-Identifier: Apache-2.0
/**
 * lines.test.ts — spec §3.5 (line anchors) and §4.7 (the lines a shot
 * covers).
 *
 * The fixture's scene 3 shots carry ranges that overlap on purpose, the
 * way a scene is covered: 3A is the wide master over the whole scene,
 * 3B the doorway exchange, 3C her hands at the tap, 3D the last line
 * alone. Scene 12 records no ranges, so 12-04 is the unrecorded case. The
 * two clips cover the lines their names say, through the take 12-04 now
 * owns.
 *
 * Findings are checked two-sided on a copy of the fixture: absent from
 * the fixture, raised once the condition is written into the copy.
 */
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { collectFindings } from "../src/findings.ts";
import {
  lineAnchorFields, rangeEntities, rangeLines,
} from "../src/lines.ts";
import { openNodeDatabase } from "../src/node.ts";
import type { ScfContext } from "../src/resolution.ts";
import { shotContext } from "../src/shotContext.ts";
import { FIXTURE_PATH, openFixture, registry, type Fixture } from "./setup.ts";

let fx: Fixture;
let sandbox: string;
const L = (n: number) => `00000000-0000-4000-9000-${String(n).padStart(12, "0")}`;

beforeAll(() => {
  fx = openFixture();
  sandbox = mkdtempSync(join(tmpdir(), "scf-lines-"));
});
afterAll(() => {
  fx.close();
  rmSync(sandbox, { recursive: true, force: true });
});

async function withCopy<T>(
    label: string, fn: (ctx: ScfContext) => Promise<T>): Promise<T> {
  const path = join(sandbox, `${label}.scf`);
  copyFileSync(FIXTURE_PATH, path);
  const db = openNodeDatabase(path, { readOnly: false });
  try {
    return await fn({ exec: db.exec, registry });
  } finally {
    db.close();
  }
}

const shot = async (ctx: ScfContext, number: string) =>
  (await ctx.exec("SELECT * FROM shot WHERE shot_number = ? OR name LIKE ?",
                  [number, `%${number}%`]))[0] ?? {};

/** The lines a shot covers, as uuids, or the verdict's kind. */
async function covered(ctx: ScfContext, number: string) {
  const s = await shot(ctx, number);
  const v = await rangeLines(ctx.exec, Number(s["scene_id"]),
                             s["line_start_ref"], s["line_end_ref"]);
  return v.kind === "lines" ? v.lines.map((l) => String(l["uuid"])) : v.kind;
}

describe("§3.5 — line anchors are declared, not listed", () => {
  test("the registry's anchors, and the one screenplay-table anchor",
       () => {
    const names = lineAnchorFields(registry)
      .map((a) => `${a.entity}.${a.field}`);
    expect(names).toEqual(expect.arrayContaining([
      "shot.line_start_ref", "shot.line_end_ref",
      "clip.line_start_ref", "clip.line_end_ref",
      "performance_beat.line_ref", "screenplay_prop_tags.line_uuid",
    ]));
    // The removed row-id references are not anchors and no longer exist.
    const clip = registry.entities.get("clip")?.fields.map((f) => f.name);
    expect(clip).not.toContain("screenplay_line_start_id");
  });

  test("the range-carrying entities are derived", () => {
    expect(rangeEntities(registry).sort()).toEqual(["clip", "shot"]);
  });
});

describe("§4.7 — the lines a shot covers", () => {
  test("3B: the doorway exchange, cue to reply, inclusive", async () => {
    const lines = await covered(fx.ctx, "3B");
    expect(Array.isArray(lines)).toBe(true);
    expect((lines as string[])[0]).toBe(L(19));
    expect((lines as string[]).at(-1)).toBe(L(29));
  });

  test("3D: an unset end is the one line at the start", async () => {
    expect(await covered(fx.ctx, "3D")).toEqual([L(36)]);
  });

  test("ranges overlap: the master covers every line its singles do",
       async () => {
    const master = new Set(await covered(fx.ctx, "3A") as string[]);
    for (const single of ["3B", "3C", "3D"]) {
      for (const uuid of await covered(fx.ctx, single) as string[]) {
        expect(master.has(uuid), `${single} ${uuid}`).toBe(true);
      }
    }
  });

  test("a shot with no range is unrecorded", async () => {
    expect(await covered(fx.ctx, "12-04")).toBe("unrecorded");
  });

  test("shotContext carries the shot's lines, and null when unrecorded",
       async () => {
    const b = await shotContext(fx.ctx, String((await shot(fx.ctx, "3B"))["uuid"]));
    const text = (b.lines ?? []).map((l) => l.fields["content"]);
    expect(text).toContain("Shut it behind you.");
    expect(text).toContain("It isn't.");
    expect(text).not.toContain("Is Ada's room still—");

    const unrecorded = await shotContext(
      fx.ctx, String((await shot(fx.ctx, "12-04"))["uuid"]));
    expect(unrecorded.lines).toBeNull();
  });

  test("the clips cover their lines, through the take 12-04 owns",
       async () => {
    const take = (await fx.ctx.exec(
      "SELECT t.shot_id, s.name FROM take t JOIN shot s ON s.id = t.shot_id " +
      "WHERE t.name = '12-04 take 3'"))[0];
    expect(String(take?.["name"])).toMatch(/12-04/);
    for (const [name, expected] of [
      ["You came back", "You came back."], ["I came back", "I came back."],
    ] as const) {
      const c = (await fx.ctx.exec("SELECT * FROM clip WHERE name = ?",
                                   [name]))[0] ?? {};
      const v = await rangeLines(fx.ctx.exec, Number(c["scene_id"]),
                                 c["line_start_ref"], c["line_end_ref"]);
      expect(v.kind, name).toBe("lines");
      if (v.kind === "lines") {
        expect(v.lines.map((l) => l["content"])).toContain(expected);
      }
    }
  });
});

describe("§3.5, §4.7 — reported, not refused", () => {
  const codes = async (ctx: ScfContext) =>
    (await collectFindings(ctx.exec, ctx.registry)).findings
      .filter((f) => f.code.startsWith("line."))
      .map((f) => `${f.code}:${f.table}`).sort();

  test("the fixture raises none", async () => {
    expect(await codes(fx.ctx)).toEqual([]);
  });

  test("each finding is raised by the condition it names", async () => {
    await withCopy("findings", async (ctx) => {
      const set = (n: string, sql: string, p: Array<string | null>) =>
        ctx.exec(`UPDATE shot SET ${sql} WHERE shot_number = ?`, [...p, n]);
      // A line that does not exist.
      await set("3D", "line_start_ref = ?", ["no-such-line"]);
      // A line of scene 12, named from a shot of scene 3.
      await set("3B", "line_start_ref = ?", [L(84)]);
      // Backwards.
      await set("3C", "line_start_ref = ?, line_end_ref = ?", [L(34), L(32)]);
      // An end with no start.
      await set("3A", "line_start_ref = ?", [null]);
      // And an anchor that is not a range: a beat naming no line.
      await ctx.exec("UPDATE performance_beat SET line_ref = 'gone' " +
                     "WHERE id = (SELECT MIN(id) FROM performance_beat)");

      expect(await codes(ctx)).toEqual([
        "line.anchor_orphaned:performance_beat",
        "line.anchor_orphaned:shot",
        "line.end_without_start:shot",
        "line.range_outside_scene:shot",
        "line.range_reversed:shot",
      ]);
    });
  });
});
