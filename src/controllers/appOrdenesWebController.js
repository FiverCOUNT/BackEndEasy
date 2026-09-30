const ordenModel = require('../models/ordenModel');
const clienteModel = require('../models/clienteModel');
const catalogItemModel = require('../models/catalogItemModel');
const almacenModel = require('../models/almacenModel');
const productoSerieModel = require('../models/productoSerieModel');
const { appPath } = require('../config/appPanel');
const {
  layoutLocals,
  companyRucOf,
  parseFlash,
  redirectWithFlash,
  isWebCompanyAdmin,
} = require('../utils/appWebHelpers');
const { parseLoadMoreQuery, buildLoadMoreMeta, parseOffsetLimit, buildOffsetPage } = require('../utils/pagination');

function parseAddressEnvioFromForm(body = {}) {
  if (body.address_envio && typeof body.address_envio === 'object') {
    return body.address_envio;
  }
  const fields = {};
  for (const key of ['ubigeo', 'departamento', 'provincia', 'distrito', 'urbanizacion', 'direccion', 'cod_local']) {
    const flat = body[`address_envio_${key}`];
    if (flat != null && String(flat).trim()) fields[key] = String(flat).trim();
  }
  return Object.keys(fields).length ? fields : undefined;
}

function parseLineasFromBody(body) {
  const catalogIds = [].concat(body.catalog_item_id || []);
  const cantidades = [].concat(body.cantidad || []);
  const precios = [].concat(body.precio_unitario || []);
  const nombres = [].concat(body.nombre_linea || []);
  const almacenes = [].concat(body.almacen_id || []);
  const seriesIds = [].concat(body.producto_serie_id || []);
  const numerosSerie = [].concat(body.numero_serie || []);
  const lineas = [];
  const n = Math.max(
    catalogIds.length,
    cantidades.length,
    precios.length,
    nombres.length,
    almacenes.length,
    seriesIds.length,
    numerosSerie.length,
  );
  for (let i = 0; i < n; i += 1) {
    const catalogItemId = String(catalogIds[i] || '').trim();
    const cantidad = String(cantidades[i] || '').trim();
    const precio = String(precios[i] || '').trim();
    const nombre = String(nombres[i] || '').trim();
    const almacenId = String(almacenes[i] || '').trim();
    const productoSerieId = String(seriesIds[i] || '').trim();
    const numeroSerie = String(numerosSerie[i] || '').trim();
    if (!catalogItemId && !nombre && !cantidad && !precio && !almacenId) continue;
    lineas.push({
      catalog_item_id: catalogItemId || undefined,
      cantidad: cantidad || '1',
      precio_unitario: precio || undefined,
      nombre: nombre || undefined,
      almacen_id: almacenId || undefined,
      producto_serie_id: productoSerieId || undefined,
      numero_serie: numeroSerie || undefined,
    });
  }
  return lineas;
}

async function loadOrdenFormData(res, companyRuc) {
  const [{ items: clientes }, catalogo, almacenes] = await Promise.all([
    clienteModel.findByCompanyPaginated(companyRuc, { soloActivos: true, take: 500 }),
    catalogItemModel.findByCompanyRuc(companyRuc),
    almacenModel.findByCompanyRuc(companyRuc, { soloActivos: true }),
  ]);
  const webUser = res.locals.webUser || {};
  const isAdmin = isWebCompanyAdmin(webUser);
  const userAlmacenId = res.locals.userAlmacenId || webUser.almacenId || null;
  let almacenesFiltrados = almacenes.filter((a) => a.activo !== false);
  if (!isAdmin) {
    almacenesFiltrados = userAlmacenId
      ? almacenesFiltrados.filter((a) => a.id === userAlmacenId)
      : [];
  }
  const defaultAlmacenId = userAlmacenId || almacenesFiltrados[0]?.id || null;
  return {
    clientes,
    catalogo: catalogo.filter((c) => c.activo !== false),
    almacenes: almacenesFiltrados,
    defaultAlmacenId,
  };
}

async function list(req, res, next) {
  try {
    const companyRuc = companyRucOf(res);
    const { q, pageSize } = parseLoadMoreQuery(req.query);
    const estado = req.query.estado || '';

    const { total, items } = await ordenModel.findByCompanyPaginated(companyRuc, {
      q,
      estado: estado || null,
      skip: 0,
      take: pageSize,
    });

    const loadMore = buildLoadMoreMeta({
      total,
      limit: pageSize,
      basePath: appPath('/ordenes'),
      query: { q, estado, msg: req.query.msg, tipo: req.query.tipo },
    });

    res.render('app/ordenes/listar', layoutLocals(res, {
      title: 'Órdenes',
      active: 'ordenes',
      items,
      total,
      q,
      estado,
      loadMore,
      flash: parseFlash(req),
      noVistas: await ordenModel.countNoVistas(companyRuc),
    }));
  } catch (err) {
    next(err);
  }
}

async function showCreate(req, res, next) {
  try {
    const companyRuc = companyRucOf(res);
    const { clientes, catalogo, almacenes, defaultAlmacenId } = await loadOrdenFormData(res, companyRuc);
    res.render('app/ordenes/form', layoutLocals(res, {
      title: 'Nueva orden',
      active: 'ordenes',
      mode: 'create',
      error: null,
      clientes,
      catalogo,
      almacenes,
      defaultAlmacenId,
      form: {
        cliente_id: '',
        observacion: '',
        estado: 'BORRADOR',
        lineas: [{ catalog_item_id: '', cantidad: '1', precio_unitario: '', nombre_linea: '', almacen_id: defaultAlmacenId || '' }],
        address_envio: {},
      },
      orden: null,
    }));
  } catch (err) {
    next(err);
  }
}

async function create(req, res, next) {
  try {
    const companyRuc = companyRucOf(res);
    const body = req.body || {};
    await ordenModel.create(companyRuc, {
      cliente_id: body.cliente_id,
      observacion: body.observacion,
      estado: body.estado || 'BORRADOR',
      address_envio_id: body.address_envio_id || undefined,
      address_envio: parseAddressEnvioFromForm(body),
      lineas: parseLineasFromBody(body),
    });
    return redirectWithFlash(res, appPath('/ordenes'), 'Orden creada.');
  } catch (err) {
    const companyRuc = companyRucOf(res);
    const { clientes, catalogo, almacenes, defaultAlmacenId } = await loadOrdenFormData(res, companyRuc);
    return res.status(err.status || 500).render('app/ordenes/form', layoutLocals(res, {
      title: 'Nueva orden',
      active: 'ordenes',
      mode: 'create',
      error: err.message || 'No se pudo crear la orden.',
      clientes,
      catalogo,
      almacenes,
      defaultAlmacenId,
      form: {
        ...req.body,
        lineas: parseLineasFromBody(req.body || {}),
      },
      orden: null,
    }));
  }
}

async function showDetail(req, res, next) {
  try {
    const companyRuc = companyRucOf(res);
    await ordenModel.marcarVista(companyRuc, req.params.id);
    const orden = await ordenModel.findById(companyRuc, req.params.id);
    if (!orden) {
      return redirectWithFlash(res, appPath('/ordenes'), 'Orden no encontrada.', 'error');
    }
    res.render('app/ordenes/detalle', layoutLocals(res, {
      title: `Orden`,
      active: 'ordenes',
      orden,
      flash: parseFlash(req),
    }));
  } catch (err) {
    next(err);
  }
}

async function showEdit(req, res, next) {
  try {
    const companyRuc = companyRucOf(res);
    const orden = await ordenModel.findById(companyRuc, req.params.id);
    if (!orden) {
      return redirectWithFlash(res, appPath('/ordenes'), 'Orden no encontrada.', 'error');
    }
    if (orden.estado === 'FACTURADA' || orden.estado === 'ANULADA') {
      return redirectWithFlash(
        res,
        appPath(`/ordenes/${orden.id}`),
        `No se puede editar una orden ${orden.estado}.`,
        'error',
      );
    }
    const { clientes, catalogo, almacenes, defaultAlmacenId } = await loadOrdenFormData(res, companyRuc);
    res.render('app/ordenes/form', layoutLocals(res, {
      title: 'Editar orden',
      active: 'ordenes',
      mode: 'edit',
      error: null,
      clientes,
      catalogo,
      almacenes,
      defaultAlmacenId,
      orden,
      form: {
        cliente_id: orden.cliente_id,
        observacion: orden.observacion || '',
        estado: orden.estado,
        lineas: (orden.detalles || []).map((d) => ({
          catalog_item_id: d.catalog_item_id || '',
          cantidad: d.cantidad != null ? String(d.cantidad) : '1',
          precio_unitario: d.mto_precio_unitario != null ? String(d.mto_precio_unitario) : '',
          nombre_linea: d.nombre || d.descripcion || '',
          almacen_id: d.almacen_id || defaultAlmacenId || '',
          unidad: d.unidad || d.catalog_item?.unidad || '',
          producto_serie_id: d.producto_serie_id || '',
          numero_serie: d.producto_serie?.numero_serie || '',
          maneja_serie: Boolean(d.producto_serie_id),
        })),
        address_envio: orden.address_envio || {},
        address_envio_id: orden.address_envio_id || '',
      },
    }));
  } catch (err) {
    next(err);
  }
}

async function update(req, res, next) {
  try {
    const companyRuc = companyRucOf(res);
    const body = req.body || {};
    await ordenModel.update(companyRuc, req.params.id, {
      cliente_id: body.cliente_id,
      observacion: body.observacion,
      estado: body.estado,
      address_envio_id: body.address_envio_id || undefined,
      address_envio: parseAddressEnvioFromForm(body),
      lineas: parseLineasFromBody(body),
    });
    return redirectWithFlash(res, appPath(`/ordenes/${req.params.id}`), 'Orden actualizada.');
  } catch (err) {
    try {
      const companyRuc = companyRucOf(res);
      const orden = await ordenModel.findById(companyRuc, req.params.id);
      if (!orden) {
        return redirectWithFlash(res, appPath('/ordenes'), 'Orden no encontrada.', 'error');
      }
      const body = req.body || {};
      const { clientes, catalogo, almacenes, defaultAlmacenId } = await loadOrdenFormData(res, companyRuc);
      const lineas = parseLineasFromBody(body).map((d) => ({
        catalog_item_id: d.catalog_item_id || '',
        cantidad: d.cantidad != null ? String(d.cantidad) : '1',
        precio_unitario: d.precio_unitario != null ? String(d.precio_unitario) : '',
        nombre_linea: d.nombre || '',
        almacen_id: d.almacen_id || defaultAlmacenId || '',
        unidad: d.unidad || '',
        producto_serie_id: d.producto_serie_id || '',
        numero_serie: d.numero_serie || '',
        maneja_serie: Boolean(d.producto_serie_id || d.numero_serie),
      }));
      return res.status(400).render('app/ordenes/form', layoutLocals(res, {
        title: 'Editar orden',
        active: 'ordenes',
        mode: 'edit',
        error: err.message || 'No se pudo actualizar.',
        clientes,
        catalogo,
        almacenes,
        defaultAlmacenId,
        orden,
        form: {
          cliente_id: body.cliente_id || orden.cliente_id,
          observacion: body.observacion != null ? body.observacion : (orden.observacion || ''),
          estado: body.estado || orden.estado,
          lineas: lineas.length ? lineas : [],
          address_envio: parseAddressEnvioFromForm(body) || orden.address_envio || {},
          address_envio_id: body.address_envio_id || orden.address_envio_id || '',
        },
      }));
    } catch (renderErr) {
      return redirectWithFlash(
        res,
        appPath(`/ordenes/${req.params.id}/editar`),
        err.message || 'No se pudo actualizar.',
        'error',
      );
    }
  }
}

async function anular(req, res, next) {
  try {
    const companyRuc = companyRucOf(res);
    await ordenModel.anular(companyRuc, req.params.id);
    return redirectWithFlash(res, appPath('/ordenes'), 'Orden anulada.');
  } catch (err) {
    return redirectWithFlash(
      res,
      appPath(`/ordenes/${req.params.id}`),
      err.message || 'No se pudo anular.',
      'error',
    );
  }
}

async function destroy(req, res, next) {
  try {
    const companyRuc = companyRucOf(res);
    await ordenModel.destroy(companyRuc, req.params.id);
    return redirectWithFlash(res, appPath('/ordenes'), 'Orden eliminada.');
  } catch (err) {
    return redirectWithFlash(
      res,
      appPath('/ordenes'),
      err.message || 'No se pudo eliminar.',
      'error',
    );
  }
}

async function direccionesEnvioJson(req, res, next) {
  try {
    const companyRuc = companyRucOf(res);
    const { q, offset, limit } = parseOffsetLimit(req.query);
    const page = await ordenModel.listDireccionesEnvioCatalogo(companyRuc, { q, offset, limit });
    return res.json(buildOffsetPage({
      items: page.items,
      total: page.total,
      offset,
      limit,
    }));
  } catch (err) {
    next(err);
  }
}

async function crearDireccionEnvioJson(req, res, next) {
  try {
    const companyRuc = companyRucOf(res);
    const row = await ordenModel.crearDireccionEnvio(companyRuc, req.body || {});
    return res.status(201).json(row);
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ success: false, message: err.message });
    }
    next(err);
  }
}

async function eliminarDireccionEnvioJson(req, res, next) {
  try {
    const companyRuc = companyRucOf(res);
    const result = await ordenModel.eliminarDireccionEnvio(companyRuc, req.params.addrId);
    return res.json(result);
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ success: false, message: err.message });
    }
    next(err);
  }
}

async function actualizarDireccionEnvioJson(req, res, next) {
  try {
    const companyRuc = companyRucOf(res);
    const row = await ordenModel.actualizarDireccionEnvio(
      companyRuc,
      req.params.addrId,
      req.body || {},
    );
    return res.json(row);
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ success: false, message: err.message });
    }
    next(err);
  }
}

async function seriesDisponiblesJson(req, res, next) {
  try {
    const companyRuc = companyRucOf(res);
    const catalogItemId = String(req.params.catalogItemId || '').trim();
    const almacenId = String(req.query.almacen_id || req.query.almacenId || '').trim();
    if (!catalogItemId) {
      return res.status(400).json({ success: false, message: 'Producto inválido.' });
    }
    if (!almacenId) {
      return res.status(400).json({ success: false, message: 'almacen_id es obligatorio.' });
    }

    const item = await catalogItemModel.findById(catalogItemId);
    if (!item || item.companyRuc !== companyRuc) {
      return res.status(404).json({ success: false, message: 'Producto no encontrado.' });
    }
    if (!item.manejaSerie) {
      return res.json([]);
    }

    const almacen = await almacenModel.findById(almacenId);
    if (!almacen || almacen.companyRuc !== companyRuc) {
      return res.status(404).json({ success: false, message: 'Almacén no encontrado.' });
    }

    const series = await productoSerieModel.findDisponibles({
      companyRuc,
      catalogItemId,
      almacenId,
    });
    return res.json(series);
  } catch (err) {
    next(err);
  }
}

module.exports = {
  list,
  showCreate,
  create,
  showDetail,
  showEdit,
  update,
  anular,
  destroy,
  direccionesEnvioJson,
  crearDireccionEnvioJson,
  actualizarDireccionEnvioJson,
  eliminarDireccionEnvioJson,
  seriesDisponiblesJson,
};
