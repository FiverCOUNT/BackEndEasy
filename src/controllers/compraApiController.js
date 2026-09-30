const compraModel = require('../models/compraModel');
const ssppReceptorService = require('../services/ssppReceptorService');
const sireRceImportService = require('../services/sireRceImportService');
const sunatRecibidosSyncService = require('../services/sunatRecibidosSyncService');
const { parseMobileListQuery, sendMobilePage } = require('../utils/pagination');

function apiBaseFromRequest(req) {
  const proto = req.get('x-forwarded-proto') || req.protocol || 'http';
  const host = req.get('x-forwarded-host') || req.get('host');
  return host ? `${proto}://${host}` : null;
}

async function list(req, res, next) {
  try {
    const { page, pageSize, skip } = parseMobileListQuery(req.query);
    // Solo tabla `compras` (OCR + recibidos SUNAT). Emitidos quedan en `invoices`.
    const all = await compraModel.listByCompany(req.companyRuc, {
      desde: req.query.desde,
      hasta: req.query.hasta,
      rolGre: req.query.rol_gre || req.query.rolGre || null,
    });
    all.sort((a, b) => String(b.fecha_emision || '').localeCompare(String(a.fecha_emision || '')));
    const total = all.length;
    const items = all.slice(skip, skip + pageSize);
    return sendMobilePage(res, { items, total, page, pageSize });
  } catch (err) {
    next(err);
  }
}

async function create(req, res, next) {
  try {
    const row = await compraModel.create(req.companyRuc, req.body || {});
    res.status(201).json(row);
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ success: false, message: err.message });
    }
    next(err);
  }
}

async function getById(req, res, next) {
  try {
    const row = await compraModel.findById(req.companyRuc, req.params.id);
    if (!row) {
      return res.status(404).json({ success: false, message: 'Compra no encontrada' });
    }
    res.json(row);
  } catch (err) {
    next(err);
  }
}

/**
 * POST /compras/sspp/traer
 * Prod only: descarga CPE recibido (SSPP) o importa xml_base64 (+ pdf_base64 opcional).
 * Persiste en `compras` (sentido RECIBIDO) sin mezclar con emitidos en `invoices`.
 * Sube XML (y PDF original si existe) a Cloudflare R2 sin regenerar el PDF del emisor.
 */
async function traerSspp(req, res, next) {
  try {
    const result = await ssppReceptorService.traerYRegistrarCompra(
      req.companyRuc,
      req.body || {},
      { apiBaseUrl: apiBaseFromRequest(req) },
    );
    res.status(result.creado ? 201 : 200).json(result);
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({
        success: false,
        message: err.message,
        sunat: err.sunat || undefined,
        attempts: err.attempts || undefined,
        request: err.request || undefined,
      });
    }
    next(err);
  }
}

/**
 * POST /compras/sire/traer-mes
 * Body: { periodo?: "YYYYMM" } — por defecto el mes actual (hora Perú).
 * Descarga propuesta RCE SUNAT e importa cada CPE en tabla `compras`.
 */
async function traerMesSire(req, res, next) {
  try {
    const periodo = req.body?.periodo || req.query?.periodo || null;
    const result = await sireRceImportService.importarComprasDelPeriodo(
      req.companyRuc,
      periodo,
    );
    res.status(result.creados > 0 ? 201 : 200).json({
      success: true,
      ...result,
    });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({
        success: false,
        message: err.message,
        sunat: err.sunat || undefined,
      });
    }
    next(err);
  }
}

/**
 * POST /compras/sincronizar
 * Body: { periodo?: "YYYYMM", force?: boolean, doc?: "FACT"|"BOL"|"NC"|"ND"|"GRE"|"GRT"|"ALL" }
 * Sin `doc` → ALL (facturas + GRE del periodo). La app móvil debe enviar el chip activo si lo hay.
 */
async function sincronizar(req, res, next) {
  const syncTimeoutMs = Number(process.env.SUNAT_RECIBIDOS_SYNC_HTTP_TIMEOUT_MS || 30 * 60 * 1000);
  req.setTimeout(syncTimeoutMs);
  res.setTimeout(syncTimeoutMs);
  try {
    const periodo = req.body?.periodo || req.query?.periodo || null;
    const force = Boolean(req.body?.force || req.query?.force);
    const doc = req.body?.doc || req.query?.doc || null;
    const result = await sunatRecibidosSyncService.sincronizarRecibidos(req.companyRuc, {
      periodo,
      force,
      doc,
      apiBaseUrl: apiBaseFromRequest(req),
    });
    res.status(200).json(result);
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({
        success: false,
        message: err.message,
        sunat: err.sunat || undefined,
      });
    }
    next(err);
  }
}

/**
 * PATCH /compras/:id/lineas/:detailId
 * Relaciona una línea de compra (OCR o recibida SUNAT) con un ítem de tu catálogo.
 */
async function relacionarLinea(req, res, next) {
  try {
    const compraId = String(req.params.id || '').trim();
    const detailId = String(req.params.detailId || '').trim();
    const catalogItemId = String(
      req.body?.catalog_item_id || req.body?.catalogItemId || '',
    ).trim();

    if (!compraId || !detailId) {
      return res.status(400).json({ success: false, message: 'id y detailId son obligatorios' });
    }
    if (!catalogItemId) {
      return res.status(400).json({ success: false, message: 'catalog_item_id es obligatorio' });
    }

    const result = await compraModel.relacionarLineaCompra(
      req.companyRuc,
      compraId,
      detailId,
      catalogItemId,
    );
    if (result.error === 'compra_not_found') {
      return res.status(404).json({ success: false, message: 'Compra no encontrada' });
    }
    if (result.error === 'catalog_not_found') {
      return res.status(404).json({ success: false, message: 'Ítem de catálogo no encontrado' });
    }
    if (result.error === 'servicio') {
      return res.status(400).json({
        success: false,
        message: 'No puedes relacionar un servicio para ingreso a almacén',
      });
    }
    if (result.error === 'linea_not_found') {
      return res.status(404).json({ success: false, message: 'Línea no encontrada' });
    }

    res.json({
      success: true,
      data: result.linea,
      compra: result.compra,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * @deprecated Las GRE demo de plataforma ya no se importan a compras.
 * POST /compras/gre/importar-plataforma fue retirado.
 */
async function importarGrePlataforma(req, res) {
  return res.status(410).json({
    success: false,
    message: 'Importar GRE demo desde plataforma está deshabilitado. Usa sincronizar SUNAT.',
  });
}

module.exports = {
  list,
  create,
  getById,
  traerSspp,
  traerMesSire,
  sincronizar,
  importarGrePlataforma,
  relacionarLinea,
};
