// SPDX-License-Identifier: Apache-2.0
// @vitest-environment node
/**
 * chooseAssetFolder over a mocked native dialog and a fake app.db, to
 * check the dialog wiring and the `lastAssetFolder` pref round trip
 * (file-management-plan.md Step 3, carrying forward Step 2's "folder
 * prefs updated after use").
 */
import { beforeEach, describe, expect, test, vi } from "vitest";

const openMock = vi.fn<(opts: unknown) => Promise<string | null>>();
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: openMock }));

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

const { chooseAssetFolder } = await import(
  "../src/files/assetFolderChooser.ts");

beforeEach(() => {
  prefs.clear();
  openMock.mockReset();
});

test("starts at the stored folder and remembers the new one", async () => {
  prefs.set("lastAssetFolder", "/old/assets");
  openMock.mockResolvedValue("/new/assets");

  const path = await chooseAssetFolder();

  expect(path).toBe("/new/assets");
  expect(openMock).toHaveBeenCalledWith(expect.objectContaining({
    directory: true, defaultPath: "/old/assets",
  }));
  expect(prefs.get("lastAssetFolder")).toBe("/new/assets");
});

test("nothing stored yet: no defaultPath", async () => {
  openMock.mockResolvedValue("/first/pick");
  await chooseAssetFolder();
  expect(openMock).toHaveBeenCalledWith(
    expect.objectContaining({ defaultPath: undefined }));
});

test("a cancelled dialog returns null and leaves the pref alone", async () => {
  prefs.set("lastAssetFolder", "/old/assets");
  openMock.mockResolvedValue(null);

  expect(await chooseAssetFolder()).toBeNull();
  expect(prefs.get("lastAssetFolder")).toBe("/old/assets");
});
