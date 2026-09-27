import { useEffect, useRef } from "react";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap, lineNumbers, highlightActiveLine } from "@codemirror/view";
import { defaultKeymap, indentWithTab, history, historyKeymap } from "@codemirror/commands";
import { python } from "@codemirror/lang-python";
import { syntaxHighlighting, defaultHighlightStyle } from "@codemirror/language";

type Props = {
  value: string;
  onChange: (value: string) => void;
  /** Ctrl/Cmd+Enter */
  onRun?: () => void;
  readOnly?: boolean;
};

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
        python(),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
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
        EditorView.theme({
          "&": { backgroundColor: "#101215", color: "#d4d9df" },
          ".cm-gutters": { backgroundColor: "#101215", color: "#545c66", border: "none" },
          ".cm-activeLine": { backgroundColor: "#15181c" },
          ".cm-activeLineGutter": { backgroundColor: "#15181c", color: "#79828d" },
          ".cm-cursor": { borderLeftColor: "#e8b84b" },
          "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": { backgroundColor: "#252a31" },
          ".cm-lineNumbers .cm-gutterElement": { paddingRight: "12px" },
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
