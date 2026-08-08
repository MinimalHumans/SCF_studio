"""
SCF Entity Registry — Full Schema
====================================
This is the single source of truth for all entity types in the SCF format.
Adding a new entity type means adding an entry here — the database tables,
API routes, and UI forms are all generated from this registry automatically.

Schema derived from the Story State Framework (SSF) specification:
  - Layer Hierarchy (Vision / Performance / Creative)
  - ~100 entity types across all layers
  - Tiered population: Tier 0 (structural) through Tier 6 (production)

Entity categories use functional groupings for the editor sidebar.

Field types: text, textarea, integer, float, select, multiselect, boolean,
             json, reference, timestamp

PHASE 1B: foundation infrastructure + character cluster redesign.
PHASE 1C: schema-wide cleanup (lowercase normalization, status field renames,
          external_id propagation, cut additions, etc.)
PHASE 1D: prop & location cluster redesign — slim prop and location,
          add prop_surface_profile / prop_variant / prop_asset_binding /
          prop_shot_override / location_asset_binding / location_shot_override /
          clip_prop, generalize identity_anchor → entity_anchor with constrained
          polymorphism, add `acoustic` bundle intent, structure location_variant
          state axes.
PHASE 2A (current): schema consolidation — Tier 1 singletons 17 → 9; motif /
          symbol family collapsed into one modality-typed `motif` entity with a
          single `motif_appearance` junction; performance micro-entities
          collapsed into modality-typed `performance_beat` / `performance_state`;
          blocking_beat + action_beat unified as `staging_beat`; delivery and
          facial profiles folded into vocal / physical profiles; physical
          relationship folded into character_relationship; proxemics folded
          into scene_blocking; reference-field naming fixes
          (associated_character_id, primary/secondary_character_id).
"""

from dataclasses import dataclass, field
from typing import Any


# =============================================================================
# Standard enums — shared across the schema
# =============================================================================

LIFECYCLE_STATUS_OPTIONS = [
    "active",        # current, in use
    "draft",         # work in progress, not yet promoted
    "superseded",    # replaced by a newer version (versionable entities only)
    "deprecated",    # explicitly no longer preferred, kept for reference
    "cut",           # intentionally removed from the work but preserved
    "archived",      # historical, not actively maintained
]

PRODUCTION_STATUS_OPTIONS = [
    "development",
    "pre_production",
    "production",
    "post_production",
    "complete",
]

WRITING_STATUS_OPTIONS = [
    "outline",
    "draft",
    "revised",
    "locked",
    "cut",
]

LIFECYCLE_TAB = "Lifecycle"
EXTERNAL_TAB = "External"


# =============================================================================
# Field and Entity definitions
# =============================================================================

@dataclass
class FieldDef:
    """Definition of a single field on an entity."""
    name: str
    label: str
    field_type: str = "text"
    required: bool = False
    default: Any = None
    placeholder: str = ""
    options: list[str] | None = None
    reference_entity: str | None = None
    tab: str = "General"
    help_text: str = ""
    hidden: bool = False
    sql_type: str | None = None
    auto_injected: bool = False

    def get_sql_type(self) -> str:
        if self.sql_type:
            return self.sql_type
        return {
            "text": "TEXT",
            "textarea": "TEXT",
            "integer": "INTEGER",
            "float": "REAL",
            "select": "TEXT",
            "multiselect": "TEXT",
            "boolean": "INTEGER",
            "json": "TEXT",
            "reference": "INTEGER",
            "timestamp": "TEXT",
        }.get(self.field_type, "TEXT")


@dataclass
class EntityDef:
    """Definition of an entity type.

    Three flags control auto-injection of standard fields:
      - versionable: adds 5 version chain fields (parent_id, version_label,
        superseded_at, superseded_by_id) plus uses lifecycle_status as the
        active/superseded driver
      - has_lifecycle_status: adds the lifecycle_status field (default True;
        opt-out for junctions and entities that don't track lifecycle state)
      - has_external_id: adds external_id + external_id_namespace fields
    """
    name: str
    label: str
    label_plural: str
    icon: str = "📄"
    name_field: str = "name"
    fields: list[FieldDef] = field(default_factory=list)
    parent_entity: str | None = None
    parent_field: str | None = None
    category: str = "Entities"
    description: str = ""
    sort_order: int = 0
    tier: int = 0

    versionable: bool = False
    has_lifecycle_status: bool = True
    has_external_id: bool = False

    # --- Ontology metadata (Phase A; see conventions.md "Ontology metadata") ---
    # subject: which core concept this entity describes.
    #   One of: character, location, prop, scene, shot, project, story, theme,
    #   link (junctions), meta (assets/decisions/notes/corpus machinery).
    # scope: the finest story-position key the entity can carry.
    #   One of: global, act, sequence, scene, shot, moment.
    # paired: entity describes a *pair* of its subject (e.g. character_relationship).
    # refines: entities one layer up this entity's direction cascade (may be
    #   multiple; the resolver concatenates parents in declared order).
    # queries: canonical query IDs this entity serves (the Rule: must be
    #   non-empty; see docs/design/20260713_SCF_Canonical_Queries.md).
    subject: str | None = None
    scope: str | None = None
    paired: bool = False
    # position_pattern: how the entity's position key resolves.
    #   none — not position-keyed
    #   explicit — one authored row per position, no inference (costume_scene)
    #   sparse_persistence — persistence/resolved_at fields (performance_state)
    #   latest_wins — latest row at-or-before P is in force (state tables)
    position_pattern: str = "none"
    refines: list[str] = field(default_factory=list)
    queries: list[str] = field(default_factory=list)

    def __post_init__(self) -> None:
        if self.has_lifecycle_status:
            self._inject_lifecycle_status()
        if self.versionable:
            self._inject_version_fields()
        if self.has_external_id:
            self._inject_external_id_fields()

    def _inject_lifecycle_status(self) -> None:
        if any(f.name == "lifecycle_status" for f in self.fields):
            return
        self.fields.append(FieldDef(
            name="lifecycle_status",
            label="Lifecycle Status",
            field_type="select",
            options=LIFECYCLE_STATUS_OPTIONS,
            default="active",
            tab=LIFECYCLE_TAB,
            help_text="Cross-cutting record state. See conventions.md.",
            auto_injected=True,
        ))

    def _inject_version_fields(self) -> None:
        existing = {f.name for f in self.fields}
        to_add = [
            FieldDef(
                name="parent_id",
                label="Parent Version",
                field_type="reference",
                reference_entity=self.name,
                tab=LIFECYCLE_TAB,
                help_text="Previous version in the chain. Null for root version.",
                auto_injected=True,
            ),
            FieldDef(
                name="version_label",
                label="Version Label",
                field_type="text",
                tab=LIFECYCLE_TAB,
                placeholder='e.g. "v1.2", "approved-final"',
                help_text="Human-readable version identifier. Tool-managed.",
                auto_injected=True,
            ),
            FieldDef(
                name="superseded_at",
                label="Superseded At",
                field_type="timestamp",
                tab=LIFECYCLE_TAB,
                help_text="Set when a successor version becomes active.",
                auto_injected=True,
            ),
            FieldDef(
                name="superseded_by_id",
                label="Superseded By",
                field_type="reference",
                reference_entity=self.name,
                tab=LIFECYCLE_TAB,
                help_text="Forward pointer to successor. Auto-set on supersession.",
                auto_injected=True,
            ),
        ]
        for f in to_add:
            if f.name not in existing:
                self.fields.append(f)

    def _inject_external_id_fields(self) -> None:
        existing = {f.name for f in self.fields}
        to_add = [
            FieldDef(
                name="external_id",
                label="External ID",
                field_type="text",
                tab=EXTERNAL_TAB,
                placeholder="identifier in external system",
                help_text="Optional. Identifier in an external system "
                          "(OMC, EIDR, production DB, etc.). See conventions.md.",
                auto_injected=True,
            ),
            FieldDef(
                name="external_id_namespace",
                label="External ID Namespace",
                field_type="text",
                tab=EXTERNAL_TAB,
                placeholder='e.g. "omc", "eidr", "shotgrid:project_42"',
                help_text="Which external system the identifier belongs to.",
                auto_injected=True,
            ),
        ]
        for f in to_add:
            if f.name not in existing:
                self.fields.append(f)

    def get_tabs(self) -> list[str]:
        tabs = []
        for f in self.fields:
            if not f.hidden and f.tab not in tabs:
                tabs.append(f.tab)
        return tabs

    def get_fields_for_tab(self, tab: str) -> list[FieldDef]:
        return [f for f in self.fields if f.tab == tab]

    def is_versionable(self) -> bool:
        return self.versionable


ENTITY_REGISTRY: dict[str, EntityDef] = {}


def register(entity: EntityDef):
    ENTITY_REGISTRY[entity.name] = entity
    return entity


# #############################################################################
#  TIER 0 — STRUCTURAL FOUNDATION
# #############################################################################

register(EntityDef(
    name="project",
    label="Project",
    label_plural="Projects",
    icon="🎬",
    category="Project",
    sort_order=0,
    tier=0,
    description="The root container for an SCF story project.",
    has_external_id=True,
    fields=[
        FieldDef("name", "Project Name", required=True, placeholder="e.g. My Feature Film"),
        FieldDef("logline", "Logline", "textarea", placeholder="A one-sentence summary of the story"),
        FieldDef("genre", "Genre", "select", options=[
            "drama", "comedy", "thriller", "sci-fi", "fantasy", "horror",
            "action", "romance", "documentary", "animation", "western", "other"
        ]),
        FieldDef("tone", "Tone", "text", placeholder="e.g. Dark, whimsical, gritty"),
        FieldDef("setting_period", "Setting / Time Period", "text",
                 placeholder="e.g. Victorian England, Near-future Tokyo"),
        FieldDef("target_runtime", "Target Runtime (minutes)", "integer"),
        FieldDef("project_format", "Format", "select", options=[
            "feature", "series", "short", "commercial", "other"
        ]),
        FieldDef("production_status", "Production Status", "select", options=[
            "development", "pre_production", "production",
            "post_production", "complete"
        ], default="development",
                 help_text="Project-level production phase axis."),
        FieldDef("workflow_mode", "Workflow Mode", "select", options=[
            "performance_first", "generation_first", "hybrid"
        ], default="generation_first",
                 help_text="Dominant production workflow stance."),
        FieldDef("scene_numbering", "Scene Numbering", "select", options=[
            "derived", "fixed"
        ], default="derived",
                 help_text="derived: scene numbers are recomputed from the "
                           "script's order at every commit. fixed: never "
                           "touched — what an imported script needs, since a "
                           "production's own numbering may be gapped or out "
                           "of sequence and is data, not a derivation. The "
                           "first step toward production locking."),
        FieldDef("notes", "Notes", "textarea", tab="Notes"),
        FieldDef("vision_statement", "Vision Statement", "textarea", tab="Vision"),
        FieldDef("creative_philosophy", "Creative Philosophy", "textarea", tab="Vision"),
        FieldDef("themes", "Core Themes", "json", tab="Vision",
                 placeholder='["redemption", "identity", "power"]'),
    ],
))

register(EntityDef(
    name="character",
    label="Character",
    label_plural="Characters",
    icon="👤",
    category="Story Entities",
    sort_order=10,
    tier=0,
    description="A character in the story. Identity and narrative function only — "
                "physical/vocal/wardrobe details live in Tier 2 description entities.",
    has_external_id=True,
    fields=[
        FieldDef("name", "Character Name", required=True, placeholder="e.g. Eleanor Vance"),
        FieldDef("role", "Role", "select", options=[
            "protagonist", "antagonist", "supporting", "minor", "background", "narrator"
        ]),
        FieldDef("archetype", "Archetype", "text", placeholder="e.g. The Mentor, The Trickster"),
        FieldDef("age", "Age", "text", placeholder="e.g. 34, Late 20s, Ageless"),
        FieldDef("gender", "Gender", "text"),
        FieldDef("pronouns", "Pronouns", "text", placeholder="e.g. he/him, she/her, they/them"),
        FieldDef("occupation", "Occupation", "text"),
        FieldDef("casting_status", "Casting Status", "select", options=[
            "tbd", "cast", "actor_as_character", "digital_double", "generated_only"
        ], default="tbd",
                 help_text="Whether this character has a real-world actor anchor. "
                           "Drives downstream tool expectations."),
        FieldDef("summary", "Character Summary", "textarea",
                 placeholder="Brief description of who this character is"),
        FieldDef("backstory", "Backstory", "textarea", tab="Backstory"),
        FieldDef("motivation", "Core Motivation", "textarea", tab="Backstory"),
        FieldDef("flaw", "Fatal Flaw", "text", tab="Backstory"),
        FieldDef("arc_description", "Character Arc", "textarea", tab="Backstory"),
        FieldDef("internal_goal", "Internal Goal", "textarea", tab="Backstory"),
        FieldDef("external_goal", "External Goal", "textarea", tab="Backstory"),
        FieldDef("greatest_fear", "Greatest Fear", "textarea", tab="Backstory"),
        FieldDef("core_belief", "Core Belief", "textarea", tab="Backstory"),
        FieldDef("education_level", "Education Level", "text", tab="Backstory"),
        FieldDef("skills_abilities", "Skills & Abilities", "textarea", tab="Backstory"),
    ],
))

# ---------------------------------------------------------------------------
# Location (Phase 1D — aggressively slimmed)
# ---------------------------------------------------------------------------
# Removed (now lives in existing Tier 2 entities):
#   - mood, lighting, color_palette → location_design + location_color_scheme
#   - time_of_day, weather → moved to location_variant as state axes
#   - ambient_sound, sound_notes → location_sound_profile
#   - props_present → scene_prop junction and set_dressing
# Added:
#   - realization_status
# Auto-injected via has_external_id=True: external_id, external_id_namespace
register(EntityDef(
    name="location",
    label="Location",
    label_plural="Locations",
    icon="📍",
    category="Story Entities",
    sort_order=20,
    tier=0,
    description="A location where story events take place. Identity and narrative "
                "function only — architectural/visual detail lives in location_design, "
                "color in location_color_scheme, sound in location_sound_profile, and "
                "state variation (time-of-day, weather, post-event) in location_variant.",
    has_external_id=True,
    fields=[
        FieldDef("name", "Location Name", required=True, placeholder="e.g. The Old Mill"),
        FieldDef("location_type", "Type", "select", options=[
            "interior", "exterior", "int/ext", "virtual", "abstract"
        ]),
        FieldDef("setting", "Setting Description", "textarea",
                 placeholder="What does this place look and feel like? (narrative-level)"),
        FieldDef("time_period", "Time Period", "text"),
        FieldDef("geography", "Geography / Region", "text",
                 placeholder="e.g. Northern California coast"),
        FieldDef("realization_status", "Realization Status", "select", options=[
            "tbd", "real_location", "built", "plate_captured",
            "virtual_set", "hybrid", "generated_only"
        ], default="tbd",
                 help_text="How this location is realized in production. "
                           "real_location = found and shot in-camera; built = constructed set; "
                           "plate_captured = photographic plate only; virtual_set = LED wall / "
                           "volumetric; hybrid = combined methods (practical + extension etc.); "
                           "generated_only = fully synthetic."),
        FieldDef("key_features", "Key Features", "textarea", tab="Details",
                 placeholder="Notable objects, architecture, landmarks. "
                             "Specific dressing belongs in set_dressing."),
        FieldDef("notes", "Notes", "textarea", tab="Details"),
    ],
))

# ---------------------------------------------------------------------------
# Prop (Phase 1D — slimmed, option c)
# ---------------------------------------------------------------------------
# Removed (now lives in prop_surface_profile):
#   - material, size, color, condition, physical_notes
# Added:
#   - realization_status
# Auto-injected via has_external_id=True: external_id, external_id_namespace
register(EntityDef(
    name="prop",
    label="Prop",
    label_plural="Props",
    icon="🔧",
    category="Story Entities",
    sort_order=30,
    tier=0,
    description="A significant object in the story. Identity, narrative function, "
                "and story moments — surface/material detail lives in prop_surface_profile, "
                "state variation (clean/damaged/symbolic) in prop_variant.",
    has_external_id=True,
    fields=[
        FieldDef("name", "Prop Name", required=True, placeholder="e.g. The Silver Compass"),
        FieldDef("prop_type", "Type", "select", options=[
            "hand prop", "set dressing", "vehicle", "weapon", "document",
            "technology", "clothing item", "food/drink", "other"
        ]),
        FieldDef("description", "Description", "textarea",
                 placeholder="What does this prop look like?"),
        FieldDef("realization_status", "Realization Status", "select", options=[
            "tbd", "sourced", "built", "scanned", "hybrid", "generated_only"
        ], default="tbd",
                 help_text="How this prop is realized in production. "
                           "sourced = found / purchased real object; built = fabricated; "
                           "scanned = real object digitally captured; hybrid = combined "
                           "methods (practical + VFX, sourced + CG damage, plate replacement, "
                           "miniature, etc.); generated_only = fully synthetic."),
        FieldDef("narrative_significance", "Narrative Significance", "textarea",
                 placeholder="Why does this prop matter to the story?"),
        FieldDef("story_function", "Story Function", "select", options=[
            "macguffin", "character extension", "plot device", "symbol", "atmosphere", "other"
        ]),
        FieldDef("associated_character_id", "Primary Character", "reference",
                 reference_entity="character"),
        FieldDef("first_appearance", "First Appearance", "textarea", tab="Story"),
        FieldDef("key_moments", "Key Moments", "textarea", tab="Story"),
        FieldDef("symbolism", "Symbolism", "textarea", tab="Story"),
        FieldDef("notes", "Notes", "textarea", tab="Notes"),
    ],
))

register(EntityDef(
    name="act",
    label="Act",
    label_plural="Acts",
    icon="🎭",
    category="Story Structure",
    sort_order=30,
    tier=0,
    description="A major structural division of the story.",
    fields=[
        FieldDef("name", "Act Name", required=True),
        FieldDef("act_number", "Act Number", "integer"),
        FieldDef("start_scene_id", "Starts At Scene", "reference",
                 reference_entity="scene",
                 help_text="The scene this act begins at. The act runs "
                           "until the next act begins, so no end is "
                           "stored and acts cannot overlap or leave gaps."),
        FieldDef("function", "Function", "textarea"),
        FieldDef("dramatic_question", "Dramatic Question", "textarea"),
        FieldDef("shift", "Shift", "textarea"),
        FieldDef("summary", "Summary", "textarea"),
        FieldDef("status", "Status", "select", options=[
            "outline", "draft", "revised", "locked", "cut"
        ], default="outline",
                 help_text="Writing-process status. Distinct from lifecycle_status."),
        FieldDef("notes", "Notes", "textarea", tab="Notes"),
    ],
))

register(EntityDef(
    name="sequence",
    label="Sequence",
    label_plural="Sequences",
    icon="📑",
    category="Story Structure",
    sort_order=35,
    tier=0,
    description="A group of related scenes forming a narrative unit.",
    fields=[
        FieldDef("name", "Sequence Name", required=True),
        FieldDef("sequence_number", "Sequence Number", "integer"),
        FieldDef("act_id", "Act", "reference", reference_entity="act"),
        FieldDef("start_scene_id", "Starts At Scene", "reference",
                 reference_entity="scene",
                 help_text="The scene this sequence begins at. It runs "
                           "until the next sequence begins."),
        FieldDef("summary", "Summary", "textarea"),
        FieldDef("goal", "Goal", "textarea"),
        FieldDef("conflict", "Conflict", "textarea"),
        FieldDef("outcome", "Outcome / Resolution", "textarea"),
        FieldDef("purpose", "Dramatic Purpose", "textarea"),
        FieldDef("turning_point", "Turning Point", "textarea"),
        FieldDef("status", "Status", "select", options=[
            "outline", "draft", "revised", "locked", "cut"
        ], default="outline"),
        FieldDef("notes", "Notes", "textarea", tab="Notes"),
    ],
))

register(EntityDef(
    name="scene",
    label="Scene",
    label_plural="Scenes",
    icon="🎬",
    category="Story Structure",
    sort_order=40,
    tier=0,
    description="A single scene in the story.",
    has_external_id=True,
    fields=[
        FieldDef("name", "Scene Name / Slug", required=True),
        FieldDef("scene_number", "Scene Number", "integer"),
        FieldDef("int_ext", "Int/Ext", "select", options=[
            "interior", "exterior", "int/ext"
        ]),
        FieldDef("location_id", "Location", "reference", reference_entity="location"),
        FieldDef("time_of_day", "Time of Day", "select", options=[
            "dawn", "morning", "midday", "afternoon", "dusk", "night", "continuous"
        ]),
        FieldDef("weather_conditions", "Weather", "text"),
        FieldDef("season", "Season", "select", options=[
            "spring", "summer", "autumn", "winter", "unspecified"
        ]),
        FieldDef("summary", "Scene Summary", "textarea"),
        FieldDef("purpose", "Dramatic Purpose", "textarea"),
        FieldDef("status", "Status", "select", options=[
            "outline", "draft", "revised", "locked", "cut"
        ], default="outline"),
        FieldDef("characters_present", "Characters Present", "json", tab="Characters",
                 hidden=True),
        FieldDef("character_dynamics", "Character Dynamics", "textarea", tab="Characters"),
        FieldDef("emotional_beat", "Emotional Beat", "textarea", tab="Emotional"),
        FieldDef("tone", "Tone", "text", tab="Emotional"),
        FieldDef("tension_level", "Tension Level (1-10)", "integer", tab="Emotional"),
        FieldDef("thematic_connection", "Thematic Connection", "textarea", tab="Emotional"),
        FieldDef("visual_style", "Visual Style Notes", "textarea", tab="Technical"),
        FieldDef("sound_design", "Sound Design Notes", "textarea", tab="Technical"),
        FieldDef("music_notes", "Music Notes", "textarea", tab="Technical"),
        FieldDef("estimated_duration", "Estimated Duration (seconds)", "integer", tab="Technical"),
        FieldDef("notes", "Notes", "textarea", tab="Notes"),
    ],
))

register(EntityDef(
    name="story_beat",
    label="Story Beat",
    label_plural="Story Beats",
    icon="🎯",
    category="Story Structure",
    sort_order=42,
    tier=0,
    description="A discrete narrative unit within a scene — a moment of change.",
    fields=[
        FieldDef("name", "Beat Name", required=True),
        FieldDef("scene_id", "Scene", "reference", reference_entity="scene"),
        FieldDef("beat_order", "Order in Scene", "integer"),
        FieldDef("beat_type", "Beat Type", "select", options=[
            "setup", "action", "reaction", "decision",
            "discovery", "revelation", "reversal", "payoff", "other"
        ]),
        FieldDef("description", "Description", "textarea"),
        FieldDef("purpose", "Purpose", "textarea"),
        FieldDef("value_shift", "Value Shift", "text"),
        FieldDef("pov_character_id", "POV Character", "reference",
                 reference_entity="character"),
        FieldDef("notes", "Notes", "textarea"),
    ],
))

register(EntityDef(
    name="theme",
    label="Theme",
    label_plural="Themes",
    icon="💡",
    category="Vision",
    sort_order=50,
    tier=0,
    description="A thematic element that runs through the story.",
    fields=[
        FieldDef("name", "Theme Name", required=True, placeholder="e.g. Redemption"),
        FieldDef("description", "Description", "textarea"),
        FieldDef("motifs", "Associated Motifs", "json"),
        FieldDef("character_connections", "Character Connections", "textarea"),
        FieldDef("scene_connections", "Key Scenes", "textarea"),
        FieldDef("evolution", "Thematic Evolution", "textarea"),
        FieldDef("notes", "Notes", "textarea", tab="Notes"),
    ],
))

# ---------------------------------------------------------------------------
# Junction entities (Tier 0 Connections)
# ---------------------------------------------------------------------------
register(EntityDef(
    name="scene_character",
    label="Scene-Character",
    label_plural="Scene-Characters",
    icon="🔗",
    category="Connections",
    sort_order=60,
    tier=0,
    description="Links a character to a scene with role information.",
    has_lifecycle_status=False,
    fields=[
        FieldDef("name", "Display Name", hidden=True),
        FieldDef("scene_id", "Scene", "reference", reference_entity="scene", required=True),
        FieldDef("character_id", "Character", "reference",
                 reference_entity="character", required=True),
        FieldDef("role_in_scene", "Role in Scene", "select", options=[
            "featured", "supporting", "background", "mentioned", "voiceover"
        ]),
        FieldDef("notes", "Notes", "textarea"),
    ],
))

register(EntityDef(
    name="scene_prop",
    label="Scene-Prop",
    label_plural="Scene-Props",
    icon="🔗",
    category="Connections",
    sort_order=61,
    tier=0,
    description="Links a prop to a scene with usage details.",
    has_lifecycle_status=False,
    fields=[
        FieldDef("name", "Display Name", hidden=True),
        FieldDef("scene_id", "Scene", "reference", reference_entity="scene", required=True),
        FieldDef("prop_id", "Prop", "reference", reference_entity="prop", required=True),
        FieldDef("usage_note", "Usage Note", "text"),
        FieldDef("significance", "Significance", "select", options=[
            "key", "present", "background", "mentioned"
        ]),
    ],
))

register(EntityDef(
    name="scene_sequence",
    label="Scene-Sequence",
    label_plural="Scene-Sequences",
    icon="🔗",
    category="Connections",
    sort_order=62,
    tier=0,
    description="Links a scene to a sequence with ordering.",
    has_lifecycle_status=False,
    fields=[
        FieldDef("name", "Display Name", hidden=True),
        FieldDef("scene_id", "Scene", "reference", reference_entity="scene", required=True),
        FieldDef("sequence_id", "Sequence", "reference",
                 reference_entity="sequence", required=True),
        FieldDef("order_in_sequence", "Order in Sequence", "integer"),
    ],
))


# #############################################################################
#  TIER 1 — PROJECT-LEVEL CREATIVE DIRECTION (unchanged)
# #############################################################################

register(EntityDef(
    name="project_vision",
    label="Project Vision",
    label_plural="Project Vision",
    icon="🔭",
    category="Creative Direction",
    sort_order=100,
    tier=1,
    description="Overarching creative intent and the director's approach to realizing it. "
                "Absorbed directorial_philosophy in the 2.0 consolidation.",
    fields=[
        FieldDef("name", "Name", default="Project Vision"),
        FieldDef("vision_statement", "Vision Statement", "textarea"),
        FieldDef("core_question", "Core Question", "textarea"),
        FieldDef("intended_audience_impact", "Intended Audience Impact", "textarea"),
        FieldDef("unique_perspective", "Unique Perspective", "textarea"),
        FieldDef("why_tell_this_story", "Why Tell This Story", "textarea"),
        FieldDef("what_makes_different", "What Makes It Different", "textarea"),
        FieldDef("success_criteria", "Success Criteria", "textarea"),
        FieldDef("filmmaking_philosophy", "Filmmaking Philosophy", "select", tab="Approach",
                 options=[
                     "auteur", "collaborative", "actor-focused", "visual-first",
                     "story-first", "experiential"
                 ]),
        FieldDef("technical_approach", "Technical Approach", "select", tab="Approach",
                 options=["naturalistic", "stylized", "mixed"]),
        FieldDef("aesthetic_priorities", "Aesthetic Priorities", "json", tab="Approach"),
        FieldDef("risk_tolerance", "Risk Tolerance", "select", tab="Approach",
                 options=["safe/commercial", "experimental", "balanced"]),
        FieldDef("audience_relationship", "Audience Relationship", "select", tab="Approach",
                 options=["accessible", "challenging", "hybrid"]),
        FieldDef("personal_resonance", "Personal Resonance", "textarea", tab="Personal"),
        FieldDef("emotional_stakes", "Emotional Stakes for Director", "textarea", tab="Personal"),
        FieldDef("artistic_growth_goals", "Artistic Growth Goals", "textarea", tab="Personal"),
    ],
))

register(EntityDef(
    name="technical_specs",
    label="Technical Specs",
    label_plural="Technical Specs",
    icon="⚙️",
    category="Creative Direction",
    sort_order=102,
    tier=1,
    description="Technical format specifications for the project.",
    fields=[
        FieldDef("name", "Name", default="Technical Specs"),
        FieldDef("aspect_ratio", "Aspect Ratio", "select", options=[
            "1.33:1 (academy)", "1.66:1", "1.78:1 (16:9)", "1.85:1 (flat)",
            "2.00:1 (univisium)", "2.20:1 (70mm)", "2.35:1 (scope)",
            "2.39:1 (anamorphic)", "2.76:1 (ultra panavision)", "variable", "other"
        ]),
        FieldDef("resolution", "Resolution", "select", options=[
            "2K (2048x1080)", "2.8K", "3.4K", "4K (4096x2160)",
            "4.6K", "5.7K", "6K", "6.5K", "8K", "other"
        ]),
        FieldDef("frame_rate", "Frame Rate", "select", options=[
            "23.976 fps", "24 fps", "25 fps", "29.97 fps", "30 fps",
            "48 fps", "60 fps", "variable", "other"
        ]),
        FieldDef("color_space", "Color Space / Gamut", "text"),
        FieldDef("recording_codec", "Recording Codec", "text"),
        FieldDef("delivery_format", "Delivery Format", "text"),
        FieldDef("audio_format", "Audio Format", "text"),
    ],
))

register(EntityDef(
    name="visual_identity",
    label="Visual Identity",
    label_plural="Visual Identity",
    icon="👁️",
    category="Creative Direction",
    sort_order=103,
    tier=1,
    description="Overarching aesthetic vision — the film's visual DNA. Single home for "
                "the project's material world, texture approach, and design constraints "
                "(absorbed material_palette, texture_philosophy, and design_constraints "
                "in the 2.0 consolidation).",
    fields=[
        FieldDef("name", "Name", default="Visual Identity"),
        FieldDef("visual_statement", "Visual Statement", "textarea"),
        FieldDef("aesthetic_genre", "Aesthetic Genre", "select", options=[
            "naturalistic", "stylized", "hyperreal", "expressionistic",
            "fantastical", "hybrid"
        ]),
        FieldDef("design_era", "Design Era / Period", "text"),
        FieldDef("visual_density", "Visual Density", "select", options=[
            "minimalist", "moderate", "dense", "maximalist"
        ]),
        FieldDef("primary_materials", "Primary Materials", "json", tab="Materials"),
        FieldDef("secondary_materials", "Secondary Materials", "json", tab="Materials"),
        FieldDef("accent_materials", "Accent Materials", "json", tab="Materials"),
        FieldDef("forbidden_materials", "Forbidden Materials", "json", tab="Materials"),
        FieldDef("material_storytelling", "Material Storytelling", "textarea", tab="Materials"),
        FieldDef("textural_philosophy", "Textural Philosophy", "select", tab="Texture", options=[
            "clean/pristine", "lived-in", "weathered", "decayed"
        ]),
        FieldDef("texture_contrast_strategy", "Texture Contrast Strategy", "textarea",
                 tab="Texture"),
        FieldDef("surface_finish_preference", "Surface Finish Preference", "textarea",
                 tab="Texture"),
        FieldDef("patina_aging_approach", "Patina & Aging Approach", "textarea", tab="Texture"),
        FieldDef("technology_level", "Technology Level", "text", tab="Constraints"),
        FieldDef("technology_aesthetic", "Technology Aesthetic", "text", tab="Constraints"),
        FieldDef("architectural_styles", "Architectural Styles", "text", tab="Constraints"),
        FieldDef("scale_rules", "Scale Rules", "select", tab="Constraints",
                 options=["human scale", "intimate", "monumental", "mixed"]),
        FieldDef("geometric_language", "Geometric Language", "select", tab="Constraints",
                 options=["organic", "angular", "mixed"]),
        FieldDef("lighting_constraints", "Lighting Constraints", "textarea", tab="Constraints"),
        FieldDef("visual_influences", "Visual Influences", "json", tab="Influences"),
    ],
))

register(EntityDef(
    name="cinematographic_philosophy",
    label="Cinematographic Philosophy",
    label_plural="Cinematographic Philosophy",
    icon="🎥",
    category="Creative Direction",
    sort_order=104,
    tier=1,
    description="Overall approach to camera, movement, visual storytelling, and coverage "
                "(absorbed coverage_philosophy in the 2.0 consolidation).",
    fields=[
        FieldDef("name", "Name", default="Cinematographic Philosophy"),
        FieldDef("camera_personality", "Camera Personality", "select", options=[
            "objective observer", "subjective participant", "omniscient presence",
            "character-aligned"
        ]),
        FieldDef("movement_philosophy", "Movement Philosophy", "select", options=[
            "static", "fluid", "motivated", "expressive"
        ]),
        FieldDef("framing_philosophy", "Framing Philosophy", "select", options=[
            "classical", "dynamic", "intimate", "epic"
        ]),
        FieldDef("visual_consistency", "Visual Consistency", "select", options=[
            "unified", "varied", "evolving"
        ]),
        FieldDef("coverage_style", "Coverage Style", "select", tab="Coverage", options=[
            "master + coverage", "single camera", "multi-camera",
            "oner/long take", "run-and-gun", "shot-list driven"
        ]),
        FieldDef("editorial_approach", "Editorial Approach", "select", tab="Coverage",
                 options=["cut-friendly", "in-camera editing", "improvised"]),
        FieldDef("coverage_priorities", "Coverage Priorities", "textarea", tab="Coverage"),
    ],
))

register(EntityDef(
    name="project_color_palette",
    label="Project Color Palette",
    label_plural="Project Color Palette",
    icon="🎨",
    category="Creative Direction",
    sort_order=105,
    tier=1,
    description="Overall color scheme, color rules, and warm/cool temperature strategy "
                "for the entire project (absorbed color_temperature_strategy in the "
                "2.0 consolidation).",
    fields=[
        FieldDef("name", "Name", default="Project Color Palette"),
        FieldDef("primary_colors", "Primary Colors (3-5)", "json"),
        FieldDef("secondary_colors", "Secondary Colors", "json"),
        FieldDef("accent_colors", "Accent Colors", "json"),
        FieldDef("restricted_colors", "Restricted Colors", "json"),
        FieldDef("saturation_philosophy", "Saturation Philosophy", "select", options=[
            "highly saturated", "desaturated", "mixed", "neutral-heavy"
        ]),
        FieldDef("value_structure", "Value Structure", "select", options=[
            "high key", "low key", "full range", "compressed"
        ]),
        FieldDef("temperature_approach", "Temperature Approach", "select", tab="Temperature",
                 options=["warm", "cool", "balanced", "journey"]),
        FieldDef("temperature_associations", "Warm / Cool Associations", "textarea",
                 tab="Temperature",
                 help_text="What warmth and coolness each mean in this story."),
        FieldDef("temperature_contrast_points", "Temperature Contrast Points", "textarea",
                 tab="Temperature"),
        FieldDef("day_scene_temperature", "Day Scene Temperature", "text", tab="Temperature"),
        FieldDef("night_scene_temperature", "Night Scene Temperature", "text", tab="Temperature"),
        FieldDef("color_evolution", "Color Evolution by Act", "textarea", tab="Evolution"),
        FieldDef("color_relationships", "Color Relationships", "textarea", tab="Evolution"),
    ],
))

register(EntityDef(
    name="project_tone",
    label="Project Tone",
    label_plural="Project Tone",
    icon="🌡️",
    category="Creative Direction",
    sort_order=106,
    tier=1,
    description="Overall tonal identity and story-level rhythm — the emotional "
                "temperature and pacing of the film (absorbed pacing_strategy in "
                "the 2.0 consolidation).",
    fields=[
        FieldDef("name", "Name", default="Project Tone"),
        FieldDef("primary_tone", "Primary Tone", "text"),
        FieldDef("tone_blend", "Tone Blend", "json"),
        FieldDef("lightest_moment", "Lightest Moments", "textarea"),
        FieldDef("darkest_moment", "Darkest Moments", "textarea"),
        FieldDef("tonal_consistency", "Tonal Consistency", "select", options=[
            "unified", "varied", "shifting"
        ]),
        FieldDef("reference_touchstones", "Reference Touchstones", "textarea"),
        FieldDef("overall_pacing", "Overall Pacing", "select", tab="Pacing", options=[
            "slow/contemplative", "moderate/balanced", "fast/urgent", "variable/dynamic"
        ]),
        FieldDef("pacing_philosophy", "Pacing Philosophy", "textarea", tab="Pacing"),
        FieldDef("breathing_room_strategy", "Breathing Room Strategy", "textarea", tab="Pacing"),
        FieldDef("pacing_inflection_points", "Pacing Inflection Points", "textarea",
                 tab="Pacing",
                 help_text="Key acceleration and deceleration points across the story."),
    ],
))

register(EntityDef(
    name="sonic_identity",
    label="Sonic Identity",
    label_plural="Sonic Identity",
    icon="🔊",
    category="Creative Direction",
    sort_order=108,
    tier=1,
    description="Overall approach to the film's sound and music world (absorbed "
                "musical_identity in the 2.0 consolidation).",
    fields=[
        FieldDef("name", "Name", default="Sonic Identity"),
        FieldDef("sound_aesthetic", "Sound Aesthetic", "select", options=[
            "naturalistic", "heightened", "stylized", "surreal"
        ]),
        FieldDef("sonic_density", "Sonic Density", "select", options=[
            "sparse", "moderate", "dense", "overwhelming"
        ]),
        FieldDef("silence_philosophy", "Silence Philosophy", "textarea"),
        FieldDef("subjective_sound_approach", "Subjective Sound Approach", "textarea"),
        FieldDef("sound_evolution", "Sound Evolution", "textarea"),
        FieldDef("score_approach", "Score Approach", "select", tab="Music", options=[
            "traditional orchestral", "electronic/synthesized", "hybrid",
            "acoustic/intimate", "genre-specific"
        ]),
        FieldDef("musical_tone", "Musical Tone", "select", tab="Music", options=[
            "emotional support", "counterpoint", "commentary", "neutral/ambient"
        ]),
        FieldDef("instrumentation_palette", "Instrumentation Palette", "textarea", tab="Music"),
        FieldDef("score_density", "Score Density", "select", tab="Music",
                 options=["wall-to-wall", "selective", "sparse"]),
        FieldDef("source_music_approach", "Source Music Approach", "textarea", tab="Music"),
    ],
))

register(EntityDef(
    name="look_development",
    label="Look Development",
    label_plural="Look Development",
    icon="🖼️",
    category="Creative Direction",
    sort_order=111,
    tier=1,
    description="Target visual look for the final image — grading and post direction.",
    fields=[
        FieldDef("name", "Name", default="Look Development"),
        FieldDef("contrast", "Contrast", "select", options=["flat", "normal", "high"]),
        FieldDef("saturation", "Saturation", "select",
                 options=["desaturated", "normal", "vivid"]),
        FieldDef("color_bias", "Color Bias", "select",
                 options=["warm", "cool", "neutral", "tinted"]),
        FieldDef("highlight_handling", "Highlight Handling", "select",
                 options=["preserved", "blown", "rolled-off"]),
        FieldDef("shadow_handling", "Shadow Handling", "select",
                 options=["crushed", "lifted", "detailed"]),
        FieldDef("grain_texture", "Grain / Texture", "select",
                 options=["clean", "subtle grain", "heavy grain"]),
        FieldDef("on_set_lut", "On-Set LUT", "text", tab="LUTs"),
        FieldDef("editorial_lut", "Editorial LUT", "text", tab="LUTs"),
        FieldDef("final_grade_foundation", "Final Grade Foundation", "textarea", tab="LUTs"),
        FieldDef("reference_images", "Reference Images / Notes", "textarea", tab="References"),
    ],
))

register(EntityDef(
    name="costume_design_philosophy",
    label="Costume Design Philosophy",
    label_plural="Costume Design Philosophy",
    icon="👗",
    category="Creative Direction",
    sort_order=113,
    tier=1,
    description="Overall approach to wardrobe and costume design.",
    fields=[
        FieldDef("name", "Name", default="Costume Design Philosophy"),
        FieldDef("design_approach", "Design Approach", "select", options=[
            "period-accurate", "period-inspired", "contemporary",
            "timeless", "stylized", "fantastical"
        ]),
        FieldDef("silhouette_strategy", "Silhouette Strategy", "textarea"),
        FieldDef("fabric_philosophy", "Fabric Philosophy", "select",
                 options=["natural", "synthetic", "mixed"]),
        FieldDef("formality_spectrum", "Formality Spectrum", "textarea"),
        FieldDef("condition_philosophy", "Condition Philosophy", "textarea"),
    ],
))

# #############################################################################
#  TIER 2 — CHARACTER DEPTH
# #############################################################################

register(EntityDef(
    name="character_relationship",
    label="Character Relationship",
    label_plural="Character Relationships",
    icon="🤝",
    category="Character Depth",
    sort_order=200,
    tier=2,
    description="Relationship between two characters with dynamics, evolution, and its "
                "physical dimension (absorbed physical_relationship and "
                "physical_relationship_evolution in the 2.0 consolidation).",
    fields=[
        FieldDef("name", "Relationship Label"),
        FieldDef("character_a_id", "Character A", "reference",
                 reference_entity="character", required=True),
        FieldDef("character_b_id", "Character B", "reference",
                 reference_entity="character", required=True),
        FieldDef("relationship_type", "Type", "select", options=[
            "family", "friend", "enemy", "lover", "colleague",
            "mentor/mentee", "rival", "authority", "other"
        ]),
        FieldDef("directionality", "Directionality", "select",
                 options=["mutual", "a_to_b"], default="mutual",
                 help_text="Whether the order of the two characters "
                           "carries meaning. 'mutual' — siblings, "
                           "colleagues — reads the same either way, so "
                           "the same pair entered twice is a duplicate. "
                           "'a_to_b' is directed and reads A -> B "
                           "(A is B's mentor), so the reverse pair is a "
                           "different fact, not a duplicate. Tooling "
                           "cannot tell these apart without being told."),
        FieldDef("specific_relationship", "Specific Relationship", "text"),
        FieldDef("emotional_valence", "Emotional Valence", "select",
                 options=["positive", "negative", "complex", "neutral"]),
        FieldDef("power_dynamic", "Power Dynamic", "textarea"),
        FieldDef("relationship_arc", "Relationship Arc", "textarea"),
        FieldDef("touch_comfort", "Touch Comfort", "select", tab="Physical",
                 options=["touching", "tactile", "reserved", "avoidant"]),
        FieldDef("distance_preference", "Distance Preference", "text", tab="Physical"),
        FieldDef("eye_contact_pattern", "Eye Contact Pattern", "text", tab="Physical"),
        FieldDef("body_orientation", "Body Orientation", "text", tab="Physical"),
        FieldDef("mirroring_tendencies", "Mirroring Tendencies", "textarea", tab="Physical"),
        FieldDef("physical_evolution", "Physical Evolution", "textarea", tab="Physical",
                 help_text="Narrative summary of how the physical dimension "
                           "changes across the story. The queryable stages "
                           "live in relationship_state rows (pattern 3)."),
        FieldDef("history", "History", "textarea", tab="Background"),
        FieldDef("current_status", "Current Status", "text", tab="Background"),
    ],
))

register(EntityDef(
    name="relationship_state",
    label="Relationship State",
    label_plural="Relationship States",
    icon="📈",
    category="Character Depth",
    sort_order=201,
    tier=2,
    description="The stage a relationship is in as of a story position. "
                "Latest-wins position keying (pattern 3, conventions.md): the "
                "state in force at position P is the latest row keyed "
                "at-or-before P. The prose relationship_arc / "
                "physical_evolution fields remain as narrative summaries; "
                "this table is the queryable truth (G1, schema 2.2).",
    fields=[
        FieldDef("name", "Name"),
        FieldDef("character_relationship_id", "Relationship", "reference",
                 reference_entity="character_relationship", required=True),
        FieldDef("scene_id", "As Of Scene", "reference",
                 reference_entity="scene", required=True,
                 help_text="The position this stage begins. In force until "
                           "a later row supersedes it."),
        FieldDef("stage_label", "Stage Label", "text",
                 help_text="Short handle, e.g. \"arm's length\", "
                           "\"post-accident thaw\"."),
        FieldDef("description", "Description", "textarea"),
    ],
))

register(EntityDef(
    name="physical_character_profile",
    label="Physical Character Profile",
    label_plural="Physical Character Profiles",
    icon="🏃",
    category="Character Depth",
    sort_order=202,
    tier=2,
    parent_entity="character",
    parent_field="character_id",
    description="Baseline physical existence — posture, movement, tension, energy, and "
                "the face as performance instrument (absorbed facial_expression_profile "
                "and emotional_physicality in the 2.0 consolidation). Maps to the motion "
                "bundle modality. Static appearance (height, build, features) lives in "
                "character_appearance_profile.",
    fields=[
        FieldDef("name", "Name"),
        FieldDef("character_id", "Character", "reference",
                 reference_entity="character", required=True),
        FieldDef("posture", "Posture", "select", options=[
            "upright", "slouched", "rigid", "relaxed", "asymmetric"
        ]),
        FieldDef("center_of_gravity", "Center of Gravity", "select",
                 options=["high", "low", "forward", "back"]),
        FieldDef("tension_level", "Physical Tension Level", "select",
                 options=["tense", "relaxed", "variable"]),
        FieldDef("energy_quality", "Energy Quality", "select",
                 options=["kinetic", "still", "restless", "contained"]),
        FieldDef("movement_style", "Movement Style", "textarea", tab="Movement"),
        FieldDef("movement_speed", "Movement Speed", "select", tab="Movement",
                 options=["quick", "slow", "deliberate", "erratic"]),
        FieldDef("movement_fluidity", "Movement Fluidity", "select", tab="Movement",
                 options=["smooth", "jerky", "graceful", "awkward"]),
        FieldDef("movement_economy", "Movement Economy", "select", tab="Movement",
                 options=["efficient", "wasteful", "precise", "sloppy"]),
        FieldDef("movement_weight", "Movement Weight", "select", tab="Movement",
                 options=["light", "heavy", "grounded", "floating"]),
        FieldDef("resting_face", "Resting Face", "textarea", tab="Face"),
        FieldDef("expressiveness_level", "Expressiveness Level", "select", tab="Face",
                 options=["mobile", "controlled", "flat"]),
        FieldDef("facial_asymmetries", "Facial Asymmetries", "text", tab="Face"),
        FieldDef("eye_contact_patterns", "Eye Contact Patterns", "textarea", tab="Face"),
        FieldDef("gaze_direction_tendencies", "Gaze Direction Tendencies", "textarea",
                 tab="Face"),
        FieldDef("mouth_tension_patterns", "Mouth Tension Patterns", "textarea", tab="Face"),
        FieldDef("smile_authenticity", "Smile Authenticity", "textarea", tab="Face"),
        FieldDef("spatial_presence", "Spatial Presence", "select", tab="Presence",
                 options=["takes up space", "minimizes self"]),
        FieldDef("physical_comfort", "Physical Comfort", "select", tab="Presence",
                 options=["at home in body", "disconnected"]),
        FieldDef("coordination_level", "Coordination Level", "text", tab="Presence"),
        FieldDef("emotional_manifestations", "Emotional Manifestations", "json",
                 tab="Emotion",
                 help_text="Map of emotion → how it shows in body / face / voice / "
                           "breathing, e.g. {\"fear\": {\"body\": \"...\", \"face\": \"...\"}}. "
                           "Replaces the former emotional_physicality entity."),
        FieldDef("physical_training_visible", "Physical Training Visible", "textarea",
                 tab="History"),
        FieldDef("physical_neglect_visible", "Physical Neglect Visible", "textarea",
                 tab="History"),
        FieldDef("injuries_visible_in_movement", "Injuries Visible in Movement", "textarea",
                 tab="History"),
        FieldDef("physical_notes", "Physical Notes", "textarea", tab="History"),
    ],
))

register(EntityDef(
    name="vocal_profile",
    label="Vocal Profile",
    label_plural="Vocal Profiles",
    icon="🗣️",
    category="Character Depth",
    sort_order=203,
    tier=2,
    parent_entity="character",
    parent_field="character_id",
    description="Baseline vocal identity — how a character sounds and how they deliver "
                "lines (absorbed delivery_profile in the 2.0 consolidation). Maps to the "
                "voice_identity bundle modality.",
    fields=[
        FieldDef("name", "Name"),
        FieldDef("character_id", "Character", "reference",
                 reference_entity="character", required=True),
        FieldDef("voice_quality", "Voice Quality", "text"),
        FieldDef("pitch_range", "Pitch Range", "select",
                 options=["high", "low", "middle", "variable"]),
        FieldDef("timbre", "Timbre", "select",
                 options=["warm", "nasal", "resonant", "thin", "gravelly"]),
        FieldDef("volume_tendency", "Volume Tendency", "select",
                 options=["loud", "soft", "variable"]),
        FieldDef("breathiness_level", "Breathiness", "select",
                 options=["none", "slight", "moderate", "heavy"]),
        FieldDef("speech_pattern", "Speech Pattern", "textarea", tab="Speech"),
        FieldDef("pace", "Pace", "select", tab="Speech",
                 options=["fast", "slow", "measured", "variable"]),
        FieldDef("rhythm", "Rhythm", "select", tab="Speech",
                 options=["regular", "syncopated", "halting"]),
        FieldDef("articulation", "Articulation", "select", tab="Speech",
                 options=["precise", "mumbled", "clipped", "drawled"]),
        FieldDef("fluency", "Fluency", "select", tab="Speech",
                 options=["smooth", "stuttered", "filled pauses"]),
        FieldDef("accent", "Accent / Dialect", "text", tab="Accent"),
        FieldDef("regional_markers", "Regional Markers", "text", tab="Accent"),
        FieldDef("class_markers", "Class Markers", "text", tab="Accent"),
        FieldDef("educational_markers", "Educational Markers", "text", tab="Accent"),
        FieldDef("accent_authenticity", "Accent Authenticity", "select", tab="Accent",
                 options=["native", "acquired", "affected"]),
        FieldDef("delivery_style", "Delivery Style", "select", tab="Delivery", options=[
            "naturalistic", "theatrical", "minimalist", "mannered"
        ]),
        FieldDef("emotional_access", "Emotional Access", "select", tab="Delivery",
                 options=["available", "controlled", "variable"]),
        FieldDef("subtext_playing", "Subtext Playing", "select", tab="Delivery",
                 options=["plays clearly", "hides", "unaware"]),
        FieldDef("listening_behavior", "Listening Behavior", "textarea", tab="Delivery"),
        FieldDef("interruption_tendencies", "Interruption Tendencies", "textarea",
                 tab="Delivery"),
        FieldDef("vocal_habits", "Vocal Habits", "textarea", tab="Habits"),
        FieldDef("filler_words", "Filler Words", "json", tab="Habits"),
        FieldDef("catch_phrases", "Catch Phrases", "json", tab="Habits"),
        FieldDef("verbal_tics", "Verbal Tics", "json", tab="Habits"),
    ],
))

register(EntityDef(
    name="character_appearance_profile",
    label="Character Appearance Profile",
    label_plural="Character Appearance Profiles",
    icon="👤",
    category="Character Depth",
    sort_order=206,
    tier=2,
    parent_entity="character",
    parent_field="character_id",
    description="Complete visual design — silhouette, distinction, evolution.",
    fields=[
        FieldDef("name", "Name"),
        FieldDef("character_id", "Character", "reference",
                 reference_entity="character", required=True),
        FieldDef("body_type", "Body Type", "text"),
        FieldDef("height_proportions", "Height / Proportions", "text"),
        FieldDef("age_appearance", "Age Appearance", "text"),
        FieldDef("hair", "Hair", "text"),
        FieldDef("eyes", "Eyes", "text"),
        FieldDef("distinguishing_features", "Distinguishing Features", "textarea"),
        FieldDef("skin_tone", "Skin Tone", "text", tab="Appearance"),
        FieldDef("grooming_level", "Grooming Level", "text", tab="Appearance"),
        FieldDef("visual_distinction", "Visual Distinction", "textarea", tab="Identity"),
        FieldDef("silhouette_description", "Silhouette Description", "textarea", tab="Identity"),
        FieldDef("visual_shorthand", "Visual Shorthand", "textarea", tab="Identity"),
        FieldDef("appearance_evolution", "Appearance Evolution", "textarea", tab="Evolution"),
    ],
))

register(EntityDef(
    name="costume",
    label="Costume",
    label_plural="Costumes",
    icon="👔",
    category="Character Depth",
    sort_order=207,
    tier=2,
    parent_entity="character",
    parent_field="character_id",
    description="A specific wardrobe look for a character.",
    fields=[
        FieldDef("name", "Costume Name", required=True),
        FieldDef("character_id", "Character", "reference",
                 reference_entity="character", required=True),
        FieldDef("description", "Description", "textarea"),
        FieldDef("silhouette", "Silhouette", "text"),
        FieldDef("key_garments", "Key Garments", "json"),
        FieldDef("layers", "Layers", "textarea"),
        FieldDef("accessories", "Accessories", "json"),
        FieldDef("primary_color_hex", "Primary Color (hex)", "text", tab="Color"),
        FieldDef("primary_color_name", "Primary Color Name", "text", tab="Color"),
        FieldDef("secondary_colors", "Secondary Colors", "json", tab="Color"),
        FieldDef("fabrics", "Fabrics", "textarea", tab="Material"),
        FieldDef("texture_qualities", "Texture Qualities", "textarea", tab="Material"),
        FieldDef("condition", "Condition", "select", tab="Narrative",
                 options=["new", "worn", "distressed"]),
        FieldDef("what_reveals", "What It Reveals", "textarea", tab="Narrative"),
        FieldDef("emotional_state_reflected", "Emotional State Reflected", "textarea",
                 tab="Narrative"),
        FieldDef("social_signals", "Social/Economic Signals", "textarea", tab="Narrative"),
        FieldDef("continuity_notes", "Continuity Notes", "textarea", tab="Notes"),
    ],
))

register(EntityDef(
    name="costume_scene",
    label="Costume-Scene",
    label_plural="Costume-Scenes",
    icon="🔗",
    category="Connections",
    sort_order=63,
    tier=0,
    description="Links a costume to the scenes where it appears.",
    has_lifecycle_status=False,
    fields=[
        FieldDef("name", "Display Name", hidden=True),
        FieldDef("costume_id", "Costume", "reference",
                 reference_entity="costume", required=True),
        FieldDef("scene_id", "Scene", "reference",
                 reference_entity="scene", required=True),
        FieldDef("condition_in_scene", "Condition in Scene", "text"),
        FieldDef("notes", "Notes", "textarea"),
    ],
))

register(EntityDef(
    name="costume_progression",
    label="Costume Progression",
    label_plural="Costume Progressions",
    icon="📈",
    category="Character Depth",
    sort_order=208,
    tier=2,
    parent_entity="character",
    parent_field="character_id",
    description="How wardrobe evolves through the story arc.",
    fields=[
        FieldDef("name", "Name"),
        FieldDef("character_id", "Character", "reference",
                 reference_entity="character", required=True),
        FieldDef("starting_wardrobe", "Starting Wardrobe", "textarea"),
        FieldDef("starting_meaning", "Starting Meaning", "textarea"),
        FieldDef("progression_stages", "Progression Stages", "json"),
        FieldDef("color_evolution", "Color Evolution", "textarea"),
        FieldDef("formality_evolution", "Formality Evolution", "textarea"),
        FieldDef("condition_evolution", "Condition Evolution", "textarea"),
        FieldDef("symbolic_meaning", "Symbolic Meaning", "textarea"),
    ],
))

register(EntityDef(
    name="makeup_hair_design",
    label="Makeup & Hair Design",
    label_plural="Makeup & Hair Designs",
    icon="💇",
    category="Character Depth",
    sort_order=209,
    tier=2,
    parent_entity="character",
    parent_field="character_id",
    description="Non-costume appearance: makeup, hair, prosthetics.",
    fields=[
        FieldDef("name", "Name"),
        FieldDef("character_id", "Character", "reference",
                 reference_entity="character", required=True),
        FieldDef("scene_id", "Scene (if scene-specific)", "reference",
                 reference_entity="scene"),
        FieldDef("makeup_approach", "Makeup Approach", "select", options=[
            "naturalistic", "beauty", "character", "special effects"
        ]),
        FieldDef("makeup_details", "Makeup Details", "textarea"),
        FieldDef("hair_style", "Hair Style", "text", tab="Hair"),
        FieldDef("hair_condition", "Hair Condition", "text", tab="Hair"),
        FieldDef("hair_notes", "Hair Notes", "textarea", tab="Hair"),
        FieldDef("prosthetics", "Prosthetics", "textarea", tab="Effects"),
        FieldDef("aging_effects", "Aging Effects", "textarea", tab="Effects"),
        FieldDef("injury_effects", "Injury Effects", "textarea", tab="Effects"),
    ],
))

register(EntityDef(
    name="character_variant",
    label="Character Variant",
    label_plural="Character Variants",
    icon="🔀",
    category="Character Depth",
    sort_order=210,
    tier=2,
    parent_entity="character",
    parent_field="character_id",
    description="Specific state or version of a character (e.g. Young Eleanor, Angry Marcus).",
    fields=[
        FieldDef("name", "Variant Name", required=True),
        FieldDef("character_id", "Character", "reference",
                 reference_entity="character", required=True),
        FieldDef("physical_differences", "Physical Differences", "textarea"),
        FieldDef("emotional_state", "Emotional State", "textarea"),
        FieldDef("context", "Context", "textarea"),
    ],
))

register(EntityDef(
    name="physical_habit",
    label="Physical Habit",
    label_plural="Physical Habits",
    icon="✋",
    category="Character Depth",
    sort_order=211,
    tier=2,
    parent_entity="character",
    parent_field="character_id",
    description="Recurring physical behavior — gesture, tic, comfort behavior.",
    fields=[
        FieldDef("name", "Habit Name", required=True),
        FieldDef("character_id", "Character", "reference",
                 reference_entity="character", required=True),
        FieldDef("description", "Description", "textarea"),
        FieldDef("body_parts_involved", "Body Parts Involved", "text"),
        FieldDef("habit_trigger", "Trigger", "textarea"),
        FieldDef("frequency", "Frequency", "select",
                 options=["constant", "frequent", "occasional", "rare/situational"]),
        FieldDef("meaning", "Meaning", "textarea"),
        FieldDef("character_awareness", "Character Awareness", "select",
                 options=["aware", "unaware", "sometimes aware"]),
    ],
))


# #############################################################################
#  TIER 2 — PROP DEPTH (Phase 1D — new)
# #############################################################################

register(EntityDef(
    name="prop_surface_profile",
    label="Prop Surface Profile",
    label_plural="Prop Surface Profiles",
    icon="🪙",
    category="Prop Depth",
    sort_order=220,
    tier=2,
    parent_entity="prop",
    parent_field="prop_id",
    description="Surface, material, and physical-presence detail for a prop. "
                "Holds the descriptive baseline that surface and visual bundles "
                "reference. State variation (clean vs damaged) belongs in prop_variant.",
    fields=[
        FieldDef("name", "Name"),
        FieldDef("prop_id", "Prop", "reference",
                 reference_entity="prop", required=True),
        FieldDef("material", "Primary Material", "text",
                 placeholder='e.g. "Tarnished silver", "Worn leather"'),
        FieldDef("secondary_materials", "Secondary Materials", "text"),
        FieldDef("size", "Size", "text", placeholder="e.g. Palm-sized, 6 feet tall"),
        FieldDef("weight_impression", "Weight Impression", "text",
                 placeholder='e.g. "heavier than it looks"'),
        FieldDef("primary_color_hex", "Primary Color (hex)", "text", tab="Color"),
        FieldDef("primary_color_name", "Primary Color Name", "text", tab="Color"),
        FieldDef("secondary_colors", "Secondary Colors", "json", tab="Color"),
        FieldDef("surface_finish", "Surface Finish", "select", tab="Surface", options=[
            "matte", "satin", "gloss", "worn", "polished", "pitted"
        ]),
        FieldDef("texture_quality", "Texture Quality", "textarea", tab="Surface"),
        FieldDef("baseline_condition", "Baseline Condition", "text", tab="Condition",
                 help_text="The prop's default state. State changes belong in prop_variant."),
        FieldDef("wear_pattern", "Wear Pattern", "textarea", tab="Condition"),
        FieldDef("aging_notes", "Aging Notes", "textarea", tab="Condition"),
        FieldDef("visual_distinction", "Visual Distinction", "textarea", tab="Identity",
                 placeholder="The silhouette / shorthand of this prop"),
        FieldDef("notes", "Notes", "textarea", tab="Notes"),
    ],
))

register(EntityDef(
    name="prop_variant",
    label="Prop Variant",
    label_plural="Prop Variants",
    icon="🔀",
    category="Prop Depth",
    sort_order=221,
    tier=2,
    parent_entity="prop",
    parent_field="prop_id",
    description="Specific state or version of a prop (e.g. Locket open, Gun blood-spattered, "
                "Letter torn). Tools bind state-specific bundles to a prop variant; the "
                "cascade resolves the right bundle for the right state.",
    fields=[
        FieldDef("name", "Variant Name", required=True,
                 placeholder='e.g. "Locket — open", "Gun — fired"'),
        FieldDef("prop_id", "Prop", "reference",
                 reference_entity="prop", required=True),
        FieldDef("physical_differences", "Physical Differences", "textarea"),
        FieldDef("state_trigger", "State Trigger", "textarea",
                 placeholder="What causes this variant to appear"),
        FieldDef("context", "Context", "textarea"),
    ],
))

register(EntityDef(
    name="prop_state",
    label="Prop State",
    label_plural="Prop States",
    icon="📦",
    category="Prop Depth",
    sort_order=405,
    tier=2,
    description="Custody, condition, and whereabouts of a prop as of a story "
                "position. Latest-wins position keying (pattern 3, "
                "conventions.md). G1, schema 2.2.",
    fields=[
        FieldDef("name", "Name"),
        FieldDef("prop_id", "Prop", "reference",
                 reference_entity="prop", required=True),
        FieldDef("scene_id", "As Of Scene", "reference",
                 reference_entity="scene", required=True),
        FieldDef("custody_character_id", "In Custody Of", "reference",
                 reference_entity="character"),
        FieldDef("condition", "Condition", "text"),
        FieldDef("whereabouts", "Whereabouts", "text",
                 help_text="Where the prop is, e.g. \"saddlebag\", "
                           "\"coat pocket\", \"revealed on the table\"."),
        FieldDef("significance_note", "Significance Note", "textarea"),
    ],
))


# #############################################################################
#  TIER 2 — LOCATION DEPTH
# #############################################################################

register(EntityDef(
    name="location_design",
    label="Location Design",
    label_plural="Location Designs",
    icon="🏗️",
    category="Location Depth",
    sort_order=300,
    tier=2,
    parent_entity="location",
    parent_field="location_id",
    description="Detailed visual design — architecture, materials, spatial layout.",
    fields=[
        FieldDef("name", "Name"),
        FieldDef("location_id", "Location", "reference",
                 reference_entity="location", required=True),
        FieldDef("design_concept", "Design Concept", "textarea"),
        FieldDef("visual_metaphor", "Visual Metaphor", "textarea"),
        FieldDef("emotional_target", "Emotional Target", "textarea"),
        FieldDef("period_style", "Period / Style", "text", tab="Architecture"),
        FieldDef("condition", "Condition", "select", tab="Architecture",
                 options=["pristine", "maintained", "neglected", "ruined"]),
        FieldDef("scale", "Scale", "select", tab="Architecture",
                 options=["intimate", "domestic", "commercial", "monumental"]),
        FieldDef("geometry", "Geometry", "select", tab="Architecture",
                 options=["organic", "angular", "chaotic", "ordered"]),
        FieldDef("dominant_materials", "Dominant Materials", "textarea", tab="Materials"),
        FieldDef("secondary_materials", "Secondary Materials", "textarea", tab="Materials"),
        FieldDef("texture_quality", "Texture Quality", "textarea", tab="Materials"),
        FieldDef("surface_finish", "Surface Finish", "textarea", tab="Materials"),
        FieldDef("spatial_description", "Spatial Layout", "textarea", tab="Spatial"),
        FieldDef("sight_lines", "Sight Lines", "textarea", tab="Spatial"),
        FieldDef("key_focal_points", "Key Focal Points", "textarea", tab="Spatial"),
        FieldDef("natural_light_sources", "Natural Light Sources", "textarea", tab="Lighting"),
        FieldDef("practical_light_sources", "Practical Light Sources", "textarea",
                 tab="Lighting"),
        FieldDef("light_quality", "Light Quality", "textarea", tab="Lighting"),
    ],
))

# ---------------------------------------------------------------------------
# Location Variant (Phase 1D — added is_baseline + structured state axes)
# ---------------------------------------------------------------------------
register(EntityDef(
    name="location_variant",
    label="Location Variant",
    label_plural="Location Variants",
    icon="🔀",
    category="Location Depth",
    sort_order=301,
    tier=2,
    parent_entity="location",
    parent_field="location_id",
    description="Modified state of a location (e.g. Night version, After fire). "
                "Includes structured state axes (time-of-day, weather, season, "
                "post-event state) that previously lived on the location base entity. "
                "Exactly one variant per location should be marked is_baseline = true.",
    fields=[
        FieldDef("name", "Variant Name", required=True),
        FieldDef("location_id", "Location", "reference",
                 reference_entity="location", required=True),
        FieldDef("is_baseline", "Is Baseline", "boolean", default=False,
                 help_text="True for the unconditional default variant for this location."),
        FieldDef("time_of_day", "Time of Day", "select", tab="State", options=[
            "dawn", "morning", "midday", "afternoon", "dusk", "night", "varies"
        ]),
        FieldDef("weather", "Weather", "text", tab="State"),
        FieldDef("season", "Season", "select", tab="State", options=[
            "spring", "summer", "autumn", "winter", "unspecified"
        ]),
        FieldDef("post_event_state", "Post-Event State", "text", tab="State",
                 placeholder='e.g. "after the fire", "during the festival", "abandoned"'),
        FieldDef("physical_differences", "Physical Differences", "textarea"),
        FieldDef("lighting_differences", "Lighting Differences", "textarea"),
        FieldDef("emotional_shift", "Emotional Shift", "textarea"),
        FieldDef("time_context", "Time / Story Context", "textarea"),
    ],
))

register(EntityDef(
    name="location_color_scheme",
    label="Location Color Scheme",
    label_plural="Location Color Schemes",
    icon="🎨",
    category="Location Depth",
    sort_order=302,
    tier=2,
    parent_entity="location",
    parent_field="location_id",
    description="Color palette and atmosphere for a specific location.",
    fields=[
        FieldDef("name", "Name"),
        FieldDef("location_id", "Location", "reference",
                 reference_entity="location", required=True),
        FieldDef("dominant_colors", "Dominant Colors", "json"),
        FieldDef("color_motivation", "Color Motivation", "select",
                 options=["period", "character", "symbolic", "practical"]),
        FieldDef("color_atmosphere", "Color Atmosphere", "select",
                 options=["warm", "cool", "neutral", "colorful"]),
        FieldDef("color_intensity", "Color Intensity", "select",
                 options=["saturated", "desaturated", "mixed"]),
        FieldDef("character_location_interaction", "Character-Location Color Interaction",
                 "select", options=["match", "contrast", "transform"]),
    ],
))

register(EntityDef(
    name="location_sound_profile",
    label="Location Sound Profile",
    label_plural="Location Sound Profiles",
    icon="🔉",
    category="Location Depth",
    sort_order=303,
    tier=2,
    parent_entity="location",
    parent_field="location_id",
    description="Acoustic identity of a place — room tone, ambience, character.",
    fields=[
        FieldDef("name", "Name"),
        FieldDef("location_id", "Location", "reference",
                 reference_entity="location", required=True),
        FieldDef("room_tone", "Room Tone", "textarea"),
        FieldDef("reverb_quality", "Reverb / Reflection", "textarea"),
        FieldDef("resonance", "Resonance Characteristics", "textarea"),
        FieldDef("constant_sounds", "Constant Sounds", "json", tab="Ambience"),
        FieldDef("variable_sounds", "Variable Sounds", "textarea", tab="Ambience"),
        FieldDef("characteristic_sounds", "Characteristic Sounds", "textarea", tab="Ambience"),
        FieldDef("sonic_perspective", "Sonic Perspective", "textarea", tab="Ambience"),
    ],
))


# #############################################################################
#  ASSET REFERENCE — Layer 2 (Phase 1B + 1D)
# #############################################################################

# Bundle (Phase 1D — added `acoustic` to intent enum)
register(EntityDef(
    name="bundle",
    label="Bundle",
    label_plural="Bundles",
    icon="📦",
    category="Asset Reference",
    sort_order=250,
    tier=2,
    description="Named, intent-typed collection of assets. Tool-agnostic media reference "
                "primitive used by the character cluster (and now by props and locations). "
                "Versionable — participates in linear version chains.",
    versionable=True,
    fields=[
        FieldDef("name", "Bundle Name", required=True),
        FieldDef("intent", "Intent", "select", required=True, options=[
            "visual_identity",
            "voice_identity",
            "motion",
            "behavior",
            "performance",
            "surface",
            "environment",
            "acoustic",
            "other",
        ],
                 help_text="Hard enum. Tools switch on this to determine compatibility. "
                           "acoustic added in Phase 1D for location ambience."),
        FieldDef("description", "Description", "textarea"),
        FieldDef("coverage_summary", "Coverage Summary", "textarea"),
        FieldDef("format_hints", "Format Hints", "json", tab="Technical",
                 placeholder='{"frame_count": 30, "lighting_conditions": [...]}'),
        FieldDef("intended_consumers", "Intended Consumers", "json", tab="Technical",
                 placeholder='["image_gen", "video_gen", "voice_clone", "world_model"]'),
        FieldDef("provenance", "Provenance", "textarea", tab="Technical"),
        FieldDef("notes", "Notes", "textarea", tab="Notes"),
    ],
))

register(EntityDef(
    name="bundle_asset",
    label="Bundle-Asset",
    label_plural="Bundle-Assets",
    icon="🔗",
    category="Connections",
    sort_order=68,
    tier=0,
    description="Junction: assets that compose a bundle.",
    has_lifecycle_status=False,
    fields=[
        FieldDef("name", "Display Name", hidden=True),
        FieldDef("bundle_id", "Bundle", "reference", reference_entity="bundle", required=True),
        FieldDef("asset_id", "Asset", "reference", reference_entity="asset", required=True),
        FieldDef("role_in_bundle", "Role in Bundle", "text"),
        FieldDef("order", "Order", "integer"),
        FieldDef("notes", "Notes", "textarea"),
    ],
))

register(EntityDef(
    name="character_asset_binding",
    label="Character Asset Binding",
    label_plural="Character Asset Bindings",
    icon="🎚️",
    category="Asset Reference",
    sort_order=251,
    tier=2,
    description="Applies a bundle to a character under specific conditions.",
    fields=[
        FieldDef("name", "Binding Name"),
        FieldDef("character_id", "Character", "reference",
                 reference_entity="character", required=True),
        FieldDef("bundle_id", "Bundle", "reference",
                 reference_entity="bundle", required=True),
        FieldDef("is_baseline", "Is Baseline", "boolean", default=False),
        FieldDef("precedence", "Precedence", "integer", default=0),
        FieldDef("variant_id", "Variant", "reference",
                 reference_entity="character_variant", tab="Conditions"),
        FieldDef("physical_state_filter", "Physical State Filter", "text", tab="Conditions"),
        FieldDef("vocal_state_filter", "Vocal State Filter", "text", tab="Conditions"),
        FieldDef("scene_range_start_id", "Scene Range Start", "reference",
                 reference_entity="scene", tab="Conditions"),
        FieldDef("scene_range_end_id", "Scene Range End", "reference",
                 reference_entity="scene", tab="Conditions"),
        FieldDef("act_id", "Act", "reference", reference_entity="act", tab="Conditions"),
        FieldDef("conditions_json", "Additional Conditions", "json", tab="Conditions"),
        FieldDef("notes", "Notes", "textarea", tab="Notes"),
    ],
))

# Prop Asset Binding (NEW in Phase 1D)
register(EntityDef(
    name="prop_asset_binding",
    label="Prop Asset Binding",
    label_plural="Prop Asset Bindings",
    icon="🎚️",
    category="Asset Reference",
    sort_order=253,
    tier=2,
    description="Applies a bundle to a prop under specific conditions (variant, scene "
                "range, act). Tools walk the prop resolution cascade and use bindings to "
                "find the right media for a prop in a given scene/state.",
    fields=[
        FieldDef("name", "Binding Name"),
        FieldDef("prop_id", "Prop", "reference",
                 reference_entity="prop", required=True),
        FieldDef("bundle_id", "Bundle", "reference",
                 reference_entity="bundle", required=True),
        FieldDef("is_baseline", "Is Baseline", "boolean", default=False),
        FieldDef("precedence", "Precedence", "integer", default=0),
        FieldDef("variant_id", "Variant", "reference",
                 reference_entity="prop_variant", tab="Conditions"),
        FieldDef("scene_range_start_id", "Scene Range Start", "reference",
                 reference_entity="scene", tab="Conditions"),
        FieldDef("scene_range_end_id", "Scene Range End", "reference",
                 reference_entity="scene", tab="Conditions"),
        FieldDef("act_id", "Act", "reference", reference_entity="act", tab="Conditions"),
        FieldDef("conditions_json", "Additional Conditions", "json", tab="Conditions"),
        FieldDef("notes", "Notes", "textarea", tab="Notes"),
    ],
))

# Location Asset Binding (NEW in Phase 1D)
register(EntityDef(
    name="location_asset_binding",
    label="Location Asset Binding",
    label_plural="Location Asset Bindings",
    icon="🎚️",
    category="Asset Reference",
    sort_order=254,
    tier=2,
    description="Applies a bundle to a location under specific conditions (variant, "
                "scene range, act, time-of-day). Tools walk the location resolution "
                "cascade and use bindings to find the right media for a location.",
    fields=[
        FieldDef("name", "Binding Name"),
        FieldDef("location_id", "Location", "reference",
                 reference_entity="location", required=True),
        FieldDef("bundle_id", "Bundle", "reference",
                 reference_entity="bundle", required=True),
        FieldDef("is_baseline", "Is Baseline", "boolean", default=False),
        FieldDef("precedence", "Precedence", "integer", default=0),
        FieldDef("variant_id", "Variant", "reference",
                 reference_entity="location_variant", tab="Conditions"),
        FieldDef("scene_range_start_id", "Scene Range Start", "reference",
                 reference_entity="scene", tab="Conditions"),
        FieldDef("scene_range_end_id", "Scene Range End", "reference",
                 reference_entity="scene", tab="Conditions"),
        FieldDef("act_id", "Act", "reference", reference_entity="act", tab="Conditions"),
        FieldDef("time_of_day_filter", "Time of Day Filter", "text", tab="Conditions",
                 help_text="Matches scene.time_of_day for bindings scoped to specific times."),
        FieldDef("conditions_json", "Additional Conditions", "json", tab="Conditions"),
        FieldDef("notes", "Notes", "textarea", tab="Notes"),
    ],
))

# Entity Anchor (Phase 1D — renamed from identity_anchor, constrained polymorphic)
register(EntityDef(
    name="entity_anchor",
    label="Entity Anchor",
    label_plural="Entity Anchors",
    icon="📍",
    category="Asset Reference",
    sort_order=252,
    tier=2,
    description="Known-good single frame, audio segment, or motion sample marked as "
                "canonical reference for a character, prop, or location. Used for both "
                "ID-locking inputs and output verification. Points into source assets "
                "without modifying them. Uses constrained polymorphism — subject_type "
                "is a hard closed enum (character / prop / location).",
    fields=[
        FieldDef("name", "Anchor Name"),
        FieldDef("subject_type", "Subject Type", "select", required=True, options=[
            "character", "prop", "location"
        ],
                 help_text="Hard closed enum. Tools switch on this exhaustively. "
                           "Distinct from the open-polymorphism entity_type used elsewhere."),
        FieldDef("subject_id", "Subject ID", "integer", required=True,
                 help_text="Polymorphic reference into the table named by subject_type."),
        FieldDef("subject_variant_id", "Subject Variant ID", "integer",
                 help_text="Optional. Polymorphic reference into the matching variant table "
                           "(character_variant / prop_variant / location_variant)."),
        FieldDef("anchor_type", "Anchor Type", "select", required=True, options=[
            "visual", "audio", "motion"
        ]),
        FieldDef("asset_id", "Source Asset", "reference",
                 reference_entity="asset", required=True),
        FieldDef("frame_number", "Frame Number", "integer", tab="Scope"),
        FieldDef("timecode", "Timecode", "text", tab="Scope",
                 placeholder="HH:MM:SS:FF"),
        FieldDef("region_box", "Region Box", "json", tab="Scope",
                 placeholder='{"x": 420, "y": 180, "w": 480, "h": 600}'),
        FieldDef("region_label", "Region Label", "text", tab="Scope"),
        FieldDef("audio_offset_start_sec", "Audio Offset Start (sec)", "float", tab="Scope"),
        FieldDef("audio_offset_end_sec", "Audio Offset End (sec)", "float", tab="Scope"),
        FieldDef("condition_description", "Condition Description", "textarea", tab="Context"),
        FieldDef("physical_state", "Physical State", "text", tab="Context",
                 help_text="Applies for character and prop subjects."),
        FieldDef("vocal_state", "Vocal State", "text", tab="Context",
                 help_text="Applies for character subjects."),
        FieldDef("environmental_state", "Environmental State", "text", tab="Context",
                 placeholder='e.g. "midday clear", "post-rain dusk"',
                 help_text="Applies for location subjects."),
        FieldDef("canonical_status", "Canonical Status", "select", options=[
            "verified", "candidate", "rejected"
        ], default="candidate",
                 help_text="Verification axis distinct from lifecycle_status."),
        FieldDef("notes", "Notes", "textarea", tab="Notes"),
    ],
))


# #############################################################################
#  PERFORMANCE CORPUS — Layer 3
#  Shared infrastructure. Props participate via clip_prop. Locations participate
#  via plates (clip_type=atmospheric); no clip_location junction (clip→scene→
#  location already chains).
# #############################################################################

register(EntityDef(
    name="performance_corpus",
    label="Performance Corpus",
    label_plural="Performance Corpora",
    icon="🎞️",
    category="Performance Corpus",
    sort_order=260,
    tier=2,
    description="Project-level index of captured footage.",
    fields=[
        FieldDef("name", "Name", default="Performance Corpus"),
        FieldDef("shoot_dates_start", "Shoot Dates Start", "text"),
        FieldDef("shoot_dates_end", "Shoot Dates End", "text"),
        FieldDef("shoot_locations", "Shoot Locations", "textarea"),
        FieldDef("coverage_completeness", "Coverage Completeness", "select", options=[
            "planned", "in_production", "principal_complete",
            "pickups_complete", "complete"
        ], default="planned"),
        FieldDef("camera_metadata", "Camera Metadata", "textarea", tab="Technical"),
        FieldDef("audio_metadata", "Audio Metadata", "textarea", tab="Technical"),
        FieldDef("corpus_notes", "Corpus Notes", "textarea", tab="Notes"),
    ],
))

register(EntityDef(
    name="actor",
    label="Actor",
    label_plural="Actors",
    icon="🎭",
    category="Performance Corpus",
    sort_order=261,
    tier=2,
    description="Minimal actor entity. SCF is story-first, not a casting tracker — "
                "this entity captures only what the story format needs.",
    has_external_id=True,
    fields=[
        FieldDef("name", "Actor Name", required=True),
        FieldDef("notes", "Notes", "textarea"),
    ],
))

register(EntityDef(
    name="actor_character_role",
    label="Actor-Character Role",
    label_plural="Actor-Character Roles",
    icon="🔗",
    category="Connections",
    sort_order=69,
    tier=0,
    description="Junction: actor + character + role type.",
    fields=[
        FieldDef("name", "Display Name", hidden=True),
        FieldDef("actor_id", "Actor", "reference", reference_entity="actor", required=True),
        FieldDef("character_id", "Character", "reference",
                 reference_entity="character", required=True),
        FieldDef("role_type", "Role Type", "select", required=True, options=[
            "principal", "body_double", "stunt_double", "voice_double",
            "adr", "motion_capture", "reference_only", "other"
        ]),
        FieldDef("scope", "Scope", "select", options=[
            "whole_project", "specific_scenes", "specific_takes"
        ], default="whole_project"),
        FieldDef("scope_details", "Scope Details", "textarea"),
        FieldDef("notes", "Notes", "textarea"),
    ],
))

register(EntityDef(
    name="take",
    label="Take",
    label_plural="Takes",
    icon="🎬",
    category="Performance Corpus",
    sort_order=262,
    tier=2,
    description="A single recorded take. May cross scenes (via take_scene junction).",
    has_external_id=True,
    fields=[
        FieldDef("name", "Take Name / Slate", required=True),
        FieldDef("corpus_id", "Corpus", "reference",
                 reference_entity="performance_corpus", required=True),
        FieldDef("shot_id", "Shot", "reference", reference_entity="shot"),
        FieldDef("take_number", "Take Number", "integer"),
        FieldDef("date_recorded", "Date Recorded", "text"),
        FieldDef("duration_seconds", "Duration (seconds)", "integer"),
        FieldDef("timecode_start", "Timecode Start", "text"),
        FieldDef("timecode_end", "Timecode End", "text"),
        FieldDef("preferred", "Director's Pick", "boolean", default=False),
        FieldDef("camera_designation", "Camera", "text", tab="Technical"),
        FieldDef("lens_info", "Lens Info", "text", tab="Technical"),
        FieldDef("recording_format", "Recording Format", "text", tab="Technical"),
        FieldDef("notes", "Notes", "textarea", tab="Notes"),
    ],
))

register(EntityDef(
    name="take_scene",
    label="Take-Scene",
    label_plural="Take-Scenes",
    icon="🔗",
    category="Connections",
    sort_order=70,
    tier=0,
    description="Junction: scenes covered by a take. Takes can cross scenes.",
    has_lifecycle_status=False,
    fields=[
        FieldDef("name", "Display Name", hidden=True),
        FieldDef("take_id", "Take", "reference", reference_entity="take", required=True),
        FieldDef("scene_id", "Scene", "reference", reference_entity="scene", required=True),
        FieldDef("order_in_take", "Order in Take", "integer"),
        FieldDef("coverage_completeness", "Coverage Completeness", "select", options=[
            "partial", "complete", "incidental"
        ], default="complete"),
        FieldDef("notes", "Notes", "textarea"),
    ],
))

register(EntityDef(
    name="clip",
    label="Clip",
    label_plural="Clips",
    icon="✂️",
    category="Performance Corpus",
    sort_order=263,
    tier=2,
    description="A meaningful within-scene segment of a take. Plates are clips with "
                "clip_type=atmospheric.",
    has_external_id=True,
    fields=[
        FieldDef("name", "Clip Name", required=True),
        FieldDef("take_id", "Take", "reference", reference_entity="take", required=True),
        FieldDef("scene_id", "Scene", "reference", reference_entity="scene", required=True),
        FieldDef("clip_in_timecode", "Clip In", "text"),
        FieldDef("clip_out_timecode", "Clip Out", "text"),
        FieldDef("duration_seconds", "Duration (seconds)", "integer"),
        FieldDef("clip_type", "Clip Type", "select", options=[
            "dialogue", "action", "reaction", "transition", "insert", "atmospheric"
        ]),
        FieldDef("screenplay_line_start_id", "Screenplay Line Start", "integer",
                 tab="Screenplay"),
        FieldDef("screenplay_line_end_id", "Screenplay Line End", "integer", tab="Screenplay"),
        FieldDef("beat_id", "Story Beat", "reference",
                 reference_entity="story_beat", tab="Screenplay"),
        FieldDef("notes", "Notes", "textarea", tab="Notes"),
    ],
))

register(EntityDef(
    name="clip_character",
    label="Clip-Character",
    label_plural="Clip-Characters",
    icon="🔗",
    category="Connections",
    sort_order=71,
    tier=0,
    description="Junction: characters present in a clip with their role.",
    has_lifecycle_status=False,
    fields=[
        FieldDef("name", "Display Name", hidden=True),
        FieldDef("clip_id", "Clip", "reference", reference_entity="clip", required=True),
        FieldDef("character_id", "Character", "reference",
                 reference_entity="character", required=True),
        FieldDef("role_in_clip", "Role in Clip", "select", options=[
            "featured", "supporting", "background"
        ], default="featured"),
        FieldDef("notes", "Notes", "textarea"),
    ],
))

# Clip-Prop (NEW junction in Phase 1D)
register(EntityDef(
    name="clip_prop",
    label="Clip-Prop",
    label_plural="Clip-Props",
    icon="🔗",
    category="Connections",
    sort_order=72,
    tier=0,
    description="Junction: props present in a clip with their role. Parallel to "
                "clip_character. Supports queries like 'every clip featuring the locket' "
                "— useful for production review and for assembling prop-identity training sets.",
    has_lifecycle_status=False,
    fields=[
        FieldDef("name", "Display Name", hidden=True),
        FieldDef("clip_id", "Clip", "reference", reference_entity="clip", required=True),
        FieldDef("prop_id", "Prop", "reference", reference_entity="prop", required=True),
        FieldDef("role_in_clip", "Role in Clip", "select", options=[
            "featured", "supporting", "background"
        ], default="featured"),
        FieldDef("notes", "Notes", "textarea"),
    ],
))


# #############################################################################
#  WORKFLOW STATE — Layer 4 (Phase 1B + 1D)
# #############################################################################

register(EntityDef(
    name="shot_coverage",
    label="Shot Coverage",
    label_plural="Shot Coverages",
    icon="📊",
    category="Workflow State",
    sort_order=270,
    tier=2,
    description="Production state of each shot. Multiple records per shot, ordered by "
                "status_date, give a production timeline. Most recent is canonical.",
    fields=[
        FieldDef("name", "Coverage Name"),
        FieldDef("shot_id", "Shot", "reference", reference_entity="shot", required=True),
        FieldDef("coverage_state", "Coverage State", "select", required=True, options=[
            "planned", "captured_live", "generated",
            "hybrid_live_plate", "hybrid_generated_extension",
            "reshoot_needed", "pickup_scheduled", "final"
        ]),
        FieldDef("source_take_id", "Source Take", "reference", reference_entity="take"),
        FieldDef("source_clip_id", "Source Clip", "reference", reference_entity="clip"),
        FieldDef("generation_required", "Generation Required", "textarea"),
        FieldDef("override_summary", "Override Summary", "textarea",
                 placeholder="High-level deviation summary — details in *_shot_override"),
        FieldDef("status_date", "Status Date", "text",
                 help_text="For ordering history. Most recent record is canonical."),
        FieldDef("decided_by", "Decided By", "text"),
        FieldDef("notes", "Notes", "textarea"),
    ],
))

register(EntityDef(
    name="character_shot_override",
    label="Character Shot Override",
    label_plural="Character Shot Overrides",
    icon="🎛️",
    category="Workflow State",
    sort_order=271,
    tier=2,
    description="Per-character deviation from the cascade for a specific shot. "
                "Versionable: only one active record per (shot, character). "
                "Multiple intents compose into a single record via override_types "
                "multiselect and the delta fields.",
    versionable=True,
    fields=[
        FieldDef("name", "Override Name"),
        FieldDef("shot_id", "Shot", "reference", reference_entity="shot", required=True),
        FieldDef("character_id", "Character", "reference",
                 reference_entity="character", required=True),
        FieldDef("override_types", "Override Types", "multiselect", options=[
            "aging", "de_aging", "prosthetic", "body_change",
            "voice_change", "motion_change", "identity_swap",
            "transformation", "other"
        ]),
        FieldDef("bundle_override_id", "Bundle Override", "reference",
                 reference_entity="bundle"),
        FieldDef("variant_target_id", "Variant Target", "reference",
                 reference_entity="character_variant"),
        FieldDef("visual_delta", "Visual Delta", "textarea", tab="Deltas"),
        FieldDef("vocal_delta", "Vocal Delta", "textarea", tab="Deltas"),
        FieldDef("motion_delta", "Motion Delta", "textarea", tab="Deltas"),
        FieldDef("progression_axis", "Progression Axis", "text", tab="Progression",
                 placeholder='e.g. "transformation", "aging", "decay"'),
        FieldDef("progression_value", "Progression Value (0-1)", "float", tab="Progression"),
        FieldDef("notes", "Notes", "textarea", tab="Notes"),
    ],
))

# Prop Shot Override (NEW in Phase 1D)
register(EntityDef(
    name="prop_shot_override",
    label="Prop Shot Override",
    label_plural="Prop Shot Overrides",
    icon="🎛️",
    category="Workflow State",
    sort_order=272,
    tier=2,
    description="Per-prop deviation from the cascade for a specific shot. "
                "Versionable: only one active record per (shot, prop). "
                "Earns its keep for mid-shot state transitions (gun firing, "
                "locket falling open) and shot-specific VFX enhancement.",
    versionable=True,
    fields=[
        FieldDef("name", "Override Name"),
        FieldDef("shot_id", "Shot", "reference", reference_entity="shot", required=True),
        FieldDef("prop_id", "Prop", "reference", reference_entity="prop", required=True),
        FieldDef("override_types", "Override Types", "multiselect", options=[
            "state_change", "damage", "transformation",
            "vfx_enhancement", "other"
        ]),
        FieldDef("bundle_override_id", "Bundle Override", "reference",
                 reference_entity="bundle"),
        FieldDef("variant_target_id", "Variant Target", "reference",
                 reference_entity="prop_variant"),
        FieldDef("visual_delta", "Visual Delta", "textarea", tab="Deltas"),
        FieldDef("surface_delta", "Surface Delta", "textarea", tab="Deltas",
                 help_text="Material / finish deviation for this shot."),
        FieldDef("motion_delta", "Motion Delta", "textarea", tab="Deltas",
                 help_text="How the prop moves / breaks / behaves in this shot."),
        FieldDef("progression_axis", "Progression Axis", "text", tab="Progression",
                 placeholder='e.g. "damage", "wear", "transformation"'),
        FieldDef("progression_value", "Progression Value (0-1)", "float", tab="Progression"),
        FieldDef("notes", "Notes", "textarea", tab="Notes"),
    ],
))

# Location Shot Override (NEW in Phase 1D)
register(EntityDef(
    name="location_shot_override",
    label="Location Shot Override",
    label_plural="Location Shot Overrides",
    icon="🎛️",
    category="Workflow State",
    sort_order=273,
    tier=2,
    description="Per-location deviation from the cascade for a specific shot. "
                "Versionable: only one active record per (shot, location). "
                "Most location deviations belong at scene level (location_variant); "
                "this entity is for genuinely shot-specific cases (VFX additions, "
                "shot reveals beyond standard coverage).",
    versionable=True,
    fields=[
        FieldDef("name", "Override Name"),
        FieldDef("shot_id", "Shot", "reference", reference_entity="shot", required=True),
        FieldDef("location_id", "Location", "reference",
                 reference_entity="location", required=True),
        FieldDef("override_types", "Override Types", "multiselect", options=[
            "extension_change", "lighting_change", "weather_change",
            "vfx_addition", "other"
        ]),
        FieldDef("bundle_override_id", "Bundle Override", "reference",
                 reference_entity="bundle"),
        FieldDef("variant_target_id", "Variant Target", "reference",
                 reference_entity="location_variant"),
        FieldDef("visual_delta", "Visual Delta", "textarea", tab="Deltas"),
        FieldDef("acoustic_delta", "Acoustic Delta", "textarea", tab="Deltas",
                 help_text="Ambience / acoustic deviation for this shot."),
        FieldDef("lighting_delta", "Lighting Delta", "textarea", tab="Deltas",
                 help_text="Lighting deviation specific to this shot."),
        FieldDef("progression_axis", "Progression Axis", "text", tab="Progression",
                 placeholder='e.g. "decay", "construction", "weather_progression"'),
        FieldDef("progression_value", "Progression Value (0-1)", "float", tab="Progression"),
        FieldDef("notes", "Notes", "textarea", tab="Notes"),
    ],
))


# #############################################################################
#  TIER 3 — SCENE DETAIL
# #############################################################################

register(EntityDef(
    name="scene_emotional_target",
    label="Scene Emotional Target",
    label_plural="Scene Emotional Targets",
    icon="💗",
    category="Scene Detail",
    sort_order=400,
    tier=3,
    parent_entity="scene",
    parent_field="scene_id",
    description="Specific emotional goal and function for a scene.",
    fields=[
        FieldDef("name", "Name"),
        FieldDef("scene_id", "Scene", "reference",
                 reference_entity="scene", required=True),
        FieldDef("primary_emotion", "Primary Emotion", "text", required=True),
        FieldDef("primary_intensity", "Intensity (1-10)", "integer"),
        FieldDef("secondary_emotions", "Secondary Emotions", "json"),
        FieldDef("emotional_function", "Emotional Function", "select", options=[
            "setup", "build", "release", "shift", "sustain"
        ]),
        FieldDef("audience_character_relationship", "Audience-Character Relationship",
                 "select", options=["empathy", "sympathy", "antipathy", "observation"]),
        FieldDef("contrast_with_previous", "Contrast with Previous Scene", "textarea"),
    ],
))

register(EntityDef(
    name="scene_color_palette",
    label="Scene Color Palette",
    label_plural="Scene Color Palettes",
    icon="🎨",
    category="Scene Detail",
    sort_order=401,
    tier=3,
    parent_entity="scene",
    parent_field="scene_id",
    description="Specific color design for a scene.",
    fields=[
        FieldDef("name", "Name"),
        FieldDef("scene_id", "Scene", "reference",
                 reference_entity="scene", required=True),
        FieldDef("dominant_colors", "Dominant Colors (1-3)", "json"),
        FieldDef("color_harmony_type", "Color Harmony Type", "select", options=[
            "monochromatic", "analogous", "complementary", "triadic", "split-complementary"
        ]),
        FieldDef("color_source_distribution", "Color Source Distribution", "textarea"),
        FieldDef("color_contrast_level", "Color Contrast Level", "select",
                 options=["low", "medium", "high"]),
        FieldDef("focal_color", "Focal / Hero Color", "text"),
        FieldDef("grading_notes", "Color Grading Notes", "textarea"),
    ],
))

register(EntityDef(
    name="lighting_design",
    label="Lighting Design",
    label_plural="Lighting Designs",
    icon="💡",
    category="Scene Detail",
    sort_order=402,
    tier=3,
    parent_entity="scene",
    parent_field="scene_id",
    description="Illumination approach for a scene.",
    fields=[
        FieldDef("name", "Name"),
        FieldDef("scene_id", "Scene", "reference", reference_entity="scene", required=True),
        FieldDef("shot_id", "Shot (optional)", "reference", reference_entity="shot"),
        FieldDef("lighting_style", "Lighting Style", "select", options=[
            "naturalistic", "stylized", "high key", "low key", "chiaroscuro"
        ]),
        FieldDef("contrast_ratio", "Contrast Ratio", "text"),
        FieldDef("overall_mood", "Overall Mood", "text"),
        FieldDef("light_quality", "Overall Light Quality", "select",
                 options=["hard", "soft", "mixed"]),
        FieldDef("key_source", "Key Light Source", "text", tab="Key Light"),
        FieldDef("key_direction", "Key Direction", "text", tab="Key Light"),
        FieldDef("key_quality", "Key Quality", "select", tab="Key Light",
                 options=["hard", "soft"]),
        FieldDef("key_color_temperature", "Key Color Temperature (K)", "integer",
                 tab="Key Light"),
        FieldDef("fill_ratio", "Fill Ratio", "text", tab="Fill & Other"),
        FieldDef("fill_quality", "Fill Quality", "text", tab="Fill & Other"),
        FieldDef("fill_color_temperature", "Fill Color Temp (K)", "integer",
                 tab="Fill & Other"),
        FieldDef("backlight_notes", "Back/Rim/Hair Light", "textarea", tab="Fill & Other"),
        FieldDef("practical_lights", "Practical Lights", "textarea", tab="Fill & Other"),
        FieldDef("ambient_light", "Ambient Light", "textarea", tab="Fill & Other"),
        FieldDef("lighting_evolution", "Lighting Evolution Through Scene", "textarea",
                 tab="Fill & Other"),
    ],
))

register(EntityDef(
    name="scene_music_design",
    label="Scene Music Design",
    label_plural="Scene Music Designs",
    icon="🎶",
    category="Scene Detail",
    sort_order=403,
    tier=3,
    parent_entity="scene",
    parent_field="scene_id",
    description="Music approach for a specific scene.",
    fields=[
        FieldDef("name", "Name"),
        FieldDef("scene_id", "Scene", "reference",
                 reference_entity="scene", required=True),
        FieldDef("music_presence", "Music Presence", "select",
                 options=["score", "source", "none", "mixed"]),
        FieldDef("emotional_function", "Emotional Function", "select",
                 options=["support", "anticipate", "counterpoint", "neutral"]),
        FieldDef("entry_point", "Entry Point", "text"),
        FieldDef("build_evolution", "Build / Evolution", "textarea"),
        FieldDef("peak", "Peak", "text"),
        FieldDef("exit_point", "Exit Point", "text"),
        FieldDef("themes_used", "Themes Used", "json"),
        FieldDef("source_music_description", "Source Music Description", "textarea",
                 tab="Source Music"),
        FieldDef("lyrics_relevance", "Lyrics Relevance", "textarea", tab="Source Music"),
    ],
))

register(EntityDef(
    name="tone_marker",
    label="Tone Marker",
    label_plural="Tone Markers",
    icon="🏷️",
    category="Scene Detail",
    sort_order=404,
    tier=3,
    description="Scene-specific tonal quality and atmosphere.",
    fields=[
        FieldDef("name", "Name"),
        FieldDef("scene_id", "Scene", "reference", reference_entity="scene"),
        FieldDef("sequence_id", "Sequence", "reference", reference_entity="sequence"),
        FieldDef("tone_descriptor", "Tone Descriptor", "text"),
        FieldDef("intensity", "Intensity", "select",
                 options=["light", "moderate", "heavy"]),
        FieldDef("genre_elements", "Genre Elements Active", "text"),
        FieldDef("mood_atmosphere", "Mood / Atmosphere", "textarea"),
        FieldDef("pacing_expectation", "Pacing Expectation", "textarea"),
        FieldDef("tonal_shift", "Tonal Shift Notes", "textarea"),
    ],
))

register(EntityDef(
    name="set_dressing",
    label="Set Dressing",
    label_plural="Set Dressings",
    icon="🛋️",
    category="Scene Detail",
    sort_order=405,
    tier=3,
    description="Objects and arrangement populating a scene's location.",
    fields=[
        FieldDef("name", "Name"),
        FieldDef("scene_id", "Scene", "reference",
                 reference_entity="scene", required=True),
        FieldDef("location_id", "Location", "reference", reference_entity="location"),
        FieldDef("hero_objects", "Hero Objects", "json"),
        FieldDef("atmospheric_objects", "Atmospheric Objects", "textarea"),
        FieldDef("practical_objects", "Practical Objects", "textarea"),
        FieldDef("background_fill", "Background Fill", "textarea"),
        FieldDef("sightline_management", "Sightline Management", "textarea"),
        FieldDef("continuity_requirements", "Continuity Requirements", "textarea"),
    ],
))

register(EntityDef(
    name="dialogue_sound_design",
    label="Dialogue Sound Design",
    label_plural="Dialogue Sound Designs",
    icon="🎙️",
    category="Scene Detail",
    sort_order=406,
    tier=3,
    description="How dialogue sounds in the world — recording aesthetic, processing.",
    fields=[
        FieldDef("name", "Name"),
        FieldDef("scene_id", "Scene (optional)", "reference", reference_entity="scene"),
        FieldDef("recording_aesthetic", "Recording Aesthetic", "select",
                 options=["clean/studio", "production audio", "stylized"]),
        FieldDef("acoustic_environment", "Acoustic Environment", "textarea"),
        FieldDef("dialogue_clarity", "Dialogue Clarity", "select",
                 options=["always clear", "sometimes obscured", "deliberately muddy"]),
        FieldDef("dialogue_layering", "Dialogue Layering", "textarea"),
        FieldDef("processing_notes", "Processing Notes", "textarea"),
    ],
))


# #############################################################################
#  TIER 4 — THEMATIC TRACKING
# #############################################################################

register(EntityDef(
    name="character_color_identity",
    label="Character Color Identity",
    label_plural="Character Color Identities",
    icon="🎨",
    category="Thematic Tracking",
    sort_order=508,
    tier=4,
    parent_entity="character",
    parent_field="character_id",
    description="Signature color language for a character. A directorial choice about "
                "how the character manifests visually — thematic, not fundamental.",
    fields=[
        FieldDef("name", "Name"),
        FieldDef("character_id", "Character", "reference",
                 reference_entity="character", required=True),
        FieldDef("primary_color_hex", "Primary Color (hex)", "text",
                 placeholder="#2C3E50"),
        FieldDef("primary_color_name", "Primary Color Name", "text"),
        FieldDef("secondary_colors", "Secondary Colors", "json"),
        FieldDef("how_manifests", "How Colors Manifest", "select", options=[
            "wardrobe", "accessories", "environment", "lighting", "multiple"
        ]),
        FieldDef("why_these_colors", "Why These Colors", "textarea"),
        FieldDef("consistency_level", "Consistency Level", "select",
                 options=["always", "usually", "accent only", "metaphor only"]),
        FieldDef("starting_colors", "Starting Colors", "text", tab="Evolution"),
        FieldDef("midpoint_shift", "Midpoint Shift", "text", tab="Evolution"),
        FieldDef("final_colors", "Final Colors", "text", tab="Evolution"),
        FieldDef("color_isolation", "Color Isolation", "select", tab="Evolution",
                 options=["unique to character", "shared", "contrasting with another"]),
    ],
))

register(EntityDef(
    name="motif",
    label="Motif",
    label_plural="Motifs",
    icon="🔷",
    category="Thematic Tracking",
    sort_order=500,
    tier=4,
    description="A meaning-carrying element in any modality — visual, sonic, verbal, "
                "behavioral, conceptual, or situational. Recurring motifs and standalone "
                "charged symbols share this table, distinguished by the recurrence field. "
                "Replaces visual_motif, sonic_motif, conceptual_motif, and symbol "
                "(2.0 consolidation).",
    fields=[
        FieldDef("name", "Motif Name", required=True),
        FieldDef("modality", "Modality", "select", required=True, options=[
            "visual", "sonic", "verbal", "behavioral", "conceptual", "situational"
        ]),
        FieldDef("recurrence", "Recurrence", "select",
                 options=["recurring", "standalone"],
                 help_text="Recurring = classic motif. Standalone = a single charged "
                           "element (what the pre-2.0 schema called a symbol)."),
        FieldDef("description", "Description", "textarea",
                 help_text="What the element literally is — the shape, sound, phrase, "
                           "or behavior."),
        FieldDef("literal_function", "Literal Function", "textarea"),
        FieldDef("symbolic_meaning", "Primary Symbolic Meaning", "textarea"),
        FieldDef("secondary_meaning", "Secondary Meaning", "textarea"),
        FieldDef("emotional_associations", "Emotional Associations", "textarea"),
        FieldDef("first_appearance_scene_id", "First Appearance Scene", "reference",
                 reference_entity="scene"),
        FieldDef("recurrence_pattern", "Recurrence Pattern", "textarea", tab="Placement"),
        FieldDef("placement_strategy", "Placement Strategy", "textarea", tab="Placement"),
        FieldDef("subtlety_level", "Subtlety Level", "select", tab="Placement",
                 options=["obvious", "noticeable", "subtle", "hidden"]),
        FieldDef("evolution_description", "Evolution Through Story", "textarea",
                 tab="Evolution",
                 help_text="Narrative summary. The queryable stages live in "
                           "motif_state rows (pattern 3)."),
        FieldDef("related_motif_id", "Related Motif", "reference", tab="Connections",
                 reference_entity="motif",
                 help_text="A motif in another modality this one echoes — e.g. a sonic "
                           "motif tied to a visual one."),
    ],
))

register(EntityDef(
    name="motif_state",
    label="Motif State",
    label_plural="Motif States",
    icon="🔶",
    category="Thematic Tracking",
    sort_order=501,
    tier=4,
    description="A motif's evolution stage as of a story position — how its "
                "meaning or loudness has shifted. Latest-wins position keying "
                "(pattern 3, conventions.md). The motif's "
                "evolution_description remains the narrative summary. "
                "G1, schema 2.2.",
    fields=[
        FieldDef("name", "Name"),
        FieldDef("motif_id", "Motif", "reference",
                 reference_entity="motif", required=True),
        FieldDef("scene_id", "As Of Scene", "reference",
                 reference_entity="scene", required=True),
        FieldDef("stage_description", "Stage Description", "textarea"),
        FieldDef("subtlety_level", "Subtlety Level", "select",
                 options=["obvious", "noticeable", "subtle", "hidden"],
                 help_text="Overrides the motif's base subtlety from this "
                           "position onward."),
        FieldDef("meaning_shift", "Meaning Shift", "textarea"),
    ],
))

# motif_appearance uses open polymorphism (entity_type + entity_id).
# Distinct from constrained polymorphism (subject_type + subject_id) used in
# entity_anchor. See conventions.md.
register(EntityDef(
    name="motif_appearance",
    label="Motif Appearance",
    label_plural="Motif Appearances",
    icon="🔗",
    category="Connections",
    sort_order=64,
    tier=0,
    description="Where a motif manifests in the story. Open polymorphism — entity_type "
                "is open-ended; domain records the sensory channel. Replaces "
                "visual_motif_appearance and motif_manifestation (2.0 consolidation).",
    has_lifecycle_status=False,
    fields=[
        FieldDef("name", "Display Name", hidden=True),
        FieldDef("motif_id", "Motif", "reference",
                 reference_entity="motif", required=True),
        FieldDef("scene_id", "Scene", "reference", reference_entity="scene"),
        FieldDef("entity_type", "Entity Type", "select",
                 options=["location", "prop", "costume", "character", "scene", "shot"],
                 help_text="Open polymorphism — names the table entity_id points into. "
                           "Optional when the appearance is scoped by scene alone."),
        FieldDef("entity_id", "Entity ID", "integer"),
        FieldDef("domain", "Domain", "select",
                 options=["visual", "sonic", "dialogue", "action"],
                 help_text="The sensory/dramatic channel the motif manifests through."),
        FieldDef("manifestation_notes", "Manifestation Notes", "textarea"),
    ],
))

register(EntityDef(
    name="subtext",
    label="Subtext",
    label_plural="Subtext Layers",
    icon="🧊",
    category="Thematic Tracking",
    sort_order=504,
    tier=4,
    description="Underlying meaning beneath surface action or dialogue.",
    fields=[
        FieldDef("name", "Name"),
        FieldDef("scene_id", "Scene", "reference", reference_entity="scene"),
        FieldDef("surface_level", "Surface Level", "textarea", required=True),
        FieldDef("subtext_level", "Subtext Level", "textarea", required=True),
        FieldDef("gap_size", "Gap Between Surface and Subtext", "select",
                 options=["small", "moderate", "large"]),
        FieldDef("character_awareness", "Character Awareness", "select",
                 options=["aware", "unaware", "mixed"]),
        FieldDef("audience_access", "Audience Access", "select",
                 options=["first viewing", "repeat viewing", "analysis"]),
        FieldDef("purpose", "Subtext Purpose", "select", options=[
            "dramatic irony", "character revelation", "thematic depth",
            "foreshadowing", "emotional complexity"
        ]),
    ],
))

# thematic_connection uses open polymorphism (entity_type + entity_id).
register(EntityDef(
    name="thematic_connection",
    label="Thematic Connection",
    label_plural="Thematic Connections",
    icon="🔗",
    category="Thematic Tracking",
    sort_order=505,
    tier=4,
    description="How a specific element connects to a theme. "
                "Open polymorphism — entity_type is open-ended.",
    fields=[
        FieldDef("name", "Display Name"),
        FieldDef("theme_id", "Theme", "reference",
                 reference_entity="theme", required=True),
        FieldDef("entity_type", "Connected Entity Type", "select", options=[
            "character", "scene", "location", "prop", "costume", "motif"
        ]),
        FieldDef("entity_id", "Connected Entity ID", "integer", required=True),
        FieldDef("nature_of_connection", "Nature of Connection", "select", options=[
            "embodies", "explores", "represents", "challenges", "resolves"
        ]),
        FieldDef("subtlety_level", "Subtlety Level", "select",
                 options=["on-the-nose", "clear", "subtle", "hidden"]),
        FieldDef("intended_perception", "Intended Perception", "select", options=[
            "must recognize", "enhances if recognized", "reward for careful viewing"
        ]),
    ],
))

register(EntityDef(
    name="color_symbolism",
    label="Color Symbolism",
    label_plural="Color Symbolism",
    icon="🌈",
    category="Thematic Tracking",
    sort_order=506,
    tier=4,
    description="Thematic meanings assigned to specific colors in this story.",
    fields=[
        FieldDef("name", "Color Name", required=True),
        FieldDef("color_hex", "Color (hex)", "text"),
        FieldDef("primary_symbolism", "Primary Symbolism", "textarea"),
        FieldDef("secondary_symbolism", "Secondary Symbolism", "textarea"),
        FieldDef("emotional_positive", "Positive Emotional Association", "textarea"),
        FieldDef("emotional_negative", "Negative Emotional Association", "textarea"),
        FieldDef("evolution_through_story", "Evolution Through Story", "textarea"),
        FieldDef("cultural_context", "Cultural Context", "textarea"),
    ],
))

register(EntityDef(
    name="color_script",
    label="Color Script",
    label_plural="Color Scripts",
    icon="🎞️",
    category="Thematic Tracking",
    sort_order=507,
    tier=4,
    description="Visual map of color progression through the story.",
    fields=[
        FieldDef("name", "Name", default="Color Script"),
        FieldDef("format", "Format", "select",
                 options=["strip", "grid", "timeline"]),
        FieldDef("granularity", "Granularity", "select",
                 options=["per scene", "per sequence", "per act"]),
        FieldDef("progression_description", "Color Progression Description", "textarea"),
        FieldDef("key_color_moments", "Key Color Moments", "textarea"),
        FieldDef("arc_shape", "Color Arc Shape", "select",
                 options=["linear", "cyclical", "transformative", "oscillating"]),
        FieldDef("emotional_mapping", "Emotional Color Mapping", "textarea"),
    ],
))

register(EntityDef(
    name="color_script_entry",
    label="Color Script Entry",
    label_plural="Color Script Entries",
    icon="🎞️",
    category="Thematic Tracking",
    sort_order=507,
    tier=4,
    description="Position-keyed color intent — the row form of the color "
                "script (Phase B found color_script itself is prose). "
                "Latest-wins position keying (pattern 3, conventions.md): "
                "the intent in force at P is the latest entry at-or-before P. "
                "Act-level intent is keyed to the act's first scene by "
                "convention. Sits in the visual direction cascade between "
                "the project palette and scene palettes. G1, schema 2.2.",
    fields=[
        FieldDef("name", "Name"),
        FieldDef("scene_id", "From Scene", "reference",
                 reference_entity="scene", required=True),
        FieldDef("temperature", "Temperature", "select",
                 options=["warm", "cool", "neutral", "transitional"]),
        FieldDef("key_colors", "Key Colors", "json"),
        FieldDef("palette_shift", "Palette Shift", "textarea",
                 help_text="What changes about the palette from this "
                           "position, and why."),
        FieldDef("emotional_intent", "Emotional Intent", "textarea"),
    ],
))


# #############################################################################
#  TIER 5 — EMOTIONAL ARCHITECTURE
# #############################################################################

register(EntityDef(
    name="emotional_arc",
    label="Emotional Arc",
    label_plural="Emotional Arcs",
    icon="📈",
    category="Thematic Tracking",
    sort_order=510,
    tier=5,
    description="Overall emotional trajectory for the audience across the project.",
    fields=[
        FieldDef("name", "Name", default="Audience Emotional Arc"),
        FieldDef("opening_emotional_state", "Opening Emotional State", "textarea"),
        FieldDef("closing_emotional_state", "Closing Emotional State", "textarea"),
        FieldDef("emotional_shape", "Emotional Shape", "select", options=[
            "rising action", "oscillating", "descent", "transformation"
        ]),
        FieldDef("lingering_feelings", "Lingering Feelings", "textarea"),
    ],
))

register(EntityDef(
    name="emotional_beat",
    label="Emotional Beat",
    label_plural="Emotional Beats",
    icon="💓",
    category="Thematic Tracking",
    sort_order=511,
    tier=5,
    description="Specific point on the audience emotional journey.",
    fields=[
        FieldDef("name", "Name"),
        FieldDef("emotional_arc_id", "Emotional Arc", "reference",
                 reference_entity="emotional_arc"),
        FieldDef("scene_id", "Scene", "reference", reference_entity="scene"),
        FieldDef("sequence_id", "Sequence", "reference", reference_entity="sequence"),
        FieldDef("beat_order", "Beat Order", "integer", required=True),
        FieldDef("target_emotion", "Target Emotion", "text", required=True),
        FieldDef("intensity", "Intensity (1-10)", "integer"),
        FieldDef("beat_trigger", "Trigger", "textarea"),
    ],
))

register(EntityDef(
    name="information_strategy",
    label="Information Strategy",
    label_plural="Information Strategies",
    icon="🧩",
    category="Thematic Tracking",
    sort_order=512,
    tier=5,
    description="What the audience knows vs what characters know.",
    fields=[
        FieldDef("name", "Name"),
        FieldDef("scene_id", "Scene", "reference",
                 reference_entity="scene", required=True),
        FieldDef("knowledge_asymmetry", "Knowledge Asymmetry", "select", options=[
            "dramatic irony", "mystery", "parallel knowledge", "shifting"
        ]),
        FieldDef("information_withheld", "Information Withheld", "textarea"),
        FieldDef("reveal_timing", "Reveal Timing", "textarea"),
        FieldDef("audience_position", "Audience Position", "select",
                 options=["ahead of characters", "behind characters", "with characters"]),
        FieldDef("information_layers", "Information Layers", "textarea"),
    ],
))

register(EntityDef(
    name="identification_strategy",
    label="Identification Strategy",
    label_plural="Identification Strategies",
    icon="🎯",
    category="Thematic Tracking",
    sort_order=513,
    tier=5,
    description="How the audience aligns with characters in a scene.",
    fields=[
        FieldDef("name", "Name"),
        FieldDef("scene_id", "Scene", "reference",
                 reference_entity="scene", required=True),
        FieldDef("primary_character_id", "Primary Identification With", "reference",
                 reference_entity="character"),
        FieldDef("secondary_character_id", "Secondary Identification With", "reference",
                 reference_entity="character"),
        FieldDef("audience_position", "Audience Position", "select", options=[
            "with character", "observing character", "above character"
        ]),
        FieldDef("identification_technique", "Identification Technique", "textarea"),
        FieldDef("emotional_alignment", "Emotional Alignment", "textarea"),
    ],
))


# #############################################################################
#  TIER 6 — PRODUCTION
# #############################################################################

register(EntityDef(
    name="shot",
    label="Shot",
    label_plural="Shots",
    icon="🎥",
    category="Production",
    sort_order=600,
    tier=6,
    description="A single camera setup within a scene.",
    has_external_id=True,
    fields=[
        FieldDef("name", "Shot Name / Number", required=True,
                 placeholder="e.g. 23A"),
        FieldDef("scene_id", "Scene", "reference",
                 reference_entity="scene", required=True),
        FieldDef("shot_number", "Shot Number", "text"),
        FieldDef("shot_order", "Order in Scene", "integer"),
        FieldDef("story_beat_id", "Story Beat", "reference",
                 reference_entity="story_beat",
                 help_text="Optional: the beat within the scene this "
                           "shot covers. Shots without a beat sit "
                           "directly under the scene."),
        FieldDef("shot_size", "Shot Size", "select", options=[
            "extreme wide", "wide", "medium wide", "medium",
            "medium close-up", "close-up", "extreme close-up"
        ]),
        FieldDef("camera_angle", "Camera Angle", "select", options=[
            "eye level", "high angle", "low angle", "overhead", "dutch", "POV"
        ]),
        FieldDef("camera_movement", "Camera Movement", "select", options=[
            "static", "pan", "tilt", "dolly", "tracking", "crane",
            "handheld", "steadicam", "drone", "zoom"
        ]),
        FieldDef("lens_choice", "Lens", "text"),
        FieldDef("duration_seconds", "Estimated Duration (seconds)", "float"),
        FieldDef("description", "Shot Description", "textarea"),
        FieldDef("notes", "Notes", "textarea", tab="Notes"),
    ],
))

register(EntityDef(
    name="shot_design",
    label="Shot Design",
    label_plural="Shot Designs",
    icon="📐",
    category="Production",
    sort_order=601,
    tier=6,
    description="Detailed visual composition for a shot.",
    fields=[
        FieldDef("name", "Name"),
        FieldDef("shot_id", "Shot", "reference", reference_entity="shot", required=True),
        FieldDef("composition_type", "Composition Type", "select", options=[
            "rule of thirds", "centered", "symmetrical", "asymmetric", "dynamic"
        ]),
        FieldDef("frame_division", "Frame Division", "textarea"),
        FieldDef("subject_placement", "Subject Placement", "textarea"),
        FieldDef("negative_space", "Negative Space Usage", "textarea"),
        FieldDef("depth_of_field", "Depth of Field", "select",
                 options=["shallow", "medium", "deep"]),
        FieldDef("focus_strategy", "Focus Strategy", "textarea"),
        FieldDef("color_emphasis", "Color Emphasis", "textarea"),
        FieldDef("textural_emphasis", "Textural Emphasis", "textarea"),
    ],
))

register(EntityDef(
    name="shot_language",
    label="Shot Language",
    label_plural="Shot Language",
    icon="🗣️",
    category="Production",
    sort_order=602,
    tier=6,
    description="How shots communicate meaning — visual vocabulary for a scene.",
    fields=[
        FieldDef("name", "Name"),
        FieldDef("scene_id", "Scene", "reference",
                 reference_entity="scene", required=True),
        FieldDef("visual_strategy", "Visual Strategy", "textarea"),
        FieldDef("shot_relationships", "Shot Relationships", "textarea"),
        FieldDef("cutting_pattern", "Cutting Pattern", "textarea"),
        FieldDef("rhythm", "Editorial Rhythm", "select",
                 options=["fast", "slow", "varying", "deliberate"]),
        FieldDef("transitions", "Transition Approach", "textarea"),
    ],
))

register(EntityDef(
    name="scene_blocking",
    label="Scene Blocking",
    label_plural="Scene Blockings",
    icon="🗺️",
    category="Production",
    sort_order=603,
    tier=6,
    description="Physical staging of characters and movement within the scene, including "
                "the use of distance as meaning (absorbed proxemic_design in the 2.0 "
                "consolidation).",
    fields=[
        FieldDef("name", "Name"),
        FieldDef("scene_id", "Scene", "reference",
                 reference_entity="scene", required=True),
        FieldDef("staging_concept", "Staging Concept", "textarea"),
        FieldDef("character_geography", "Character Geography", "textarea"),
        FieldDef("blocking_evolution", "Blocking Evolution Through Scene", "textarea"),
        FieldDef("proxemics", "Proxemics", "textarea",
                 help_text="How physical distance between characters carries meaning in "
                           "this scene — opening distances, evolution, violations."),
        FieldDef("camera_relationship", "Camera Relationship to Action", "textarea"),
    ],
))

register(EntityDef(
    name="staging_beat",
    label="Staging Beat",
    label_plural="Staging Beats",
    icon="📍",
    category="Production",
    sort_order=604,
    tier=6,
    description="Ordered physical staging moment within a scene container — either a "
                "scene_blocking or an action_sequence. Exactly one of scene_blocking_id "
                "or action_sequence_id must be set. Replaces blocking_beat and "
                "action_beat (2.0 consolidation).",
    fields=[
        FieldDef("name", "Name"),
        FieldDef("scene_blocking_id", "Scene Blocking", "reference",
                 reference_entity="scene_blocking",
                 help_text="Parent for general blocking beats. Mutually exclusive with "
                           "action_sequence_id."),
        FieldDef("action_sequence_id", "Action Sequence", "reference",
                 reference_entity="action_sequence",
                 help_text="Parent for choreographed action beats. Mutually exclusive "
                           "with scene_blocking_id."),
        FieldDef("beat_order", "Beat Order", "integer", required=True),
        FieldDef("description", "Description", "textarea"),
        FieldDef("characters_involved", "Characters Involved", "json"),
        FieldDef("character_positions", "Character Positions", "json"),
        FieldDef("movement_description", "Movement / Physical Action", "textarea"),
        FieldDef("camera_note", "Camera Note", "text"),
    ],
))

register(EntityDef(
    name="action_sequence",
    label="Action Sequence",
    label_plural="Action Sequences",
    icon="💥",
    category="Production",
    sort_order=605,
    tier=6,
    description="Choreographed action sequence — fight, chase, stunt.",
    fields=[
        FieldDef("name", "Name", required=True),
        FieldDef("scene_id", "Scene", "reference",
                 reference_entity="scene", required=True),
        FieldDef("sequence_type", "Sequence Type", "select", options=[
            "fight", "chase", "stunt", "combat", "athletic", "physical comedy"
        ]),
        FieldDef("description", "Description", "textarea"),
        FieldDef("style", "Style", "text"),
        FieldDef("difficulty_level", "Difficulty Level", "select",
                 options=["simple", "moderate", "complex", "extreme"]),
        FieldDef("safety_concerns", "Safety Concerns", "textarea"),
        FieldDef("stunt_requirements", "Stunt Requirements", "textarea"),
    ],
))

register(EntityDef(
    name="action_sequence_character",
    label="Action Sequence-Character",
    label_plural="Action Sequence-Characters",
    icon="🔗",
    category="Connections",
    sort_order=66,
    tier=0,
    description="Links characters to action sequences with their role.",
    has_lifecycle_status=False,
    fields=[
        FieldDef("name", "Display Name", hidden=True),
        FieldDef("action_sequence_id", "Action Sequence", "reference",
                 reference_entity="action_sequence", required=True),
        FieldDef("character_id", "Character", "reference",
                 reference_entity="character", required=True),
        FieldDef("role_in_action", "Role in Action", "text"),
        FieldDef("notes", "Notes", "textarea"),
    ],
))

register(EntityDef(
    name="performance_state",
    label="Performance State",
    label_plural="Performance States",
    icon="🌡️",
    category="Production",
    sort_order=608,
    tier=6,
    description="Modulation of a character's baseline profile, in one performance "
                "modality. Replaces physical_state and vocal_state (2.0 consolidation). "
                "The modality enum mirrors bundle intents so per-modality tools can "
                "filter states the same way they filter bundles. Temporal reach is "
                "governed by the persistence field — see 'Persistence and position' "
                "in conventions.md.",
    fields=[
        FieldDef("name", "Name"),
        FieldDef("character_id", "Character", "reference",
                 reference_entity="character", required=True),
        FieldDef("scene_id", "Scene", "reference", reference_entity="scene"),
        FieldDef("shot_id", "Shot", "reference", reference_entity="shot"),
        FieldDef("modality", "Modality", "select", required=True,
                 options=["physical", "vocal"]),
        FieldDef("persistence", "Persistence", "select",
                 options=["scene_only", "until_resolved"],
                 help_text="scene_only (default): in force only for the keyed scene. "
                           "until_resolved: in force from the keyed scene onward, "
                           "until resolved_at_scene. See conventions.md."),
        FieldDef("resolved_at_scene_id", "Resolved At Scene", "reference",
                 reference_entity="scene",
                 help_text="For until_resolved states: the scene at which this state "
                           "stops being in force (exclusive). Empty = still open."),
        FieldDef("state_description", "State Description", "textarea"),
        FieldDef("modulations", "Modulations", "json",
                 help_text="Keyed modulation of baseline profile attributes. Physical: "
                           "tension / energy / posture / movement. Vocal: pitch / "
                           "volume / pace / articulation. When multiple states are in "
                           "force, modulations merge key-wise, newest state wins per key."),
        FieldDef("emotional_coloring", "Emotional Coloring", "textarea"),
        FieldDef("trigger", "Trigger", "textarea"),
    ],
))

register(EntityDef(
    name="performance_beat",
    label="Performance Beat",
    label_plural="Performance Beats",
    icon="🎭",
    category="Production",
    sort_order=610,
    tier=6,
    description="A specific performance moment for a character within a scene, in one "
                "modality — a physical action, a delivered line, or a facial beat. "
                "Replaces physical_performance_beat, vocal_beat, line_delivery, and "
                "microexpression (2.0 consolidation).",
    fields=[
        FieldDef("name", "Name"),
        FieldDef("scene_id", "Scene", "reference",
                 reference_entity="scene", required=True),
        FieldDef("character_id", "Character", "reference",
                 reference_entity="character", required=True),
        FieldDef("beat_order", "Beat Order", "integer"),
        FieldDef("modality", "Modality", "select", required=True,
                 options=["physical", "vocal", "facial"]),
        FieldDef("description", "Description", "textarea"),
        FieldDef("trigger", "Trigger", "textarea"),
        FieldDef("emotional_subtext", "Emotional Subtext", "textarea"),
        FieldDef("line_text", "Line Text", "textarea", tab="Delivery",
                 help_text="For vocal beats tied to a specific line. "
                           "Interim matching contract — superseded by "
                           "line_ref where a screenplay is present."),
        FieldDef("line_ref", "Line Ref", "text", tab="Delivery",
                 help_text="uuid of the anchored screenplay line (G5). "
                           "Authored from the script editor; re-anchors "
                           "deterministically through split/merge."),
        FieldDef("emphasis_words", "Emphasis Words", "json", tab="Delivery"),
        FieldDef("pace", "Pace", "select", tab="Delivery",
                 options=["fast", "slow", "measured", "varying"]),
        FieldDef("volume", "Volume", "select", tab="Delivery",
                 options=["whisper", "soft", "normal", "loud", "shout"]),
        FieldDef("delivery_notes", "Delivery Notes", "textarea", tab="Delivery"),
        FieldDef("physical_action", "Physical Action", "textarea", tab="Physical"),
        FieldDef("body_part_focus", "Body Part Focus", "text", tab="Physical"),
        FieldDef("visibility", "Audience Visibility", "select", tab="Physical",
                 options=["clearly seen", "subtle", "blink and miss"],
                 help_text="Chiefly for facial beats — how legible the moment is."),
    ],
))

register(EntityDef(
    name="dialogue_rhythm",
    label="Dialogue Rhythm",
    label_plural="Dialogue Rhythms",
    icon="🎼",
    category="Production",
    sort_order=613,
    tier=6,
    description="Conversational pacing and interaction patterns in a scene.",
    fields=[
        FieldDef("name", "Name"),
        FieldDef("scene_id", "Scene", "reference",
                 reference_entity="scene", required=True),
        FieldDef("overall_rhythm", "Overall Rhythm", "select",
                 options=["staccato", "legato", "varying"]),
        FieldDef("pause_pattern", "Pause Pattern", "textarea"),
        FieldDef("overlap_pattern", "Overlap Pattern", "textarea"),
        FieldDef("silence_pattern", "Silence Pattern", "textarea"),
    ],
))

register(EntityDef(
    name="character_environment_physicality",
    label="Character-Environment Physicality",
    label_plural="Character-Environment Physicalities",
    icon="🏞️",
    category="Production",
    sort_order=616,
    tier=6,
    description="How a character physically interacts with their environment.",
    fields=[
        FieldDef("name", "Name"),
        FieldDef("character_id", "Character", "reference",
                 reference_entity="character", required=True),
        FieldDef("location_id", "Location", "reference",
                 reference_entity="location", required=True),
        FieldDef("comfort_level", "Comfort Level", "select",
                 options=["at home", "comfortable", "alert", "uncomfortable", "alien"]),
        FieldDef("interaction_pattern", "Interaction Pattern", "textarea"),
        FieldDef("spatial_use", "Spatial Use", "textarea"),
        FieldDef("object_interaction", "Object Interaction", "textarea"),
    ],
))

register(EntityDef(
    name="movement_choreography",
    label="Movement Choreography",
    label_plural="Movement Choreographies",
    icon="💃",
    category="Production",
    sort_order=619,
    tier=6,
    description="Choreographed movement design for a scene or sequence.",
    fields=[
        FieldDef("name", "Name"),
        FieldDef("scene_id", "Scene", "reference",
                 reference_entity="scene", required=True),
        FieldDef("movement_concept", "Movement Concept", "textarea"),
        FieldDef("rhythm_pattern", "Rhythm Pattern", "textarea"),
        FieldDef("spatial_pattern", "Spatial Pattern", "textarea"),
        FieldDef("ensemble_coordination", "Ensemble Coordination", "textarea"),
        FieldDef("style_reference", "Style Reference", "text"),
    ],
))

register(EntityDef(
    name="musical_theme",
    label="Musical Theme",
    label_plural="Musical Themes",
    icon="🎼",
    category="Production",
    sort_order=620,
    tier=6,
    description="Recurring musical phrase associated with a character, place, or idea.",
    fields=[
        FieldDef("name", "Theme Name", required=True),
        FieldDef("theme_type", "Theme Type", "select", options=[
            "character theme", "place theme", "idea theme",
            "relationship theme", "emotional theme"
        ]),
        FieldDef("associated_entity", "Associated Entity", "text"),
        FieldDef("description", "Description", "textarea"),
        FieldDef("instrumentation", "Instrumentation", "text"),
        FieldDef("variations", "Variations Through Story", "textarea"),
        FieldDef("evolution_description", "Evolution Description", "textarea"),
    ],
))

register(EntityDef(
    name="sound_cue",
    label="Sound Cue",
    label_plural="Sound Cues",
    icon="🔊",
    category="Production",
    sort_order=621,
    tier=6,
    description="A specific sound element placement.",
    fields=[
        FieldDef("name", "Name", required=True),
        FieldDef("scene_id", "Scene", "reference", reference_entity="scene"),
        FieldDef("shot_id", "Shot", "reference", reference_entity="shot"),
        FieldDef("sound_type", "Sound Type", "select", options=[
            "ambient", "effect", "foley", "design",
            "stinger", "dialogue", "voiceover"
        ]),
        FieldDef("description", "Description", "textarea"),
        FieldDef("timing", "Timing", "text"),
        FieldDef("duration", "Duration", "text"),
        FieldDef("emotional_function", "Emotional Function", "textarea"),
    ],
))

register(EntityDef(
    name="music_cue",
    label="Music Cue",
    label_plural="Music Cues",
    icon="🎵",
    category="Production",
    sort_order=622,
    tier=6,
    description="A specific music placement and its function.",
    fields=[
        FieldDef("name", "Cue Name", required=True),
        FieldDef("scene_id", "Scene", "reference",
                 reference_entity="scene", required=True),
        FieldDef("cue_type", "Cue Type", "select",
                 options=["score", "source"]),
        FieldDef("entry_timing", "Entry Timing", "text"),
        FieldDef("exit_timing", "Exit Timing", "text"),
        FieldDef("duration_seconds", "Duration (seconds)", "integer"),
        FieldDef("musical_theme_id", "Musical Theme", "reference",
                 reference_entity="musical_theme"),
        FieldDef("emotional_function", "Emotional Function", "textarea"),
        FieldDef("dynamics", "Dynamics", "textarea"),
    ],
))

register(EntityDef(
    name="sound_perspective",
    label="Sound Perspective",
    label_plural="Sound Perspectives",
    icon="👂",
    category="Production",
    sort_order=623,
    tier=6,
    description="POV approach to sound — whose ears are we using?",
    fields=[
        FieldDef("name", "Name"),
        FieldDef("scene_id", "Scene", "reference",
                 reference_entity="scene", required=True),
        FieldDef("perspective_type", "Perspective Type", "select",
                 options=["objective", "subjective", "shifting"]),
        FieldDef("pov_character_id", "POV Character", "reference",
                 reference_entity="character"),
        FieldDef("spatial_logic", "Spatial Logic", "textarea"),
        FieldDef("psychological_logic", "Psychological Logic", "textarea"),
    ],
))

register(EntityDef(
    name="voiceover_design",
    label="Voiceover Design",
    label_plural="Voiceover Designs",
    icon="🎙️",
    category="Production",
    sort_order=624,
    tier=6,
    description="Narration / inner-voice approach for the project or scene.",
    fields=[
        FieldDef("name", "Name"),
        FieldDef("scene_id", "Scene (if scene-specific)", "reference",
                 reference_entity="scene"),
        FieldDef("character_id", "Narrator Character", "reference",
                 reference_entity="character"),
        FieldDef("voiceover_type", "Voiceover Type", "select", options=[
            "narrator", "inner monologue", "letter/diary",
            "retrospective", "future self"
        ]),
        FieldDef("voiceover_function", "Function", "textarea"),
        FieldDef("temporal_position", "Temporal Position", "select",
                 options=["concurrent", "retrospective", "prospective"]),
        FieldDef("knowledge_position", "Knowledge Position", "select",
                 options=["omniscient", "limited", "unreliable"]),
        FieldDef("relationship_to_image", "Relationship to Image", "select",
                 options=["matches", "counterpoint", "expands"]),
    ],
))

register(EntityDef(
    name="music_sound_relationship",
    label="Music-Sound Relationship",
    label_plural="Music-Sound Relationships",
    icon="🎚️",
    category="Production",
    sort_order=625,
    tier=6,
    description="How music and sound design interact in a scene.",
    fields=[
        FieldDef("name", "Name"),
        FieldDef("scene_id", "Scene", "reference",
                 reference_entity="scene", required=True),
        FieldDef("relationship_type", "Relationship Type", "select", options=[
            "music dominant", "sound dominant", "integrated", "alternating"
        ]),
        FieldDef("integration_approach", "Integration Approach", "textarea"),
        FieldDef("dynamic_balance", "Dynamic Balance", "textarea"),
        FieldDef("frequency_separation", "Frequency Separation", "textarea"),
    ],
))


# #############################################################################
#  METADATA — Creative decisions, notes, assets
# #############################################################################

register(EntityDef(
    name="creative_decision",
    label="Creative Decision",
    label_plural="Creative Decisions",
    icon="✅",
    category="Metadata",
    sort_order=700,
    tier=0,
    description="A recorded creative decision with rationale.",
    fields=[
        FieldDef("name", "Decision Name", required=True),
        FieldDef("decision_type", "Decision Type", "select", options=[
            "casting", "visual", "narrative", "technical",
            "audio", "design", "structural", "other"
        ]),
        FieldDef("description", "Description", "textarea"),
        FieldDef("rationale", "Rationale", "textarea"),
        FieldDef("alternatives_considered", "Alternatives Considered", "textarea"),
        FieldDef("affected_entities", "Affected Entities", "json"),
        FieldDef("decision_date", "Decision Date", "text"),
        FieldDef("decided_by", "Decided By", "text"),
    ],
))

register(EntityDef(
    name="collaboration_note",
    label="Collaboration Note",
    label_plural="Collaboration Notes",
    icon="💬",
    category="Metadata",
    sort_order=701,
    tier=0,
    description="Notes for or from collaborators.",
    fields=[
        FieldDef("name", "Note Title"),
        FieldDef("note_type", "Note Type", "select", options=[
            "for cinematographer", "for production designer",
            "for costume designer", "for sound designer",
            "for composer", "for editor", "for actors", "general"
        ]),
        FieldDef("content", "Content", "textarea", required=True),
        FieldDef("priority", "Priority", "select",
                 options=["low", "medium", "high", "critical"]),
        FieldDef("affected_entities", "Affected Entities", "json"),
        FieldDef("author", "Author", "text"),
        FieldDef("note_date", "Date", "text"),
    ],
))

register(EntityDef(
    name="asset",
    label="Asset",
    label_plural="Assets",
    icon="📎",
    category="Metadata",
    sort_order=702,
    tier=0,
    description="Reference asset (image, audio, video, document). The atomic unit "
                "that bundles compose. Versionable — supports asset version chains.",
    versionable=True,
    has_external_id=True,
    fields=[
        FieldDef("name", "Asset Name", required=True),
        FieldDef("asset_type", "Asset Type", "select", options=[
            "image", "audio", "video", "document", "3d model",
            "lookbook", "reference photo", "concept art", "other"
        ]),
        FieldDef("file_path", "File Path / URL", "text"),
        FieldDef("description", "Description", "textarea"),
        FieldDef("tags", "Tags", "json"),
        FieldDef("source", "Source / Credit", "text"),
        FieldDef("notes", "Notes", "textarea", tab="Notes"),
    ],
))

# asset_relationship uses open polymorphism (entity_type + entity_id).
register(EntityDef(
    name="asset_relationship",
    label="Asset Relationship",
    label_plural="Asset Relationships",
    icon="🔗",
    category="Connections",
    sort_order=67,
    tier=0,
    description="Links an asset to an entity it documents or references. "
                "Open polymorphism — entity_type is open-ended.",
    has_lifecycle_status=False,
    fields=[
        FieldDef("name", "Display Name", hidden=True),
        FieldDef("asset_id", "Asset", "reference",
                 reference_entity="asset", required=True),
        FieldDef("entity_type", "Entity Type", "text", required=True,
                 help_text="Open-ended — any entity name."),
        FieldDef("entity_id", "Entity ID", "integer", required=True),
        FieldDef("relationship_type", "Relationship Type", "select", options=[
            "reference", "documentation", "concept", "inspiration", "final", "other"
        ]),
        FieldDef("notes", "Notes", "textarea"),
    ],
))


# =============================================================================
# Utility functions
# =============================================================================

def get_entity(name: str) -> EntityDef | None:
    """Get an entity definition by name."""
    return ENTITY_REGISTRY.get(name)


def get_all_entities() -> dict[str, EntityDef]:
    """Get all registered entities as a name-keyed dict.

    Returns the registry itself so callers can iterate name/def pairs via
    ``.items()`` or look up by name directly. For sort-ordered iteration
    use ``get_entities_by_category()``, ``get_entities_in_tier()``, or
    sort ``.values()`` explicitly. This signature matches the codebase
    contract used by ``database.py``, ``main.py``, and ``screenplay_db.py``.
    """
    return ENTITY_REGISTRY


def get_entities_by_category() -> dict[str, list[EntityDef]]:
    """Group entities by category, preserving sort order within each category."""
    by_category: dict[str, list[EntityDef]] = {}
    for entity in sorted(
        ENTITY_REGISTRY.values(),
        key=lambda e: (e.tier, e.sort_order, e.name),
    ):
        by_category.setdefault(entity.category, []).append(entity)
    return by_category


def get_versionable_entities() -> list[EntityDef]:
    """All entities that participate in version chains."""
    return [e for e in ENTITY_REGISTRY.values() if e.versionable]


def get_entities_with_external_id() -> list[EntityDef]:
    """All entities that may bridge to external systems via external_id."""
    return [e for e in ENTITY_REGISTRY.values() if e.has_external_id]


def get_entities_in_tier(tier: int) -> list[EntityDef]:
    """All entities at a given tier (0–6)."""
    return [e for e in ENTITY_REGISTRY.values() if e.tier == tier]


def get_junction_entities() -> list[EntityDef]:
    """All Tier 0 Connections entities (junctions)."""
    return [e for e in ENTITY_REGISTRY.values() if e.category == "Connections"]


# =============================================================================
# ONTOLOGY (Phase A) — subject / scope / refines / queries for every entity.
#
# Kept as one table (rather than inline per-block) so the whole classification
# is reviewable at a glance. Applied post-registration; lint_ontology()
# enforces completeness and the Rule (every entity serves >= 1 canonical
# query). See conventions.md "Ontology metadata" and
# docs/design/20260713_SCF_Canonical_Queries.md.
#
# Format: name: (subject, scope, queries) — plus PAIRED and REFINES below.
# =============================================================================

SUBJECTS = {"character", "location", "prop", "scene", "shot", "project",
            "story", "theme", "link", "meta"}
SCOPES = {"global", "act", "sequence", "scene", "shot", "moment"}

ONTOLOGY: dict[str, tuple[str, str, list[str]]] = {
    # --- Tier 0: structural spine -------------------------------------------
    "project":                 ("project",   "global",  ["Q00"]),
    "character":               ("character", "global",  ["Q01", "Q02"]),
    "location":                ("location",  "global",  ["Q01", "Q02"]),
    "prop":                    ("prop",      "global",  ["Q01", "Q02"]),
    "act":                     ("story",     "act",     ["Q04", "Q10"]),
    "sequence":                ("story",     "sequence",["Q04", "Q10"]),
    "scene":                   ("scene",     "scene",   ["Q03", "Q04"]),
    "story_beat":              ("story",     "scene",   ["Q04", "Q10"]),
    "theme":                   ("theme",     "global",  ["Q00", "Q10"]),
    # --- Tier 0: connections -------------------------------------------------
    "scene_character":         ("link",      "scene",   ["Q02", "Q03", "Q04"]),
    "scene_prop":              ("link",      "scene",   ["Q03", "Q04"]),
    "scene_sequence":          ("link",      "scene",   ["Q04"]),
    "costume_scene":           ("link",      "scene",   ["Q02", "Q12"]),
    "bundle_asset":            ("link",      "global",  ["Q13"]),
    "actor_character_role":    ("link",      "global",  ["Q13"]),
    "take_scene":              ("link",      "scene",   ["Q13"]),
    "clip_character":          ("link",      "global",  ["Q13"]),
    "clip_prop":               ("link",      "global",  ["Q13"]),
    "motif_appearance":        ("link",      "scene",   ["Q08", "Q09"]),
    "action_sequence_character": ("link",    "scene",   ["Q06"]),
    "asset_relationship":      ("link",      "global",  ["Q13"]),
    # --- Tier 0: metadata -----------------------------------------------------
    "creative_decision":       ("meta",      "global",  ["Q15"]),
    "collaboration_note":      ("meta",      "global",  ["Q15"]),
    "asset":                   ("meta",      "global",  ["Q13"]),
    # --- Tier 1: creative direction (direction-cascade roots) ----------------
    "project_vision":          ("project",   "global",  ["Q00"]),
    "technical_specs":         ("project",   "global",  ["Q00", "Q13"]),
    "visual_identity":         ("project",   "global",  ["Q00", "Q07"]),
    "cinematographic_philosophy": ("project","global",  ["Q00", "Q07"]),
    "project_color_palette":   ("project",   "global",  ["Q00", "Q07"]),
    "project_tone":            ("project",   "global",  ["Q00", "Q11"]),
    "sonic_identity":          ("project",   "global",  ["Q00", "Q08"]),
    "look_development":        ("project",   "global",  ["Q00", "Q07"]),
    "costume_design_philosophy": ("project", "global",  ["Q00", "Q02"]),
    # --- Tier 2: character depth ---------------------------------------------
    "character_relationship":  ("character", "global",  ["Q01", "Q02", "Q03", "Q12"]),
    "relationship_state":      ("character", "scene",   ["Q02", "Q03", "Q12"]),
    "physical_character_profile": ("character","global",["Q01", "Q02", "Q06"]),
    "vocal_profile":           ("character", "global",  ["Q01", "Q05"]),
    "character_appearance_profile": ("character","global",["Q01", "Q02", "Q07"]),
    "costume":                 ("character", "global",  ["Q01", "Q02", "Q12"]),
    "costume_progression":     ("character", "global",  ["Q02", "Q12"]),
    "makeup_hair_design":      ("character", "scene",   ["Q02", "Q07"]),
    "character_variant":       ("character", "global",  ["Q02", "Q13"]),
    "physical_habit":          ("character", "global",  ["Q01", "Q06"]),
    # --- Tier 2: prop / location depth ---------------------------------------
    "prop_surface_profile":    ("prop",      "global",  ["Q01", "Q07"]),
    "prop_variant":            ("prop",      "global",  ["Q02", "Q12", "Q13"]),
    "prop_state":              ("prop",      "scene",   ["Q03", "Q12"]),
    "location_design":         ("location",  "global",  ["Q01", "Q07"]),
    "location_variant":        ("location",  "global",  ["Q02", "Q04", "Q13"]),
    "location_color_scheme":   ("location",  "global",  ["Q07"]),
    "location_sound_profile":  ("location",  "global",  ["Q08"]),
    # --- Tier 2: asset reference / performance corpus / workflow -------------
    "bundle":                  ("meta",      "global",  ["Q13"]),
    "character_asset_binding": ("character", "scene",   ["Q13"]),
    "prop_asset_binding":      ("prop",      "scene",   ["Q13"]),
    "location_asset_binding":  ("location",  "scene",   ["Q13"]),
    "entity_anchor":           ("meta",      "global",  ["Q13"]),
    "performance_corpus":      ("meta",      "global",  ["Q13"]),
    "actor":                   ("meta",      "global",  ["Q13"]),
    "take":                    ("meta",      "shot",    ["Q13"]),
    "clip":                    ("meta",      "moment",  ["Q13"]),
    "shot_coverage":           ("shot",      "shot",    ["Q13", "Q14"]),
    "character_shot_override": ("character", "shot",    ["Q13"]),
    "prop_shot_override":      ("prop",      "shot",    ["Q13"]),
    "location_shot_override":  ("location",  "shot",    ["Q13"]),
    # --- Tier 3: scene detail (direction-cascade scene layer) ----------------
    "scene_emotional_target":  ("scene",     "scene",   ["Q04", "Q11"]),
    "scene_color_palette":     ("scene",     "scene",   ["Q04", "Q07"]),
    "lighting_design":         ("scene",     "shot",    ["Q04", "Q07"]),
    "scene_music_design":      ("scene",     "scene",   ["Q04", "Q08"]),
    "tone_marker":             ("scene",     "scene",   ["Q11"]),
    "set_dressing":            ("scene",     "scene",   ["Q04", "Q07"]),
    "dialogue_sound_design":   ("scene",     "scene",   ["Q05", "Q08"]),
    # --- Tier 4: thematic tracking --------------------------------------------
    "character_color_identity": ("character","global",  ["Q07", "Q09"]),
    "motif":                   ("theme",     "global",  ["Q09", "Q10"]),
    "motif_state":             ("theme",     "scene",   ["Q09", "Q10"]),
    "subtext":                 ("scene",     "scene",   ["Q05", "Q10", "Q11"]),
    "thematic_connection":     ("link",      "global",  ["Q10"]),
    "color_symbolism":         ("project",   "global",  ["Q07", "Q09"]),
    "color_script":            ("project",   "global",  ["Q07"]),  # prose summary; rows live in color_script_entry
    "color_script_entry":      ("project",   "scene",   ["Q07"]),
    # --- Tier 5: audience state ------------------------------------------------
    "emotional_arc":           ("story",     "global",  ["Q11"]),
    "emotional_beat":          ("story",     "scene",   ["Q11"]),
    "information_strategy":    ("story",     "scene",   ["Q11"]),
    "identification_strategy": ("story",     "scene",   ["Q11"]),
    # --- Tier 6: production -----------------------------------------------------
    "shot":                    ("shot",      "shot",    ["Q07", "Q13"]),
    "shot_design":             ("shot",      "shot",    ["Q07"]),
    "shot_language":           ("scene",     "scene",   ["Q07"]),
    "scene_blocking":          ("scene",     "scene",   ["Q04", "Q06"]),
    "staging_beat":            ("scene",     "moment",  ["Q06"]),
    "action_sequence":         ("scene",     "scene",   ["Q06"]),
    "performance_state":       ("character", "shot",    ["Q02", "Q03", "Q05", "Q06", "Q12"]),
    "performance_beat":        ("character", "moment",  ["Q05", "Q06"]),
    "dialogue_rhythm":         ("scene",     "scene",   ["Q05"]),
    "character_environment_physicality": ("character","global", ["Q02", "Q06"]),
    "movement_choreography":   ("scene",     "scene",   ["Q06"]),
    "musical_theme":           ("project",   "global",  ["Q08"]),
    "sound_cue":               ("scene",     "shot",    ["Q08"]),
    "music_cue":               ("scene",     "scene",   ["Q08"]),
    "sound_perspective":       ("scene",     "scene",   ["Q05", "Q08"]),
    "voiceover_design":        ("scene",     "scene",   ["Q05", "Q08"]),
    "music_sound_relationship": ("scene",    "scene",   ["Q08"]),
}

# Entities describing a *pair* of their subject.
PAIRED = {"character_relationship", "relationship_state"}

# Position-keying pattern per entity (pattern names: conventions.md,
# "Persistence and position"). Entities absent here default to "none".
POSITION_PATTERNS: dict[str, str] = {
    "costume_scene": "explicit",
    "performance_state": "sparse_persistence",
    "relationship_state": "latest_wins",
    "prop_state": "latest_wins",
    "motif_state": "latest_wins",
    "color_script_entry": "latest_wins",
}
POSITION_PATTERN_VALUES = {"none", "explicit", "sparse_persistence",
                           "latest_wins"}

# Direction-cascade parents (most-specific entity lists what it refines;
# resolver walks upward). See docs/design/20260714_SCF_Gap_Roadmap.md G3.
REFINES: dict[str, list[str]] = {
    "color_script":            ["project_color_palette"],
    "color_script_entry":      ["color_script"],
    "scene_color_palette":     ["color_script_entry"],
    "location_color_scheme":   ["project_color_palette"],
    "lighting_design":         ["look_development"],
    "scene_music_design":      ["sonic_identity"],
    "dialogue_sound_design":   ["sonic_identity"],
    "location_sound_profile":  ["sonic_identity"],
    "scene_emotional_target":  ["project_tone"],
    "tone_marker":             ["project_tone"],
    "shot_design":             ["scene_color_palette", "lighting_design"],
    "shot_language":           ["cinematographic_philosophy"],
}


def _apply_ontology() -> None:
    for name, (subject, scope, queries) in ONTOLOGY.items():
        e = ENTITY_REGISTRY.get(name)
        if e is None:
            continue
        e.subject, e.scope, e.queries = subject, scope, list(queries)
        e.paired = name in PAIRED
        e.position_pattern = POSITION_PATTERNS.get(name, "none")
        e.refines = list(REFINES.get(name, []))


def lint_ontology() -> list[str]:
    """Enforce Phase A invariants. Returns a list of problems (empty = clean).

    - every registered entity is classified (and no stale classifications)
    - subject/scope values are members of their enums
    - queries is non-empty (the Rule: every entity serves >= 1 canonical query)
    - refines targets exist and are themselves classified
    """
    problems: list[str] = []
    for name in ENTITY_REGISTRY:
        if name not in ONTOLOGY:
            problems.append(f"unclassified entity: {name}")
    for name in ONTOLOGY:
        if name not in ENTITY_REGISTRY:
            problems.append(f"stale classification (no such entity): {name}")
    for name, (subject, scope, queries) in ONTOLOGY.items():
        if subject not in SUBJECTS:
            problems.append(f"{name}: bad subject {subject!r}")
        if scope not in SCOPES:
            problems.append(f"{name}: bad scope {scope!r}")
        if not queries:
            problems.append(f"{name}: serves no canonical query (the Rule)")
    for name, parents in REFINES.items():
        for p in parents:
            if p not in ENTITY_REGISTRY:
                problems.append(f"{name}: refines unknown entity {p!r}")
    for name, pattern in POSITION_PATTERNS.items():
        if name not in ENTITY_REGISTRY:
            problems.append(f"stale position pattern: {name}")
        if pattern not in POSITION_PATTERN_VALUES:
            problems.append(f"{name}: bad position_pattern {pattern!r}")
    return problems


_apply_ontology()
