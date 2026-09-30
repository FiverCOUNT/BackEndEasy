const catalogItemModel = require('../models/catalogItemModel');
const productoSerieModel = require('../models/productoSerieModel');
const prisma = require('../config/prisma');
const { resolveCatalogQuery } = require('../utils/catalogAccess');
const { parseMobileListQuery, sendMobilePage } = require('../utils/pagination');

async function list(req, res, next) {
  try {
    const { almacenId, restrictToAlmacen } = resolveCatalogQuery(req);
    const { q, page, pageSize, skip } = parseMobileListQuery(req.query);
    const { items, total } = await catalogItemModel.findByCompanyRucPaginated(req.companyRuc, {
      almacenId,
      restrictToAlmacen,
      q,
      skip,
      take: pageSize,
    });
    return sendMobilePage(res, { items, total, page, pageSize });
  } catch (err) {
    next(err);
  }
}

async function listSeriesDisponibles(req, res, next) {
  try {
    const { catalogItemId } = req.params;
    const { almacenId } = resolveCatalogQuery(req);

    if (!almacenId) {
      return res.status(400).json({
        success: false,
        message: 'Query almacen_id es obligatorio',
      });
    }

    const item = await catalogItemModel.findById(catalogItemId);
    if (!item || item.companyRuc !== req.companyRuc) {
      return res.status(404).json({ success: false, message: 'Ítem no encontrado' });
    }

    if (!item.manejaSerie) {
      return res.json([]);
    }

    const almacen = await prisma.almacen.findFirst({
      where: { id: almacenId, companyRuc: req.companyRuc },
    });
    if (!almacen) {
      return res.status(404).json({ success: false, message: 'Almacén no encontrado' });
    }

    const series = await productoSerieModel.findDisponibles({
      companyRuc: req.companyRuc,
      catalogItemId,
      almacenId,
    });

    res.json(series);
  } catch (err) {
    next(err);
  }
}

async function respondWithStock(res, row, req, { status = 200 } = {}) {
  const { almacenId } = resolveCatalogQuery(req);
  const [enriched] = await catalogItemModel.enrichStock([row], almacenId || null);
  return res.status(status).json(enriched);
}

async function create(req, res, next) {
  try {
    const body = { ...req.body, companyRuc: req.companyRuc };
    const parsed = catalogItemModel.parseBody(body);

    if (!parsed.nombre) {
      return res.status(400).json({ success: false, message: 'nombre es obligatorio' });
    }

    const row = await catalogItemModel.create(body);
    return respondWithStock(res, row, req, { status: 201 });
  } catch (err) {
    next(err);
  }
}

async function update(req, res, next) {
  try {
    const { id } = req.params;
    const existing = await catalogItemModel.findById(id);
    if (!existing || existing.companyRuc !== req.companyRuc) {
      return res.status(404).json({ success: false, message: 'Ítem no encontrado' });
    }

    const body = { ...req.body, companyRuc: req.companyRuc };
    const parsed = catalogItemModel.parseBody(body);
    if (!parsed.nombre) {
      return res.status(400).json({ success: false, message: 'nombre es obligatorio' });
    }

    const row = await catalogItemModel.update(id, body);
    return respondWithStock(res, row, req);
  } catch (err) {
    next(err);
  }
}

async function patch(req, res, next) {
  try {
    const { id } = req.params;
    const existing = await catalogItemModel.findById(id);
    if (!existing || existing.companyRuc !== req.companyRuc) {
      return res.status(404).json({ success: false, message: 'Ítem no encontrado' });
    }

    if (req.body.activo === undefined) {
      return res.status(400).json({ success: false, message: 'activo es requerido' });
    }

    const activo = req.body.activo === true || req.body.activo === 'true';
    const row = await catalogItemModel.setActive(id, activo);
    return respondWithStock(res, row, req);
  } catch (err) {
    next(err);
  }
}

async function destroy(req, res, next) {
  try {
    const { id } = req.params;
    const existing = await catalogItemModel.findById(id);
    if (!existing || existing.companyRuc !== req.companyRuc) {
      return res.status(404).json({ success: false, message: 'Ítem no encontrado' });
    }

    const result = await catalogItemModel.remove(id);
    if (result.error === 'has_relations') {
      return res.status(409).json({
        success: false,
        message: 'No se puede eliminar: tiene ventas, series o movimientos vinculados',
      });
    }

    res.json({ success: true, message: 'Ítem eliminado' });
  } catch (err) {
    next(err);
  }
}

module.exports = { list, listSeriesDisponibles, create, update, patch, destroy };
