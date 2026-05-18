export type Rect = { x: number; y: number; w: number; h: number };

export type ElementTarget = {
  kind: "element";
  selector: string;
  tag: string;
  id?: string;
  classes?: string;
  textContent?: string;
  outerHTMLSnippet?: string;
  rect: Rect;
};

export type TextTarget = {
  kind: "text";
  /** Selector of the common-ancestor element containing the selection. */
  selector: string;
  /** Selected text, trimmed and capped. */
  quotedText: string;
  /** Char offset of quotedText within the ancestor's textContent — used to
   *  disambiguate identical selections within the same container. */
  charOffset: number;
  /** All client rects covered by the selection (one per visual line), in
   *  document coordinates. Used by the host to render highlight overlays. */
  rects: Rect[];
  /** First rect — used to anchor the pin marker and composer. */
  primaryRect: Rect;
};

export type Target = ElementTarget | TextTarget;

export type Annotation = {
  id: string;
  number: number;
  /** null = page-level / freeform note, not anchored to anything */
  target: Target | null;
  comment: string;
  createdAt: number;
  updatedAt: number;
};

export type Session = {
  id: string;
  source: { kind: "file"; path: string };
  title: string;
  createdAt: number;
  annotations: Annotation[];
};

/** Light metadata used by the tab sidebar. The daemon enumerates these from
 *  disk + memory without loading full annotation contents. */
export type SessionSummary = {
  id: string;
  title: string;
  filePath: string;
  fileExists: boolean;
  annotationCount: number;
  createdAt: number;
  /** True if this session was touched by the current turn — used by the
   *  sidebar to highlight what's new since the last user prompt. Cleared
   *  on UserPromptSubmit. */
  inCurrentTurn: boolean;
};

export type Mode = "preview" | "annotate";

export type BridgeToHostMessage =
  | { type: "ready"; doc: { w: number; h: number }; title?: string }
  | { type: "click"; target: ElementTarget }
  | { type: "textSelect"; target: TextTarget }
  | { type: "resize"; w: number; h: number }
  | { type: "key"; key: string; shiftKey: boolean }
  | { type: "wheel"; deltaX: number; deltaY: number };

export type HostToBridgeMessage =
  | { type: "setMode"; mode: Mode }
  | { type: "highlight"; selector: string | null }
  | { type: "setHoverPaused"; paused: boolean };
