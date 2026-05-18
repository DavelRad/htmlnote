import { useEffect } from "react";
import { useStore } from "../store";

const AUTO_DISMISS_MS = 2500;

/**
 * Bottom-right toast. Currently used for "Copied N notes" after the
 * user hits the Copy button — kept generic so it can host other
 * one-shot notifications later.
 */
export function SubmittedOverlay() {
  const toast = useStore((s) => s.toast);
  const setToast = useStore((s) => s.setToast);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), AUTO_DISMISS_MS);
    return () => clearTimeout(id);
  }, [toast, setToast]);

  if (!toast) return null;
  return (
    <div className="toast" role="status" aria-live="polite">
      <span className="toast-mark" aria-hidden="true">✓</span>
      <span className="toast-text">{toast}</span>
    </div>
  );
}
