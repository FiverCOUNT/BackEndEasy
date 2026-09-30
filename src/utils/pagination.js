const DEFAULT_PAGE_SIZE = 25;
const MOBILE_DEFAULT_PAGE_SIZE = 10;
const MAX_PAGE_SIZE = 100;
/** Listas del panel web /app: cargar de a 10 con “Ver más”. */
const LOAD_MORE_STEP = 10;

function parseListQuery(query) {
  const q = (query.q || '').trim();
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limitRaw = parseInt(query.limit ?? query.pageSize, 10);
  const pageSize = Math.min(
    MAX_PAGE_SIZE,
    Math.max(10, Number.isFinite(limitRaw) ? limitRaw : DEFAULT_PAGE_SIZE)
  );
  return { q, page, pageSize, skip: (page - 1) * pageSize };
}

/**
 * Carga acumulativa: ?limit=10 → 20 → 30…
 * Siempre skip=0; pageSize = cuántos ítems mostrar ahora.
 */
function parseLoadMoreQuery(query, { step = LOAD_MORE_STEP } = {}) {
  const q = (query.q || '').trim();
  const stepSafe = Math.max(1, Number(step) || LOAD_MORE_STEP);
  const limitRaw = parseInt(query.limit ?? query.pageSize, 10);
  const limit = Math.min(
    MAX_PAGE_SIZE,
    Math.max(stepSafe, Number.isFinite(limitRaw) ? limitRaw : stepSafe),
  );
  // Redondea al múltiplo de step más cercano hacia arriba (p. ej. 15 → 20).
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.ceil(limit / stepSafe) * stepSafe);
  return { q, page: 1, pageSize, skip: 0, step: stepSafe };
}

/** Listas de la app móvil: 10 por página; el cliente pide la siguiente con “Ver más”. */
function parseMobileListQuery(query, { defaultSize = MOBILE_DEFAULT_PAGE_SIZE } = {}) {
  const q = (query.q || query.buscar || '').trim();
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limitRaw = parseInt(query.limit ?? query.pageSize, 10);
  const pageSize = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, Number.isFinite(limitRaw) ? limitRaw : defaultSize),
  );
  return { q, page, pageSize, skip: (page - 1) * pageSize };
}

function buildMobilePageMeta({ total, page, pageSize }) {
  const totalCount = Number.isFinite(total) ? Math.max(0, total) : 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize) || 1);
  const safePage = Math.min(Math.max(1, page), totalPages);
  return {
    total: totalCount,
    page: safePage,
    pageSize,
    totalPages,
    hasMore: safePage * pageSize < totalCount,
  };
}

function sendMobilePage(res, { items, total, page, pageSize, extra = {} }) {
  const meta = buildMobilePageMeta({ total, page, pageSize });
  return res.json({
    success: true,
    items: items || [],
    ...meta,
    ...extra,
  });
}

function buildPageMeta({ total, page, pageSize, basePath, query = {} }) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages);

  const buildUrl = (targetPage) => {
    const params = new URLSearchParams();
    Object.entries(query).forEach(([key, value]) => {
      if (value != null && value !== '') params.set(key, String(value));
    });
    if (targetPage > 1) params.set('page', String(targetPage));
    if (pageSize !== DEFAULT_PAGE_SIZE) params.set('limit', String(pageSize));
    const qs = params.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  };

  const from = total === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const to = Math.min(safePage * pageSize, total);

  return {
    page: safePage,
    pageSize,
    total,
    totalPages,
    from,
    to,
    hasPrev: safePage > 1,
    hasNext: safePage < totalPages,
    prevUrl: buildUrl(safePage - 1),
    nextUrl: buildUrl(safePage + 1),
    firstUrl: buildUrl(1),
    lastUrl: buildUrl(totalPages),
  };
}

/**
 * Meta para botón “Ver más” (carga acumulativa).
 * @param {{ total: number, limit: number, step?: number, basePath: string, query?: object }} opts
 */
function buildLoadMoreMeta({
  total,
  limit,
  step = LOAD_MORE_STEP,
  basePath,
  query = {},
}) {
  const totalCount = Number.isFinite(total) ? Math.max(0, total) : 0;
  const shown = Math.min(Math.max(0, limit), totalCount);
  const nextLimit = Math.min(MAX_PAGE_SIZE, limit + step);
  const hasMore = shown < totalCount && nextLimit > limit;

  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    if (value == null || value === '') return;
    if (key === 'limit' || key === 'page' || key === 'pageSize') return;
    params.set(key, String(value));
  });
  if (hasMore) params.set('limit', String(nextLimit));
  const qs = params.toString();
  const nextUrl = qs ? `${basePath}?${qs}` : basePath;

  return {
    total: totalCount,
    shown,
    limit,
    step,
    hasMore,
    nextLimit,
    nextUrl,
    from: totalCount === 0 ? 0 : 1,
    to: shown,
  };
}

/** Pickers sheet web: ?offset=0&limit=10&q=… */
function parseOffsetLimit(query, { defaultLimit = LOAD_MORE_STEP, maxLimit = MAX_PAGE_SIZE } = {}) {
  const q = String(query?.q || query?.buscar || '').trim();
  const offset = Math.max(0, parseInt(query?.offset, 10) || 0);
  const limitRaw = parseInt(query?.limit, 10);
  const limit = Math.min(
    maxLimit,
    Math.max(1, Number.isFinite(limitRaw) ? limitRaw : defaultLimit),
  );
  return { q, offset, limit };
}

function buildOffsetPage({ items, total, offset, limit }) {
  const list = Array.isArray(items) ? items : [];
  const totalCount = Number.isFinite(total) ? Math.max(0, total) : list.length;
  const nextOffset = offset + list.length;
  return {
    items: list,
    total: totalCount,
    offset,
    limit,
    next_offset: nextOffset,
    has_more: nextOffset < totalCount,
  };
}

module.exports = {
  DEFAULT_PAGE_SIZE,
  MOBILE_DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  LOAD_MORE_STEP,
  parseListQuery,
  parseLoadMoreQuery,
  parseMobileListQuery,
  parseOffsetLimit,
  buildPageMeta,
  buildLoadMoreMeta,
  buildOffsetPage,
  buildMobilePageMeta,
  sendMobilePage,
};
