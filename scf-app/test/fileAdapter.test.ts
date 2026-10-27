// SPDX-License-Identifier: Apache-2.0
import { afterEach, describe, expect, test, vi } from "vitest";
import { FsAccessAdapter, type HostEntry } from "../src/files/fileAdapter";

/** A folder as Chromium on Windows shows it: `.scf` names refused. */
function folder(name: string, entries: [string, "dir" | number][]) {
  const handles = entries.map(([n, k]): [string, unknown] => [n,
    k === "dir" ? { kind: "directory" }
      : { kind: "file", getFile: () => Promise.resolve({ size: k }) }]);
  return {
    name,
    async *entries() { yield* handles; },
    getFileHandle: (n: string) => Promise.reject(n.endsWith(".scf")
      ? new TypeError("Name is not allowed.")
      : new DOMException("", "NotFoundError")),
    queryPermission: () => Promise.resolve("granted"),
    requestPermission: () => Promise.resolve("granted"),
  };
}

const onDisk: HostEntry[] = [
  { name: "good_luck_v01.scf", kind: "file", size: 4096 },
  { name: "assets", kind: "dir", size: 0 },
  { name: "notes.txt", kind: "file", size: 12 },
];
const dir = "C:\\films\\scf_content";
const file = `${dir}\\good_luck_v01.scf`;

function pick(root: unknown): void {
  vi.stubGlobal("window", { showDirectoryPicker: () => Promise.resolve(root) });
}
afterEach(() => { vi.unstubAllGlobals(); });

describe("attaching a folder the browser will not search by name", () => {
  const adapter = new FsAccessAdapter((p) =>
    Promise.resolve(p === dir ? onDisk : []));

  test("the folder the file is in is accepted", async () => {
    pick(folder("scf_content", [["assets", "dir"], ["notes.txt", 12]]));
    const got = await adapter.attachRoot("good_luck_v01.scf", file);
    expect(got?.pairing?.kind).toBe("at-root");
  });

  test("a folder of the same name with other contents is refused", async () => {
    pick(folder("scf_content", [["assets", "dir"], ["other.txt", 3]]));
    const got = await adapter.attachRoot("good_luck_v01.scf", file);
    expect(got?.pairing?.kind).toBe("outside-root");
  });

  test("a folder of another name is refused", async () => {
    pick(folder("elsewhere", [["assets", "dir"], ["notes.txt", 12]]));
    const got = await adapter.attachRoot("good_luck_v01.scf", file);
    expect(got?.pairing?.kind).toBe("outside-root");
  });

  test("without the host's listing it is refused, as before", async () => {
    pick(folder("scf_content", [["assets", "dir"], ["notes.txt", 12]]));
    const got = await new FsAccessAdapter()
      .attachRoot("good_luck_v01.scf", file);
    expect(got?.pairing?.kind).toBe("outside-root");
  });
});
