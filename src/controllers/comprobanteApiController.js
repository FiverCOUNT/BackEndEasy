const comprobanteModel = require('../models/comprobanteModel');
const productoSerieModel = require('../models/productoSerieModel');
const comprobanteEmisionService = require('../services/comprobanteEmisionService');
const emisorClient = require('../services/emisorClient');
const greEventoService = require('../services/greEventoService');
const {
  readAlmacenFromBody,
  readAlmacenFromQuery,
  normalizeAlmacenId,
} = require('../utils/almacenAccess');

const TIPOS_EMITIBLES = comprobanteEmisionService.TIPOS_EMITIBLES;
const ESTADOS_REEMITIBLES = comprobanteEmisionService.ESTADOS_REEMITIBLES;

function apiBaseFromRequest(req) {
  return `${req.protocol}://${req.get('host')}`;
}

/** Almacén efectivo: body/query explícito primero; almacén del usuario solo como fallback. */
function serializeOptions(req) {
  const almacenId =
    readAlmacenFromBody(req)
    || readAlmacenFromQuery(req)
    || normalizeAlmacenId(req.userAlmacenId);

  return {
    apiBaseUrl: apiBaseFromRequest(req),
    companyRuc: req.companyRuc,
    almacenId,
  };
}

/**
 * Mobile: POST /comprobantes
 * 1. Crea el comprobante en Prisma
 * 2. Llama al backend PHP (EMISOR)
 * 3. Persiste la respuesta SUNAT en Invoice
 * 4. Devuelve el comprobante guardado
 */
async function crearYEmitir(req, res, next) {
  try {
    const result = await comprobanteEmisionService.crearYEmitirDesdeMobile(
      req.companyRuc,
      req.body,
      serializeOptions(req),
    );

    return res.status(result.status).json(result.body);
  } catch (err) {
    if (err.message && !err.name) {
      return res.status(400).json({ success: false, message: err.message });
    }
    next(err);
  }
}

async function list(req, res, next) {
  try {
    const rows = await comprobanteModel.findAllByCompany(req.companyRuc, {
      desde: req.query.desde,
      hasta: req.query.hasta,
      ...serializeOptions(req),
    });
    res.json(rows);
  } catch (err) {
    next(err);
  }
}

async function listCompras(req, res, next) {
  try {
    const rows = await comprobanteModel.findComprasByCompany(req.companyRuc, {
      desde: req.query.desde,
      hasta: req.query.hasta,
      ...serializeOptions(req),
    });
    res.json(rows);
  } catch (err) {
    next(err);
  }
}

async function getById(req, res, next) {
  try {
    const invoice = await comprobanteModel.findByIdForEmission(req.params.id, req.companyRuc);
    if (!invoice) {
      return res.status(404).json({ success: false, message: 'Comprobante no encontrado' });
    }

    res.json(await comprobanteModel.toApiInvoiceEnriched(invoice, serializeOptions(req)));
  } catch (err) {
    next(err);
  }
}

/** Series entregadas al cliente en la venta (para NC de devolución). */
async function listSeriesEntregadas(req, res, next) {
  try {
    const result = await productoSerieModel.findEntregadasPorComprobante(
      req.companyRuc,
      req.params.id,
    );
    if (result.error === 'comprobante_not_found') {
      return res.status(404).json({ success: false, message: 'Comprobante no encontrado' });
    }
    res.json(result.items);
  } catch (err) {
    next(err);
  }
}

async function descargarArchivo(req, res, next) {
  try {
    const invoice = await comprobanteModel.findByIdForCompanyAccess(req.params.id, req.companyRuc);
    if (!invoice) {
      return res.status(404).json({ success: false, message: 'Comprobante no encontrado' });
    }

    const formato = String(req.query.formato || 'a4').trim().toLowerCase();
    const archivo = await comprobanteModel.getArchivoBuffer(invoice, req.params.tipo, {
      formato,
      apiBaseUrl: apiBaseFromRequest(req),
    });
    if (!archivo) {
      return res.status(404).json({ success: false, message: 'Archivo no disponible' });
    }

    const sufijo = req.params.tipo === 'pdf' && (formato === 'ticket' || formato === 'thermal') ? '-ticket' : '';
    const nombre = `${invoice.serie}-${invoice.correlativo}${sufijo}.${archivo.ext}`;
    res.setHeader('Content-Type', archivo.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${nombre}"`);
    return res.send(archivo.buffer);
  } catch (err) {
    next(err);
  }
}

/** Re-emite un borrador existente por id (uso interno / admin). */
async function emitir(req, res, next) {
  try {
    let invoice = await comprobanteModel.findByIdForEmission(req.params.id, req.companyRuc);
    if (!invoice) {
      return res.status(404).json({ success: false, message: 'Comprobante no encontrado' });
    }

    if (
      invoice.estado === 'RECHAZADO'
      && req.body
      && typeof req.body === 'object'
      && Object.keys(req.body).length > 0
    ) {
      const actualizado = await comprobanteModel.updateRejectedFromMobileRequest(
        req.params.id,
        req.companyRuc,
        req.body,
      );
      if (actualizado) invoice = actualizado;
    }

    if (!TIPOS_EMITIBLES.has(invoice.tipoDoc)) {
      return res.status(400).json({
        success: false,
        message: `Emisión no soportada para tipo ${invoice.tipoDoc}.`,
      });
    }

    if (!ESTADOS_REEMITIBLES.has(invoice.estado)) {
      return res.status(409).json({
        success: false,
        message: `El comprobante ya fue procesado (estado: ${invoice.estado}).`,
      });
    }

    const emitOptions = comprobanteEmisionService.resolveInventarioEmitOptions(invoice, {
      ...serializeOptions(req),
      almacenId:
        serializeOptions(req).almacenId
        || req.body?.almacen_id
        || req.body?.almacenId
        || null,
    });

    const comprobante = await comprobanteEmisionService.emitirComprobanteExistente(
      invoice,
      emitOptions,
    );
    const sunatOk = comprobante.estado === 'ACEPTADO' || comprobante.estado === 'ENVIADO';

    return res.status(200).json({
      ...comprobante,
      success: sunatOk,
      sunat_ok: sunatOk,
    });
  } catch (err) {
    if (err.code === 'inventario') {
      return res.status(409).json({
        success: false,
        message: err.message,
        inventario: err.inventario || null,
      });
    }
    if (err.name === 'EmisorClientError') {
      return res.status(err.status || 502).json({
        success: false,
        message: err.message,
        emisor: err.data || null,
      });
    }
    if (err.message) {
      return res.status(400).json({ success: false, message: err.message });
    }
    next(err);
  }
}

async function enviarResumen(req, res, next) {
  try {
    const fecha = (req.body.fecha_resumen || req.body.fechaResumen || req.query.fecha || null);
    const result = await comprobanteEmisionService.enviarResumenDiario(req.companyRuc, {
      fecha,
      apiBaseUrl: apiBaseFromRequest(req),
    });

    if (!result.success) {
      return res.status(422).json({ success: false, message: result.message || result.error?.mensaje, resumen: result });
    }

    res.json({ success: true, resumen: result });
  } catch (err) {
    if (err.name === 'EmisorClientError') {
      return res.status(err.status || 502).json({
        success: false,
        message: err.message,
        emisor: err.data || null,
      });
    }
    if (err.message) {
      return res.status(400).json({ success: false, message: err.message });
    }
    next(err);
  }
}

async function healthEmisor(req, res, next) {
  try {
    const data = await emisorClient.health();
    res.json({ success: true, emisor: data });
  } catch (err) {
    if (err.name === 'EmisorClientError') {
      return res.status(err.status || 502).json({
        success: false,
        message: err.message,
      });
    }
    next(err);
  }
}

async function registrarGreEvento(req, res, next) {
  try {
    const result = await greEventoService.registrarEvento(
      req.companyRuc,
      req.params.id,
      req.body,
    );
    return res.status(result.success ? 200 : 502).json(result);
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ success: false, message: err.message });
    }
    if (err.message) {
      return res.status(400).json({ success: false, message: err.message });
    }
    next(err);
  }
}

async function comunicarGreBaja(req, res, next) {
  try {
    const result = await greEventoService.comunicarBaja(
      req.companyRuc,
      req.params.id,
      req.body,
    );
    return res.status(result.success ? 200 : 502).json(result);
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ success: false, message: err.message });
    }
    if (err.message) {
      return res.status(400).json({ success: false, message: err.message });
    }
    next(err);
  }
}

async function eliminar(req, res, next) {
  try {
    const result = await comprobanteModel.deleteNoAceptadoInvoice(
      req.params.id,
      req.companyRuc,
    );
    const stockMsg = result.inventario?.revertido
      ? ' Stock devuelto al almacén.'
      : '';
    return res.json({
      success: true,
      message: `Comprobante ${result.serie}-${result.correlativo} eliminado.${stockMsg}`,
      id: result.id,
      inventario: result.inventario || undefined,
    });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ success: false, message: err.message });
    }
    next(err);
  }
}

/** Descuenta stock de una factura/boleta ya emitida (sin pantalla intermedia). */
async function restarAlmacen(req, res, next) {
  try {
    const comprobanteInventarioService = require('../services/comprobanteInventarioService');
    const invoice = await comprobanteModel.findByIdForEmission(req.params.id, req.companyRuc);
    if (!invoice) {
      return res.status(404).json({ success: false, message: 'Comprobante no encontrado' });
    }
    if (!['01', '03'].includes(String(invoice.tipoDoc || ''))) {
      return res.status(400).json({
        success: false,
        message: 'Solo se puede restar almacén en facturas y boletas de venta.',
      });
    }
    if (!['ACEPTADO', 'ENVIADO'].includes(String(invoice.estado || ''))) {
      return res.status(400).json({
        success: false,
        message: 'El comprobante debe estar aceptado o enviado por SUNAT.',
      });
    }

    const almacenId =
      readAlmacenFromBody(req)
      || normalizeAlmacenId(invoice.almacenId)
      || normalizeAlmacenId(req.userAlmacenId);

    const result = await comprobanteInventarioService.registrarSalidaPorComprobante(invoice, {
      almacenId,
    });

    if (!result.aplicado) {
      if (result.motivo === 'ya_registrado') {
        const comprobante = await comprobanteModel.toApiInvoiceEnriched(invoice, serializeOptions(req));
        return res.json({
          success: true,
          message: 'El stock de este comprobante ya estaba descontado.',
          movimiento_salida_id: result.movimiento_id,
          comprobante,
        });
      }
      const status = ['stock_insuficiente', 'series_no_disponibles'].includes(result.motivo)
        ? 409
        : 400;
      return res.status(status).json({
        success: false,
        message: result.message || `No se pudo descontar: ${result.motivo}`,
        motivo: result.motivo,
      });
    }

    const comprobante = await comprobanteModel.toApiInvoiceEnriched(invoice, {
      ...serializeOptions(req),
      movimientoSalidaId: result.movimiento_id,
    });
    return res.status(201).json({
      success: true,
      message: 'Stock descontado del almacén',
      movimiento_salida_id: result.movimiento_id,
      movimiento: result.movimiento,
      comprobante,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  crearYEmitir,
  list,
  listCompras,
  getById,
  listSeriesEntregadas,
  descargarArchivo,
  emitir,
  enviarResumen,
  healthEmisor,
  registrarGreEvento,
  comunicarGreBaja,
  eliminar,
  restarAlmacen,
};
