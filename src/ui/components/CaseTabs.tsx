import { useEffect, useRef, useState } from "react";
import type { CaseResult } from "../api";

/** A case from the statement's examples — what is known before anything is run. */
export type ExampleCase = { args: unknown[]; expected: unknown };

/**
 * One value as it appears in a result: JSON, so a string keeps its quotes and a number stays
 * distinguishable from the string that looks like it.
 *
 * `JSON.stringify(undefined)` returns `undefined` rather than a string — an omitted return
 * value would otherwise render as the empty string and read as "returned nothing" when the
 * code simply fell off the end.
 */
export function formatValue(v: unknown): string {
  return JSON.stringify(v) ?? "undefined";
}

/**
 * The case's input, as one line.
 *
 * `c.input` is the suite's own pre-formatted line (`nums = [3,3], target = 6`), so it is used
 * verbatim when present — rebuilding it from `args` would render that line as a quoted
 * string. Only the examples path, which carries no such line, falls back to zipping `args`
 * with the parameter names.
 */
export function inputText(c: { input?: string; args: unknown[] }, params?: Array<{ name: string }>): string {
  if (c.input) return c.input;
  if (params && params.length === c.args.length) {
    return c.args.map((a, i) => `${params[i]!.name} = ${formatValue(a)}`).join(", ");
  }
  return c.args.map(formatValue).join(", ");
}

/** The Input / Output / Expected block for one case. */
function CasePanel({
  input,
  expected,
  got,
  error,
}: {
  input: string;
  expected: unknown;
  /**
   * The returned value. Present only after a run, and its absence is expressed by the
   * property being missing rather than by `undefined` — a JavaScript solution can
   * legitimately return `undefined`, and that must still render as an output.
   */
  got?: { value: unknown };
  error?: string;
}) {
  return (
    <div className="case-panel">
      <span className="k">Input</span>
      <code>{input}</code>
      {got ? (
        <>
          <span className="k">Output</span>
          {error ? <code className="err">{error}</code> : <code>{formatValue(got.value)}</code>}
        </>
      ) : null}
      <span className="k">Expected</span>
      <code>{formatValue(expected)}</code>
    </div>
  );
}

/**
 * The case strip and the panel for the selected case, under two tabs.
 *
 * LeetCode's layout, and the reason it is better than a flat list here: a suite runs up to
 * 128 cases, so a stacked list buries the failing case below a screenful of passes. One case
 * is shown at a time and the chips carry the pass/fail marks, which makes "which cases broke"
 * readable at a glance and keeps the panel a fixed height instead of growing the page.
 *
 * `examples` is what the statement publishes, so the Testcase tab is populated before
 * anything has been run — the cases are part of the problem, not a product of running it.
 */
export function CaseTabs({
  examples,
  run,
  params,
}: {
  examples?: ExampleCase[];
  /** The last run, or null. Its arrival switches to the Test Result tab. */
  run?: { cases: CaseResult[]; passed: number; total: number; durationMs: number } | null;
  params?: Array<{ name: string }>;
}) {
  const [tab, setTab] = useState<"testcase" | "result">("testcase");
  const [exampleIdx, setExampleIdx] = useState(0);
  const [caseIdx, setCaseIdx] = useState(0);
  const activeChip = useRef<HTMLButtonElement>(null);

  // Land on the result tab when a run arrives, and select its first FAILURE rather than its
  // first case. The failing case is what the run was for; opening on case #1, which usually
  // passes, would make the student click to reach the answer they just asked for.
  useEffect(() => {
    if (!run) return;
    setTab("result");
    const firstFail = run.cases.findIndex((c) => !c.pass);
    setCaseIdx(firstFail >= 0 ? firstFail : 0);
  }, [run]);

  // The chip strip scrolls, so a case selected by the code above — rather than by a click —
  // can sit outside the visible strip. `nearest` keeps a clicked chip from jumping.
  useEffect(() => {
    activeChip.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [caseIdx, tab]);

  const cases = run?.cases ?? [];
  const selected = cases[caseIdx];
  const example = examples?.[exampleIdx];
  // Without examples there is only one tab, so the testcase state must not strand the panel
  // on the "run the tests" placeholder. Concepts are the case this exists for.
  const effectiveTab = examples?.length ? tab : "result";

  return (
    <div className="case-tabs">
      <div className="case-tab-strip">
        {/* Omitted entirely when there are no examples — a permanently disabled tab is
            chrome that can never do anything. Concepts have no published examples, so they
            show the result tab alone. */}
        {examples?.length ? (
          <button
            className={`case-tab${effectiveTab === "testcase" ? " active" : ""}`}
            onClick={() => setTab("testcase")}
          >
            Testcase ({examples.length})
          </button>
        ) : null}
        <button
          className={`case-tab${effectiveTab === "result" ? " active" : ""}`}
          onClick={() => setTab("result")}
          disabled={!run}
          title={run ? undefined : "Run the tests to see results."}
        >
          Test Result{run ? ` (${run.passed}/${run.total})` : ""}
        </button>
      </div>

      {effectiveTab === "testcase" && example ? (
        <>
          <div className="case-chips">
            {examples!.map((_, i) => (
              <button
                key={i}
                className={`chip${i === exampleIdx ? " active" : ""}`}
                onClick={() => setExampleIdx(i)}
              >
                Case {i + 1}
              </button>
            ))}
          </div>
          <CasePanel input={inputText(example, params)} expected={example.expected} />
        </>
      ) : selected ? (
        <>
          <div className="case-chips">
            {cases.map((c, i) => (
              <button
                key={c.index}
                ref={i === caseIdx ? activeChip : null}
                className={`chip ${c.pass ? "pass" : "fail"}${i === caseIdx ? " active" : ""}`}
                onClick={() => setCaseIdx(i)}
                title={inputText(c, params).slice(0, 120)}
              >
                <span className="dot" />
                Case {c.index + 1}
              </button>
            ))}
          </div>
          <CasePanel
            input={inputText(selected, params)}
            expected={selected.expected}
            got={{ value: selected.got }}
            error={selected.error}
          />
        </>
      ) : (
        <p className="muted small" style={{ margin: "10px 0 0" }}>
          Run the tests to see results.
        </p>
      )}
    </div>
  );
}
