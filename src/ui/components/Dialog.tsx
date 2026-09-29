import { useEffect, type ReactNode } from "react";

/**
 * A modal panel.
 *
 * Replaces the two native dialogs the app used — `window.prompt` for a sketch label and `confirm`
 * for the tutor's solution unlock. Native dialogs are unstyled, block the event loop, and cannot be
 * reached from a test or an embedded frame; and `prompt` is suppressed outright in some contexts, so
 * a label would silently not be created.
 *
 * The panel owns Escape, the backdrop and the ARIA attributes. It does NOT trap Tab: the app has no
 * focus trap anywhere else, and the two call sites are a single input and a single button, so a trap
 * would be more machinery than the surface it guards.
 */
export function Dialog({
  title,
  children,
  confirmLabel = "OK",
  cancelLabel = "Cancel",
  danger = false,
  autoFocusConfirm = true,
  onConfirm,
  onCancel,
}: {
  title: string;
  children?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Renders the confirm button with the destructive styling. */
  danger?: boolean;
  /** False when a child already claims focus (an `autoFocus` input), which must win. */
  autoFocusConfirm?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}): React.JSX.Element {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div className="dialog-backdrop" onClick={onCancel}>
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="dialog-title">{title}</h2>
        {children ? <div className="dialog-body">{children}</div> : null}
        <div className="dialog-actions">
          <button onClick={onCancel}>{cancelLabel}</button>
          <button
            className={danger ? "danger" : "primary"}
            autoFocus={autoFocusConfirm}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
