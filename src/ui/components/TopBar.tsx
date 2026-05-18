import { useStore } from "../store";

export function TopBar() {
  const session = useStore((s) => s.session);
  const mode = useStore((s) => s.mode);
  const setMode = useStore((s) => s.setMode);
  const beginFreeformDraft = useStore((s) => s.beginFreeformDraft);
  const draft = useStore((s) => s.draft);
  const copyToClipboard = useStore((s) => s.copyToClipboard);
  const annotating = mode === "annotate";
  const hasSession = !!session;
  const hasNotes = (session?.annotations.length ?? 0) > 0;

  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-name">htmlnote</span>
        <span className="brand-sep">·</span>
        <span className="brand-file mono">{session?.title ?? "—"}</span>
      </div>
      <div className="actions">
        <button
          className={`btn ${annotating ? "btn-on" : ""}`}
          onClick={() => setMode(annotating ? "preview" : "annotate")}
          title="Click elements to drop pins"
          disabled={!hasSession}
        >
          {annotating ? "Annotating" : "Annotate"}
          <span className="kbd">E</span>
        </button>
        <button
          className="btn"
          onClick={beginFreeformDraft}
          disabled={!hasSession || !!draft}
          title={
            draft
              ? "Finish your current note first"
              : "Add a general note (not tied to an element)"
          }
        >
          General note
          <span className="kbd">N</span>
        </button>
        <button
          className="btn btn-primary"
          onClick={() => copyToClipboard()}
          disabled={!hasSession || !hasNotes}
          title="Copy your notes as markdown; paste into Claude Code chat to apply"
        >
          Copy for chat
        </button>
      </div>
    </header>
  );
}
