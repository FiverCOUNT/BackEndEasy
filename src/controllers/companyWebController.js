const companyModel = require('../models/companyModel');
const {
  buildSeriesConfigFromBody,
  seriesConfigToFormFields,
  defaultSeriesConfig,
  validateSeriesConfig,
} = require('../utils/seriesConfig');
const { parseListQuery, buildPageMeta } = require('../utils/pagination');

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

function redirectList(res, message, type = 'success') {
  const q = new URLSearchParams({ msg: message, tipo: type });
  return res.redirect(`/companies?${q.toString()}`);
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
    isActive: body.isActive !== 'off' && body.isActive !== 'false',
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
    isActive: c.isActive !== false,
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
    const { total, items } = await companyModel.findPaginated({
      q,
      page,
      pageSize,
      skip,
    });

    const pagination = buildPageMeta({
      total,
      page,
      pageSize,
      basePath: '/companies',
      query: { q, msg: req.query.msg, tipo: req.query.tipo },
    });

    res.render('companies/listar', {
      title: 'Empresas',
      companies: items,
      total,
      q,
      pageSize,
      pagination,
      flash: parseFlash(req),
      searchAction: '/companies',
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
      form: formFromBody({ activo: 'on', isActive: 'on', tipoDoc: '6', entorno: 'beta', ...seriesConfigToFormFields(defaultSeriesConfig()) }),
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
    if (await companyModel.findByRuc(form.ruc)) {
      return renderError('Ya existe una empresa con ese RUC.');
    }

    const seriesError = validateSeriesConfig(buildSeriesConfigFromBody(req.body));
    if (seriesError) return renderError(seriesError);

    await companyModel.create(req.body, { certFile: req.file || null });
    return redirectList(res, `Empresa ${form.nombre} creada correctamente.`);
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

    const company = await companyModel.findById(id);
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

    const company = await companyModel.findById(id);
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
    if (await companyModel.findByRucExceptId(form.ruc, id)) {
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
    if (err.message && /certificado|R2\/S3|Cloudflare R2|\.pfx|Access Denied/i.test(err.message)) {
      const form = formFromBody(req.body);
      const id = parseId(req.params.id);
      if (id) {
        const company = await companyModel.findById(id);
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

    const company = await companyModel.findById(id);
    if (!company) return redirectList(res, 'Empresa no encontrada', 'error');

    await companyModel.setActive(id, true);
    return redirectList(res, `Empresa ${company.nombre} activada.`);
  } catch (err) {
    next(err);
  }
}

async function deactivate(req, res, next) {
  try {
    const id = parseId(req.params.id);
    if (!id) return redirectList(res, 'Empresa no válida', 'error');

    const company = await companyModel.findById(id);
    if (!company) return redirectList(res, 'Empresa no encontrada', 'error');

    await companyModel.setActive(id, false);
    return redirectList(res, `Empresa ${company.nombre} desactivada.`);
  } catch (err) {
    next(err);
  }
}

async function destroy(req, res, next) {
  try {
    const id = parseId(req.params.id);
    if (!id) return redirectList(res, 'Empresa no válida', 'error');

    const company = await companyModel.findById(id);
    if (!company) return redirectList(res, 'Empresa no encontrada', 'error');

    const result = await companyModel.remove(id);
    if (result.error === 'has_users') {
      return redirectList(
        res,
        'No se puede eliminar: tiene usuarios vinculados. Desvincúlalos primero.',
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
