import { useStore } from "../store";

// Mixed keyboard + pointer affordances (Click / Drag included) because the
// in-app reference is "what can I do in annotate mode," not strictly
// physical-key bindings. Matches the CLI HELP convention.
const ROWS: { label: string; keys: string[] }[] = [
  { label: "Toggle annotate mode", keys: ["E"] },
  { label: "Drop a pin on element", keys: ["Click"] },
  { label: "Highlight text + annotate", keys: ["Drag"] },
  { label: "Add a general note", keys: ["N"] },
  { label: "Walk annotations", keys: ["J", "K"] },
  { label: "Delete selected", keys: ["Del"] },
  { label: "Save composer", keys: ["↵"] },
  { label: "Newline in composer", keys: ["⇧", "↵"] },
  { label: "Copy notes for chat", keys: ["⌘", "↵"] },
  { label: "Close / exit mode", keys: ["Esc"] },
  { label: "Command palette", keys: ["⌘", "K"] },
  { label: "Show / hide this", keys: ["?"] },
];

export function ShortcutsModal() {
  const show = useStore((s) => s.showShortcuts);
  const close = useStore((s) => s.toggleShortcuts);
  if (!show) return null;
  return (
    <div className="scrim" onClick={close}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="shortcuts">
          <h3>Keyboard</h3>
          {ROWS.map((r) => (
            <div className="shortcuts-row" key={r.label}>
              <span>{r.label}</span>
              <span className="keys">
                {r.keys.map((k) => (
                  <span className="kbd" key={k}>
                    {k}
                  </span>
                ))}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
