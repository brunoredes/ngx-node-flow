# ngx-node-flow

Interactive flowgraph for Angular. Nodes and edges are drawn with WebGL2 + Canvas 2D on an `OffscreenCanvas` inside a Web Worker.

```ts
// app.config.ts
providers: [provideNodeFlow({ grid: { size: 24 } })]
```

```html
<ngx-node-flow [nodes]="nodes" [edges]="edges" (graphChange)="save($event)">
  <ng-template nodeFlowEditor let-draft>
    <!-- your form; `draft` is a WritableSignal<FlowNode>, applied on Save -->
  </ng-template>
</ngx-node-flow>
```

The worker is the single source of truth. `nodes`/`edges` are the initial graph: edits are never written back to them, and setting a new array replaces the whole graph (including what `load()` streamed in). To keep your own copy, fold each `graphChange` with `applyChanges(nodes, edges, change)`.

Ports are objects: `{ id, label?, type?, maxConnections? }`. Edges reference the port `id`, so a label can change without dropping edges.

Policy is yours, not the library's:

- `[createNode]="() => ({ label: 'Step', inputs: [{ id: 'in' }], outputs: [{ id: 'out' }] })"` builds nodes added from the menu (id and position are assigned for you).
- `[beforeRemove]="confirmRemove"` runs before a removal (menu or Delete key, once per node); return `false` (or a promise of it) to keep the node.
- Connection rules, checked when the user drops an edge (a picked-up edge goes back where it was). Each refusal emits `(edgeRejected)` with an `EdgeRejectedError` carrying the `edge` and the `reason`. Graphs passed in or streamed by `load()` are not checked.
  - `provideNodeFlow({ edge: { compatibility: { number: ['number', 'any'] } } })` maps an output port `type` to the input types it may feed. Untyped ports, and types missing from the map, connect to anything. While dragging, ports the edge cannot land on are dimmed. Reason: `'type'`.
  - `maxConnections` on a port caps its edges. Reason: `'maxConnections'`.
  - `edge: { allowCycles: false }` refuses an edge that would close a cycle. The check walks what is downstream of the target, so on a single 1M-node ring it costs about 15 ms per drop. Reason: `'cycle'`.
  - `[canConnect]="(edge) => boolean | Promise<boolean>"` gets the last word after the rules above, once per drop. Reason: `'custom'`.
- `[readonly]="true"` keeps pan, zoom and selection but blocks every edit. `locked: true` on a node keeps it from being dragged or removed.
- `provideNodeFlow({ labels: { ... } })` sets the UI strings (defaults are English, see `NodeFlowLabels`).

Imperative API (on the component instance, e.g. via `viewChild(NodeFlow)`):

| method | does |
|---|---|
| `snapshot()` | resolves the whole graph as `{ nodes, edges }`: persist without folding every `graphChange` |
| `fitView({ padding? })`, `centerOn(id)`, `zoomTo(zoom)` | moves the camera |
| `findNodes(text, limit?)` | up to `limit` (20) nodes whose label contains `text`, case-insensitive; a linear scan in the worker (tens of ms at 1M nodes) |
| `setStatus([{ id, status, errors? }])` | runtime state (`'running' \| 'success' \| 'error'`, `'idle'` clears): a badge on the node (shape and color differ per status), the errors listed under the selected node and announced. Not undone, not in `graphChange` or `snapshot()` |
| `highlight(nodeIds, edgeIds?)` | emphasizes a path, search results or a trace and dims the rest; `highlight([])` clears |
| `toggleGroup(id, collapsed?)` | collapses / expands a group; `(groupToggle)` reports it |
| `moveNodes([{ id, x, y }])` | moves many nodes as one undo step, reported through `graphChange` |
| `exportImage(type?)` | the current view as a `Blob` (PNG by default); call `fitView()` first for the whole graph |
| `select(ids)` | selects nodes (`[]` clears); `(selectionChange)` reports `{ nodes, edges }` |
| `undo()`, `redo()`, `canUndo()`, `canRedo()` | history of the last 100 user actions, kept in the worker; undo/redo report through `graphChange`. Replacing `nodes`/`edges` clears it |
| `load(source)` | streams a large graph in chunks |

Edges and nodes, still drawn on the canvas:

- `FlowEdge` takes `label`, `dashed` and `animated` (dashes flowing source → target; still when the user prefers reduced motion).
- `provideNodeFlow({ edge: { routing: 'step' } })` routes every edge as `'bezier'` (default), `'step'` or `'straight'`.
- `FlowNode.icon` is an image URL (relative to the page, or `data:`) drawn before the label. It is fetched by the worker, so cross-origin images need CORS.

Groups: give nodes a `group` id and pass `[groups]="[{ id, label, collapsed? }]"`. Each group is drawn as a frame behind its members; a click on its header collapses it into a single box (edges to its members attach to the box), and a click on the box expands it. From the keyboard, G toggles the focused node's group and Shift+G expands every group. Collapsing is view state: it is not undone and not in `graphChange`; a new `groups` array resets it to the `collapsed` flags.

Automatic layout ships as a secondary entry point, so apps that never use it don't load it:

```ts
import { layered } from 'ngx-node-flow/layout';

const { nodes, edges } = await flow.snapshot();
await flow.moveNodes(layered(nodes, edges)); // left-to-right layers; one undo step
```

`layered()` is a plain O(nodes + edges) function (Kahn layering, one barycenter pass to reduce crossings, cycles broken in input order). For very large graphs, run it in your own worker.

Navigation and layout aids:

- `[minimap]="true"` (default) shows the whole graph in the bottom-right corner, drawn in the worker as a density image (redrawn at most 4 times a second while the graph changes). Click or drag in it to move the view.
- `provideNodeFlow({ grid: { snap: true } })` drops dragged nodes on grid points. `grid.guides` (on by default) snaps a dragged node to the edges and centers of the nodes on screen and draws the guide line; it wins over grid snapping.

Selection and keyboard: click selects; Shift/Ctrl/Cmd+click toggles; Shift+drag on empty space draws a selection rectangle; dragging a selected node moves the whole selection; clicking an edge selects it. The component is one focusable widget (`role="application"`, described by `labels.keyboardHelp`), and a live region announces the focused node:

| key | action |
|---|---|
| arrows | focus and select the nearest node in that direction (Ctrl/Cmd+arrows: focus only) |
| Space | add/remove the focused node from the selection |
| Shift+arrows | move the selection by one grid step |
| Enter | edit the focused node |
| Delete / Backspace | remove the selection |
| C, then arrows, then Enter | connect the first compatible free output of the first node to an input of the second |
| Ctrl+Z, Ctrl+Shift+Z / Ctrl+Y | undo, redo |
| Ctrl+A, Ctrl+C, Ctrl+V, Ctrl+D | select all, copy, paste, duplicate |
| Escape | clear the selection, cancel connect mode |

Tab leaves the canvas (into the node menu, then out), so it is never a keyboard trap. Copy writes JSON to the clipboard, and paste only accepts that format, validated before it reaches the graph.

Build with `npm run build:lib` (it bundles the worker first). Pages with a CSP need `worker-src blob:`.

## Theme

The `theme` option is optional. Tokens you leave out use `DEFAULT_NODE_FLOW_THEME`. A value can be any CSS, so you can point it at your design system's tokens:

```ts
provideNodeFlow({
  theme: {
    accent: 'var(--ds-color-primary)',
    surface: 'var(--ds-color-surface)',
    fontFamily: 'var(--ds-font-family)',
    nodeColor: 'light-dark(#e2e8f0, #2d3748)',
  },
});
```

Each token has a **public** CSS custom property (`--nf-*`). You can set it in your own CSS, and it overrides the provider:

```css
ngx-node-flow { --nf-node-color: var(--ds-color-neutral-200); }
```

Precedence: `--nf-*` in your CSS > `theme` in the provider > the library default. Internally the library reads only the **private** properties (`--__nf-*`), defined as `var(--nf-x, <theme value>)`, so they always have a fallback. Do not set the `--__nf-*` properties.

| token | public property | used for |
|---|---|---|
| `background` | `--nf-background` | canvas background |
| `gridColor` | `--nf-grid-color` | grid lines |
| `nodeColor` | `--nf-node-color` | node body |
| `nodeSelectedColor` | `--nf-node-selected-color` | selected node |
| `nodeTextColor` | `--nf-node-text-color` | labels on the canvas |
| `portColor` | `--nf-port-color` | ports |
| `edgeColor` | `--nf-edge-color` | edges |
| `surface` | `--nf-surface` | menu, side sheet, "first node" button |
| `text` | `--nf-text` | menu and side sheet text |
| `border` | `--nf-border` | borders and dividers |
| `accent` | `--nf-accent` | focus ring, primary button |
| `accentText` | `--nf-accent-text` | text on the accent color |
| `statusRunning` | `--nf-status-running` | running badge |
| `statusSuccess` | `--nf-status-success` | success badge |
| `statusError` | `--nf-status-error` | error badge, error list |
| `fontFamily` | `--nf-font-family` | overlays and canvas labels |
| `radius` | `--nf-radius` | overlay corner radius |

The canvas colors are resolved on the main thread and sent to the worker again whenever the theme may have changed: a `prefers-color-scheme` change, or a change to `class`, `style`, `data-theme` or `data-mode` on `<html>`, `<body>` or the component.

**Limitation:** web fonts loaded by the page are not available inside the worker. Canvas labels fall back to the generic family in your stack (for example `sans-serif`). DOM overlays use the real font.
