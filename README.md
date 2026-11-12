# ngx-node-flow

Interactive flowgraph for Angular, drawn with WebGL2 + Canvas 2D on an `OffscreenCanvas` inside a Web Worker. Library API and options: [projects/ngx-node-flow/README.md](projects/ngx-node-flow/README.md).

## Workspace

| Path | What it is |
|---|---|
| `projects/ngx-node-flow` | the library (`ngx-node-flow`) |
| `projects/ngx-node-flow/layout` | secondary entry point `ngx-node-flow/layout` (`layered()` auto-layout) |
| `projects/demo` | demo app that consumes the built library |
| `scripts/build-worker.mjs` | bundles the renderer worker into a string constant (ng-packagr cannot emit worker entries) |

## Demo

```bash
npm start   # builds the library, then serves the demo at http://localhost:4200/
```

The demo shows:

- **Posts panel**: cards listing [jsonplaceholder posts](https://jsonplaceholder.typicode.com/posts). Clicking a card fetches that post's comments (`/comments?postId=N`) and replaces the graph with one post node linked to a node per comment. Needs network access.
- **1M nodes**: streams a million nodes into the worker in 10k chunks via `load()`, cancellable.
- Typed ports and cycle rejection on the initial cell graph, node search, PNG export, light/dark theme, and a map-actions button (undo, redo, fit view, arrange).

## Scripts

| Command | Does |
|---|---|
| `npm start` | build the library and serve the demo |
| `npm run build:lib` | build the worker bundle and the library into `dist/ngx-node-flow` |
| `npm run build` | build every project (runs `build:worker` first) |
| `npm run watch` | development build in watch mode |
| `npm test` | library unit tests (Vitest) |
| `npx ng test demo` | demo unit tests |

Edit `renderer.worker.ts` and run `npm run build:worker` (or any script above that runs it) before the change shows up: the library embeds the bundled worker source, not the file itself.
