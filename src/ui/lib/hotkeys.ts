import { useEffect, useRef } from "react";

export type HotkeyHandler = (e: KeyboardEvent) => void;

export type Binding = {
  combo: string;
  handler: HotkeyHandler;
};

function matches(e: KeyboardEvent, combo: string): boolean {
  const parts = combo.toLowerCase().split("+");
  const key = parts.pop();
  if (!key) return false;
  const wantMeta = parts.includes("mod") || parts.includes("cmd");
  const wantShift = parts.includes("shift");
  const wantAlt = parts.includes("alt");
  const isMod = e.metaKey || e.ctrlKey;
  if (wantMeta && !isMod) return false;
  if (!wantMeta && isMod) return false;
  if (wantShift !== e.shiftKey) return false;
  if (wantAlt !== e.altKey) return false;
  return e.key.toLowerCase() === key;
}

function isInField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.isContentEditable
  );
}

/**
 * Attach a single window keydown listener, route through latest bindings.
 * The listener is attached once for the lifetime of the host component,
 * not on every render — bindings are read from a ref kept current.
 */
export function useHotkeys(bindings: Binding[]): void {
  const ref = useRef(bindings);
  ref.current = bindings;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // If a React component already handled this event (e.g., a modal's
      // onKeyDown called preventDefault to close itself), don't run any
      // global hotkey for it — otherwise a single Esc could both close the
      // palette and cancel an unrelated draft underneath.
      if (e.defaultPrevented) return;
      const inField = isInField(e.target);
      for (const b of ref.current) {
        if (!matches(e, b.combo)) continue;
        const combo = b.combo.toLowerCase();
        // Inside text fields, only Escape and the command palette fire
        // globally. Everything else (mod+enter especially) is reserved for
        // the field's own onKeyDown — otherwise typing ⌘+Enter in a composer
        // would commit the comment *and* trigger global "Done".
        if (inField && combo !== "escape" && combo !== "mod+k") continue;
        e.preventDefault();
        b.handler(e);
        return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
