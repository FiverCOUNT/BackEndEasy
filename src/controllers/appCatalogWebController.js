const catalogItemModel = require('../models/catalogItemModel');
const almacenModel = require('../models/almacenModel');
const codigoProductoSunatModel = require('../models/codigoProductoSunatModel');
const { parseLoadMoreQuery, buildLoadMoreMeta, parseListQuery } = require('../utils/pagination');
const { appPath } = require('../config/appPanel');
const { runWithEntorno } = require('../config/prisma');
const {
  layoutLocals,
  companyRucOf,
  parseFlash,
  redirectWithFlash,
  isWebCompanyAdmin,
} = require('../utils/appWebHelpers');

const UNIDADES_PRODUCTO = ['NIU', 'MTR', 'KGM', 'LTR'];
const UNIDADES_SERVICIO = ['ZZ'];

function redirectList(res, message, type = 'success', extra = {}) {
  return redirectWithFlash(res, appPath('/catalogo'), message, type, extra);
}

function assertOwned(item, companyRuc) {
  return item && String(item.companyRuc) === String(companyRuc);
}

function formFromBody(body, companyRuc) {
  const parsed = catalogItemModel.parseBody({ ...body, companyRuc });
  return {
    companyRuc,
    kind: parsed.kind,
    codigo: parsed.codigo || '',
    codigoSunat: parsed.codigoSunat || '',
    codigoSunatNombre: body.codigoSunatNombre || '',
    nombre: parsed.nombre,
    descripcion: parsed.descripcion || '',
    unidad: parsed.unidad,
    precioUnitario: String(parsed.precioUnitario ?? ''),
    precioCompra: parsed.precioCompra != null ? String(parsed.precioCompra) : '',
    fechaVencimiento: parsed.kind === 'SERVICE'
      ? ''
      : (parsed.fechaVencimiento || String(body.fechaVencimiento || body.fecha_vencimiento || '').trim().slice(0, 10)),
    afectacionIgv: parsed.afectacionIgv || '10',
    activo: parsed.activo,
    manejaStock: parsed.manejaStock,
    manejaSerie: parsed.manejaSerie,
    duracionMinutos: parsed.duracionMinutos != null ? String(parsed.duracionMinutos) : '60',
  };
}

function formFromItem(item) {
  const p = catalogItemModel.toPublic(item);
  return {
    companyRuc: p.companyRuc,
    kind: p.kind,
    codigo: p.codigo || '',
    codigoSunat: p.codigoSunat || '',
    codigoSunatNombre: '',
    nombre: p.nombre,
    descripcion: p.descripcion || '',
    unidad: p.unidad,
    precioUnitario: String(p.precioUnitario ?? 0),
    precioCompra: p.precioCompra != null ? String(p.precioCompra) : '',
    fechaVencimiento: p.fechaVencimiento || '',
    afectacionIgv: p.afectacionIgv || '10',
    activo: p.activo,
    manejaStock: p.manejaStock,
    manejaSerie: p.manejaSerie,
    duracionMinutos: p.duracionMinutos != null ? String(p.duracionMinutos) : '60',
  };
}

function validateForm(form) {
  if (!form.nombre) return 'El nombre es obligatorio.';
  const precio = Number(form.precioUnitario);
  if (!Number.isFinite(precio) || precio <= 0) {
    return 'El precio de venta debe ser mayor a 0.';
  }
  if (form.precioCompra !== '' && form.precioCompra != null) {
    const compra = Number(form.precioCompra);
    if (!Number.isFinite(compra) || compra < 0) {
      return 'El precio de compra no puede ser negativo.';
    }
  }
  if (form.kind !== 'SERVICE' && form.fechaVencimiento) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(form.fechaVencimiento)) {
      return 'La fecha de vencimiento no es válida.';
    }
  }
  return null;
}

function stockLabel(item) {
  if (item.kind === 'SERVICE') return null;
  const manejaStock = item.manejaStock ?? item.maneja_stock;
  const manejaSerie = item.manejaSerie ?? item.maneja_serie;
  if (!manejaStock && !manejaSerie) return null;
  const stock = item.stockActual ?? item.stock_actual;
  if (stock == null) return 'Sin stock en almacén';
  const n = Number(stock);
  const unidad = item.unidad || '';
  if (manejaSerie && String(unidad).toUpperCase() === 'NIU') {
    return `Stock: ${n} unidad(es) · con serie`;
  }
  return `Stock: ${n} ${unidad}`.trim();
}

function formatVence(value) {
  const s = String(value || '').trim().slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

function formatMoney(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 'S/ 0.00';
  return `S/ ${n.toFixed(2)}`;
}

function layoutLocalsCatalog(res, extra = {}) {
  return layoutLocals(res, extra);
}

async function list(req, res, next) {
  try {
    const companyRuc = companyRucOf(res);
    const isAdmin = isWebCompanyAdmin(res.locals.webUser);
    const { q, pageSize, skip } = parseLoadMoreQuery(req.query);
    const kind = String(req.query.kind || '').toUpperCase();
    const kindFilter = catalogItemModel.KINDS.includes(kind) ? kind : '';
    let almacenId = String(req.query.almacen || '').trim() || null;
    if (!isAdmin) {
      almacenId = res.locals.userAlmacenId || almacenId;
    }

    const almacenes = isAdmin
      ? await almacenModel.findByCompanyRuc(companyRuc, { soloActivos: true })
      : [];

    const { total, items: pageItems } = await catalogItemModel.findPaginated({
      q,
      kind: kindFilter,
      companyRuc,
      page: 1,
      pageSize,
      skip,
      soloActivos: !isAdmin,
      almacenId,
    });

    const enriched = pageItems;

    const loadMore = buildLoadMoreMeta({
      total,
      limit: pageSize,
      basePath: appPath('/catalogo'),
      query: {
        q,
        kind: kindFilter || undefined,
        almacen: almacenId || undefined,
        msg: req.query.msg,
        tipo: req.query.tipo,
      },
    });

    res.render('app/catalogo/listar', layoutLocalsCatalog(res, {
      title: 'Catálogo',
      active: 'catalogo',
      items: enriched.map((it) => ({
        ...it,
        stockLabel: stockLabel(it),
        precioLabel: formatMoney(it.precioUnitario ?? it.precio_unitario),
        compraLabel: (it.precioCompra ?? it.precio_compra) != null
          ? formatMoney(it.precioCompra ?? it.precio_compra)
          : null,
        venceLabel: formatVence(it.fechaVencimiento || it.fecha_vencimiento),
      })),
      total,
      q,
      kind: kindFilter,
      almacenId,
      almacenes,
      loadMore,
      flash: parseFlash(req),
    }));
  } catch (err) {
    next(err);
  }
}

async function showCreateForm(req, res, next) {
  try {
    res.render('app/catalogo/form', layoutLocalsCatalog(res, {
      title: 'Nuevo ítem',
      active: 'catalogo',
      error: null,
      isEdit: false,
      unidadesProducto: UNIDADES_PRODUCTO,
      unidadesServicio: UNIDADES_SERVICIO,
      form: {
        kind: 'PRODUCT',
        unidad: 'NIU',
        activo: true,
        manejaStock: true,
        manejaSerie: false,
        afectacionIgv: '10',
        precioUnitario: '',
        precioCompra: '',
        fechaVencimiento: '',
        codigo: '',
        codigoSunat: '',
        codigoSunatNombre: '',
        nombre: '',
        descripcion: '',
        duracionMinutos: '60',
      },
    }));
  } catch (err) {
    next(err);
  }
}

async function create(req, res, next) {
  try {
    const companyRuc = companyRucOf(res);
    const form = formFromBody(req.body, companyRuc);
    const error = validateForm(form);
    if (error) {
      return res.status(400).render('app/catalogo/form', layoutLocalsCatalog(res, {
        title: 'Nuevo ítem',
        active: 'catalogo',
        error,
        isEdit: false,
        unidadesProducto: UNIDADES_PRODUCTO,
        unidadesServicio: UNIDADES_SERVICIO,
        form,
      }));
    }

    await catalogItemModel.create({
      ...req.body,
      companyRuc,
      activo: req.body.activo === 'on' || req.body.activo === true || req.body.activo === 'true',
      manejaStock: req.body.manejaStock === 'on' || req.body.manejaStock === true || req.body.manejaStock === 'true',
      manejaSerie: req.body.manejaSerie === 'on' || req.body.manejaSerie === true || req.body.manejaSerie === 'true',
    });
    return redirectList(res, `«${form.nombre}» creado.`);
  } catch (err) {
    next(err);
  }
}

async function showEditForm(req, res, next) {
  try {
    const companyRuc = companyRucOf(res);
    const item = await catalogItemModel.findById(req.params.id);
    if (!assertOwned(item, companyRuc)) {
      return redirectList(res, 'Ítem no encontrado', 'error');
    }
    res.render('app/catalogo/form', layoutLocalsCatalog(res, {
      title: 'Editar ítem',
      active: 'catalogo',
      error: null,
      isEdit: true,
      itemId: item.id,
      unidadesProducto: UNIDADES_PRODUCTO,
      unidadesServicio: UNIDADES_SERVICIO,
      form: formFromItem(item),
    }));
  } catch (err) {
    next(err);
  }
}

async function update(req, res, next) {
  try {
    const companyRuc = companyRucOf(res);
    const item = await catalogItemModel.findById(req.params.id);
    if (!assertOwned(item, companyRuc)) {
      return redirectList(res, 'Ítem no encontrado', 'error');
    }

    const form = formFromBody(req.body, companyRuc);
    const error = validateForm(form);
    if (error) {
      return res.status(400).render('app/catalogo/form', layoutLocalsCatalog(res, {
        title: 'Editar ítem',
        active: 'catalogo',
        error,
        isEdit: true,
        itemId: item.id,
        unidadesProducto: UNIDADES_PRODUCTO,
        unidadesServicio: UNIDADES_SERVICIO,
        form,
      }));
    }

    await catalogItemModel.update(item.id, {
      ...req.body,
      companyRuc,
      activo: req.body.activo === 'on' || req.body.activo === true || req.body.activo === 'true',
      manejaStock: req.body.manejaStock === 'on' || req.body.manejaStock === true || req.body.manejaStock === 'true',
      manejaSerie: req.body.manejaSerie === 'on' || req.body.manejaSerie === true || req.body.manejaSerie === 'true',
    });
    return redirectList(res, `«${form.nombre}» actualizado.`);
  } catch (err) {
    next(err);
  }
}

async function activate(req, res, next) {
  try {
    const companyRuc = companyRucOf(res);
    const item = await catalogItemModel.findById(req.params.id);
    if (!assertOwned(item, companyRuc)) {
      return redirectList(res, 'Ítem no encontrado', 'error');
    }
    await catalogItemModel.setActive(item.id, true);
    return redirectList(res, `«${item.nombre}» activado.`);
  } catch (err) {
    next(err);
  }
}

async function deactivate(req, res, next) {
  try {
    const companyRuc = companyRucOf(res);
    const item = await catalogItemModel.findById(req.params.id);
    if (!assertOwned(item, companyRuc)) {
      return redirectList(res, 'Ítem no encontrado', 'error');
    }
    await catalogItemModel.setActive(item.id, false);
    return redirectList(res, `«${item.nombre}» desactivado.`);
  } catch (err) {
    next(err);
  }
}

async function destroy(req, res, next) {
  try {
    const companyRuc = companyRucOf(res);
    const item = await catalogItemModel.findById(req.params.id);
    if (!assertOwned(item, companyRuc)) {
      return redirectList(res, 'Ítem no encontrado', 'error');
    }
    const result = await catalogItemModel.remove(item.id);
    if (result?.error === 'has_relations') {
      return redirectList(
        res,
        'No se puede eliminar: tiene ventas, series o movimientos vinculados',
        'error',
      );
    }
    return redirectList(res, `«${item.nombre}» eliminado.`);
  } catch (err) {
    next(err);
  }
}

async function searchCodigosSunat(req, res, next) {
  try {
    const { q, page, pageSize, skip } = parseListQuery({
      ...req.query,
      limit: req.query.limit || 40,
    });
    const { total, items } = await runWithEntorno('prod', () =>
      codigoProductoSunatModel.findPaginated({
        q,
        page,
        pageSize,
        skip,
      }));
    res.json({ success: true, items, total, page, pageSize });
  } catch (err) {
    next(err);
  }
}

async function seriesJson(req, res, next) {
  try {
    const companyRuc = companyRucOf(res);
    const id = String(req.params.id || '').trim();
    const item = await catalogItemModel.findById(id);
    if (!assertOwned(item, companyRuc)) {
      return res.status(404).json({ success: false, message: 'Ítem no encontrado.' });
    }
    const q = String(req.query.q || '').trim();
    const estado = String(req.query.estado || '').trim();
    const isAdmin = isWebCompanyAdmin(res.locals.webUser);
    let almacenId = String(req.query.almacen || req.query.almacen_id || '').trim() || null;
    if (!isAdmin) {
      almacenId = res.locals.userAlmacenId || null;
      if (!almacenId) {
        return res.json({
          success: true,
          catalog_item_id: id,
          nombre: item.nombre,
          maneja_serie: Boolean(item.manejaSerie),
          items: [],
          total: 0,
        });
      }
    }
    const productoSerieModel = require('../models/productoSerieModel');
    const items = await productoSerieModel.findByCatalogItem({
      companyRuc,
      catalogItemId: id,
      q,
      estado,
      almacenId,
    });
    res.json({
      success: true,
      catalog_item_id: id,
      nombre: item.nombre,
      maneja_serie: Boolean(item.manejaSerie),
      items,
      total: items.length,
    });
  } catch (err) {
    next(err);
  }
}

async function buscarSerieJson(req, res, next) {
  try {
    const companyRuc = companyRucOf(res);
    const codigo = String(req.query.codigo || req.query.q || '').trim();
    const almacenId = String(req.query.almacen_id || req.query.almacen || '').trim();
    const uso = String(req.query.uso || 'venta').trim().toLowerCase();
    if (!codigo) {
      return res.status(400).json({ success: false, message: 'Escanea o escribe la serie.' });
    }
    if (!almacenId) {
      return res.status(400).json({ success: false, message: 'Selecciona el almacén.' });
    }
    const productoSerieModel = require('../models/productoSerieModel');
    const found = await productoSerieModel.findPorCodigo({
      companyRuc,
      codigo,
      almacenId,
      uso,
    });
    if (found.error === 'otro_almacen') {
      const donde = found.almacen_nombre ? ` Está en ${found.almacen_nombre}.` : '';
      return res.status(404).json({
        success: false,
        message: `Esa serie no está en el almacén seleccionado.${donde}`,
      });
    }
    if (found.error === 'no_disponible') {
      return res.status(404).json({
        success: false,
        message: 'Esa serie no está disponible en este almacén.',
      });
    }
    if (found.error === 'ya_en_almacen') {
      return res.status(409).json({
        success: false,
        message: 'Esa serie ya está en este almacén. Úsala en una salida o al emitir.',
      });
    }
    if (found.error || !found.row) {
      return res.status(404).json({
        success: false,
        message: 'No hay un producto con esa serie en este almacén.',
      });
    }
    const row = found.row;
    const item = row.catalogItem;
    const precio = item.precioUnitario != null ? Number(item.precioUnitario) : null;
    res.json({
      success: true,
      item: {
        id: item.id,
        nombre: item.nombre,
        unidad: item.unidad || 'NIU',
        precio_unitario: Number.isFinite(precio) ? precio : null,
        maneja_serie: true,
        maneja_stock: item.manejaStock !== false,
        codigo: item.codigo || '',
      },
      serie: {
        id: row.id,
        numero_serie: row.numeroSerie,
        almacen_id: row.almacenId,
        estado: row.estado,
      },
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  list,
  showCreateForm,
  create,
  showEditForm,
  update,
  activate,
  deactivate,
  destroy,
  searchCodigosSunat,
  seriesJson,
  buscarSerieJson,
};
