// SPDX-License-Identifier: Apache-2.0
import { registry, useStore } from "../state/store.ts";
import { CategoryTree } from "./CategoryTree.tsx";
import { SubjectNav } from "./SubjectNav.tsx";
import { SubjectView } from "./SubjectView.tsx";
import { EntityList } from "./EntityList.tsx";
import { EntityForm } from "./EntityForm.tsx";
import { ReverseLinks } from "./ReverseLinks.tsx";
import { SearchBox } from "./SearchBox.tsx";
import { QueryIndex, QueryRunner } from "./queries/QueryRunner.tsx";
import { ScriptView } from "./ScriptView.tsx";
import { StructureView } from "./StructureView.tsx";
import { undoSummary } from "../state/undoDelete.ts";
import { ShootView } from "./ShootView.tsx";
import { useStore as useStoreRaw } from "../state/store.ts";
import { Component, useEffect, useRef, useState, type ReactNode }
  from "react";

/**
 * A render crash anywhere in the main pane must never white-screen the
 * app: it renders here, with its message, and navigation stays alive.
 */
class MainPaneBoundary extends Component<
  { children: ReactNode; resetKey: string },
  { error: Error | null }
> {
  override state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error };
  }
  override componentDidUpdate(prev: { resetKey: string }): void {
    if (prev.resetKey !== this.props.resetKey &&
        this.state.error !== null) {
      this.setState({ error: null });
    }
  }
  override render(): ReactNode {
    if (this.state.error !== null) {
      return (
        <div className="pane-crash" role="alert">
          <h2>This view crashed</h2>
          <p className="mono">{this.state.error.message}</p>
          <pre className="crash-stack">{this.state.error.stack}</pre>
          <p className="muted">
            Pick another item or tab to continue — the rest of the app
            is fine. Please report the message above.
          </p>
        </div>
      );
    }
    return this.props.children;
  }
}
import { SceneRail } from "./SceneRail.tsx";
import { IdentityPanel } from "./IdentityPanel.tsx";
import { AssetBrowser, AssetPathRail } from "./AssetBrowser.tsx";

const RAIL_KEY = "scf:rail-width";
const RAIL_MIN = 180;
/** Wide enough for a deep asset path or a long scene heading. The old
 *  ceiling was 500, which the tab bar alone outgrew once Assets became
 *  the seventh tab — the drag stopped short of the content every time. */
const RAIL_MAX = 900;

/**
 * The rail defaults to the width its own tab bar needs.
 *
 * Seven tabs squeezed into 260px truncate, so the first thing anyone
 * did on opening a project was drag the rail wider. Measuring beats
 * guessing here: the tabs are laid out with `flex: 1`, so their
 * natural width is whatever their labels require, and reading it after
 * mount adapts to a renamed or added tab without another magic number.
 */
function useRailWidth(): [number, (w: number) => void, (el: HTMLElement
  | null) => void] {
  const [width, setWidth] = useState(() => {
    const saved = Number(localStorage.getItem(RAIL_KEY));
    return Number.isFinite(saved) && saved >= RAIL_MIN ? saved : 0;
  });

  const set = (w: number): void => {
    const clamped = Math.min(RAIL_MAX, Math.max(RAIL_MIN, w));
    setWidth(clamped);
    localStorage.setItem(RAIL_KEY, String(clamped));
  };

  // Only measures when there is no stored preference: someone who has
  // sized the rail themselves keeps that size.
  const measure = (el: HTMLElement | null): void => {
    if (el === null || width !== 0) return;
    // The container's own scrollWidth already accounts for padding and
    // borders; summing children missed both. The margin covers the
    // vertical scrollbar, which otherwise steals the last few pixels
    // and pushes the tabs into a second row.
    const fitted = Math.min(RAIL_MAX,
                            Math.max(RAIL_MIN, el.scrollWidth + 20));
    setWidth(fitted);
    localStorage.setItem(RAIL_KEY, String(fitted));
  };

  return [width === 0 ? RAIL_MIN : width, set, measure];
}

function RailResizeHandle({ onDrag }: {
  onDrag: (clientX: number) => void;
}): JSX.Element {
  return (
    <div className="rail-resize-handle"
         onPointerDown={(e) => {
           e.preventDefault();
           const move = (ev: PointerEvent): void => onDrag(ev.clientX);
           const up = (): void => {
             window.removeEventListener("pointermove", move);
             window.removeEventListener("pointerup", up);
           };
           window.addEventListener("pointermove", move);
           window.addEventListener("pointerup", up);
         }} />
  );
}

export function Workbench(): JSX.Element {
  const [railWidth, setRailWidth, measureRail] = useRailWidth();
  // A diagnostic, not a workspace: an overlay reachable from anywhere
  // rather than a seventh nav tab, because it reads whatever row is
  // already open.
  const [identityOpen, setIdentityOpen] = useState(false);
  const { projectName, navMode, setNavMode, openRow,
          selectedEntityType, selectedSubject } = useStore();

  const main = openRow !== null
    ? <EntityForm key={`${openRow.entity}:${String(openRow.id)}`} />
    : navMode === "script"
      ? <ScriptView />
    : navMode === "structure"
      ? <StructureView />
    : navMode === "shoot"
      ? <ShootView />
    : navMode === "queries"
      ? <QueryRunner />
    : navMode === "assets"
      ? <AssetBrowser />
      // Subjects mode never falls through to the schema list: with no
      // subject picked it showed whichever entity the Schema tab was
      // last on, so switching subject type landed on Story Beats.
      : navMode === "subject"
      ? (selectedSubject !== null
          ? <SubjectView
              key={`${selectedSubject.entity}:${selectedSubject.id}`} />
          : <EmptyMain />)
      : selectedEntityType !== null
        ? <EntityList entity={selectedEntityType} />
        : <EmptyMain />;

  const errorMessage = useStoreRaw((st) => st.errorMessage);
  return (
    <div className="workbench">
      {errorMessage !== null && (
        <div className="error-toast" role="alert">
          <span>{errorMessage}</span>
          <button onClick={() =>
            useStoreRaw.setState({ errorMessage: null })}>×</button>
        </div>
      )}
      <header className="topbar">
        <span className="topbar-mark">SCF</span>
        <span className="topbar-project">{projectName}</span>
        <span className="topbar-schema"
              title={`scf-app ${__APP_VERSION__} · ${__APP_COMMIT__}` +
                     ` · built ${__APP_BUILT__}`}>
          schema {registry.schemaVersion} · v{__APP_VERSION__}
        </span>
        <RootStatus />
        <button className="ghost tiny"
                aria-pressed={identityOpen}
                title="Row identity: uuid coverage, lookup, version chains"
                onClick={() => setIdentityOpen((v) => !v)}>
          Identity
        </button>
        <SearchBox />
        <SaveControls />
          <button onClick={() => {
            const st = useStoreRaw.getState();
            const unsaved = st.revision !== st.lastSavedRevision;
            if (!unsaved || window.confirm(
                "You have changes not yet saved to your .scf file — " +
                "they remain only in this browser (Resume can reopen " +
                "them). Close the project anyway?")) {
              void st.closeProject();
            }
          }}>
            Close project
          </button>
      </header>
      <div className="panels">
        <nav className="rail rail-nav" style={{ width: railWidth }}>
          <RailResizeHandle onDrag={(x) =>
            setRailWidth(x - (document.querySelector(".rail-nav")
              ?.getBoundingClientRect().left ?? 0))} />
          <div className="nav-modes" role="tablist" ref={measureRail}>
            <button role="tab" aria-selected={navMode === "script"}
                    className={navMode === "script" ? "active" : ""}
                    onClick={() => setNavMode("script")}>
              Script
            </button>
            <button role="tab" aria-selected={navMode === "structure"}
                    className={navMode === "structure" ? "active" : ""}
                    onClick={() => setNavMode("structure")}>
              Structure
            </button>
            <button role="tab" aria-selected={navMode === "shoot"}
                    className={navMode === "shoot" ? "active" : ""}
                    onClick={() => setNavMode("shoot")}>
              Shoot
            </button>
            <button role="tab" aria-selected={navMode === "schema"}
                    className={navMode === "schema" ? "active" : ""}
                    onClick={() => setNavMode("schema")}>
              Schema
            </button>
            <button role="tab" aria-selected={navMode === "subject"}
                    className={navMode === "subject" ? "active" : ""}
                    onClick={() => setNavMode("subject")}>
              Subjects
            </button>
            <button role="tab" aria-selected={navMode === "queries"}
                    className={navMode === "queries" ? "active" : ""}
                    onClick={() => setNavMode("queries")}>
              Queries
            </button>
            <button role="tab" aria-selected={navMode === "assets"}
                    className={navMode === "assets" ? "active" : ""}
                    onClick={() => setNavMode("assets")}>
              Assets
            </button>
          </div>
          {navMode === "subject" ? <SubjectNav />
            : navMode === "schema" ? <CategoryTree />
            : navMode === "script" ? <SceneRail />
            : navMode === "assets" ? <AssetPathRail />
            : navMode === "structure" || navMode === "shoot" ? null
            : <QueryIndex />}
        </nav>
        <main className="main-panel">{main}<UndoToast /></main>
        {openRow !== null && openRow.id !== null && (
          <aside className="rail rail-context">
            <ReverseLinks entity={openRow.entity} id={openRow.id} />
          </aside>
        )}
        {identityOpen && (
          <IdentityPanel onClose={() => setIdentityOpen(false)} />
        )}
      </div>
    </div>
  );
}

/**
 * Whether this session can see the project folder — and the way to give
 * it one.
 *
 * Silent when the root is granted and checked; there is nothing to say.
 * A reload keeps the handle and drops the grant, so the re-grant lives
 * here as one click inside a user gesture; the browser rejects the
 * request anywhere else, and that restriction is the point of the
 * prompt.
 *
 * "no folder" used to be a label describing a dead end. It is a button
 * now, because the dead end was never real: the platform will not walk
 * from a file to its parent, but it will happily confirm that a folder
 * the user names contains that file. This is the same gesture the
 * re-grant already is, and it sits in the same place for the same
 * reason.
 */
function RootStatus(): JSX.Element | null {
  const { projectRoot, rootPermission, rootTraversal, rootTraversalError,
          rootVerified, attachError, attachFolder, dismissAttachError,
          folderSupported, regrantRoot } = useStore();

  const refusal = attachError === null ? null : (
    <button className="topbar-root-refusal"
            onClick={dismissAttachError}
            title="Click to dismiss">
      {attachError}
    </button>
  );

  if (projectRoot === null) {
    return (
      <>
        <button className="ghost tiny topbar-root-attach"
                onClick={() => void attachFolder()}
                disabled={!folderSupported}
                title="No project folder, so assets cannot resolve. Pick
the folder this .scf lives in — the browser cannot find it from the file,
but it can confirm the one you name is the right one.">
          no folder
        </button>
        {refusal}
      </>
    );
  }
  if (rootPermission === "granted" && rootTraversal === "blocked") {
    return (
      <span className="topbar-root topbar-root-blocked"
            title={`The folder is connected, but files cannot be reached
through it on this machine, so assets will not resolve. ` +
              (rootTraversalError ?? "")}>
        folder unreadable
      </span>
    );
  }
  // Granted, readable, but nothing confirmed it is the right folder —
  // the session had no file on disk to check against. Said out loud
  // rather than left silent: an asset that resolves from the wrong
  // folder looks exactly like one that resolves from the right one.
  if (rootPermission === "granted" && !rootVerified) {
    return (
      <>
        <span className="topbar-root muted"
              title="Folder connected, but this session has no .scf on
disk, so nothing could check that the folder is the right one. Assets
resolve against whatever is in it.">
          folder unverified
        </span>
        {refusal}
      </>
    );
  }
  if (rootPermission === "granted") return refusal;
  return (
    <>
      <button className="ghost tiny topbar-root-regrant"
              onClick={() => void regrantRoot()}
              title="This session remembers the project folder but lost
permission to read it on reload.">
        Reconnect folder
      </button>
      {refusal}
    </>
  );
}

/**
 * Save + Save As, with the Commit button's light: accent while the
 * working database is ahead of the .scf file on disk, dim once the two
 * agree. A project that has no file yet (demo, new project) counts as
 * ahead — nothing of it is durable until a first save picks a
 * destination — and the tooltip says so rather than leaving the colour
 * to be guessed at.
 */
/**
 * A delete is the one action with no other way back — there is no file
 * history until you save, and no row-level version. So it gets a toast
 * rather than a confirmation dialog: confirmations interrupt every
 * delete to prevent the rare wrong one, an undo interrupts none.
 */
function UndoToast(): JSX.Element | null {
  const { undo, undoDelete, dismissUndo } = useStore();
  if (undo === null) return null;
  return (
    <div className="undo-toast" role="status">
      <span>{undoSummary(undo)}</span>
      <button className="ghost tiny"
              onClick={() => void undoDelete()}>Undo</button>
      <button className="ghost tiny" aria-label="dismiss"
              onClick={dismissUndo}>×</button>
    </div>
  );
}

function SaveControls(): JSX.Element {
  const { saveProject, saveProjectAs, saving, revision,
          lastSavedRevision, fileToken, projectName } = useStore();
  const [flash, setFlash] = useState(false);
  const seen = useRef(lastSavedRevision);

  useEffect(() => {
    if (lastSavedRevision === seen.current) return;
    seen.current = lastSavedRevision;
    setFlash(true);
    const t = window.setTimeout(() => setFlash(false), 1600);
    return () => window.clearTimeout(t);
  }, [lastSavedRevision]);

  const noFileYet = fileToken === null;
  const dirty = revision !== lastSavedRevision || noFileYet;
  const label = saving ? "Saving…" : flash ? "Saved" : "Save project";

  return (
    <>
      <button className={(dirty ? "save-dirty" : "save-clean") +
                         (flash && !dirty ? " save-flash" : "")}
              disabled={saving}
              onClick={() => void saveProject()}
              title={noFileYet
                ? `${projectName ?? "This project"} has no file yet. ` +
                  "Your work is in browser storage; Save will ask where " +
                  "to write the .scf file."
                : dirty
                  ? "Write these changes out to your .scf file on disk. " +
                    "Until you do, they are only in browser storage."
                  : "Your .scf file on disk matches this session."}>
        {label}
      </button>
      <button disabled={saving}
              onClick={() => void saveProjectAs()}
              title={"Write to a new .scf file (version up or rename); " +
                     "the project then follows that file"}>
        Save as…
      </button>
    </>
  );
}

function EmptyMain(): JSX.Element {
  return (
    <div className="empty-main">
      <p>Pick a subject to see everything addressed to it, or switch to
         Schema to browse by entity type.</p>
    </div>
  );
}
