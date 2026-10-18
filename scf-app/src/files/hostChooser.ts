// SPDX-License-Identifier: Apache-2.0
/**
 * hostChooser.ts — the host-side file chooser, as a `ProjectChooser`.
 *
 * `chooseExisting` and `chooseNew` open a dialog (`ChooserDialog`) and
 * resolve when it closes. The dialog reads its request from this store
 * and lists folders through whatever `list` function it was given, so
 * the only thing here that knows about the host is that function.
 */

import { create } from "zustand";
import type {
  ChooserMode, Listing, ProjectChooser,
} from "./projectChooser.ts";

export interface ChooserRequest {
  mode: ChooserMode;
  suggestedName: string;
  resolve: (path: string | null) => void;
}

interface ChooserStore {
  request: ChooserRequest | null;
  open: (request: ChooserRequest) => void;
  finish: (path: string | null) => void;
}

export const useChooser = create<ChooserStore>((set, get) => ({
  request: null,
  open: (request) => {
    // One dialog at a time: a second request cancels the first.
    get().request?.resolve(null);
    set({ request });
  },
  finish: (path) => {
    const r = get().request;
    set({ request: null });
    r?.resolve(path);
  },
}));

export type ListFolder = (path?: string) => Promise<Listing>;

/** Where the dialog last was, so the next one starts there. */
let lastFolder: string | null = null;
export const rememberFolder = (path: string | null): void => {
  lastFolder = path;
};
export const startingFolder = (): string | null => lastFolder;

export function createHostChooser(): ProjectChooser {
  const ask = (mode: ChooserMode, suggestedName: string):
      Promise<string | null> =>
    new Promise((resolve) => {
      useChooser.getState().open({ mode, suggestedName, resolve });
    });
  return {
    chooseExisting: () => ask("open", ""),
    chooseNew: (suggestedName) => ask("new", suggestedName),
  };
}
