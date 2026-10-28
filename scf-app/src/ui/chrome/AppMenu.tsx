// SPDX-License-Identifier: Apache-2.0
import { useEffect, useRef, useState } from "react";
import {
  menuModel, runCommand, type CommandContext,
} from "../../commands/registry.ts";

/**
 * The hamburger. A full menu bar will not fit beside the tabs in the
 * title row, so File, View and Help are headed groups in one popup:
 * one click to open it, one to run a command.
 */
export function AppMenu({ ctx }: { ctx: CommandContext }): JSX.Element {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const groups = menuModel(ctx);

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent): void => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", away);
    return () => window.removeEventListener("pointerdown", away);
  }, [open]);

  // Focus the first enabled item when the popup opens, so the keyboard
  // can drive it straight away.
  useEffect(() => {
    if (open) {
      root.current?.querySelector<HTMLButtonElement>(
        "[role=menuitem]:not(:disabled)")?.focus();
    }
  }, [open]);

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === "Escape") {
      setOpen(false);
      root.current?.querySelector<HTMLButtonElement>(".app-menu-button")
        ?.focus();
      return;
    }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const items = [...root.current?.querySelectorAll<HTMLButtonElement>(
      "[role=menuitem]:not(:disabled)") ?? []];
    if (items.length === 0) return;
    e.preventDefault();
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = e.key === "ArrowDown"
      ? (at + 1) % items.length : (at - 1 + items.length) % items.length;
    items[next]?.focus();
  };

  return (
    <div className="app-menu" ref={root} onKeyDown={onKeyDown}>
      <button className="app-menu-button ghost" aria-haspopup="menu"
              aria-expanded={open} aria-label="Menu" title="Menu"
              onClick={() => setOpen((v) => !v)}>
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M2 4h12M2 8h12M2 12h12" stroke="currentColor"
                strokeWidth="1.5" strokeLinecap="round" fill="none" />
        </svg>
      </button>
      {open && (
        <div className="app-menu-popup" role="menu">
          {groups.map((g) => (
            <div key={g.name} role="group" aria-label={g.name}>
              <div className="app-menu-heading">{g.name}</div>
              {g.items.map((item) => (
                <div key={item.id}>
                  {item.separatorBefore && (
                    <div className="app-menu-sep" role="separator" />
                  )}
                  <button role={item.checked ? "menuitemcheckbox"
                                              : "menuitem"}
                          aria-checked={item.checked ? true : undefined}
                          className="app-menu-item"
                          disabled={item.disabled}
                          title={item.hint ?? undefined}
                          onClick={() => {
                            setOpen(false);
                            runCommand(item.id, ctx);
                          }}>
                    <span className="app-menu-check" aria-hidden="true">
                      {item.checked ? "✓" : ""}
                    </span>
                    <span className="app-menu-label">{item.label}</span>
                    {item.hint !== null
                      ? <span className="app-menu-shortcut">{item.hint}</span>
                      : item.shortcut !== null && (
                        <span className="app-menu-shortcut">
                          {item.shortcut}
                        </span>
                      )}
                  </button>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
