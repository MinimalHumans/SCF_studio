// SPDX-License-Identifier: Apache-2.0
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  badFileName, chooserResult, joinPath, withScfExtension, type Listing,
} from "../src/files/projectChooser";
import { createHostChooser, useChooser } from "../src/files/hostChooser";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const listing: Listing = {
  path: "/home/me/films", parent: "/home/me",
  entries: [
    { name: "act-one", kind: "dir", path: "/home/me/films/act-one" },
    { name: "a.scf", kind: "scf", path: "/home/me/films/a.scf" },
  ],
};

describe("chooser rules", () => {
  test("paths join with the folder's own separator", () => {
    expect(joinPath("/a/b", "c.scf")).toBe("/a/b/c.scf");
    expect(joinPath("/a/b/", "c.scf")).toBe("/a/b/c.scf");
    expect(joinPath("C:\\films", "c.scf")).toBe("C:\\films\\c.scf");
  });

  test(".scf is added once and case is respected", () => {
    expect(withScfExtension("Heist")).toBe("Heist.scf");
    expect(withScfExtension("Heist.scf")).toBe("Heist.scf");
    expect(withScfExtension("Heist.SCF")).toBe("Heist.SCF");
    expect(withScfExtension("  Heist ")).toBe("Heist.scf");
  });

  test("names the host or a filesystem would refuse", () => {
    for (const bad of ["", "   ", ".scf", "a/b", "a\\b", "x:y", "..", "q?"]) {
      expect(badFileName(bad)).not.toBeNull();
    }
    expect(badFileName("Heist v2")).toBeNull();
  });

  test("open returns the selected file's path, only for real files", () => {
    const none = new Set<string>();
    expect(chooserResult("open", listing, "a.scf", none))
      .toBe("/home/me/films/a.scf");
    expect(chooserResult("open", listing, "act-one", none)).toBeNull();
    expect(chooserResult("open", listing, "", none)).toBeNull();
    expect(chooserResult("open", { ...listing, path: null }, "a.scf", none))
      .toBeNull();
  });

  test("new returns a path, but never one that already exists", () => {
    const existing = new Set(["a.scf"]);
    expect(chooserResult("new", listing, "b", existing))
      .toBe("/home/me/films/b.scf");
    expect(chooserResult("new", listing, "A", existing)).toBeNull();
    expect(chooserResult("new", listing, "bad/name", existing)).toBeNull();
    expect(chooserResult("new", { ...listing, path: null }, "b", existing))
      .toBeNull();
  });
});

describe("the chooser request", () => {
  beforeEach(() => { useChooser.setState({ request: null }); });

  test("choosing resolves the promise and clears the request", async () => {
    const pending = createHostChooser().chooseExisting();
    expect(useChooser.getState().request?.mode).toBe("open");
    useChooser.getState().finish("/x/y.scf");
    expect(await pending).toBe("/x/y.scf");
    expect(useChooser.getState().request).toBeNull();
  });

  test("cancelling resolves null", async () => {
    const pending = createHostChooser().chooseNew("Untitled.scf");
    expect(useChooser.getState().request?.suggestedName)
      .toBe("Untitled.scf");
    useChooser.getState().finish(null);
    expect(await pending).toBeNull();
  });

  test("a second request cancels the first", async () => {
    const chooser = createHostChooser();
    const first = chooser.chooseExisting();
    const second = chooser.chooseNew("n.scf");
    expect(await first).toBeNull();
    useChooser.getState().finish("/p.scf");
    expect(await second).toBe("/p.scf");
  });
});

describe("the dialog", () => {
  let host: HTMLDivElement;
  let root: Root;
  const listFn = vi.fn((path?: string): Promise<Listing> =>
    Promise.resolve(path === "/home/me/films/act-one"
      ? { path, parent: "/home/me/films", entries: [] } : listing));

  beforeEach(() => {
    vi.resetModules();
    vi.doMock("../src/host/hostClient", () => ({
      getHost: () => Promise.resolve({ list: listFn }),
    }));
    useChooser.setState({ request: null });
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.doUnmock("../src/host/hostClient");
  });

  async function mount(): Promise<void> {
    const { ChooserDialog } = await import("../src/ui/ChooserDialog");
    await act(async () => { root.render(createElement(ChooserDialog)); });
  }
  const settle = (): Promise<void> => act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });

  test("renders nothing until something asks", async () => {
    await mount();
    expect(host.querySelector(".chooser")).toBeNull();
  });

  test("lists the folder, descends, and opens the chosen file", async () => {
    await mount();
    const { createHostChooser: make, useChooser: store } =
      await import("../src/files/hostChooser");
    let answer: string | null = "unset";
    await act(async () => {
      void make().chooseExisting().then((p) => { answer = p; });
    });
    await settle();
    expect(host.textContent).toContain("a.scf");
    const open = [...host.querySelectorAll("button")]
      .find((b) => b.textContent === "Open") as HTMLButtonElement;
    expect(open.disabled).toBe(true);

    const entry = [...host.querySelectorAll(".chooser-entry")]
      .find((b) => b.textContent?.includes("a.scf")) as HTMLButtonElement;
    await act(async () => { entry.click(); });
    expect(open.disabled).toBe(false);
    await act(async () => { open.click(); });
    expect(answer).toBe("/home/me/films/a.scf");
    expect(store.getState().request).toBeNull();
  });

  test("a folder click lists that folder", async () => {
    await mount();
    const { createHostChooser: make } =
      await import("../src/files/hostChooser");
    await act(async () => { void make().chooseExisting(); });
    await settle();
    const dir = [...host.querySelectorAll(".chooser-entry")]
      .find((b) => b.textContent?.includes("act-one")) as HTMLButtonElement;
    await act(async () => { dir.click(); });
    await settle();
    expect(listFn).toHaveBeenCalledWith("/home/me/films/act-one");
    expect(host.textContent).toContain("Nothing here.");
  });

  test("the new-file dialog refuses a name already taken", async () => {
    await mount();
    const { createHostChooser: make } =
      await import("../src/files/hostChooser");
    await act(async () => { void make().chooseNew("a.scf"); });
    await settle();
    const create = [...host.querySelectorAll("button")]
      .find((b) => b.textContent === "Create") as HTMLButtonElement;
    expect(create.disabled).toBe(true);
    expect(host.textContent).toContain("already here");
  });

  test("Escape cancels", async () => {
    await mount();
    const { createHostChooser: make } =
      await import("../src/files/hostChooser");
    let answer: string | null = "unset";
    await act(async () => {
      void make().chooseExisting().then((p) => { answer = p; });
    });
    await settle();
    await act(async () => {
      host.querySelector(".modal-scrim")!.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(answer).toBeNull();
  });
});
