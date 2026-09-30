const inventarioModel = require('../models/inventarioModel');
const movimientoModel = require('../models/movimientoModel');
const ubicacionModel = require('../models/ubicacionModel');
const devolucionModel = require('../models/devolucionModel');
const { resolveCatalogQuery } = require('../utils/catalogAccess');
const {
  normalizeAlmacenId,
  resolveAlmacenFromBody,
  resolveAlmacenFromQuery,
} = require('../utils/almacenAccess');
const { parseMobileListQuery, sendMobilePage } = require('../utils/pagination');

async function list(req, res, next) {
  try {
    const { almacenId } = resolveCatalogQuery(req);
    const catalogItemId = (req.query.catalog_item_id || '').trim() || null;
    const soloConStock = req.query.solo_con_stock !== 'false';

    const items = await inventarioModel.findMany({
      companyRuc: req.companyRuc,
      almacenId,
      catalogItemId,
      soloConStock,
    });

    res.json(items);
  } catch (err) {
    next(err);
  }
}

async function getById(req, res, next) {
  try {
    const row = await inventarioModel.findById(req.params.id, req.companyRuc);
    if (!row) {
      return res.status(404).json({ success: false, message: 'Registro de inventario no encontrado' });
    }

    if (req.userRol !== 'ADMIN' && row.almacen_id !== normalizeAlmacenId(req.userAlmacenId)) {
      return res.status(403).json({ success: false, message: 'No puede consultar otro almacén' });
    }

    res.json(row);
  } catch (err) {
    next(err);
  }
}

async function setSaldo(req, res, next) {
  try {
    const catalogItemId = (req.body.catalog_item_id || req.body.catalogItemId || '').trim();
    const almacenId = resolveAlmacenFromBody(req, { required: true, defaultToUser: false });
    const cantidad = req.body.cantidad ?? req.body.cantidad_nueva;

    if (!catalogItemId) {
      return res.status(400).json({
        success: false,
        message: 'catalog_item_id es obligatorio',
      });
    }

    if (cantidad === undefined || cantidad === null) {
      return res.status(400).json({ success: false, message: 'cantidad es obligatoria' });
    }

    const result = await inventarioModel.establecerSaldo({
      companyRuc: req.companyRuc,
      catalogItemId,
      almacenId,
      cantidad,
    });

    if (result.error === 'item_not_found') {
      return res.status(404).json({ success: false, message: 'Producto no encontrado' });
    }
    if (result.error === 'almacen_not_found') {
      return res.status(404).json({ success: false, message: 'Almacén no encontrado' });
    }
    if (result.error === 'use_series') {
      return res.status(400).json({
        success: false,
        message: 'Este producto maneja serie; use producto_series e inventario por unidad',
      });
    }
    if (result.error === 'cantidad_invalida') {
      return res.status(400).json({ success: false, message: 'La cantidad no puede ser negativa' });
    }

    res.json({
      success: true,
      cantidad_anterior: result.cantidad_anterior,
      cantidad_nueva: result.cantidad_nueva,
      data: result.row,
    });
  } catch (err) {
    next(err);
  }
}

async function adjustSaldo(req, res, next) {
  try {
    const catalogItemId = (req.body.catalog_item_id || req.body.catalogItemId || '').trim();
    const almacenId = resolveAlmacenFromBody(req, { required: true, defaultToUser: false });
    const delta = req.body.delta ?? req.body.cantidad_delta;

    if (!catalogItemId) {
      return res.status(400).json({
        success: false,
        message: 'catalog_item_id es obligatorio',
      });
    }

    if (delta === undefined || delta === null || Number(delta) === 0) {
      return res.status(400).json({ success: false, message: 'delta es obligatorio y distinto de 0' });
    }

    const result = await inventarioModel.ajustarSaldo({
      companyRuc: req.companyRuc,
      catalogItemId,
      almacenId,
      delta,
    });

    if (result.error === 'item_not_found') {
      return res.status(404).json({ success: false, message: 'Producto no encontrado' });
    }
    if (result.error === 'almacen_not_found') {
      return res.status(404).json({ success: false, message: 'Almacén no encontrado' });
    }
    if (result.error === 'use_series') {
      return res.status(400).json({
        success: false,
        message: 'Este producto maneja serie; use producto_series e inventario por unidad',
      });
    }
    if (result.error === 'stock_insuficiente') {
      return res.status(409).json({
        success: false,
        message: 'Stock insuficiente',
        cantidad_actual: result.cantidad_actual,
      });
    }

    res.json({
      success: true,
      cantidad_anterior: result.cantidad_anterior,
      cantidad_nueva: result.cantidad_nueva,
      data: result.row,
    });
  } catch (err) {
    next(err);
  }
}

async function listMovimientos(req, res, next) {
  try {
    const tipo = (req.query.tipo || '').trim().toUpperCase() || null;
    const clienteId =
      (req.query.cliente_id || req.query.clienteId || '').trim() || null;
    const { page, pageSize, skip } = parseMobileListQuery(req.query);

    if (req.userRol !== 'ADMIN' && !req.userAlmacenId) {
      return sendMobilePage(res, { items: [], total: 0, page, pageSize });
    }

    const almacenId = resolveAlmacenFromQuery(req, { required: false });

    const result = clienteId
      ? await movimientoModel.findByCliente({
          companyRuc: req.companyRuc,
          clienteId,
          almacenId,
          skip,
          take: pageSize,
        })
      : await movimientoModel.findMany({
          companyRuc: req.companyRuc,
          tipo,
          almacenId,
          skip,
          take: pageSize,
        });

    return sendMobilePage(res, {
      items: result.items,
      total: result.total,
      page,
      pageSize,
    });
  } catch (err) {
    next(err);
  }
}

async function getMovimientoById(req, res, next) {
  try {
    const id = String(req.params.id || '').trim();
    if (!id) {
      return res.status(400).json({ success: false, message: 'ID de movimiento requerido' });
    }
    const row = await movimientoModel.findById(id, req.companyRuc);
    if (!row) {
      return res.status(404).json({ success: false, message: 'Movimiento no encontrado' });
    }
    if (
      req.userRol !== 'ADMIN' &&
      row.almacen_id !== normalizeAlmacenId(req.userAlmacenId) &&
      row.almacen_destino_id !== normalizeAlmacenId(req.userAlmacenId)
    ) {
      return res.status(403).json({ success: false, message: 'No puede consultar este movimiento' });
    }
    res.json(row);
  } catch (err) {
    next(err);
  }
}

function respondMovimientoError(res, result, { esSalida = false } = {}) {
  const handlers = {
    tipo_invalido: [400, 'tipo debe ser ENTRADA o SALIDA'],
    almacen_not_found: [404, 'Almacén no encontrado'],
    almacen_destino_not_found: [404, 'Almacén destino no encontrado'],
    mismo_almacen: [400, 'El almacén origen y destino no pueden ser el mismo'],
    lineas_vacias: [400, 'Debe incluir al menos una línea'],
    item_not_found: [404, 'Producto no encontrado'],
    item_inactivo: [400, 'Producto inactivo'],
    series_requeridas: [
      400,
      esSalida
        ? 'Producto serializado: indique las series a despachar'
        : 'Producto serializado: indique los números de serie',
    ],
    cantidad_series: [400, 'La cantidad debe coincidir con el número de series'],
    cantidad_invalida: [400, 'Cantidad inválida'],
    serie_duplicada_linea: [400, `Serie duplicada en la misma línea: ${result.numeroSerie}`],
    serie_existente: [
      409,
      result.numeroSerie
        ? `La serie ${result.numeroSerie} ya está registrada`
        : 'Uno de los números de serie ya está registrado',
    ],
    series_no_disponibles: [
      409,
      result.numeroSerie
        ? `La serie ${result.numeroSerie} no está disponible en el almacén`
        : 'Una o más series no están disponibles en el almacén',
    ],
    stock_insuficiente: [409, 'Stock insuficiente'],
    cliente_not_found: [404, 'Cliente no encontrado'],
    cliente_nombre_requerido: [400, 'Indique el nombre del cliente'],
    cliente_requerido: [400, 'Debe indicar un cliente'],
    almacen_destino_requerido: [400, 'El almacén de destino es obligatorio'],
    serie_no_entregada: [
      409,
      result.numeroSerie
        ? `La serie ${result.numeroSerie} no está entregada a un cliente`
        : 'Una o más series no están entregadas',
    ],
    serie_no_de_cliente: [
      409,
      result.numeroSerie
        ? `La serie ${result.numeroSerie} no fue entregada a este cliente`
        : 'Una o más series no corresponden al cliente indicado',
    ],
  };

  const handler = handlers[result.error];
  if (!handler) return false;

  const [status, message] = handler;
  const body = { success: false, message };
  if (result.error === 'stock_insuficiente') {
    body.catalog_item_id = result.catalogItemId;
    body.cantidad_actual = result.cantidad_actual;
  }
  res.status(status).json(body);
  return true;
}

async function cargarInventarioAfectado(companyRuc, movimiento) {
  const catalogItemIds = [
    ...new Set((movimiento.lineas || []).map((l) => l.catalog_item_id).filter(Boolean)),
  ];
  if (catalogItemIds.length === 0) return [];

  const almacenIds = [movimiento.almacen_id];
  if (movimiento.almacen_destino_id) almacenIds.push(movimiento.almacen_destino_id);

  const porAlmacen = await Promise.all(
    almacenIds.map((almacenId) =>
      inventarioModel.findMany({ companyRuc, almacenId, soloConStock: false }),
    ),
  );

  return porAlmacen
    .flat()
    .filter((row) => catalogItemIds.includes(row.catalog_item_id));
}

async function ejecutarRegistroMovimiento(req, res, next, { tipoFijo = null, conInventario = false } = {}) {
  try {
    const tipo = (tipoFijo || req.body.tipo || '').trim().toUpperCase();
    if (!tipo || !['ENTRADA', 'SALIDA'].includes(tipo)) {
      return res.status(400).json({
        success: false,
        message: 'tipo debe ser ENTRADA o SALIDA',
      });
    }

    const lineas = req.body.lineas || [];
    const observaciones = req.body.observaciones ?? null;

    let almacenId;
    if (tipo === 'ENTRADA') {
      almacenId = resolveAlmacenFromBody(req, { required: true, defaultToUser: true });
    } else {
      almacenId = resolveAlmacenFromBody(req, { required: false, defaultToUser: true });
      if (!almacenId) {
        return res.status(400).json({
          success: false,
          message: 'No hay almacén de procedencia; asigna un almacén al usuario',
        });
      }
    }

    const params = {
      companyRuc: req.companyRuc,
      tipo,
      almacenId,
      lineas,
      observaciones,
      usuarioId: req.userId ?? null,
    };

    if (tipo === 'ENTRADA') {
      params.clienteId = (req.body.cliente_id || req.body.clienteId || '').trim() || null;
      params.cliente = req.body.cliente || null;
      params.referenciaTipo =
        (req.body.referencia_tipo || req.body.referenciaTipo || '').trim() || null;
      params.referenciaId =
        (req.body.referencia_id || req.body.referenciaId || '').trim() || null;
      params.comprobanteId =
        (req.body.comprobante_id || req.body.comprobanteId || '').trim() || null;
    }

    if (tipo === 'SALIDA') {
      params.almacenDestinoId = normalizeAlmacenId(
        req.body.almacen_destino_id ?? req.body.almacenDestinoId,
      );
      if (params.almacenDestinoId && req.userRol !== 'ADMIN') {
        return res.status(403).json({
          success: false,
          message: 'Solo un administrador puede trasladar entre almacenes',
        });
      }
      if (params.almacenDestinoId && params.almacenDestinoId === almacenId) {
        return res.status(400).json({
          success: false,
          message: 'El almacén de destino no puede ser el mismo que el de procedencia',
        });
      }
      params.comprobanteId =
        (req.body.comprobante_id || req.body.comprobanteId || '').trim() || null;
      params.guiaRemisionId =
        (req.body.guia_remision_id || req.body.guiaRemisionId || '').trim() || null;
      params.clienteId = (req.body.cliente_id || req.body.clienteId || '').trim() || null;
      params.cliente = req.body.cliente || null;
    }
    const result = await movimientoModel.registrarMovimiento(params);

    if (respondMovimientoError(res, result, { esSalida: tipo === 'SALIDA' })) {
      return;
    }

    if (conInventario) {
      const inventarioAfectado = await cargarInventarioAfectado(
        req.companyRuc,
        result.movimiento,
      );
      return res.status(201).json({
        success: true,
        movimiento: result.movimiento,
        inventario_afectado: inventarioAfectado,
      });
    }

    res.status(201).json(result.movimiento);
  } catch (err) {
    next(err);
  }
}

async function registrarMovimiento(req, res, next) {
  return ejecutarRegistroMovimiento(req, res, next, { conInventario: true });
}

async function registrarEntrada(req, res, next) {
  return ejecutarRegistroMovimiento(req, res, next, { tipoFijo: 'ENTRADA' });
}

async function registrarSalida(req, res, next) {
  return ejecutarRegistroMovimiento(req, res, next, { tipoFijo: 'SALIDA' });
}

async function buscarUbicaciones(req, res, next) {
  try {
    const q = (req.query.q || '').trim();
    const modo = (req.query.modo || 'serie').trim().toLowerCase();

    if (!q || q.length < 2) {
      return res.json([]);
    }

    if (!['serie', 'nombre'].includes(modo)) {
      return res.status(400).json({
        success: false,
        message: 'modo debe ser serie o nombre',
      });
    }

    if (req.userRol !== 'ADMIN' && !req.userAlmacenId) {
      return res.json([]);
    }

    const almacenId = resolveAlmacenFromQuery(req, { required: false });

    const items =
      modo === 'serie'
        ? await ubicacionModel.buscarPorSerie({
            companyRuc: req.companyRuc,
            q,
            almacenId,
          })
        : await ubicacionModel.buscarPorNombre({
            companyRuc: req.companyRuc,
            q,
            almacenId,
          });

    res.json(items);
  } catch (err) {
    next(err);
  }
}

async function listDevolucionesPendientes(req, res, next) {
  try {
    const clienteId = (req.query.cliente_id || req.query.clienteId || '').trim();
    if (!clienteId) {
      return res.status(400).json({
        success: false,
        message: 'cliente_id es obligatorio',
      });
    }

    const result = await devolucionModel.findPendientesPorCliente(req.companyRuc, clienteId);
    if (result.error === 'cliente_not_found') {
      return res.status(404).json({ success: false, message: 'Cliente no encontrado' });
    }

    res.json(result.items);
  } catch (err) {
    next(err);
  }
}

async function listSalidas(req, res, next) {
  try {
    const { page, pageSize, skip } = parseMobileListQuery(req.query);

    if (req.userRol !== 'ADMIN' && !req.userAlmacenId) {
      return sendMobilePage(res, { items: [], total: 0, page, pageSize });
    }

    const almacenId = resolveAlmacenFromQuery(req, { required: false });

    const result = await movimientoModel.findMany({
      companyRuc: req.companyRuc,
      tipo: 'SALIDA',
      almacenId,
      skip,
      take: pageSize,
    });

    return sendMobilePage(res, {
      items: result.items,
      total: result.total,
      page,
      pageSize,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  list,
  getById,
  setSaldo,
  adjustSaldo,
  listMovimientos,
  getMovimientoById,
  registrarMovimiento,
  registrarEntrada,
  registrarSalida,
  buscarUbicaciones,
  listDevolucionesPendientes,
  listSalidas,
};
