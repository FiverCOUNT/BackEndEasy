const almacenModel = require('../models/almacenModel');
const prisma = require('../config/prisma');
const { parseListQuery, buildPageMeta } = require('../utils/pagination');
const { adminPath } = require('../config/adminPanel');
const { runWithEntorno } = require('../config/prisma');

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

function parseId(param) {
  const id = (param || '').trim();
  if (!id || id.length < 8) return null;
  return id;
}

function redirectList(res, message, type = 'success', entorno) {
  const q = new URLSearchParams({ msg: message, tipo: type });
  const db = entorno === 'beta' || entorno === 'prod'
    ? entorno
    : (res.locals.adminEntorno === 'beta' ? 'beta' : 'prod');
  q.set('entorno', db);
  return res.redirect(`${adminPath('/almacenes')}?${q.toString()}`);
}

function formFromBody(body) {
  const parsed = almacenModel.parseBody(body);
  return {
    companyRuc: parsed.companyRuc,
    codigo: parsed.codigo,
    nombre: parsed.nombre,
    activo: parsed.activo,
    ubigeo: body.ubigeo || '',
    departamento: body.departamento || '',
    provincia: body.provincia || '',
    distrito: body.distrito || '',
    direccion: body.direccion || '',
    codLocal: body.codLocal || '0000',
  };
}

function formFromAlmacen(almacen) {
  const a = almacenModel.toPublic(almacen);
  return {
    companyRuc: a.companyRuc,
    codigo: a.codigo,
    nombre: a.nombre,
    activo: a.activo,
    ubigeo: a.address?.ubigeo || '',
    departamento: a.address?.departamento || '',
    provincia: a.address?.provincia || '',
    distrito: a.address?.distrito || '',
    direccion: a.address?.direccion || '',
    codLocal: a.address?.codLocal || '0000',
  };
}

async function list(req, res, next) {
  try {
    const { q, page, pageSize, skip } = parseListQuery(req.query);
    const companyRuc = (req.query.company || '').trim();

    const entorno = panelEntorno(res);
    const [{ total, items }, companies] = await Promise.all([
      runWithEntorno(entorno, () =>
        almacenModel.findPaginated({ q, companyRuc, page, pageSize, skip })),
      loadCompanies(entorno),
    ]);

    const pagination = buildPageMeta({
      total,
      page,
      pageSize,
      basePath: adminPath('/almacenes'),
      query: {
        q,
        company: companyRuc || undefined,
        entorno,
        msg: req.query.msg,
        tipo: req.query.tipo,
      },
    });

    res.render('almacenes/listar', {
      title: 'Almacenes',
      almacenes: items,
      total,
      q,
      entorno,
      companyRuc,
      pageSize,
      pagination,
      companies,
      flash: parseFlash(req),
      searchAction: adminPath('/almacenes'),
      searchPlaceholder: 'Buscar por código, nombre, empresa o dirección…',
    });
  } catch (err) {
    next(err);
  }
}

async function showCreateForm(req, res, next) {
  try {
    const companies = await loadCompanies(panelEntorno(res));
    res.render('almacenes/crear', {
      title: 'Nuevo almacén',
      error: null,
      companies,
      isEdit: false,
      form: { activo: true, codLocal: '0000' },
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
      res.render('almacenes/crear', {
        title: 'Nuevo almacén',
        error,
        companies,
        isEdit: false,
        form,
      });

    if (!form.companyRuc) return renderError('Selecciona una empresa (RUC).');
    if (!form.codigo) return renderError('El código es obligatorio.');
    if (!form.nombre) return renderError('El nombre es obligatorio.');

    const company = companies.find((c) => c.ruc === form.companyRuc);
    if (!company) return renderError('La empresa seleccionada no existe en esta base.');

    const exists = await runWithEntorno(entorno, () =>
      almacenModel.findByCodigo(form.companyRuc, form.codigo));
    if (exists) {
      return renderError('Ya existe un almacén con ese código en la empresa.');
    }

    await runWithEntorno(entorno, () => almacenModel.create(req.body));
    return redirectList(res, `Almacén «${form.nombre}» creado.`, 'success', entorno);
  } catch (err) {
    next(err);
  }
}

async function showEditForm(req, res, next) {
  try {
    const entorno = panelEntorno(res);
    const id = parseId(req.params.id);
    if (!id) return redirectList(res, 'Almacén no válido', 'error', entorno);

    const almacen = await runWithEntorno(entorno, () => almacenModel.findById(id));
    if (!almacen) return redirectList(res, 'Almacén no encontrado', 'error', entorno);

    const companies = await loadCompanies(entorno);
    res.render('almacenes/editar', {
      title: 'Editar almacén',
      error: null,
      companies,
      isEdit: true,
      almacen: almacenModel.toPublic(almacen),
      form: formFromAlmacen(almacen),
    });
  } catch (err) {
    next(err);
  }
}

async function update(req, res, next) {
  try {
    const entorno = panelEntorno(res);
    const id = parseId(req.params.id);
    if (!id) return redirectList(res, 'Almacén no válido', 'error', entorno);

    const almacen = await runWithEntorno(entorno, () => almacenModel.findById(id));
    if (!almacen) return redirectList(res, 'Almacén no encontrado', 'error', entorno);

    const companies = await loadCompanies(entorno);
    const form = formFromBody(req.body);

    const renderError = (error) =>
      res.render('almacenes/editar', {
        title: 'Editar almacén',
        error,
        companies,
        isEdit: true,
        almacen: almacenModel.toPublic(almacen),
        form,
      });

    if (!form.companyRuc) return renderError('Selecciona una empresa (RUC).');
    if (!form.codigo) return renderError('El código es obligatorio.');
    if (!form.nombre) return renderError('El nombre es obligatorio.');

    const company = companies.find((c) => c.ruc === form.companyRuc);
    if (!company) return renderError('La empresa seleccionada no existe en esta base.');

    const duplicate = await runWithEntorno(entorno, () =>
      almacenModel.findByCodigoExceptId(form.companyRuc, form.codigo, id));
    if (duplicate) return renderError('Ya existe otro almacén con ese código en la empresa.');

    await runWithEntorno(entorno, () => almacenModel.update(id, req.body));
    return redirectList(res, `Almacén «${form.nombre}» actualizado.`, 'success', entorno);
  } catch (err) {
    next(err);
  }
}

async function activate(req, res, next) {
  try {
    const entorno = panelEntorno(res);
    const id = parseId(req.params.id);
    if (!id) return redirectList(res, 'Almacén no válido', 'error', entorno);

    const almacen = await runWithEntorno(entorno, () => almacenModel.findById(id));
    if (!almacen) return redirectList(res, 'Almacén no encontrado', 'error', entorno);

    await runWithEntorno(entorno, () => almacenModel.setActive(id, true));
    return redirectList(res, `«${almacen.nombre}» activado.`, 'success', entorno);
  } catch (err) {
    next(err);
  }
}

async function deactivate(req, res, next) {
  try {
    const entorno = panelEntorno(res);
    const id = parseId(req.params.id);
    if (!id) return redirectList(res, 'Almacén no válido', 'error', entorno);

    const almacen = await runWithEntorno(entorno, () => almacenModel.findById(id));
    if (!almacen) return redirectList(res, 'Almacén no encontrado', 'error', entorno);

    await runWithEntorno(entorno, () => almacenModel.setActive(id, false));
    return redirectList(res, `«${almacen.nombre}» desactivado.`, 'success', entorno);
  } catch (err) {
    next(err);
  }
}

async function destroy(req, res, next) {
  try {
    const entorno = panelEntorno(res);
    const id = parseId(req.params.id);
    if (!id) return redirectList(res, 'Almacén no válido', 'error', entorno);

    const almacen = await runWithEntorno(entorno, () => almacenModel.findById(id));
    if (!almacen) return redirectList(res, 'Almacén no encontrado', 'error', entorno);

    const result = await runWithEntorno(entorno, () => almacenModel.remove(id));
    if (result.error === 'has_relations') {
      return redirectList(
        res,
        'No se puede eliminar: tiene usuarios, series, movimientos o líneas vinculadas',
        'error',
        entorno,
      );
    }

    return redirectList(res, `«${almacen.nombre}» eliminado.`, 'success', entorno);
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
};
