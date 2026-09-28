# ScaleGo

Gerador de escala de revezamento em 5 passos (pessoas, período, dias, ajustes,
estilo e exportação). Sem backend: tudo roda estático e os dados ficam salvos
no `localStorage` do navegador de quem está usando — sem conta, sem login,
sem servidor.

## Estrutura

- `index.html` — landing page (raiz do site, é o que abre em `scalego.app`/GitHub Pages).
- `app.html` — o gerador de escala em si (pra onde os botões "Criar escala" da landing apontam).
- `app.js` / `styles.css` — lógica e estilos do `app.html`.
- `assets/` — screenshots reais do app usados na landing.

## Rodando localmente

```
python3 -m http.server 8000
```

Depois abra `http://localhost:8000` (landing) ou `http://localhost:8000/app.html` (o gerador de escala direto).

## Stack

- HTML + Tailwind (via CDN, classes com valores arbitrários `[...]` pra bater
  pixel a pixel com o design) + JavaScript puro, sem passo de build.
- Fonte "Plus Jakarta Sans" via Google Fonts, igual ao design aprovado.
- [Tucano](https://juniorcarlini.github.io/tucano/) via CDN para o modal de
  troca (`Tucano.Modal`, tamanho `md`), o alerta de "dias precisam de alguém"
  (`tuc-alert is-warning`) e a classe `tuc-btn` em todos os botões (só pra
  pegar a transição/foco dela — as cores e tamanhos continuam os do design).
- Código (`app.js`) em inglês; textos de tela em português.

O visual e a lógica do assistente de 5 passos foram portados 1:1 do design
aprovado no Claude Design ("ScaleGo Passo a Passo v2"), que não usa Tucano —
por isso cores, raios e espaçamentos são todos customizados via classes
arbitrárias do Tailwind, e não vêm da lib.

## Como o revezamento é gerado

`generateSchedule` (em `app.js`) é uma função pura, também portada do design
original: dado o estado atual da escala (pessoas, meses, dias da semana,
pessoas por dia, disponibilidade, modo de revezamento e uma seed), ela
recalcula o rodízio do zero a cada renderização — não existe um "botão gerar"
separado, qualquer mudança de regra já reflete na hora. A ordem de prioridade
pra escalar alguém é: quem tem menos dias até agora, depois quem foi escalado
há mais tempo, depois uma ordem aleatória fixa (seed) — isso evita que a mesma
pessoa fique presa numa sequência.

Trocas manuais feitas no Passo 4 ficam em `schedule.overrides` e são
descartadas sempre que uma regra de geração muda (pessoas, período, dias,
pessoas por dia, disponibilidade, modo de revezamento ou "Embaralhar"), pra
escala nunca ficar inconsistente — mesmo comportamento do design original.

## Exportação

- **WhatsApp** e **Copiar**: geram o mesmo texto formatado (`*Nome da
  escala*`, um bloco por mês, uma linha por dia).
- **PDF**: usa `window.print()` com uma folha de estilo `@media print` — o
  navegador oferece "Salvar como PDF" no próprio diálogo de impressão.
- **Planilha**: gera um `.csv` com `;` como separador e BOM UTF-8 (abre certo
  no Excel, acentos incluídos), sem depender de nenhuma biblioteca externa.

## Convidar por link (Passo 4)

Funcionalidade extra, fora do design original: o botão "Convidar por link" (ao
lado de "Disponibilidade") gera um link com o estado necessário (id da escala,
nome, lista de pessoas, dias da semana perguntáveis) codificado em base64 no
próprio fragmento da URL (`#invite=...`) — nunca sai do navegador, nenhum
servidor guarda nada.

Quem recebe abre o link, escolhe o próprio nome (só entre quem já está na
lista de pessoas) e vê o calendário de verdade (as mesmas datas do Passo 4,
não os dias da semana em abstrato) pra marcar as datas específicas que NÃO
pode — "não posso dia 12" é diferente de "não posso todo sábado". Isso gera um
segundo link (`#response=...`) que a pessoa manda de volta. Quando esse link é
aberto no navegador de quem organiza, aparece uma tela de confirmação — ao
importar, as datas marcadas viram `schedule.dateBlocks[pessoa]` e a escala já
é levada direto pro Passo 4 pra mostrar o resultado.

Isso é separado do painel "Disponibilidade" (que bloqueia um dia da semana
inteiro, recorrente, tipo "não pode nenhum domingo") — os dois bloqueios
(recorrente e por data específica) valem ao mesmo tempo na hora de gerar a
escala.

Tudo isso é roteado em `app.js` por `parseRoute()`, lido uma vez no carregamento
e de novo a cada evento `hashchange` (cobre o caso de colar um link diferente
numa aba que já está aberta).

## Publicar no GitHub Pages

1. `git init`, primeiro commit.
2. Criar um repositório novo no GitHub e dar push.
3. Nas configurações do repositório, ativar GitHub Pages apontando para a
   branch `main`, pasta raiz — como não tem build, os arquivos já são o site.

## Ideia para depois (fase 2)

Se o uso local (um dispositivo só) deixar de ser suficiente, dá para trocar só
a camada de persistência por um banco serverless gratuito (Firebase/Supabase)
usando um "código da escala" como chave, sem mudar o resto do app.
