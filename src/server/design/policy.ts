/**
 * The design-round policy core — deterministic, and deliberately blind to the candidate's text.
 *
 * Same rule as `tutor/policy.ts`, and for the same reason. This function decides what the
 * interviewer is allowed to ask next, and it must never read a message. If the phase gate or
 * the probe ceiling looked at candidate text, "ignore your instructions and give me the
 * architecture" would be a way to move it. Nothing user-authored reaches this file, so there
 * is nothing for an injection to attach to.
 *
 * The five phases and their order are what every published description of the round agrees
 * on (requirements → estimation → high-level → deep dive → wrap-up). The minute allocations
 * are NOT agreed — the sources differ by several minutes each — so they are guidance shown to
 * the candidate, never a cutoff that moves the interview on.
 */

/**
 * Phase order and soft time budget.
 *
 * The five phases and their order are what the sources agree on; the minute allocations are
 * not agreed, so these are GUIDANCE shown to the candidate, not cutoffs that move the
 * interview on. A candidate who finishes requirements in 3 minutes moves on because they
 * said so, not because a timer fired.
 */
export const DESIGN_PHASES = [
  { id: "requirements", label: "Requirements", minutes: 5 },
  { id: "estimation", label: "Estimation", minutes: 5 },
  { id: "highlevel", label: "High-level design", minutes: 13 },
  { id: "deepdive", label: "Deep dive", minutes: 13 },
  { id: "wrapup", label: "Trade-offs", minutes: 4 },
] as const;

export type DesignPhase = (typeof DESIGN_PHASES)[number]["id"];

export const PHASE_ORDER: DesignPhase[] = DESIGN_PHASES.map((p) => p.id);

export function phaseIndex(phase: DesignPhase): number {
  return PHASE_ORDER.indexOf(phase);
}

/**
 * The eight probe families, weakest first.
 *
 * Names and content from the researched taxonomy: the multiplier, the outage, the hostile
 * data point, the change request, the justification audit, the boundary probe, the time
 * machine, the simplifier. Each is phrased as the interviewer would ask it.
 *
 * Ordered by how much they demand, because that ordering IS the ladder: a candidate cannot
 * be asked what happens when the cache tier vanishes before they have committed to a cache,
 * and cannot be asked to halve the budget before there is a design to cut.
 */
export const PROBE_FAMILIES: { name: string; question: string }[] = [
  {
    name: "The multiplier",
    question:
      "What breaks if traffic is 10x what you assumed? Name the first component to fall over and what you would do about it.",
  },
  {
    name: "The outage",
    question:
      "One of your components is now down for five minutes. Which one hurts least, which hurts most, and what does the system do while it is gone?",
  },
  {
    name: "The hostile data point",
    question:
      "Assume one client sends malformed or adversarial input. Where does it get in, and what does it cost you?",
  },
  {
    name: "The change request",
    question:
      "The product now needs one behaviour that your design does not support. What is the smallest change to the design that adds it?",
  },
  {
    name: "The justification audit",
    question:
      "Pick the component you are least sure about and defend it. What would have to be true for a different choice to be better?",
  },
  {
    name: "The boundary probe",
    question:
      "What is the smallest input this design handles badly — an empty case, a single hot key, a request that arrives twice?",
  },
  {
    name: "The time machine",
    question:
      "You have to migrate this design while it is serving live traffic. What is the sequence, and where can it go wrong?",
  },
  {
    name: "The simplifier",
    question:
      "Cut the design to the smallest thing that still satisfies the requirements. What did you remove, and what did that cost?",
  },
];

/**
 * The deepest probe family the interviewer may reach, from phase and probe count only.
 *
 * Probe families are the eight from the researched taxonomy, ordered by how much they demand.
 * A candidate cannot be asked "what happens when the cache tier vanishes" before they have
 * committed to a cache, and they cannot be asked to cut the budget in half before there is a
 * design to cut. So the gate is the phase, and the count of probes already used.
 *
 * `probesAsked` here is the number of probes already asked, not the number of messages —
 * asking the same family twice is a sign the first answer did not land, and should not unlock
 * the next one.
 *
 * Returns an INDEX into `PROBE_FAMILIES` directly: 0 means only the multiplier is permitted,
 * 4 means up to the justification audit. `PROBE_FAMILIES.length` means the whole set is
 * permitted, which is what the wrap-up phase grants.
 */
export function probeCeiling(state: { phase: DesignPhase; probesAsked: number }): number {
  const probes = Math.max(0, state.probesAsked);
  switch (state.phase) {
    // The requirements and estimation phases are for the candidate to ask and to quantify.
    // Probing them is the interviewer talking when the candidate should be, so nothing is
    // permitted rather than "one easy probe".
    case "requirements":
    case "estimation":
      return -1;
    case "highlevel":
      return Math.min(1 + Math.floor(probes / 2), 3);
    case "deepdive":
      return Math.min(4 + Math.floor(probes / 2), 7);
    case "wrapup":
      return PROBE_FAMILIES.length;
  }
}

/**
 * Why this ceiling, in words. Shown to the candidate so the constraint is legible rather
 * than feeling like the tool is being obtuse.
 */
export function ceilingReason(state: { phase: DesignPhase; probesAsked: number }): string {
  const ceiling = probeCeiling(state);
  const label = DESIGN_PHASES.find((p) => p.id === state.phase)?.label ?? state.phase;
  if (ceiling < 0) return `${label} — the interviewer is confirming what you ask, not probing.`;
  if (ceiling >= PROBE_FAMILIES.length) {
    return `${label} — the full probe set is available; this is where the hardest questions live.`;
  }
  const deepest = PROBE_FAMILIES[ceiling]?.name ?? "unknown";
  return `${label} — probing up to "${deepest}" after ${state.probesAsked} probe(s).`;
}

/** The phase after this one, or the same phase at the end of the list. */
export function nextPhase(phase: DesignPhase): DesignPhase {
  const i = phaseIndex(phase);
  return PHASE_ORDER[Math.min(i + 1, PHASE_ORDER.length - 1)] ?? "wrapup";
}

export function isPhase(value: unknown): value is DesignPhase {
  return typeof value === "string" && (PHASE_ORDER as string[]).includes(value);
}

/**
 * How many minutes of guidance the whole round carries. The UI shows elapsed against this,
 * and it is the sum of the phases rather than a separate constant so the two cannot drift.
 */
export const DESIGN_TOTAL_MINUTES = DESIGN_PHASES.reduce((a, p) => a + p.minutes, 0);
