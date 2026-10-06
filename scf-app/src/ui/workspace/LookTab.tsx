// SPDX-License-Identifier: Apache-2.0
import { useQuery } from "../useQuery.ts";
import { ProfileRowFields } from "./ProfileRowFields.tsx";
import { ReferenceBoard } from "./ReferenceBoard.tsx";

const HEX = /^#?[0-9a-f]{6}$/i;

/** What they look like: references first, then the words. */
export function LookTab({ characterId }: { characterId: number }):
    JSX.Element {
  const color = useQuery(
    "SELECT primary_color_hex FROM character_color_identity " +
    "WHERE character_id = ? ORDER BY id LIMIT 1", [characterId])[0];
  const hex = typeof color?.["primary_color_hex"] === "string" &&
    HEX.test(color["primary_color_hex"])
    ? `#${color["primary_color_hex"].replace("#", "")}` : null;
  return (
    <div className="ws-page">
      <section className="ws-section" aria-labelledby="ws-s-board">
        <h3 id="ws-s-board">Reference board</h3>
        <p className="ws-section-note">
          Point at images and video, and say what each one is for.
        </p>
        <ReferenceBoard characterId={characterId} board="look" />
      </section>

      <section className="ws-section" aria-labelledby="ws-s-appearance">
        <h3 id="ws-s-appearance">Appearance</h3>
        <ProfileRowFields entity="character_appearance_profile"
                          characterId={characterId}
                          gridTabs={["General", "Appearance"]}
                          titles={{ General: "Body and features",
                                    Appearance: "Skin and grooming",
                                    Identity: "Design",
                                    Evolution: "How it changes",
                                    Notes: "Notes" }} />
      </section>

      <section className="ws-section" aria-labelledby="ws-s-color">
        <div className="strip-head">
          <h3 id="ws-s-color">Color identity</h3>
          {hex !== null && (
            <span className="ws-swatch" style={{ background: hex }}
                  title={`Primary color ${hex}`} />
          )}
        </div>
        <ProfileRowFields entity="character_color_identity"
                          characterId={characterId}
                          gridTabs={["General", "Evolution"]}
                          titles={{ General: "Colors",
                                    Evolution: "Through the story" }} />
      </section>
    </div>
  );
}
