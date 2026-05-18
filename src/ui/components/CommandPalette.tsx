import { useMemo, useState } from "react";
import { useStore } from "../store";

type Cmd = {
  id: string;
  label: string;
  desc?: string;
  run: () => void;
};

export function CommandPalette() {
  const show = useStore((s) => s.showPalette);
  const close = useStore((s) => s.togglePalette);
  const mode = useStore((s) => s.mode);
  const setMode = useStore((s) => s.setMode);
  const beginFreeformDraft = useStore((s) => s.beginFreeformDraft);
  const draft = useStore((s) => s.draft);
  const copyToClipboard = useStore((s) => s.copyToClipboard);
  const clearAll = useStore((s) => s.clearAll);
  const toggleShortcuts = useStore((s) => s.toggleShortcuts);

  const [q, setQ] = useState("");
  const [i, setI] = useState(0);

  const cmds = useMemo<Cmd[]>(
    () => [
      {
        id: "ann",
        label: mode === "annotate" ? "Exit annotate mode" : "Enter annotate mode",
        desc: "E",
        run: () => setMode(mode === "annotate" ? "preview" : "annotate"),
      },
      {
        id: "note",
        label: "Add a general note",
        desc: "N",
        run: () => {
          if (!draft) beginFreeformDraft();
        },
      },
      {
        id: "kbd",
        label: "Keyboard shortcuts",
        desc: "?",
        run: () => toggleShortcuts(),
      },
      {
        id: "copy",
        label: "Copy notes for chat",
        desc: "⌘↵",
        run: () => copyToClipboard(),
      },
      {
        id: "clear",
        label: "Clear all annotations",
        run: () => clearAll(),
      },
    ],
    [mode, draft, setMode, beginFreeformDraft, copyToClipboard, clearAll, toggleShortcuts],
  );

  const filtered = q.trim()
    ? cmds.filter((c) =>
        (c.label + (c.desc ?? "")).toLowerCase().includes(q.toLowerCase()),
      )
    : cmds;

  if (!show) return null;

  return (
    <div className="scrim" onClick={close}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <input
          autoFocus
          className="palette-input"
          placeholder="Search commands…"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setI(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setI((x) => Math.min(filtered.length - 1, x + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setI((x) => Math.max(0, x - 1));
            } else if (e.key === "Enter") {
              e.preventDefault();
              const c = filtered[i];
              if (c) {
                c.run();
                close();
              }
            } else if (e.key === "Escape") {
              e.preventDefault();
              close();
            }
          }}
        />
        <div className="palette-list">
          {filtered.length === 0 && (
            <div className="palette-item">
              <span className="faint">No matches.</span>
            </div>
          )}
          {filtered.map((c, idx) => (
            <div
              key={c.id}
              className="palette-item"
              aria-selected={i === idx}
              onMouseEnter={() => setI(idx)}
              onClick={() => {
                c.run();
                close();
              }}
            >
              <span>{c.label}</span>
              {c.desc && <span className="desc mono">{c.desc}</span>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
