/**
 * scf-core — SCF (Story Craft Format) core library.
 *
 * Format + executable semantics + conformance target, UI-free:
 *   - registry:   entity/field types loaded from registry.json
 *                 (source of truth: scf-editor/entity_registry.py)
 *   - db:         the SqlExec seam, initDatabase, uuid identity (2.3)
 *   - resolution: description / direction / media cascades, pattern-3
 *                 latest-wins, G4 variant selection
 *   - readiness:  Q14 reports over queryPaths
 *
 * Node driver lives in "./node" (separate export; never imported here so
 * browser bundles stay clean).
 */

export * from "./registry.ts";
export * from "./db.ts";
export * from "./resolution.ts";
export * from "./queryPaths.ts";
export * from "./readiness.ts";
