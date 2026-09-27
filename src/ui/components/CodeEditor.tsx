import { useEffect, useRef } from "react";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap, lineNumbers, highlightActiveLine, drawSelection } from "@codemirror/view";
import { defaultKeymap, indentWithTab, history, historyKeymap } from "@codemirror/commands";
import { python } from "@codemirror/lang-python";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";

type Props = {
  value: string;
  onChange: (value: string) => void;
  /** Ctrl/Cmd+Enter */
  onRun?: () => void;
  readOnly?: boolean;
};

/**
 * Syntax colours for a dark editor.
 *
 * The previous version used CodeMirror's `defaultHighlightStyle`, which is a LIGHT theme —
 * against a graphite background it produced dark-blue keywords and dark-green strings that
 * were nearly unreadable. A dark editor needs an explicit dark palette.
 *
 * Colours are drawn from the same instrument palette as the rest of the app: amber for
 * keywords (the readout colour), and a restrained set of desaturated hues for the rest so
 * code reads as data rather than decoration.
 */
const darkHighlight = HighlightStyle.define([
  { tag: t.keyword, color: "#e8b84b" },
  { tag: [t.controlKeyword, t.moduleKeyword], color: "#e8b84b", fontWeight: "600" },
  { tag: [t.name, t.deleted, t.character, t.propertyName, t.macroName], color: "#d4d9df" },
  { tag: [t.function(t.variableName), t.labelName], color: "#82b6d9" },
  { tag: [t.definition(t.variableName), t.definition(t.propertyName)], color: "#d4d9df" },
  { tag: [t.typeName, t.className, t.namespace], color: "#7fc8a9" },
  { tag: [t.number, t.integer, t.float], color: "#d98c6b" },
  { tag: [t.string, t.special(t.string)], color: "#a3c98f" },
  { tag: [t.operator, t.operatorKeyword], color: "#a8b3c0" },
  { tag: [t.comment, t.lineComment, t.blockComment], color: "#5c6672", fontStyle: "italic" },
  { tag: [t.bool, t.null, t.atom], color: "#d98c6b" },
  { tag: t.self, color: "#c9a2d9" },
  { tag: [t.bracket, t.brace, t.paren, t.squareBracket], color: "#8b949e" },
  { tag: t.invalid, color: "#d96c5f" },
  { tag: [t.meta, t.annotation], color: "#79828d" },
  { tag: t.link, color: "#82b6d9", textDecoration: "underline" },
]);

/**
 * Editor theme.
 *
 * `caretColor` is the important line: CodeMirror draws its own caret via a CSS
 * `caret-color` on the content element, not through the `.cm-cursor` element. Styling only
 * `.cm-cursor` left the caret invisible — the amber was never applied to the thing the
 * browser actually blinks.
 *
 * `drawSelection()` is also enabled so the selection layer is a real DOM element that can
 * be styled; without it the native selection ignores the theme on some platforms.
 */
const darkTheme = EditorView.theme(
  {
    "&": { backgroundColor: "#0d0f12", color: "#d4d9df", caretColor: "#e8b84b" },
    ".cm-content": { caretColor: "#e8b84b", padding: "10px 0" },
    ".cm-line": { padding: "0 12px" },
    ".cm-gutters": {
      backgroundColor: "#0d0f12",
      color: "#4a525c",
      border: "none",
      borderRight: "1px solid #1e2228",
    },
    ".cm-lineNumbers .cm-gutterElement": { paddingRight: "14px", paddingLeft: "10px" },
    ".cm-activeLine": { backgroundColor: "#161a1f" },
    ".cm-activeLineGutter": { backgroundColor: "#161a1f", color: "#8b949e" },
    ".cm-cursor, .cm-dropCursor": { borderLeftColor: "#e8b84b", borderLeftWidth: "2px" },
    "&.cm-focused .cm-cursor": { borderLeftColor: "#e8b84b" },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
      backgroundColor: "#2a3547",
    },
    ".cm-selectionMatch": { backgroundColor: "#1f2833" },
    ".cm-matchingBracket, &.cm-focused .cm-matchingBracket": {
      backgroundColor: "#2a3547",
      outline: "1px solid #4a525c",
    },
    ".cm-scroller": { fontFamily: "var(--mono)", lineHeight: "1.6" },
  },
  { dark: true },
);

/**
 * Thin CodeMirror 6 wrapper. CodeMirror owns the DOM, so React must not re-render the
 * editor on every keystroke — the view is created once and updated imperatively only when
 * `value` changes from outside.
 */
export function CodeEditor({ value, onChange, onRun, readOnly = false }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const onRunRef = useRef(onRun);

  onChangeRef.current = onChange;
  onRunRef.current = onRun;

  useEffect(() => {
    if (!host.current) return;

    const state = EditorState.create({
      doc: value,
      extensions: [
        lineNumbers(),
        highlightActiveLine(),
        history(),
        drawSelection(),
        python(),
        syntaxHighlighting(darkHighlight),
        darkTheme,
        keymap.of([
          {
            key: "Mod-Enter",
            preventDefault: true,
            run: () => {
              onRunRef.current?.();
              return true;
            },
          },
          indentWithTab,
          ...defaultKeymap,
          ...historyKeymap,
        ]),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) onChangeRef.current(u.state.doc.toString());
        }),
        ...(readOnly ? [EditorState.readOnly.of(true)] : []),
      ],
    });

    const v = new EditorView({ state, parent: host.current });
    view.current = v;
    return () => {
      v.destroy();
      view.current = null;
    };
    // Created once on mount; `value` is synced in the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readOnly]);

  // Sync external changes (e.g. loading a different problem) without clobbering typing.
  useEffect(() => {
    const v = view.current;
    if (!v) return;
    if (v.state.doc.toString() === value) return;
    v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value } });
  }, [value]);

  return <div className="editor-host" ref={host} />;
}
