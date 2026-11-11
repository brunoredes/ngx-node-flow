# ngx-node-flow

Interactive flowgraph for Angular. Nodes and edges are drawn with WebGL2 + Canvas 2D on an `OffscreenCanvas` inside a Web Worker.

```ts
// app.config.ts
providers: [provideNodeFlow({ grid: { size: 24 } })]
```

```html
<ngx-node-flow [(nodes)]="nodes" [(edges)]="edges">
  <ng-template nodeFlowEditor let-draft>
    <!-- your form; `draft` is a WritableSignal<FlowNode>, applied on Save -->
  </ng-template>
</ngx-node-flow>
```

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
| `fontFamily` | `--nf-font-family` | overlays and canvas labels |
| `radius` | `--nf-radius` | overlay corner radius |

The canvas colors are resolved on the main thread and sent to the worker again whenever the theme may have changed: a `prefers-color-scheme` change, or a change to `class`, `style`, `data-theme` or `data-mode` on `<html>`, `<body>` or the component.

**Limitation:** web fonts loaded by the page are not available inside the worker. Canvas labels fall back to the generic family in your stack (for example `sans-serif`). DOM overlays use the real font.
