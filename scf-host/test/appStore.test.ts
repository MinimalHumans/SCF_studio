// SPDX-License-Identifier: Apache-2.0
/**
 * appStore.ts owns app.db's schema, migration and queries; this exercises
 * it against the real Node driver (nodeAppStore.ts), the way the window
 * and the standalone MCP will use it in practice.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync }
  from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { openNodeAppStore } from "../src/nodeAppStore.ts";
import type { AppStore } from "../src/appStore.ts";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "scf-app-store-")); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe("schema and migration", () => {
  test("creates the project and pref tables on first open", async () => {
    const store = await openNodeAppStore(join(dir, "app.db"));
    try {
      expect(await store.getProject("/films/a.scf")).toBeNull();
      expect(await store.getPref("lastProjectFolder")).toBeNull();
    } finally {
      await store.close();
    }
  });

  test("touchProject creates a row, reopening the file keeps it", async () => {
    const path = join(dir, "app.db");
    const first = await openNodeAppStore(path);
    await first.touchProject("/films/a.scf", {
      uuid: "u1", title: "A Film", baseName: "a", assetRoot: "/films/assets",
    });
    await first.close();

    const second = await openNodeAppStore(path);
    try {
      expect(await second.getProject("/films/a.scf")).toEqual({
        pathKey: "/films/a.scf", scfPath: "/films/a.scf", uuid: "u1",
        title: "A Film", baseName: "a", assetRoot: "/films/assets",
        lastOpened: expect.any(String),
      });
    } finally {
      await second.close();
    }
  });

  test("touchProject leaves omitted fields, overwrites given ones " +
      "(null clears)", async () => {
    const store = await openNodeAppStore(join(dir, "app.db"));
    try {
      await store.touchProject("/films/a.scf", { uuid: "u1", title: "A" });
      const row = await store.touchProject("/films/a.scf", { title: null });
      expect(row.uuid).toBe("u1");
      expect(row.title).toBeNull();
    } finally {
      await store.close();
    }
  });

  test("setAssetRoot and forgetProject", async () => {
    const store = await openNodeAppStore(join(dir, "app.db"));
    try {
      await store.touchProject("/films/a.scf");
      await store.setAssetRoot("/films/a.scf", "/films/assets");
      expect((await store.getProject("/films/a.scf"))?.assetRoot)
        .toBe("/films/assets");
      await store.forgetProject("/films/a.scf");
      expect(await store.getProject("/films/a.scf")).toBeNull();
    } finally {
      await store.close();
    }
  });

  test("recentProjects orders most recently opened first", async () => {
    const store = await openNodeAppStore(join(dir, "app.db"));
    try {
      await store.touchProject("/films/a.scf");
      await store.touchProject("/films/b.scf");
      await store.touchProject("/films/a.scf");
      const recent = await store.recentProjects();
      expect(recent.map((r) => r.scfPath)).toEqual([
        "/films/a.scf", "/films/b.scf",
      ]);
    } finally {
      await store.close();
    }
  });

  test("imports legacy recentFiles only on first creation", async () => {
    const path = join(dir, "app.db");
    const first = await openNodeAppStore(path, {
      importLegacyRecentFiles: () =>
        Promise.resolve(["/films/old1.scf", "/films/old2.scf"]),
    });
    expect((await first.recentProjects()).map((r) => r.scfPath)).toEqual([
      "/films/old1.scf", "/films/old2.scf",
    ]);
    await first.close();

    const second = await openNodeAppStore(path, {
      importLegacyRecentFiles: () => Promise.resolve(["/films/new.scf"]),
    });
    try {
      expect((await second.recentProjects()).map((r) => r.scfPath))
        .not.toContain("/films/new.scf");
    } finally {
      await second.close();
    }
  });
});

describe("path-key normalisation", () => {
  test("case-insensitive keys fold two spellings to one row", async () => {
    const store = await openNodeAppStore(join(dir, "app.db"), {
      caseInsensitiveKeys: true,
    });
    try {
      await store.touchProject("C:\\Films\\A.scf", { uuid: "u1" });
      const row = await store.getProject("c:\\films\\a.scf");
      expect(row?.uuid).toBe("u1");
      // The spelling as the user would recognise it is kept, from
      // whichever call wrote it last.
      expect(row?.scfPath).toBe("C:\\Films\\A.scf");
    } finally {
      await store.close();
    }
  });

  test("case-sensitive keys keep two spellings apart", async () => {
    const store = await openNodeAppStore(join(dir, "app.db"), {
      caseInsensitiveKeys: false,
    });
    try {
      await store.touchProject("/films/A.scf", { uuid: "u1" });
      expect(await store.getProject("/films/a.scf")).toBeNull();
      expect((await store.getProject("/films/A.scf"))?.uuid).toBe("u1");
    } finally {
      await store.close();
    }
  });
});

describe("two writers", () => {
  test("two connections to the same file can both write", async () => {
    const path = join(dir, "app.db");
    const a = await openNodeAppStore(path);
    const b = await openNodeAppStore(path);
    try {
      await Promise.all([
        a.touchProject("/films/a.scf"),
        b.touchProject("/films/b.scf"),
      ]);
      expect(await a.getProject("/films/b.scf")).not.toBeNull();
      expect(await b.getProject("/films/a.scf")).not.toBeNull();
    } finally {
      await a.close();
      await b.close();
    }
  });
});

describe("corruption", () => {
  test("a file that is not a database is backed up and replaced", async () => {
    const path = join(dir, "app.db");
    writeFileSync(path, "not a sqlite file at all");

    const store = await openNodeAppStore(path);
    try {
      expect(existsSync(`${path}.bak`)).toBe(true);
      expect(readFileSync(`${path}.bak`, "utf8"))
        .toBe("not a sqlite file at all");
      // The fresh file works normally.
      await store.touchProject("/films/a.scf", { uuid: "u1" });
      expect((await store.getProject("/films/a.scf"))?.uuid).toBe("u1");
    } finally {
      await store.close();
    }
  });

  test("a missing file is not treated as corruption (no .bak)", async () => {
    const path = join(dir, "app.db");
    const store: AppStore = await openNodeAppStore(path);
    await store.close();
    expect(existsSync(`${path}.bak`)).toBe(false);
  });
});
