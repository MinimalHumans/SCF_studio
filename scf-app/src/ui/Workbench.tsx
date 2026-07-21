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
import { useStore as useStoreRaw } from "../state/store.ts";
import { Component, type ReactNode } from "react";

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

export function Workbench(): JSX.Element {
  const { projectName, saveProject, navMode, setNavMode, openRow,
          selectedEntityType, selectedSubject } = useStore();

  const main = openRow !== null
    ? <EntityForm key={`${openRow.entity}:${String(openRow.id)}`} />
    : navMode === "script"
      ? <ScriptView />
    : navMode === "queries"
      ? <QueryRunner />
      : navMode === "subject" && selectedSubject !== null
      ? <SubjectView key={`${selectedSubject.entity}:${selectedSubject.id}`} />
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
        <span className="topbar-schema">
          schema {registry.schemaVersion}
        </span>
        <SearchBox />
        <button className="primary" onClick={() => void saveProject()}>
          Save project
        </button>
      </header>
      <div className="panels">
        <nav className="rail rail-nav">
          <div className="nav-modes" role="tablist">
            <button role="tab" aria-selected={navMode === "subject"}
                    className={navMode === "subject" ? "active" : ""}
                    onClick={() => setNavMode("subject")}>
              Subjects
            </button>
            <button role="tab" aria-selected={navMode === "schema"}
                    className={navMode === "schema" ? "active" : ""}
                    onClick={() => setNavMode("schema")}>
              Schema
            </button>
            <button role="tab" aria-selected={navMode === "queries"}
                    className={navMode === "queries" ? "active" : ""}
                    onClick={() => setNavMode("queries")}>
              Queries
            </button>
            <button role="tab" aria-selected={navMode === "script"}
                    className={navMode === "script" ? "active" : ""}
                    onClick={() => setNavMode("script")}>
              Script
            </button>
          </div>
          {navMode === "subject" ? <SubjectNav />
            : navMode === "schema" ? <CategoryTree />
            : navMode === "script" ? <SceneRail />
            : <QueryIndex />}
        </nav>
        <main className="main-panel">{main}</main>
        {openRow !== null && openRow.id !== null && (
          <aside className="rail rail-context">
            <ReverseLinks entity={openRow.entity} id={openRow.id} />
          </aside>
        )}
      </div>
    </div>
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
