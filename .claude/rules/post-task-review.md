# Post-task review round

After any task that changes code is finished — whether you did it directly or delegated it to a subagent such as `typescripter` — run a review round **before** telling the user the task is done.

## When it applies

- Applies: any task that created, edited or deleted source code, tests, styles, templates or build/config files.
- Does not apply: questions, explanations, read-only investigation, or changes limited to docs/markdown.
- Does not apply to the fixes made *during* a review round (see "Loop limit"), so the round does not trigger itself.

## Agents

| Agent | When | Focus |
|---|---|---|
| `qa-expert` | always | test coverage of the change, missing edge cases, regressions, whether tests actually run and pass |
| `code-reviewer` | always | correctness, type safety, security, maintainability, adherence to project conventions |
| `accessibility-tester` | only if the change touches UI: `.html`, `.tsx`, `.jsx`, `.vue`, `.svelte`, `.css`, `.scss`, Angular components/templates, web components, or anything rendered to users | WCAG 2.2 AA conformance of the changed UI: semantics, keyboard, focus, names/roles/states, contrast, error handling |

If one of these agents is not available in `.claude/agents/`, say so to the user and continue with the others. Never simulate a missing agent's review yourself.

## How to run the round

1. Collect context once: the task goal, the list of changed files (`git diff --name-only`, or the files you touched if not a git repo), and the diff itself.
2. Launch the applicable agents **in parallel** (one message with several Agent calls). Give each the task goal, changed files and diff, and instruct them to:
   - review only the change, not the whole codebase;
   - **not edit files** — report findings only (parallel agents editing the same files cause conflicts);
   - classify each finding as `blocking` (bug, failing/missing critical test, security issue, WCAG A/AA failure) or `non-blocking` (style, suggestion, AAA, nice-to-have);
   - cite file and line for each finding.
3. Consolidate the reports: deduplicate, order by severity, and drop findings that contradict each other only after checking the code yourself.
4. Fix all `blocking` findings (directly, or by delegating back to the agent that implemented the task, e.g. `typescripter`).
5. Re-run **only** the agents that reported blocking findings, scoped to the new fixes.

## Loop limit

- Maximum of **2 fix-and-recheck cycles** after the initial review.
- If blocking findings remain after that, stop and report them to the user as open issues instead of continuing.

## Final report to the user

Include, briefly:

- which agents ran (and which were skipped and why);
- blocking findings found and how each was fixed;
- non-blocking findings left as suggestions;
- anything still open after the loop limit.