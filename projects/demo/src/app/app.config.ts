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
        keyboardHelp:
          'Setas movem entre células; Ctrl+setas movem sem selecionar. Espaço inclui ou tira a célula da seleção. ' +
          'Shift+setas movem a seleção, Enter edita, Delete remove. C, depois setas e Enter, liga duas células. ' +
          'Ctrl+Z desfaz, Ctrl+Y refaz, Ctrl+A seleciona tudo, Ctrl+C, Ctrl+V e Ctrl+D copiam, colam e duplicam. ' +
          'G recolhe ou expande o grupo da célula, Shift+G expande todos. Esc limpa a seleção.',
        selected: 'selecionada',
        connectFrom: 'Ligando: escolha a célula de destino com as setas e tecle Enter, ou Esc para cancelar',
        connectTo: 'Ligar a',
        connected: 'Ligada',
        noConnection: 'Não há portas livres compatíveis entre essas células',
        statusRunning: 'executando',
        statusSuccess: 'concluída',
        statusError: 'com erro',
        errors: 'Erros',
        groupCollapsed: 'recolhido',
        groupExpanded: 'expandido',
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
