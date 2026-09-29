/**
 * Milestones — earned-once achievements, verified from the attempt log.
 *
 * NO XP AND NO LEVELS, deliberately. Points reward volume, and a four-minute failed attempt
 * earning the same as a clean unaided pass contradicts the rule the rest of this app is built
 * on: everything shown as progress is derived from recorded behaviour, never self-reported.
 * Every milestone below is a fact this app already records, so none can be earned by clicking.
 *
 * Only EARNED rows are stored (`migrations/013_milestones.sql`). The definitions are code, like
 * every other catalogue here, so editing a title or a threshold is a source edit and not a
 * migration. A row's presence IS the award; `earned_at` is when the condition was first
 * observed true. There is no `progress` column because progress is recomputed on read.
 *
 * Evaluate-on-read, like `recomputeMastery`: the conditions are cheap aggregate queries, and
 * deriving them means a milestone reached while the server was not running still lands on the
 * next read. Awarding is idempotent — the insert is `ON CONFLICT(id) DO NOTHING` — so a
 * milestone cannot be re-earned or have its date moved.
 */

import { db } from "./db.ts";
import { streakStats } from "./streak.ts";
import { studyStats } from "./mastery.ts";

/**
 * Ten minutes. Deliberately NOT `GRADE_LIMIT_SECONDS` (which is 1200, twenty minutes): the
 * Easy/Good boundary is about whether you needed help, while this milestone is about being
 * fast as well as unaided, so it is a stricter bar and must not be tied to the other one.
 */
const HARD_FAST_SECONDS = 600;

export type Milestone = {
  id: string;
  title: string;
  /** What must be true, in the second person. Shown while locked. */
  requirement: string;
};

/**
 * The ten milestones, in display order.
 *
 * Every one is a fact this app already records, so none can be earned by clicking. The
 * thresholds are deliberately reachable inside a six-week sprint: a milestone you cannot
 * plausibly reach is decoration.
 */
export const MILESTONES: Milestone[] = [
  {
    id: "first-unaided-pass",
    title: "First unaided pass",
    requirement: "Pass a problem with no hints and no solution unlocked",
  },
  {
    id: "first-hard-unaided",
    title: "Hard, unaided, fast",
    requirement: "Pass a Hard problem unaided in under ten minutes",
  },
  {
    id: "pattern-at-1400",
    title: "Pattern at 1400 Elo",
    requirement: "Reach 1400 Elo in any pattern",
  },
  {
    id: "streak-7",
    title: "Seven-day streak",
    requirement: "Seven consecutive days of graded work",
  },
  {
    id: "streak-30",
    title: "Thirty-day streak",
    requirement: "Thirty consecutive days of graded work",
  },
  {
    id: "hundred-solved",
    title: "100 solved",
    requirement: "Solve 100 distinct problems",
  },
  {
    id: "low-hint-rate",
    title: "Unaided habit",
    requirement: "Reach 50 attempts with an overall hint rate under 20%",
  },
  {
    id: "every-pattern-attempted",
    title: "Whole roadmap touched",
    requirement: "Attempt a problem in every pattern",
  },
  {
    id: "first-design-round",
    title: "First design round",
    requirement: "Complete a graded design round that scores above the bottom band",
  },
  {
    id: "ten-components",
    title: "Ten components built",
    requirement: "Pass ten distinct system-design components",
  },
];

export type MilestoneState = Milestone & {
  earnedAt: string | null;
  /** Human-readable current standing while locked, e.g. "43/100 solved". */
  progress: string | null;
};

/** `true` when a row exists. The three binary milestones have no partial state worth showing. */
function exists(sql: string, params: (string | number)[] = []): boolean {
  const row = db.query<{ n: number }, (string | number)[]>(`SELECT COUNT(*) AS n FROM (${sql})`).get(...params);
  return (row?.n ?? 0) > 0;
}

function scalar(sql: string): number {
  return db.query<{ n: number }, []>(sql).get()?.n ?? 0;
}

/** The predicate, and the standing to show while it is unmet. */
function evaluate(id: string): { met: boolean; progress: string | null } {
  switch (id) {
    case "first-unaided-pass": {
      const met = exists(
        "SELECT 1 FROM attempts WHERE passed = 1 AND hints_used = 0 AND solution_unlocked = 0 LIMIT 1",
      );
      return { met, progress: null };
    }

    case "first-hard-unaided": {
      const met = exists(
        `SELECT 1 FROM attempts a JOIN problems p ON p.qid = a.qid
         WHERE a.passed = 1 AND a.hints_used = 0 AND a.solution_unlocked = 0
           AND p.difficulty = 'Hard' AND a.seconds < ?
         LIMIT 1`,
        [HARD_FAST_SECONDS],
      );
      return { met, progress: null };
    }

    case "pattern-at-1400": {
      const max = scalar("SELECT COALESCE(MAX(elo), 0) AS n FROM pattern_mastery");
      return { met: max >= 1400, progress: `${Math.round(max)}/1400 Elo` };
    }

    case "streak-7": {
      const best = streakStats().best;
      return { met: best >= 7, progress: `${best}/7 days` };
    }

    case "streak-30": {
      const best = streakStats().best;
      return { met: best >= 30, progress: `${best}/30 days` };
    }

    case "hundred-solved": {
      const n = scalar("SELECT COUNT(DISTINCT qid) AS n FROM attempts WHERE passed = 1");
      return { met: n >= 100, progress: `${n}/100 solved` };
    }

    case "low-hint-rate": {
      // `studyStats` counts only attempts that were actually graded (`passed IS NOT NULL`),
      // which is the right denominator: an abandoned attempt is not evidence either way.
      //
      // BOTH parts are shown because the milestone has two conditions and the count alone reads
      // as satisfied once it passes 50 — the hint rate is usually the part that is not.
      const s = studyStats();
      const rate = s.attempts > 0 ? s.withHints / s.attempts : 0;
      return {
        met: s.attempts >= 50 && rate < 0.2,
        progress: `${s.attempts}/50 attempts · ${Math.round(rate * 100)}% with hints`,
      };
    }

    case "every-pattern-attempted": {
      const touched = scalar(
        `SELECT COUNT(DISTINCT p.pattern) AS n FROM attempts a JOIN problems p ON p.qid = a.qid
         WHERE p.pattern IS NOT NULL`,
      );
      const total = scalar("SELECT COUNT(DISTINCT pattern) AS n FROM problems WHERE pattern IS NOT NULL");
      return { met: total > 0 && touched >= total, progress: `${touched}/${total} patterns` };
    }

    case "first-design-round": {
      const met = exists("SELECT 1 FROM design_sessions WHERE grade IS NOT NULL AND grade > 1 LIMIT 1");
      return { met, progress: null };
    }

    case "ten-components": {
      const n = scalar(
        `SELECT COUNT(*) AS n FROM items i JOIN item_cards c ON c.item_id = i.id WHERE i.kind = 'component'`,
      );
      return { met: n >= 10, progress: `${n}/10 built` };
    }

    default:
      return { met: false, progress: null };
  }
}

/**
 * Evaluate every milestone and award any newly-satisfied one, returning all ten in display
 * order with their earned state.
 */
export function evaluateMilestones(): MilestoneState[] {
  const earned = new Map(
    db
      .query<{ id: string; earned_at: string }, []>("SELECT id, earned_at FROM milestones")
      .all()
      .map((r) => [r.id, r.earned_at]),
  );

  const award = db.query("INSERT INTO milestones (id, earned_at) VALUES (?, ?) ON CONFLICT(id) DO NOTHING");
  const now = new Date().toISOString();

  return MILESTONES.map((m) => {
    const already = earned.get(m.id) ?? null;
    if (already) return { ...m, earnedAt: already, progress: null };

    const { met, progress } = evaluate(m.id);
    if (!met) return { ...m, earnedAt: null, progress };

    award.run(m.id, now);
    return { ...m, earnedAt: now, progress: null };
  });
}
