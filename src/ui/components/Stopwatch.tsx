import { useEffect, useState } from "react";

const STORAGE_KEY = "prep.stopwatch.visible";

/**
 * Format elapsed seconds as a fixed-width clock.
 *
 * Zero-padded to `mm:ss` so the digits do not shift horizontally as the value changes —
 * the same reason every other numeral in this UI is monospaced with tabular figures. Hours
 * appear only once they exist, so a normal attempt is never shown as `00:04:37`.
 */
export function formatElapsed(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(sec).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** True once the attempt has passed the limit that separates Easy from Good. */
export function isOverLimit(elapsedSeconds: number, limitSeconds: number): boolean {
  return elapsedSeconds > limitSeconds;
}

/**
 * Whether the stopwatch is shown, persisted in localStorage.
 *
 * localStorage rather than the `meta` table: this is a per-browser display preference, not
 * learning state, so it should not be inside the blast radius of a progress reset, and it
 * does not justify a round trip.
 */
export function useStopwatchVisible(): [boolean, (v: boolean) => void] {
  const [visible, setVisible] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) !== "0";
    } catch {
      return true;
    }
  });

  const update = (v: boolean) => {
    setVisible(v);
    try {
      localStorage.setItem(STORAGE_KEY, v ? "1" : "0");
    } catch {
      // A blocked or private-mode store: the preference simply does not persist.
    }
  };

  return [visible, update];
}

export function Stopwatch({
  startedAt,
  limitSeconds,
  hintsUsed,
  visible,
  onToggle,
}: {
  /** Epoch ms when the attempt began. */
  startedAt: number;
  limitSeconds: number;
  /** Hints opened so far. A hint makes the attempt grade Hard regardless of time. */
  hintsUsed: number;
  visible: boolean;
  onToggle: (v: boolean) => void;
}) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // Wall-clock delta rather than a tick counter, so a throttled background tab cannot make
  // the clock drift behind real time.
  const elapsed = Math.max(0, (now - startedAt) / 1000);
  const over = isOverLimit(elapsed, limitSeconds);

  // The tooltip states the rule that actually applies. A hint dominates speed, so saying
  // "under 20:00 grades Easy" after a hint was opened would be false.
  const title =
    hintsUsed > 0
      ? "Elapsed time for this attempt. A hint has been opened, so this attempt grades Hard regardless of time."
      : `Elapsed time for this attempt. Under ${formatElapsed(limitSeconds)} grades Easy; over grades Good.`;

  if (!visible) {
    return (
      <button className="tiny" onClick={() => onToggle(true)} title="Show the attempt stopwatch">
        show timer
      </button>
    );
  }

  return (
    <span className="row" style={{ gap: 8 }}>
      <span className={`stopwatch${over ? " over" : ""}`} title={title}>
        {formatElapsed(elapsed)}
        <span className="limit"> / {formatElapsed(limitSeconds)}</span>
      </span>
      <button className="tiny" onClick={() => onToggle(false)} title="Hide the attempt stopwatch">
        hide
      </button>
    </span>
  );
}
