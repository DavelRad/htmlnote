import { useEffect, useRef, useState } from "react";
import type { Annotation } from "../../shared/types";
import { sendToBridge } from "../lib/bridge";
import { useStore } from "../store";

type Props = {
  iframe: React.RefObject<HTMLIFrameElement | null>;
};

export function AnnotationPanel({ iframe }: Props) {
  const session = useStore((s) => s.session);
  const selected = useStore((s) => s.selectedId);
  const select = useStore((s) => s.select);
  const remove = useStore((s) => s.remove);
  const updateComment = useStore((s) => s.updateComment);
  const clearAll = useStore((s) => s.clearAll);

  if (!session) return null;
  const list = session.annotations;

  return (
    <aside className="panel">
      <div className="panel-head">
        <span className="panel-title">{list.length} notes</span>
        {list.length > 0 && (
          <ClearAllButton count={list.length} onConfirm={() => clearAll()} />
        )}
      </div>
      <div className="panel-list">
        {list.map((a) => (
          <Item
            key={a.id}
            ann={a}
            selected={selected === a.id}
            onSelect={() => {
              select(a.id);
              if (a.target && iframe.current) {
                // Scroll the outer canvas-wrap (the actual scroller — the
                // iframe is sized to content and has no internal scroll, so
                // postMessage scrollIntoView inside the iframe is a no-op).
                const wrap = iframe.current.closest<HTMLElement>(".canvas-wrap");
                if (wrap) {
                  const iframeTop =
                    iframe.current.getBoundingClientRect().top -
                    wrap.getBoundingClientRect().top +
                    wrap.scrollTop;
                  const ry =
                    a.target.kind === "element"
                      ? a.target.rect.y
                      : a.target.primaryRect.y;
                  const top = Math.max(0, iframeTop + ry - 80);
                  wrap.scrollTo({ top, behavior: "smooth" });
                }
              }
            }}
            onHoverOn={() => {
              // Element-target hover paints the iframe's amber outline via
              // the bridge. Text-target hover relies on the host-side
              // highlight overlay (already on screen) — no bridge needed.
              if (a.target && a.target.kind === "element") {
                sendToBridge(iframe.current, {
                  type: "highlight",
                  selector: a.target.selector,
                });
              }
            }}
            onHoverOff={() => {
              sendToBridge(iframe.current, {
                type: "highlight",
                selector: null,
              });
            }}
            onRemove={() => remove(a.id)}
            onComment={(c) => updateComment(a.id, c)}
            onDeselect={() => select(null)}
          />
        ))}
      </div>
    </aside>
  );
}

function AutoGrowTextarea({
  value,
  onCommit,
  onDeselect,
}: {
  value: string;
  onCommit: (c: string) => void;
  onDeselect: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  // Local draft state so React doesn't fight the typing cursor; commit on
  // blur (matching the previous behavior) so a server roundtrip per keystroke
  // isn't needed.
  const [text, setText] = useState(value);

  // Resize on every value change — covers initial mount with long content
  // AND any later edit. Setting height to "auto" first so scrollHeight
  // reflects the shrunk-to-fit measurement, not the previous taller one.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [text]);

  // Auto-focus when a row becomes selected so the user can keep editing
  // across pins without clicking the textarea each time. Caret to end so
  // they can append immediately rather than insert mid-comment.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    const len = el.value.length;
    el.setSelectionRange(len, len);
    // Run once per mount — re-firing on selection change would re-focus
    // while the user is reading, not just on entry.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <textarea
      ref={ref}
      className="ann-edit"
      value={text}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={(e) => {
        // Match the composer convention: Enter saves, Shift+Enter newline.
        // Blurring is what fires onCommit, so we just delegate.
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          ref.current?.blur();
        }
      }}
      onBlur={(e) => {
        onCommit(text);
        // If the click that's blurring us landed on another annotation row,
        // a pin, or another composer, that click will set its own selection
        // — don't fight it. Anywhere else (topbar, empty space, programmatic
        // blur from Enter) means the user is done editing, so collapse the
        // row back to display state.
        const next = e.relatedTarget as HTMLElement | null;
        if (next?.closest(".ann, .pin, .composer")) return;
        onDeselect();
      }}
      onClick={(e) => e.stopPropagation()}
    />
  );
}

function ClearAllButton({
  count,
  onConfirm,
}: {
  count: number;
  onConfirm: () => void;
}) {
  const [armed, setArmed] = useState(false);
  const timer = useRef<number | null>(null);

  // Disarm after 3s without a second click. Mouseleave also disarms so the
  // confirm state can't linger waiting for an accidental return click.
  useEffect(() => {
    if (!armed) return;
    timer.current = window.setTimeout(() => setArmed(false), 3000);
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [armed]);

  return (
    <button
      className={`btn btn-ghost panel-clear${armed ? " panel-clear--armed" : ""}`}
      onClick={() => {
        if (!armed) {
          setArmed(true);
          return;
        }
        setArmed(false);
        onConfirm();
      }}
      onMouseLeave={() => setArmed(false)}
      title={
        armed
          ? `Click again to delete all ${count} notes`
          : `Delete all ${count} notes`
      }
    >
      {armed ? `Delete ${count}?` : "Clear all"}
    </button>
  );
}

function Item({
  ann,
  selected,
  onSelect,
  onHoverOn,
  onHoverOff,
  onRemove,
  onComment,
  onDeselect,
}: {
  ann: Annotation;
  selected: boolean;
  onSelect: () => void;
  onHoverOn: () => void;
  onHoverOff: () => void;
  onRemove: () => void;
  onComment: (c: string) => void;
  onDeselect: () => void;
}) {
  return (
    // Container is a focusable div, NOT role="button" — we have a real
    // <button> for delete nested inside, and ARIA forbids interactive
    // widgets inside a button. We keep tabIndex + keyboard handler so it
    // still acts like a clickable row for keyboard users.
    <div
      className="ann"
      tabIndex={0}
      data-selected={selected}
      onClick={onSelect}
      onKeyDown={(e) => {
        // Only react when the row itself has keyboard focus. Without this,
        // a Space typed inside the nested textarea bubbles up and gets
        // preventDefault'd here, swallowing the space in the comment.
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
      onMouseEnter={onHoverOn}
      onMouseLeave={onHoverOff}
    >
      <span className="ann-num">{ann.number}</span>
      <div className="ann-body">
        <div className="ann-selector truncate mono">
          {ann.target ? ann.target.selector : "general note"}
        </div>
        {ann.target?.kind === "text" && (
          <div className="ann-quoted">“{ann.target.quotedText}”</div>
        )}
        {selected ? (
          <AutoGrowTextarea
            value={ann.comment}
            onCommit={(c) => {
              if (c !== ann.comment) onComment(c);
            }}
            onDeselect={onDeselect}
          />
        ) : (
          <div className={`ann-comment ${ann.comment.trim() ? "" : "muted"}`}>
            {ann.comment.trim() || "no comment"}
          </div>
        )}
      </div>
      <button
        className="ann-x"
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        title="Delete"
      >
        ✕
      </button>
    </div>
  );
}
