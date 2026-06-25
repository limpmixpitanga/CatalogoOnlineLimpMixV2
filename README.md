# Catalogo Online LimpMix V2

Sistema web de catalogo da LimpMix Pitanga para GitHub Pages, com produtos sincronizados exclusivamente pela API Olist Tiny.

Repositorio previsto:

```text
https://github.com/limpmixpitanga/CatalogoOnlineLimpMixV2
```

URL prevista:

```text
https://limpmixpitanga.github.io/CatalogoOnlineLimpMixV2/
```

## Fonte de dados

- Integracao no ERP: API do ERP
- Identificador do integrador: `13572`
- Token: deve ser cadastrado somente como secret `OLIST_TINY_TOKEN`
- Endpoints usados:
  - `produtos.pesquisa.php`
  - `produto.obter.php`
  - `produto.obter.estoque.php`

## Campos publicados

- CODIGO/SKU
- DESCRICAO
- CATEGORIAS
- CODIGO DE BARRAS
- LINK FOTO
- VALOR
- ESTOQUE

## Regras implementadas

- Carrega produtos da API via workflow do GitHub Actions.
- Exibe apenas produtos com estoque maior que zero.
- Oculta estoque zerado, negativo ou invalido.
- Mostra codigo, descricao, categoria, imagem, codigo de barras e estoque.
- Mostra preco apenas para usuarios logados na interface.
- Busca por descricao, codigo, codigo de barras e categoria.
- Busca inteligente por partes do nome, como `acend mod`.
- Categorias sao geradas dinamicamente.
- Menu lateral de categorias fica fixo no desktop.
- Orcamento usa localStorage e permanece minimizado ao adicionar produto.
- Modo de visualizacao fica salvo no navegador.
- Sessao de login fica salva no sessionStorage.

## Acessos

```text
MASTER / MASTER0022
VENDEDOR / 0022
```

- Sem login: valores aparecem como `Valor restrito`.
- VENDEDOR: ve precos, mas nao ve totais gerais.
- MASTER: ve precos, total de produtos exibidos e estoque total.

## Configuracao no GitHub

1. Crie o repositorio `limpmixpitanga/CatalogoOnlineLimpMixV2`.
2. Envie os arquivos deste projeto.
3. Em `Settings > Secrets and variables > Actions`, crie o secret:

```text
OLIST_TINY_TOKEN
```

4. Opcionalmente crie a variable:

```text
OLIST_TINY_DEVELOPER_ID=13572
```

5. Em `Settings > Pages`, use `GitHub Actions`.
6. Execute manualmente o workflow `Sincronizar produtos Olist Tiny` se quiser forcar uma atualizacao fora do horario.

## Rotina de sincronizacao

O site nao consulta a API Olist Tiny diretamente. Ele le o arquivo estatico:

```text
data/products.json
```

O GitHub Actions atualiza esse arquivo somente:

- todos os dias as 07:50 no horario de Sao Paulo;
- todos os dias as 13:00 no horario de Sao Paulo;
- manualmente pelo botao `Run workflow`.

Horarios equivalentes em UTC no cron do GitHub:

```yaml
- cron: "50 10 * * *"
- cron: "0 16 * * *"
```

Quando `data/products.json` e atualizado no Git, o GitHub Pages republica o catalogo automaticamente. Pushes comuns no repositorio apenas republicam o site com a base ja salva, sem chamar a API.

## Desenvolvimento local

```bash
npm run serve
```

Para sincronizar localmente, defina `OLIST_TINY_TOKEN` no ambiente e rode:

```bash
npm run sync:olist
```

## Observacao de seguranca

Como GitHub Pages e HTML/CSS/JS puro nao possuem backend privado, qualquer dado necessario para a tela revelar depois fica tecnicamente publico no navegador. A regra de preco restrito esta implementada na interface. Para esconder preco de forma segura contra inspecao tecnica, seria necessario backend/proxy autenticado.
