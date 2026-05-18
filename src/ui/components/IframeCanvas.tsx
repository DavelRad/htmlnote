import { forwardRef, useEffect, useMemo, useRef, useState } from "react";
import { isBridgeMessage, sendToBridge } from "../lib/bridge";
import { useStore } from "../store";
import { AnnotationComposer } from "./AnnotationComposer";
import type { Annotation, Rect, Target } from "../../shared/types";

type AnchoredAnnotation = Annotation & { target: Target };
const hasTarget = (a: Annotation): a is AnchoredAnnotation => a.target !== null;

/** Where the pin and composer should anchor for a given target. */
function pinAnchor(t: Target): { x: number; y: number } {
  if (t.kind === "element") {
    return {
      x: t.rect.x + t.rect.w / 2,
      y: t.rect.y + 4,
    };
  }
  // text: top-left of the first line of the selection
  return { x: t.primaryRect.x, y: t.primaryRect.y };
}

function composerAnchor(t: Target): { x: number; y: number } {
  if (t.kind === "element") {
    return {
      x: t.rect.x + t.rect.w / 2 + 14,
      y: t.rect.y,
    };
  }
  return {
    x: t.primaryRect.x + Math.max(t.primaryRect.w, 0) + 14,
    y: t.primaryRect.y,
  };
}

export const IframeCanvas = forwardRef<HTMLIFrameElement>(function IframeCanvas(
  _,
  forwardedRef,
) {
  const localRef = useRef<HTMLIFrameElement>(null);
  const setRefs = (el: HTMLIFrameElement | null) => {
    localRef.current = el;
    if (typeof forwardedRef === "function") forwardedRef(el);
    else if (forwardedRef) forwardedRef.current = el;
  };

  const mode = useStore((s) => s.mode);
  const session = useStore((s) => s.session);
  const viewId = useStore((s) => s.viewId);
  const beginDraft = useStore((s) => s.beginDraft);
  const selectedId = useStore((s) => s.selectedId);
  const select = useStore((s) => s.select);
  const draft = useStore((s) => s.draft);

  const [docSize, setDocSize] = useState({ w: 1280, h: 800 });

  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.source !== localRef.current?.contentWindow) return;
      if (!isBridgeMessage(e.data)) return;
      const m = e.data;
      if (m.type === "ready") setDocSize({ w: m.doc.w, h: m.doc.h });
      else if (m.type === "resize") setDocSize({ w: m.w, h: m.h });
      else if (m.type === "click") beginDraft(m.target);
      else if (m.type === "textSelect") beginDraft(m.target);
      else if (m.type === "key") {
        // Re-dispatch on the host window so useHotkeys (which listens on
        // window) sees keys typed while the iframe had focus.
        window.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: m.key,
            shiftKey: m.shiftKey,
            bubbles: true,
          }),
        );
      } else if (m.type === "wheel") {
        // Cross-origin iframes trap wheel events. Bridge forwards the
        // deltas; we apply them to the actual scroll container so the
        // page scrolls as the user expects even while the iframe has
        // focus.
        const wrap = localRef.current?.closest<HTMLElement>(".canvas-wrap");
        if (wrap) wrap.scrollBy({ left: m.deltaX, top: m.deltaY });
      }
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [beginDraft]);

  useEffect(() => {
    sendToBridge(localRef.current, { type: "setMode", mode });
  }, [mode]);

  // Pause the iframe-side hover outline whenever a composer is open. Without
  // this the orange selector outline keeps tracking the mouse around the page
  // while the user is typing a note, which is visually noisy.
  useEffect(() => {
    sendToBridge(localRef.current, {
      type: "setHoverPaused",
      paused: !!draft,
    });
  }, [draft]);

  const annotations = useMemo(
    () => session?.annotations ?? [],
    [session?.annotations],
  );

  return (
    <div className="canvas-wrap">
      <div className="canvas" style={{ height: docSize.h }}>
        <iframe
          ref={setRefs}
          src={viewId ? `/target/${viewId}` : "about:blank"}
          title="rendered HTML"
          sandbox="allow-scripts"
          style={{ width: "100%", height: docSize.h, display: "block" }}
        />
        <div
          className="pins-overlay"
          onClick={(e) => {
            if (
              (e.target as HTMLElement).closest(".pin, .composer, .text-mark")
            )
              return;
            select(null);
          }}
        >
          {annotations.filter(hasTarget).map((a) => {
            const anchor = pinAnchor(a.target);
            const isSelected = selectedId === a.id;
            const label = `Annotation ${a.number}${a.comment ? `: ${a.comment.slice(0, 80)}` : ""}`;
            return (
              <PinAndMarks
                key={a.id}
                a={a}
                anchor={anchor}
                isSelected={isSelected}
                label={label}
                onClick={() => select(isSelected ? null : a.id)}
              />
            );
          })}
          {draft && draft.target !== null && (
            <>
              {draft.target.kind === "text" &&
                draft.target.rects.map((r, i) => (
                  <DraftMark key={i} r={r} />
                ))}
              <AnnotationComposer
                x={composerAnchor(draft.target).x}
                y={composerAnchor(draft.target).y}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
});

function PinAndMarks({
  a,
  anchor,
  isSelected,
  label,
  onClick,
}: {
  a: AnchoredAnnotation;
  anchor: { x: number; y: number };
  isSelected: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <>
      {a.target.kind === "text" &&
        a.target.rects.map((r, i) => (
          <div
            key={i}
            className="text-mark"
            data-selected={isSelected}
            style={{
              left: r.x,
              top: r.y,
              width: r.w,
              height: r.h,
            }}
          />
        ))}
      <button
        className="pin"
        data-selected={isSelected}
        aria-label={label}
        style={{ left: anchor.x, top: anchor.y }}
        onClick={(e) => {
          e.stopPropagation();
          onClick();
        }}
        title={a.comment || "(no comment)"}
      >
        <div className="pin-marker">
          <span>{a.number}</span>
        </div>
      </button>
    </>
  );
}

function DraftMark({ r }: { r: Rect }) {
  return (
    <div
      className="text-mark"
      data-draft="true"
      style={{ left: r.x, top: r.y, width: r.w, height: r.h }}
    />
  );
}
