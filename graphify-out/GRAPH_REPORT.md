# Graph Report - ngx-node-flow  (2026-11-12)

## Corpus Check
- 59 files · ~37,926 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 7 file(s) not represented in the graph (top: (none) 3, .css 2, .toml 1)

## Summary
- 595 nodes · 1190 edges · 23 communities (22 shown, 1 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 24 edges (avg confidence: 0.91)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `6747500f`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- layered.spec.ts
- node-flow.ts
- package.json
- cells.ts
- GraphStore
- NodeFlow
- development
- SKILL.md
- RTK Commands by Workflow
- ngx-node-flow/package.json
- gl.ts
- clipboard.ts
- Features, por prioridade
- renderer.worker.ts
- NgxNodeFlow
- 2. Navigate with the graphify graph, not by crawling files
- ng-package.json
- Post-task review round
- Development Workflow
- Development Workflow
- layout/ng-package.json
- Development Workflow

## God Nodes (most connected - your core abstractions)
1. `GraphStore` - 58 edges
2. `NodeFlow` - 51 edges
3. `FlowNode` - 26 edges
4. `run()` - 22 edges
5. `render()` - 21 edges
6. `FlowEdge` - 21 edges
7. `nodeHeight()` - 16 edges
8. `onPointer()` - 15 edges
9. `GraphChanges` - 15 edges
10. `App` - 14 edges

## Surprising Connections (you probably didn't know these)
- `Ordem que eu sugiro` --references--> `GraphChanges`  [INFERRED]
  feature.md → projects/ngx-node-flow/src/lib/types.ts
- `Base: sem isso a lib parece incompleta` --references--> `GraphChanges`  [INFERRED]
  feature.md → projects/ngx-node-flow/src/lib/types.ts
- `ngx-node-flow` --references--> `FlowEdge`  [INFERRED]
  projects/ngx-node-flow/README.md → projects/ngx-node-flow/src/lib/types.ts
- `ngx-node-flow` --references--> `NodeFlowLabels`  [INFERRED]
  projects/ngx-node-flow/README.md → projects/ngx-node-flow/src/lib/types.ts
- `ngx-node-flow` --references--> `layered()`  [INFERRED]
  projects/ngx-node-flow/README.md → projects/ngx-node-flow/layout/src/layered.ts

## Import Cycles
- None detected.

## Communities (23 total, 1 thin omitted)

### Community 0 - "layered.spec.ts"
Cohesion: 0.31
Nodes (3): layered(), LayeredOptions, node()

### Community 1 - "node-flow.ts"
Cohesion: 0.07
Nodes (48): DEFAULT_NODE_FLOW_CONFIG, DEFAULT_NODE_FLOW_THEME, mergeConfig(), NODE_FLOW_CONFIG, provideNodeFlow(), EdgeRejectedError, bezier(), EdgeRouting (+40 more)

### Community 2 - "package.json"
Cohesion: 0.05
Nodes (50): dependencies, @angular/common@^22.2.0, @angular/compiler@^22.2.0, @angular/core@^22.2.0, @angular/forms@^22.2.0, @angular/platform-browser@^22.2.0, @angular/router@^22.2.0, rxjs@~7.8.0 (+42 more)

### Community 3 - "cells.ts"
Cohesion: 0.06
Nodes (24): App, appConfig, CellData, CellKind, HEX, initialEdges, initialNodes, kindOf() (+16 more)

### Community 4 - "GraphStore"
Cohesion: 0.08
Nodes (9): hitTest(), nodeHeight(), GraphStore, grow(), noChanges(), store(), typesMatch(), FlowEdge (+1 more)

### Community 5 - "NodeFlow"
Cohesion: 0.07
Nodes (10): Base: sem isso a lib parece incompleta, ngx-node-flow, Theme, NodeFlow, iterate(), toReadableStream(), watchTheme(), Command (+2 more)

### Community 6 - "development"
Cohesion: 0.05
Nodes (46): build, serve, test, builder, configurations, defaultConfiguration, options, cli (+38 more)

### Community 7 - "SKILL.md"
Cohesion: 0.08
Nodes (25): 1. Type architecture analysis, 2. Implementation, 3. Type quality assurance, Advanced techniques, Advanced type patterns, Build and tooling, Code generation, Development workflow (+17 more)

### Community 8 - "RTK Commands by Workflow"
Cohesion: 0.09
Nodes (21): Accessibility Requirements, Analysis & Debug (70-90% savings), Angular Best Practices, Build & Compile (80-90% savings), Components, Files & Search (60-75% savings), Git (59-80% savings), GitHub (26-87% savings) (+13 more)

### Community 9 - "ngx-node-flow/package.json"
Cohesion: 0.21
Nodes (11): dependencies, tslib@^2.3.0, @angular/common, @angular/core, tslib, name, peerDependencies, @angular/common@^22.2.0 (+3 more)

### Community 10 - "gl.ts"
Cohesion: 0.26
Nodes (6): Camera, Frame, GlRenderer, program(), RECT_STRIDE, RGBA

### Community 11 - "clipboard.ts"
Cohesion: 0.27
Nodes (13): isBool(), isEdge(), isNode(), isNum(), isObj(), isPort(), isPorts(), isStr() (+5 more)

### Community 12 - "Features, por prioridade"
Cohesion: 0.22
Nodes (8): Antes de escolher features, Estado visual, sem nó rico, Features, por prioridade, Navegar em grafos grandes, onde a lib se diferencia, O que não deve entrar na lib, Ordem que eu sugiro, Organização e dados, Regras de conexão

### Community 13 - "renderer.worker.ts"
Cohesion: 0.06
Nodes (82): align(), dashes(), distToPolyline(), portPos(), toWorld(), zoomAt(), BADGE, cam (+74 more)

### Community 14 - "NgxNodeFlow"
Cohesion: 0.25
Nodes (7): Additional Resources, Building, Code scaffolding, Development server, NgxNodeFlow, Running end-to-end tests, Running unit tests

### Community 15 - "2. Navigate with the graphify graph, not by crawling files"
Cohesion: 0.33
Nodes (5): 1. Write code through ponytail, 2. Navigate with the graphify graph, not by crawling files, Coding workflow, Keep the graph trustworthy, When the graph does not cover something

### Community 16 - "ng-package.json"
Cohesion: 0.40
Nodes (4): dest, lib, entryFile, $schema

### Community 18 - "Post-task review round"
Cohesion: 0.29
Nodes (6): Agents, Final report to the user, How to run the round, Loop limit, Post-task review round, When it applies

### Community 22 - "Development Workflow"
Cohesion: 0.29
Nodes (6): 1. Accessibility Analysis, 2. Implementation Phase, 3. Compliance Verification, Accessibility Assessment, Communication Protocol, Development Workflow

### Community 23 - "Development Workflow"
Cohesion: 0.29
Nodes (6): 1. Review Preparation, 2. Implementation Phase, 3. Review Excellence, Code Review Context, Communication Protocol, Development Workflow

### Community 24 - "layout/ng-package.json"
Cohesion: 0.50
Nodes (3): lib, entryFile, $schema

### Community 25 - "Development Workflow"
Cohesion: 0.29
Nodes (6): 1. Quality Analysis, 2. Implementation Phase, 3. Quality Excellence, Communication Protocol, Development Workflow, QA Context Assessment

## Knowledge Gaps
- **1 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `@angular/forms` connect `package.json` to `cells.ts`?**
  _High betweenness centrality (0.103) - this node is a cross-community bridge._
- **Should `node-flow.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.06599597585513078 - nodes in this community are weakly interconnected._
- **Why does `NodeFlow` connect `NodeFlow` to `node-flow.ts`, `clipboard.ts`?**
  _High betweenness centrality (0.071) - this node is a cross-community bridge._
- **Should `package.json` be split into smaller, more focused modules?**
  _Cohesion score 0.050072568940493466 - nodes in this community are weakly interconnected._
- **Why does `GraphStore` connect `GraphStore` to `node-flow.ts`, `clipboard.ts`, `renderer.worker.ts`?**
  _High betweenness centrality (0.067) - this node is a cross-community bridge._
- **Should `cells.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.060496067755595885 - nodes in this community are weakly interconnected._
- **Should `GraphStore` be split into smaller, more focused modules?**
  _Cohesion score 0.08022598870056497 - nodes in this community are weakly interconnected._