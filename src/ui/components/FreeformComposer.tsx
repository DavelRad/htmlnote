import { useEffect, useRef } from "react";
import { useStore } from "../store";

export function FreeformComposer() {
  const draft = useStore((s) => s.draft);
  const update = useStore((s) => s.updateDraft);
  const commit = useStore((s) => s.commitDraft);
  const cancel = useStore((s) => s.cancelDraft);
  const ref = useRef<HTMLTextAreaElement>(null);
  const isOpen = !!draft && draft.target === null;

  // Focus on every open — this component lives in the tree even when closed,
  // so an empty-deps effect would only fire on initial app mount (before the
  // textarea exists). Keyed off isOpen so each N press re-focuses cleanly.
  useEffect(() => {
    if (isOpen) ref.current?.focus();
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="scrim" onClick={cancel}>
      <div className="modal freeform" onClick={(e) => e.stopPropagation()}>
        <div className="freeform-head">General note</div>
        <textarea
          ref={ref}
          placeholder="What's on your mind about this page?"
          value={draft.comment}
          onChange={(e) => update(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              cancel();
            } else if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              e.stopPropagation();
              commit();
            }
          }}
        />
        <div className="freeform-foot">
          <span className="hint mono">
            <span className="kbd">↵</span>
            <span style={{ marginLeft: 6 }}>save</span>
            <span className="kbd" style={{ marginLeft: 10 }}>⇧</span>
            <span className="kbd" style={{ marginLeft: 2 }}>↵</span>
            <span style={{ marginLeft: 6 }}>newline</span>
            <span className="kbd" style={{ marginLeft: 10 }}>Esc</span>
            <span style={{ marginLeft: 6 }}>cancel</span>
          </span>
          <div>
            <button className="btn btn-ghost" onClick={cancel}>
              Cancel
            </button>
            <button
              className="btn btn-primary"
              onClick={commit}
              style={{ marginLeft: 4 }}
            >
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
