const { randomUUID } = require('crypto');
const prisma = require('../config/prisma');
const { toApiTimestamp, calendarDayStartMsPe, calendarDayEndMsPe, parseStoredTimestamp, normalizeFechaEmision } = require('../utils/fechas');
const catalogItemModel = require('./catalogItemModel');
const movimientoModel = require('./movimientoModel');

function toNumber(value) {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Correlativo canónico (sin ceros a la izquierda) para evitar duplicados SIRE vs scraper. */
function normalizeCorrelativoCompra(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.replace(/^0+/, '') || '0';
}

function claveNaturalCompraRow(row) {
  return [
    String(row.companyRuc || '').trim(),
    String(row.proveedorNumeroDoc || '').replace(/\D/g, ''),
    String(row.tipoDoc || '').padStart(2, '0'),
    String(row.serie || '').trim().toUpperCase(),
    normalizeCorrelativoCompra(row.correlativo),
  ].join('|');
}

function puntajeRiquezaCompra(row) {
  let score = 0;
  if (row.xmlUrl) score += 20;
  const lineas = Array.isArray(row.lineasJson) ? row.lineasJson.length : 0;
  score += Math.min(lineas, 10);
  const fuente = String(row.fuente || '').toLowerCase();
  if (fuente === 'facturas_scraper' || fuente === 'gre_scraper') score += 8;
  if (fuente === 'sire_sspp') score += 6;
  if (fuente === 'sire_rce') score += 2;
  return score;
}

function dedupeFilasCompras(rows) {
  const best = new Map();
  for (const row of rows) {
    const k = claveNaturalCompraRow(row);
    const prev = best.get(k);
    if (!prev || puntajeRiquezaCompra(row) > puntajeRiquezaCompra(prev)) {
      best.set(k, row);
    }
  }
  return [...best.values()];
}

function normalizeLineas(lineas) {
  if (!Array.isArray(lineas)) return [];
  return lineas
    .map((l) => ({
      codigo: l.codigo != null ? String(l.codigo).trim() || null : null,
      descripcion: String(l.descripcion || l.nombre || '').trim(),
      cantidad: Number(l.cantidad) || 0,
      unidad: String(l.unidad || 'NIU').trim() || 'NIU',
      precio_unitario: Number(l.precio_unitario ?? l.mto_precio_unitario) || 0,
      catalog_item_id: l.catalog_item_id || l.catalogItemId || null,
      estado: String(l.estado || 'EN_CAMINO').trim().toUpperCase() || 'EN_CAMINO',
    }))
    .filter((l) => l.descripcion && l.cantidad > 0);
}

function sumLineasTotales(lineas) {
  if (!Array.isArray(lineas) || !lineas.length) return null;
  const sum = lineas.reduce(
    (acc, l) => acc + (Number(l.cantidad) || 0) * (Number(l.precio_unitario ?? l.mto_precio_unitario) || 0),
    0,
  );
  return sum > 0 ? Math.round(sum * 100) / 100 : null;
}

function calcTotales(lineas, body = {}) {
  let sub = toNumber(body.sub_total ?? body.subTotal);
  let igv = toNumber(body.mto_igv ?? body.mtoIgv);
  let total = toNumber(body.mto_imp_venta ?? body.mtoImpVenta ?? body.total);
  const desdeLineas = sumLineasTotales(lineas);
  if ((total == null || total === 0) && desdeLineas != null) {
    total = desdeLineas;
  }
  if (sub == null && total != null) {
    sub = Math.round((total / 1.18) * 100) / 100;
  }
  if (igv == null && total != null && sub != null) {
    igv = Math.round((total - sub) * 100) / 100;
  }
  return { subTotal: sub, mtoIgv: igv, mtoImpVenta: total };
}

/** GRE recibida: aplana guia_meta → envio, remitente, cliente destinatario (misma forma que emitidos). */
function buildGuiaFieldsFromCompraMeta(row) {
  const tipo = String(row.tipoDoc || '').padStart(2, '0');
  if (!['09', '31'].includes(tipo)) return {};

  const meta = row.guiaMetaJson && typeof row.guiaMetaJson === 'object'
    ? row.guiaMetaJson
    : {};
  const envio = meta.envio && typeof meta.envio === 'object' ? meta.envio : undefined;

  let documentos = Array.isArray(meta.documentos_relacionados)
    ? meta.documentos_relacionados.filter(Boolean)
    : [];
  if (!documentos.length && meta.guia_remitente?.serie && meta.guia_remitente?.correlativo) {
    documentos = [{
      id: meta.guia_remitente.id || undefined,
      tipo_doc: meta.guia_remitente.tipo_doc || '09',
      serie: meta.guia_remitente.serie,
      correlativo: meta.guia_remitente.correlativo,
      emisor_tipo_doc: meta.remitente?.tipo_doc || '6',
      emisor_numero_doc: meta.remitente?.numero_doc || undefined,
      emisor_razon_social: meta.remitente?.razon_social || undefined,
    }];
  }

  const guiaRemitente = documentos.find((d) => String(d.tipo_doc || '').padStart(2, '0') === '09')
    || (meta.guia_remitente?.serie ? {
      tipo_doc: meta.guia_remitente.tipo_doc || '09',
      serie: meta.guia_remitente.serie,
      correlativo: meta.guia_remitente.correlativo,
      id: meta.guia_remitente.id || undefined,
    } : undefined);

  const dest = meta.destinatario && typeof meta.destinatario === 'object'
    ? meta.destinatario
    : null;
  const cliente = dest?.numero_doc
    ? {
        id: `gre-dest-${dest.numero_doc}`,
        company_ruc: row.companyRuc,
        tipo_doc: String(dest.tipo_doc || '6'),
        numero_doc: String(dest.numero_doc),
        razon_social: String(dest.razon_social || dest.numero_doc),
      }
    : undefined;

  return {
    guia_meta: meta,
    envio,
    facturas: documentos.length ? documentos : undefined,
    documentos_relacionados: documentos.length ? documentos : undefined,
    remitente: meta.remitente || undefined,
    guia_remitente: guiaRemitente,
    pagador_flete: meta.pagador_flete || undefined,
    cliente,
  };
}

/** Forma Invoice-compatible para la app (listado compras + GRE). */
function toApiInvoiceShape(row, { movimientoId = null } = {}) {
  if (!row) return null;
  const lineas = Array.isArray(row.lineasJson) ? row.lineasJson : [];
  const estados = lineas.map((l) => String(l.estado || '').toUpperCase());
  const inventarioEstado = estados.includes('EN_CAMINO')
    ? 'EN_CAMINO'
    : (estados.includes('RECIBIDO') ? 'RECIBIDO' : null);

  const origen = String(row.origen || 'OCR').toUpperCase();
  const esSunat = ['SIRE_RCE', 'SIRE_SSPP', 'SSPP', 'XML_MANUAL', 'SIRE', 'GRE_SCRAPER', 'FACTURAS_SCRAPER'].includes(origen)
    || ['sire_rce', 'sire_sspp', 'sspp', 'xml_manual', 'gre_scraper', 'facturas_scraper'].includes(String(row.fuente || '').toLowerCase());

  const totales = calcTotales(lineas, {
    sub_total: row.subTotal,
    mto_igv: row.mtoIgv,
    mto_imp_venta: row.mtoImpVenta,
  });

  const guiaFields = buildGuiaFieldsFromCompraMeta(row);
  const tipoGre = String(row.tipoDoc || '').padStart(2, '0');
  const destGre = guiaFields.cliente;
  // GRE recibida: `client` UBL = destinatario de la guía, no tu RUC (receptor en tabla compras).
  const clientBlock = (['09', '31'].includes(tipoGre) && destGre?.numero_doc)
    ? {
        ruc: destGre.numero_doc,
        tipo_doc: destGre.tipo_doc || '6',
        nombre: destGre.razon_social || destGre.numero_doc,
        numero_doc: destGre.numero_doc,
      }
    : {
        ruc: row.companyRuc,
        tipo_doc: '6',
        nombre: row.companyRuc,
        numero_doc: row.companyRuc,
      };

  return {
    id: row.id,
    company_ruc: row.companyRuc,
    sentido: esSunat ? 'RECIBIDO' : 'COMPRA_REGISTRADA',
    tipo_doc: row.tipoDoc,
    serie: row.serie,
    correlativo: row.correlativo,
    fecha_emision: toApiTimestamp(row.fechaEmision),
    tipo_moneda: row.tipoMoneda,
    observacion: row.observacion || undefined,
    sub_total: totales.subTotal,
    mto_igv: totales.mtoIgv,
    mto_imp_venta: totales.mtoImpVenta,
    estado: row.estado || 'ACEPTADO',
    inventario_estado: inventarioEstado,
    movimiento_en_camino_id: movimientoId || undefined,
    origen: row.origen,
    fuente: row.fuente || undefined,
    imagen_url: row.imagenUrl || undefined,
    xml_url: row.xmlUrl || undefined,
    pdf_url: row.pdfUrl || undefined,
    hash: row.hashCpe || undefined,
    ...guiaFields,
    company: {
      ruc: row.proveedorNumeroDoc,
      tipo_doc: row.proveedorTipoDoc,
      nombre: row.proveedorRazonSocial,
      numero_doc: row.proveedorNumeroDoc,
    },
    client: clientBlock,
    details: lineas.map((l, idx) => ({
      id: l.id || `${row.id}-${idx}`,
      catalog_item_id: l.catalog_item_id || undefined,
      codigo: l.codigo || undefined,
      codigo_sunat: l.codigo_sunat || undefined,
      descripcion: l.descripcion,
      nombre: l.nombre || l.descripcion,
      cantidad: l.cantidad,
      unidad: l.unidad,
      mto_precio_unitario: l.precio_unitario,
      tip_afe_igv: l.tip_afe_igv || '10',
      estado_inventario: l.estado || 'EN_CAMINO',
    })),
  };
}

async function resolveOrCreateCatalogItem(companyRuc, linea) {
  const existingId = String(linea.catalog_item_id || '').trim();
  if (existingId) {
    const byId = await prisma.catalogItem.findFirst({
      where: { id: existingId, companyRuc },
    });
    if (byId) return byId;
  }

  const codigo = String(linea.codigo || '').trim() || null;
  if (codigo) {
    const byCode = await catalogItemModel.findByCodigo(companyRuc, codigo);
    if (byCode) return byCode;
  }

  return catalogItemModel.create({
    company_ruc: companyRuc,
    companyRuc,
    kind: 'PRODUCT',
    codigo,
    nombre: linea.descripcion.slice(0, 255),
    descripcion: linea.descripcion.slice(0, 500),
    unidad: linea.unidad || 'NIU',
    precio_unitario: linea.precio_unitario,
    precioUnitario: linea.precio_unitario,
    afectacion_igv: '10',
    afectacionIgv: '10',
    activo: true,
    maneja_stock: true,
    manejaStock: true,
    maneja_serie: false,
    manejaSerie: false,
  });
}

async function resolveAlmacenId(companyRuc, body) {
  const explicit = String(body.almacen_id || body.almacenId || '').trim();
  if (explicit) {
    const row = await prisma.almacen.findFirst({
      where: { id: explicit, companyRuc, activo: true },
    });
    if (row) return row.id;
  }
  const first = await prisma.almacen.findFirst({
    where: { companyRuc, activo: true },
    orderBy: { nombre: 'asc' },
  });
  return first?.id || null;
}

async function listByCompany(companyRuc, { desde = null, hasta = null, rolGre = null } = {}) {
  const ruc = String(companyRuc || '').trim();
  if (!ruc) return [];

  const desdeIso = desde ? String(desde).slice(0, 10) : null;
  const hastaIso = hasta ? String(hasta).slice(0, 10) : null;
  const fechaWhere = {};
  if (desdeIso) fechaWhere.gte = desdeIso;
  // Prefijo ISO / timestamp: "2026-08-31…" sigue ≤ "2026-08-31\uffff".
  if (hastaIso) fechaWhere.lte = `${hastaIso}\uffff`;

  const rows = await prisma.compra.findMany({
    where: {
      companyRuc: ruc,
      ...(Object.keys(fechaWhere).length ? { fechaEmision: fechaWhere } : {}),
    },
    orderBy: [{ fechaEmision: 'desc' }, { creadoEn: 'desc' }],
    // Con rango de fechas el índice (company_ruc, fecha_emision) acota; sin rango, tope amplio.
    take: Object.keys(fechaWhere).length ? 2000 : 1000,
  });
  let filtered = dedupeFilasCompras(rows.filter((row) => {
    const emisor = String(row.proveedorNumeroDoc || '').replace(/\D/g, '');
    const receptor = String(ruc || '').replace(/\D/g, '');
    // Solo CPE que otros emitieron hacia ti (no mezclar con tus emitidos).
    return !emisor || emisor !== receptor;
  }));
  if (String(rolGre || '').toLowerCase() === 'transportista') {
    filtered = filtered.filter((row) => compraEsGreParaTransportista(row, ruc));
  }
  if (desde || hasta) {
    const desdeMs = desde ? calendarDayStartMsPe(desde) : null;
    const hastaMs = hasta ? calendarDayEndMsPe(hasta) : null;
    filtered = filtered.filter((row) => {
      const ms = parseStoredTimestamp(row.fechaEmision);
      // Solo fecha de emisión (como la app). Sin fecha → fuera del filtro de periodo.
      if (ms == null) return false;
      if (desdeMs != null && ms < desdeMs) return false;
      if (hastaMs != null && ms > hastaMs) return false;
      return true;
    });
  }

  const ids = filtered.map((r) => r.id);
  const movimientos = ids.length
    ? await prisma.movimiento.findMany({
        where: {
          companyRuc: ruc,
          OR: [
            { referenciaId: { in: ids }, referenciaTipo: 'COMPRA_EN_CAMINO' },
            { referenciaId: { in: ids }, tipo: 'ENTRADA' },
            { comprobanteId: { in: ids }, tipo: 'ENTRADA' },
          ],
        },
        select: {
          id: true,
          tipo: true,
          referenciaId: true,
          referenciaTipo: true,
          comprobanteId: true,
        },
      })
    : [];

  const enCaminoPorCompra = new Map();
  const entradaPorCompra = new Map();
  for (const mov of movimientos) {
    const key = mov.referenciaId || mov.comprobanteId;
    if (!key) continue;
    if (mov.referenciaTipo === 'COMPRA_EN_CAMINO') {
      enCaminoPorCompra.set(key, mov.id);
    }
    if (mov.tipo === 'ENTRADA' && mov.referenciaTipo !== 'COMPRA_EN_CAMINO') {
      entradaPorCompra.set(key, mov.id);
    }
  }

  return filtered.map((row) => {
    const entradaId = entradaPorCompra.get(row.id) || null;
    const enCaminoId = enCaminoPorCompra.get(row.id) || null;
    const shape = toApiInvoiceShape(row, { movimientoId: enCaminoId });
    if (entradaId) {
      shape.movimiento_entrada_id = entradaId;
      shape.inventario_estado = 'RECIBIDO';
    }
    return shape;
  });
}

async function create(companyRuc, body) {
  const ruc = String(companyRuc || '').trim();
  const proveedor = body.proveedor || {};
  const serie = String(body.serie || '').trim().toUpperCase();
  const correlativo = normalizeCorrelativoCompra(body.correlativo);
  const tipoDoc = String(body.tipo_doc || body.tipoDoc || '01').trim() || '01';
  const proveedorNumeroDoc = String(
    proveedor.numero_doc || proveedor.numeroDoc || proveedor.ruc || '',
  ).replace(/\D/g, '');
  const proveedorRazonSocial = String(
    proveedor.razon_social || proveedor.razonSocial || proveedor.nombre || '',
  ).trim();

  if (!serie || !correlativo) {
    const err = new Error('serie y correlativo son obligatorios.');
    err.status = 400;
    throw err;
  }
  if (proveedorNumeroDoc.length !== 11) {
    const err = new Error('RUC del proveedor (11 dígitos) es obligatorio.');
    err.status = 400;
    throw err;
  }
  if (!proveedorRazonSocial) {
    const err = new Error('Razón social del proveedor es obligatoria.');
    err.status = 400;
    throw err;
  }

  let lineas = normalizeLineas(body.lineas || body.details);
  if (!lineas.length) {
    const err = new Error('La compra debe tener al menos una línea.');
    err.status = 400;
    throw err;
  }

  const totales = calcTotales(lineas, body);
  const id = randomUUID();

  // Compra OCR/registrada: solo datos del proveedor. Catálogo e ingreso van aparte.
  lineas = lineas.map((linea) => ({
    ...linea,
    id: linea.id || randomUUID(),
    estado: String(linea.estado || 'EN_CAMINO').toUpperCase(),
  }));

  let movimientoId = null;
  try {
    const row = await prisma.compra.create({
      data: {
        id,
        companyRuc: ruc,
        tipoDoc,
        serie,
        correlativo,
        fechaEmision: normalizeFechaEmision(body.fecha_emision || body.fechaEmision) || null,
        tipoMoneda: String(body.tipo_moneda || body.tipoMoneda || 'PEN').toUpperCase(),
        proveedorTipoDoc: String(proveedor.tipo_doc || proveedor.tipoDoc || '6'),
        proveedorNumeroDoc,
        proveedorRazonSocial,
        subTotal: totales.subTotal,
        mtoIgv: totales.mtoIgv,
        mtoImpVenta: totales.mtoImpVenta,
        lineasJson: lineas,
        origen: String(body.origen || 'OCR').toUpperCase(),
        imagenUrl: body.imagen_url || body.imagenUrl || null,
        observacion: body.observacion || body.notas || null,
      },
    });

    return toApiInvoiceShape(row, { movimientoId });
  } catch (err) {
    if (err.code === 'P2002') {
      const dup = new Error('Ya existe una compra con ese proveedor, serie y número.');
      dup.status = 409;
      throw dup;
    }
    throw err;
  }
}

async function findById(companyRuc, id) {
  const row = await prisma.compra.findFirst({
    where: { id, companyRuc: String(companyRuc || '').trim() },
  });
  return toApiInvoiceShape(row);
}

/**
 * Facturas/boletas recibidas (compras) para vincular en GRE remitente.
 * Excluye GRE 09/31; pagina en memoria sobre los últimos registros.
 */
async function listCpeParaGrePaginated(companyRuc, { skip = 0, take = 10, q = '' } = {}) {
  const ruc = String(companyRuc || '').trim();
  const offset = Math.max(0, Number(skip) || 0);
  const limit = Math.min(Math.max(Number(take) || 10, 1), 50);
  if (!ruc) {
    return { items: [], total: 0, offset, limit, has_more: false, next_offset: offset };
  }

  const rows = await prisma.compra.findMany({
    where: {
      companyRuc: ruc,
      tipoDoc: { in: ['01', '03'] },
    },
    orderBy: [{ fechaEmision: 'desc' }, { creadoEn: 'desc' }],
    take: 400,
  });

  const receptor = ruc.replace(/\D/g, '');
  let filtered = dedupeFilasCompras(rows).filter((row) => {
    const emisor = String(row.proveedorNumeroDoc || '').replace(/\D/g, '');
    return !emisor || emisor !== receptor;
  });

  const query = String(q || '').trim().toLowerCase();
  if (query) {
    const qDigits = query.replace(/\D/g, '');
    filtered = filtered.filter((row) => {
      const ref = `${row.serie || ''}-${row.correlativo || ''}`.toLowerCase();
      const prov = String(row.proveedorRazonSocial || '').toLowerCase();
      const doc = String(row.proveedorNumeroDoc || '').replace(/\D/g, '');
      return ref.includes(query)
        || prov.includes(query)
        || (qDigits && doc.includes(qDigits));
    });
  }

  const total = filtered.length;
  const slice = filtered.slice(offset, offset + limit);
  return {
    items: slice.map((row) => toApiInvoiceShape(row)),
    total,
    offset,
    limit,
    has_more: offset + slice.length < total,
    next_offset: offset + slice.length,
  };
}

async function findByClaveNatural(companyRuc, {
  tipoDoc,
  serie,
  correlativo,
  proveedorNumeroDoc,
} = {}) {
  const row = await findRowByClaveNatural(companyRuc, {
    tipoDoc,
    serie,
    correlativo,
    proveedorNumeroDoc,
  });
  return toApiInvoiceShape(row);
}

function correlativosCandidatos(raw) {
  const original = String(raw || '').trim();
  const digits = original.replace(/\D/g, '');
  if (!digits) return original ? [original] : [];
  const stripped = digits.replace(/^0+/, '') || '0';
  const padded8 = stripped.padStart(8, '0');
  return [...new Set([original, digits, stripped, padded8])];
}

async function findRowByClaveNatural(companyRuc, {
  tipoDoc,
  serie,
  correlativo,
  proveedorNumeroDoc,
} = {}) {
  const ruc = String(companyRuc || '').trim();
  const emisor = String(proveedorNumeroDoc || '').replace(/\D/g, '');
  const tipo = String(tipoDoc || '').trim();
  const ser = String(serie || '').trim().toUpperCase();
  const cands = correlativosCandidatos(correlativo);
  if (!ruc || !emisor || !tipo || !ser || !cands.length) return null;
  return prisma.compra.findFirst({
    where: {
      companyRuc: ruc,
      proveedorNumeroDoc: emisor,
      tipoDoc: tipo,
      serie: ser,
      correlativo: cands.length === 1 ? cands[0] : { in: cands },
    },
  });
}

function origenFromFuente(fuente) {
  const f = String(fuente || '').toLowerCase();
  if (f === 'sire_sspp') return 'SIRE_SSPP';
  if (f === 'sire_rce') return 'SIRE_RCE';
  if (f === 'xml_manual') return 'XML_MANUAL';
  if (f === 'sspp') return 'SSPP';
  if (f === 'plataforma_gre') return 'PLATAFORMA';
  if (f === 'gre_scraper') return 'GRE_SCRAPER';
  if (f === 'facturas_scraper') return 'FACTURAS_SCRAPER';
  return 'SIRE';
}

function direccionGreCompleta(addr) {
  if (!addr || typeof addr !== 'object') return false;
  const ubi = String(addr.ubigeo || '').replace(/\D/g, '');
  const dir = String(addr.direccion || addr.linea || '').trim();
  return ubi.length === 6 && dir.length > 0;
}

/** Rol real frente a la GRE según las partes del XML, no según quién importa. */
function rolRecibidoDesdePartes(meta, receptorRuc, tipoDoc) {
  const yo = String(receptorRuc || '').replace(/\D/g, '');
  if (yo.length !== 11) return null;
  const dig = (v) => String(v || '').replace(/\D/g, '');
  const dest = dig(meta?.destinatario?.numero_doc);
  const transp = dig(
    meta?.envio?.transportista?.numero_doc || meta?.envio?.transportista?.num_doc,
  );
  const remitente = dig(meta?.remitente?.numero_doc);
  if (dest === yo) return 'DESTINATARIO';
  if (transp === yo) return 'TRANSPORTISTA';
  if (String(tipoDoc || '').padStart(2, '0') === '31' && remitente === yo) return 'REMITENTE';
  return null;
}

/**
 * Enriquece guia_meta sin degradar datos del XML oficial.
 * El meta marcado con `fuente_xml` gana sobre cualquier otro (stub GRE, propuesta SIRE):
 * nunca se pisa el destinatario real con el RUC del transportista o del que importa.
 */
function mergeGuiaMetaEnvio(existingMeta, newMeta, { receptorRuc = null, tipoDoc = null } = {}) {
  const prev = existingMeta && typeof existingMeta === 'object'
    ? JSON.parse(JSON.stringify(existingMeta))
    : {};
  const next = newMeta && typeof newMeta === 'object'
    ? JSON.parse(JSON.stringify(newMeta))
    : null;
  if (!next) return prev;

  const prevEnvio = prev.envio && typeof prev.envio === 'object' ? prev.envio : {};
  const nextEnvio = next.envio && typeof next.envio === 'object' ? next.envio : null;
  const merged = { ...prev, ...next };
  if (nextEnvio) {
    const envio = { ...prevEnvio, ...nextEnvio };
    if (direccionGreCompleta(nextEnvio.partida)) envio.partida = nextEnvio.partida;
    if (direccionGreCompleta(nextEnvio.llegada)) envio.llegada = nextEnvio.llegada;
    merged.envio = envio;
  }

  // El XML ya guardado es la fuente de verdad si el meta nuevo no viene de un XML.
  const xmlPrevioManda = Boolean(prev.fuente_xml) && !next.fuente_xml;
  if (xmlPrevioManda) {
    if (prev.remitente) merged.remitente = prev.remitente;
    if (prev.destinatario) merged.destinatario = prev.destinatario;
    if (prev.documentos_relacionados) merged.documentos_relacionados = prev.documentos_relacionados;
    const envioXml = { ...(merged.envio || {}) };
    for (const clave of ['transportista', 'partida', 'llegada', 'peso_total', 'und_peso_total', 'cod_traslado', 'mod_traslado', 'fecha_traslado', 'nro_mtc', 'vehiculo', 'conductor']) {
      if (prevEnvio[clave] != null && prevEnvio[clave] !== '') envioXml[clave] = prevEnvio[clave];
    }
    if (Object.keys(envioXml).length) merged.envio = envioXml;
    merged.fuente_xml = prev.fuente_xml;
  }

  const dig = (v) => String(v || '').replace(/\D/g, '');
  const transp = dig(
    merged.envio?.transportista?.numero_doc
      || merged.envio?.transportista?.num_doc
      || nextEnvio?.transportista?.numero_doc
      || prevEnvio?.transportista?.num_doc,
  );
  const nextDest = dig(next.destinatario?.numero_doc);
  const prevDest = dig(prev.destinatario?.numero_doc);
  const rawDest = dig(merged.scraper_raw?.rucReceptor || prev.scraper_raw?.rucReceptor);

  // Preferir destinatario del XML/nuevo si es distinto del transportista.
  if (!xmlPrevioManda && nextDest.length === 11 && nextDest !== transp) {
    merged.destinatario = next.destinatario;
  } else if (prevDest.length === 11 && prevDest !== transp) {
    merged.destinatario = prev.destinatario;
  } else if (nextDest.length === 11 && nextDest !== transp) {
    merged.destinatario = next.destinatario;
  } else if (rawDest.length === 11 && rawDest !== transp) {
    merged.destinatario = {
      tipo_doc: '6',
      numero_doc: rawDest,
      razon_social: String(
        merged.scraper_raw?.desReceptor
          || prev.scraper_raw?.desReceptor
          || rawDest,
      ).trim() || rawDest,
    };
  }

  // Rol según las partes finales; nunca «DESTINATARIO» por ser quien importa.
  const rolReal = rolRecibidoDesdePartes(
    merged,
    receptorRuc,
    tipoDoc || merged.tipo_doc || null,
  );
  if (rolReal) merged.rol_recibido = rolReal;

  return merged;
}

function esNombreSoloRuc(nombre, ruc) {
  const v = String(nombre || '').trim();
  if (!v) return true;
  const digits = v.replace(/\D/g, '');
  const r = String(ruc || '').replace(/\D/g, '');
  return digits === r || /^\d{11}$/.test(v);
}

/** Extrae razón social de líneas resumen SIRE (Compra · X, Servicio · X, GRE · X). */
function nombreProveedorDesdeLineas(lineas, emisorRuc) {
  for (const l of lineas || []) {
    for (const raw of [l?.nombre, l?.descripcion]) {
      const s = String(raw || '').trim();
      if (!s) continue;
      const m = s.match(/^(?:Compra|Servicio|GRE(?:\s+remitente|\s+transportista)?)\s*·\s*(.+?)(?:\s*·|$)/i);
      if (m) {
        const cand = m[1].trim();
        if (cand && !esNombreSoloRuc(cand, emisorRuc)) return cand.slice(0, 255);
      }
      if (!/^(?:Compra|Servicio|GRE)\s*·/i.test(s) && !esNombreSoloRuc(s, emisorRuc)) {
        return s.slice(0, 255);
      }
    }
  }
  return null;
}

function resolverProveedorRazonSocial(emisorRuc, candidato, { lineas = [], previo = null } = {}) {
  const ruc = String(emisorRuc || '').replace(/\D/g, '');
  const opciones = [
    String(candidato || '').trim(),
    String(previo || '').trim(),
    nombreProveedorDesdeLineas(lineas, ruc),
  ].filter(Boolean);
  for (const op of opciones) {
    if (!esNombreSoloRuc(op, ruc)) return op.slice(0, 255);
  }
  return (opciones[0] || ruc).slice(0, 255);
}

function lineasFromParsed(parsed) {
  const lineasParsed = Array.isArray(parsed.lineas) ? [...parsed.lineas] : [];
  if (!lineasParsed.length && Number(parsed.mto_imp_venta) > 0) {
    const emisor = parsed.proveedor?.razon_social || parsed.proveedor?.numero_doc || 'Proveedor';
    const docRef = `${parsed.serie}-${parsed.correlativo}`;
    lineasParsed.push({
      nombre: `Compra · ${emisor}`.slice(0, 255),
      descripcion: `Compra · ${emisor} · ${docRef}`.slice(0, 500),
      cantidad: 1,
      unidad: 'NIU',
      precio_unitario: Number(parsed.mto_imp_venta),
      codigo: `CMP-${parsed.proveedor?.numero_doc || ''}-${parsed.serie}-${parsed.correlativo}`.slice(0, 64),
    });
  }
  return lineasParsed.map((l, idx) => ({
    id: l.id || randomUUID(),
    codigo: l.codigo != null ? String(l.codigo).trim() || null : null,
    codigo_sunat: l.codigo_sunat || l.codigoSunat || null,
    nombre: String(l.nombre || l.descripcion || 'Ítem').trim().slice(0, 255),
    descripcion: String(l.descripcion || l.nombre || 'Ítem').trim().slice(0, 500),
    cantidad: Number(l.cantidad) || 1,
    unidad: String(l.unidad || 'NIU').trim() || 'NIU',
    precio_unitario: Number(l.precio_unitario ?? l.mto_precio_unitario) || 0,
    // Sin catálogo del comprador: datos del proveedor hasta relacionarLineaCompra (ingreso).
    tip_afe_igv: l.tip_afe_igv || '10',
    estado: String(l.estado || 'EN_CAMINO').toUpperCase(),
    orden: idx,
  })).filter((l) => l.descripcion && l.cantidad > 0);
}

/**
 * Upsert CPE recibido externo en tabla `compras` (nunca en invoices ni tablas de emisión).
 * Detalle y documentos relacionados solo en JSON (lineasJson, guiaMetaJson).
 */
async function upsertRecibidoFromParsed(receptorCompany, parsed, {
  fuente = 'sspp',
  xmlUrl = null,
  pdfUrl = null,
  hashCpe = null,
  reemplazarResumen = false,
} = {}) {
  const receptorRuc = String(receptorCompany?.ruc || '').replace(/\D/g, '');
  const emisorRuc = String(parsed.proveedor?.numero_doc || '').replace(/\D/g, '');
  const tipoDoc = String(parsed.tipo_doc || '01').padStart(2, '0');
  const serie = String(parsed.serie || '').trim().toUpperCase();
  const correlativo = normalizeCorrelativoCompra(parsed.correlativo);

  if (!receptorRuc || receptorRuc.length !== 11) {
    const err = new Error('RUC receptor inválido.');
    err.status = 400;
    throw err;
  }
  if (emisorRuc.length !== 11) {
    const err = new Error('El CPE no tiene RUC emisor válido.');
    err.status = 400;
    throw err;
  }
  if (emisorRuc === receptorRuc) {
    const err = new Error('El emisor del comprobante no puede ser tu propio RUC.');
    err.status = 400;
    throw err;
  }
  if (!serie || !correlativo) {
    const err = new Error('serie y correlativo son obligatorios.');
    err.status = 400;
    throw err;
  }

  const existente = await findRowByClaveNatural(receptorRuc, {
    tipoDoc,
    serie,
    correlativo,
    proveedorNumeroDoc: emisorRuc,
  });

  const lineasNuevas = lineasFromParsed(parsed);
  const lineasActuales = Array.isArray(existente?.lineasJson) ? existente.lineasJson : [];
  const lineasParaNombre = lineasNuevas.length ? lineasNuevas : lineasActuales;
  const emisorNombre = resolverProveedorRazonSocial(
    emisorRuc,
    parsed.proveedor?.razon_social,
    { lineas: lineasParaNombre, previo: existente?.proveedorRazonSocial },
  );

  const fechaEmision = parsed.fecha_emision
    ? normalizeFechaEmision(parsed.fecha_emision)
    : null;

  const lineasParaTotales = lineasNuevas.length ? lineasNuevas : lineasActuales;
  const totales = calcTotales(lineasParaTotales, parsed);

  const dataBase = {
    tipoDoc,
    serie,
    correlativo,
    // No pisar fecha existente con null (scraper a veces no trae fecha).
    fechaEmision: fechaEmision || existente?.fechaEmision || null,
    tipoMoneda: String(parsed.tipo_moneda || 'PEN').toUpperCase(),
    proveedorTipoDoc: String(parsed.proveedor?.tipo_doc || '6'),
    proveedorNumeroDoc: emisorRuc,
    proveedorRazonSocial: emisorNombre.slice(0, 255),
    subTotal: totales.subTotal,
    mtoIgv: totales.mtoIgv,
    mtoImpVenta: totales.mtoImpVenta,
    origen: origenFromFuente(fuente),
    fuente: String(fuente || '').toLowerCase() || null,
    estado: 'ACEPTADO',
    observacion: null,
    ...(parsed.guia_meta && typeof parsed.guia_meta === 'object'
      ? {
        guiaMetaJson: (() => {
          const rolReal = rolRecibidoDesdePartes(parsed.guia_meta, receptorRuc, tipoDoc);
          return rolReal
            ? { ...parsed.guia_meta, rol_recibido: rolReal }
            : parsed.guia_meta;
        })(),
      }
      : {}),
  };
  if (xmlUrl) dataBase.xmlUrl = xmlUrl;
  if (pdfUrl) dataBase.pdfUrl = pdfUrl;
  if (hashCpe) dataBase.hashCpe = hashCpe;

  if (existente) {
    const esResumen = lineasActuales.length <= 1
      && String(lineasActuales[0]?.descripcion || '').startsWith('Compra ·');
    const esPlaceholderGre = lineasActuales.some((l) => {
      const d = String(l?.descripcion || l?.nombre || '');
      return d.startsWith('GRE ·') || d.startsWith('GRE remitente') || d.startsWith('GRE transportista');
    });
    const esGreRecibida = ['09', '31'].includes(tipoDoc);
    const esFacturaRecibida = ['01', '03', '07', '08'].includes(tipoDoc);
    const debeReemplazar = reemplazarResumen && lineasNuevas.length > 0 && (
      esResumen
      || esPlaceholderGre
      || (esGreRecibida && String(fuente || '').toLowerCase() === 'gre_scraper')
      || (esFacturaRecibida && String(fuente || '').toLowerCase() === 'facturas_scraper')
      || (esGreRecibida && String(fuente || '').toLowerCase() === 'plataforma_gre'
        && (!direccionGreCompleta(existente?.guiaMetaJson?.envio?.partida)
          || !direccionGreCompleta(existente?.guiaMetaJson?.envio?.llegada)))
    );
    const guiaMetaMerged = parsed.guia_meta
      ? mergeGuiaMetaEnvio(existente?.guiaMetaJson, parsed.guia_meta, {
        receptorRuc,
        tipoDoc,
      })
      : existente?.guiaMetaJson;
    const updated = await prisma.compra.update({
      where: { id: existente.id },
      data: {
        ...dataBase,
        ...(debeReemplazar ? { lineasJson: lineasNuevas } : {}),
        ...(guiaMetaMerged ? { guiaMetaJson: guiaMetaMerged } : {}),
        xmlUrl: xmlUrl || existente.xmlUrl,
        pdfUrl: pdfUrl || existente.pdfUrl,
        hashCpe: hashCpe || existente.hashCpe,
      },
    });
    return {
      creado: false,
      enriquecido: Boolean(debeReemplazar),
      duplicado: !debeReemplazar,
      compra: updated,
      invoice: toApiInvoiceShape(updated),
    };
  }

  const created = await prisma.compra.create({
    data: {
      id: randomUUID(),
      companyRuc: receptorRuc,
      ...dataBase,
      lineasJson: lineasNuevas.length ? lineasNuevas : [{
        id: randomUUID(),
        descripcion: `Compra · ${emisorNombre}`,
        nombre: `Compra · ${emisorNombre}`,
        cantidad: 1,
        unidad: 'NIU',
        precio_unitario: Number(parsed.mto_imp_venta) || 0,
        estado: 'EN_CAMINO',
      }],
    },
  });

  return {
    creado: true,
    enriquecido: false,
    duplicado: false,
    compra: created,
    invoice: toApiInvoiceShape(created),
  };
}

async function relacionarLineaCompra(companyRuc, compraId, detailId, catalogItemId) {
  const row = await prisma.compra.findFirst({
    where: { id: compraId, companyRuc: String(companyRuc || '').trim() },
  });
  if (!row) return { error: 'compra_not_found' };

  const catalogItem = await prisma.catalogItem.findFirst({
    where: { id: catalogItemId, companyRuc: String(companyRuc || '').trim() },
  });
  if (!catalogItem) return { error: 'catalog_not_found' };
  if (catalogItem.kind === 'SERVICE') return { error: 'servicio' };

  const lineas = Array.isArray(row.lineasJson) ? [...row.lineasJson] : [];
  let idx = lineas.findIndex((l) => String(l.id || '') === detailId);
  if (idx < 0) {
    const m = String(detailId || '').match(/-(\d+)$/);
    if (m) idx = Number(m[1]);
  }
  if (idx < 0 || idx >= lineas.length) return { error: 'linea_not_found' };

  lineas[idx] = {
    ...lineas[idx],
    catalog_item_id: catalogItemId,
    codigo: lineas[idx].codigo || catalogItem.codigo || null,
  };

  const updated = await prisma.compra.update({
    where: { id: row.id },
    data: { lineasJson: lineas },
  });
  const shape = toApiInvoiceShape(updated);
  return { error: null, linea: shape.details?.[idx] || null, compra: shape };
}

async function listSinXml(companyRuc, { desde = null, hasta = null, take = 80 } = {}) {
  const ruc = String(companyRuc || '').trim();
  const rows = await prisma.compra.findMany({
    where: {
      companyRuc: ruc,
      OR: [{ xmlUrl: null }, { xmlUrl: '' }],
      fuente: { not: null },
    },
    orderBy: { creadoEn: 'desc' },
    take,
  });
  return rows.filter((row) => {
    const ms = parseStoredTimestamp(row.fechaEmision);
    if (ms == null) return true;
    const desdeMs = desde ? calendarDayStartMsPe(desde) : null;
    const hastaMs = hasta ? calendarDayEndMsPe(hasta) : null;
    if (desdeMs != null && ms < desdeMs) return false;
    if (hastaMs != null && ms > hastaMs) return false;
    return true;
  });
}

/** Elimina filas duplicadas en BD (misma clave natural, distinto correlativo con ceros). */
async function dedupeComprasDuplicadasEnBd(companyRuc) {
  const ruc = String(companyRuc || '').trim();
  if (!ruc) return { eliminados: 0 };
  const rows = await prisma.compra.findMany({ where: { companyRuc: ruc } });
  const grupos = new Map();
  for (const row of rows) {
    const k = claveNaturalCompraRow(row);
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k).push(row);
  }
  const idsEliminar = [];
  for (const grupo of grupos.values()) {
    if (grupo.length <= 1) continue;
    grupo.sort((a, b) => puntajeRiquezaCompra(b) - puntajeRiquezaCompra(a));
    for (const row of grupo.slice(1)) idsEliminar.push(row.id);
  }
  if (idsEliminar.length) {
    await prisma.compra.deleteMany({ where: { id: { in: idsEliminar } } });
  }
  return { eliminados: idsEliminar.length };
}

/** GRE-R en compras donde el receptor figura como transportista (para GRE-T). */
function compraEsGreParaTransportista(row, receptorRuc) {
  const tipo = String(row.tipoDoc || '').padStart(2, '0');
  if (tipo !== '09') return false;
  const yo = String(receptorRuc || '').replace(/\D/g, '');
  if (!yo) return false;
  const emisor = String(row.proveedorNumeroDoc || '').replace(/\D/g, '');
  if (emisor && emisor === yo) return false;
  const meta = row.guiaMetaJson && typeof row.guiaMetaJson === 'object'
    ? row.guiaMetaJson
    : {};
  if (String(meta.rol_recibido || '').toUpperCase() === 'TRANSPORTISTA') return true;
  const envio = meta.envio && typeof meta.envio === 'object' ? meta.envio : {};
  const t = envio.transportista && typeof envio.transportista === 'object'
    ? envio.transportista
    : {};
  const transp = String(t.ruc || t.num_doc || t.numero_doc || '').replace(/\D/g, '');
  return transp === yo;
}

async function deleteManyForCompany(companyRuc, ids = []) {
  const ruc = String(companyRuc || '').trim();
  const uniqueIds = [...new Set(
    (Array.isArray(ids) ? ids : [])
      .map((id) => String(id || '').trim())
      .filter(Boolean),
  )].slice(0, 100);

  if (!ruc || !uniqueIds.length) {
    return { eliminados: 0, fallidos: [], items: [] };
  }

  const rows = await prisma.compra.findMany({
    where: { companyRuc: ruc, id: { in: uniqueIds } },
    select: {
      id: true,
      serie: true,
      correlativo: true,
      tipoDoc: true,
      estado: true,
    },
  });
  const byId = new Map(rows.map((r) => [r.id, r]));
  const fallidos = [];
  const items = [];

  for (const id of uniqueIds) {
    const row = byId.get(id);
    if (!row) {
      fallidos.push({ id, message: 'No encontrado' });
      continue;
    }
    try {
      await prisma.movimiento.updateMany({
        where: { companyRuc: ruc, referenciaId: id },
        data: { referenciaId: null },
      });
      await prisma.compra.delete({ where: { id } });
      items.push({
        id: row.id,
        serie: row.serie,
        correlativo: row.correlativo,
        estado: row.estado,
      });
    } catch (err) {
      fallidos.push({ id, message: err.message || 'No se pudo eliminar' });
    }
  }

  return {
    eliminados: items.length,
    fallidos,
    items,
  };
}

/**
 * GRE-R recibidas donde yo soy transportista (para vincular en GRE-T).
 * Misma lógica que la app móvil: tipo 09, no emitidas por mí, rol TRANSPORTISTA o RUC en envio.transportista.
 */
async function listGreParaTransportistaPaginated(
  companyRuc,
  { skip = 0, take = 20, q = '', desde = null, hasta = null } = {},
) {
  const ruc = String(companyRuc || '').trim();
  if (!ruc) return { items: [], total: 0, has_more: false, next_offset: 0 };
  const all = await listByCompany(ruc, { desde, hasta, rolGre: 'transportista' });
  const qTrim = String(q || '').trim();
  const qLower = qTrim.toLowerCase();
  const qDigits = qTrim.replace(/\D/g, '');
  const filtered = !qTrim
    ? all
    : all.filter((inv) => {
      const ref = `${inv.serie || ''}-${inv.correlativo || ''}`.toLowerCase();
      const nombre = String(inv.company?.nombre || '').toLowerCase();
      const doc = String(inv.company?.numero_doc || inv.company?.ruc || '').replace(/\D/g, '');
      return ref.includes(qLower)
        || nombre.includes(qLower)
        || (qDigits && doc.includes(qDigits))
        || String(inv.correlativo || '').replace(/\D/g, '').includes(qDigits);
    });
  const total = filtered.length;
  const slice = filtered.slice(skip, skip + take);
  return {
    items: slice,
    total,
    offset: skip,
    limit: take,
    has_more: skip + slice.length < total,
    next_offset: skip + slice.length,
  };
}

module.exports = {
  listByCompany,
  create,
  findById,
  listCpeParaGrePaginated,
  listGreParaTransportistaPaginated,
  compraEsGreParaTransportista,
  findByClaveNatural,
  findRowByClaveNatural,
  upsertRecibidoFromParsed,
  relacionarLineaCompra,
  listSinXml,
  dedupeComprasDuplicadasEnBd,
  normalizeCorrelativoCompra,
  mergeGuiaMetaEnvio,
  toApiInvoiceShape,
  origenFromFuente,
  deleteManyForCompany,
};
