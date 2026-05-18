import { useEffect, useRef } from "react";
import { TopBar } from "./components/TopBar";
import { IframeCanvas } from "./components/IframeCanvas";
import { AnnotationPanel } from "./components/AnnotationPanel";
import { ShortcutsModal } from "./components/ShortcutsModal";
import { CommandPalette } from "./components/CommandPalette";
import { FreeformComposer } from "./components/FreeformComposer";
import { SubmittedOverlay } from "./components/SubmittedOverlay";
import { TabSidebar } from "./components/TabSidebar";
import { useStore } from "./store";
import { useHotkeys } from "./lib/hotkeys";

const HASH_SESSION_RE = /^#\/s\/([a-zA-Z0-9_-]{1,64})$/;

function parseHash(): string | null {
  const m = window.location.hash.match(HASH_SESSION_RE);
  return m ? m[1] : null;
}

export function App() {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const summaries = useStore((s) => s.summaries);
  const viewId = useStore((s) => s.viewId);
  const session = useStore((s) => s.session);
  const loadSummaries = useStore((s) => s.loadSummaries);
  const setViewId = useStore((s) => s.setViewId);
  const mode = useStore((s) => s.mode);
  const setMode = useStore((s) => s.setMode);
  const draft = useStore((s) => s.draft);
  const cancelDraft = useStore((s) => s.cancelDraft);
  const beginFreeformDraft = useStore((s) => s.beginFreeformDraft);
  const selectedId = useStore((s) => s.selectedId);
  const select = useStore((s) => s.select);
  const remove = useStore((s) => s.remove);
  const copyToClipboard = useStore((s) => s.copyToClipboard);
  const showShortcuts = useStore((s) => s.toggleShortcuts);
  const showPalette = useStore((s) => s.togglePalette);

  // Initial mount: load the session list, then drive viewId from the URL
  // hash. Auto-pick the active session if no hash was set (e.g., the
  // user opened the SPA URL directly without #/s/<id>).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      await loadSummaries();
      if (cancelled) return;
      const hashed = parseHash();
      if (hashed) {
        await setViewId(hashed);
        return;
      }
      // No hash → auto-pick the most recent file touched this turn so
      // the user lands on what Claude just edited, not on a stale
      // archived session.
      const recent = useStore.getState().summaries.find((s) => s.inCurrentTurn);
      if (recent) {
        window.location.hash = `#/s/${recent.id}`;
        await setViewId(recent.id);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadSummaries, setViewId]);

  // Tab switching is driven by URL hash so back/forward and link-sharing
  // both work without extra state. Store reflects what's in the URL.
  useEffect(() => {
    const onHashChange = () => {
      const id = parseHash();
      setViewId(id);
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, [setViewId]);

  useEffect(() => {
    // Heartbeat — keeps the daemon's notion of "an SPA is open" warm.
    // No watchdog cancels anything anymore; this is informational
    // (and lets us potentially add an auto-shutdown later if no SPA
    // has heartbeated in a long time). Cheap loopback POST every 5s.
    const HEARTBEAT_MS = 5_000;
    const ping = () => {
      fetch("/api/heartbeat").catch(() => {});
    };
    const id = setInterval(ping, HEARTBEAT_MS);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    // Poll the session list so the sidebar reflects new hooks arriving
    // and existing sessions transitioning active→archived. Cheap (small
    // JSON, loopback) and the SPA only stays open during reviews.
    const SUMMARIES_POLL_MS = 5_000;
    const id = setInterval(() => loadSummaries(), SUMMARIES_POLL_MS);
    return () => clearInterval(id);
  }, [loadSummaries]);

  useHotkeys([
    {
      combo: "e",
      handler: () => setMode(mode === "annotate" ? "preview" : "annotate"),
    },
    {
      combo: "n",
      handler: () => {
        if (!draft && session) beginFreeformDraft();
      },
    },
    {
      combo: "escape",
      handler: () => {
        const s = useStore.getState();
        if (s.showShortcuts) return s.toggleShortcuts();
        if (s.showPalette) return s.togglePalette();
        if (draft) return cancelDraft();
        if (selectedId) return select(null);
        if (mode === "annotate") setMode("preview");
      },
    },
    { combo: "shift+?", handler: showShortcuts },
    { combo: "mod+k", handler: showPalette },
    {
      combo: "mod+enter",
      handler: () => {
        if (session && session.annotations.length > 0) copyToClipboard();
      },
    },
    {
      combo: "j",
      handler: () => {
        if (!session?.annotations.length) return;
        const list = session.annotations;
        const idx = selectedId ? list.findIndex((a) => a.id === selectedId) : -1;
        const next = list[Math.min(list.length - 1, idx + 1)];
        if (next) select(next.id);
      },
    },
    {
      combo: "k",
      handler: () => {
        if (!session?.annotations.length) return;
        const list = session.annotations;
        const idx = selectedId
          ? list.findIndex((a) => a.id === selectedId)
          : list.length;
        const prev = list[Math.max(0, idx - 1)];
        if (prev) select(prev.id);
      },
    },
    {
      combo: "delete",
      handler: () => {
        if (selectedId) remove(selectedId);
      },
    },
    {
      combo: "backspace",
      handler: () => {
        if (selectedId) remove(selectedId);
      },
    },
  ]);

  // Empty state — no sessions yet, no hash. Usually the user lands here
  // for a split second between mount and the first auto-redirect to an
  // active session.
  if (summaries.length === 0) {
    return (
      <div className="app has-tabs">
        <TopBar />
        <main className="main">
          <TabSidebar />
          <div className="loading">no reviews yet — opens automatically after Claude writes HTML</div>
        </main>
        <ShortcutsModal />
        <CommandPalette />
      </div>
    );
  }

  if (!viewId || !session) {
    return (
      <div className="app has-tabs">
        <TopBar />
        <main className="main">
          <TabSidebar />
          <div className="loading">select a review from the sidebar</div>
        </main>
        <ShortcutsModal />
        <CommandPalette />
      </div>
    );
  }

  const hasPins = session.annotations.length > 0;

  return (
    <div className={`app has-tabs ${hasPins ? "has-panel" : ""}`}>
      <TopBar />
      <main className="main">
        <TabSidebar />
        <IframeCanvas key={viewId} ref={iframeRef} />
        {hasPins && <AnnotationPanel iframe={iframeRef} />}
      </main>
      <ShortcutsModal />
      <CommandPalette />
      <FreeformComposer />
      <SubmittedOverlay />
    </div>
  );
}
