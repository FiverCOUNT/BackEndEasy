const comprobanteModel = require('../models/comprobanteModel');
const { buildPayload, buildResumenPayload } = require('./comprobantePayloadBuilder');
const credencialesSunatService = require('./credencialesSunatService');
const comprobanteInventarioService = require('./comprobanteInventarioService');
const emisorClient = require('./emisorClient');

const INVENTARIO_OMITIR = new Set(['tipo_no_aplica', 'sin_lineas_inventario']);

function inventarioDebeBloquearEmision(inventario) {
  if (!inventario || inventario.aplicado || inventario.motivo === 'ya_registrado') return false;
  return !INVENTARIO_OMITIR.has(inventario.motivo);
}

async function payloadParaEmision(invoice) {
  const payload = buildPayload(invoice);
  return credencialesSunatService.attachToPayload(invoice.company, payload, {
    tipoDoc: invoice.tipoDoc,
  });
}

async function payloadResumenParaEmision(company, boletas, correlativo) {
  const payload = buildResumenPayload(company, boletas, correlativo);
  return credencialesSunatService.attachToPayload(company, payload);
}

const TIPOS_EMITIBLES = new Set(['01', '03', '07', '08', '09', '31']);
const ESTADOS_REEMITIBLES = new Set(['BORRADOR', 'RECHAZADO']);

function resolveInventarioEmitOptions(invoice, options = {}) {
  return {
    ...options,
    almacenId: options.almacenId || invoice.almacenId || null,
  };
}

function mergeBoletaConResumen(boletaData, resumenData) {
  if (!resumenData) return boletaData;

  const aceptada = resumenData.success && resumenData.estado === 'ACEPTADA';

  return {
    ...boletaData,
    resumen: resumenData,
    success: aceptada || boletaData.success,
    estado: aceptada ? 'ACEPTADA' : (resumenData.estado || boletaData.estado),
    codigo_cdr: resumenData.codigo_cdr ?? boletaData.codigo_cdr,
    descripcion: resumenData.descripcion || boletaData.descripcion,
    observaciones: resumenData.observaciones ?? boletaData.observaciones,
    cdr_zip: resumenData.cdr_zip || boletaData.cdr_zip,
    ticket: resumenData.ticket,
  };
}

async function aplicarInventarioPostEmision(invoiceId, companyRuc, comprobanteApi, options) {
  if (!comprobanteApi?.estado) return null;

  const invoice = await comprobanteModel.findByIdForEmission(invoiceId, companyRuc);
  if (!invoice) return null;

  return comprobanteInventarioService.registrarSalidaPorComprobante(
    { ...invoice, estado: comprobanteApi.estado },
    options,
  );
}

async function emitirBoletaConResumen(invoice, options = {}) {
  const emitOpts = resolveInventarioEmitOptions(invoice, options);
  const payload = await payloadParaEmision(invoice);
  const { data: boletaData } = await emisorClient.emitirComprobante('03', payload);

  if (!boletaData.success || boletaData.estado !== 'GENERADA') {
    const comprobante = await comprobanteModel.applyEmisionResult(
      invoice.id,
      invoice.companyRuc,
      invoice.tipoDoc,
      boletaData,
      emitOpts,
    );
    const inventario = await aplicarInventarioPostEmision(invoice.id, invoice.companyRuc, comprobante, emitOpts);
    return inventario?.aplicado || inventario?.motivo ? { ...comprobante, inventario } : comprobante;
  }

  const resumenPayload = await payloadResumenParaEmision(
    invoice.company,
    [invoice],
    await comprobanteModel.getNextResumenCorrelativo(invoice.companyRuc),
  );

  let resumenData;
  try {
    ({ data: resumenData } = await emisorClient.emitirResumen(resumenPayload));
  } catch (err) {
    const parcial = mergeBoletaConResumen(boletaData, null);
    parcial.resumen_error = err.message;
    const comprobante = await comprobanteModel.applyEmisionResult(
      invoice.id,
      invoice.companyRuc,
      invoice.tipoDoc,
      parcial,
      emitOpts,
    );
    const inventario = await aplicarInventarioPostEmision(invoice.id, invoice.companyRuc, comprobante, emitOpts);
    return inventario?.aplicado || inventario?.motivo ? { ...comprobante, inventario } : comprobante;
  }

  const finalData = mergeBoletaConResumen(boletaData, resumenData);
  const comprobante = await comprobanteModel.applyEmisionResult(
    invoice.id,
    invoice.companyRuc,
    invoice.tipoDoc,
    finalData,
    emitOpts,
  );
  const inventario = await aplicarInventarioPostEmision(invoice.id, invoice.companyRuc, comprobante, emitOpts);
  return inventario?.aplicado || inventario?.motivo ? { ...comprobante, inventario } : comprobante;
}

async function emitirComprobanteExistente(invoice, options = {}) {
  const emitOpts = resolveInventarioEmitOptions(invoice, options);

  const inventarioReserva = await comprobanteInventarioService.registrarSalidaPorComprobante(
    invoice,
    emitOpts,
  );
  if (inventarioDebeBloquearEmision(inventarioReserva)) {
    const err = new Error(inventarioReserva.message || 'No hay stock suficiente para esta venta.');
    err.code = 'inventario';
    err.inventario = inventarioReserva;
    throw err;
  }

  let comprobante;
  if (invoice.tipoDoc === '03') {
    comprobante = await emitirBoletaConResumen(invoice, emitOpts);
  } else {
    const payload = await payloadParaEmision(invoice);
    const { data: emisorData } = await emisorClient.emitirComprobante(invoice.tipoDoc, payload);
    comprobante = await comprobanteModel.applyEmisionResult(
      invoice.id,
      invoice.companyRuc,
      invoice.tipoDoc,
      emisorData,
      emitOpts,
    );
    const inventario = await aplicarInventarioPostEmision(invoice.id, invoice.companyRuc, comprobante, emitOpts);
    comprobante = inventario?.aplicado || inventario?.motivo
      ? { ...comprobante, inventario }
      : comprobante;
  }

  if (inventarioReserva.aplicado && !comprobante.inventario) {
    comprobante = { ...comprobante, inventario: inventarioReserva };
  }
  return comprobante;
}

async function enviarResumenDiario(companyRuc, { fecha = null, apiBaseUrl = null } = {}) {
  const boletas = await comprobanteModel.findBoletasPendientesResumen(companyRuc, fecha);
  if (!boletas.length) {
    return { success: false, message: 'No hay boletas pendientes de resumen para la fecha indicada.' };
  }

  const company = await comprobanteModel.findCompany(companyRuc);
  const correlativo = await comprobanteModel.getNextResumenCorrelativo(companyRuc);
  const payload = await payloadResumenParaEmision(company, boletas, correlativo);
  const { data: resumenData } = await emisorClient.emitirResumen(payload);

  if (resumenData.success) {
    await comprobanteModel.marcarBoletasResumidas(
      boletas.map((b) => b.id),
      resumenData,
      { apiBaseUrl },
    );
  }

  return resumenData;
}

async function crearYEmitirDesdeMobile(companyRuc, body, options = {}) {
  const invoice = await comprobanteModel.createFromMobileRequest(companyRuc, body);

  if (!TIPOS_EMITIBLES.has(invoice.tipoDoc)) {
    return {
      status: 400,
      body: {
        success: false,
        message: `Tipo de comprobante no soportado: ${invoice.tipoDoc}`,
        comprobante: comprobanteModel.toApiInvoice(invoice, options),
      },
    };
  }

  const emitOptions = resolveInventarioEmitOptions(invoice, {
    ...options,
    almacenId: options.almacenId || body.almacen_id || body.almacenId || null,
    lineasBody: invoice.tipoDoc === '07' ? (body.lineas || body.lineasBody || null) : null,
  });

  try {
    const comprobante = await emitirComprobanteExistente(invoice, emitOptions);
    const sunatOk = ['ACEPTADO', 'ENVIADO'].includes(comprobante.estado);

    return {
      status: 201,
      body: {
        ...comprobante,
        success: sunatOk,
        sunat_ok: sunatOk,
      },
    };
  } catch (err) {
    if (err.code === 'inventario') {
      await comprobanteModel.deleteDraftInvoice(invoice.id, companyRuc);
      return {
        status: 409,
        body: {
          success: false,
          message: err.message,
          inventario: err.inventario || null,
        },
      };
    }

    const guardado = await comprobanteModel.toApiInvoiceEnriched(
      (await comprobanteModel.findByIdForEmission(invoice.id, companyRuc)) || invoice,
      options,
    );

    const isEmisor = err.name === 'EmisorClientError';
    const isSunatConfig = /SUNAT|certificado|SOL|credenciales/i.test(String(err.message || ''));

    return {
      status: 201,
      body: {
        ...guardado,
        success: false,
        sunat_ok: false,
        message: err.message,
        emisor: isEmisor ? err.data || null : null,
        error_tipo: isEmisor ? 'emisor' : isSunatConfig ? 'sunat_config' : 'emision',
      },
    };
  }
}

module.exports = {
  emitirComprobanteExistente,
  emitirBoletaConResumen,
  enviarResumenDiario,
  crearYEmitirDesdeMobile,
  resolveInventarioEmitOptions,
  ESTADOS_REEMITIBLES,
  TIPOS_EMITIBLES,
};

