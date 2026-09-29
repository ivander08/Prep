/**
 * The `g`-prefixed navigation chords, as one table.
 *
 * Here rather than in `App.tsx` because two modules need it and neither can import the other:
 * the app's keydown handler needs the key, and `TipsPanel` needs the same list to document it.
 * A copy in each place would drift into a shortcut that is advertised and does not work, which
 * is the failure mode a shortcut list is most prone to.
 *
 * Two keys rather than one because the app is editor-heavy: a bare `r` would fire while you are
 * typing in the code editor or the tutor box, and there is no reliable way to tell "the user
 * meant a command" from "the user typed r". The chord is also the idiom this kind of app already
 * uses, so it needs no explanation beyond the list.
 *
 * The view values are plain strings rather than the app's `View` union, which lives in `App.tsx`
 * and is not exported. `App` narrows them where it consumes the table.
 */

export type NavShortcut = {
  /** The key pressed after `g`. */
  key: string;
  /** The view id this chord opens. */
  view: string;
  label: string;
};

export const NAV_SHORTCUTS: NavShortcut[] = [
  { key: "o", view: "overview", label: "Overview" },
  { key: "r", view: "review", label: "Review" },
  { key: "m", view: "roadmap", label: "Roadmap" },
  { key: "f", view: "fundamentals", label: "Fundamentals" },
  { key: "d", view: "design", label: "Design" },
  { key: "b", view: "components", label: "Build" },
  { key: "q", view: "sql", label: "SQL" },
  { key: "s", view: "settings", label: "Settings" },
];

/**
 * True when the keystroke belongs to whatever has focus rather than to the app.
 *
 * Three cases, all of which would otherwise lose typed characters:
 * - an `<input>`, `<textarea>` or `<select>` (the tutor box, the search boxes, the pickers);
 * - a `contenteditable` region, which is what CodeMirror's editing surface is;
 * - anything inside the editor, checked by ancestor rather than by tag, because CodeMirror moves
 *   focus between its own children and only the outer surface is stable.
 */
export function typingTarget(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if ((el as HTMLElement).isContentEditable) return true;
  return el.closest(".cm-editor") !== null;
}
