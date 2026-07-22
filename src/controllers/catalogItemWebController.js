const prisma = require('../config/prisma');
const catalogItemModel = require('../models/catalogItemModel');
const codigoProductoSunatModel = require('../models/codigoProductoSunatModel');
const { parseListQuery, buildPageMeta } = require('../utils/pagination');

const UNIDADES = ['NIU', 'MTR', 'KGM', 'LTR', 'ZZ'];

async function loadCompanies() {
  return prisma.company.findMany({
    select: { ruc: true, nombre: true },
    orderBy: { nombre: 'asc' },
  });
}

function parseFlash(req) {
  const { msg, tipo } = req.query;
  if (!msg) return null;
  return { text: msg, type: tipo === 'error' ? 'error' : 'success' };
}

function redirectList(res, message, type = 'success') {
  const q = new URLSearchParams({ msg: message, tipo: type });
  return res.redirect(`/catalogo?${q.toString()}`);
}

function formFromBody(body) {
  const parsed = catalogItemModel.parseBody(body);
  return {
    companyRuc: parsed.companyRuc,
    kind: parsed.kind,
    codigo: parsed.codigo || '',
    codigoSunat: parsed.codigoSunat || '',
    nombre: parsed.nombre,
    descripcion: parsed.descripcion || '',
    unidad: parsed.unidad,
    precioUnitario: String(parsed.precioUnitario ?? 0),
    afectacionIgv: parsed.afectacionIgv,
    activo: parsed.activo,
    manejaStock: parsed.manejaStock,
    manejaSerie: parsed.manejaSerie,
    stockActual: parsed.stockActual != null ? String(parsed.stockActual) : '',
    duracionMinutos: parsed.duracionMinutos != null ? String(parsed.duracionMinutos) : '',
  };
}

function formFromItem(item) {
  const p = catalogItemModel.toPublic(item);
  return {
    companyRuc: p.companyRuc,
    kind: p.kind,
    codigo: p.codigo || '',
    codigoSunat: p.codigoSunat || '',
    nombre: p.nombre,
    descripcion: p.descripcion || '',
    unidad: p.unidad,
    precioUnitario: String(p.precioUnitario ?? 0),
    afectacionIgv: p.afectacionIgv,
    activo: p.activo,
    manejaStock: p.manejaStock,
    manejaSerie: p.manejaSerie,
    stockActual: p.stockActual != null ? String(p.stockActual) : '',
    duracionMinutos: p.duracionMinutos != null ? String(p.duracionMinutos) : '',
  };
}

async function list(req, res, next) {
  try {
    const { q, page, pageSize, skip } = parseListQuery(req.query);
    const kind = (req.query.kind || '').toUpperCase();
    const companyRuc = (req.query.company || '').trim();

    const { total, items } = await catalogItemModel.findPaginated({
      q,
      kind: catalogItemModel.KINDS.includes(kind) ? kind : '',
      companyRuc,
      page,
      pageSize,
      skip,
    });

    const pagination = buildPageMeta({
      total,
      page,
      pageSize,
      basePath: '/catalogo',
      query: {
        q,
        kind: kind || undefined,
        company: companyRuc || undefined,
        msg: req.query.msg,
        tipo: req.query.tipo,
      },
    });

    const companies = await loadCompanies();

    res.render('catalogo/listar', {
      title: 'Catálogo',
      items,
      total,
      q,
      kind,
      companyRuc,
      pageSize,
      pagination,
      companies,
      kinds: catalogItemModel.KINDS,
      flash: parseFlash(req),
      searchAction: '/catalogo',
      searchPlaceholder: 'Buscar por nombre, código, código SUNAT o RUC…',
    });
  } catch (err) {
    next(err);
  }
}

async function showCreateForm(req, res, next) {
  try {
    const companies = await loadCompanies();
    res.render('catalogo/crear', {
      title: 'Nuevo ítem',
      error: null,
      companies,
      kinds: catalogItemModel.KINDS,
      unidades: UNIDADES,
      isEdit: false,
      form: { kind: 'PRODUCT', unidad: 'NIU', activo: true, manejaStock: true, afectacionIgv: '10' },
    });
  } catch (err) {
    next(err);
  }
}

async function create(req, res, next) {
  try {
    const companies = await loadCompanies();
    const form = formFromBody(req.body);

    const renderError = (error) =>
      res.render('catalogo/crear', {
        title: 'Nuevo ítem',
        error,
        companies,
        kinds: catalogItemModel.KINDS,
        unidades: UNIDADES,
        isEdit: false,
        form,
      });

    if (!form.companyRuc) return renderError('Selecciona una empresa (RUC).');
    if (!form.nombre) return renderError('El nombre es obligatorio.');

    await catalogItemModel.create(req.body);
    return redirectList(res, `Ítem «${form.nombre}» creado.`);
  } catch (err) {
    next(err);
  }
}

async function showEditForm(req, res, next) {
  try {
    const item = await catalogItemModel.findById(req.params.id);
    if (!item) return redirectList(res, 'Ítem no encontrado', 'error');

    const companies = await loadCompanies();
    res.render('catalogo/editar', {
      title: 'Editar ítem',
      error: null,
      companies,
      kinds: catalogItemModel.KINDS,
      unidades: UNIDADES,
      isEdit: true,
      item: catalogItemModel.toPublic(item),
      form: formFromItem(item),
    });
  } catch (err) {
    next(err);
  }
}

async function update(req, res, next) {
  try {
    const item = await catalogItemModel.findById(req.params.id);
    if (!item) return redirectList(res, 'Ítem no encontrado', 'error');

    const companies = await loadCompanies();
    const form = formFromBody(req.body);

    const renderError = (error) =>
      res.render('catalogo/editar', {
        title: 'Editar ítem',
        error,
        companies,
        kinds: catalogItemModel.KINDS,
        unidades: UNIDADES,
        isEdit: true,
        item: catalogItemModel.toPublic(item),
        form,
      });

    if (!form.companyRuc) return renderError('Selecciona una empresa (RUC).');
    if (!form.nombre) return renderError('El nombre es obligatorio.');

    await catalogItemModel.update(item.id, req.body);
    return redirectList(res, `Ítem «${form.nombre}» actualizado.`);
  } catch (err) {
    next(err);
  }
}

async function activate(req, res, next) {
  try {
    const item = await catalogItemModel.findById(req.params.id);
    if (!item) return redirectList(res, 'Ítem no encontrado', 'error');
    await catalogItemModel.setActive(item.id, true);
    return redirectList(res, `«${item.nombre}» activado.`);
  } catch (err) {
    next(err);
  }
}

async function deactivate(req, res, next) {
  try {
    const item = await catalogItemModel.findById(req.params.id);
    if (!item) return redirectList(res, 'Ítem no encontrado', 'error');
    await catalogItemModel.setActive(item.id, false);
    return redirectList(res, `«${item.nombre}» desactivado.`);
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
    const { total, items } = await codigoProductoSunatModel.findPaginated({
      q,
      page,
      pageSize,
      skip,
    });
    res.json({ success: true, items, total, page, pageSize });
  } catch (err) {
    next(err);
  }
}

async function destroy(req, res, next) {
  try {
    const item = await catalogItemModel.findById(req.params.id);
    if (!item) return redirectList(res, 'Ítem no encontrado', 'error');

    const result = await catalogItemModel.remove(item.id);
    if (result.error === 'has_relations') {
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
    const { total, items } = await codigoProductoSunatModel.findPaginated({
      q,
      page,
      pageSize,
      skip,
    });
    res.json({ success: true, items, total, page, pageSize });
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
};
