import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideNodeFlow } from 'ngx-node-flow';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideNodeFlow({
      grid: { size: 12 },
      // the cell flow is a DAG; the streamed 1M ring is loaded data, which is not checked
      // typed cell ports: each result input only takes its own kind (see cells.ts)
      edge: { allowCycles: false, compatibility: { color: ['color'], shape: ['shape'], zoom: ['zoom'] } },
      labels: {
        canvas: 'Editor de fluxo',
        nodeActions: 'Ações da célula',
        addNode: 'Adicionar célula',
        editNode: 'Editar célula',
        removeNode: 'Remover célula',
        addFirstNode: 'Adicionar primeira célula',
        newNode: 'Nova célula',
        name: 'Nome',
        discard: 'Descartar',
        save: 'Salvar',
      },
      // design-system tokens; light-dark() follows the page color-scheme
      theme: {
        accent: 'var(--demo-accent)',
        surface: 'var(--demo-surface)',
        background: 'var(--demo-canvas)',
        text: 'light-dark(#1a202c, #e2e8f0)',
        border: 'light-dark(#cbd5e0, #ffffff33)',
        gridColor: 'light-dark(#e2e8f0, #2a2e36)',
        nodeColor: 'light-dark(#e2e8f0, #2d3748)',
        nodeSelectedColor: 'light-dark(#90cdf4, #4a6fa5)',
        portColor: 'light-dark(#4a5568, #a0aec0)',
        nodeTextColor: 'light-dark(#1a202c, #e2e8f0)',
        edgeColor: 'var(--demo-accent)',
      },
    }),
  ],
};
