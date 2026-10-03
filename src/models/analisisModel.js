const prisma = require('../config/prisma');

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
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

function addDaysYmd(ymd, days) {
  const [y, m, d] = String(ymd).split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

function startOfMonth(ymd) {
  return `${String(ymd).slice(0, 7)}-01`;
}

function resolvePeriodo(query = {}) {
  const hoy = limaHoyYmd();
  const periodo = String(query.periodo || '30d').trim();
  let desde = String(query.desde || '').trim().slice(0, 10);
  let hasta = String(query.hasta || '').trim().slice(0, 10);

  if (periodo === 'hoy') {
    desde = hoy;
    hasta = hoy;
  } else if (periodo === '7d') {
    desde = addDaysYmd(hoy, -6);
    hasta = hoy;
  } else if (periodo === '30d') {
    desde = addDaysYmd(hoy, -29);
    hasta = hoy;
  } else if (periodo === 'mes') {
    desde = startOfMonth(hoy);
    hasta = hoy;
  } else if (periodo === 'mes_ant') {
    const prev = addDaysYmd(startOfMonth(hoy), -1);
    desde = startOfMonth(prev);
    hasta = prev;
  } else if (periodo === 'trimestre') {
    desde = addDaysYmd(hoy, -89);
    hasta = hoy;
  } else if (periodo === 'anio') {
    desde = `${hoy.slice(0, 4)}-01-01`;
    hasta = hoy;
  } else if (periodo === 'custom') {
    if (!desde) desde = addDaysYmd(hoy, -29);
    if (!hasta) hasta = hoy;
  } else {
    desde = addDaysYmd(hoy, -29);
    hasta = hoy;
  }

  if (desde > hasta) {
    const t = desde;
    desde = hasta;
    hasta = t;
  }
  return { periodo, desde, hasta };
}

/**
 * Agrega líneas sale_detail (ya cargadas) a KPIs / charts / ranking.
 * Pura: útil para pruebas unitarias sin DB.
 */
function buildResumenFromDetails(details, filters = {}, rango = null) {
  const resolved = rango || resolvePeriodo(filters);
  const { periodo, desde, hasta } = resolved;
  const tipoDoc = String(filters.tipo || filters.tipo_doc || '').trim();
  const q = String(filters.q || '').trim().toLowerCase();
  const orden = String(filters.orden || 'unidades').trim();
  const top = Math.min(100, Math.max(1, Number(filters.top) || 20));
  const soloConCosto = String(filters.solo_costo || '1') !== '0';

  const byProduct = new Map();
  const byDay = new Map();

  for (const d of details || []) {
    const item = d.catalogItem;
    if (!item) continue;
    const nombre = item.nombre || d.nombre || 'Producto';
    if (q && !nombre.toLowerCase().includes(q) && !String(item.codigo || '').toLowerCase().includes(q)) {
      continue;
    }
    const costoUnit = d.precioCompra != null
      ? toNum(d.precioCompra)
      : (item.precioCompra != null ? toNum(item.precioCompra) : null);
    if (soloConCosto && costoUnit == null) continue;

    const qty = toNum(d.cantidad);
    const venta = d.totalFactura != null
      ? toNum(d.totalFactura)
      : toNum(d.mtoPrecioUnitario) * qty;
    const costo = costoUnit != null ? costoUnit * qty : null;
    const margen = costo != null ? venta - costo : null;

    if (!byProduct.has(item.id)) {
      byProduct.set(item.id, {
        id: item.id,
        nombre,
        codigo: item.codigo || '',
        unidad: item.unidad || '',
        kind: item.kind || 'PRODUCT',
        unidades: 0,
        venta: 0,
        costo: 0,
        margen: 0,
        tiene_costo: false,
        lineas: 0,
      });
    }
    const g = byProduct.get(item.id);
    g.unidades += qty;
    g.venta += venta;
    g.lineas += 1;
    if (costo != null) {
      g.costo += costo;
      g.margen += margen;
      g.tiene_costo = true;
    }

    const dia = String(d.invoice?.fechaEmision || '').slice(0, 10);
    if (dia) {
      if (!byDay.has(dia)) byDay.set(dia, { fecha: dia, venta: 0, costo: 0, margen: 0, unidades: 0 });
      const day = byDay.get(dia);
      day.venta += venta;
      day.unidades += qty;
      if (costo != null) {
        day.costo += costo;
        day.margen += margen;
      }
    }
  }

  let productos = [...byProduct.values()].map((p) => {
    const margenPct = p.venta > 0 && p.tiene_costo ? (p.margen / p.venta) * 100 : null;
    return {
      ...p,
      unidades: Math.round(p.unidades * 10000) / 10000,
      venta: Math.round(p.venta * 100) / 100,
      costo: Math.round(p.costo * 100) / 100,
      margen: Math.round(p.margen * 100) / 100,
      margen_pct: margenPct != null ? Math.round(margenPct * 10) / 10 : null,
    };
  });

  const sorters = {
    unidades: (a, b) => b.unidades - a.unidades,
    venta: (a, b) => b.venta - a.venta,
    margen: (a, b) => b.margen - a.margen,
    margen_pct: (a, b) => (b.margen_pct || -999) - (a.margen_pct || -999),
    peor_margen: (a, b) => (a.margen_pct ?? 999) - (b.margen_pct ?? 999),
    nombre: (a, b) => String(a.nombre).localeCompare(String(b.nombre), 'es'),
  };
  productos.sort(sorters[orden] || sorters.unidades);

  const kpis = productos.reduce((acc, p) => {
    acc.unidades += p.unidades;
    acc.venta += p.venta;
    acc.costo += p.costo;
    acc.margen += p.margen;
    if (p.tiene_costo) acc.con_costo += 1;
    return acc;
  }, { unidades: 0, venta: 0, costo: 0, margen: 0, con_costo: 0, productos: 0 });
  kpis.productos = productos.length;
  kpis.margen_pct = kpis.venta > 0 ? Math.round((kpis.margen / kpis.venta) * 1000) / 10 : 0;
  kpis.unidades = Math.round(kpis.unidades * 10000) / 10000;
  kpis.venta = Math.round(kpis.venta * 100) / 100;
  kpis.costo = Math.round(kpis.costo * 100) / 100;
  kpis.margen = Math.round(kpis.margen * 100) / 100;

  const serie = [];
  for (let d = desde; d <= hasta; d = addDaysYmd(d, 1)) {
    const row = byDay.get(d) || { fecha: d, venta: 0, costo: 0, margen: 0, unidades: 0 };
    serie.push({
      fecha: d,
      venta: Math.round(row.venta * 100) / 100,
      costo: Math.round(row.costo * 100) / 100,
      margen: Math.round(row.margen * 100) / 100,
      unidades: Math.round(row.unidades * 10000) / 10000,
    });
  }

  const topList = productos.slice(0, top);
  // Gráficos siempre sobre el mismo Top N del filtro (no todo el catálogo).
  const chartRows = topList;

  return {
    filtros: {
      periodo,
      desde,
      hasta,
      tipo: tipoDoc || '',
      q: filters.q || '',
      orden,
      top,
      solo_costo: soloConCosto ? '1' : '0',
    },
    kpis,
    productos: topList,
    total_productos: productos.length,
    charts: {
      top_n: chartRows,
      top_unidades: [...chartRows].sort((a, b) => b.unidades - a.unidades),
      top_margen: [...chartRows].filter((p) => p.tiene_costo).sort((a, b) => b.margen - a.margen),
      top_venta: [...chartRows].sort((a, b) => b.venta - a.venta),
      serie,
      mix: {
        venta: kpis.venta,
        costo: kpis.costo,
        margen: kpis.margen,
      },
    },
  };
}

/**
 * Análisis de ventas / margen por producto (facturas y boletas aceptadas).
 * Usa precio_compra de la línea; si falta, cae al del catálogo.
 */
async function resumenProductos(companyRuc, filters = {}) {
  const { periodo, desde, hasta } = resolvePeriodo(filters);
  const tipoDoc = String(filters.tipo || filters.tipo_doc || '').trim();

  const tipoFilter = tipoDoc === '01' || tipoDoc === '03'
    ? { tipoDoc }
    : { tipoDoc: { in: ['01', '03'] } };

  const details = await prisma.saleDetail.findMany({
    where: {
      catalogItemId: { not: null },
      estado: 'ACTIVO',
      invoice: {
        companyRuc,
        estado: { in: ['ACEPTADO', 'ENVIADO'] },
        fechaEmision: { gte: desde, lte: hasta },
        ...tipoFilter,
      },
    },
    select: {
      catalogItemId: true,
      nombre: true,
      cantidad: true,
      mtoPrecioUnitario: true,
      totalFactura: true,
      precioCompra: true,
      invoice: { select: { fechaEmision: true, tipoDoc: true } },
      catalogItem: {
        select: {
          id: true,
          nombre: true,
          codigo: true,
          unidad: true,
          kind: true,
          precioCompra: true,
          precioUnitario: true,
        },
      },
    },
  });

  return buildResumenFromDetails(details, filters, { periodo, desde, hasta });
}

module.exports = {
  resolvePeriodo,
  buildResumenFromDetails,
  resumenProductos,
};
