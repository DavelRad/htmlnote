import { useState } from "react";
import { useStore } from "../store";
import type { SessionSummary } from "../../shared/types";

export function TabSidebar() {
  const summaries = useStore((s) => s.summaries);
  const viewId = useStore((s) => s.viewId);
  return (
    <aside className="sidebar">
      <div className="sidebar-title">Reviews</div>
      <div className="sidebar-list">
        {summaries.map((s) => (
          <TabRow key={s.id} summary={s} isViewing={viewId === s.id} />
        ))}
      </div>
    </aside>
  );
}

function TabRow({
  summary,
  isViewing,
}: {
  summary: SessionSummary;
  isViewing: boolean;
}) {
  const deleteSession = useStore((s) => s.deleteSession);
  const [confirming, setConfirming] = useState(false);
  const onTabClick = () => {
    if (isViewing) return;
    window.location.hash = `#/s/${summary.id}`;
  };
  const onDeleteClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    // Two-click confirm — same pattern as Clear all. Avoids
    // accidentally nuking a session you wanted to revisit later.
    if (!confirming) {
      setConfirming(true);
      return;
    }
    setConfirming(false);
    deleteSession(summary.id);
  };
  const basename = summary.filePath.split("/").pop() || summary.title;
  return (
    <div
      className="sidebar-tab"
      data-active={summary.inCurrentTurn}
      data-viewing={isViewing}
      data-missing={!summary.fileExists}
      onClick={onTabClick}
      onMouseLeave={() => setConfirming(false)}
      title={summary.filePath}
    >
      <div className="sidebar-tab-main">
        <span className="sidebar-tab-name truncate">{basename}</span>
        <span className="sidebar-tab-meta">
          {summary.annotationCount > 0 && (
            <span className="sidebar-tab-count">{summary.annotationCount}</span>
          )}
          {summary.inCurrentTurn && (
            <span className="sidebar-tab-dot" title="touched this turn" />
          )}
        </span>
      </div>
      <button
        className={`sidebar-tab-x ${confirming ? "sidebar-tab-x--armed" : ""}`}
        onClick={onDeleteClick}
        title={confirming ? "Click again to delete" : "Delete this review"}
      >
        ×
      </button>
    </div>
  );
}
