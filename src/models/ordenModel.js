const { randomUUID } = require('crypto');
const prisma = require('../config/prisma');
const { parseAddressInput, toAddressApi, toAddressSnapshot, registerCatalogAddress } = require('../utils/addressHelper');

const IGV_RATE = 0.18;
const ESTADOS = new Set(['BORRADOR', 'CONFIRMADA', 'FACTURADA', 'ANULADA']);

function round4(value) {
  return Math.round(Number(value) * 10000) / 10000;
}

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function toDec(value) {
  if (value == null) return null;
  return Number(value);
}

function calcularLineaDesdeInput(linea, catalogItem = null) {
  const tipAfeIgv = String(
    linea.tip_afe_igv || linea.tipAfeIgv || catalogItem?.afectacionIgv || '10',
  ).trim() || '10';
  const qty = toNumber(linea.cantidad, 1);
  const precioConIgv = linea.mto_precio_unitario ?? linea.mtoPrecioUnitario ?? linea.precio_unitario
    ?? linea.precioUnitario ?? catalogItem?.precioUnitario ?? 0;
  const precio = toNumber(precioConIgv);

  let mtoValorUnitario;
  let mtoValorVenta;
  let mtoIgv;
  let total;
  let porcentajeIgv = 0;

  if (tipAfeIgv === '10') {
    mtoValorUnitario = round4(precio / (1 + IGV_RATE));
    mtoValorVenta = round4(mtoValorUnitario * qty);
    mtoIgv = round4(mtoValorVenta * IGV_RATE);
    total = round4(mtoValorVenta + mtoIgv);
    porcentajeIgv = 18;
  } else {
    mtoValorUnitario = round4(precio);
    mtoValorVenta = round4(precio * qty);
    mtoIgv = 0;
    total = mtoValorVenta;
  }

  const nombre = String(
    linea.nombre || catalogItem?.nombre || '',
  ).trim() || null;
  const descripcion = String(
    linea.descripcion || catalogItem?.descripcion || nombre || '',
  ).trim() || null;

  return {
    catalogItemId: catalogItem?.id
      || String(linea.catalog_item_id || linea.catalogItemId || '').trim()
      || null,
    almacenId: String(linea.almacen_id || linea.almacenId || '').trim() || null,
    codigo: String(linea.codigo || catalogItem?.codigo || '').trim() || null,
    codigoSunat: String(
      linea.codigo_sunat || linea.codigoSunat || catalogItem?.codigoSunat || '',
    ).trim() || null,
    nombre,
    descripcion,
    cantidad: qty,
    unidad: String(linea.unidad || catalogItem?.unidad || 'NIU').trim() || 'NIU',
    mtoPrecioUnitario: round4(precio),
    tipAfeIgv,
    mtoValorUnitario,
    mtoValorVenta,
    mtoBaseIgv: mtoValorVenta,
    mtoIgv,
    porcentajeIgv,
    total,
  };
}

function sumarTotales(detalles) {
  let gravadas = 0;
  let igv = 0;
  let venta = 0;
  for (const d of detalles) {
    if (d.tipAfeIgv === '10') {
      gravadas += toNumber(d.mtoValorVenta);
      igv += toNumber(d.mtoIgv);
    }
    venta += toNumber(d.total);
  }
  return {
    mtoOperGravadas: round4(gravadas),
    mtoIgv: round4(igv),
    subTotal: round4(gravadas),
    mtoImpVenta: round4(venta),
  };
}

function toDetalleApi(d) {
  if (!d) return null;
  return {
    id: d.id,
    orden_id: d.ordenId,
    catalog_item_id: d.catalogItemId,
    orden_linea: d.ordenLinea,
    codigo: d.codigo,
    codigo_sunat: d.codigoSunat,
    descripcion: d.descripcion,
    nombre: d.nombre,
    cantidad: toDec(d.cantidad),
    unidad: d.unidad,
    mto_precio_unitario: toDec(d.mtoPrecioUnitario),
    tip_afe_igv: d.tipAfeIgv,
    mto_valor_unitario: toDec(d.mtoValorUnitario),
    mto_valor_venta: toDec(d.mtoValorVenta),
    mto_base_igv: toDec(d.mtoBaseIgv),
    mto_igv: toDec(d.mtoIgv),
    porcentaje_igv: toDec(d.porcentajeIgv),
    total: toDec(d.total),
    almacen_id: d.almacenId,
    producto_serie_id: d.productoSerieId || null,
    almacen: d.almacen
      ? {
          id: d.almacen.id,
          nombre: d.almacen.nombre,
          codigo: d.almacen.codigo,
        }
      : undefined,
    catalog_item: d.catalogItem
      ? {
          id: d.catalogItem.id,
          nombre: d.catalogItem.nombre,
          codigo: d.catalogItem.codigo,
          unidad: d.catalogItem.unidad,
          precio_unitario: toDec(d.catalogItem.precioUnitario),
        }
      : undefined,
    producto_serie: d.productoSerie
      ? {
          id: d.productoSerie.id,
          company_ruc: d.productoSerie.companyRuc,
          catalog_item_id: d.productoSerie.catalogItemId,
          numero_serie: d.productoSerie.numeroSerie,
          almacen_id: d.productoSerie.almacenId,
          estado: d.productoSerie.estado,
          comprobante_id: d.productoSerie.comprobanteId,
          entrega_id: d.productoSerie.entregaId,
        }
      : undefined,
  };
}

function toApi(orden) {
  if (!orden) return null;
  return {
    id: orden.id,
    company_ruc: orden.companyRuc,
    cliente_id: orden.clienteId,
    invoice_id: orden.invoiceId,
    estado: orden.estado,
    tipo_moneda: orden.tipoMoneda,
    observacion: orden.observacion,
    mto_oper_gravadas: toDec(orden.mtoOperGravadas),
    mto_igv: toDec(orden.mtoIgv),
    sub_total: toDec(orden.subTotal),
    mto_imp_venta: toDec(orden.mtoImpVenta),
    visto: Boolean(orden.visto),
    creado_en: orden.creadoEn,
    actualizado_en: orden.actualizadoEn,
    address_envio: toAddressApi(orden.addressEnvio),
    address_envio_id: null,
    cliente: orden.cliente
      ? {
          id: orden.cliente.id,
          tipo_doc: orden.cliente.tipoDoc,
          numero_doc: orden.cliente.numeroDoc,
          razon_social: orden.cliente.razonSocial,
        }
      : undefined,
    invoice: orden.invoice
      ? {
          id: orden.invoice.id,
          tipo_doc: orden.invoice.tipoDoc,
          serie: orden.invoice.serie,
          correlativo: orden.invoice.correlativo,
          estado: orden.invoice.estado,
        }
      : undefined,
    detalles: Array.isArray(orden.detalles)
      ? orden.detalles.map(toDetalleApi)
      : undefined,
    items_count: orden._count?.detalles ?? orden.detalles?.length ?? 0,
  };
}

const DETALLE_INCLUDE = {
  catalogItem: {
    select: {
      id: true,
      nombre: true,
      codigo: true,
      unidad: true,
      precioUnitario: true,
    },
  },
  almacen: {
    select: {
      id: true,
      nombre: true,
      codigo: true,
    },
  },
  productoSerie: {
    select: {
      id: true,
      companyRuc: true,
      catalogItemId: true,
      numeroSerie: true,
      almacenId: true,
      estado: true,
      comprobanteId: true,
      entregaId: true,
    },
  },
};

const ORDEN_INCLUDE = {
  cliente: true,
  invoice: {
    select: {
      id: true,
      tipoDoc: true,
      serie: true,
      correlativo: true,
      estado: true,
    },
  },
  detalles: {
    include: DETALLE_INCLUDE,
    orderBy: { ordenLinea: 'asc' },
  },
};

function buildSearchWhere(companyRuc, { q, estado } = {}) {
  const where = { companyRuc };
  if (estado && ESTADOS.has(String(estado).toUpperCase())) {
    where.estado = String(estado).toUpperCase();
  }
  const term = String(q || '').trim();
  if (term) {
    where.OR = [
      { observacion: { contains: term } },
      { id: { contains: term } },
      { cliente: { razonSocial: { contains: term } } },
      { cliente: { numeroDoc: { contains: term } } },
    ];
  }
  return where;
}

async function findByCompanyPaginated(companyRuc, {
  q,
  estado,
  skip = 0,
  take = 20,
} = {}) {
  const where = buildSearchWhere(companyRuc, { q, estado });
  const [total, rows] = await Promise.all([
    prisma.orden.count({ where }),
    prisma.orden.findMany({
      where,
      include: {
        cliente: true,
        invoice: {
          select: {
            id: true,
            tipoDoc: true,
            serie: true,
            correlativo: true,
            estado: true,
          },
        },
        _count: { select: { detalles: true } },
      },
      orderBy: { creadoEn: 'desc' },
      skip,
      take,
    }),
  ]);
  return { total, items: rows.map(toApi) };
}

async function findById(companyRuc, id, { marcarVisto = false } = {}) {
  if (marcarVisto) {
    await prisma.orden.updateMany({
      where: { id, companyRuc, visto: false },
      data: { visto: true },
    });
  }
  const row = await prisma.orden.findFirst({
    where: { id, companyRuc },
    include: ORDEN_INCLUDE,
  });
  return toApi(row);
}

async function countNoVistas(companyRuc) {
  return prisma.orden.count({
    where: { companyRuc, visto: false },
  });
}

async function marcarVista(companyRuc, id) {
  const existing = await prisma.orden.findFirst({ where: { id, companyRuc } });
  if (!existing) {
    const err = new Error('Orden no encontrada.');
    err.status = 404;
    throw err;
  }
  if (existing.visto) return toApi(await prisma.orden.findFirst({
    where: { id, companyRuc },
    include: ORDEN_INCLUDE,
  }));
  const row = await prisma.orden.update({
    where: { id },
    data: { visto: true },
    include: ORDEN_INCLUDE,
  });
  return toApi(row);
}

async function marcarTodasVistas(companyRuc) {
  const result = await prisma.orden.updateMany({
    where: { companyRuc, visto: false },
    data: { visto: true },
  });
  return { actualizadas: result.count };
}

async function resolveDetallesInput(companyRuc, lineasRaw) {
  const lineas = Array.isArray(lineasRaw) ? lineasRaw : [];
  if (!lineas.length) {
    const err = new Error('La orden requiere al menos una línea.');
    err.status = 400;
    throw err;
  }

  const catalogIds = [...new Set(
    lineas
      .map((l) => String(l.catalog_item_id || l.catalogItemId || '').trim())
      .filter(Boolean),
  )];

  const catalogMap = new Map();
  if (catalogIds.length) {
    const items = await prisma.catalogItem.findMany({
      where: { companyRuc, id: { in: catalogIds } },
    });
    for (const item of items) catalogMap.set(item.id, item);
  }

  const almacenIds = [...new Set(
    lineas
      .map((l) => String(l.almacen_id || l.almacenId || '').trim())
      .filter(Boolean),
  )];
  const almacenMap = new Map();
  if (almacenIds.length) {
    const almacenes = await prisma.almacen.findMany({
      where: { companyRuc, id: { in: almacenIds }, activo: true },
    });
    for (const alm of almacenes) almacenMap.set(alm.id, alm);
  }

  const serieIds = [...new Set(
    lineas
      .map((l) => String(l.producto_serie_id || l.productoSerieId || '').trim())
      .filter(Boolean),
  )];
  const serieMap = new Map();
  if (serieIds.length) {
    const series = await prisma.productoSerie.findMany({
      where: { companyRuc, id: { in: serieIds } },
    });
    for (const s of series) serieMap.set(s.id, s);
  }

  const usedSerieIds = new Set();
  const out = [];
  for (let index = 0; index < lineas.length; index++) {
    const linea = lineas[index];
    const catalogId = String(linea.catalog_item_id || linea.catalogItemId || '').trim();
    const catalogItem = catalogId ? catalogMap.get(catalogId) : null;
    if (catalogId && !catalogItem) {
      const err = new Error(`Producto de catálogo no encontrado: ${catalogId}`);
      err.status = 400;
      throw err;
    }
    const almacenId = String(linea.almacen_id || linea.almacenId || '').trim() || null;
    if (catalogId && !almacenId) {
      const err = new Error(`Línea ${index + 1}: selecciona un almacén.`);
      err.status = 400;
      throw err;
    }
    if (almacenId && !almacenMap.has(almacenId)) {
      const err = new Error(`Línea ${index + 1}: almacén no válido.`);
      err.status = 400;
      throw err;
    }

    let serieId = String(linea.producto_serie_id || linea.productoSerieId || '').trim() || null;
    if (catalogItem?.manejaSerie) {
      if (!serieId) {
        const err = new Error(`Línea ${index + 1}: selecciona la serie del producto.`);
        err.status = 400;
        throw err;
      }
      const serie = serieMap.get(serieId);
      if (!serie) {
        const err = new Error(`Línea ${index + 1}: serie no encontrada.`);
        err.status = 400;
        throw err;
      }
      if (serie.catalogItemId !== catalogItem.id) {
        const err = new Error(`Línea ${index + 1}: la serie no pertenece al producto.`);
        err.status = 400;
        throw err;
      }
      if (serie.estado !== 'DISPONIBLE') {
        const err = new Error(`Línea ${index + 1}: la serie ${serie.numeroSerie} no está disponible.`);
        err.status = 400;
        throw err;
      }
      if (serie.almacenId && almacenId && serie.almacenId !== almacenId) {
        const err = new Error(`Línea ${index + 1}: la serie no está en el almacén seleccionado.`);
        err.status = 400;
        throw err;
      }
      if (usedSerieIds.has(serieId)) {
        const err = new Error(`Línea ${index + 1}: serie duplicada en la orden (${serie.numeroSerie}).`);
        err.status = 400;
        throw err;
      }
      usedSerieIds.add(serieId);
      linea.cantidad = 1;
    } else {
      serieId = null;
    }

    const calc = calcularLineaDesdeInput(linea, catalogItem);
    if (!calc.nombre && !calc.descripcion) {
      const err = new Error(`Línea ${index + 1}: falta nombre o descripción.`);
      err.status = 400;
      throw err;
    }
    out.push({
      id: randomUUID(),
      ordenLinea: index + 1,
      ...calc,
      productoSerieId: serieId,
    });
  }
  return out;
}

async function create(companyRuc, body = {}) {
  const clienteId = String(body.cliente_id || body.clienteId || '').trim();
  if (!clienteId) {
    const err = new Error('cliente_id es obligatorio.');
    err.status = 400;
    throw err;
  }

  const cliente = await prisma.cliente.findFirst({
    where: { id: clienteId, companyRuc, activo: true },
  });
  if (!cliente) {
    const err = new Error('Cliente no encontrado.');
    err.status = 404;
    throw err;
  }

  const lineasRaw = body.lineas || body.detalles || body.items || [];
  const detalles = await resolveDetallesInput(companyRuc, lineasRaw);
  const totales = sumarTotales(detalles);
  const estadoRaw = String(body.estado || 'BORRADOR').toUpperCase();
  const estado = ESTADOS.has(estadoRaw) ? estadoRaw : 'BORRADOR';
  const addressInput = parseAddressInput(body);
  const addressEnvioIdExistente = String(
    body.address_envio_id || body.addressEnvioId || '',
  ).trim() || null;

  const id = randomUUID();
  const row = await prisma.$transaction(async (tx) => {
    let snapshot = toAddressSnapshot(addressInput);
    if (!snapshot && addressEnvioIdExistente) {
      const existingAddr = await tx.address.findFirst({
        where: { id: addressEnvioIdExistente, companyRuc },
      });
      if (existingAddr) {
        snapshot = toAddressSnapshot(existingAddr);
        await tx.address.update({
          where: { id: existingAddr.id },
          data: { creadoEn: new Date() },
        });
      }
    }
    if (snapshot) {
      await registerCatalogAddress(tx, {
        companyRuc,
        snapshot,
        existingId: addressEnvioIdExistente || null,
      });
    }

    return tx.orden.create({
      data: {
        id,
        companyRuc,
        clienteId,
        addressEnvio: snapshot,
        estado,
        tipoMoneda: String(body.tipo_moneda || body.tipoMoneda || 'PEN').trim() || 'PEN',
        observacion: String(body.observacion || '').trim() || null,
        ...totales,
        detalles: {
          create: detalles.map((d) => ({
            id: d.id,
            ordenLinea: d.ordenLinea,
            catalogItemId: d.catalogItemId,
            codigo: d.codigo,
            codigoSunat: d.codigoSunat,
            descripcion: d.descripcion,
            nombre: d.nombre,
            cantidad: d.cantidad,
            unidad: d.unidad,
            mtoPrecioUnitario: d.mtoPrecioUnitario,
            tipAfeIgv: d.tipAfeIgv,
            mtoValorUnitario: d.mtoValorUnitario,
            mtoValorVenta: d.mtoValorVenta,
            mtoBaseIgv: d.mtoBaseIgv,
            mtoIgv: d.mtoIgv,
            porcentajeIgv: d.porcentajeIgv,
            total: d.total,
            almacenId: d.almacenId,
            productoSerieId: d.productoSerieId || null,
          })),
        },
      },
      include: ORDEN_INCLUDE,
    });
  });
  return toApi(row);
}

async function update(companyRuc, id, body = {}) {
  const existing = await prisma.orden.findFirst({
    where: { id, companyRuc },
    include: { detalles: true },
  });
  if (!existing) {
    const err = new Error('Orden no encontrada.');
    err.status = 404;
    throw err;
  }
  if (existing.estado === 'FACTURADA' || existing.estado === 'ANULADA') {
    const err = new Error(`No se puede editar una orden en estado ${existing.estado}.`);
    err.status = 400;
    throw err;
  }

  const data = {};
  if (body.cliente_id || body.clienteId) {
    const clienteId = String(body.cliente_id || body.clienteId).trim();
    const cliente = await prisma.cliente.findFirst({
      where: { id: clienteId, companyRuc, activo: true },
    });
    if (!cliente) {
      const err = new Error('Cliente no encontrado.');
      err.status = 404;
      throw err;
    }
    data.clienteId = clienteId;
  }
  if (body.observacion !== undefined) {
    data.observacion = String(body.observacion || '').trim() || null;
  }
  if (body.tipo_moneda || body.tipoMoneda) {
    data.tipoMoneda = String(body.tipo_moneda || body.tipoMoneda).trim() || 'PEN';
  }
  if (body.estado) {
    const estado = String(body.estado).toUpperCase();
    if (!ESTADOS.has(estado)) {
      const err = new Error('Estado inválido.');
      err.status = 400;
      throw err;
    }
    if (estado === 'FACTURADA' && !existing.invoiceId && !(body.invoice_id || body.invoiceId)) {
      const err = new Error('No puedes marcar FACTURADA sin comprobante vinculado.');
      err.status = 400;
      throw err;
    }
    data.estado = estado;
  }
  if (body.invoice_id || body.invoiceId) {
    data.invoiceId = String(body.invoice_id || body.invoiceId).trim() || null;
  }

  const hasAddressInput = Object.prototype.hasOwnProperty.call(body, 'address_envio')
    || Object.prototype.hasOwnProperty.call(body, 'addressEnvio')
    || Object.prototype.hasOwnProperty.call(body, 'address')
    || Object.prototype.hasOwnProperty.call(body, 'direccion_envio')
    || Object.prototype.hasOwnProperty.call(body, 'direccionEnvio')
    || Object.prototype.hasOwnProperty.call(body, 'direccion');
  const addressInput = hasAddressInput ? parseAddressInput(body) : undefined;

  const lineasRaw = body.lineas || body.detalles || body.items;
  let detallesCreate = null;
  if (Array.isArray(lineasRaw)) {
    detallesCreate = await resolveDetallesInput(companyRuc, lineasRaw);
    Object.assign(data, sumarTotales(detallesCreate));
  }

  const row = await prisma.$transaction(async (tx) => {
    if (addressInput !== undefined) {
      const snapshot = toAddressSnapshot(addressInput);
      data.addressEnvio = snapshot;
      if (snapshot) {
        await registerCatalogAddress(tx, { companyRuc, snapshot });
      }
    }
    if (detallesCreate) {
      await tx.ordenDetalle.deleteMany({ where: { ordenId: id } });
      await tx.ordenDetalle.createMany({
        data: detallesCreate.map((d) => ({
          id: d.id,
          ordenId: id,
          ordenLinea: d.ordenLinea,
          catalogItemId: d.catalogItemId,
          codigo: d.codigo,
          codigoSunat: d.codigoSunat,
          descripcion: d.descripcion,
          nombre: d.nombre,
          cantidad: d.cantidad,
          unidad: d.unidad,
          mtoPrecioUnitario: d.mtoPrecioUnitario,
          tipAfeIgv: d.tipAfeIgv,
          mtoValorUnitario: d.mtoValorUnitario,
          mtoValorVenta: d.mtoValorVenta,
          mtoBaseIgv: d.mtoBaseIgv,
          mtoIgv: d.mtoIgv,
          porcentajeIgv: d.porcentajeIgv,
          total: d.total,
          almacenId: d.almacenId,
          productoSerieId: d.productoSerieId || null,
        })),
      });
    }
    return tx.orden.update({
      where: { id },
      data,
      include: ORDEN_INCLUDE,
    });
  });

  return toApi(row);
}

async function anular(companyRuc, id) {
  const existing = await prisma.orden.findFirst({ where: { id, companyRuc } });
  if (!existing) {
    const err = new Error('Orden no encontrada.');
    err.status = 404;
    throw err;
  }
  if (existing.estado === 'FACTURADA') {
    const err = new Error('No se puede anular una orden ya facturada.');
    err.status = 400;
    throw err;
  }
  const row = await prisma.orden.update({
    where: { id },
    data: { estado: 'ANULADA' },
    include: ORDEN_INCLUDE,
  });
  return toApi(row);
}

async function destroy(companyRuc, id) {
  const existing = await prisma.orden.findFirst({ where: { id, companyRuc } });
  if (!existing) {
    const err = new Error('Orden no encontrada.');
    err.status = 404;
    throw err;
  }
  if (existing.estado === 'FACTURADA') {
    const err = new Error('No se puede eliminar una orden facturada.');
    err.status = 400;
    throw err;
  }
  await prisma.orden.delete({ where: { id } });
  return { ok: true };
}

/** Catálogo de direcciones de envío de la empresa (para picker web/app). */
async function listDireccionesEnvioCatalogo(companyRuc, { q = '', offset = 0, limit = 10 } = {}) {
  const take = Math.min(Math.max(Number(limit) || 10, 1), 100);
  const skip = Math.max(0, Number(offset) || 0);
  const nq = String(q || '').trim();

  const where = {
    companyRuc,
    AND: [
      { direccion: { not: null } },
      { NOT: { direccion: '' } },
      ...(nq
        ? [{
            OR: [
              { etiqueta: { contains: nq } },
              { direccion: { contains: nq } },
              { distrito: { contains: nq } },
              { provincia: { contains: nq } },
              { departamento: { contains: nq } },
              { urbanizacion: { contains: nq } },
              { ubigeo: { contains: nq } },
            ],
          }]
        : []),
    ],
  };

  const [total, rows] = await Promise.all([
    prisma.address.count({ where }),
    prisma.address.findMany({
      where,
      orderBy: [{ creadoEn: 'desc' }],
      skip,
      take,
    }),
  ]);

  const items = rows.map((row) => ({
    id: row.id,
    etiqueta: row.etiqueta
      || [row.distrito, row.provincia].filter(Boolean).join(', ')
      || String(row.direccion || '').slice(0, 60),
    address: toAddressApi(row),
  }));

  return {
    items,
    total,
    has_more: skip + items.length < total,
    next_offset: skip + items.length,
  };
}

/** Últimas direcciones de envío usadas en órdenes (únicas por contenido, más recientes). */
async function listDireccionesEnvioRecientes(companyRuc, { limit = 10 } = {}) {
  const take = Math.min(Math.max(Number(limit) || 10, 1), 50);
  const rows = await prisma.orden.findMany({
    where: { companyRuc },
    orderBy: { creadoEn: 'desc' },
    take: take * 12,
    select: {
      id: true,
      creadoEn: true,
      addressEnvio: true,
      cliente: {
        select: {
          id: true,
          razonSocial: true,
          numeroDoc: true,
        },
      },
    },
  });

  const seen = new Set();
  const items = [];
  for (const row of rows) {
    if (!row.addressEnvio) continue;
    const addr = toAddressApi(row.addressEnvio);
    const key = [addr.ubigeo, addr.direccion, addr.distrito].join('|').toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({
      id: row.id,
      etiqueta: `${addr.distrito || ''} · ${addr.direccion}`.trim().slice(0, 120),
      usado_en: row.creadoEn,
      cliente: row.cliente
        ? {
            id: row.cliente.id,
            razon_social: row.cliente.razonSocial,
            numero_doc: row.cliente.numeroDoc,
          }
        : undefined,
      address: addr,
    });
    if (items.length >= take) break;
  }
  return items;
}

/**
 * Crea una dirección de envío reutilizable (tabla addresses).
 * Obligatorios: departamento, provincia, distrito, direccion. Ubigeo opcional.
 */
async function crearDireccionEnvio(companyRuc, body = {}) {
  const fields = await parseDireccionEnvioFields(body);
  const etiqueta = String(body.etiqueta || '').trim()
    || `${fields.distrito} · ${fields.direccion}`.slice(0, 120)
    || `Envío · ${fields.distrito}`;

  const id = randomUUID();
  const row = await prisma.address.create({
    data: {
      id,
      companyRuc,
      etiqueta,
      ...fields,
      codLocal: '0000',
    },
  });

  return {
    id: row.id,
    company_ruc: companyRuc,
    etiqueta: row.etiqueta,
    address: toAddressApi(row),
  };
}

/**
 * Actualiza una dirección de envío existente (misma validación suave que crear).
 */
async function actualizarDireccionEnvio(companyRuc, id, body = {}) {
  const addressId = String(id || '').trim();
  if (!addressId) {
    const err = new Error('Dirección inválida.');
    err.status = 400;
    throw err;
  }

  const existing = await prisma.address.findFirst({
    where: { id: addressId, companyRuc },
  });
  if (!existing) {
    const err = new Error('Dirección de envío no encontrada.');
    err.status = 404;
    throw err;
  }

  const fields = await parseDireccionEnvioFields(body);
  const etiqueta = String(body.etiqueta || '').trim()
    || `${fields.distrito} · ${fields.direccion}`.slice(0, 120)
    || existing.etiqueta
    || `Envío · ${fields.distrito}`;

  const row = await prisma.address.update({
    where: { id: addressId },
    data: {
      etiqueta,
      ...fields,
      creadoEn: new Date(),
    },
  });

  return {
    id: row.id,
    company_ruc: companyRuc,
    etiqueta: row.etiqueta,
    address: toAddressApi(row),
  };
}

/** Borra una ubicación de catálogo (picker). No afecta snapshots JSON de entidades. */
async function eliminarDireccionEnvio(companyRuc, id) {
  const addressId = String(id || '').trim();
  if (!addressId) {
    const err = new Error('Dirección inválida.');
    err.status = 400;
    throw err;
  }

  const existing = await prisma.address.findFirst({
    where: { id: addressId, companyRuc },
  });
  if (!existing) {
    const err = new Error('Ubicación no encontrada.');
    err.status = 404;
    throw err;
  }

  await prisma.address.delete({ where: { id: addressId } });
  return { ok: true, id: addressId };
}

async function parseDireccionEnvioFields(body = {}) {
  const ubigeoModel = require('./ubigeoModel');
  const raw = body.address_envio || body.addressEnvio || body.address || body;
  let departamento = String(raw.departamento || '').trim();
  let provincia = String(raw.provincia || '').trim();
  let distrito = String(raw.distrito || '').trim();
  const direccion = String(raw.direccion || raw.linea || '').trim();
  const urbanizacion = String(raw.urbanizacion || '').trim() || null;
  let ubigeo = String(raw.ubigeo || '').trim() || null;

  if (ubigeo && (!departamento || !provincia || !distrito)) {
    try {
      const cat = await ubigeoModel.findDistritoByUbigeo(ubigeo);
      if (cat) {
        departamento = departamento || cat.departamento;
        provincia = provincia || cat.provincia;
        distrito = distrito || cat.distrito;
        ubigeo = cat.ubigeo;
      }
    } catch (_) {
      /* ubigeo inválido: se valida abajo con nombres */
    }
  }

  if (!departamento || !provincia || !distrito || !direccion) {
    const err = new Error('Completa región, provincia, distrito y dirección (mz, lote, etc.).');
    err.status = 400;
    throw err;
  }

  return {
    ubigeo,
    departamento,
    provincia,
    distrito,
    urbanizacion,
    direccion,
  };
}

/** Marca una ubicación como usada recientemente (bump creadoEn). */
async function tocarDireccionEnvio(companyRuc, id) {
  const addressId = String(id || '').trim();
  if (!addressId) {
    const err = new Error('Dirección inválida.');
    err.status = 400;
    throw err;
  }
  const existing = await prisma.address.findFirst({
    where: { id: addressId, companyRuc },
  });
  if (!existing) {
    const err = new Error('Ubicación no encontrada.');
    err.status = 404;
    throw err;
  }
  const row = await prisma.address.update({
    where: { id: addressId },
    data: { creadoEn: new Date() },
  });
  return {
    id: row.id,
    company_ruc: companyRuc,
    etiqueta: row.etiqueta,
    address: toAddressApi(row),
  };
}

module.exports = {
  ESTADOS,
  toApi,
  findByCompanyPaginated,
  findById,
  countNoVistas,
  marcarVista,
  marcarTodasVistas,
  create,
  update,
  anular,
  destroy,
  listDireccionesEnvioRecientes,
  listDireccionesEnvioCatalogo,
  crearDireccionEnvio,
  actualizarDireccionEnvio,
  eliminarDireccionEnvio,
  tocarDireccionEnvio,
};
