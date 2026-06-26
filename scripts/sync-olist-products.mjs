import fs from "node:fs/promises";
import path from "node:path";

const ENDPOINTS = {
  search: "https://api.tiny.com.br/api2/produtos.pesquisa.php",
  detail: "https://api.tiny.com.br/api2/produto.obter.php",
  stock: "https://api.tiny.com.br/api2/produto.obter.estoque.php",
  productUpdates: "https://api.tiny.com.br/api2/lista.atualizacoes.produtos.php",
  stockUpdates: "https://api.tiny.com.br/api2/lista.atualizacoes.estoque.php",
};

const token = process.env.OLIST_TINY_TOKEN;
const developerId = process.env.OLIST_TINY_DEVELOPER_ID;
const search = process.env.OLIST_TINY_SEARCH ?? "";
const status = process.env.OLIST_TINY_STATUS ?? "A";
const outputPath = process.env.OLIST_PRODUCTS_OUTPUT ?? "data/products.json";
const syncMode = process.env.OLIST_TINY_SYNC_MODE ?? "smart";
const maxPages = Number(process.env.OLIST_TINY_MAX_PAGES ?? "200");
const maxProducts = Number(process.env.OLIST_TINY_MAX_PRODUCTS ?? "0");
const listDelayMs = Number(process.env.OLIST_TINY_LIST_DELAY_MS ?? "250");
const requestDelayMs = Number(
  process.env.OLIST_TINY_REQUEST_DELAY_MS ?? process.env.OLIST_TINY_DETAIL_DELAY_MS ?? "700"
);
const blockedRetryMs = Number(process.env.OLIST_TINY_BLOCKED_RETRY_MS ?? "60000");
const maxRetries = Number(process.env.OLIST_TINY_MAX_RETRIES ?? "6");
const requestTimeoutMs = Number(process.env.OLIST_TINY_REQUEST_TIMEOUT_MS ?? "30000");
const incrementalLookbackHours = Number(process.env.OLIST_TINY_INCREMENTAL_LOOKBACK_HOURS ?? "4");

if (!token) {
  throw new Error("Defina OLIST_TINY_TOKEN no ambiente ou nos secrets do GitHub.");
}

const previousOutput = await readPreviousOutput();
const previousProducts = previousOutput.products ?? [];
const previousById = new Map(previousProducts.map((product) => [String(product.id), product]));
const previousByCode = new Map(previousProducts.map((product) => [String(product.code), product]));

const canIncremental =
  syncMode !== "full" &&
  previousOutput.source === "olist-tiny-api" &&
  previousOutput.cacheComplete === true &&
  previousProducts.length > 0;

const result = canIncremental ? await runIncrementalSync() : await runFullSync();
await writeOutput(result);

async function runFullSync() {
  console.log("Executando sincronizacao completa otimizada.");
  const listed = await listProducts();
  const selected = maxProducts > 0 ? listed.slice(0, maxProducts) : listed;
  const products = [];
  let detailCalls = 0;
  let stockCalls = 0;

  for (let index = 0; index < selected.length; index += 1) {
    const item = selected[index];
    const id = String(item.id ?? "");
    if (!id) continue;

    try {
      const cached = previousById.get(id) ?? previousByCode.get(String(item.codigo ?? ""));
      await wait(requestDelayMs);
      const stockProduct = await getProductStock(id);
      stockCalls += 1;

      const stockAmount = numberFromTiny(stockProduct.saldo);
      if (stockAmount <= 0) continue;

      let detail = {};
      if (needsDetail(item, cached)) {
        await wait(requestDelayMs);
        detail = await getProductDetail(id).catch((error) => {
          console.warn(`Detalhes indisponiveis para produto ${id}: ${error.message}`);
          return {};
        });
        detailCalls += 1;
      }

      const normalized = normalizeProduct({ ...cached, ...item, ...detail }, stockProduct, cached);
      if (normalized.stock > 0) products.push(normalized);
    } catch (error) {
      console.warn(`Produto ${id} ignorado: ${error.message}`);
    }

    if ((index + 1) % 25 === 0) {
      console.log(`Processados ${index + 1}/${selected.length} produtos.`);
    }
  }

  return buildOutput(products, {
    mode: "full",
    listedTotal: listed.length,
    processedTotal: selected.length,
    detailCalls,
    stockCalls,
    cacheComplete: maxProducts <= 0 && selected.length === listed.length,
  });
}

async function runIncrementalSync() {
  const changedSince = process.env.OLIST_TINY_CHANGED_SINCE || tinyDateTimeFromIso(previousOutput.updatedAt);
  console.log(`Executando sincronizacao incremental desde ${changedSince}.`);

  const cache = new Map(previousProducts.map((product) => [String(product.id), { ...product }]));
  let productUpdates = [];
  let stockUpdates = [];
  let detailCalls = 0;
  let stockCalls = 0;

  try {
    productUpdates = await listProductUpdates(changedSince);
  } catch (error) {
    console.warn(`Incremental de produtos indisponivel: ${error.message}`);
    return buildOutput(previousProducts, {
      mode: "incremental-cache",
      listedTotal: previousOutput.listedTotal ?? previousProducts.length,
      processedTotal: 0,
      detailCalls: 0,
      stockCalls: 0,
      cacheComplete: true,
      changedSince,
      changedProductsTotal: 0,
      changedStockTotal: 0,
    });
  }

  try {
    stockUpdates = await listStockUpdates(changedSince);
  } catch (error) {
    console.warn(`Incremental de estoque indisponivel: ${error.message}`);
  }

  for (const update of stockUpdates) {
    const id = String(update.id ?? update.idProduto ?? update.id_produto ?? "");
    const cached = cache.get(id);
    if (!cached) continue;

    const stock = numberFromTiny(update.saldo ?? update.estoque ?? update.quantidade ?? cached.stock);
    cached.stock = stock;
    if (stock <= 0) cache.delete(id);
  }

  const changedProducts = dedupeById(productUpdates);
  for (let index = 0; index < changedProducts.length; index += 1) {
    const item = changedProducts[index];
    const id = String(item.id ?? "");
    if (!id) continue;

    try {
      await wait(requestDelayMs);
      const detail = await getProductDetail(id);
      detailCalls += 1;

      await wait(requestDelayMs);
      const stockProduct = await getProductStock(id);
      stockCalls += 1;

      const cached = cache.get(id) ?? previousByCode.get(String(detail.codigo ?? item.codigo ?? ""));
      const normalized = normalizeProduct({ ...cached, ...item, ...detail }, stockProduct, cached);
      if (normalized.stock > 0) {
        cache.set(normalized.id, normalized);
      } else {
        cache.delete(id);
      }
    } catch (error) {
      console.warn(`Produto alterado ${id} ignorado: ${error.message}`);
    }

    if ((index + 1) % 25 === 0) {
      console.log(`Alterados processados ${index + 1}/${changedProducts.length}.`);
    }
  }

  return buildOutput(Array.from(cache.values()), {
    mode: "incremental",
    listedTotal: previousOutput.listedTotal ?? previousProducts.length,
    processedTotal: changedProducts.length + stockUpdates.length,
    detailCalls,
    stockCalls,
    cacheComplete: true,
    changedSince,
    changedProductsTotal: changedProducts.length,
    changedStockTotal: stockUpdates.length,
  });
}

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
    await wait(listDelayMs);
  } while (page <= pageCount && page <= maxPages);

  return products;
}

async function listProductUpdates(changedSince) {
  return listPagedUpdates(ENDPOINTS.productUpdates, changedSince, "produtos", "produto");
}

async function listStockUpdates(changedSince) {
  return listPagedUpdates(ENDPOINTS.stockUpdates, changedSince, "produtos", "produto");
}

async function listPagedUpdates(url, changedSince, collectionKey, itemKey) {
  const items = [];
  let page = 1;
  let pageCount = 1;

  do {
    const retorno = await tinyPost(url, {
      dataAlteracao: changedSince,
      pagina: String(page),
      __noRetry: "1",
    }).catch((error) => {
      if (error.message.includes("A consulta nao retornou registros") || error.message.includes("A consulta não retornou registros")) {
        return { numero_paginas: 1, [collectionKey]: [] };
      }
      throw error;
    });

    pageCount = Number(retorno.numero_paginas || 1);
    const collection = retorno[collectionKey] || retorno.registros || [];
    for (const entry of collection) {
      items.push(entry[itemKey] ?? entry);
    }

    page += 1;
    await wait(listDelayMs);
  } while (page <= pageCount && page <= maxPages);

  return items;
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
  const { __attempt = "0", __noRetry = "0", ...apiParams } = params;
  const payload = new URLSearchParams({
    token,
    formato: "JSON",
    ...apiParams,
  });

  const attempt = Number(__attempt);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
  let response;

  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        ...(developerId ? { "Developer-Id": developerId } : {}),
      },
      body: payload,
      signal: controller.signal,
    });
  } catch (error) {
    if (__noRetry !== "1" && attempt < maxRetries) {
      console.log(
        `Falha temporaria em ${url}. Aguardando ${blockedRetryMs / 1000}s para retry ${attempt + 1}/${maxRetries}.`
      );
      await wait(blockedRetryMs);
      return tinyPost(url, { ...params, __attempt: String(attempt + 1) });
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }

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
    if (__noRetry !== "1" && attempt < maxRetries && (errors.includes("API Bloqueada") || errors.includes("Erro interno"))) {
      console.log(
        `API indisponivel em ${url}. Aguardando ${blockedRetryMs / 1000}s para retry ${attempt + 1}/${maxRetries}: ${errors}`
      );
      await wait(blockedRetryMs);
      return tinyPost(url, { ...params, __attempt: String(attempt + 1) });
    }
    throw new Error(`Tiny/Olist retornou erro em ${url}: ${errors}`);
  }

  return retorno;
}

function normalizeProduct(product, stockProduct, cached = {}) {
  const category = clean(product.categoria) || clean(product.category) || "Sem categoria";
  const stock = numberFromTiny(stockProduct.saldo ?? product.saldo ?? product.stock);
  const imageUrl = firstImage(product) || clean(product.imageUrl) || clean(cached.imageUrl);

  return {
    id: String(product.id ?? stockProduct.id ?? cached.id ?? ""),
    code: clean(product.codigo ?? product.code),
    name: clean(product.nome ?? product.name),
    description: clean(product.nome ?? product.description ?? product.name),
    category,
    barcode: clean(product.gtin || product.gtin_embalagem || product.barcode),
    imageUrl,
    price: numberFromTiny(product.preco ?? product.price),
    stock,
  };
}

function needsDetail(product, cached) {
  if (!cached) return true;
  if (!clean(cached.category) || cached.category === "Sem categoria") return true;
  if (!clean(cached.imageUrl) || !isInternalImage(cached.imageUrl)) return true;
  if (!clean(cached.barcode) && !clean(product.gtin)) return true;
  return false;
}

function firstImage(product) {
  const attachment = product.anexos?.find((entry) => clean(entry?.anexo));
  return attachment ? clean(attachment.anexo) : "";
}

function isInternalImage(url) {
  return clean(url).includes("tiny-anexos");
}

function buildOutput(products, metadata) {
  const filtered = products
    .map((product) => ({ ...product, stock: numberFromTiny(product.stock), price: numberFromTiny(product.price) }))
    .filter((product) => product.id && product.name && product.stock > 0);

  filtered.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));

  return {
    updatedAt: new Date().toISOString(),
    source: "olist-tiny-api",
    syncMode: metadata.mode,
    cacheComplete: metadata.cacheComplete,
    total: filtered.length,
    listedTotal: metadata.listedTotal,
    processedTotal: metadata.processedTotal,
    detailCalls: metadata.detailCalls,
    stockCalls: metadata.stockCalls,
    changedSince: metadata.changedSince,
    changedProductsTotal: metadata.changedProductsTotal,
    changedStockTotal: metadata.changedStockTotal,
    fields: [
      "CODIGO/SKU",
      "DESCRICAO",
      "CATEGORIAS",
      "CODIGO DE BARRAS",
      "LINK FOTO",
      "VALOR",
      "ESTOQUE",
    ],
    products: filtered,
  };
}

async function writeOutput(output) {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  console.log(
    `Sincronizados ${output.total} produtos em ${outputPath}. Modo=${output.syncMode}; detalhes=${output.detailCalls}; estoque=${output.stockCalls}.`
  );
}

async function readPreviousOutput() {
  try {
    return JSON.parse(await fs.readFile(outputPath, "utf8"));
  } catch {
    return {};
  }
}

function dedupeById(items) {
  const map = new Map();
  for (const item of items) {
    const id = String(item.id ?? item.idProduto ?? item.id_produto ?? "");
    if (id) map.set(id, { ...item, id });
  }
  return Array.from(map.values());
}

function tinyDateTimeFromIso(value) {
  const base = value ? new Date(value) : new Date();
  const shifted = new Date(base.getTime() - incrementalLookbackHours * 60 * 60 * 1000);
  const formatter = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  return formatter.format(shifted).replace(",", "");
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
