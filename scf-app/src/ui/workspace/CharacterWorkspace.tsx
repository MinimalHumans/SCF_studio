// SPDX-License-Identifier: Apache-2.0
import {
  CHARACTER_TABS, useStore, type CharacterTab,
} from "../../state/store.ts";
import { ProfileTab } from "./ProfileTab.tsx";
import { SubjectShell, words } from "./SubjectShell.tsx";
import { PendingTab } from "./PendingTab.tsx";
import { ArcTab } from "./ArcTab.tsx";
import { LookTab } from "./LookTab.tsx";
import { VoiceTab } from "./VoiceTab.tsx";
import { WardrobeTab } from "./WardrobeTab.tsx";
import { PhysicalityTab } from "./PhysicalityTab.tsx";
import { ScenesTab } from "./ScenesTab.tsx";
import { RelationshipsTab } from "./RelationshipsTab.tsx";

/**
 * The Characters workspace: everything about one character, in tabs
 * ordered from who they are to where they are in the film. The frame —
 * header, "as of", subtabs — is SubjectShell, shared with Locations and
 * Props.
 */
export function CharacterWorkspace(): JSX.Element {
  const { selectedCharacterId, characterTab, setCharacterTab } = useStore();
  return (
    <SubjectShell kind="character" id={selectedCharacterId}
                  tabs={CHARACTER_TABS} tab={characterTab}
                  onTab={(t) => setCharacterTab(t as CharacterTab)}
                  empty={"No characters yet. Use New character to make one, " +
                         "or write a scene — the characters you link from the " +
                         "script show up here."}
                  chips={(row) => {
                    const casting = words(row["casting_status"]);
                    return [words(row["role"]),
                            casting === null ? null : `Casting: ${casting}`]
                      .filter((c): c is string => c !== null);
                  }}>
      {(id) => characterTab === "Profile"
        ? <ProfileTab key={id} characterId={id} />
        : characterTab === "Look"
        ? <LookTab key={id} characterId={id} />
        : characterTab === "Scenes & Lines"
        ? <ScenesTab key={id} characterId={id} />
        : characterTab === "Wardrobe"
        ? <WardrobeTab key={id} characterId={id} />
        : characterTab === "Physicality"
        ? <PhysicalityTab key={id} characterId={id} />
        : characterTab === "Voice"
        ? <VoiceTab key={id} characterId={id} />
        : characterTab === "Arc"
        ? <ArcTab key={id} characterId={id} />
        : characterTab === "Relationships"
        ? <RelationshipsTab key={id} characterId={id} />
        : <PendingTab key={`${String(id)}:${characterTab}`}
                      tab={characterTab} characterId={id} />}
    </SubjectShell>
  );
}
