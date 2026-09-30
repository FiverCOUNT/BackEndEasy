const { parseStoredTimestamp } = require('../utils/fechas');
const { assertUbigeoPeru, isValidUbigeoPeru, normalizeUbigeoDigits } = require('../utils/ubigeo');
const { aplicarIndicadorPagadorFleteGreT } = require('../utils/grePagadorFleteSunat');
const {
  GRE_ENVIO_INDICADORES,
  aplicarIndicadorVehiculoM1L,
  truthyFlag,
  tieneIndicadorVehiculoM1L,
} = require('../utils/greEnvioIndicadoresSunat');

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

function normalizeCodLocal(value) {
  const raw = String(value ?? '').trim();
  // SUNAT: 4 dígitos del establecimiento (0000 = principal).
  if (/^\d{4}$/.test(raw)) return raw;
  return '0000';
}

/**
 * Política AddressTypeCode (listID=RUC + valor=cod_local) según RS 123-2022 / UBL GRE.
 *
 * Anexo N.° 12: código de establecimiento es obligatorio solo en motivo 04.
 * - 01/03/06: partida = establecimiento del remitente; llegada = domicilio (sin ATC).
 * - 02 compra: sin ATC (partida es del proveedor; poner RUC remitente → SUNAT 3411).
 * - 04/07/18: partida y llegada = establecimientos del remitente (distintos).
 * Nunca enviar cod_local sin RUC → SUNAT 3410 (listID vacío).
 */
function greEstablecimientoPolicy(codTraslado) {
  const cod = String(codTraslado || '01').trim();
  if (['04', '07', '18'].includes(cod)) {
    return { partida: true, llegada: true };
  }
  if (['01', '03', '06'].includes(cod)) {
    return { partida: true, llegada: false };
  }
  // 02 compra y resto (13 otros, etc.): solo ubigeo + dirección.
  return { partida: false, llegada: false };
}

function buildDireccionEnvio(address, fallback = 'SIN DIRECCION', campo = 'punto de traslado', options = {}) {
  const codLocalRaw = address?.cod_local ?? address?.codLocal;
  const rucRaw = address?.ruc ?? options.ruc ?? null;
  const out = {
    ubigeo: normalizeUbigeo(address?.ubigeo, null, campo),
    departamento: (address?.departamento || '').trim().toUpperCase() || undefined,
    provincia: (address?.provincia || '').trim().toUpperCase() || undefined,
    distrito: (address?.distrito || '').trim().toUpperCase() || undefined,
    direccion: (address?.direccion || fallback).toUpperCase(),
  };
  if (options.incluirEstablecimiento) {
    const ruc = String(rucRaw || '').trim();
    // Sin RUC no se emite AddressTypeCode (evita 3410).
    if (ruc) {
      out.cod_local = normalizeCodLocal(codLocalRaw);
      out.ruc = ruc;
    }
  }
  return out;
}

function entityAddress(entity) {
  if (!entity) return null;
  return entity.addressJson || entity.address || null;
}

function buildDireccion(address) {
  return {
    ubigeo: normalizeUbigeo(address?.ubigeo),
    departamento: (address?.departamento || 'LIMA').toUpperCase(),
    provincia: (address?.provincia || 'LIMA').toUpperCase(),
    distrito: (address?.distrito || 'LIMA').toUpperCase(),
    urbanizacion: address?.urbanizacion || '-',
    direccion: address?.direccion || '-',
    cod_local: normalizeCodLocal(address?.codLocal || address?.cod_local),
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
    direccion: buildDireccion(entityAddress(company)),
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

function buildDocumentosRelacionadosPayload(invoice) {
  const companyRuc = String(invoice.company?.ruc || invoice.companyRuc || '').trim();
  const tipoDescByCode = {
    '01': 'FACTURA',
    '03': 'BOLETA DE VENTA',
    '04': 'LIQUIDACION DE COMPRA',
    '09': 'GUIA DE REMISION REMITENTE',
    '31': 'GUIA DE REMISION TRANSPORTISTA',
  };

  const mapDocumento = (doc) => {
    if (!doc?.serie || doc.correlativo == null) return null;
    const tipo = doc.tipoDoc;
    const out = {
      tipo_doc: tipo,
      tipo_desc: tipoDescByCode[tipo] || undefined,
      serie: doc.serie,
      correlativo: String(doc.correlativo),
    };
    const emisorNumero = String(doc.emisorRuc || doc.companyRuc || '').trim();
    if (emisorNumero && emisorNumero !== companyRuc) {
      out.emisor_externo = true;
      out.emisor_tipo_doc = '6';
      out.emisor_numero_doc = emisorNumero;
      out.emisor_razon_social = doc.emisorRazonSocial || undefined;
      out.emisor = emisorNumero;
    }
    return out;
  };

  const lines = Array.isArray(invoice.lineInvoices) ? invoice.lineInvoices : [];
  if (lines.length) {
    return lines
      .map((row) => {
        const inv = row?.invoice2;
        if (!inv) return null;
        return mapDocumento({
          tipoDoc: inv.tipoDoc,
          serie: inv.serie,
          correlativo: inv.correlativo,
          companyRuc: inv.companyRuc,
          emisorRuc: inv.companyRuc,
        });
      })
      .filter(Boolean);
  }

  const meta = resolveGuiaMeta(invoice);
  if (meta.guia_remitente?.serie && meta.guia_remitente?.correlativo) {
    const mapped = mapDocumento({
      tipoDoc: meta.guia_remitente.tipo_doc || '09',
      serie: meta.guia_remitente.serie,
      correlativo: meta.guia_remitente.correlativo,
      emisorRuc: meta.remitente?.numero_doc || undefined,
      emisorRazonSocial: meta.remitente?.razon_social || undefined,
    });
    return mapped ? [mapped] : [];
  }
  return [];
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
  const nombreCompleto = String(raw.nombre || raw.nombres || '').trim();
  if (!numDoc && !nombreCompleto) return null;

  const partes = nombreCompleto.split(/\s+/).filter(Boolean);
  // Si ya vienen separados, respétalos; si no, reparte nombre completo.
  let nombres = String(raw.nombres || '').trim();
  let apellidos = String(raw.apellidos || '').trim();
  if (!apellidos && partes.length >= 2) {
    // Convención Perú frecuente: Nombres + 2 apellidos al final.
    if (partes.length >= 3) {
      apellidos = partes.slice(-2).join(' ');
      nombres = partes.slice(0, -2).join(' ') || partes[0];
    } else {
      nombres = partes[0];
      apellidos = partes.slice(1).join(' ');
    }
  } else if (!nombres) {
    nombres = partes[0] || nombreCompleto;
  }
  if (!apellidos) apellidos = '-';
  const licencia = String(raw.licencia || '').trim() || null;

  const conductor = {
    tipo_doc: String(raw.tipo_doc || raw.tipoDoc || '1'),
    num_doc: numDoc,
    nombres,
    ...(apellidos ? { apellidos } : {}),
    ...(licencia ? { licencia } : {}),
  };

  // Principal + secundarios (mismo patrón que vehículo.secundarios).
  // También acepta envio.conductores[] como lista plana (1.º = principal).
  const secundariosRaw = Array.isArray(raw.secundarios)
    ? raw.secundarios
    : [];
  const secundarios = secundariosRaw
    .map((sec) => {
      if (!sec || typeof sec !== 'object') return null;
      const { secundarios: _omit, ...rest } = sec;
      return normalizeConductor(rest);
    })
    .filter(Boolean);
  if (secundarios.length) conductor.secundarios = secundarios;

  return conductor;
}

/** Acepta conductor único o lista plana `conductores[]` → principal + secundarios. */
function resolveConductorFromEnvio(envio) {
  if (!envio || typeof envio !== 'object') return null;
  if (Array.isArray(envio.conductores) && envio.conductores.length) {
    const [principal, ...rest] = envio.conductores;
    const base = normalizeConductor(principal);
    if (!base) return null;
    const extras = rest
      .map((c) => normalizeConductor(c))
      .filter(Boolean);
    const nested = Array.isArray(base.secundarios) ? base.secundarios : [];
    const secundarios = [...nested, ...extras];
    if (secundarios.length) base.secundarios = secundarios;
    return base;
  }
  return normalizeConductor(envio.conductor);
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

/** En privado solo se declara la placa; permisos/TUCE quedan en catálogo, no en el XML. */
function vehiculoSoloPlaca(vehiculo) {
  if (!vehiculo || typeof vehiculo !== 'object') return vehiculo;
  const out = { placa: vehiculo.placa };
  if (Array.isArray(vehiculo.secundarios) && vehiculo.secundarios.length) {
    out.secundarios = vehiculo.secundarios
      .map((sec) => vehiculoSoloPlaca(sec))
      .filter((sec) => sec?.placa);
  }
  return out;
}

function resolveEnvio(invoice) {
  const meta = resolveGuiaMeta(invoice);
  const envio = meta.envio || {};
  const codTraslado = String(envio.cod_traslado || envio.codTraslado || '01');
  const esGreTransportista = String(invoice.tipoDoc || '') === '31';
  const rucEmpresa = String(invoice.company?.ruc || invoice.companyRuc || '').trim() || null;
  // GRE-R: establecimiento del remitente = emisor. GRE-T: partida es del remitente (meta), no del transportista.
  const rucRemitente = String(
    meta.remitente?.numero_doc
      || meta.remitente?.numeroDoc
      || meta.remitente?.num_doc
      || meta.remitente?.ruc
      || '',
  ).replace(/\D/g, '') || null;
  const rucEstablecimiento = esGreTransportista
    ? (rucRemitente || rucEmpresa)
    : rucEmpresa;
  const policy = greEstablecimientoPolicy(codTraslado);
  const partidaOpts = { incluirEstablecimiento: policy.partida, ruc: rucEstablecimiento };
  const llegadaOpts = {
    incluirEstablecimiento: policy.llegada,
    ruc: esGreTransportista ? rucEstablecimiento : rucEmpresa,
  };

  const partida = envio.partida
    ? buildDireccionEnvio(envio.partida, 'PUNTO DE PARTIDA', 'punto de partida', partidaOpts)
    : buildDireccionEnvio(
      entityAddress(invoice.company),
      invoice.company?.nombre || 'PUNTO DE PARTIDA',
      'punto de partida',
      partidaOpts,
    );
  const llegada = envio.llegada
    ? buildDireccionEnvio(envio.llegada, 'PUNTO DE LLEGADA', 'punto de llegada', llegadaOpts)
    : buildDireccionEnvio(
      entityAddress(invoice.cliente) || entityAddress(invoice.company),
      invoice.cliente?.razonSocial || invoice.company?.nombre || 'PUNTO DE LLEGADA',
      'punto de llegada',
      llegadaOpts,
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

  if (
    policy.llegada
    && partida.cod_local
    && llegada.cod_local
    && partida.cod_local === llegada.cod_local
    && String(partida.direccion || '').trim() === String(llegada.direccion || '').trim()
  ) {
    throw new Error(
      'En traslado entre establecimientos (motivo 04), partida y llegada deben ser distintos '
        + '(otro código de local SUNAT o dirección).',
    );
  }

  const payload = {
    cod_traslado: codTraslado,
    mod_traslado: envio.mod_traslado || '02',
    fecha_traslado: fechaTraslado,
    fecha_entrega_transportista: fechaEntregaTransportista,
    peso_total: pesoTotal,
    und_peso_total: envio.und_peso_total || 'KGM',
    partida,
    llegada,
  };

  // GRE-R + M1/L: SUNAT solo pide placa (+ indicador). Sin conductor ni transportista.
  const flagM1Explicit = envio.traslado_vehiculo_m1_l != null || envio.trasladoVehiculoM1L != null;
  const m1Activo = !esGreTransportista && (
    flagM1Explicit
      ? (truthyFlag(envio.traslado_vehiculo_m1_l) || truthyFlag(envio.trasladoVehiculoM1L))
      : tieneIndicadorVehiculoM1L(envio)
  );
  if (m1Activo) {
    payload.mod_traslado = '02';
  }

  const transportistaRaw = envio.transportista || null;
  const nroMtcEmpresa = String(invoice.company?.nroMtc || '').trim();
  const nroMtcEnvio = String(envio.nro_mtc || envio.nroMtc || '').trim() || nroMtcEmpresa;
  const emisorRuc = String(invoice.company?.ruc || invoice.companyRuc || '').trim();

  // GRE-T: el emisor ES el transportista (Greenter + RS 123). Default público + MTC.
  // GRE-R: no inventar transportista = empresa emisora (SUNAT 2560).
  let transportista = normalizeTransportista(
    transportistaRaw
      ? {
          ...transportistaRaw,
          nro_mtc: transportistaRaw.nro_mtc || transportistaRaw.nroMtc || nroMtcEnvio,
        }
      : (esGreTransportista && emisorRuc.length === 11
        ? {
            tipo_doc: '6',
            num_doc: emisorRuc,
            razon_social: String(invoice.company?.nombre || invoice.company?.razonSocial || '').trim(),
            nro_mtc: nroMtcEnvio || undefined,
          }
        : null),
  );

  if (esGreTransportista) {
    payload.mod_traslado = String(envio.mod_traslado || envio.modTraslado || '01');
  }

  const vehiculo = normalizeVehiculo(envio.vehiculo);
  let conductor = m1Activo ? null : resolveConductorFromEnvio(envio);

  const destDoc = String(invoice.cliente?.numeroDoc || invoice.cliente?.numero_doc || '').trim();
  const remitentMeta = resolveGuiaMeta(invoice).remitente || {};
  const remitenteDoc = String(remitentMeta.numero_doc || remitentMeta.numeroDoc || '').trim();
  const carrierDoc = String(transportista?.num_doc || '').trim();

  // 2560 solo GRE remitente: transportista ≠ remitente ni destinatario.
  // En GRE-T el carrier = emisor es correcto.
  if (
    !esGreTransportista
    && payload.mod_traslado === '01'
    && carrierDoc
    && (carrierDoc === emisorRuc || (destDoc && carrierDoc === destDoc))
  ) {
    if (vehiculo || conductor) {
      payload.mod_traslado = '02';
      transportista = null;
    } else {
      throw new Error(
        'El transportista no puede ser el mismo RUC del remitente o destinatario (error SUNAT 2560). '
          + 'Usa transporte privado (02) con tu vehículo/conductor, o un transportista distinto.',
      );
    }
  }

  if (
    esGreTransportista
    && carrierDoc
    && ((destDoc && carrierDoc === destDoc) || (remitenteDoc && carrierDoc === remitenteDoc))
  ) {
    throw new Error(
      'En GRE transportista el emisor (transportista) no puede ser el mismo RUC del remitente o destinatario.',
    );
  }

  // 3347: privado sin CarrierParty.
  // 3452+: permisos/TUCE/autorización solo van en público; en privado el payload lleva solo placa.
  let vehiculoPayload = vehiculo;
  if (payload.mod_traslado === '02' || m1Activo) {
    transportista = null;
    delete payload.fecha_entrega_transportista;
    if (vehiculoPayload) {
      // M1/L: una sola placa (sin secundarios / TUCE), igual que el portal SUNAT.
      vehiculoPayload = m1Activo
        ? { placa: vehiculoPayload.placa }
        : vehiculoSoloPlaca(vehiculoPayload);
    }
  }

  if (transportista) payload.transportista = transportista;
  if (vehiculoPayload) payload.vehiculo = vehiculoPayload;
  if (conductor) payload.conductor = conductor;

  // Indicador veh./conductores del transportista: solo GRE-R público y sin M1/L.
  const registrarVehiculos = !esGreTransportista
    && !m1Activo
    && payload.mod_traslado === '01'
    && (
      envio.registrar_vehiculos_conductores === true
      || envio.registrarVehiculosConductores === true
      || Boolean(vehiculo || conductor)
    );

  if (registrarVehiculos && (vehiculo || conductor)) {
    payload.indicadores = [GRE_ENVIO_INDICADORES.VEHICULO_CONDUCTORES_TRANSP];
  }

  if (Array.isArray(envio.indicadores) && envio.indicadores.length && !m1Activo) {
    const extra = envio.indicadores.map((x) => String(x).trim()).filter(Boolean);
    payload.indicadores = [...new Set([...(payload.indicadores || []), ...extra])];
  }

  // GRE-R: indicador M1/L (excepción GRE-T; XML solo con placa).
  if (!esGreTransportista) {
    const envioTmp = { indicadores: m1Activo ? [] : [...(payload.indicadores || [])] };
    aplicarIndicadorVehiculoM1L(envioTmp, m1Activo);
    if (envioTmp.indicadores.length) {
      payload.indicadores = envioTmp.indicadores;
    } else {
      delete payload.indicadores;
    }
    payload.traslado_vehiculo_m1_l = m1Activo;
  }

  if (payload.mod_traslado === '01') {
    if (!payload.transportista) {
      throw new Error(
        esGreTransportista
          ? 'GRE transportista requiere RUC/MTC del transportista emisor.'
          : 'Transporte público (01) requiere un transportista distinto al remitente/destinatario.',
      );
    }
    if (!payload.transportista.nro_mtc) {
      payload.transportista.nro_mtc = nroMtcEmpresa || '12345678901';
    }
  }

  if (m1Activo) {
    if (!payload.vehiculo?.placa) {
      throw new Error('Traslado en vehículos M1 o L requiere la placa del vehículo.');
    }
    delete payload.conductor;
    delete payload.transportista;
    return payload;
  }

  if (payload.mod_traslado === '02' || esGreTransportista) {
    if (!payload.vehiculo?.placa) {
      throw new Error(
        esGreTransportista
          ? 'GRE transportista requiere la placa del vehículo.'
          : 'Transporte privado (02) requiere la placa del vehículo.',
      );
    }
    if (!payload.conductor?.num_doc) {
      throw new Error(
        esGreTransportista
          ? 'GRE transportista requiere los datos del conductor.'
          : 'Transporte privado (02) requiere los datos del conductor.',
      );
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
    forma_pago: (invoice.formaPago || 'contado').toLowerCase().startsWith('cred') ? 'credito' : 'contado',
    emisor: buildEmisor(company),
    receptor: buildReceptor(invoice.cliente),
    totales: buildTotales(invoice),
    detalles: invoice.details.map((detail, index) => buildDetalle(detail, detail.catalogItem, index)),
  };

  const leyendas = buildLeyendas(invoice.legends);
  if (leyendas) payload.leyendas = leyendas;

  if (payload.forma_pago === 'credito') {
    const fecha = String(invoice.fecVencimiento || '').slice(0, 10);
    const monto = toNumber(invoice.mtoImpVenta);
    if (!fecha) throw new Error('Factura al crédito sin fecha de pago.');
    payload.mto_credito = monto;
    payload.cuotas = [{ monto, fecha_pago: fecha }];
  }

  const sunat = invoice.guiaMetaJson?.sunat_emision || invoice.guiaMeta?.sunat_emision;
  if (sunat?.flags?.detraccion === 'si') {
    const pct = Number(sunat.detraccion_porcentaje);
    const extra = sunat.detraccion_extra && typeof sunat.detraccion_extra === 'object'
      ? sunat.detraccion_extra
      : {};
    const montoExtra = (key) => {
      const n = Number(String(extra[key] ?? '').replace(',', '.'));
      return Number.isFinite(n) && n >= 0 ? n : 0;
    };
    const efectiva = montoExtra('valor_referencial');
    const servicio = extra.valor_referencial_servicio != null && String(extra.valor_referencial_servicio) !== ''
      ? montoExtra('valor_referencial_servicio')
      : efectiva;
    const nominal = montoExtra('valor_referencial_nominal');
    const valorRef = Math.max(servicio, efectiva, nominal);
    const baseDet = valorRef > toNumber(invoice.mtoImpVenta)
      ? valorRef
      : toNumber(invoice.mtoImpVenta);
    const montoDet = Math.round((baseDet * pct) / 100 * 100) / 100;
    payload.tipo_operacion = String(sunat.tipo_operacion || '1001');
    payload.detraccion = {
      porcentaje: pct,
      monto: montoDet,
      cuenta: String(sunat.detraccion_cuenta || ''),
      codigo: String(sunat.detraccion_codigo || ''),
      medio_pago: String(sunat.detraccion_medio_pago || '001'),
    };
    if (Number.isFinite(valorRef) && valorRef > 0) {
      payload.detraccion.valor_referencial = valorRef;
    }
    if (payload.tipo_operacion === '1004') {
      payload.detraccion.transporte_carga = {
        origen_ubigeo: String(extra.origen_ubigeo || '').trim(),
        origen_direccion: String(extra.origen_direccion || '').replace(/\]\]>/g, '').trim(),
        destino_ubigeo: String(extra.destino_ubigeo || '').trim(),
        destino_direccion: String(extra.destino_direccion || '').replace(/\]\]>/g, '').trim(),
        detalle_viaje: String(extra.detalle_viaje || '').replace(/\]\]>/g, '').trim(),
        valor_referencial: efectiva > 0 ? efectiva : servicio,
        valor_servicio: servicio,
        valor_nominal: nominal > 0 ? nominal : servicio,
        registro_mtc: String(extra.registro_mtc || '').trim(),
        configuracion_vehicular: String(extra.configuracion_vehicular || '').trim(),
        carga_util_tm: montoExtra('carga_util_tm'),
        retorno_vacio: String(extra.retorno_vacio || 'no') === 'si',
      };
    }
    if (payload.tipo_operacion === '1002') {
      payload.detraccion.hidrobiologico = {
        matricula: String(extra.matricula || '').trim(),
        nombre: String(extra.nombre_embarcacion || '').trim(),
        especie: String(extra.especie || '').trim(),
        lugar: String(extra.lugar_descarga || '').trim(),
        cantidad: montoExtra('cantidad_especie'),
        fecha: String(extra.fecha_descarga || '').slice(0, 10),
      };
    }
  }

  if (invoice.tipoDoc === '07' || invoice.tipoDoc === '08') {
    payload.tipo_doc = invoice.tipoDoc;
    payload.cod_motivo = invoice.motivoCodigo;
    payload.des_motivo = invoice.motivoNota;
    payload.documento_afectado = buildDocumentoAfectado(invoice.documentoAfectado);
    if (invoice.tipoDoc === '07' && String(invoice.motivoCodigo || '').trim() === '02') {
      const meta = resolveGuiaMeta(invoice);
      const nuevaFactura = String(meta.nueva_factura || meta.nuevaFactura || '').trim();
      if (nuevaFactura) payload.compra = nuevaFactura;
    }
    delete payload.forma_pago;
  }

  return payload;
}

function isGreSandboxEntorno(company) {
  const value = String(company?.entorno || 'beta').toLowerCase();
  return value === 'beta' || value === 'homologacion' || value === 'test' || value === 'demo';
}

function buildGuiaPayload(invoice) {
  if (!invoice.details?.length) {
    throw new Error('La guía no tiene líneas de detalle.');
  }

  const company = invoice.company;
  if (!company) throw new Error('No se encontró la empresa emisora.');
  if (!invoice.cliente) throw new Error('La guía requiere destinatario.');

  const payload = {
    version: '2022',
    serie: invoice.serie,
    correlativo: String(invoice.correlativo),
    fecha_emision: formatFechaEmision(invoice.fechaEmision),
    emisor: buildEmisor(company),
    destinatario: buildReceptor(invoice.cliente),
    envio: resolveEnvio(invoice),
    detalles: invoice.details.map((detail, index) => buildDetalleGuia(detail, detail.catalogItem, index)),
  };

  const docs = buildDocumentosRelacionadosPayload(invoice);
  // gre-test no valida facturas/compras externas → error 3380.
  // En beta se guardan en BD (app) pero no se envían en el XML.
  // En producción (api-cpe SUNAT) sí se envían.
  if (docs.length && !isGreSandboxEntorno(company)) {
    payload.documentos_relacionados = docs;
  }

  return payload;
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
    tipo_doc: '31',
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

  const pagador = meta.pagador_flete || meta.pagadorFlete || meta.envio?.pagador_flete || null;
  if (pagador && typeof pagador === 'object') {
    const indicador = String(pagador.indicador || pagador.pagador || 'REMITENTE').trim().toUpperCase();
    payload.pagador_flete = {
      indicador,
      tipo_doc: pagador.tipo_doc || pagador.tipoDoc || '6',
      num_doc: pagador.num_doc || pagador.numero_doc || pagador.numeroDoc || pagador.ruc || '',
      razon_social: pagador.razon_social || pagador.razonSocial || pagador.nombre || '',
    };
    payload.envio = payload.envio || {};
    aplicarIndicadorPagadorFleteGreT(payload.envio, indicador);
  }

  const docs = buildDocumentosRelacionadosPayload(invoice);
  if (docs.length && !isGreSandboxEntorno(company)) {
    payload.documentos_relacionados = docs;
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
