const { parseStoredTimestamp } = require('../utils/fechas');
const { assertUbigeoPeru, isValidUbigeoPeru, normalizeUbigeoDigits } = require('../utils/ubigeo');

const UBIGEO_FALLBACK = '150101';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function round4(value) {
  return Math.round(Number(value) * 10000) / 10000;
}

function formatFechaEmision(value) {
  const ms = parseStoredTimestamp(value);
  const date = ms != null ? new Date(ms) : new Date();

  const pad = (n) => String(n).padStart(2, '0');
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
  ].join('-') + ` ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function formatFechaSolo(value) {
  const ms = parseStoredTimestamp(value);
  const date = ms != null ? new Date(ms) : new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function normalizeUbigeo(value, fallback = UBIGEO_FALLBACK, campo = 'dirección') {
  const digits = normalizeUbigeoDigits(value);
  if (digits.length === 6) {
    if (!isValidUbigeoPeru(digits)) {
      throw new Error(
        `Ubigeo inválido en ${campo}: "${digits}". Debe ser 6 dígitos del catálogo SUNAT (ej. 150101 para Lima).`,
      );
    }
    return digits;
  }
  if (!fallback) {
    throw new Error(`Ubigeo obligatorio en ${campo}. Indica 6 dígitos del catálogo SUNAT (ej. 150101).`);
  }
  return fallback;
}

/** SUNAT cat. 4269: código interno alfanumérico; no UUID ni ids de sistema. */
function isValidSunatCodigoProducto(value) {
  if (!value || typeof value !== 'string') return false;
  const v = value.trim();
  if (!v || UUID_RE.test(v)) return false;
  return /^[A-Za-z0-9.\-_/]{1,30}$/.test(v);
}

function resolveCodigoProducto(catalogItem, detail, lineIndex) {
  const candidates = [catalogItem?.codigo, detail?.codigo];
  for (const raw of candidates) {
    if (isValidSunatCodigoProducto(raw)) return String(raw).trim();
  }
  return `PRD${String(lineIndex + 1).padStart(4, '0')}`;
}

function buildDireccion(address) {
  return {
    ubigeo: normalizeUbigeo(address?.ubigeo),
    departamento: (address?.departamento || 'LIMA').toUpperCase(),
    provincia: (address?.provincia || 'LIMA').toUpperCase(),
    distrito: (address?.distrito || 'LIMA').toUpperCase(),
    urbanizacion: address?.urbanizacion || '-',
    direccion: address?.direccion || '-',
    cod_local: address?.codLocal || '0000',
  };
}

function buildDireccionEnvio(address, fallback = 'SIN DIRECCION', campo = 'punto de traslado') {
  return {
    ubigeo: normalizeUbigeo(address?.ubigeo, null, campo),
    departamento: (address?.departamento || '').trim().toUpperCase() || undefined,
    provincia: (address?.provincia || '').trim().toUpperCase() || undefined,
    distrito: (address?.distrito || '').trim().toUpperCase() || undefined,
    direccion: (address?.direccion || fallback).toUpperCase(),
  };
}

function buildEmisor(company) {
  if (!company?.ruc) {
    throw new Error('La empresa no tiene RUC configurado.');
  }

  return {
    ruc: company.ruc,
    razon_social: company.nombre,
    nombre_comercial: company.nombreComercial || company.nombre,
    direccion: buildDireccion(company.address),
  };
}

function buildReceptor(cliente) {
  if (!cliente) {
    throw new Error('El comprobante no tiene cliente asignado.');
  }

  return {
    tipo_doc: cliente.tipoDoc,
    num_doc: cliente.numeroDoc,
    razon_social: cliente.razonSocial,
  };
}

function buildTotales(invoice) {
  const details = invoice.details || [];
  let gravadas = 0;
  let exoneradas = 0;
  let inafectas = 0;
  let igv = 0;
  let importeTotal = 0;

  for (const detail of details) {
    const base = toNumber(detail.mtoValorVenta);
    const lineIgv = toNumber(detail.mtoIgv);
    const lineTotal = toNumber(detail.totalFactura) || round4(base + lineIgv);
    importeTotal += lineTotal;
    igv += lineIgv;
    if (detail.tipAfeIgv === '10') gravadas += base;
    else if (detail.tipAfeIgv === '20') exoneradas += base;
    else inafectas += base;
  }

  const valorVenta = round4(gravadas + exoneradas + inafectas);
  const importeTotalRedondeado = round4(importeTotal);

  return {
    mto_oper_gravadas: round4(gravadas),
    mto_oper_exoneradas: round4(exoneradas),
    mto_oper_inafectas: round4(inafectas),
    mto_oper_gratuitas: toNumber(invoice.mtoOperExportacion),
    mto_igv: round4(igv),
    total_impuestos: round4(igv),
    valor_venta: valorVenta,
    // Greenter: sub_total = importe total con IGV (no la base imponible).
    sub_total: importeTotalRedondeado,
    importe_total: importeTotalRedondeado,
  };
}

function buildDetalle(detail, catalogItem, lineIndex = 0) {
  const descripcion = detail.descripcion || detail.nombre || catalogItem?.nombre || 'ITEM';
  const codigo = resolveCodigoProducto(catalogItem, detail, lineIndex);

  return {
    codigo,
    descripcion,
    unidad: detail.unidad || catalogItem?.unidad || 'NIU',
    cantidad: toNumber(detail.cantidad, 1),
    valor_unitario: toNumber(detail.mtoValorUnitario),
    base_igv: toNumber(detail.mtoBaseIgv),
    porcentaje_igv: toNumber(detail.porcentajeIgv, 18),
    igv: toNumber(detail.mtoIgv),
    total_impuestos: toNumber(detail.mtoIgv),
    valor_venta: toNumber(detail.mtoValorVenta),
    precio_unitario: toNumber(detail.mtoPrecioUnitario),
    total: toNumber(detail.totalFactura)
      || round4(toNumber(detail.mtoValorVenta) + toNumber(detail.mtoIgv)),
    tipo_afectacion_igv: detail.tipAfeIgv || catalogItem?.afectacionIgv || '10',
  };
}

function buildDetalleGuia(detail, catalogItem, lineIndex = 0) {
  const descripcion = detail.descripcion || detail.nombre || catalogItem?.nombre || 'ITEM';
  const codigo = resolveCodigoProducto(catalogItem, detail, lineIndex);

  return {
    codigo,
    descripcion,
    unidad: detail.unidad || catalogItem?.unidad || 'NIU',
    cantidad: toNumber(detail.cantidad, 1),
  };
}

function buildLeyendas(legends) {
  if (!legends?.length) return undefined;

  return legends.map((legend) => ({
    codigo: legend.code,
    valor: legend.value,
  }));
}

function buildDocumentoAfectado(documentoAfectado) {
  if (!documentoAfectado) {
    throw new Error('La nota requiere un documento afectado.');
  }

  return {
    tipo_doc: documentoAfectado.tipoDoc,
    serie: documentoAfectado.serie,
    correlativo: String(documentoAfectado.correlativo),
  };
}

function resolveGuiaMeta(invoice) {
  if (!invoice.guiaMetaJson || typeof invoice.guiaMetaJson !== 'object') {
    return {};
  }
  return invoice.guiaMetaJson;
}

function normalizeTransportista(raw) {
  if (!raw || typeof raw !== 'object') return null;

  const numDoc = String(
    raw.num_doc || raw.numero_doc || raw.numeroDoc || raw.ruc || '',
  ).trim();
  const razonSocial = String(
    raw.razon_social || raw.razonSocial || raw.nombre || '',
  ).trim();

  if (!numDoc || !razonSocial) return null;

  const nroMtc = String(raw.nro_mtc || raw.nroMtc || '').trim() || null;

  return {
    tipo_doc: String(raw.tipo_doc || raw.tipoDoc || (numDoc.length === 11 ? '6' : '1')),
    num_doc: numDoc,
    razon_social: razonSocial,
    ...(nroMtc ? { nro_mtc: nroMtc } : {}),
  };
}

function normalizeConductor(raw) {
  if (!raw || typeof raw !== 'object') return null;

  const numDoc = String(raw.num_doc || raw.numero_doc || raw.numDoc || '').trim();
  const nombreCompleto = String(raw.nombres || raw.nombre || '').trim();
  if (!numDoc && !nombreCompleto) return null;

  const partes = nombreCompleto.split(/\s+/);
  const nombres = String(raw.nombres || partes[0] || '').trim();
  const apellidos = String(raw.apellidos || partes.slice(1).join(' ') || '').trim();
  const licencia = String(raw.licencia || '').trim() || null;

  return {
    tipo_doc: String(raw.tipo_doc || raw.tipoDoc || '1'),
    num_doc: numDoc,
    nombres,
    ...(apellidos ? { apellidos } : {}),
    ...(licencia ? { licencia } : {}),
  };
}

function normalizeVehiculo(raw) {
  if (!raw || typeof raw !== 'object') return null;

  const placa = String(raw.placa || '').trim().toUpperCase();
  if (!placa) return null;

  const vehiculo = { placa };
  const nroCirculacion = String(
    raw.nro_circulacion || raw.nroCirculacion || '',
  ).trim();
  if (nroCirculacion) vehiculo.nro_circulacion = nroCirculacion;

  const secundarios = Array.isArray(raw.secundarios)
    ? raw.secundarios
      .map((sec) => normalizeVehiculo(sec))
      .filter(Boolean)
    : [];
  if (secundarios.length) vehiculo.secundarios = secundarios;

  return vehiculo;
}

function resolveEnvio(invoice) {
  const envio = resolveGuiaMeta(invoice).envio || {};

  const partida = envio.partida
    ? buildDireccionEnvio(envio.partida, 'PUNTO DE PARTIDA', 'punto de partida')
    : buildDireccionEnvio(
      invoice.company?.address,
      invoice.company?.nombre || 'PUNTO DE PARTIDA',
      'punto de partida',
    );
  const llegada = envio.llegada
    ? buildDireccionEnvio(envio.llegada, 'PUNTO DE LLEGADA', 'punto de llegada')
    : buildDireccionEnvio(
      invoice.cliente?.address,
      invoice.cliente?.razonSocial || 'PUNTO DE LLEGADA',
      'punto de llegada',
    );

  const pesoTotal = envio.peso_total != null
    ? toNumber(envio.peso_total)
    : invoice.details.reduce((sum, d) => sum + toNumber(d.cantidad, 1), 0) || 1;

  const fechaEmision = formatFechaSolo(invoice.fechaEmision);
  let fechaTraslado = envio.fecha_traslado
    || envio.fechaTraslado
    || envio.fecha_inicio_traslado
    || envio.fechaInicioTraslado
    || fechaEmision;
  // SUNAT/GRE: la fecha de traslado no puede ser anterior a la emisión.
  if (String(fechaTraslado).slice(0, 10) < fechaEmision) {
    fechaTraslado = fechaEmision;
  }

  let fechaEntregaTransportista = envio.fecha_entrega_transportista
    || envio.fechaEntregaTransportista
    || fechaTraslado;
  if (String(fechaEntregaTransportista).slice(0, 10) < fechaEmision) {
    fechaEntregaTransportista = fechaEmision;
  }

  const payload = {
    cod_traslado: envio.cod_traslado || '01',
    mod_traslado: envio.mod_traslado || '02',
    fecha_traslado: fechaTraslado,
    fecha_entrega_transportista: fechaEntregaTransportista,
    peso_total: pesoTotal,
    und_peso_total: envio.und_peso_total || 'KGM',
    partida,
    llegada,
  };

  const transportistaRaw = envio.transportista || null;
  const nroMtcEnvio = String(envio.nro_mtc || envio.nroMtc || '').trim();
  const transportista = normalizeTransportista(
    transportistaRaw
      ? { ...transportistaRaw, nro_mtc: transportistaRaw.nro_mtc || transportistaRaw.nroMtc || nroMtcEnvio }
      : (nroMtcEnvio ? { nro_mtc: nroMtcEnvio } : null),
  );
  if (transportista) payload.transportista = transportista;

  const vehiculo = normalizeVehiculo(envio.vehiculo);
  if (vehiculo) payload.vehiculo = vehiculo;

  const conductor = normalizeConductor(envio.conductor);
  if (conductor) payload.conductor = conductor;

  const registrarVehiculos = envio.registrar_vehiculos_conductores === true
    || envio.registrarVehiculosConductores === true
    || (payload.mod_traslado === '01' && (vehiculo || conductor));

  if (registrarVehiculos && (vehiculo || conductor)) {
    payload.indicadores = ['SUNAT_Envio_IndicadorVehiculoConductoresTransp'];
  }

  // Transporte público sin MTC: en desarrollo no bloqueamos (EMISOR también rellena en beta).
  if (payload.mod_traslado === '01') {
    if (!payload.transportista) {
      payload.transportista = { tipo_doc: '6', num_doc: '00000000000', razon_social: 'TRANSPORTISTA' };
    }
    if (!payload.transportista.nro_mtc) {
      payload.transportista.nro_mtc = '12345678901';
    }
  }

  return payload;
}

function buildVentaPayload(invoice) {
  if (!invoice.details?.length) {
    throw new Error('El comprobante no tiene líneas de detalle.');
  }

  const company = invoice.company;
  if (!company) {
    throw new Error('No se encontró la empresa emisora.');
  }

  const payload = {
    serie: invoice.serie,
    correlativo: String(invoice.correlativo),
    fecha_emision: formatFechaEmision(invoice.fechaEmision),
    tipo_operacion: invoice.tipoOperacion || '0101',
    tipo_moneda: invoice.tipoMoneda || 'PEN',
    forma_pago: (invoice.formaPago || 'contado').toLowerCase(),
    emisor: buildEmisor(company),
    receptor: buildReceptor(invoice.cliente),
    totales: buildTotales(invoice),
    detalles: invoice.details.map((detail, index) => buildDetalle(detail, detail.catalogItem, index)),
  };

  const leyendas = buildLeyendas(invoice.legends);
  if (leyendas) payload.leyendas = leyendas;

  if (invoice.tipoDoc === '07' || invoice.tipoDoc === '08') {
    payload.tipo_doc = invoice.tipoDoc;
    payload.cod_motivo = invoice.motivoCodigo;
    payload.des_motivo = invoice.motivoNota;
    payload.documento_afectado = buildDocumentoAfectado(invoice.documentoAfectado);
    delete payload.forma_pago;
  }

  return payload;
}

function buildGuiaPayload(invoice) {
  if (!invoice.details?.length) {
    throw new Error('La guía no tiene líneas de detalle.');
  }

  const company = invoice.company;
  if (!company) throw new Error('No se encontró la empresa emisora.');
  if (!invoice.cliente) throw new Error('La guía requiere destinatario.');

  return {
    version: '2022',
    serie: invoice.serie,
    correlativo: String(invoice.correlativo),
    fecha_emision: formatFechaEmision(invoice.fechaEmision),
    emisor: buildEmisor(company),
    destinatario: buildReceptor(invoice.cliente),
    envio: resolveEnvio(invoice),
    detalles: invoice.details.map((detail, index) => buildDetalleGuia(detail, detail.catalogItem, index)),
  };
}

function buildResumenPayload(company, boletas, correlativoResumen = '001') {
  if (!company) throw new Error('No se encontró la empresa emisora.');
  if (!boletas?.length) throw new Error('No hay boletas para el resumen.');

  const fechaResumen = formatFechaSolo(boletas[0].fechaEmision);

  return {
    fecha_generacion: fechaResumen,
    fecha_resumen: fechaResumen,
    correlativo: correlativoResumen,
    moneda: 'PEN',
    emisor: buildEmisor(company),
    detalles: boletas.map((boleta) => ({
      tipo_doc: '03',
      serie_nro: `${boleta.serie}-${boleta.correlativo}`,
      estado: '1',
      cliente_tipo: boleta.cliente?.tipoDoc || '1',
      cliente_nro: boleta.cliente?.numeroDoc || '',
      total: toNumber(boleta.mtoImpVenta),
      mto_oper_gravadas: toNumber(boleta.mtoOperGravadas),
      mto_oper_exoneradas: toNumber(boleta.mtoOperExoneradas),
      mto_oper_inafectas: toNumber(boleta.mtoOperInafectas),
      mto_igv: toNumber(boleta.mtoIgv),
    })),
  };
}

function buildGuiaTransportistaPayload(invoice) {
  if (!invoice.details?.length) {
    throw new Error('La guía transportista no tiene líneas de detalle.');
  }

  const company = invoice.company;
  if (!company) throw new Error('No se encontró la empresa emisora.');
  if (!invoice.cliente) throw new Error('La guía requiere destinatario.');

  const meta = resolveGuiaMeta(invoice);
  const remitente = meta.remitente;
  if (!remitente?.numero_doc) {
    throw new Error('La guía transportista no tiene remitente registrado.');
  }

  const payload = {
    version: '2022',
    serie: invoice.serie,
    correlativo: String(invoice.correlativo),
    fecha_emision: formatFechaEmision(invoice.fechaEmision),
    emisor: buildEmisor(company),
    remitente: {
      tipo_doc: remitente.tipo_doc || '6',
      num_doc: remitente.numero_doc,
      razon_social: remitente.razon_social,
    },
    destinatario: buildReceptor(invoice.cliente),
    envio: resolveEnvio(invoice),
    detalles: invoice.details.map((detail, index) => buildDetalleGuia(detail, detail.catalogItem, index)),
  };

  if (meta.guia_remitente?.serie && meta.guia_remitente?.correlativo) {
    payload.documentos_relacionados = [{
      tipo_doc: meta.guia_remitente.tipo_doc || '09',
      serie: meta.guia_remitente.serie,
      correlativo: String(meta.guia_remitente.correlativo),
    }];
  }

  return payload;
}

function buildPayload(invoice) {
  if (invoice.tipoDoc === '09') {
    return buildGuiaPayload(invoice);
  }
  if (invoice.tipoDoc === '31') {
    return buildGuiaTransportistaPayload(invoice);
  }
  return buildVentaPayload(invoice);
}

module.exports = {
  buildPayload,
  buildVentaPayload,
  buildGuiaPayload,
  buildGuiaTransportistaPayload,
  buildResumenPayload,
};
