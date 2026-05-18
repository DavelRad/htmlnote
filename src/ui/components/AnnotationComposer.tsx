import { useEffect, useRef } from "react";
import { useStore } from "../store";

type Props = { x: number; y: number };

export function AnnotationComposer({ x, y }: Props) {
  const draft = useStore((s) => s.draft);
  const update = useStore((s) => s.updateDraft);
  const commit = useStore((s) => s.commitDraft);
  const cancel = useStore((s) => s.cancelDraft);
  // Subscribe to length so the "what will my number be" preview stays correct
  // if another annotation gets committed while this composer is open.
  const number = useStore((s) => (s.session?.annotations.length ?? 0) + 1);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    ref.current?.focus();
  }, []);

  if (!draft || !draft.target) return null;
  const target = draft.target;

  return (
    <div className="composer" style={{ left: x, top: y }}>
      <div className="composer-head">
        <span>
          <span className="num">{number}</span>
          <code className="mono">{target.selector}</code>
        </span>
        <button
          className="btn-ghost"
          onClick={cancel}
          style={{ fontSize: 11 }}
          title="Cancel (Esc)"
        >
          ✕
        </button>
      </div>
      {target.kind === "text" && (
        <div className="composer-quote">“{target.quotedText}”</div>
      )}
      <textarea
        ref={ref}
        placeholder={
          target.kind === "text"
            ? "What's wrong with this text?"
            : "What needs to change here?"
        }
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
      <div className="composer-foot">
        <span className="hint">
          <span className="kbd">↵</span>
          <span style={{ marginLeft: 6 }}>save</span>
          <span className="kbd" style={{ marginLeft: 10 }}>⇧</span>
          <span className="kbd" style={{ marginLeft: 2 }}>↵</span>
          <span style={{ marginLeft: 6 }}>newline</span>
          <span style={{ marginLeft: 10 }} className="kbd">Esc</span>
          <span style={{ marginLeft: 6 }}>cancel</span>
        </span>
        <div>
          <button className="btn btn-ghost" onClick={cancel}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={commit}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
