Li a `main` com `git show`, sem trocar de branch. Antes tentei um checkout que teria sobrescrito a working tree; ele foi bloqueado e nada foi alterado. A base mudou bastante desde a primeira revisão:
- o worker passou a ser a única fonte de verdade;
- o store usa colunas em typed arrays com adjacência direcional;
- entraram `createNode`, `beforeRemove`, `labels`, o output `error`, `allowCycles` com `edgeRejected`, pinça para zoom e um id de diálogo único por instância.

A lista abaixo parte desse estado.

## Antes de escolher features

Duas restrições da arquitetura filtram o que cabe na lib:

1. **Funções não cruzam para o worker.** Toda regra que precisa rodar enquanto o usuário interage (arrastar, hover) tem de ser declarativa: dados que o worker avalia sozinho. Callbacks como `beforeRemove` só funcionam em eventos discretos (soltar, remover), onde uma ida e volta de mensagem não incomoda.
2. **O diferencial da lib é escala, não nó rico.** Bibliotecas baseadas em DOM sempre vão ganhar em conteúdo customizado dentro do nó. Eu priorizaria features que aproveitam o worker e o índice espacial, em vez de tentar igualar o que elas fazem bem.

## Features, por prioridade

### Base: sem isso a lib parece incompleta

| Feature | Situação atual | Observação |
|---|---|---|
| **API imperativa**: `fitView()`, `centerOn(id)`, `zoomTo()`, `select(ids)`, `snapshot()` | Só existe `load()` | Sem `snapshot()`, persistir depende de acumular cada `graphChange`, e um consumidor que perdeu um evento não consegue se recuperar |
| **Modo somente leitura** e `locked` por nó | Não existe | Barato de fazer e pedido logo cedo |
| **Seleção múltipla**: shift+clique, seleção por retângulo, mover e remover o grupo | Seleção de um nó só | A seleção por retângulo é praticamente o `store.query(rect)`, que já existe |
| **Selecionar e remover aresta** | Só dá para desconectar pegando a entrada e soltando no vazio | Precisa de hit-test na curva. Hoje ninguém descobre esse gesto sozinho |
| **Teclado**: Tab e setas entre nós, Delete, setas para mover, Esc, Ctrl+A | Não existe | Feature e acessibilidade ao mesmo tempo. O canvas continua `role="img"`, ou seja, falha o WCAG 2.1.1 (nível A) |
| **Undo/redo** | Não existe | Ver a decisão logo abaixo |
| **Copiar, colar e duplicar** | Não existe | Remapeamento de ids no worker. A Clipboard API fica na thread principal |

O undo/redo afeta o contrato público. Hoje `GraphChanges` só carrega o estado novo (`upsertNodes`). Para desfazer, alguém precisa conhecer o estado anterior. Há duas opções:
- **(a)** O histórico fica no worker e a lib expõe `undo()` e `redo()`.
- **(b)** `GraphChanges` passa a carregar o `before`, e o consumidor monta o próprio histórico.

A opção (a) é mais simples para quem usa. A (b) combina melhor com colaboração em tempo real. Seja qual for, mudar o formato de `GraphChanges` depois da 1.0 é uma versão major.

### Regras de conexão

- **Portas tipadas**: `{ id, label, type }`, com uma matriz de compatibilidade declarativa e `maxConnections` por porta. O worker avalia durante o arraste e pode destacar só as portas compatíveis. É o mesmo padrão do `allowCycles`, generalizado.
- **Portas com id estável continuam pendentes.** `inputs`/`outputs` ainda são `string[]`, e o `upsertNode` ainda descarta arestas quando a porta é renomeada. Se as portas tipadas entrarem, faça as duas coisas na mesma mudança que quebra compatibilidade.
- **`canConnect` assíncrono**, para regras que só o consumidor conhece. Ele roda uma única vez, ao soltar a conexão, com uma ida e volta à thread principal, como no `beforeRemove`.

### Navegar em grafos grandes, onde a lib se diferencia

- **Minimapa**: um segundo `OffscreenCanvas` em baixa resolução, desenhado no próprio worker. Com 1M de nós, é o recurso de navegação mais útil.
- **Busca e foco**: achar um nó pelo rótulo e centralizar nele. Com o store em colunas, uma varredura linear de 1M rótulos custa poucas dezenas de ms no worker. Para mais do que isso, um índice.
- **Grupos ou frames com recolher/expandir**: um subgrafo recolhido vira um único retângulo. É o recurso que mais reduz custo de renderização e de leitura ao mesmo tempo.
- **Nível de detalhe**: hoje as portas somem abaixo de 0,3 de zoom e o texto abaixo de 0,35. Dá para ir além: em zoom bem baixo, agregar regiões densas em blocos, ou desenhar as arestas mais finas e simplificadas.
- **Alinhamento ao grid e guias de alinhamento**: barato e esperado por quem usa.

### Estado visual, sem nó rico

- **Status por nó** (`idle`, `running`, `success`, `error`) desenhado como uma borda ou um selo, além de uma lista de erros de validação por nó.
- **`highlight(nodeIds, edgeIds)`**: caminho percorrido, resultado de busca, trace de execução.
- **Estilos de aresta**: tracejada, animada (fluxo "rodando"), com rótulo, e roteamento bezier, em degraus ou reto.
- **Ícones e formas** por nó, carregados numa textura atlas. Isso cobre uns 80% do que as pessoas pedem como "nó customizado" sem sair do canvas.
- **Conteúdo rico**: se for oferecer, faça híbrido. O canvas desenha todos os nós, e um template Angular em DOM aparece só sobre o nó selecionado, como o menu já faz hoje. Template Angular em todos os nós contradiz a arquitetura.

### Organização e dados

- **Layout automático** em camadas: Kahn mais atribuição de camadas, rodando no worker. Publique como entry point secundário (`ngx-node-flow/layout`), para quem não usa não carregar o código.
- **Exportar imagem**: `OffscreenCanvas.convertToBlob()` no worker. Uma tarde de trabalho.
- **Notas e comentários** soltos no canvas.
- **Colaboração em tempo real**: a lib não deve trazer CRDT. A parte dela é expor `applyChanges(remote, { silent: true })`, ou seja, aplicar mudanças vindas de fora sem reemiti-las como `graphChange`. O Yjs ou outra solução fica com o consumidor.

## O que não deve entrar na lib

Motor de execução, formulários de nó prontos, HTTP, persistência, CRDT e tipos de nó de domínio. É o mesmo corte da conversa sobre a URA: se só faz sentido num produto, vai para um pacote à parte.

## Ordem que eu sugiro

1. **API imperativa, `snapshot()` e somente leitura.** Pequeno, e destrava quem integra a lib.
2. **Modelo de seleção** (múltipla, retângulo, aresta) **e teclado**. Resolve a maior lacuna de uso e de acessibilidade de uma vez.
3. **Decidir o formato do undo/redo e de `GraphChanges`, depois implementar.**
4. **Portas com id e tipo, e regras de conexão declarativas.** Mudança que quebra compatibilidade: agrupe com o passo 3 numa mesma versão.
5. **Minimapa, `fitView`, busca e alinhamento ao grid.**
6. **Status, `highlight` e estilos de aresta.**
7. **Grupos e recolher, layout automático como entry point separado, exportar imagem.**

Os passos 1 a 4 definem o contrato público. Os passos 5 a 7 são aditivos e podem entrar em versões menores depois. Por isso eu publicaria uma 0.x só depois de fechar o passo 4.