---
name: grill-me
description: Use when user wants to stress-test a plan or design through relentless questioning, mentions "grill me", or needs thorough vetting of decisions before implementation. Also use when user wants to be interviewed about their design choices.
---

# Grill Me

Two-voice interrogation of your plan or design. **You** get grilled by a technical architect (me) and a **Business Analyst acting as partial Product Owner** (BA agent). We walk down every branch of the decision tree together until all three parties reach shared understanding.

## Two Grillers, One User

| Role | Focus | Source of authority |
|------|-------|-------------------|
| **Me (Architect)** | Technical feasibility, architecture, codebase constraints, implementation trade-offs | Codebase exploration + engineering judgment |
| **BA/PO Agent** | Business value, user workflows, scope, success criteria, prioritization, stakeholder impact | Business analysis + product ownership lens |

The BA is NOT a passive reviewer. It **contributes design decisions** from a product perspective: what to build, for whom, what success looks like, what to cut, what to prioritize. When BA and Architect disagree, present both positions to the user.

## Process

```dot
digraph grill {
    "Identify plan/design" [shape=box];
    "Explore codebase for context" [shape=box];
    "Dispatch BA/PO agent\n(business + product analysis)" [shape=box];
    "Map decision tree branches" [shape=box];
    "Pick next unresolved branch" [shape=box];
    "Can codebase answer this?" [shape=diamond];
    "Explore codebase, present finding" [shape=box];
    "Is this a business/product question?" [shape=diamond];
    "Send to BA via SendMessage\nfor PO recommendation" [shape=box];
    "Ask question + Architect rec\n+ BA/PO rec (if available)" [shape=box];
    "User responds" [shape=box];
    "Follow-up or sub-branch?" [shape=diamond];
    "More branches?" [shape=diamond];
    "BA contributed new branches?" [shape=diamond];
    "Add BA branches to tree" [shape=box];
    "Final BA review via SendMessage\n(gaps, priorities, cut list)" [shape=box];
    "Present resolved decision tree" [shape=doublecircle];

    "Identify plan/design" -> "Explore codebase for context";
    "Explore codebase for context" -> "Dispatch BA/PO agent\n(business + product analysis)";
    "Dispatch BA/PO agent\n(business + product analysis)" -> "Map decision tree branches";
    "Map decision tree branches" -> "Pick next unresolved branch";
    "Pick next unresolved branch" -> "Can codebase answer this?";
    "Can codebase answer this?" -> "Explore codebase, present finding" [label="yes"];
    "Can codebase answer this?" -> "Is this a business/product question?" [label="no"];
    "Explore codebase, present finding" -> "Is this a business/product question?";
    "Is this a business/product question?" -> "Send to BA via SendMessage\nfor PO recommendation" [label="yes/partially"];
    "Is this a business/product question?" -> "Ask question + Architect rec\n+ BA/PO rec (if available)" [label="purely technical"];
    "Send to BA via SendMessage\nfor PO recommendation" -> "Ask question + Architect rec\n+ BA/PO rec (if available)";
    "Ask question + Architect rec\n+ BA/PO rec (if available)" -> "User responds";
    "User responds" -> "Follow-up or sub-branch?";
    "Follow-up or sub-branch?" -> "Pick next unresolved branch" [label="yes"];
    "Follow-up or sub-branch?" -> "More branches?" [label="resolved"];
    "More branches?" -> "Pick next unresolved branch" [label="yes"];
    "More branches?" -> "BA contributed new branches?" [label="no"];
    "BA contributed new branches?" -> "Add BA branches to tree" [label="yes"];
    "Add BA branches to tree" -> "Pick next unresolved branch";
    "BA contributed new branches?" -> "Final BA review via SendMessage\n(gaps, priorities, cut list)" [label="no"];
    "Final BA review via SendMessage\n(gaps, priorities, cut list)" -> "Present resolved decision tree";
}
```

## BA/PO Agent — Initial Dispatch

Dispatch **business-analyst** agent in the background at the start:

```
You are acting as a Business Analyst with partial Product Owner authority for this design review.

Analyze this plan/design:
[paste the plan/design]

Your job is to CONTRIBUTE to the design, not just analyze it. Produce:

1. **Product decisions you'd make as PO:** What to prioritize, what to defer, what to cut, MVP scope
2. **Success criteria:** How do we know this worked? Measurable outcomes.
3. **User workflow analysis:** Walk through the user journey. Where does it break? What's missing?
4. **Business risks:** Assumptions that need validation, market/compliance/stakeholder concerns
5. **Scope challenges:** What's the user asking for vs what they actually need?
6. **New branches for the decision tree:** Questions that must be resolved, with YOUR recommended answer for each

For every finding, include your recommendation — not just the question. You have authority to propose design decisions from a business/product perspective.

Format each item as:
- **Finding:** [what you found]
- **PO Recommendation:** [your decision/suggestion]
- **Severity:** P0 (blocks design) / P1 (must resolve before build) / P2 (nice to resolve)
```

## BA/PO Agent — Ongoing Consultation

During the grill, use **SendMessage** to consult the BA agent on business/product questions:

```
[Context of the current branch and user's answer so far]

As PO, what's your recommendation on: [specific question]?
Does this align with the success criteria and user workflow you identified?
```

This makes BA a **live participant**, not a one-shot analyzer.

## Rules

1. **One question at a time.** Never batch. Each message = one focused question about one decision.
2. **Dual recommendations.** When a question has both technical and business dimensions, present BOTH the Architect recommendation and the BA/PO recommendation. If they agree, say so. If they disagree, present the tension and let user decide.
3. **Codebase first.** If a question can be answered by reading code, explore it instead of asking. Present finding and confirm.
4. **BA contributes, not just questions.** The BA agent proposes design decisions (scope, priority, MVP cuts, success metrics). These are first-class recommendations, not afterthoughts.
5. **Track the tree.** Follow branches depth-first. When BA adds new branches, integrate them at the right level.
6. **No softballs.** Challenge assumptions from both technical AND business angles.
7. **Resolve dependencies.** If decision B depends on A, resolve A first.

## Question Format

```
**[Branch: <topic>]**

<question>

**Architect recommendation:** <technical perspective + reasoning>
**BA/PO recommendation:** <business/product perspective + reasoning>
*(or "Aligned" if both agree)*

**Why this matters:** <1-line consequence of getting this wrong>
```

For purely technical branches (no business dimension), omit the BA line. For purely business branches, omit the Architect line.

## Completion

When all branches resolved, send the full decision tree to BA for final review:

```
Here's the resolved decision tree: [summary]

Final PO review:
1. Any gaps in user workflow coverage?
2. Priority ordering of what we decided — what ships first?
3. Anything to cut that we kept? Anything cut that we should keep?
4. Are success criteria still valid given the decisions made?
```

Then present to user:

```
## Resolved Decision Tree

### <Branch 1>
- Decision: ...
- Architect rationale: ...
- BA/PO rationale: ...

### <Branch 2>
...

## BA/PO Final Assessment
- Priority order: ...
- Recommended cuts: ...
- Success criteria: ...
```

Ask: "Anything I missed, or are we aligned?"
