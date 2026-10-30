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
import {
  mkdirSync, mkdtempSync, realpathSync, rmSync, readFileSync, existsSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import registryJson from "@registry/registry.json" with { type: "json" };
import { loadRegistry, type RegistryJson } from "@scf-core/registry.ts";
import type { AppStore } from "@scf-host/appStore.ts";
import { HostClient, connectInProcess } from "@scf-host/client.ts";
import { createHostCore, type HostCore } from "@scf-host/hostCore.ts";
import { openNodeAppStore } from "@scf-host/nodeAppStore.ts";
import { openNodeDatabase } from "@minimalhumans/scf-core/node";

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

const assetFolderPaths: (string | null)[] = [];
vi.mock("../src/files/assetFolderChooser", () => ({
  chooseAssetFolder: () => Promise.resolve(assetFolderPaths.shift() ?? null),
}));

/** Only `fs_exists` is needed here (`applyAssetRoot`'s existence
 *  check); anything else means a test reached for something this
 *  file does not yet stub. */
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: { path?: string }) => {
    if (cmd === "fs_exists") {
      return Promise.resolve(existsSync(args?.path ?? ""));
    }
    return Promise.reject(new Error(`invoke(${cmd}) is not mocked here`));
  },
}));

/**
 * The real Node app.db (scf-host `nodeAppStore.ts`), not a hand-rolled
 * stand-in: the suggestion matching this file tests has real logic
 * behind it (uuid/title/base-name queries), and duplicating that logic
 * in a fake would only prove the fake agrees with itself. A fresh
 * database per test, same as the fresh `assetRoots` map this replaces.
 */
let appStore: AppStore;
vi.mock("../src/host/windowAppStore", () => ({
  windowAppStore: () => Promise.resolve(appStore),
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

let appStoreDir: string;
beforeEach(async () => {
  chooserPaths.length = 0;
  assetFolderPaths.length = 0;
  memory.clear();
  appStoreDir = mkdtempSync(join(tmpdir(), "scf-window-appdb-"));
  appStore = await openNodeAppStore(join(appStoreDir, "app.db"));
});
afterEach(async () => {
  const { useStore } = await import("../src/state/store");
  await useStore.getState().closeProject();
  const { useProjectTabs } = await import("../src/state/projectTabs");
  useProjectTabs.setState({ tabs: [] });
  await appStore.close();
  rmSync(appStoreDir, { recursive: true, force: true });
});

async function store() {
  const { useStore, exec, flushTabPersistence } =
    await import("../src/state/store");
  const { call } = await import("../src/state/api");
  await useStore.getState().connect();
  return { useStore, exec, call, flushTabPersistence };
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

  test("opening an existing file, and reopening it after a restart",
      async () => {
    const { useStore, exec, call, flushTabPersistence } = await store();
    const path = join(dir, "keep.scf");
    chooserPaths.push(path);
    await useStore.getState().newProject();
    await call("record.create", "character", { name: "KEPT" });
    expect(await exec("SELECT name FROM character"))
      .toEqual([{ name: "KEPT" }]);
    await flushTabPersistence();

    // A restart keeps the path, not the host connection's state — the
    // in-memory tab list is gone too, same as a real relaunch; only
    // what persistTabs wrote to app.db survives.
    const { useProjectTabs } = await import("../src/state/projectTabs");
    useStore.setState({ phase: "start", projectPath: null });
    useProjectTabs.setState({ tabs: [] });
    await useStore.getState().resumeTabs();
    expect(useStore.getState().phase).toBe("open");
    expect(useStore.getState().projectPath).toBe(path);
  }, 60_000);

  test("resuming a file that has gone says so and offers the start screen",
      async () => {
    const { useStore } = await store();
    const { OPEN_TABS_PREF } = await import("../src/state/settings");
    const path = join(dir, "gone.scf");
    await appStore.setPref(OPEN_TABS_PREF, JSON.stringify({
      tabs: [{ path, title: "gone.scf" }], activePath: path,
    }));
    await useStore.getState().resumeTabs();
    const st = useStore.getState();
    expect(st.phase).toBe("start");
    expect(st.errorMessage).toContain("gone.scf");
    // Kept, not forgotten — marked broken rather than silently dropped.
    const { useProjectTabs } = await import("../src/state/projectTabs");
    const tab = useProjectTabs.getState().tabs.find((t) => t.path === path);
    expect(tab?.problem).not.toBeNull();
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

/**
 * Step 4: pairing on open (file-management-plan.md §3.2). Each test
 * opens the real demo fixture at a fresh path — it carries a real
 * uuid and title ("Hollow Creek") baked into its bytes, which a brand
 * new empty project does not have.
 */
describe("pairing an asset root on open", () => {
  async function openDemoAt(
      useStore: Awaited<ReturnType<typeof store>>["useStore"], path: string,
  ): Promise<void> {
    const demo = readFileSync(join(
      __dirname, "..", "public", "hollow_creek.scf"));
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(
      new Response(demo, { status: 200 }))));
    chooserPaths.push(path);
    await useStore.getState().openDemo();
    vi.unstubAllGlobals();
  }

  test("a path app.db already knows attaches its asset root silently",
      async () => {
    const { useStore } = await store();
    const path = join(dir, "a.scf");
    const assetDir = join(dir, "a-assets");
    mkdirSync(assetDir, { recursive: true });

    await openDemoAt(useStore, path);
    assetFolderPaths.push(assetDir);
    await useStore.getState().attachFolder();
    expect(useStore.getState().assetRoot).toBe(assetDir);
    await useStore.getState().closeProject();

    // The file already exists now: reopen it, do not recreate it.
    chooserPaths.push(path);
    await useStore.getState().openFromPicker();
    expect(useStore.getState().assetRoot).toBe(assetDir);
    expect(useStore.getState().suggestions).toBeNull();
  }, 60_000);

  test("a uuid match on a brand-new path is auto-assigned silently",
      async () => {
    const { useStore } = await store();
    const pathA = join(dir, "b-first.scf");
    const assetDir = join(dir, "b-assets");
    mkdirSync(assetDir, { recursive: true });

    await openDemoAt(useStore, pathA);
    assetFolderPaths.push(assetDir);
    await useStore.getState().attachFolder();
    await useStore.getState().closeProject();

    // Same bytes, same uuid, a path app.db has never seen.
    const pathB = join(dir, "b-second.scf");
    await openDemoAt(useStore, pathB);
    expect(useStore.getState().suggestions).toBeNull();
    // Auto-assigned by UUID identity.
    expect(useStore.getState().assetRoot).toBe(assetDir);
  }, 60_000);

  test("choosing a weak suggestion attaches it and persists for next time",
      async () => {
    const { useStore } = await store();
    const pathA = join(dir, "c-first.scf");
    const assetDir = join(dir, "c-assets");
    mkdirSync(assetDir, { recursive: true });

    await openDemoAt(useStore, pathA);
    assetFolderPaths.push(assetDir);
    await useStore.getState().attachFolder();
    await useStore.getState().closeProject();

    // Different uuid, same title / baseName: weak match, offered in dialog.
    const pathB = join(dir, "c-second.scf");
    writeFileSync(pathB, readFileSync(pathA));
    const db = await openNodeDatabase(pathB);
    await db.exec("UPDATE project SET uuid = 'different-uuid-c'");
    await db.close();

    chooserPaths.push(pathB);
    await useStore.getState().openFromPicker();
    const suggestion = useStore.getState().suggestions?.[0];
    expect(suggestion).toBeDefined();
    expect(suggestion?.strength).toBe("name");
    await useStore.getState().chooseSuggestion(suggestion!);
    expect(useStore.getState().assetRoot).toBe(assetDir);
    expect(useStore.getState().suggestions).toBeNull();
    await useStore.getState().closeProject();

    // Reopening B now finds its OWN row — a path hit, not a suggestion.
    chooserPaths.push(pathB);
    await useStore.getState().openFromPicker();
    expect(useStore.getState().assetRoot).toBe(assetDir);
    expect(useStore.getState().suggestions).toBeNull();
  }, 60_000);

  test("dismissing a weak suggestion opens the project unmapped", async () => {
    const { useStore } = await store();
    const pathA = join(dir, "d-first.scf");
    const assetDir = join(dir, "d-assets");
    mkdirSync(assetDir, { recursive: true });

    await openDemoAt(useStore, pathA);
    assetFolderPaths.push(assetDir);
    await useStore.getState().attachFolder();
    await useStore.getState().closeProject();

    // Different uuid, same title / baseName.
    const pathB = join(dir, "d-second.scf");
    writeFileSync(pathB, readFileSync(pathA));
    const db = await openNodeDatabase(pathB);
    await db.exec("UPDATE project SET uuid = 'different-uuid-d'");
    await db.close();

    chooserPaths.push(pathB);
    await useStore.getState().openFromPicker();
    expect(useStore.getState().suggestions).not.toBeNull();
    useStore.getState().dismissSuggestions();
    expect(useStore.getState().suggestions).toBeNull();
    expect(useStore.getState().assetRoot).toBeNull();
  }, 60_000);

  // The order a real session hit: Save As before the original ever had
  // a folder, so the copy's row is written unmapped; attach the
  // folder to the original afterwards; reopening the copy auto-assigns
  // by UUID match.
  test("Save As before attaching, then attaching the original, " +
      "auto-assigns the folder to the copy later by UUID", async () => {
    const { useStore } = await store();
    const original = join(dir, "e-original.scf");
    const assetDir = join(dir, "e-assets");
    mkdirSync(assetDir, { recursive: true });

    await openDemoAt(useStore, original);
    const copy = join(dir, "e-original_v2.scf");
    chooserPaths.push(copy);
    await useStore.getState().saveProjectAs();
    expect(useStore.getState().projectPath).toBe(copy);
    expect(useStore.getState().assetRoot).toBeNull();
    await useStore.getState().closeProject();

    // The original gets its folder only now.
    chooserPaths.push(original);
    await useStore.getState().openFromPicker();
    assetFolderPaths.push(assetDir);
    await useStore.getState().attachFolder();
    await useStore.getState().closeProject();

    // The copy's row already existed (from Save As) but was never
    // mapped — opening it now finds the UUID match and auto-assigns.
    chooserPaths.push(copy);
    await useStore.getState().openFromPicker();
    expect(useStore.getState().suggestions).toBeNull();
    expect(useStore.getState().assetRoot).toBe(assetDir);
  }, 60_000);
});

