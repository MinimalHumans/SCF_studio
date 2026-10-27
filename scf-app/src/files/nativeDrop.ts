// SPDX-License-Identifier: Apache-2.0
/**
 * nativeDrop.ts — drag-and-drop onto a specific element, over Tauri's
 * webview-wide drop event (file-management-plan.md Step 3).
 *
 * The browser's own `DataTransferItem.getAsFileSystemHandle` is gone
 * along with the rest of the folder-handle code, and its replacement
 * reports one drag state for the whole window, in physical pixels, with
 * no per-element drop target the way the DOM's own drag events give
 * one. This hit-tests each registered zone's bounding rect (converted
 * from CSS to physical pixels by `devicePixelRatio`) against the
 * event's position, and calls back only the zone the cursor is
 * actually over — the one real win is that `paths` are already
 * absolute, so nothing has to resolve a handle to get one.
 */

import type { UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";

export interface DropZone {
  /** Looked up on every event rather than captured once, so a zone
   *  that has not mounted yet (or has unmounted) is simply not hit. */
  element: () => HTMLElement | null;
  onOver: (over: boolean) => void;
  onDrop: (paths: string[]) => void;
}

const zones = new Set<DropZone>();
let unlisten: Promise<UnlistenFn> | null = null;

function zoneAt(x: number, y: number): DropZone | null {
  const px = x / window.devicePixelRatio;
  const py = y / window.devicePixelRatio;
  for (const zone of zones) {
    const el = zone.element();
    if (el === null) continue;
    const r = el.getBoundingClientRect();
    if (px >= r.left && px <= r.right && py >= r.top && py <= r.bottom) {
      return zone;
    }
  }
  return null;
}

function startListening(): Promise<UnlistenFn> {
  unlisten ??= getCurrentWebview().onDragDropEvent((event) => {
    const { payload } = event;
    if (payload.type === "enter" || payload.type === "over") {
      const hit = zoneAt(payload.position.x, payload.position.y);
      for (const zone of zones) zone.onOver(zone === hit);
    } else if (payload.type === "drop") {
      const hit = zoneAt(payload.position.x, payload.position.y);
      for (const zone of zones) zone.onOver(false);
      hit?.onDrop(payload.paths);
    } else {
      for (const zone of zones) zone.onOver(false);
    }
  });
  return unlisten;
}

/**
 * Register a drop zone for as long as the caller needs it; call the
 * returned function to unregister (typically on unmount).
 */
export function registerDropZone(zone: DropZone): () => void {
  zones.add(zone);
  void startListening();
  return () => { zones.delete(zone); };
}
