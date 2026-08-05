/**
 * registry.ts — the SCF entity registry, as consumed by scf-core.
 *
 * The registry's source of truth is Python (schema/entity_registry.py);
 * registry.json is a checked-in build artifact emitted by
 * scripts/generate_registry_json.py. This module defines the types and the
 * lookup helpers the semantics layer needs. Nothing here hand-defines an
 * entity (design doc, "scf-core as its own package", point 1).
 */

export type FieldType =
  | "text" | "textarea" | "integer" | "float" | "select" | "multiselect"
  | "boolean" | "json" | "reference" | "timestamp";

export type PositionPattern =
  | "none" | "explicit" | "sparse_persistence" | "latest_wins";

export interface FieldDef {
  name: string;
  label: string;
  fieldType: FieldType;
  /** Effective SQL column type, resolved by the generator. */
  sqlType: string;
  required: boolean;
  tab: string;
  autoInjected: boolean;
  default?: string | number | boolean;
  placeholder?: string;
  options?: string[];
  referenceEntity?: string;
  helpText?: string;
  hidden?: boolean;
}

export interface EntityDef {
  name: string;
  label: string;
  labelPlural: string;
  icon: string;
  nameField: string;
  category: string;
  description: string;
  sortOrder: number;
  tier: number;
  parentEntity: string | null;
  parentField: string | null;
  versionable: boolean;
  hasLifecycleStatus: boolean;
  hasExternalId: boolean;
  // Phase A ontology
  subject: string | null;
  scope: string | null;
  paired: boolean;
  positionPattern: PositionPattern;
  refines: string[];
  queries: string[];
  fields: FieldDef[];
}

export interface FrameworkColumn {
  name: string;
  sqlType: string;
  default?: string;
}

export interface RegistryJson {
  schemaVersion: string;
  generatorVersion: string;
  frameworkColumns: FrameworkColumn[];
  uuidExtraTables: string[];
  entityCount: number;
  entities: EntityDef[];
}

/** The registry as scf-core uses it: json payload + name index. */
export interface Registry {
  schemaVersion: string;
  uuidExtraTables: string[];
  entities: Map<string, EntityDef>;
  /** Registration order preserved (matters for UI grouping and diffs). */
  order: string[];
}

export function loadRegistry(json: RegistryJson): Registry {
  const entities = new Map<string, EntityDef>();
  for (const e of json.entities) entities.set(e.name, e);
  if (entities.size !== json.entityCount) {
    throw new Error(
      `registry.json inconsistent: entityCount=${json.entityCount} ` +
      `but ${entities.size} unique entities`);
  }
  return {
    schemaVersion: json.schemaVersion,
    uuidExtraTables: json.uuidExtraTables,
    entities,
    order: json.entities.map((e) => e.name),
  };
}

/**
 * Entities from cascade root(s) to leaf via `refines`, depth-first
 * postorder so parents precede children and the leaf is last. Multi-parent
 * entities contribute parents in declared order.
 * (Port of resolution.py::_cascade_chain.)
 */
export function cascadeChain(registry: Registry, leaf: string): string[] {
  const seen: string[] = [];
  const visit = (name: string): void => {
    const e = registry.entities.get(name);
    if (e === undefined || seen.includes(name)) return;
    for (const parent of e.refines) visit(parent);
    seen.push(name);
  };
  visit(leaf);
  return seen;
}
