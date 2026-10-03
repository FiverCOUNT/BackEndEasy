const { randomUUID } = require('crypto');
const prisma = require('../config/prisma');

function toApi(row) {
  if (!row) return null;
  const dias = row.diasNotificacion != null ? Number(row.diasNotificacion) : null;
  return {
    id: row.id,
    nombre: row.nombre,
    fecha_vencimiento: row.fechaVencimiento || null,
    dias_notificacion: Number.isFinite(dias) && dias > 0 ? dias : null,
  };
}

function normalizarFilas(nombres, fechas, diasNotifs) {
  const nums = [].concat(nombres || []);
  const fecs = [].concat(fechas || []);
  const diasArr = [].concat(diasNotifs || []);
  const n = Math.max(nums.length, fecs.length, diasArr.length);
  const filas = [];
  const vistos = new Set();
  for (let i = 0; i < n; i += 1) {
    const nombre = String(nums[i] || '').trim().slice(0, 64);
    const fechaRaw = String(fecs[i] || '').trim().slice(0, 10);
    const diasRaw = String(diasArr[i] || '').trim();
    if (!nombre && !fechaRaw && !diasRaw) continue;
    if (!nombre) return { error: 'El nombre del lote es obligatorio.' };
    const key = nombre.toLowerCase();
    if (vistos.has(key)) return { error: `El lote ${nombre} está repetido.` };
    vistos.add(key);
    const fecha = /^\d{4}-\d{2}-\d{2}$/.test(fechaRaw) ? fechaRaw : '';
    if (fechaRaw && !fecha) return { error: `La fecha de ${nombre} no es válida.` };
    let diasNotificacion = null;
    if (diasRaw) {
      const d = Number(diasRaw);
      if (!Number.isFinite(d) || d < 1 || d > 3650 || !Number.isInteger(d)) {
        return { error: `Los días de notificación de ${nombre} no son válidos.` };
      }
      diasNotificacion = d;
    }
    filas.push({ nombre, fecha: fecha || null, diasNotificacion });
  }
  return { filas };
}

async function listByCompany(companyRuc, { recientes = false } = {}) {
  const rows = await prisma.productoLote.findMany({
    where: { companyRuc },
    orderBy: recientes
      ? [{ creadoEn: 'desc' }, { nombre: 'asc' }]
      : [{ nombre: 'asc' }],
  });
  return rows.map(toApi);
}

/** Lotes que ya se usaron con este producto (entradas / salidas). */
async function listByCatalogItem(companyRuc, catalogItemId) {
  const itemId = String(catalogItemId || '').trim();
  if (!companyRuc || !itemId) return [];

  const item = await prisma.catalogItem.findFirst({
    where: { id: itemId, companyRuc },
    select: { unidad: true },
  });
  if (!item) return [];
  const unidadItem = etiquetaUnidad(item.unidad);

  const lineas = await prisma.lineaCatalogoItem.findMany({
    where: {
      catalogItemId: itemId,
      productoLoteId: { not: null },
      movimiento: { companyRuc, estado: { not: 'ANULADA' } },
    },
    select: {
      cantidad: true,
      productoLoteId: true,
      productoSerieId: true,
      movimiento: { select: { tipo: true, referenciaTipo: true } },
      productoSerie: { select: { id: true, estado: true } },
      productoLote: {
        select: {
          id: true,
          nombre: true,
          fechaVencimiento: true,
          diasNotificacion: true,
          creadoEn: true,
        },
      },
    },
  });

  const porLote = new Map();
  for (const linea of lineas) {
    const lote = linea.productoLote;
    if (!lote?.id) continue;
    if (!porLote.has(lote.id)) {
      porLote.set(lote.id, {
        id: lote.id,
        nombre: lote.nombre,
        fecha_vencimiento: lote.fechaVencimiento || null,
        dias_notificacion: lote.diasNotificacion != null ? Number(lote.diasNotificacion) : null,
        creadoEn: lote.creadoEn,
        cantidad: 0,
        series: new Set(),
      });
    }
    const g = porLote.get(lote.id);
    if (linea.productoSerieId && linea.productoSerie) {
      const estado = linea.productoSerie.estado;
      if (estado === 'DISPONIBLE' || estado === 'RESERVADO') {
        g.series.add(linea.productoSerie.id);
      }
      continue;
    }
    const traslado = linea.movimiento?.referenciaTipo === 'TRASLADO';
    const salida = linea.movimiento?.tipo === 'SALIDA' && !traslado;
    g.cantidad += (salida ? -1 : 1) * Number(linea.cantidad || 0);
  }

  return [...porLote.values()]
    .map((g) => {
      const series = g.series.size;
      const esSerie = series > 0;
      const qty = esSerie ? series : Math.max(0, g.cantidad);
      return {
        id: g.id,
        nombre: g.nombre,
        fecha_vencimiento: g.fecha_vencimiento,
        dias_notificacion: Number.isFinite(g.dias_notificacion) && g.dias_notificacion > 0
          ? g.dias_notificacion
          : null,
        cantidad: cantidadVisible(qty),
        unidad: esSerie ? 'und' : unidadItem,
        tipo: esSerie ? 'serie' : 'cantidad',
        creadoEn: g.creadoEn,
      };
    })
    .filter((g) => Number(g.cantidad) > 0)
    .sort((a, b) => {
      const ta = a.creadoEn ? new Date(a.creadoEn).getTime() : 0;
      const tb = b.creadoEn ? new Date(b.creadoEn).getTime() : 0;
      return tb - ta || String(a.nombre).localeCompare(String(b.nombre), 'es');
    });
}

async function guardarFilas({ companyRuc, nombres, fechas, diasNotificacion }) {
  const parsed = normalizarFilas(nombres, fechas, diasNotificacion);
  if (parsed.error) return parsed;
  for (const fila of parsed.filas) {
    const found = await prisma.productoLote.findUnique({
      where: {
        companyRuc_nombre: { companyRuc, nombre: fila.nombre },
      },
    });
    if (found) {
      const data = {};
      if (fila.fecha && found.fechaVencimiento !== fila.fecha) {
        data.fechaVencimiento = fila.fecha;
      }
      if (fila.diasNotificacion != null && found.diasNotificacion !== fila.diasNotificacion) {
        data.diasNotificacion = fila.diasNotificacion;
      }
      if (Object.keys(data).length) {
        await prisma.productoLote.update({
          where: { id: found.id },
          data,
        });
      }
    } else {
      await prisma.productoLote.create({
        data: {
          id: randomUUID(),
          companyRuc,
          nombre: fila.nombre,
          fechaVencimiento: fila.fecha,
          diasNotificacion: fila.diasNotificacion,
        },
      });
    }
  }
  return { ok: true, total: parsed.filas.length };
}

function etiquetaUnidad(unidad) {
  const u = String(unidad || 'NIU').toUpperCase();
  if (u === 'NIU') return 'und';
  if (u === 'MTR') return 'm';
  if (u === 'KGM') return 'kg';
  if (u === 'LTR') return 'L';
  return u.toLowerCase();
}

function cantidadVisible(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '0';
  const rounded = Math.round(n * 10000) / 10000;
  return String(rounded);
}

async function productosDelLote(companyRuc, loteId, { almacenId = null, catalogItemId = null } = {}) {
  const lote = await prisma.productoLote.findFirst({
    where: { id: String(loteId || ''), companyRuc },
    select: { id: true, nombre: true },
  });
  if (!lote) return null;
  const soloAlmacen = String(almacenId || '').trim();
  const soloProducto = String(catalogItemId || '').trim();

  const lineas = await prisma.lineaCatalogoItem.findMany({
    where: {
      productoLoteId: lote.id,
      ...(soloProducto ? { catalogItemId: soloProducto } : {}),
      movimiento: { companyRuc, estado: { not: 'ANULADA' } },
    },
    select: {
      cantidad: true,
      catalogItemId: true,
      nombre: true,
      unidad: true,
      almacenId: true,
      productoSerieId: true,
      movimiento: { select: { tipo: true, referenciaTipo: true } },
      productoSerie: {
        select: {
          id: true,
          numeroSerie: true,
          estado: true,
          almacenId: true,
          almacen: { select: { id: true, nombre: true } },
        },
      },
      catalogItem: { select: { nombre: true, unidad: true } },
    },
  });

  const porItem = new Map();
  for (const linea of lineas) {
    const id = linea.catalogItemId;
    if (!id) continue;
    if (!porItem.has(id)) {
      porItem.set(id, {
        id,
        nombre: linea.catalogItem?.nombre || linea.nombre || 'Producto',
        unidad: etiquetaUnidad(linea.catalogItem?.unidad || linea.unidad),
        cantidad: 0,
        series: new Map(),
      });
    }
    const grupo = porItem.get(id);
    if (linea.productoSerieId && linea.productoSerie) {
      const estado = linea.productoSerie.estado;
      const almSerie = linea.productoSerie.almacen?.id || linea.productoSerie.almacenId || '';
      if (soloAlmacen && almSerie !== soloAlmacen) continue;
      if (estado === 'DISPONIBLE' || estado === 'RESERVADO') {
        grupo.series.set(linea.productoSerie.id, {
          numero_serie: linea.productoSerie.numeroSerie,
          estado: estado === 'DISPONIBLE' ? 'Disponible' : 'Reservado',
          almacen_nombre: linea.productoSerie.almacen?.nombre || '',
        });
      }
      continue;
    }
    if (soloAlmacen && String(linea.almacenId || '') !== soloAlmacen) continue;
    const traslado = linea.movimiento?.referenciaTipo === 'TRASLADO';
    const salida = linea.movimiento?.tipo === 'SALIDA' && !traslado;
    const signo = salida ? -1 : 1;
    grupo.cantidad += signo * Number(linea.cantidad || 0);
  }

  const items = [];
  for (const grupo of porItem.values()) {
    const series = [...grupo.series.values()].sort((a, b) => (
      String(a.numero_serie).localeCompare(String(b.numero_serie), 'es')
    ));
    if (series.length) {
      items.push({
        id: grupo.id,
        nombre: grupo.nombre,
        tipo: 'serie',
        cantidad: series.length,
        unidad: 'und',
        series,
      });
    }
    if (grupo.cantidad > 0.0001) {
      items.push({
        id: grupo.id,
        nombre: grupo.nombre,
        tipo: 'cantidad',
        cantidad: cantidadVisible(grupo.cantidad),
        unidad: grupo.unidad,
        series: [],
      });
    }
  }
  items.sort((a, b) => String(a.nombre).localeCompare(String(b.nombre), 'es'));
  return { lote: { id: lote.id, nombre: lote.nombre }, items };
}

function limaHoyYmd() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Lima',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const get = (t) => parts.find((p) => p.type === t)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function diasHastaYmd(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || '').slice(0, 10));
  if (!m) return null;
  const vence = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const hoyParts = limaHoyYmd().split('-');
  const hoy = Date.UTC(Number(hoyParts[0]), Number(hoyParts[1]) - 1, Number(hoyParts[2]));
  return Math.floor((vence - hoy) / 86400000);
}

/** Mapa catalogItemId → aviso de vencimiento cercano (con stock del lote).
 *  Si `catalogItemIds` es null/undefined, evalúa todos los ítems de la empresa.
 */
async function alertasVencimientoPorItems(companyRuc, catalogItemIds) {
  const out = new Map();
  if (!companyRuc) return out;
  const filtrarIds = Array.isArray(catalogItemIds);
  const ids = filtrarIds
    ? [...new Set(catalogItemIds.map((id) => String(id || '').trim()).filter(Boolean))]
    : null;
  if (filtrarIds && !ids.length) return out;

  const where = {
    productoLoteId: { not: null },
    movimiento: { companyRuc, estado: { not: 'ANULADA' } },
    productoLote: { fechaVencimiento: { not: null } },
  };
  if (ids) where.catalogItemId = { in: ids };

  const lineas = await prisma.lineaCatalogoItem.findMany({
    where,
    select: {
      cantidad: true,
      catalogItemId: true,
      productoSerieId: true,
      movimiento: { select: { tipo: true, referenciaTipo: true } },
      productoSerie: { select: { id: true, estado: true } },
      productoLote: {
        select: {
          id: true,
          nombre: true,
          fechaVencimiento: true,
          diasNotificacion: true,
        },
      },
    },
  });

  const stockPorClave = new Map();
  for (const linea of lineas) {
    const lote = linea.productoLote;
    const itemId = linea.catalogItemId;
    if (!lote?.id || !itemId || !lote.fechaVencimiento) continue;
    const key = `${itemId}|${lote.id}`;
    if (!stockPorClave.has(key)) {
      stockPorClave.set(key, {
        itemId,
        loteNombre: lote.nombre,
        fecha: String(lote.fechaVencimiento).slice(0, 10),
        diasAviso: Number(lote.diasNotificacion) > 0 ? Number(lote.diasNotificacion) : 60,
        cantidad: 0,
        series: new Set(),
      });
    }
    const g = stockPorClave.get(key);
    if (linea.productoSerieId && linea.productoSerie) {
      const estado = linea.productoSerie.estado;
      if (estado === 'DISPONIBLE' || estado === 'RESERVADO') g.series.add(linea.productoSerie.id);
      continue;
    }
    const traslado = linea.movimiento?.referenciaTipo === 'TRASLADO';
    const salida = linea.movimiento?.tipo === 'SALIDA' && !traslado;
    g.cantidad += (salida ? -1 : 1) * Number(linea.cantidad || 0);
  }

  for (const g of stockPorClave.values()) {
    const stock = g.series.size > 0 ? g.series.size : g.cantidad;
    if (stock <= 0.0001) continue;
    const dias = diasHastaYmd(g.fecha);
    if (dias == null || dias > g.diasAviso) continue;
    const prev = out.get(g.itemId);
    const urgencia = dias;
    if (prev && prev.dias < urgencia) continue;
    const meses = [
      'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
      'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
    ];
    const p = g.fecha.split('-');
    const fechaTxt = `${Number(p[2])} de ${meses[Number(p[1]) - 1]} ${p[0]}`;
    out.set(g.itemId, {
      dias,
      vencido: dias < 0,
      label: dias < 0 ? 'Vencido' : (dias === 0 ? 'Vence hoy' : 'Por vencer'),
      detalle: `Vence ${fechaTxt}`,
      lote: g.loteNombre,
    });
  }
  return out;
}

/** Cantidad de productos del catálogo con lote por vencer / vencido (stock > 0). */
async function countAlertasVencimiento(companyRuc) {
  const map = await alertasVencimientoPorItems(companyRuc);
  return map.size;
}

module.exports = {
  toApi,
  normalizarFilas,
  listByCompany,
  listByCatalogItem,
  guardarFilas,
  productosDelLote,
  alertasVencimientoPorItems,
  countAlertasVencimiento,
};
