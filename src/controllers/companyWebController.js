const companyModel = require('../models/companyModel');
const {
  buildSeriesConfigFromBody,
  seriesConfigToFormFields,
  defaultSeriesConfig,
  validateSeriesConfig,
} = require('../utils/seriesConfig');
const { parseListQuery, buildPageMeta } = require('../utils/pagination');
const { adminPath } = require('../config/adminPanel');

function parseFlash(req) {
  const { msg, tipo } = req.query;
  if (!msg) return null;
  return { text: msg, type: tipo === 'error' ? 'error' : 'success' };
}

function parseId(param) {
  try {
    const id = BigInt(param);
    if (id < 1n) return null;
    return id.toString();
  } catch {
    return null;
  }
}

function redirectList(res, message, type = 'success', entorno) {
  const q = new URLSearchParams({ msg: message, tipo: type });
  const db = entorno === 'beta' || entorno === 'prod'
    ? entorno
    : (res.locals.adminEntorno === 'beta' ? 'beta' : 'prod');
  q.set('entorno', db);
  return res.redirect(`${adminPath('/companies')}?${q.toString()}`);
}

function panelEntorno(res) {
  return res.locals.adminEntorno === 'beta' ? 'beta' : 'prod';
}

function formFromBody(body) {
  return {
    ruc: body.ruc || '',
    nombre: body.nombre || '',
    nombreComercial: body.nombreComercial || '',
    tipoDoc: body.tipoDoc || '6',
    numeroDoc: body.numeroDoc || '',
    email: body.email || '',
    telefono: body.telefono || '',
    entorno: body.entorno || 'beta',
    plan: body.plan || '',
    taxRegime: body.taxRegime || '',
    creadoEn: body.creadoEn || '',
    activo: body.activo === 'on' || body.activo === 'true',
    ubigeo: body.ubigeo || '',
    departamento: body.departamento || '',
    provincia: body.provincia || '',
    distrito: body.distrito || '',
    direccion: body.direccion || '',
    codLocal: body.codLocal || '0000',
    solUser: body.solUser || '',
    clientId: body.clientId || '',
    clientSecret: '',
    solPass: '',
    certificatePassword: '',
    nroMtc: body.nroMtc || body.nro_mtc || '',
    tieneCertificado: body.tieneCertificado === 'on' || body.tieneCertificado === 'true',
    rutaFirma: body.rutaFirma || '',
    ...seriesConfigToFormFields(buildSeriesConfigFromBody(body) || defaultSeriesConfig()),
  };
}

function formFromCompany(company) {
  const c = companyModel.toPublic(company);
  return {
    ruc: c.ruc,
    nombre: c.nombre,
    nombreComercial: c.nombreComercial || '',
    tipoDoc: c.tipoDoc || '6',
    numeroDoc: c.numeroDoc || c.ruc,
    email: c.email || '',
    telefono: c.telefono || '',
    entorno: c.entorno || '',
    plan: c.plan || '',
    taxRegime: c.taxRegime || '',
    creadoEn: c.creadoEn || '',
    activo: c.activo !== false,
    ubigeo: c.address?.ubigeo || '',
    departamento: c.address?.departamento || '',
    provincia: c.address?.provincia || '',
    distrito: c.address?.distrito || '',
    direccion: c.address?.direccion || '',
    codLocal: c.address?.codLocal || '0000',
    solUser: c.solUser || '',
    clientId: c.clientId || '',
    clientSecret: '',
    solPass: '',
    certificatePassword: '',
    nroMtc: c.nroMtc || '',
    tieneCertificado: c.tieneCertificado === true,
    rutaFirma: c.rutaFirma || '',
    tieneSolPass: c.tieneSolPass,
    tieneClientSecret: c.tieneClientSecret,
    tieneCertificatePassword: c.tieneCertificatePassword,
    ...seriesConfigToFormFields(c.seriesConfig),
  };
}

async function list(req, res, next) {
  try {
    const { q, page, pageSize, skip } = parseListQuery(req.query);
    const entorno = panelEntorno(res);
    const { total, items } = await companyModel.findPaginated({
      q,
      page,
      pageSize,
      skip,
      entorno,
    });

    const pagination = buildPageMeta({
      total,
      page,
      pageSize,
      basePath: adminPath('/companies'),
      query: { q, entorno, msg: req.query.msg, tipo: req.query.tipo },
    });

    res.render('companies/listar', {
      title: 'Empresas',
      companies: items,
      total,
      q,
      entorno,
      pageSize,
      pagination,
      flash: parseFlash(req),
      searchAction: adminPath('/companies'),
      searchPlaceholder: 'Buscar por RUC, razón social, email…',
    });
  } catch (err) {
    next(err);
  }
}

async function showCreateForm(req, res, next) {
  try {
    res.render('companies/crear', {
      title: 'Nueva empresa',
      error: null,
      form: formFromBody({
        activo: 'on',
        tipoDoc: '6',
        entorno: panelEntorno(res),
        ...seriesConfigToFormFields(defaultSeriesConfig()),
      }),
    });
  } catch (err) {
    next(err);
  }
}

async function create(req, res, next) {
  try {
    const form = formFromBody(req.body);

    const renderError = (error) =>
      res.render('companies/crear', { title: 'Nueva empresa', error, form });

    if (!form.ruc || !form.nombre) {
      return renderError('RUC y razón social son obligatorios.');
    }
    if (await companyModel.findByRucAcrossDbs(form.ruc)) {
      return renderError('Ya existe una empresa con ese RUC.');
    }

    const seriesError = validateSeriesConfig(buildSeriesConfigFromBody(req.body));
    if (seriesError) return renderError(seriesError);

    await companyModel.create(req.body, { certFile: req.file || null });
    const destino = String(form.entorno || '').toLowerCase() === 'prod' ? 'prod' : 'beta';
    return redirectList(res, `Empresa ${form.nombre} creada correctamente.`, 'success', destino);
  } catch (err) {
    if (err.message && /certificado|R2\/S3|Cloudflare R2|\.pfx|Access Denied/i.test(err.message)) {
      return res.render('companies/crear', {
        title: 'Nueva empresa',
        error: err.message,
        form: formFromBody(req.body),
      });
    }
    next(err);
  }
}

async function showEditForm(req, res, next) {
  try {
    const id = parseId(req.params.id);
    if (!id) return redirectList(res, 'Empresa no válida', 'error');

    const company = await companyModel.findById(id, panelEntorno(res));
    if (!company) return redirectList(res, 'Empresa no encontrada', 'error');

    res.render('companies/editar', {
      title: 'Editar empresa',
      error: null,
      company: companyModel.toPublic(company),
      form: formFromCompany(company),
    });
  } catch (err) {
    next(err);
  }
}

async function update(req, res, next) {
  try {
    const id = parseId(req.params.id);
    if (!id) return redirectList(res, 'Empresa no válida', 'error');

    const company = await companyModel.findById(id, panelEntorno(res));
    if (!company) return redirectList(res, 'Empresa no encontrada', 'error');

    const form = formFromBody(req.body);
    const renderError = (error) =>
      res.render('companies/editar', {
        title: 'Editar empresa',
        error,
        company: companyModel.toPublic(company),
        form,
      });

    if (!form.ruc || !form.nombre) {
      return renderError('RUC y razón social son obligatorios.');
    }
    if (await companyModel.findByRucExceptIdAcrossDbs(form.ruc, id)) {
      return renderError('Ese RUC ya está registrado en otra empresa.');
    }

    const seriesError = validateSeriesConfig(buildSeriesConfigFromBody(req.body));
    if (seriesError) return renderError(seriesError);

    await companyModel.update(id, req.body, {
      certFile: req.file || null,
      existing: company,
    });
    return redirectList(res, `Empresa ${form.nombre} actualizada.`);
  } catch (err) {
    if (err.code === 'entorno_db_mismatch' || err.status === 400) {
      const form = formFromBody(req.body);
      const id = parseId(req.params.id);
      const company = id ? await companyModel.findById(id, panelEntorno(res)) : null;
      if (company) {
        return res.status(400).render('companies/editar', {
          title: 'Editar empresa',
          error: err.message,
          company: companyModel.toPublic(company),
          form,
        });
      }
    }
    if (err.message && /certificado|R2\/S3|Cloudflare R2|\.pfx|Access Denied/i.test(err.message)) {
      const form = formFromBody(req.body);
      const id = parseId(req.params.id);
      if (id) {
        const company = await companyModel.findById(id, panelEntorno(res));
        if (company) {
          return res.render('companies/editar', {
            title: 'Editar empresa',
            error: err.message,
            company: companyModel.toPublic(company),
            form: { ...formFromCompany(company), ...form },
          });
        }
      }
      return res.render('companies/crear', {
        title: 'Nueva empresa',
        error: err.message,
        form,
      });
    }
    next(err);
  }
}

async function activate(req, res, next) {
  try {
    const id = parseId(req.params.id);
    if (!id) return redirectList(res, 'Empresa no válida', 'error');

    const company = await companyModel.findById(id, panelEntorno(res));
    if (!company) return redirectList(res, 'Empresa no encontrada', 'error');

    await companyModel.setActive(id, true, panelEntorno(res));
    return redirectList(res, `Empresa ${company.nombre} activada.`);
  } catch (err) {
    next(err);
  }
}

async function deactivate(req, res, next) {
  try {
    const id = parseId(req.params.id);
    if (!id) return redirectList(res, 'Empresa no válida', 'error');

    const company = await companyModel.findById(id, panelEntorno(res));
    if (!company) return redirectList(res, 'Empresa no encontrada', 'error');

    await companyModel.setActive(id, false, panelEntorno(res));
    return redirectList(res, `Empresa ${company.nombre} desactivada.`);
  } catch (err) {
    next(err);
  }
}

async function destroy(req, res, next) {
  try {
    const id = parseId(req.params.id);
    if (!id) return redirectList(res, 'Empresa no válida', 'error');

    const company = await companyModel.findById(id, panelEntorno(res));
    if (!company) return redirectList(res, 'Empresa no encontrada', 'error');

    const result = await companyModel.remove(id, panelEntorno(res));
    if (result.error === 'has_users') {
      return redirectList(
        res,
        'No se puede eliminar: tiene usuarios vinculados. Desvincúlalos primero.',
        'error'
      );
    }
    if (result.error === 'has_data') {
      return redirectList(
        res,
        'No se puede eliminar: la empresa tiene almacenes, catálogo, comprobantes u otros datos. Desactívala en su lugar.',
        'error'
      );
    }

    return redirectList(res, `Empresa ${company.nombre} eliminada.`);
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
