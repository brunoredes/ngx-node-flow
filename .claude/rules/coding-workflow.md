---
description: Coding workflow — write code through ponytail, navigate the codebase through the graphify dependency graph
---

# Coding workflow

## 1. Write code through ponytail

- Before writing or changing any code, invoke the `ponytail` skill and follow its decision ladder: does this need to exist, can existing code / the standard library / a native platform feature / an installed dependency cover it, and only then write new code.
- Ponytail reduces code, not requirements. Validation, error handling, security and accessibility are never cut to make a change smaller.
- If the `ponytail` skill is not available in the session, stop and say so. Do not continue silently without it.

## 2. Navigate with the graphify graph, not by crawling files

- Before searching for definitions, callers, imports or the impact of a change, consult the graph in `graphify-out/` instead of grepping or opening files one by one:
  - `graphify-out/GRAPH_REPORT.md` for the project overview and module boundaries.
  - `graphify query "<question>"` for a scoped subgraph of the area being changed.
  - `graphify path "<symbol A>" "<symbol B>"` for the dependency path between two symbols.
- Use the graph to answer: where is this defined, who calls or imports it, and what does this change reach.
- Read only the files the graph puts in scope for the task. Always read a file before editing it — the graph shows structure, not implementation.

### Keep the graph trustworthy

- If `graphify-out/graph.json` does not exist, run `/graphify .` before starting.
- If files changed since the graph was built, or the graph disagrees with what a file actually contains, run `graphify . --update` first.
- When the graph and the file disagree, the file is the source of truth.

### When the graph does not cover something

- The graph is built from parsed source code. For files it does not model well (templates such as Angular `.html`, stylesheets, JSON/YAML config, generated code), fall back to a targeted search scoped to the paths the graph already identified — not a repo-wide crawl.