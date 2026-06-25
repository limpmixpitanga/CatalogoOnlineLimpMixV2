import fs from "node:fs/promises";
import path from "node:path";

const ENDPOINTS = {
  search: "https://api.tiny.com.br/api2/produtos.pesquisa.php",
  detail: "https://api.tiny.com.br/api2/produto.obter.php",
  stock: "https://api.tiny.com.br/api2/produto.obter.estoque.php",
};

const token = process.env.OLIST_TINY_TOKEN;
const developerId = process.env.OLIST_TINY_DEVELOPER_ID;
const search = process.env.OLIST_TINY_SEARCH ?? "";
const status = process.env.OLIST_TINY_STATUS ?? "A";
const outputPath = process.env.OLIST_PRODUCTS_OUTPUT ?? "data/products.json";
const maxPages = Number(process.env.OLIST_TINY_MAX_PAGES ?? "200");
const detailDelayMs = Number(process.env.OLIST_TINY_DETAIL_DELAY_MS ?? "280");

if (!token) {
  throw new Error("Defina OLIST_TINY_TOKEN no ambiente ou nos secrets do GitHub.");
}

const listed = await listProducts();
const products = [];

for (let index = 0; index < listed.length; index += 1) {
  const item = listed[index];
  const id = String(item.id ?? "");
  if (!id) continue;

  const [detail, stock] = await Promise.all([
    getProductDetail(id),
    getProductStock(id),
  ]);
  const normalized = normalizeProduct({ ...item, ...detail }, stock);
  if (normalized.stock > 0) products.push(normalized);

  if ((index + 1) % 25 === 0) {
    console.log(`Processados ${index + 1}/${listed.length} produtos.`);
  }
  await wait(detailDelayMs);
}

products.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));

const output = {
  updatedAt: new Date().toISOString(),
  source: "olist-tiny-api",
  total: products.length,
  fields: [
    "CODIGO/SKU",
    "DESCRICAO",
    "CATEGORIAS",
    "CODIGO DE BARRAS",
    "LINK FOTO",
    "VALOR",
    "ESTOQUE",
  ],
  products,
};

await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
console.log(`Sincronizados ${products.length} produtos com estoque em ${outputPath}.`);

async function listProducts() {
  const products = [];
  let page = 1;
  let pageCount = 1;

  do {
    const retorno = await tinyPost(ENDPOINTS.search, {
      pesquisa: search,
      situacao: status,
      pagina: String(page),
    });

    pageCount = Number(retorno.numero_paginas || 1);
    for (const entry of retorno.produtos || []) {
      if (entry.produto) products.push(entry.produto);
    }

    page += 1;
    await wait(350);
  } while (page <= pageCount && page <= maxPages);

  return products;
}

async function getProductDetail(id) {
  const retorno = await tinyPost(ENDPOINTS.detail, { id });
  return retorno.produto ?? {};
}

async function getProductStock(id) {
  const retorno = await tinyPost(ENDPOINTS.stock, { id });
  return retorno.produto ?? {};
}

async function tinyPost(url, params) {
  const payload = new URLSearchParams({
    token,
    formato: "JSON",
    ...params,
  });

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      ...(developerId ? { "Developer-Id": developerId } : {}),
    },
    body: payload,
  });

  if (!response.ok) {
    throw new Error(`Tiny/Olist retornou HTTP ${response.status} em ${url}.`);
  }

  const data = await response.json();
  const retorno = data?.retorno;
  if (!retorno) throw new Error(`Resposta inesperada da Tiny/Olist em ${url}.`);

  if (retorno.status !== "OK") {
    const errors = Array.isArray(retorno.erros)
      ? retorno.erros.map((item) => item.erro).join("; ")
      : "erro sem detalhes";
    throw new Error(`Tiny/Olist retornou erro em ${url}: ${errors}`);
  }

  return retorno;
}

function normalizeProduct(product, stockProduct) {
  const category = clean(product.categoria) || "Sem categoria";
  const stock = numberFromTiny(stockProduct.saldo ?? product.saldo);

  return {
    id: String(product.id ?? stockProduct.id ?? ""),
    code: clean(product.codigo),
    name: clean(product.nome),
    description: stripHtml(clean(product.descricao_complementar || product.nome)),
    category,
    barcode: clean(product.gtin || product.gtin_embalagem),
    imageUrl: firstImage(product),
    price: numberFromTiny(product.preco),
    promotionalPrice: numberFromTiny(product.preco_promocional),
    stock,
    reservedStock: numberFromTiny(stockProduct.saldoReservado),
    unit: clean(product.unidade),
    status: clean(product.situacao),
    createdAt: clean(product.data_criacao) || null,
  };
}

function firstImage(product) {
  const external = product.imagens_externas?.find((entry) => {
    return clean(entry?.imagem_externa?.url);
  });
  if (external) return clean(external.imagem_externa.url);

  const attachment = product.anexos?.find((entry) => clean(entry?.anexo));
  return attachment ? clean(attachment.anexo) : "";
}

function stripHtml(value) {
  return value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function numberFromTiny(value) {
  const parsed = Number.parseFloat(String(value ?? "0").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : 0;
}

function clean(value) {
  return String(value ?? "").trim();
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
