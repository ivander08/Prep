import { useCallback, useState } from "react";
import { type SketchShape } from "../api";
import { Dialog } from "./Dialog";

/**
 * A minimal diagram pad: rectangles, arrows, and labels on an SVG.
 *
 * No library. A diagramming dependency would be the largest thing in the app by an order of
 * magnitude, and the research documents 2026 rounds at Amazon and Netflix that ran with no
 * diagram tool at all — so this is a convenience, not a requirement. What it has to do is
 * survive the one thing an interviewer actually looks at a diagram for: naming the boxes and
 * showing which one talks to which.
 *
 * Three tools, three gestures, all on pointer events so a stylus and a trackpad behave the
 * same:
 *   - rectangle: drag from corner to corner
 *   - arrow: drag from tail to head with Shift held
 *   - label: click to place, then type into the dialog
 *
 * Controlled: the shape list is owned by the parent, which persists it, so a reloaded round
 * shows the same diagram and it stays editable.
 */

const W = 640;
const H = 300;

export function SketchPad({
  value,
  onChange,
}: {
  /** The committed shapes, owned by the parent so they survive a reload. */
  value: SketchShape[];
  /** Fires once per settled gesture — pointer-up, undo, clear, label confirm. */
  onChange: (shapes: SketchShape[]) => void;
}): React.JSX.Element {
  /**
   * The in-progress shape.
   *
   * Deliberately NOT a `SketchShape`: a label is never dragged, so the drag state is only ever a
   * rect or an arrow, and typing it that way makes the pointer-up branch exhaustive instead
   * of requiring a label case that cannot happen.
   */
  const [drag, setDrag] = useState<
    | { kind: "rect"; x: number; y: number; w: number; h: number }
    | { kind: "arrow"; x1: number; y1: number; x2: number; y2: number }
    | null
  >(null);
  const [show, setShow] = useState(false);
  /** The pending label's anchor, non-null while its dialog is open. */
  const [labelAt, setLabelAt] = useState<{ x: number; y: number } | null>(null);
  const [labelText, setLabelText] = useState("");

  /**
   * Screen coordinates to SVG user-space coordinates.
   *
   * Through `getScreenCTM()` rather than by dividing by the element's own width and height. The
   * `<svg>` is `width="100%"` over a fixed 640×300 viewBox with the default `preserveAspectRatio`
   * (`xMidYMid meet`), so the viewBox is scaled uniformly and then CENTRED inside the element —
   * letterboxed. Dividing each axis by the element's ratio ignores both the uniform scale and the
   * centring offset, so a drag landed offset by the whole letterbox in whichever axis had slack:
   * measured 63px horizontally in a 750px-wide pane, 56px vertically in a 400px-wide one. The CTM
   * is the transform the browser actually renders with, so it is exact by construction and stays
   * exact if the viewBox, the aspect ratio or a CSS transform ever changes.
   *
   * Null when the element is not rendered, which cannot happen for a pointer event on it; callers
   * return early rather than guessing a position.
   */
  const point = (e: React.PointerEvent<SVGSVGElement>): { x: number; y: number } | null => {
    const ctm = e.currentTarget.getScreenCTM();
    if (!ctm) return null;
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
    return { x: p.x, y: p.y };
  };

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    const p = point(e);
    if (!p) return;
    e.currentTarget.setPointerCapture(e.pointerId);

    if (e.shiftKey) {
      setDrag({ kind: "arrow", x1: p.x, y1: p.y, x2: p.x, y2: p.y });
      return;
    }
    // A click with no drag is a label placement, which the pointer-up handler turns into a
    // dialog. Distinguishing click from drag by distance rather than by time keeps a slow
    // deliberate drag from being mistaken for a click.
    setDrag({ kind: "rect", x: p.x, y: p.y, w: 0, h: 0 });
  };

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!drag) return;
    const p = point(e);
    if (!p) return;
    if (drag.kind === "rect") {
      setDrag({ ...drag, w: p.x - drag.x, h: p.y - drag.y });
    } else if (drag.kind === "arrow") {
      setDrag({ ...drag, x2: p.x, y2: p.y });
    }
  };

  const onPointerUp = () => {
    if (!drag) return;
    const d = drag;
    setDrag(null);

    if (d.kind === "rect") {
      // Under 6px in both axes is a click, not a rectangle.
      if (Math.abs(d.w) < 6 && Math.abs(d.h) < 6) {
        setLabelAt({ x: d.x, y: d.y });
        setLabelText("");
        return;
      }
      const rect: SketchShape = {
        kind: "rect",
        x: Math.min(d.x, d.x + d.w),
        y: Math.min(d.y, d.y + d.h),
        w: Math.abs(d.w),
        h: Math.abs(d.h),
      };
      onChange([...value, rect]);
      return;
    }

    const len = Math.hypot(d.x2 - d.x1, d.y2 - d.y1);
    if (len >= 12) onChange([...value, d]);
  };

  const clear = () => onChange([]);

  const undo = () => onChange(value.slice(0, -1));

  /** Commit the pending label. Empty or whitespace-only text is discarded, as the old prompt did. */
  const addLabel = useCallback(() => {
    if (!labelAt) return;
    const text = labelText.trim();
    if (text.length > 0) onChange([...value, { kind: "label", x: labelAt.x, y: labelAt.y, text }]);
    setLabelAt(null);
  }, [labelAt, labelText, onChange, value]);

  return (
    <div className="sketch">
      <div className="row sketch-head">
        <button className="tiny" onClick={() => setShow((v) => !v)}>
          {show ? "Hide" : "Show"} sketch pad
        </button>
        {show ? (
          <>
            <span className="muted small">Drag = box · Shift+drag = arrow · Click = label</span>
            <button className="tiny" onClick={undo} disabled={value.length === 0}>
              Undo
            </button>
            <button className="tiny" onClick={clear} disabled={value.length === 0}>
              Clear
            </button>
          </>
        ) : null}
      </div>

      {show ? (
        <svg
          className="sketch-pad"
          viewBox={`0 0 ${W} ${H}`}
          width="100%"
          height={H}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <defs>
            <marker id="sketch-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--signal)" />
            </marker>
          </defs>
          {[...value, ...(drag ? [drag] : [])].map((s, i) => {
            if (s.kind === "rect") {
              return (
                <rect
                  key={i}
                  x={s.x}
                  y={s.y}
                  width={s.w}
                  height={s.h}
                  fill="none"
                  stroke="var(--rule)"
                  strokeWidth={1.5}
                />
              );
            }
            if (s.kind === "arrow") {
              return (
                <line
                  key={i}
                  x1={s.x1}
                  y1={s.y1}
                  x2={s.x2}
                  y2={s.y2}
                  stroke="var(--signal)"
                  strokeWidth={1.5}
                  markerEnd="url(#sketch-arrow)"
                />
              );
            }
            return (
              <text
                key={i}
                x={s.x}
                y={s.y}
                textAnchor="middle"
                dominantBaseline="central"
                fill="var(--dim)"
                fontSize={12}
                fontFamily="monospace"
              >
                {s.text}
              </text>
            );
          })}
        </svg>
      ) : null}

      {labelAt ? (
        <Dialog
          title="Label"
          confirmLabel="Add"
          autoFocusConfirm={false}
          onCancel={() => setLabelAt(null)}
          onConfirm={addLabel}
        >
          <input
            autoFocus
            value={labelText}
            placeholder="Text for this label"
            onChange={(e) => setLabelText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") addLabel();
            }}
            style={{ width: "100%" }}
          />
        </Dialog>
      ) : null}
    </div>
  );
}
