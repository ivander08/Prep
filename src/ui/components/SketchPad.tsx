import { useCallback, useEffect, useRef, useState } from "react";

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
 *   - label: click to place, then type into the prompt
 *
 * Serialised to a PNG on commit by rasterising the SVG through a canvas, which is the only
 * way to get a bitmap out of DOM without a renderer.
 */

export type Shape =
  | { kind: "rect"; x: number; y: number; w: number; h: number }
  | { kind: "arrow"; x1: number; y1: number; x2: number; y2: number }
  | { kind: "label"; x: number; y: number; text: string };

const W = 640;
const H = 300;

export function SketchPad({
  onChange,
  onCommit,
}: {
  /** Fires with the current PNG data URL whenever the drawing changes. */
  onChange: (png: string | null) => void;
  /** Fires on pointer-up, so persistence happens once per gesture rather than per pixel. */
  onCommit: (png: string | null) => void;
}) {
  const [shapes, setShapes] = useState<Shape[]>([]);
  /**
   * The in-progress shape.
   *
   * Deliberately NOT a `Shape`: a label is never dragged, so the drag state is only ever a
   * rect or an arrow, and typing it that way makes the pointer-up branch exhaustive instead
   * of requiring a label case that cannot happen.
   */
  const [drag, setDrag] = useState<
    | { kind: "rect"; x: number; y: number; w: number; h: number }
    | { kind: "arrow"; x1: number; y1: number; x2: number; y2: number }
    | null
  >(null);
  const [show, setShow] = useState(false);
  const svgRef = useRef<SVGSVGElement | null>(null);

  const toPng = useCallback(async (): Promise<string | null> => {
    const svg = svgRef.current;
    if (!svg) return null;
    const xml = new XMLSerializer().serializeToString(svg);
    const blob = new Blob([xml], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);

    try {
      const img = new Image();
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error("svg failed to rasterise"));
        img.src = url;
      });

      const canvas = document.createElement("canvas");
      canvas.width = W;
      canvas.height = H;
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      ctx.fillStyle = "#0c0e11";
      ctx.fillRect(0, 0, W, H);
      ctx.drawImage(img, 0, 0);
      return canvas.toDataURL("image/png");
    } catch {
      // A rasterise failure is not worth surfacing: the pad is optional, and the round does
      // not depend on the sketch being stored.
      return null;
    } finally {
      URL.revokeObjectURL(url);
    }
  }, []);

  // Push the PNG out whenever the drawing settles, so the parent always holds a current one.
  useEffect(() => {
    void toPng().then(onChange);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shapes]);

  const point = (e: React.PointerEvent<SVGSVGElement>): { x: number; y: number } => {
    const rect = e.currentTarget.getBoundingClientRect();
    const sx = W / rect.width;
    const sy = H / rect.height;
    return { x: (e.clientX - rect.left) * sx, y: (e.clientY - rect.top) * sy };
  };

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    const p = point(e);
    e.currentTarget.setPointerCapture(e.pointerId);

    if (e.shiftKey) {
      setDrag({ kind: "arrow", x1: p.x, y1: p.y, x2: p.x, y2: p.y });
      return;
    }
    // A click with no drag is a label placement, which the pointer-up handler turns into a
    // prompt. Distinguishing click from drag by distance rather than by time keeps a slow
    // deliberate drag from being mistaken for a click.
    setDrag({ kind: "rect", x: p.x, y: p.y, w: 0, h: 0 });
  };

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!drag) return;
    const p = point(e);
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
        const text = window.prompt("Label:", "");
        if (text && text.trim().length > 0) {
          setShapes((s) => [...s, { kind: "label", x: d.x, y: d.y, text: text.trim() }]);
          void toPng().then(onCommit);
        }
        return;
      }
      const rect: Shape = {
        kind: "rect",
        x: Math.min(d.x, d.x + d.w),
        y: Math.min(d.y, d.y + d.h),
        w: Math.abs(d.w),
        h: Math.abs(d.h),
      };
      setShapes((s) => [...s, rect]);
      void toPng().then(onCommit);
      return;
    }

    const len = Math.hypot(d.x2 - d.x1, d.y2 - d.y1);
    if (len >= 12) {
      setShapes((s) => [...s, d]);
      void toPng().then(onCommit);
    }
  };

  const clear = () => {
    setShapes([]);
    void toPng().then(onCommit);
  };

  const undo = () => {
    setShapes((s) => s.slice(0, -1));
    void toPng().then(onCommit);
  };

  return (
    <div className="sketch">
      <div className="row sketch-head">
        <button className="tiny" onClick={() => setShow((v) => !v)}>
          {show ? "Hide" : "Show"} sketch pad
        </button>
        {show ? (
          <>
            <span className="muted small">Drag = box · Shift+drag = arrow · Click = label</span>
            <button className="tiny" onClick={undo} disabled={shapes.length === 0}>
              Undo
            </button>
            <button className="tiny" onClick={clear} disabled={shapes.length === 0}>
              Clear
            </button>
          </>
        ) : null}
      </div>

      {show ? (
        <svg
          ref={svgRef}
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
          {[...shapes, ...(drag ? [drag] : [])].map((s, i) => {
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
              <text key={i} x={s.x} y={s.y} fill="var(--dim)" fontSize={12} fontFamily="monospace">
                {s.text}
              </text>
            );
          })}
        </svg>
      ) : null}
    </div>
  );
}
