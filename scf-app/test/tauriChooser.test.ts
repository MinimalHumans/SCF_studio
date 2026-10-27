// SPDX-License-Identifier: Apache-2.0
// @vitest-environment node
/**
 * tauriChooser.ts over mocked native dialogs and a fake app.db, to
 * check the dialog wiring and the `lastProjectFolder` pref round trip
 * (file-management-plan.md Step 2: "folder prefs updated after use").
 */
import { beforeEach, describe, expect, test, vi } from "vitest";

const openMock = vi.fn<(opts: unknown) => Promise<string | null>>();
const saveMock = vi.fn<(opts: unknown) => Promise<string | null>>();
vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: openMock, save: saveMock,
}));

const prefs = new Map<string, string>();
vi.mock("../src/host/windowAppStore.ts", () => ({
  windowAppStore: () => Promise.resolve({
    getPref: (key: string) => Promise.resolve(prefs.get(key) ?? null),
    setPref: (key: string, value: string) => {
      prefs.set(key, value);
      return Promise.resolve();
    },
  }),
}));

const { createTauriChooser } = await import("../src/files/tauriChooser.ts");

beforeEach(() => {
  prefs.clear();
  openMock.mockReset();
  saveMock.mockReset();
});

describe("chooseExisting", () => {
  test("starts at the stored folder and remembers the new one", async () => {
    prefs.set("lastProjectFolder", "/old/folder");
    openMock.mockResolvedValue("/new/folder/a.scf");
    const chooser = createTauriChooser();

    const path = await chooser.chooseExisting();

    expect(path).toBe("/new/folder/a.scf");
    expect(openMock).toHaveBeenCalledWith(expect.objectContaining({
      defaultPath: "/old/folder",
    }));
    expect(prefs.get("lastProjectFolder")).toBe("/new/folder");
  });

  test("a cancelled dialog returns null and leaves the pref alone",
      async () => {
    prefs.set("lastProjectFolder", "/old/folder");
    openMock.mockResolvedValue(null);

    expect(await createTauriChooser().chooseExisting()).toBeNull();
    expect(prefs.get("lastProjectFolder")).toBe("/old/folder");
  });
});

describe("chooseNew", () => {
  test("suggests the stored folder, enforces .scf, and remembers the " +
      "new folder", async () => {
    prefs.set("lastProjectFolder", "/old/folder");
    saveMock.mockResolvedValue("/new/folder/Untitled");
    const chooser = createTauriChooser();

    const path = await chooser.chooseNew("Untitled.scf");

    expect(saveMock).toHaveBeenCalledWith(expect.objectContaining({
      defaultPath: "/old/folder/Untitled.scf",
    }));
    expect(path).toBe("/new/folder/Untitled.scf");
    expect(prefs.get("lastProjectFolder")).toBe("/new/folder");
  });

  test("with nothing stored yet, suggests just the file name",
      async () => {
    saveMock.mockResolvedValue("/first/pick/Untitled.scf");
    await createTauriChooser().chooseNew("Untitled.scf");
    expect(saveMock).toHaveBeenCalledWith(expect.objectContaining({
      defaultPath: "Untitled.scf",
    }));
  });

  test("cancelling leaves the pref untouched", async () => {
    prefs.set("lastProjectFolder", "/old/folder");
    saveMock.mockResolvedValue(null);
    expect(await createTauriChooser().chooseNew("Untitled.scf")).toBeNull();
    expect(prefs.get("lastProjectFolder")).toBe("/old/folder");
  });
});
