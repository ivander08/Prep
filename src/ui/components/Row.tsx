import type { ReactNode } from "react";

/**
 * The app's clickable row.
 *
 * `.problem-row` is a grid of qid | title | badge, and every view that lists problems uses it.
 * It was a bare `<div onClick>` at twelve call sites, which meant none of them could be reached
 * by keyboard: a div takes no focus, so Tab skipped the entire list and a screen reader
 * announced nothing. Rendering a real <button> fixes both at once and keeps the Enter and
 * Space handling in one place instead of twelve.
 *
 * The one `.problem-row` that stays a div is the milestone row on the Overview. It has no
 * `onClick` and is not interactive, so it is content, not a control.
 */
export function Row({
  className = "",
  onClick,
  children,
  title,
}: {
  className?: string;
  onClick: () => void;
  children: ReactNode;
  title?: string;
}) {
  return (
    <button type="button" className={`problem-row ${className}`.trim()} onClick={onClick} title={title}>
      {children}
    </button>
  );
}
