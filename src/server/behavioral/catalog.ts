/**
 * Behavioral-interview prompts.
 *
 * Eighteen prompts in six groups, the topic index for the behavioral track. A behavioral
 * answer is graded on structure rather than on the story: whether the candidate named a
 * specific situation, what they personally did, and what changed as a result. That is a
 * rubric a model can score against quoted evidence, which is why this track reuses the
 * design round's grading machinery instead of growing a second one.
 *
 * THE ANSWER KEY IS HERE AND MUST NOT REACH THE CLIENT. `lookFor` is what the grader scores
 * against and `commonMistakes` is what a coach would say; neither is text a candidate should
 * read before answering, because a prompt that ships its own rubric has turned a question
 * into a fill-in-the-blanks exercise. `listBehavioralPrompts` therefore serves only slug,
 * group, title and summary. `lookFor` bullets are written to be checkable against a written
 * answer — each one names something a grader can point at or fail to find — since a rubric
 * bullet nobody can verify is a bullet that gets scored on vibes.
 *
 * Held in code, like every other catalogue here, rather than in a table: a prose edit is
 * then a source edit, not a migration. `001_init.sql` already lists `behavioral` among the
 * non-DSA item kinds, so there is no table to create and nothing to seed on boot.
 *
 * Three prompts per group is deliberate. The groups are the six axes an interviewer probes,
 * and a track weighted towards one of them would let a candidate drill ownership for a week
 * without ever being asked about ambiguity.
 */

export type BehavioralGroup = "ownership" | "conflict" | "failure" | "influence" | "ambiguity" | "growth";

export const GROUP_LABEL: Record<BehavioralGroup, string> = {
  ownership: "Ownership",
  conflict: "Conflict",
  failure: "Failure and mistakes",
  influence: "Influence without authority",
  ambiguity: "Ambiguity",
  growth: "Growth and feedback",
};

export const GROUP_ORDER: BehavioralGroup[] = [
  "ownership",
  "conflict",
  "failure",
  "influence",
  "ambiguity",
  "growth",
];

export type BehavioralPrompt = {
  slug: string;
  group: BehavioralGroup;
  title: string;
  /** The question, as an interviewer would actually ask it. */
  statement: string;
  /** The one-line summary shown collapsed. */
  summary: string;
  /** What a strong answer contains. The answer key — never sent to the client. */
  lookFor: string[];
  /** Where candidates typically go wrong on this one. Written as the failure. */
  commonMistakes: string[];
};

export const BEHAVIORAL_PROMPTS: BehavioralPrompt[] = [
  // ------------------------------------------------------------------ ownership
  {
    slug: "took-ownership",
    group: "ownership",
    title: "A time you took ownership",
    statement:
      "Tell me about a time you took ownership of something nobody had asked you to own. What state was it in when you picked it up, and what did you change?",
    summary:
      "An answer about a gap the candidate chose to close, what they personally did first, and how the situation is different now.",
    lookFor: [
      "A named situation with a place and a time — not a category like 'a project that was behind'.",
      "The gap stated plainly: what was broken, unowned or invisible, and how the candidate came to notice it.",
      "The candidate's own action in the first person, and what they did before anyone asked them to.",
      "A result that is observable: a number, a date, a shipped change, or a decision that went differently.",
      "What they would do differently now, or what they deliberately left alone.",
    ],
    commonMistakes: [
      "Describes the team's work and never says what they personally did.",
      "Picks a task they were assigned, so the answer is about doing a job rather than taking one on.",
      "Stops at the effort — hours, weekends — with no statement of what changed.",
      "Claims the outcome while narrating only the parts that went well.",
    ],
  },
  {
    slug: "shipped-under-pressure",
    group: "ownership",
    title: "Shipping under pressure",
    statement:
      "Walk me through a time you had to ship something under real time pressure. What was the deadline, what did you cut, and how did you decide?",
    summary:
      "A strong answer names the deadline, the scope it forced them to cut, and the tradeoff they made explicitly rather than describing heroics.",
    lookFor: [
      "A concrete deadline and what depended on it, rather than 'it was urgent'.",
      "The scope cut named explicitly: what was left out, and why that was acceptable.",
      "First-person decisions — what the candidate chose, and the moment they chose it.",
      "Evidence the pressure did not move the quality bar where it mattered: tests, monitoring, review kept in place.",
      "An honest cost: what was left behind, and who had to deal with it afterwards.",
    ],
    commonMistakes: [
      "Tells the story as an all-nighter with no decision in it.",
      "Moves the deadline instead of the scope, and presents that as the solution.",
      "Never says what was left undone, so the tradeoff is invisible.",
      "Skips tests or review to hit the date without acknowledging what that risked.",
    ],
  },
  {
    slug: "fixed-what-you-broke",
    group: "ownership",
    title: "A time you broke something",
    statement:
      "Tell me about a time you broke something in production, or shipped a bug that reached users. What happened next?",
    summary:
      "The candidate names the failure without hedging, the first thing they did about it, and the change that stopped it recurring.",
    lookFor: [
      "The failure stated without hedging — what broke, who it affected, and how long it lasted.",
      "First-person ownership of the cause, not a passive account of how a bug got through.",
      "The response in order: what they did first, second and third.",
      "A durable fix — a test, an alert, a process change — rather than only the patch.",
      "What they learned, stated as a behaviour they now follow rather than a platitude.",
    ],
    commonMistakes: [
      "Picks a failure they merely witnessed, so there is nothing for them to own.",
      "Describes the fix but not the detection, hiding how long the breakage ran unnoticed.",
      "Blames the reviewer, the tooling or the timeline.",
      "Ends at the rollback, with no change that would catch the same class of bug next time.",
    ],
  },

  // ------------------------------------------------------------------- conflict
  {
    slug: "disagreed-with-manager",
    group: "conflict",
    title: "Disagreeing with your manager",
    statement:
      "Tell me about a time you disagreed with your manager or with a decision your team had already made. How did you handle it, and how did it end?",
    summary:
      "The answer shows the candidate raising the objection with evidence, committing once the decision was made, and being honest about who turned out to be right.",
    lookFor: [
      "What the disagreement was actually about, stated as a technical or product claim.",
      "How they raised it: with whom, in what forum, and with what evidence.",
      "The candidate's own action — what they said, wrote or built to make the case.",
      "The outcome, including whether they were overruled, and what they did afterwards.",
      "Whether they can say, in hindsight, who was right, and on what grounds.",
    ],
    commonMistakes: [
      "Describes a disagreement where they were obviously right and the manager obviously wrong, with no grey in it.",
      "Says they raised concerns without ever saying what the concern was.",
      "Admits being overruled and then describes quietly doing it their own way.",
      "Narrates the episode as a personality clash rather than a disagreement about a decision.",
    ],
  },
  {
    slug: "cross-team-friction",
    group: "conflict",
    title: "Friction with another team",
    statement:
      "Describe a time you needed something from a team that did not report to you, and it was not going well. What did you do?",
    summary:
      "A strong answer names the actual friction — a queue, a priority, a contract — and the concrete step the candidate took to unblock it.",
    lookFor: [
      "The dependency named specifically: which team, what they owed, and why they could not deliver it.",
      "The candidate's own action to change the situation, rather than an escalation of complaint.",
      "Evidence they understood the other team's constraints: their queue, their commitments, their incentives.",
      "A concrete artefact used to resolve it — a written contract, a shared metric, a joint working session.",
      "The result, including what the relationship was like afterwards.",
    ],
    commonMistakes: [
      "Frames the other team as slow or unreasonable, with no view of their constraints.",
      "Escalates to management first, so the answer becomes about authority rather than influence.",
      "Describes a meeting where everyone agreed, with no indication of what actually changed.",
      "Leaves out whether the thing they needed ever arrived.",
    ],
  },
  {
    slug: "gave-hard-feedback",
    group: "conflict",
    title: "Giving difficult feedback",
    statement:
      "Tell me about a time you had to give someone difficult feedback about their work. How did you approach it?",
    summary:
      "The candidate names the specific behaviour, describes the conversation they had, and says what the person did afterwards.",
    lookFor: [
      "The behaviour described concretely and recently, not as a personality trait.",
      "Evidence they addressed it directly with the person rather than routing around them.",
      "What they actually said, or the shape of the conversation: private, specific, about the work.",
      "The other person's response, including any pushback or disagreement.",
      "What changed afterwards — a behaviour, a process, or an explicit agreement.",
    ],
    commonMistakes: [
      "Describes feedback to someone who improved immediately, with no difficulty in it.",
      "Talks about the person's character rather than their behaviour.",
      "Confesses to having avoided the conversation, and stops there.",
      "Never says whether the person heard the feedback directly or second-hand.",
    ],
  },

  // -------------------------------------------------------------------- failure
  {
    slug: "biggest-mistake",
    group: "failure",
    title: "Your biggest mistake",
    statement:
      "What is the biggest mistake you have made in your career so far, and what did it teach you?",
    summary:
      "The answer names a mistake with real cost, the candidate's own part in it, and the change it produced in how they work.",
    lookFor: [
      "A mistake with genuine consequence — money, users, a missed launch — rather than a learning opportunity in disguise.",
      "The candidate's own contribution to it, stated in the first person.",
      "The cost made concrete, including who was affected and for how long.",
      "What they did to contain and repair it.",
      "A specific change in their behaviour since, not a general lesson about communicating better.",
    ],
    commonMistakes: [
      "Picks a mistake someone else made and retells it in the first person.",
      "Chooses something too small to have mattered, which reads as avoiding the question.",
      "Ends at the lesson, with no change in how they actually work.",
      "Frames it as a success story in which the mistake turned out to be the right call.",
    ],
  },
  {
    slug: "missed-deadline",
    group: "failure",
    title: "A missed deadline",
    statement:
      "Tell me about a commitment you missed. How did you find out, and what did you do about it?",
    summary:
      "The candidate says when they first knew they would miss it, who they told and when, and what the miss changed about how they estimate.",
    lookFor: [
      "The commitment named: what was promised, to whom, and by when.",
      "When they first suspected they would miss it, and whether they raised it before the date or after.",
      "What they did to reduce the damage — cutting scope, finding help, negotiating a new date.",
      "The candidate's own part in the estimate that failed.",
      "A concrete change to how they plan or communicate, visible in a later project.",
    ],
    commonMistakes: [
      "Says the deadline was unreasonable and stops there.",
      "Reveals the miss only at the deadline, without acknowledging the earlier signals.",
      "Blames an upstream dependency with no mention of their own estimate.",
      "Claims it did not matter, so there is no cost in the story to own.",
    ],
  },
  {
    slug: "production-incident-you-caused",
    group: "failure",
    title: "An incident you caused",
    statement:
      "Tell me about an incident you caused. Walk me through the timeline, from the change to the recovery.",
    summary:
      "The candidate reconstructs the timeline honestly, separates the trigger from the underlying weakness, and names the fix that stuck.",
    lookFor: [
      "A change the candidate made themselves, identified as theirs.",
      "A timeline with real ordering: what was deployed, when the alert fired, when they realised what was happening.",
      "Detection described separately from response — how the problem became visible at all.",
      "The root cause distinguished from the trigger, with the fix aimed at the root cause.",
      "A follow-up that was completed rather than agreed: a test, a guardrail, an alert that now exists.",
    ],
    commonMistakes: [
      "Attributes the incident to a system or to a reviewer rather than to the change they made.",
      "Describes only the fix, skipping how long users were affected.",
      "Stops at the postmortem document with no action that was actually carried out.",
      "Says the change was reviewed and approved, using the process as cover.",
    ],
  },

  // ------------------------------------------------------------------ influence
  {
    slug: "changed-a-decision",
    group: "influence",
    title: "Changing a decision",
    statement:
      "Tell me about a time you changed someone's mind about a technical or product decision. How did you do it?",
    summary:
      "A strong answer shows the case being made with evidence and a demonstration, not with a louder opinion.",
    lookFor: [
      "The decision, who owned it, and why they initially held the other view.",
      "What the candidate did to make the case: a prototype, a benchmark, a written argument.",
      "Evidence rather than assertion — a measurement, a spike, a costed alternative.",
      "The moment the decision changed, and what caused it.",
      "What the candidate would have done if the argument had failed.",
    ],
    commonMistakes: [
      "Says they convinced the team without saying what the argument was.",
      "Wins by escalation or seniority rather than by evidence.",
      "Picks a decision nobody was defending, so there was no mind to change.",
      "Never acknowledges the other side's reasoning, making it a story about being right.",
    ],
  },
  {
    slug: "sold-an-idea",
    group: "influence",
    title: "Selling an idea",
    statement:
      "Describe an idea you proposed that was not your team's job to do. How did you get it adopted?",
    summary:
      "The candidate names the idea, who had to say yes, and the smallest version they built to make the case concrete.",
    lookFor: [
      "The idea stated plainly, and the problem it solved that was on nobody's roadmap.",
      "Who had to be persuaded, and what each of those people cared about.",
      "The candidate's own effort to make it tangible — a prototype, a demo, a written proposal.",
      "A first step sized to the audience's tolerance: a spike, a pilot, a timeboxed trial.",
      "What happened, including whether it was adopted and what it cost the team.",
    ],
    commonMistakes: [
      "Describes an idea their manager had already decided to build.",
      "Presents the idea as obviously correct and the resistance as politics.",
      "Jumps straight to a full proposal with no small first step.",
      "Never says whether it shipped or what became of it.",
    ],
  },
  {
    slug: "said-no-to-scope",
    group: "influence",
    title: "Saying no to scope",
    statement:
      "Tell me about a time you pushed back on scope. Who wanted it, and how did you say no?",
    summary:
      "The candidate names the request, the reason they gave, and the alternative they offered instead of a bare refusal.",
    lookFor: [
      "The request stated specifically, and who was asking for it.",
      "The reason for the refusal grounded in something checkable: capacity, risk, a conflicting commitment.",
      "A first-person account of how it was communicated, and to whom.",
      "An alternative offered — a smaller version, a later date, a different owner.",
      "The outcome and the relationship afterwards, including any pushback they absorbed.",
    ],
    commonMistakes: [
      "Says no was said but never describes the conversation.",
      "Refuses without offering anything in place of the request.",
      "Frames it as protecting the team's time without addressing what the requester needed.",
      "Picks a request that was trivially droppable, so there was no real pressure to resist.",
    ],
  },

  // ------------------------------------------------------------------ ambiguity
  {
    slug: "unclear-requirements",
    group: "ambiguity",
    title: "Working from unclear requirements",
    statement:
      "Tell me about a time you started work on something that was badly specified. How did you decide what to build?",
    summary:
      "The candidate describes how they turned a vague brief into a testable question, and what they did when the answer changed the plan.",
    lookFor: [
      "The vagueness described concretely — what specifically was missing from the brief.",
      "How they surfaced the ambiguity: questions asked, assumptions written down, a prototype used to ask better ones.",
      "The assumption they chose to build on, and why it was the safest one available.",
      "Evidence they checked that assumption with someone who could actually confirm it.",
      "What happened when reality disagreed, and how quickly they changed direction.",
    ],
    commonMistakes: [
      "Describes asking for requirements until someone handed them over, with no judgement of their own.",
      "Picks a brief that was actually clear and calls it ambiguous.",
      "Builds to their own reading of the brief and never validates it with the requester.",
      "Leaves out what the first attempt got wrong.",
    ],
  },
  {
    slug: "no-one-owned-it",
    group: "ambiguity",
    title: "A problem nobody owned",
    statement:
      "Describe a situation where something was clearly broken but nobody was responsible for it. What did you do?",
    summary:
      "The candidate shows how they established the problem was real, who they got to agree, and what changed as a result.",
    lookFor: [
      "The problem described with evidence that it was real, not merely irritating.",
      "Why it fell between owners: a boundary, a missing team, an incentive nobody had.",
      "What the candidate did first — a small investigation, a written note, a measurement.",
      "How they found or created an owner: a proposal, a case to a lead, a temporary mandate.",
      "The end state, including if it remained unfixed and why that was the right call.",
    ],
    commonMistakes: [
      "Takes the whole problem on personally and burns out, with no durable owner created.",
      "Complains about the gap without measuring it.",
      "Escalates immediately, so the story becomes about authority rather than judgement.",
      "Picks something small enough that fixing it was a one-line change.",
    ],
  },
  {
    slug: "changed-direction-midway",
    group: "ambiguity",
    title: "Changing direction midway",
    statement:
      "Tell me about a time you had to change direction after work had already started. What did you do with what you had already built?",
    summary:
      "The candidate explains what invalidated the original plan, what they salvaged, and how they kept everyone committed to the old plan aligned.",
    lookFor: [
      "What changed, and when the candidate learned it — a fact, a metric, a business decision.",
      "The decision to stop stated as a decision, with the alternative that was rejected.",
      "What they did with the existing work: what was kept, what was thrown away, and why.",
      "How the change was communicated to people who had committed to the old plan.",
      "The cost of the change, stated honestly.",
    ],
    commonMistakes: [
      "Describes a change that was always going to happen, so there was no sunk cost.",
      "Says the pivot was obvious in hindsight and skips how long it took to see it.",
      "Keeps building the old thing in parallel, hiding the change from stakeholders.",
      "Never says what the abandoned work cost.",
    ],
  },

  // --------------------------------------------------------------------- growth
  {
    slug: "feedback-you-acted-on",
    group: "growth",
    title: "Feedback you acted on",
    statement:
      "Tell me about a piece of feedback you received that you acted on. What was it, and what did you change?",
    summary:
      "The candidate gives the feedback in the words it was given, says whether they agreed with it, and names the behaviour that changed.",
    lookFor: [
      "The feedback as it was actually given, not paraphrased into something more flattering.",
      "Whether they agreed with it at the time, answered honestly.",
      "The concrete change in behaviour, visible in something they did afterwards.",
      "How they knew it worked — a later observation, or someone saying so.",
      "Evidence they sought further feedback rather than waiting to be told again.",
    ],
    commonMistakes: [
      "Picks feedback that was really praise.",
      "Says they became better at communication, with no behaviour attached to it.",
      "Disagrees with the feedback and explains why it was wrong, so nothing changed.",
      "Leaves out how they found out whether the change worked.",
    ],
  },
  {
    slug: "skill-you-built",
    group: "growth",
    title: "A skill you taught yourself",
    statement:
      "Tell me about a skill you built from scratch because you needed it. How did you go about it, and how do you know you have it?",
    summary:
      "The candidate names the skill, the reason it became necessary, and the evidence that they now actually have it.",
    lookFor: [
      "The skill named precisely, and the moment it became necessary.",
      "The method: what they read, built or practised, and how much of it was deliberate rather than incidental.",
      "Something they produced with it that someone else used or reviewed.",
      "Evidence of the level reached — a shipped thing, a review, a question they can now answer.",
      "Where it is still weak, showing they know the boundary of their own knowledge.",
    ],
    commonMistakes: [
      "Lists courses or books without anything built.",
      "Names a skill they already had a foundation in.",
      "Has no external check, so the claim is self-assessed only.",
      "Claims mastery without naming a limitation.",
    ],
  },
  {
    slug: "mentored-someone",
    group: "growth",
    title: "Mentoring someone",
    statement:
      "Tell me about a time you helped someone grow. What did you actually do, and what changed for them?",
    summary:
      "The candidate describes a specific person and a specific change, and their own contribution to it.",
    lookFor: [
      "A named person and their starting point, described without condescension.",
      "What the candidate actually did: pairing, review, a stretch task, a written guide.",
      "Evidence they adapted to the person rather than applying a standard script.",
      "A change visible in the other person's work — a promotion, a shipped feature, independent ownership.",
      "What the candidate got out of it, or what they would do differently next time.",
    ],
    commonMistakes: [
      "Describes being assigned a mentee and holding regular meetings, with no change in them.",
      "Takes credit for the other person's work.",
      "Picks someone who needed no help, so the mentoring had nothing to do.",
      "Never says what happened to the person afterwards.",
    ],
  },
];

/**
 * The list view. `statement`, `lookFor` and `commonMistakes` are stripped: the list is
 * browsed by title and summary, and the answer key is not sent to the client.
 */
export function listBehavioralPrompts(): Array<{ slug: string; group: BehavioralGroup; title: string; summary: string }> {
  return BEHAVIORAL_PROMPTS.map(({ slug, group, title, summary }) => ({ slug, group, title, summary }));
}

export function getBehavioralPrompt(slug: string): BehavioralPrompt | null {
  return BEHAVIORAL_PROMPTS.find((p) => p.slug === slug) ?? null;
}
