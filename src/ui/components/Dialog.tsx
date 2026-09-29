import { useEffect, type ReactNode } from "react";

/**
 * How many dialogs are currently mounted.
 *
 * The `g`-chord handler in `App` bails while this is non-zero. It cannot detect a dialog by
 * looking at focus: `typingTarget(document.activeElement)` is false for a focused BUTTON, and this
 * component focuses the confirm button on purpose, so `g b` navigated away and unmounted the dialog
 * mid-confirmation. Counting mounts is the direct question — "is a modal open" — rather than a
 * proxy for it.
 *
 * A module-level counter rather than a context: the only reader is one global key handler, and
 * threading a provider through every call site would be more machinery than the guard is worth.
 */
let openDialogs = 0;

/** True while at least one `Dialog` is mounted. */
export function anyDialogOpen(): boolean {
  return openDialogs > 0;
}

/**
 * A modal panel.
 *
 * Replaces the two native dialogs the app used: `window.prompt` for a sketch label and
 * `confirm` for the tutor's solution unlock. Native dialogs are unstyled, block the event
 * loop, and cannot be reached from a test or an embedded frame; `prompt` is suppressed
 * outright in some contexts, so no label is created and nothing says so.
 *
 * The panel owns Escape, the backdrop and the ARIA attributes. It does NOT trap Tab: the app
 * has no focus trap anywhere else, and the two call sites are a single input and a single
 * button, so a trap would be more machinery than the surface it guards.
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
    openDialogs++;
    return () => {
      openDialogs--;
    };
  }, []);

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
