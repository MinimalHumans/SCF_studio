/**
 * scf-core — SCF (Story Context Framework) core library.
 *
 * Format + executable semantics + conformance target, UI-free:
 *   - registry:   entity/field types loaded from registry.json
 *                 (source of truth: schema/entity_registry.py)
 *   - db:         the SqlExec seam, initDatabase, uuid identity (2.3)
 *   - resolution: description / direction / media cascades, pattern-3
 *                 latest-wins, G4 variant selection
 *   - readiness:  Q14 reports over queryPaths
 *   - identity:   uuid coverage, lookup, and version-chain reporting
 *   - project:    what makes a folder a project (assets plan P2)
 *   - assets:     identifier grammar and resolution states (P3)
 *   - assetIndex: facets, orphans and the derived path tree (P4)
 *   - preview:    what can be displayed, in three tiers (P5)
 *   - mediaRefs:  query-side asset references and resolution reports (P6)
 *
 * Node driver lives in "./node" (separate export; never imported here so
 * browser bundles stay clean).
 */

export * from "./registry.ts";
export * from "./project.ts";
export * from "./assets.ts";
export * from "./assetIndex.ts";
export * from "./preview.ts";
export * from "./fileMetadata.ts";
export * from "./assetImport.ts";
export * from "./mediaReferences.ts";
export * from "./bundling.ts";
export * from "./db.ts";
export * from "./fileIdentity.ts";
export * from "./findings.ts";
export * from "./sceneNumbers.ts";
export * from "./resolution.ts";
export * from "./queryPaths.ts";
export * from "./readiness.ts";
export * from "./structure.ts";
export * from "./shots.ts";
export * from "./relationships.ts";
export * from "./junctions.ts";
export * from "./identity.ts";
