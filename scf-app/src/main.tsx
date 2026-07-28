import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./ui/App.tsx";
import { useStore } from "./state/store.ts";

// Last-resort surfacing: nothing may fail silently. Any uncaught error
// or unhandled rejection becomes a visible toast (and stays in the
// console with its stack).
// Deferred: these can fire while React is mid-render (dev mode rethrows
// through the DOM), and a synchronous setState there is itself an error.
// Reload/close with work not yet written to the .scf file gets a
// browser confirmation instead of a silent trip to the start screen.
window.addEventListener("beforeunload", (event) => {
  const st = useStore.getState();
  if (st.phase === "open" && st.revision !== st.lastSavedRevision) {
    event.preventDefault();
  }
});

window.addEventListener("error", (event) => {
  const message = event.message;
  queueMicrotask(() => {
    useStore.setState({ errorMessage: `Unexpected error: ${message}` });
  });
});
window.addEventListener("unhandledrejection", (event) => {
  const reason: unknown = event.reason;
  const message = reason instanceof Error ? reason.message : String(reason);
  queueMicrotask(() => {
    useStore.setState({ errorMessage: `Unhandled failure: ${message}` });
  });
});
import "./styles.css";

const rootEl = document.getElementById("root");
if (rootEl !== null) {
  createRoot(rootEl).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}
