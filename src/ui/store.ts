import { create } from "zustand";
import { CSRF_HEADER } from "../shared/constants";
import type {
  Annotation,
  Mode,
  Session,
  SessionSummary,
  Target,
} from "../shared/types";

type Draft = { target: Target | null; comment: string };

type State = {
  /** Lightweight metadata for every session the daemon knows about. Used
   *  by the tab sidebar. Polled every few seconds. */
  summaries: SessionSummary[];
  /** Which session the user is currently looking at. Driven by URL hash
   *  (#/s/<id>). Null = empty/welcome state. */
  viewId: string | null;
  /** Full session data for `viewId` — annotations and all. Loaded on
   *  demand when the user navigates to a session. */
  session: Session | null;

  mode: Mode;
  selectedId: string | null;
  draft: Draft | null;
  showShortcuts: boolean;
  showPalette: boolean;
  /** Transient toast — set when the user clicks Copy, auto-cleared
   *  after a couple seconds by the component that renders it. */
  toast: string | null;

  // Data plumbing
  loadSummaries: () => Promise<void>;
  setViewId: (id: string | null) => Promise<void>;
  reloadSession: () => Promise<void>;

  // Per-view UI state
  setMode: (m: Mode) => void;
  select: (id: string | null) => void;

  beginDraft: (t: Target) => void;
  beginFreeformDraft: () => void;
  updateDraft: (c: string) => void;
  cancelDraft: () => void;
  commitDraft: () => Promise<void>;

  updateComment: (id: string, c: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  clearAll: () => Promise<void>;
  deleteSession: (id: string) => Promise<void>;

  /** Copy the current session's notes as markdown to the clipboard.
   *  This is the v0.2.0 replacement for "Send to agent" — the user
   *  pastes into Claude Code chat themselves. */
  copyToClipboard: () => Promise<void>;
  setToast: (text: string | null) => void;

  toggleShortcuts: () => void;
  togglePalette: () => void;
};

function uid(): string {
  return (
    Math.random().toString(36).slice(2, 8) +
    Math.random().toString(36).slice(2, 6)
  );
}

const MUTATION_HEADERS: Record<string, string> = {
  "content-type": "application/json",
  [CSRF_HEADER]: "1",
};

const DEL_HEADERS = { [CSRF_HEADER]: "1" };

async function postAnnotation(
  sessionId: string,
  ann: Annotation,
): Promise<Session> {
  const res = await fetch(`/api/sessions/${sessionId}/annotations`, {
    method: "POST",
    headers: MUTATION_HEADERS,
    body: JSON.stringify(ann),
  });
  if (!res.ok) throw new Error(`POST annotation failed (${res.status})`);
  return (await res.json()) as Session;
}

export const useStore = create<State>((set, get) => ({
  summaries: [],
  viewId: null,
  session: null,
  mode: "preview",
  selectedId: null,
  draft: null,
  showShortcuts: false,
  showPalette: false,
  toast: null,

  loadSummaries: async () => {
    try {
      const r = await fetch("/api/sessions");
      if (!r.ok) return;
      const data = (await r.json()) as { sessions: SessionSummary[] };
      set({ summaries: data.sessions });
    } catch {
      /* daemon transient — try again next poll */
    }
  },

  setViewId: async (id) => {
    if (id === get().viewId) return;
    set({
      viewId: id,
      session: null,
      selectedId: null,
      draft: null,
    });
    if (id) await get().reloadSession();
  },

  reloadSession: async () => {
    const id = get().viewId;
    if (!id) return;
    try {
      const r = await fetch(`/api/sessions/${id}`);
      if (!r.ok) return;
      const session = (await r.json()) as Session;
      set({ session });
    } catch {
      /* will retry on next interaction */
    }
  },

  setMode: (m) => set({ mode: m }),
  select: (id) => set({ selectedId: id }),

  beginDraft: (t) =>
    set({ draft: { target: t, comment: "" }, selectedId: null }),
  beginFreeformDraft: () =>
    set({ draft: { target: null, comment: "" }, selectedId: null }),
  updateDraft: (c) => {
    const d = get().draft;
    if (!d) return;
    set({ draft: { ...d, comment: c } });
  },
  cancelDraft: () => set({ draft: null }),

  commitDraft: async () => {
    const { draft, session, viewId } = get();
    if (!draft || !session || !viewId) return;
    const ann: Annotation = {
      id: uid(),
      number: session.annotations.length + 1,
      target: draft.target,
      comment: draft.comment.trim(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    set({ draft: null });
    try {
      const next = await postAnnotation(viewId, ann);
      // Don't bump selectedId — pressing Enter to save shouldn't jerk
      // focus into the panel's inline editor.
      set({ session: next });
    } catch (e) {
      console.warn("[htmlnote] save annotation failed:", e);
    }
  },

  updateComment: async (id, c) => {
    const { session, viewId } = get();
    if (!session || !viewId) return;
    const ann = session.annotations.find((a) => a.id === id);
    if (!ann) return;
    const updated: Annotation = { ...ann, comment: c, updatedAt: Date.now() };
    try {
      const next = await postAnnotation(viewId, updated);
      set({ session: next });
    } catch (e) {
      console.warn("[htmlnote] update comment failed:", e);
    }
  },

  remove: async (id) => {
    const { viewId } = get();
    if (!viewId) return;
    try {
      const res = await fetch(
        `/api/sessions/${viewId}/annotations/${id}`,
        { method: "DELETE", headers: DEL_HEADERS },
      );
      if (!res.ok) throw new Error(`DELETE failed (${res.status})`);
      const next = (await res.json()) as Session;
      set({
        session: next,
        selectedId: get().selectedId === id ? null : get().selectedId,
      });
    } catch (e) {
      console.warn("[htmlnote] delete annotation failed:", e);
    }
  },

  clearAll: async () => {
    const { viewId } = get();
    if (!viewId) return;
    try {
      const res = await fetch(
        `/api/sessions/${viewId}/annotations`,
        { method: "DELETE", headers: DEL_HEADERS },
      );
      if (!res.ok) throw new Error(`DELETE failed (${res.status})`);
      const next = (await res.json()) as Session;
      set({ session: next, selectedId: null, draft: null });
    } catch (e) {
      console.warn("[htmlnote] clear all failed:", e);
    }
  },

  deleteSession: async (id) => {
    try {
      const res = await fetch(`/api/sessions/${id}`, {
        method: "DELETE",
        headers: DEL_HEADERS,
      });
      if (!res.ok) throw new Error(`DELETE failed (${res.status})`);
      if (get().viewId === id) {
        window.location.hash = "#/";
      }
      await get().loadSummaries();
    } catch (e) {
      console.warn("[htmlnote] delete session failed:", e);
    }
  },

  copyToClipboard: async () => {
    const { viewId, session } = get();
    if (!viewId || !session) return;
    // Auto-commit any in-flight draft so it ships with the rest of the
    // notes — easy to forget Enter before copying.
    if (get().draft && get().draft!.comment.trim()) {
      await get().commitDraft();
    } else {
      set({ draft: null });
    }
    // Source markdown from the server so the format matches what the
    // hook flow used to emit, byte-for-byte. The SPA's `session` might
    // be a few ms out of date if we just committed.
    try {
      const r = await fetch(`/api/sessions/${viewId}/export.md`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const md = await r.text();
      await navigator.clipboard.writeText(md);
      const count = (await (await fetch(`/api/sessions/${viewId}`)).json())
        .annotations.length;
      set({
        toast: count > 0
          ? `Copied ${count} note${count === 1 ? "" : "s"} to clipboard — paste into chat`
          : "Copied — paste into chat",
      });
    } catch (e) {
      console.warn("[htmlnote] copy failed:", e);
      set({ toast: "Copy failed — see console" });
    }
  },

  setToast: (text) => set({ toast: text }),

  toggleShortcuts: () =>
    set({ showShortcuts: !get().showShortcuts, showPalette: false }),
  togglePalette: () =>
    set({ showPalette: !get().showPalette, showShortcuts: false }),
}));
