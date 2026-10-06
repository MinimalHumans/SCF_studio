// SPDX-License-Identifier: Apache-2.0
import { useEffect, useState } from "react";
import type { Row } from "@scf-core/db.ts";
import { exec, registry, useStore } from "../../state/store.ts";
import {
  addVariant, castActor, cleanName, loadProfile, reassignActor,
  type CharacterProfile,
} from "../../editor/elementOps.ts";
import { useQuery } from "../useQuery.ts";
import { AutoField } from "./AutoField.tsx";
import { PROFILE_SECTIONS } from "../../state/characterLayout.ts";

const NOTES = "notes";

export function ProfileTab({ characterId }: {
  characterId: number;
}): JSX.Element {
  const revision = useStore((s) => s.revision);
  const [profile, setProfile] = useState<CharacterProfile | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadProfile(exec, characterId).then((p) => {
      if (!cancelled) setProfile(p);
    });
    return () => { cancelled = true; };
  }, [characterId, revision]);

  if (profile === null) return <p className="muted">Loading…</p>;
  const c = profile.character;
  const fieldOf = (name: string): JSX.Element => (
    <AutoField key={name} entity="character" id={characterId} field={name}
               value={c[name] ?? null} />
  );
  const exists = (name: string): boolean =>
    registry.entities.get("character")?.fields
      .some((f) => f.name === name) ?? false;

  return (
    <div className="ws-page">
      {PROFILE_SECTIONS.map((s) => (
        <section key={s.title} className="ws-section"
                 aria-labelledby={`ws-s-${s.title}`}>
          <h3 id={`ws-s-${s.title}`}>{s.title}</h3>
          {s.note !== undefined && <p className="ws-section-note">{s.note}</p>}
          <div className={s.grid === true ? "ws-grid" : "ws-stack"}>
            {s.fields.filter(exists).map(fieldOf)}
          </div>
        </section>
      ))}

      <section className="ws-section" aria-labelledby="ws-s-casting">
        <h3 id="ws-s-casting">Casting</h3>
        <div className="ws-grid">{fieldOf("casting_status")}</div>
        <Casting characterId={characterId} roles={profile.roles} />
      </section>

      <section className="ws-section" aria-labelledby="ws-s-variants">
        <h3 id="ws-s-variants">Variants</h3>
        <p className="ws-section-note">
          Other versions of this character that are cast, dressed or built
          separately — younger, disguised, transformed. A scene says which
          version appears.
        </p>
        <Variants characterId={characterId} variants={profile.variants} />
      </section>

      <section className="ws-section" aria-labelledby="ws-s-notes">
        <h3 id="ws-s-notes">Notes</h3>
        <div className="ws-stack">{fieldOf(NOTES)}</div>
      </section>
    </div>
  );
}

/** Who plays them: one name to type, an actor and a role underneath. */
function Casting({ characterId, roles }: {
  characterId: number; roles: CharacterProfile["roles"];
}): JSX.Element {
  const { deleteRow, openEntityRow } = useStore();
  const actors = useQuery("SELECT name FROM actor ORDER BY name");
  const [adding, setAdding] = useState("");
  const [roleType, setRoleType] = useState("principal");
  const roleTypes = registry.entities.get("actor_character_role")?.fields
    .find((f) => f.name === "role_type")?.options ?? ["principal"];

  const fail = (what: string, e: unknown): void =>
    useStore.setState({ errorMessage: `${what}: ${
      e instanceof Error ? e.message : String(e)}` });

  return (
    <div className="ws-casting">
      <datalist id="ws-actor-names">
        {actors.map((a) => (
          <option key={String(a["name"])} value={String(a["name"])} />
        ))}
      </datalist>
      {roles.length > 0 && (
        <ul className="ws-roles">
          {roles.map(({ role, actorName }) => {
            const roleId = Number(role["id"]);
            return (
              <li key={roleId} className="ws-role">
                <ActorName roleId={roleId} value={actorName} onError={fail} />
                <AutoField entity="actor_character_role" id={roleId}
                           field="role_type" value={role["role_type"] ?? null}
                           label="As" showHelp={false} />
                <AutoField entity="actor_character_role" id={roleId}
                           field="scope" value={role["scope"] ?? null}
                           label="For" showHelp={false} />
                <div className="ws-row-actions">
                  <button className="ghost tiny"
                          onClick={() => void openEntityRow(
                            "actor_character_role", roleId)}>
                    Open record
                  </button>
                  <button className="ghost tiny"
                          onClick={() => void deleteRow(
                            "actor_character_role", roleId)}>
                    Remove
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <form className="ws-add-row"
            onSubmit={(e) => {
              e.preventDefault();
              if (cleanName(adding) === null) return;
              castActor(exec, characterId, adding, roleType).then(() => {
                useStore.getState().noteWrite();
                setAdding("");
              }).catch((err: unknown) => fail("Could not cast", err));
            }}>
        <label htmlFor="ws-add-actor" className="visually-hidden">
          Actor's name
        </label>
        <input id="ws-add-actor" list="ws-actor-names" value={adding}
               placeholder={roles.length === 0
                 ? "Who plays them? Type a name"
                 : "Add another performer"}
               onChange={(e) => setAdding(e.target.value)} />
        <select aria-label="Role" value={roleType}
                onChange={(e) => setRoleType(e.target.value)}>
          {roleTypes.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        <button type="submit" disabled={cleanName(adding) === null}>
          Cast
        </button>
      </form>
    </div>
  );
}

/**
 * The actor's name on a role. Retyping it points the role at another
 * actor — matched by name, or new — and never renames the actor, who
 * may also be someone else's double.
 */
function ActorName({ roleId, value, onError }: {
  roleId: number; value: string | null;
  onError: (what: string, e: unknown) => void;
}): JSX.Element {
  const [text, setText] = useState(value ?? "");
  useEffect(() => { setText(value ?? ""); }, [value]);
  const commit = (): void => {
    const clean = cleanName(text);
    if (clean === null || clean === value) {
      setText(value ?? "");
      return;
    }
    reassignActor(exec, roleId, clean).then(() => {
      useStore.getState().noteWrite();
    }).catch((e: unknown) => onError("Could not change the actor", e));
  };
  const id = `ws-role-actor-${String(roleId)}`;
  return (
    <div className="ws-field">
      <label htmlFor={id}>Actor</label>
      <input id={id} list="ws-actor-names" value={text}
             onChange={(e) => setText(e.target.value)}
             onBlur={commit}
             onKeyDown={(e) => { if (e.key === "Enter") commit(); }} />
    </div>
  );
}

function Variants({ characterId, variants }: {
  characterId: number; variants: Row[];
}): JSX.Element {
  const { deleteRow, openEntityRow } = useStore();
  const [name, setName] = useState("");
  // How many scenes name each variant, so a card says whether it is used.
  const uses = useQuery(
    "SELECT variant_id, COUNT(DISTINCT scene_id) AS n FROM scene_character " +
    "WHERE character_id = ? AND variant_id IS NOT NULL GROUP BY variant_id",
    [characterId]);
  const sceneCount = (id: number): number =>
    Number(uses.find((u) => Number(u["variant_id"]) === id)?.["n"] ?? 0);

  return (
    <div className="ws-variants">
      {variants.map((v) => {
        const id = Number(v["id"]);
        const n = sceneCount(id);
        return (
          <article key={id} className="ws-card">
            <div className="ws-card-head">
              <AutoField entity="character_variant" id={id} field="name"
                         value={v["name"] ?? null} label="Variant" />
              <span className="ws-card-meta">
                {n === 0 ? "Not in any scene yet"
                  : `Appears in ${String(n)} scene${n === 1 ? "" : "s"}`}
              </span>
            </div>
            <div className="ws-stack">
              {["physical_differences", "emotional_state", "context"]
                .map((f) => (
                  <AutoField key={f} entity="character_variant" id={id}
                             field={f} value={v[f] ?? null}
                             showHelp={false} />
                ))}
            </div>
            <div className="ws-row-actions">
              <button className="ghost tiny"
                      onClick={() => void openEntityRow("character_variant", id)}>
                Open record
              </button>
              <button className="ghost tiny"
                      onClick={() => void deleteRow("character_variant", id)}>
                Remove
              </button>
            </div>
          </article>
        );
      })}
      <form className="ws-add-row"
            onSubmit={(e) => {
              e.preventDefault();
              if (cleanName(name) === null) return;
              addVariant(exec, characterId, name).then(() => {
                useStore.getState().noteWrite();
                setName("");
              }).catch((err: unknown) => useStore.setState({
                errorMessage: `Could not add the variant: ${
                  err instanceof Error ? err.message : String(err)}` }));
            }}>
        <label htmlFor="ws-add-variant" className="visually-hidden">
          Variant name
        </label>
        <input id="ws-add-variant" value={name}
               placeholder="Name a variant, e.g. “Eleanor at twenty”"
               onChange={(e) => setName(e.target.value)} />
        <button type="submit" disabled={cleanName(name) === null}>
          Add variant
        </button>
      </form>
    </div>
  );
}
