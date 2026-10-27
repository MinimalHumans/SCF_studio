// SPDX-License-Identifier: Apache-2.0
// @vitest-environment node
/**
 * assetPicker.ts — picking files, or a whole folder, through the
 * native dialog, addressed against the asset root.
 */

import { beforeEach, describe, expect, test, vi } from "vitest";
import { posixPaths } from "@scf-host/paths.ts";

const openMock = vi.fn<(opts: unknown) => Promise<string | string[] | null>>();
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: openMock }));

const dirEntries = new Map<string, Array<{
  name: string; kind: "dir" | "file" | "other";
}>>([
  ["/project/sub", [
    { name: "x.png", kind: "file" }, { name: "deeper", kind: "dir" },
  ]],
  ["/project/sub/deeper", [{ name: "y.png", kind: "file" }]],
]);
const stats = new Map([
  ["/project/a.png", { size: 1, modified: "t" }],
  ["/project/sub/x.png", { size: 2, modified: "t" }],
  ["/project/sub/deeper/y.png", { size: 3, modified: "t" }],
]);

vi.mock("../src/host/tauriPlatform.ts", () => ({
  createTauriPlatform: () => Promise.resolve({
    paths: posixPaths,
    stat: (p: string) => Promise.resolve(stats.get(p) ?? null),
    readDir: (p: string) => Promise.resolve(dirEntries.get(p) ?? []),
  }),
}));

const { pickAssetFiles, pickAssetFolder } =
  await import("../src/files/assetPicker.ts");

const ROOT = "/project";

beforeEach(() => { openMock.mockReset(); });

describe("pickAssetFiles", () => {
  test("no root attached: no dialog", async () => {
    expect(await pickAssetFiles(null)).toBeNull();
    expect(openMock).not.toHaveBeenCalled();
  });

  test("a cancelled dialog returns null", async () => {
    openMock.mockResolvedValue(null);
    expect(await pickAssetFiles(ROOT)).toBeNull();
  });

  test("picked files are addressed against the root", async () => {
    openMock.mockResolvedValue(["/project/a.png", "/elsewhere/b.png"]);
    const picked = await pickAssetFiles(ROOT);
    expect(picked?.candidates.map((c) => c.identifier))
      .toEqual(["@project/a.png"]);
    expect(picked?.outsideRoot).toEqual(["b.png"]);
  });

  test("a single path (dialog not in multi-select) is still handled",
      async () => {
    openMock.mockResolvedValue("/project/a.png");
    const picked = await pickAssetFiles(ROOT);
    expect(picked?.candidates).toHaveLength(1);
  });
});

describe("pickAssetFolder", () => {
  test("no root attached: no dialog", async () => {
    expect(await pickAssetFolder(null)).toBeNull();
    expect(openMock).not.toHaveBeenCalled();
  });

  test("a cancelled dialog returns null", async () => {
    openMock.mockResolvedValue(null);
    expect(await pickAssetFolder(ROOT)).toBeNull();
  });

  test("walks subfolders and addresses every file found", async () => {
    openMock.mockResolvedValue("/project/sub");
    const picked = await pickAssetFolder(ROOT);
    expect(picked?.candidates.map((c) => c.identifier).sort()).toEqual([
      "@project/sub/deeper/y.png", "@project/sub/x.png",
    ]);
  });
});
