// SPDX-License-Identifier: Apache-2.0
import { useLayoutEffect } from "react";
import {
  CHARACTER_TABS, useStore, type CharacterTab,
} from "../../state/store.ts";
import { useQuery } from "../useQuery.ts";
import { AutoField } from "./AutoField.tsx";
import { CharacterFace } from "./CharacterFace.tsx";
import { ProfileTab } from "./ProfileTab.tsx";
import { PendingTab } from "./PendingTab.tsx";

/** Where each character's tab was scrolled to, so "open record" and
 *  back lands where the writer was. Per session; not worth persisting. */
const scrollMemory = new Map<string, number>();

/**
 * The Characters workspace: everything about one character, in tabs
 * ordered from who they are to where they are in the film.
 *
 * Each tab writes ordinary SCF rows as the writer works. "Open record"
 * is always there for the raw row; Close in the record editor returns
 * here, to the same character, tab and scroll position.
 */
export function CharacterWorkspace(): JSX.Element {
  const { selectedCharacterId, characterTab, setCharacterTab,
          openEntityRow } = useStore();
  const count = useQuery("SELECT COUNT(*) AS n FROM character");
  const row = useQuery(
    selectedCharacterId === null ? null
      : "SELECT id, name, role, casting_status, lifecycle_status " +
        "FROM character WHERE id = ?",
    selectedCharacterId === null ? [] : [selectedCharacterId])[0];
  const variants = useQuery(
    selectedCharacterId === null ? null
      : "SELECT id, name FROM character_variant WHERE character_id = ? " +
        "AND (lifecycle_status IS NULL OR lifecycle_status <> 'cut') " +
        "ORDER BY id",
    selectedCharacterId === null ? [] : [selectedCharacterId]);

  const memoryKey = `${String(selectedCharacterId)}:${characterTab}`;
  useLayoutEffect(() => {
    const pane = document.querySelector(".main-panel");
    if (pane === null) return;
    pane.scrollTop = scrollMemory.get(memoryKey) ?? 0;
    const remember = (): void => {
      scrollMemory.set(memoryKey, pane.scrollTop);
    };
    pane.addEventListener("scroll", remember, { passive: true });
    return () => pane.removeEventListener("scroll", remember);
  }, [memoryKey]);

  if (selectedCharacterId === null || row === undefined) {
    const none = Number(count[0]?.["n"] ?? 0) === 0;
    return (
      <div className="empty-main">
        <p>
          {none
            ? "No characters yet. Use New character to make one, or " +
              "write a scene — the characters you link from the script " +
              "show up here."
            : "Pick a character on the left, or make a new one."}
        </p>
      </div>
    );
  }

  const id = selectedCharacterId;
  // Values are shown as words, not tokens: "Casting: digital double",
  // not "Casting Status: digital_double".
  const words = (v: unknown): string | null =>
    v === null || v === undefined || v === ""
      ? null : String(v).replace(/_/g, " ");
  const casting = words(row["casting_status"]);
  const chips = [
    words(row["role"]),
    casting === null ? null : `Casting: ${casting}`,
  ].filter((c): c is string => c !== null);

  return (
    <div className="ws">
      <header className="ws-header">
        <CharacterFace id={id} name={String(row["name"] ?? "")} size="md" />
        <div className="ws-header-main">
          <div className="ws-name">
            <AutoField key={`name-${String(id)}`} entity="character" id={id}
                       field="name" value={row["name"] ?? null}
                       label="Character name" showHelp={false} />
          </div>
          <div className="ws-chips">
            {row["lifecycle_status"] === "cut" && (
              <span className="ws-chip ws-chip-cut">cut</span>
            )}
            {chips.map((c) => <span key={c} className="ws-chip">{c}</span>)}
            {variants.map((v) => (
              <span key={String(v["id"])} className="ws-chip ws-chip-variant"
                    title="A variant of this character">
                {String(v["name"])}
              </span>
            ))}
          </div>
        </div>
        <button className="ghost tiny ws-open-record"
                onClick={() => void openEntityRow("character", id)}>
          Open record
        </button>
      </header>

      <div className="ws-tabs" role="tablist" aria-label="Character">
        {CHARACTER_TABS.map((t) => (
          <button key={t} role="tab" aria-selected={t === characterTab}
                  className={t === characterTab ? "active" : ""}
                  onClick={() => setCharacterTab(t)}>
            {t}
          </button>
        ))}
      </div>

      <div role="tabpanel" aria-label={characterTab}>
        {characterTab === "Profile"
          ? <ProfileTab key={id} characterId={id} />
          : <PendingTab key={`${String(id)}:${characterTab}`}
                        tab={characterTab as CharacterTab} characterId={id} />}
      </div>
    </div>
  );
}
