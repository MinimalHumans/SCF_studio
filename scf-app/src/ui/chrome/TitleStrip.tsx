// SPDX-License-Identifier: Apache-2.0
import type { ReactNode } from "react";
import { useStore } from "../../state/store.ts";
import {
  tabStatus, tabStatusText, type CommandContext, type TabStatusInput,
} from "../../commands/registry.ts";
import logoSmallCloud from "../../assets/logoSmall_cloud.svg";
import { AppMenu } from "./AppMenu.tsx";
import { useFrameless, WindowControls } from "./WindowControls.tsx";

const TAB_GLYPH = { problem: "⚠", external: "●", dirty: "●" } as const;

/** Unsaved edits in an open record: what differs from what was loaded. */
function draftDirty(draft: { values: unknown; original: unknown } | null):
    boolean {
  return draft !== null &&
    JSON.stringify(draft.values) !== JSON.stringify(draft.original);
}

/**
 * The top of the window, in one row:
 * `[menu] [logo] [project tab] ...drag... [search] [status] [settings] [controls]`.
 *
 * Replaces the old top bar. There is one project tab for now; the strip
 * is laid out for more (docs/ui-rework-tabs.md §5), and the tab is the
 * one place a project's problems are shown.
 */
export function TitleStrip({ ctx, search, status, showProject = true }: {
  ctx: CommandContext;
  /** The search box, until the palette replaces it. */
  search?: ReactNode;
  /** Folder and outside-edit state of the active project. */
  status?: ReactNode;
  /** False on the start screen, where there is no project to tab. */
  showProject?: boolean;
}): JSX.Element {
  const { projectName, hostLost, assetRootStatus, externalChange,
          externalEdit, draft } = useStore();
  const frameless = useFrameless();

  const input: TabStatusInput = {
    hostLost, assetRootStatus, externalChange,
    externalEdit: externalEdit !== null, draftDirty: draftDirty(draft),
  };
  const state = tabStatus(input);
  const why = tabStatusText(state, input);

  return (
    <header className={"title-strip" + (frameless ? " frameless" : "")}>
      <AppMenu ctx={ctx} />
      <img className="title-mark" src={logoSmallCloud} alt="SCF" />
      {showProject && (
        <div className="tab-list" role="tablist" aria-label="Open projects">
          <div className={"tab active" +
                          (state === null ? "" : ` tab-${state}`)}
               role="tab" aria-selected="true" title={why ?? projectName ?? ""}>
            <span className="tab-title">{projectName}</span>
            {state !== null && (
              <span className="tab-state" role="img" aria-label={why ?? ""}>
                {TAB_GLYPH[state]}
              </span>
            )}
          </div>
        </div>
      )}
      <div className="title-drag" data-tauri-drag-region />
      {search}
      {status !== undefined && <div className="title-status">{status}</div>}
      {frameless && <WindowControls />}
    </header>
  );
}
