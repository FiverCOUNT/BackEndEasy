const { randomUUID } = require('crypto');
const prisma = require('../config/prisma');
const { toApiTimestamp } = require('../utils/fechas');
const catalogItemModel = require('./catalogItemModel');
const movimientoModel = require('./movimientoModel');

function toNumber(value) {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
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

function calcTotales(lineas, body = {}) {
  let sub = toNumber(body.sub_total ?? body.subTotal);
  let igv = toNumber(body.mto_igv ?? body.mtoIgv);
  let total = toNumber(body.mto_imp_venta ?? body.mtoImpVenta ?? body.total);
  if (total == null && lineas.length) {
    total = lineas.reduce((acc, l) => acc + l.cantidad * l.precio_unitario, 0);
    total = Math.round(total * 100) / 100;
  }
  if (sub == null && total != null) {
    sub = Math.round((total / 1.18) * 100) / 100;
  }
  if (igv == null && total != null && sub != null) {
    igv = Math.round((total - sub) * 100) / 100;
  }
  return { subTotal: sub, mtoIgv: igv, mtoImpVenta: total };
}

/** Forma Invoice-compatible para la app (listado compras + GRE). */
function toApiInvoiceShape(row, { movimientoId = null } = {}) {
  if (!row) return null;
  const lineas = Array.isArray(row.lineasJson) ? row.lineasJson : [];
  const estados = lineas.map((l) => String(l.estado || '').toUpperCase());
  const inventarioEstado = estados.includes('EN_CAMINO')
    ? 'EN_CAMINO'
    : (estados.includes('RECIBIDO') ? 'RECIBIDO' : null);

  return {
    id: row.id,
    company_ruc: row.companyRuc,
    sentido: 'COMPRA_REGISTRADA',
    tipo_doc: row.tipoDoc,
    serie: row.serie,
    correlativo: row.correlativo,
    fecha_emision: toApiTimestamp(row.fechaEmision),
    tipo_moneda: row.tipoMoneda,
    observacion: row.observacion || undefined,
    sub_total: toNumber(row.subTotal),
    mto_igv: toNumber(row.mtoIgv),
    mto_imp_venta: toNumber(row.mtoImpVenta),
    estado: 'ACEPTADO',
    inventario_estado: inventarioEstado,
    movimiento_en_camino_id: movimientoId || undefined,
    origen: row.origen,
    imagen_url: row.imagenUrl || undefined,
    company: {
      ruc: row.proveedorNumeroDoc,
      tipo_doc: row.proveedorTipoDoc,
      nombre: row.proveedorRazonSocial,
      numero_doc: row.proveedorNumeroDoc,
    },
    client: {
      ruc: row.companyRuc,
      tipo_doc: '6',
      nombre: row.companyRuc,
      numero_doc: row.companyRuc,
    },
    details: lineas.map((l, idx) => ({
      id: `${row.id}-${idx}`,
      catalog_item_id: l.catalog_item_id || l.codigo || undefined,
      descripcion: l.descripcion,
      cantidad: l.cantidad,
      unidad: l.unidad,
      mto_precio_unitario: l.precio_unitario,
      tip_afe_igv: '10',
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

async function listByCompany(companyRuc, { desde = null, hasta = null } = {}) {
  const ruc = String(companyRuc || '').trim();
  if (!ruc) return [];
  const rows = await prisma.compra.findMany({
    where: { companyRuc: ruc },
    orderBy: { creadoEn: 'desc' },
    take: 200,
  });
  let filtered = rows;
  if (desde || hasta) {
    filtered = rows.filter((row) => {
      const f = String(row.fechaEmision || '').slice(0, 10);
      if (!f) return true;
      if (desde && f < String(desde).slice(0, 10)) return false;
      if (hasta && f > String(hasta).slice(0, 10)) return false;
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
  const correlativo = String(body.correlativo || '').replace(/\D/g, '');
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

  const enCamino = body.en_camino !== false && body.enCamino !== false;
  const totales = calcTotales(lineas, body);
  const id = randomUUID();

  let almacenId = null;
  if (enCamino) {
    almacenId = await resolveAlmacenId(ruc, body);
    if (!almacenId) {
      const err = new Error(
        'Necesitas al menos un almacén activo para registrar la compra en camino.',
      );
      err.status = 400;
      throw err;
    }
  }

  // Resolver / crear ítems de catálogo y marcar líneas EN_CAMINO.
  const lineasConCatalogo = [];
  for (const linea of lineas) {
    const item = await resolveOrCreateCatalogItem(ruc, linea);
    lineasConCatalogo.push({
      ...linea,
      catalog_item_id: item.id,
      codigo: linea.codigo || item.codigo || null,
      estado: enCamino ? 'EN_CAMINO' : (linea.estado || 'EN_CAMINO'),
    });
  }
  lineas = lineasConCatalogo;

  let movimientoId = null;
  try {
    const row = await prisma.compra.create({
      data: {
        id,
        companyRuc: ruc,
        tipoDoc,
        serie,
        correlativo,
        fechaEmision: body.fecha_emision || body.fechaEmision || null,
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

    if (enCamino) {
      const result = await movimientoModel.registrarEntradaEnCamino({
        companyRuc: ruc,
        almacenId,
        referenciaId: id,
        referenciaTipo: 'COMPRA_EN_CAMINO',
        observaciones: `Compra ${serie}-${correlativo} · mercadería en camino`,
        lineas: lineas.map((l) => ({
          catalogItemId: l.catalog_item_id,
          catalog_item_id: l.catalog_item_id,
          cantidad: l.cantidad,
        })),
      });
      if (result.error) {
        await prisma.compra.delete({ where: { id } }).catch(() => {});
        const err = new Error(
          result.error === 'almacen_not_found'
            ? 'Almacén no encontrado.'
            : `No se pudo registrar inventario en camino (${result.error}).`,
        );
        err.status = 400;
        throw err;
      }
      movimientoId = result.movimiento?.id || null;
    }

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

async function findByClaveNatural(companyRuc, {
  tipoDoc,
  serie,
  correlativo,
  proveedorNumeroDoc,
} = {}) {
  const row = await prisma.compra.findFirst({
    where: {
      companyRuc: String(companyRuc || '').trim(),
      tipoDoc: String(tipoDoc || '').trim(),
      serie: String(serie || '').trim().toUpperCase(),
      correlativo: String(correlativo || '').replace(/\D/g, ''),
      proveedorNumeroDoc: String(proveedorNumeroDoc || '').replace(/\D/g, ''),
    },
  });
  return toApiInvoiceShape(row);
}

module.exports = {
  listByCompany,
  create,
  findById,
  findByClaveNatural,
  toApiInvoiceShape,
};
