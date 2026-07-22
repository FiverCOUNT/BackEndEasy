const compraModel = require('../models/compraModel');
const comprobanteModel = require('../models/comprobanteModel');
const ssppReceptorService = require('../services/ssppReceptorService');
const sireRceImportService = require('../services/sireRceImportService');

function apiBaseFromRequest(req) {
  const proto = req.get('x-forwarded-proto') || req.protocol || 'http';
  const host = req.get('x-forwarded-host') || req.get('host');
  return host ? `${proto}://${host}` : null;
}

async function list(req, res, next) {
  try {
    const apiBaseUrl = apiBaseFromRequest(req);
    const [recibidas, registradas] = await Promise.all([
      comprobanteModel.findComprasByCompany(req.companyRuc, {
        desde: req.query.desde,
        hasta: req.query.hasta,
        apiBaseUrl,
      }),
      compraModel.listByCompany(req.companyRuc, {
        desde: req.query.desde,
        hasta: req.query.hasta,
      }),
    ]);
    const merged = [...registradas, ...recibidas];
    merged.sort((a, b) => String(b.fecha_emision || '').localeCompare(String(a.fecha_emision || '')));
    res.json(merged);
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
 * Prod only: descarga CPE recibido (SSPP) o importa xml_base64.
 * Persiste en `invoices` con company_ruc = emisor y cliente = tu RUC (sentido RECIBIDO).
 */
async function traerSspp(req, res, next) {
  try {
    const result = await ssppReceptorService.traerYRegistrarCompra(
      req.companyRuc,
      req.body || {},
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
 * Descarga propuesta RCE SUNAT e importa cada CPE como invoice recibido.
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
 * PATCH /compras/:id/lineas/:detailId
 * Relaciona una línea de compra recibida con un ítem de tu catálogo.
 */
async function relacionarLinea(req, res, next) {
  try {
    const prisma = require('../config/prisma');
    const catalogItemModel = require('../models/catalogItemModel');
    const invoiceId = String(req.params.id || '').trim();
    const detailId = String(req.params.detailId || '').trim();
    const catalogItemId = String(
      req.body?.catalog_item_id || req.body?.catalogItemId || '',
    ).trim();

    if (!invoiceId || !detailId) {
      return res.status(400).json({ success: false, message: 'id y detailId son obligatorios' });
    }
    if (!catalogItemId) {
      return res.status(400).json({ success: false, message: 'catalog_item_id es obligatorio' });
    }

    const invoice = await prisma.invoice.findFirst({
      where: {
        id: invoiceId,
        OR: [
          { companyRuc: req.companyRuc },
          { cliente: { numeroDoc: req.companyRuc } },
        ],
      },
      select: { id: true },
    });
    if (!invoice) {
      return res.status(404).json({ success: false, message: 'Compra no encontrada' });
    }

    const catalogItem = await catalogItemModel.findById(catalogItemId);
    if (!catalogItem || catalogItem.companyRuc !== req.companyRuc) {
      return res.status(404).json({ success: false, message: 'Ítem de catálogo no encontrado' });
    }
    if (catalogItem.kind === 'SERVICE') {
      return res.status(400).json({
        success: false,
        message: 'No puedes relacionar un servicio para ingreso a almacén',
      });
    }

    const detail = await prisma.saleDetail.findFirst({
      where: { id: detailId, invoiceId },
    });
    if (!detail) {
      return res.status(404).json({ success: false, message: 'Línea no encontrada' });
    }

    const updated = await prisma.saleDetail.update({
      where: { id: detailId },
      data: { catalogItemId },
      include: { catalogItem: true, productoSerie: true },
    });

    res.json({
      success: true,
      data: comprobanteModel.toApiSaleDetail(updated),
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  list,
  create,
  getById,
  traerSspp,
  traerMesSire,
  relacionarLinea,
};
