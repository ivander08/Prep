import { useEffect, useRef } from "react";
import { autocompletion, completeAnyWord } from "@codemirror/autocomplete";
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import { EditorView, keymap, lineNumbers, highlightActiveLine, drawSelection } from "@codemirror/view";
import { defaultKeymap, indentWithTab, history, historyKeymap } from "@codemirror/commands";
import { cpp } from "@codemirror/lang-cpp";
import { go } from "@codemirror/lang-go";
import { java } from "@codemirror/lang-java";
import { javascript } from "@codemirror/lang-javascript";
import { python } from "@codemirror/lang-python";
import { sql, SQLite } from "@codemirror/lang-sql";
import { HighlightStyle, syntaxHighlighting, type LanguageSupport } from "@codemirror/language";
import { lintGutter, setDiagnostics } from "@codemirror/lint";
import { tags as t } from "@lezer/highlight";

/**
 * How much the editor helps.
 *
 * `full` is the honest default for a real editor and the wrong default for interview
 * practice: recalling that `defaultdict` or `heapq` exists is part of the exercise, and a
 * popup that names the API removes the part being tested.
 */
export type AssistLevel = "off" | "words" | "full";

export type Focus = { quote: string; why: string };

type Props = {
  value: string;
  onChange: (value: string) => void;
  /** Ctrl/Cmd+Enter */
  onRun?: () => void;
  readOnly?: boolean;
  /** Language id matching src/server/languages.ts. Drives syntax highlighting. */
  language?: string;
  /** Autocomplete depth. Defaults to "words". */
  assist?: AssistLevel;
  /** A region of this document the tutor's last hint referred to, if any. */
  focus?: Focus | null;
  /** Called when the student edits, so the highlight can be dropped. */
  onFocusClear?: () => void;
};

/**
 * Syntax support per language id.
 *
 * The editor previously hardcoded `python()`, so selecting C++ or Java left Python
 * highlighting in place. That is a real bug, not a cosmetic one: keyword colouring is the
 * fastest signal that the editor is in the mode you think it is.
 *
 * Python, JavaScript and Go ship completion sources as language data; Java and C++ ship
 * highlighting only. An unknown id falls back to Python, so the editor stays usable.
 */
const SYNTAX: Record<string, () => LanguageSupport> = {
  python3: () => python(),
  javascript: () => javascript(),
  java: () => java(),
  cpp: () => cpp(),
  go: () => go(),
  // `SQLite`, not the default dialect: the query is about to run on the SQLite engine inside
  // Bun, so the keywords the editor colours as valid are the ones the grader actually accepts.
  sql: () => sql({ dialect: SQLite }),
};

function syntaxFor(language: string | undefined): LanguageSupport {
  return (SYNTAX[language ?? "python3"] ?? SYNTAX.python3)!();
}

/**
 * Syntax colours for a dark editor.
 *
 * The previous version used CodeMirror's `defaultHighlightStyle`, which is a LIGHT theme.
 * Against a graphite background it produced dark-blue keywords and dark-green strings that
 * were nearly unreadable. A dark editor needs an explicit dark palette.
 *
 * Colours are drawn from the same instrument palette as the rest of the app: amber for
 * keywords (the readout colour), and a restrained set of desaturated hues elsewhere, so
 * code reads as data, not decoration.
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
 * `.cm-cursor` left the caret invisible, because the amber was never applied to the thing
 * the browser actually blinks.
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
 * Autocomplete by level.
 *
 * `off` registers nothing. `words` registers only `completeAnyWord`, which completes
 * identifiers already present in this document: it saves retyping `intervals` without ever
 * naming a library API. `full` registers plain `autocompletion()`, which also picks up the
 * completion source the syntax extension publishes as language data (Python builtins, JS
 * globals, Go keywords).
 *
 * Measured over the five languages here, `full` adds a source for python3, javascript and
 * go, and nothing for java and cpp, which ship highlighting only.
 */
const ASSIST: Record<AssistLevel, () => Extension> = {
  off: () => [],
  words: () =>
    autocompletion({ activateOnTyping: true, override: [completeAnyWord], icons: false }),
  full: () => autocompletion({ activateOnTyping: true }),
};

/** Which languages `full` adds completions for, asked of CodeMirror and not hardcoded: a
 * hand-written list would go stale with nothing to catch it if a language package started
 * shipping a source. Memoised because building a state is not free and the answer is fixed. */
const assistLanguageDataCache = new Map<string, boolean>();

export function assistFullIsInert(language: string): boolean {
  const cached = assistLanguageDataCache.get(language);
  if (cached !== undefined) return cached;
  const state = EditorState.create({ doc: "", extensions: [syntaxFor(language)] });
  const inert = state.languageDataAt("autocomplete", 0).length === 0;
  assistLanguageDataCache.set(language, inert);
  return inert;
}

export const ASSIST_LABEL: Record<AssistLevel, string> = {
  off: "No assist",
  words: "Words I typed",
  full: "Words + library",
};

/** One line per level, shown under the picker so the choice is not a guess. */
export const ASSIST_HELP: Record<AssistLevel, string> = {
  off: "No suggestions at all.",
  words:
    "Completes identifiers already in this file — retype `intervals` once and it is offered next time. Never names a library API.",
  full: "Everything above, plus the language's own names: Python builtins, JS globals, Go keywords.",
};

/**
 * Shown when `full` is selected in a language with no completion source, where it is
 * indistinguishable from `words`. It says so instead of describing a difference that is not
 * there: a control that does nothing without saying so is worse than one that admits it.
 */
export const ASSIST_INERT_HELP =
  "Java and C++ publish no completion data, so this is exactly the same as 'Words I typed' here. Use it in Python, JavaScript, or Go to get builtins and keywords.";

function assistFor(level: AssistLevel | undefined): Extension {
  return (ASSIST[level ?? "words"] ?? ASSIST.words)();
}

/**
 * The autocomplete control: a segmented picker plus the explanation for the current level.
 *
 * Replaces a `<select>` whose two non-default options read "Word complete" and "Full assist",
 * names that do not say what differs. The labels now describe the SOURCE of the suggestions
 * (what you typed vs. the language's own names) and the line underneath states the rule for
 * whichever level is selected.
 *
 * It also reports when the level makes no difference: Java and C++ publish no language data,
 * so `full` there is identical to `words`, and a control that does nothing without saying so
 * is worse than one that says it does nothing.
 */
export function AssistPicker({
  value,
  onChange,
  language,
}: {
  value: AssistLevel;
  onChange: (v: AssistLevel) => void;
  language: string;
}) {
  const inert = value === "full" && assistFullIsInert(language);
  return (
    <div className="assist-picker">
      <div className="seg" role="group" aria-label="Autocomplete">
        {(["off", "words", "full"] as AssistLevel[]).map((level) => (
          <button
            key={level}
            className={`seg-item${level === value ? " active" : ""}`}
            aria-pressed={level === value}
            onClick={() => onChange(level)}
          >
            {ASSIST_LABEL[level]}
          </button>
        ))}
      </div>
      <p className={`assist-help${inert ? " inert" : ""}`}>
        {inert ? ASSIST_INERT_HELP : ASSIST_HELP[value]}
      </p>
    </div>
  );
}

/**
 * Thin CodeMirror 6 wrapper. CodeMirror owns the DOM, so React must not re-render the
 * editor on every keystroke. The view is created once and updated imperatively, and only
 * when `value` changes from outside.
 */
export function CodeEditor({
  value,
  onChange,
  onRun,
  readOnly = false,
  language,
  assist,
  focus,
  onFocusClear,
}: Props) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const onRunRef = useRef(onRun);
  const onFocusClearRef = useRef(onFocusClear);
  /** Holds the syntax extension so it can be swapped without rebuilding the view. */
  const langCompartment = useRef(new Compartment());
  /** Same, for autocomplete depth. */
  const assistCompartment = useRef(new Compartment());

  onChangeRef.current = onChange;
  onRunRef.current = onRun;
  onFocusClearRef.current = onFocusClear;

  useEffect(() => {
    if (!host.current) return;

    const state = EditorState.create({
      doc: value,
      extensions: [
        lineNumbers(),
        lintGutter(),
        highlightActiveLine(),
        history(),
        drawSelection(),
        langCompartment.current.of(syntaxFor(language)),
        assistCompartment.current.of(assistFor(assist)),
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
          if (u.docChanged) {
            onChangeRef.current(u.state.doc.toString());
            // A hint highlight points at offsets in the code as it was when the hint was
            // asked for. Once the student types, those offsets describe a different region.
            onFocusClearRef.current?.();
          }
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

  // Swap syntax support when the language selector changes, without recreating the view.
  // Rebuilding would discard undo history and the caret position.
  useEffect(() => {
    const v = view.current;
    if (!v) return;
    v.dispatch({ effects: langCompartment.current.reconfigure(syntaxFor(language)) });
  }, [language]);

  useEffect(() => {
    const v = view.current;
    if (!v) return;
    v.dispatch({ effects: assistCompartment.current.reconfigure(assistFor(assist)) });
  }, [assist]);

  /**
   * Highlight the region of the student's own code a hint referred to.
   *
   * The tutor returns a verbatim quote, not a line number: line arithmetic is the unreliable
   * part of what a model produces, while a substring can be located by search however the
   * model counted. The quote is resolved here, not on the server, because only the editor
   * knows what the document looks like now.
   *
   * An absent quote, or one that appears more than once, is dropped instead of guessed at: a
   * highlight in the wrong place asserts a precision the hint does not have. `setDiagnostics`
   * is used so CodeMirror maps the range through document changes and it survives edits above.
   */
  useEffect(() => {
    const v = view.current;
    if (!v) return;

    if (!focus) {
      v.dispatch(setDiagnostics(v.state, []));
      return;
    }

    const doc = v.state.doc.toString();
    const idx = doc.indexOf(focus.quote);
    if (idx < 0 || doc.indexOf(focus.quote, idx + 1) !== -1) {
      v.dispatch(setDiagnostics(v.state, []));
      return;
    }

    v.dispatch(
      setDiagnostics(v.state, [
        {
          from: idx,
          to: idx + focus.quote.length,
          severity: "info",
          source: "tutor",
          message: focus.why,
        },
      ]),
    );
    v.dispatch({ effects: EditorView.scrollIntoView(idx, { y: "center" }) });
  }, [focus]);

  // Sync external changes (e.g. loading a different problem) without clobbering typing.
  useEffect(() => {
    const v = view.current;
    if (!v) return;
    if (v.state.doc.toString() === value) return;
    v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value } });
  }, [value]);

  return <div className="editor-host" ref={host} />;
}
