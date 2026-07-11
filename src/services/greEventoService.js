const comprobanteModel = require('../models/comprobanteModel');
const credencialesSunatService = require('./credencialesSunatService');
const emisorClient = require('./emisorClient');
const { parseStoredTimestamp } = require('../utils/fechas');

const GRE_TIPOS = new Set(['09', '31']);
const ESTADOS_GRE_EVENTO = new Set(['ACEPTADO', 'ENVIADO']);

const EVENTOS_SUNAT = {
  '01': 'Inicio de traslado',
  '02': 'Llegada al punto de llegada',
  '03': 'Entrega de bienes',
};

function formatFechaEvento(value) {
  const ms = parseStoredTimestamp(value);
  const date = ms != null ? new Date(ms) : new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
  ].join('-') + ` ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

async function findGuiaAceptada(companyRuc, guiaId) {
  const invoice = await comprobanteModel.findByIdForEmission(guiaId, companyRuc);
  if (!invoice) {
    const err = new Error('Guía de remisión no encontrada.');
    err.status = 404;
    throw err;
  }
  if (!GRE_TIPOS.has(invoice.tipoDoc)) {
    const err = new Error('El comprobante no es una guía de remisión electrónica.');
    err.status = 400;
    throw err;
  }
  if (!ESTADOS_GRE_EVENTO.has(invoice.estado)) {
    const err = new Error('Solo puedes registrar eventos sobre guías aceptadas o enviadas a SUNAT.');
    err.status = 400;
    throw err;
  }
  return invoice;
}

async function appendGreEventoMeta(invoiceId, entry) {
  const row = await comprobanteModel.findInvoiceRow(invoiceId);
  const prev = row?.sunatJson && typeof row.sunatJson === 'object' ? row.sunatJson : {};
  const eventos = Array.isArray(prev.gre_eventos) ? prev.gre_eventos : [];
  const next = {
    ...prev,
    gre_eventos: [...eventos, { ...entry, registrado_en: new Date().toISOString() }],
  };
  await comprobanteModel.updateSunatJson(invoiceId, next);
  return next;
}

async function payloadGreBase(invoice) {
  const company = invoice.company;
  if (!company) throw new Error('No se encontró la empresa emisora.');
  const payload = {
    guia: {
      tipo_doc: invoice.tipoDoc,
      serie: invoice.serie,
      correlativo: String(invoice.correlativo),
    },
    emisor: {
      ruc: company.ruc,
      razon_social: company.nombre,
    },
  };
  return credencialesSunatService.attachToPayload(company, payload, { tipoDoc: invoice.tipoDoc });
}

async function registrarEvento(companyRuc, guiaId, body = {}) {
  const invoice = await findGuiaAceptada(companyRuc, guiaId);
  const codigo = String(body.codigo_evento || body.codigoEvento || '01').trim();
  if (!EVENTOS_SUNAT[codigo]) {
    const err = new Error(`Código de evento no válido: ${codigo}`);
    err.status = 400;
    throw err;
  }

  const payload = await payloadGreBase(invoice);
  payload.codigo_evento = codigo;
  payload.descripcion_evento = EVENTOS_SUNAT[codigo];
  payload.fecha_evento = body.fecha_evento || body.fechaEvento || formatFechaEvento();
  if (body.detalle || body.observacion) {
    payload.detalle = String(body.detalle || body.observacion).trim();
  }

  let emisorData = null;
  let emisorError = null;
  try {
    ({ data: emisorData } = await emisorClient.emitirGreEvento(payload));
  } catch (err) {
    emisorError = err.message;
    emisorData = err.data || { success: false, message: err.message };
  }

  const entry = {
    tipo: 'evento',
    codigo_evento: codigo,
    descripcion: EVENTOS_SUNAT[codigo],
    fecha_evento: payload.fecha_evento,
    detalle: payload.detalle || null,
    sunat: emisorData,
    success: emisorData?.success === true,
  };
  const sunatJson = await appendGreEventoMeta(invoice.id, entry);

  return {
    success: entry.success,
    message: entry.success
      ? `Evento ${EVENTOS_SUNAT[codigo]} registrado.`
      : (emisorError || emisorData?.message || 'No se pudo registrar el evento en SUNAT.'),
    guia: comprobanteModel.toApiInvoice({ ...invoice, sunatJson }),
    evento: entry,
  };
}

async function comunicarBaja(companyRuc, guiaId, body = {}) {
  const invoice = await findGuiaAceptada(companyRuc, guiaId);
  const motivo = String(body.motivo || body.descripcion || '').trim();
  if (!motivo) {
    const err = new Error('motivo es obligatorio para la comunicación de baja.');
    err.status = 400;
    throw err;
  }

  const payload = await payloadGreBase(invoice);
  payload.motivo = motivo;
  payload.fecha_baja = body.fecha_baja || body.fechaBaja || formatFechaEvento();

  let emisorData = null;
  let emisorError = null;
  try {
    ({ data: emisorData } = await emisorClient.emitirGreBaja(payload));
  } catch (err) {
    emisorError = err.message;
    emisorData = err.data || { success: false, message: err.message };
  }

  const entry = {
    tipo: 'baja',
    motivo,
    fecha_baja: payload.fecha_baja,
    sunat: emisorData,
    success: emisorData?.success === true,
  };
  const sunatJson = await appendGreEventoMeta(invoice.id, entry);

  let estado = invoice.estado;
  if (entry.success) {
    await comprobanteModel.marcarAnulado(invoice.id, companyRuc, motivo);
    estado = 'ANULADO';
  }

  return {
    success: entry.success,
    message: entry.success
      ? 'Comunicación de baja registrada.'
      : (emisorError || emisorData?.message || 'No se pudo comunicar la baja a SUNAT.'),
    guia: comprobanteModel.toApiInvoice({ ...invoice, estado, sunatJson }),
    baja: entry,
  };
}

module.exports = {
  EVENTOS_SUNAT,
  registrarEvento,
  comunicarBaja,
};
