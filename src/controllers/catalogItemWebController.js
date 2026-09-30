const catalogItemModel = require('../models/catalogItemModel');
const codigoProductoSunatModel = require('../models/codigoProductoSunatModel');
const prisma = require('../config/prisma');
const { parseListQuery, buildPageMeta } = require('../utils/pagination');
const { adminPath } = require('../config/adminPanel');
const { runWithEntorno } = require('../config/prisma');

const UNIDADES = ['NIU', 'MTR', 'KGM', 'LTR', 'ZZ'];

function panelEntorno(res) {
  return res.locals.adminEntorno === 'beta' ? 'beta' : 'prod';
}

async function loadCompanies(entorno) {
  return runWithEntorno(entorno, () =>
    prisma.company.findMany({
      select: { id: true, nombre: true, ruc: true },
      orderBy: { nombre: 'asc' },
    }));
}

function parseFlash(req) {
  const { msg, tipo } = req.query;
  if (!msg) return null;
  return { text: msg, type: tipo === 'error' ? 'error' : 'success' };
}

function redirectList(res, message, type = 'success', entorno) {
  const q = new URLSearchParams({ msg: message, tipo: type });
  const db = entorno === 'beta' || entorno === 'prod'
    ? entorno
    : (res.locals.adminEntorno === 'beta' ? 'beta' : 'prod');
  q.set('entorno', db);
  return res.redirect(`${adminPath('/catalogo')}?${q.toString()}`);
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
    precioCompra: parsed.precioCompra != null ? String(parsed.precioCompra) : '',
    fechaVencimiento: parsed.kind === 'SERVICE'
      ? ''
      : (parsed.fechaVencimiento || String(body.fechaVencimiento || body.fecha_vencimiento || '').trim().slice(0, 10)),
    lote: parsed.kind === 'SERVICE' ? '' : (parsed.lote || ''),
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
    precioCompra: p.precioCompra != null ? String(p.precioCompra) : '',
    fechaVencimiento: p.fechaVencimiento || '',
    lote: p.lote || '',
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

    const kindFilter = catalogItemModel.KINDS.includes(kind) ? kind : '';
    const entorno = panelEntorno(res);
    const [{ total, items }, companies] = await Promise.all([
      runWithEntorno(entorno, () =>
        catalogItemModel.findPaginated({
          q, kind: kindFilter, companyRuc, page, pageSize, skip,
        })),
      loadCompanies(entorno),
    ]);

    const pagination = buildPageMeta({
      total,
      page,
      pageSize,
      basePath: adminPath('/catalogo'),
      query: {
        q,
        kind: kind || undefined,
        company: companyRuc || undefined,
        entorno,
        msg: req.query.msg,
        tipo: req.query.tipo,
      },
    });

    res.render('catalogo/listar', {
      title: 'Catálogo',
      items,
      total,
      q,
      kind,
      entorno,
      companyRuc,
      pageSize,
      pagination,
      companies,
      kinds: catalogItemModel.KINDS,
      flash: parseFlash(req),
      searchAction: adminPath('/catalogo'),
      searchPlaceholder: 'Buscar por nombre, código, código SUNAT o RUC…',
    });
  } catch (err) {
    next(err);
  }
}

async function showCreateForm(req, res, next) {
  try {
    const companies = await loadCompanies(panelEntorno(res));
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
    const entorno = panelEntorno(res);
    const companies = await loadCompanies(entorno);
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
    if (!companies.some((c) => c.ruc === form.companyRuc)) {
      return renderError('La empresa seleccionada no existe en esta base.');
    }

    await runWithEntorno(entorno, () => catalogItemModel.create(req.body));
    return redirectList(res, `Ítem «${form.nombre}» creado.`, 'success', entorno);
  } catch (err) {
    next(err);
  }
}

async function showEditForm(req, res, next) {
  try {
    const entorno = panelEntorno(res);
    const item = await runWithEntorno(entorno, () => catalogItemModel.findById(req.params.id));
    if (!item) return redirectList(res, 'Ítem no encontrado', 'error', entorno);

    const companies = await loadCompanies(entorno);
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
    const entorno = panelEntorno(res);
    const item = await runWithEntorno(entorno, () => catalogItemModel.findById(req.params.id));
    if (!item) return redirectList(res, 'Ítem no encontrado', 'error', entorno);

    const companies = await loadCompanies(entorno);
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
    if (!companies.some((c) => c.ruc === form.companyRuc)) {
      return renderError('La empresa seleccionada no existe en esta base.');
    }

    await runWithEntorno(entorno, () => catalogItemModel.update(item.id, req.body));
    return redirectList(res, `Ítem «${form.nombre}» actualizado.`, 'success', entorno);
  } catch (err) {
    next(err);
  }
}

async function activate(req, res, next) {
  try {
    const entorno = panelEntorno(res);
    const item = await runWithEntorno(entorno, () => catalogItemModel.findById(req.params.id));
    if (!item) return redirectList(res, 'Ítem no encontrado', 'error', entorno);
    await runWithEntorno(entorno, () => catalogItemModel.setActive(item.id, true));
    return redirectList(res, `«${item.nombre}» activado.`, 'success', entorno);
  } catch (err) {
    next(err);
  }
}

async function deactivate(req, res, next) {
  try {
    const entorno = panelEntorno(res);
    const item = await runWithEntorno(entorno, () => catalogItemModel.findById(req.params.id));
    if (!item) return redirectList(res, 'Ítem no encontrado', 'error', entorno);
    await runWithEntorno(entorno, () => catalogItemModel.setActive(item.id, false));
    return redirectList(res, `«${item.nombre}» desactivado.`, 'success', entorno);
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

async function destroy(req, res, next) {
  try {
    const entorno = panelEntorno(res);
    const item = await runWithEntorno(entorno, () => catalogItemModel.findById(req.params.id));
    if (!item) return redirectList(res, 'Ítem no encontrado', 'error', entorno);

    const result = await runWithEntorno(entorno, () => catalogItemModel.remove(item.id));
    if (result.error === 'has_relations') {
      return redirectList(
        res,
        'No se puede eliminar: tiene ventas, series o movimientos vinculados',
        'error',
        entorno,
      );
    }

    return redirectList(res, `«${item.nombre}» eliminado.`, 'success', entorno);
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
