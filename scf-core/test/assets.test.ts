/**
 * assets.test.ts — addressing and resolution (P3).
 *
 * The states are the point. `missing` and `unmaterialised` must never
 * collapse into each other, an absolute path must always announce that
 * it will not travel, and a session with no folder attached must
 * resolve to a full report rather than an error.
 */

import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { initDatabase, newUuid } from "../src/db.ts";
import {
  applyRelink, escapesRoot, formatOf, parseIdentifier,
  planRelink, projectIdentifier, resolveAllAssets, resolveIdentifier,
  type FileLocator,
} from "../src/assets.ts";
import { openNodeDatabase, type NodeDatabase } from "../src/node.ts";
import { registry } from "./setup.ts";

/** A locator over a fake tree, so the grammar is testable with no disk. */
function locatorOver(
  tree: Record<string, { size?: number; placeholder?: boolean }>,
  roots: string[] = ["project"],
): FileLocator {
  return async (root, path) => {
    if (root === null || !roots.includes(root)) return undefined;
    const hit = tree[`${root}/${path}`];
    if (hit === undefined) return null;
    return {
      materialised: hit.placeholder !== true,
      sizeBytes: hit.size ?? 0,
      mtime: null,
    };
  };
}

const NOTHING: FileLocator = async () => null;

describe("parseIdentifier", () => {
  test("splits a rooted identifier", () => {
    const id = parseIdentifier("@project/characters/eleanor/face.png");
    expect(id?.root).toBe("project");
    expect(id?.path).toBe("characters/eleanor/face.png");
    expect(id?.absolute).toBe(false);
  });

  test("supports roots other than @project", () => {
    expect(parseIdentifier("@plates/sh010/bg.exr")?.root).toBe("plates");
  });

  test("a bare relative path is NOT silently adopted into @project", () => {
    // Guessing here would put a lie in the portable namespace.
    const id = parseIdentifier("assets/foo.png");
    expect(id?.root).toBeNull();
  });

  test("recognises absolute and drive-lettered paths", () => {
    expect(parseIdentifier("/Volumes/show/bg.exr")?.absolute).toBe(true);
    expect(parseIdentifier("C:\\show\\bg.exr")?.absolute).toBe(true);
    expect(parseIdentifier("https://example.com/x.png")?.absolute).toBe(true);
  });

  test("empty and whitespace are not identifiers", () => {
    expect(parseIdentifier("")).toBeNull();
    expect(parseIdentifier("   ")).toBeNull();
    expect(parseIdentifier("@")).toBeNull();
  });

  test("normalises separators and dot segments", () => {
    expect(parseIdentifier("@project/a//b/./c.png")?.path)
      .toBe("a/b/c.png");
    expect(parseIdentifier("@project\\a\\b.png")?.path).toBe("a/b.png");
  });
});

describe("escapesRoot and projectIdentifier", () => {
  test("dot-dot escapes", () => {
    expect(escapesRoot("a/../../b")).toBe(true);
    expect(escapesRoot("a/b")).toBe(false);
  });

  test("projectIdentifier builds a rooted address", () => {
    expect(projectIdentifier("assets/props/lamp.png"))
      .toBe("@project/assets/props/lamp.png");
  });
});

describe("formatOf", () => {
  test("derives from the extension", () => {
    expect(formatOf("@project/a/b.PNG")).toBe("png");
    expect(formatOf("@project/a/model.safetensors")).toBe("safetensors");
  });

  test("is null where there is no extension to read", () => {
    expect(formatOf("@project/a/README")).toBeNull();
    expect(formatOf("@project/a/.hidden")).toBeNull();
    expect(formatOf("@project/a/trailing.")).toBeNull();
  });
});

describe("resolution states", () => {
  test("a present file resolves with its size", async () => {
    const locate = locatorOver({ "project/a/b.png": { size: 4096 } });
    const r = await resolveIdentifier("@project/a/b.png", locate);
    expect(r.state).toBe("resolved");
    expect(r.sizeBytes).toBe(4096);
    expect(r.detail).toBeNull();
  });

  test("an absent file is missing", async () => {
    const r = await resolveIdentifier("@project/a/gone.png",
                                      locatorOver({}));
    expect(r.state).toBe("missing");
  });

  test("a placeholder is unmaterialised, NOT missing", async () => {
    const locate = locatorOver({
      "project/a/big.exr": { size: 0, placeholder: true },
    });
    const r = await resolveIdentifier("@project/a/big.exr", locate);
    expect(r.state).toBe("unmaterialised");
    expect(r.state).not.toBe("missing");
    expect(r.detail).toContain("not missing");
  });

  test("an unmapped root is unaddressed, not missing or out-of-root",
       async () => {
    // Spec §8.3. The identifier is fine and may be perfectly portable;
    // this session just has nowhere to resolve it. Calling it
    // out-of-root told a user their paths were wrong when the truth was
    // that no folder was attached.
    const r = await resolveIdentifier("@plates/sh010/bg.exr",
                                      locatorOver({}, ["project"]));
    expect(r.state).toBe("unaddressed");
    expect(r.detail).toContain("@plates");
  });

  test("out-of-root is a property of the identifier, not the session",
       async () => {
    // The distinction that makes the two states worth having: these
    // resolve out-of-root against ANY locator, including a fully
    // configured one.
    const full = locatorOver({}, ["project", "plates"]);
    expect((await resolveIdentifier("/Volumes/show/bg.exr", full)).state)
      .toBe("out-of-root");
    expect((await resolveIdentifier("@project/../etc/passwd", full)).state)
      .toBe("out-of-root");
  });

  test("an absolute path is out-of-root and says it will not travel",
    async () => {
      const r = await resolveIdentifier("/Volumes/show/bg.exr", NOTHING);
      expect(r.state).toBe("out-of-root");
      expect(r.detail).toContain("nowhere else");
    });

  test("dot-dot is refused before any lookup", async () => {
    let called = false;
    const spy: FileLocator = async () => { called = true; return null; };
    const r = await resolveIdentifier("@project/../../etc/passwd", spy);
    expect(r.state).toBe("out-of-root");
    expect(called).toBe(false);
  });

  test("no identifier at all is unaddressed", async () => {
    expect((await resolveIdentifier(null, NOTHING)).state)
      .toBe("unaddressed");
    expect((await resolveIdentifier("", NOTHING)).state)
      .toBe("unaddressed");
  });

  test("format survives a failed resolution", async () => {
    const r = await resolveIdentifier("@project/a/b.exr", locatorOver({}));
    expect(r.state).toBe("missing");
    expect(r.format).toBe("exr");
  });
});

describe("the file-level report", () => {
  let db: NodeDatabase;

  beforeAll(async () => {
    db = openNodeDatabase(":memory:");
    await initDatabase(db.exec, registry, { editorVersion: "assets-test" });
    const add = async (name: string,
                      identifier: string | null): Promise<void> => {
      await db.exec(
        "INSERT INTO asset (name, uuid, identifier) VALUES (?, ?, ?)",
        [name, newUuid(), identifier]);
    };
    await add("Here", "@project/a/here.png");
    await add("Gone", "@project/a/gone.png");
    await add("Cloud", "@project/a/cloud.exr");
    await add("Elsewhere", "/Volumes/x/abs.png");
    await add("Nameless", null);
  });

  afterAll(() => db.close());

  test("every state is counted and nothing throws", async () => {
    const locate = locatorOver({
      "project/a/here.png": { size: 10 },
      "project/a/cloud.exr": { placeholder: true },
    });
    const report = await resolveAllAssets(db.exec, locate);
    expect(report.total).toBe(5);
    expect(report.counts.resolved).toBe(1);
    expect(report.counts.missing).toBe(1);
    expect(report.counts.unmaterialised).toBe(1);
    expect(report.counts["out-of-root"]).toBe(1);
    expect(report.counts.unaddressed).toBe(1);
  });

  test("a session with no folder reports, rather than failing",
    async () => {
      const report = await resolveAllAssets(db.exec, async () => undefined);
      expect(report.total).toBe(5);
      expect(report.counts.resolved).toBe(0);
    });

});

describe("relink", () => {
  let db: NodeDatabase;

  beforeAll(async () => {
    db = openNodeDatabase(":memory:");
    await initDatabase(db.exec, registry, { editorVersion: "relink-test" });
    for (const id of ["@project/old/a.png", "@project/old/b.png",
                      "@project/keep/c.png"]) {
      await db.exec(
        "INSERT INTO asset (name, uuid, identifier) VALUES (?, ?, ?)",
        [id, newUuid(), id]);
    }
  });

  afterAll(() => db.close());

  test("a plan can be inspected before anything changes", async () => {
    const plan = await planRelink(db.exec, "@project/old/", "@project/new/");
    expect(plan).toHaveLength(2);
    expect(plan[0]?.to).toBe("@project/new/a.png");
    const [row] = await db.exec(
      "SELECT identifier FROM asset WHERE name = '@project/old/a.png'");
    expect(row?.["identifier"]).toBe("@project/old/a.png");
  });

  test("applying it moves only the matching prefix", async () => {
    const plan = await planRelink(db.exec, "@project/old/", "@project/new/");
    expect(await applyRelink(db.exec, plan)).toBe(2);
    const rows = await db.exec(
      "SELECT identifier FROM asset ORDER BY id");
    expect(rows.map((r) => String(r["identifier"]))).toEqual([
      "@project/new/a.png", "@project/new/b.png", "@project/keep/c.png",
    ]);
  });

  test("re-rooting across roots is the same operation", async () => {
    const plan = await planRelink(db.exec, "@project/new/", "@plates/");
    await applyRelink(db.exec, plan);
    const [row] = await db.exec(
      "SELECT identifier FROM asset ORDER BY id LIMIT 1");
    expect(row?.["identifier"]).toBe("@plates/a.png");
  });

  test("an empty prefix changes nothing", async () => {
    expect(await planRelink(db.exec, "", "@x/")).toEqual([]);
  });
});
