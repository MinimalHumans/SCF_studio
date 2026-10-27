// SPDX-License-Identifier: Apache-2.0
// @vitest-environment jsdom
/**
 * nativeDrop.ts — hit-testing Tauri's webview-wide drag-drop event
 * against each registered zone's own element, since the event itself
 * carries only a window-relative position, never a target the way the
 * DOM's own drag events do.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

type Handler = (event: { payload: unknown }) => void;
let handler: Handler | null = null;
const unlisten = vi.fn();

vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({
    onDragDropEvent: (h: Handler) => {
      handler = h;
      return Promise.resolve(unlisten);
    },
  }),
}));

const { registerDropZone } = await import("../src/files/nativeDrop.ts");

function elementAt(
    left: number, top: number, right: number, bottom: number): HTMLElement {
  const el = document.createElement("div");
  el.getBoundingClientRect = () => ({
    left, top, right, bottom, width: right - left, height: bottom - top,
    x: left, y: top, toJSON: () => ({}),
  } as DOMRect);
  return el;
}

function fire(payload: unknown): void {
  handler?.({ payload });
}

const cleanup: Array<() => void> = [];
function zone(el: HTMLElement, onOver: (o: boolean) => void,
              onDrop: (p: string[]) => void = () => undefined): void {
  cleanup.push(registerDropZone({ element: () => el, onOver, onDrop }));
}

beforeEach(() => {
  // NOT reset here: nativeDrop.ts subscribes once, memoized for the
  // module's lifetime (a page-lifetime singleton), so `handler` is set
  // once by the first registerDropZone call in this file and stays
  // valid — it reads `zones` fresh on every event, which `afterEach`
  // below does clean up between tests.
  Object.defineProperty(
    window, "devicePixelRatio", { value: 1, configurable: true });
});

afterEach(() => {
  for (const unregister of cleanup.splice(0)) unregister();
});

describe("registerDropZone", () => {
  test("only the zone under the cursor is told it is hovered", () => {
    const overA: boolean[] = [];
    const overB: boolean[] = [];
    zone(elementAt(0, 0, 100, 100), (o) => overA.push(o));
    zone(elementAt(200, 0, 300, 100), (o) => overB.push(o));

    fire({ type: "over", position: { x: 50, y: 50 } });

    expect(overA).toEqual([true]);
    expect(overB).toEqual([false]);
  });

  test("enter is treated the same as over", () => {
    const over: boolean[] = [];
    zone(elementAt(0, 0, 100, 100), (o) => over.push(o));
    fire({ type: "enter", position: { x: 50, y: 50 }, paths: [] });
    expect(over).toEqual([true]);
  });

  test("physical pixels are converted by devicePixelRatio", () => {
    Object.defineProperty(
      window, "devicePixelRatio", { value: 2, configurable: true });
    const over: boolean[] = [];
    // A 100x100 CSS-pixel zone; a physical position of 150,150 is CSS
    // 75,75 — inside it. At ratio 1 that position would miss.
    zone(elementAt(0, 0, 100, 100), (o) => over.push(o));
    fire({ type: "over", position: { x: 150, y: 150 } });
    expect(over).toEqual([true]);
  });

  test("drop calls onDrop only for the zone under the cursor", () => {
    const droppedA: string[][] = [];
    const droppedB: string[][] = [];
    zone(elementAt(0, 0, 100, 100), () => undefined, (p) => droppedA.push(p));
    zone(elementAt(200, 0, 300, 100), () => undefined, (p) => droppedB.push(p));

    fire({ type: "drop", position: { x: 10, y: 10 }, paths: ["/x.png"] });

    expect(droppedA).toEqual([["/x.png"]]);
    expect(droppedB).toEqual([]);
  });

  test("a drop outside every zone calls nobody", () => {
    const dropped: string[][] = [];
    zone(elementAt(0, 0, 100, 100), () => undefined, (p) => dropped.push(p));
    fire({ type: "drop", position: { x: 999, y: 999 }, paths: ["/x.png"] });
    expect(dropped).toEqual([]);
  });

  test("a drop clears every zone's hover state first", () => {
    const over: boolean[] = [];
    zone(elementAt(0, 0, 100, 100), (o) => over.push(o));
    fire({ type: "over", position: { x: 50, y: 50 } });
    fire({ type: "drop", position: { x: 50, y: 50 }, paths: [] });
    expect(over).toEqual([true, false]);
  });

  test("leave clears hover for every zone", () => {
    const over: boolean[] = [];
    zone(elementAt(0, 0, 100, 100), (o) => over.push(o));
    fire({ type: "over", position: { x: 50, y: 50 } });
    fire({ type: "leave" });
    expect(over).toEqual([true, false]);
  });

  test("unregistering removes a zone from hit-testing", () => {
    const over: boolean[] = [];
    const unregister = registerDropZone({
      element: () => elementAt(0, 0, 100, 100),
      onOver: (o) => over.push(o), onDrop: () => undefined,
    });
    unregister();
    fire({ type: "over", position: { x: 50, y: 50 } });
    expect(over).toEqual([]);
  });

  test("a zone whose element has unmounted is simply not hit", () => {
    const over: boolean[] = [];
    cleanup.push(registerDropZone({
      element: () => null, onOver: (o) => over.push(o),
      onDrop: () => undefined,
    }));
    fire({ type: "over", position: { x: 50, y: 50 } });
    expect(over).toEqual([false]);
  });
});
