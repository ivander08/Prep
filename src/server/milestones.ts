/**
 * Milestones: earned-once achievements, verified from the attempt log.
 *
 * No XP and no levels: points reward volume, and a four-minute failed attempt scoring the same
 * as a clean unaided pass contradicts the rule the rest of this app is built on, that progress is
 * derived from recorded behaviour, never self-reported. Only earned rows are stored
 * (`migrations/013_milestones.sql`); a row's presence IS the award, `earned_at` is when it was
 * first observed true, and `progress` is recomputed on read, never stored.
 *
 * Evaluate-on-read, like `recomputeMastery`: cheap aggregate queries, so a milestone reached
 * while the server was down still lands next read; awarding is `ON CONFLICT(id) DO NOTHING`.
 */

import { db } from "./db.ts";
import { streakStats } from "./streak.ts";
import { studyStats } from "./mastery.ts";

/**
 * Ten minutes. Not `GRADE_LIMIT_SECONDS` (1200, twenty minutes): the Easy/Good boundary is about
 * whether you needed help, while this milestone is about being fast as well as unaided, so it is
 * a stricter bar and must not be tied to the other one.
 */
const HARD_FAST_SECONDS = 600;

export type Milestone = {
  id: string;
  title: string;
  /** What must be true, in the second person. Shown while locked. */
  requirement: string;
};

/**
 * The eighteen milestones, in display order.
 *
 * Every one is a fact this app already records, so none can be earned by clicking. The thresholds
 * are reachable inside a six-week sprint: a milestone you cannot plausibly reach is decoration.
 * The later eight are the ones that only become reachable once a track has been used for a while
 * (a second difficulty band, a whole list, a long streak), so they are ordered after the ones a
 * first session can earn.
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
  {
    id: "first-medium-unaided",
    title: "First Medium, unaided",
    requirement: "Pass a Medium problem with no hints and no solution unlocked",
  },
  {
    id: "solved-every-difficulty",
    title: "All three bands",
    requirement: "Pass an Easy, a Medium and a Hard problem",
  },
  {
    id: "fifty-solved",
    title: "50 solved",
    requirement: "Solve 50 distinct problems",
  },
  {
    id: "pattern-at-1600",
    title: "Pattern at 1600 Elo",
    requirement: "Reach 1600 Elo in any pattern",
  },
  {
    id: "sql-fifty",
    title: "SQL 50 complete",
    requirement: "Pass all 50 problems in the SQL 50 list",
  },
  {
    id: "ten-design-rounds",
    title: "Ten design rounds",
    requirement: "Complete ten graded design rounds",
  },
  {
    id: "streak-100",
    title: "Hundred-day streak",
    requirement: "One hundred consecutive days of graded work",
  },
  {
    id: "no-lapses-month",
    title: "A clean month",
    requirement: "Thirty days of graded work with no attempt graded Again",
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
      // `studyStats` counts only attempts that were actually graded (`passed IS NOT NULL`), which
      // is the right denominator: an abandoned attempt is not evidence either way.
      //
      // Both parts are shown because the milestone has two conditions and the count alone reads as
      // satisfied once it passes 50; the hint rate is usually the part that is not.
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

    case "first-medium-unaided": {
      const met = exists(
        `SELECT 1 FROM attempts a JOIN problems p ON p.qid = a.qid
         WHERE a.passed = 1 AND a.hints_used = 0 AND a.solution_unlocked = 0
           AND p.difficulty = 'Medium'
         LIMIT 1`,
      );
      return { met, progress: null };
    }

    case "solved-every-difficulty": {
      // One query per band rather than one grouped query: a band with no passing attempt is
      // absent from a GROUP BY result, so the count alone cannot distinguish "solved all three"
      // from "solved two and never touched the third".
      const bands = ["Easy", "Medium", "Hard"];
      const solved = bands.filter((d) =>
        exists(
          `SELECT 1 FROM attempts a JOIN problems p ON p.qid = a.qid
           WHERE a.passed = 1 AND p.difficulty = ? LIMIT 1`,
          [d],
        ),
      );
      return {
        met: solved.length === bands.length,
        progress: `${solved.length}/3 bands · ${bands.filter((d) => !solved.includes(d)).join(", ") || "none left"}`,
      };
    }

    case "fifty-solved": {
      const n = scalar("SELECT COUNT(DISTINCT qid) AS n FROM attempts WHERE passed = 1");
      return { met: n >= 50, progress: `${n}/50 solved` };
    }

    case "pattern-at-1600": {
      const max = scalar("SELECT COALESCE(MAX(elo), 0) AS n FROM pattern_mastery");
      return { met: max >= 1600, progress: `${Math.round(max)}/1600 Elo` };
    }

    case "sql-fifty": {
      // Counts against the list's 50 rows, so it reads `0/50` before the SQL track is used and
      // is never an error. Only a PASSING attempt counts, and a passing attempt is only written
      // by `/api/sql/run` after the reference query agreed.
      const n = scalar(
        `SELECT COUNT(DISTINCT l.qid) AS n FROM lists l
         JOIN attempts a ON a.qid = l.qid AND a.passed = 1
         WHERE l.name = 'sql50'`,
      );
      return { met: n >= 50, progress: `${n}/50 solved` };
    }

    case "ten-design-rounds": {
      const n = scalar("SELECT COUNT(*) AS n FROM design_sessions WHERE grade IS NOT NULL");
      return { met: n >= 10, progress: `${n}/10 graded rounds` };
    }

    case "streak-100": {
      const best = streakStats().best;
      return { met: best >= 100, progress: `${best}/100 days` };
    }

    case "no-lapses-month": {
      // Active days come from the same `last_review` union the streak uses, so "a day of graded
      // work" means the same thing here as it does on the Overview. The lapse count comes from
      // `attempts.grade = 1` (Again), which is timestamped; `cards.lapses` is a lifetime counter
      // with no per-event date, so it cannot answer "in the last thirty days".
      const days = scalar(
        `SELECT COUNT(*) AS n FROM (
           SELECT DISTINCT date(last_review, 'localtime') AS day FROM cards
             WHERE last_review IS NOT NULL
           UNION
           SELECT DISTINCT date(last_review, 'localtime') FROM item_cards
             WHERE last_review IS NOT NULL
         )
         WHERE day >= date('now', 'localtime', '-30 days')`,
      );
      const lapses = scalar(
        `SELECT COUNT(*) AS n FROM attempts
         WHERE grade = 1 AND date(ended_at, 'localtime') >= date('now', 'localtime', '-30 days')`,
      );
      return {
        met: days >= 30 && lapses === 0,
        progress: `${days}/30 days · ${lapses} lapse${lapses === 1 ? "" : "s"}`,
      };
    }

    default:
      return { met: false, progress: null };
  }
}

/**
 * Evaluate every milestone and award any newly-satisfied one, returning all eighteen in display
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
