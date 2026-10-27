// SPDX-License-Identifier: Apache-2.0
// @vitest-environment node
/**
 * The window against a real host: the store's own actions, the `call`
 * facade and `exec`, on the host core the desktop window runs, here on
 * Node's files and SQLite, with only the file chooser stubbed (a person
 * picks paths; a test supplies them).
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test,
         vi } from "vitest";
import { mkdtempSync, realpathSync, rmSync, readFileSync, existsSync }
  from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import registryJson from "@registry/registry.json" with { type: "json" };
import { loadRegistry, type RegistryJson } from "@scf-core/registry.ts";
import { HostClient, connectInProcess } from "@scf-host/client.ts";
import { createHostCore, type HostCore } from "@scf-host/hostCore.ts";

/**
 * The few browser globals the store touches. A real jsdom would also
 * replace TextEncoder, which the dev server (esbuild) refuses to run
 * under, so the Node environment is used and these are stubbed.
 */
const { memory } = vi.hoisted(() => {
  const memory = new Map<string, string>();
  const g = globalThis as Record<string, unknown>;
  g["window"] = globalThis;
  g["localStorage"] = {
    getItem: (k: string) => memory.get(k) ?? null,
    setItem: (k: string, v: string) => { memory.set(k, v); },
    removeItem: (k: string) => { memory.delete(k); },
    clear: () => { memory.clear(); },
  };
  return { memory };
});

const chooserPaths: (string | null)[] = [];

vi.mock("../src/files/tauriChooser", () => ({
  createTauriChooser: () => ({
    chooseExisting: () => Promise.resolve(chooserPaths.shift() ?? null),
    chooseNew: () => Promise.resolve(chooserPaths.shift() ?? null),
  }),
}));

/** A fake app.db: this file tests the window against the host, not
 *  asset-root persistence, so a minimal in-memory stand-in is enough
 *  to keep `finishOpen`/`saveProjectAs` from reaching a real Tauri
 *  `invoke` that does not exist in this environment. */
const assetRoots = new Map<string, string | null>();
vi.mock("../src/host/windowAppStore", () => ({
  windowAppStore: () => Promise.resolve({
    getProject: (path: string) => Promise.resolve(
      assetRoots.has(path) ? { assetRoot: assetRoots.get(path) ?? null }
        : null),
    setAssetRoot: (path: string, assetRoot: string | null) => {
      assetRoots.set(path, assetRoot);
      return Promise.resolve();
    },
    touchProject: (path: string, fields: { assetRoot?: string | null }) => {
      if (fields.assetRoot !== undefined) assetRoots.set(path, fields.assetRoot);
      return Promise.resolve();
    },
  }),
}));

let dir: string;
let core: HostCore;
let other: HostClient;

vi.mock("../src/host/hostClient", () => {
  let current: Promise<HostClient> | null = null;
  return {
    getHost: () => {
      current ??= HostClient.connect(
        connectInProcess(core.connect()), { name: "window" });
      return current;
    },
    dropHost: () => { current = null; return Promise.resolve(); },
  };
});

beforeAll(async () => {
  // Real path: on macOS the temp folder is under /var, a link to /private/var,
  // and the host reports the paths it resolves.
  dir = realpathSync(mkdtempSync(join(tmpdir(), "scf-window-")));
  core = createHostCore({
    registry: loadRegistry(registryJson as unknown as RegistryJson),
    roots: [dir],
  });
  other = await HostClient.connect(
    connectInProcess(core.connect()), { name: "agent" });
});

afterAll(async () => {
  await other.dispose();
  await core.shutdown();
  rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => { chooserPaths.length = 0; memory.clear(); assetRoots.clear(); });
afterEach(async () => {
  const { useStore } = await import("../src/state/store");
  await useStore.getState().closeProject();
});

async function store() {
  const { useStore, exec } = await import("../src/state/store");
  const { call } = await import("../src/state/api");
  await useStore.getState().connect();
  return { useStore, exec, call };
}

describe("the window on the host", () => {
  test("connects, and the start screen's buttons can be enabled", async () => {
    const { useStore } = await store();
    expect(useStore.getState().hostStatus).toBe("ready");
  });

  test("New Project creates a file, opens it, and writes reach it at once",
      async () => {
    const { useStore, exec, call } = await store();
    const path = join(dir, "new.scf");
    chooserPaths.push(path);
    await useStore.getState().newProject();
    expect(useStore.getState().phase).toBe("open");
    expect(useStore.getState().projectName).toBe("new.scf");
    expect(useStore.getState().projectPath).toBe(path);

    const id = await call("record.create", "character", { name: "ELEANOR" });
    expect(typeof id).toBe("number");
    expect(await exec("SELECT name FROM character"))
      .toEqual([{ name: "ELEANOR" }]);
    // No save: the bytes on disk already hold it.
    expect(readFileSync(path).includes(Buffer.from("ELEANOR"))).toBe(true);
  }, 60_000);

  test("a write by another client moves the window's revision",
      async () => {
    const { useStore } = await store();
    chooserPaths.push(join(dir, "shared.scf"));
    await useStore.getState().newProject();
    const before = useStore.getState().revision;
    await other.open(useStore.getState().projectPath!);
    await other.call("record.create", ["character", { name: "FROM AGENT" }]);
    await vi.waitFor(() =>
      expect(useStore.getState().revision).toBeGreaterThan(before));
    // And the change is attributed, not anonymous.
    expect(useStore.getState().externalEdit).toMatchObject({ by: "agent" });
    useStore.getState().dismissExternalEdit();
    expect(useStore.getState().externalEdit).toBeNull();
  }, 60_000);

  test("the window's own writes are not reported as someone else's",
      async () => {
    const { useStore, call } = await store();
    chooserPaths.push(join(dir, "mine.scf"));
    await useStore.getState().newProject();
    await call("record.create", "character", { name: "MINE" });
    await new Promise((r) => setTimeout(r, 100));
    expect(useStore.getState().externalEdit).toBeNull();
  }, 60_000);

  test("opening an existing file, and reopening it after a reload",
      async () => {
    const { useStore, exec, call } = await store();
    const path = join(dir, "keep.scf");
    chooserPaths.push(path);
    await useStore.getState().newProject();
    await call("record.create", "character", { name: "KEPT" });
    await useStore.getState().closeProject();

    chooserPaths.push(path);
    await useStore.getState().openFromPicker();
    expect(useStore.getState().phase).toBe("open");
    expect(await exec("SELECT name FROM character"))
      .toEqual([{ name: "KEPT" }]);

    // A reload keeps the path, not the host connection's state.
    useStore.setState({ phase: "start" });
    localStorage.setItem("scf:auto-resume", "1");
    await useStore.getState().resumeLast();
    expect(useStore.getState().phase).toBe("open");
    expect(useStore.getState().projectPath).toBe(path);
  }, 60_000);

  test("resuming a file that has gone says so and offers the start screen",
      async () => {
    const { useStore } = await store();
    localStorage.setItem("scf:last-session", join(dir, "gone.scf"));
    await useStore.getState().resumeLast();
    const st = useStore.getState();
    expect(st.phase).toBe("start");
    expect(st.errorMessage).toContain("gone.scf");
    expect(localStorage.getItem("scf:last-session")).toBeNull();
  }, 60_000);

  test("Save As copies, follows the new file, and leaves the old one",
      async () => {
    const { useStore, exec, call } = await store();
    const a = join(dir, "v1.scf");
    chooserPaths.push(a);
    await useStore.getState().newProject();
    await call("record.create", "character", { name: "ONE" });
    const b = join(dir, "v2.scf");
    chooserPaths.push(b);
    await useStore.getState().saveProjectAs();
    expect(useStore.getState().projectPath).toBe(b);
    expect(useStore.getState().projectName).toBe("v2.scf");
    await call("record.create", "character", { name: "TWO" });
    expect((await exec("SELECT name FROM character ORDER BY id"))
      .map((r) => r["name"])).toEqual(["ONE", "TWO"]);
    // The first file did not see the second edit.
    await useStore.getState().closeProject();
    chooserPaths.push(a);
    await useStore.getState().openFromPicker();
    expect((await exec("SELECT name FROM character"))
      .map((r) => r["name"])).toEqual(["ONE"]);
  }, 60_000);

  test("a cancelled chooser changes nothing", async () => {
    const { useStore } = await store();
    chooserPaths.push(null);
    await useStore.getState().newProject();
    expect(useStore.getState().phase).toBe("start");
  });

  test("a delete returns an undo the window can send back", async () => {
    const { useStore, exec, call } = await store();
    chooserPaths.push(join(dir, "undo.scf"));
    await useStore.getState().newProject();
    const id = await call("record.create", "character", { name: "GONE" });
    await useStore.getState().deleteRow("character", id);
    expect(await exec("SELECT id FROM character")).toEqual([]);
    expect(useStore.getState().undo).not.toBeNull();
    await useStore.getState().undoDelete();
    expect((await exec("SELECT name FROM character"))
      .map((r) => r["name"])).toEqual(["GONE"]);
  }, 60_000);

  test("saving a record from the form writes through the host",
      async () => {
    const { useStore, exec } = await store();
    chooserPaths.push(join(dir, "form.scf"));
    await useStore.getState().newProject();
    await useStore.getState().openEntityRow("character", null);
    useStore.getState().setDraftValue("name", "FROM FORM");
    const id = await useStore.getState().saveDraft();
    expect(id).not.toBeNull();
    expect((await exec("SELECT name FROM character"))
      .map((r) => r["name"])).toEqual(["FROM FORM"]);
  }, 60_000);

  test("an outside edit is refused loudly, and Reload clears it",
      async () => {
    const { useStore, call } = await store();
    const path = join(dir, "outside.scf");
    chooserPaths.push(path);
    await useStore.getState().newProject();
    await call("record.create", "character", { name: "A" });
    const later = new Date(Date.now() + 120_000);
    const { utimesSync } = await import("node:fs");
    utimesSync(path, later, later);
    await expect(call("record.create", "character", { name: "B" }))
      .rejects.toMatchObject({ code: "external_change" });
    expect(useStore.getState().externalChange).toBe(true);
    await useStore.getState().reloadFromDisk();
    expect(useStore.getState().externalChange).toBe(false);
    await call("record.create", "character", { name: "B" });
  }, 60_000);

  test("the demo is copied where the user says, and opens", async () => {
    const { useStore, exec } = await store();
    const demo = readFileSync(join(
      __dirname, "..", "public", "hollow_creek.scf"));
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(
      new Response(demo, { status: 200 }))));
    const path = join(dir, "demo.scf");
    chooserPaths.push(path);
    await useStore.getState().openDemo();
    vi.unstubAllGlobals();
    expect(useStore.getState().phase).toBe("open");
    expect(existsSync(path)).toBe(true);
    const n = await exec("SELECT COUNT(*) AS n FROM scene");
    expect(Number(n[0]!["n"])).toBeGreaterThan(0);
  }, 120_000);
});

