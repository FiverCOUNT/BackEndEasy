/**
 * Seed demo para Análisis (Raymi / beta):
 * - 10 productos nuevos (NIU, MTR, KGM, LTR)
 * - Ingreso de stock de productos existentes + nuevos
 * - Facturas y boletas ACEPTADAS con esas unidades (margen visible)
 *
 * Uso (en servidor o local con .env):
 *   node scripts/seed-analisis-raymi.js
 */
require('../src/config/env');
const { randomUUID } = require('crypto');
const { runWithEntorno, disconnectPrisma } = require('../src/config/prisma');
const prisma = require('../src/config/prisma');
const movimientoModel = require('../src/models/movimientoModel');
const comprobanteModel = require('../src/models/comprobanteModel');

const EMAIL = 'mili@gmail.com';
const RUC = '20611016591';

const NUEVOS = [
  { nombre: 'Cable drop FTTH', unidad: 'MTR', venta: 2.8, compra: 1.2, qty: 800 },
  { nombre: 'Manguera PVC 1/2', unidad: 'MTR', venta: 6.5, compra: 3.1, qty: 300 },
  { nombre: 'Alambre galvanizado', unidad: 'MTR', venta: 1.9, compra: 0.85, qty: 1000 },
  { nombre: 'Cemento tipo I', unidad: 'KGM', venta: 0.75, compra: 0.42, qty: 2000 },
  { nombre: 'Arena fina', unidad: 'KGM', venta: 0.18, compra: 0.08, qty: 5000 },
  { nombre: 'Clavos 2 pulg', unidad: 'KGM', venta: 8.5, compra: 4.2, qty: 120 },
  { nombre: 'Aceite 15W40', unidad: 'LTR', venta: 28, compra: 16, qty: 80 },
  { nombre: 'Thinner acrílico', unidad: 'LTR', venta: 18, compra: 9.5, qty: 60 },
  { nombre: 'Desinfectante industrial', unidad: 'LTR', venta: 12, compra: 5.5, qty: 100 },
  { nombre: 'Caja empalme plástica', unidad: 'NIU', venta: 45, compra: 22, qty: 40 },
];

function hoyYmd() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Lima',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function addDaysYmd(ymd, days) {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

async function nextCorrelativo(companyRuc, tipoDoc, serie) {
  const last = await prisma.invoice.findFirst({
    where: { companyRuc, tipoDoc, serie },
    orderBy: { correlativo: 'desc' },
    select: { correlativo: true },
  });
  const n = Number(String(last?.correlativo || '0').replace(/\D/g, '')) || 0;
  return String(n + 1).padStart(8, '0');
}

async function ensureCliente(companyRuc, { tipoDoc, numeroDoc, razonSocial }) {
  const existing = await prisma.cliente.findFirst({
    where: { companyRuc, tipoDoc, numeroDoc },
  });
  if (existing) return existing;
  return prisma.cliente.create({
    data: {
      id: randomUUID(),
      companyRuc,
      tipoDoc,
      numeroDoc,
      razonSocial,
    },
  });
}

async function ensureNuevosProductos(companyRuc) {
  const created = [];
  for (let i = 0; i < NUEVOS.length; i += 1) {
    const p = NUEVOS[i];
    const found = await prisma.catalogItem.findFirst({
      where: { companyRuc, nombre: p.nombre, kind: 'PRODUCT' },
    });
    if (found) {
      const upd = await prisma.catalogItem.update({
        where: { id: found.id },
        data: {
          unidad: p.unidad,
          precioUnitario: p.venta,
          precioCompra: p.compra,
          activo: true,
          manejaStock: true,
          manejaSerie: false,
        },
      });
      created.push({ ...upd, seedQty: p.qty });
      continue;
    }
    const row = await prisma.catalogItem.create({
      data: {
        id: randomUUID(),
        companyRuc,
        kind: 'PRODUCT',
        codigo: `AN-${p.unidad}-${String(i + 1).padStart(2, '0')}`,
        nombre: p.nombre,
        descripcion: `Seed análisis · ${p.unidad}`,
        unidad: p.unidad,
        precioUnitario: p.venta,
        precioCompra: p.compra,
        afectacionIgv: '10',
        activo: true,
        manejaStock: true,
        manejaSerie: false,
        manejaLote: false,
        manejaVencimiento: false,
      },
    });
    created.push({ ...row, seedQty: p.qty });
  }
  return created;
}

async function backfillPrecioCompraExistentes(companyRuc) {
  const items = await prisma.catalogItem.findMany({
    where: {
      companyRuc,
      kind: 'PRODUCT',
      activo: true,
      OR: [{ precioCompra: null }, { precioCompra: 0 }],
    },
  });
  let n = 0;
  for (const it of items) {
    const venta = Number(it.precioUnitario) || 10;
    const compra = Math.round(venta * 0.55 * 100) / 100;
    await prisma.catalogItem.update({
      where: { id: it.id },
      data: { precioCompra: compra },
    });
    n += 1;
  }
  return n;
}

async function ingresar(companyRuc, almacenId, usuarioId, productos) {
  const lineas = productos.map((p) => ({
    catalog_item_id: p.id,
    cantidad: p.seedQty || 50,
  }));
  if (!lineas.length) return null;
  const result = await movimientoModel.registrarEntrada({
    companyRuc,
    almacenId,
    lineas,
    observaciones: `Seed análisis · ${lineas.length} productos`,
    usuarioId,
  });
  if (result.error) throw new Error(`Ingreso falló: ${result.error} ${result.message || ''}`);
  return result.movimiento;
}

async function crearVentaAceptada({
  companyRuc,
  tipoDoc,
  serie,
  cliente,
  almacenId,
  lineas,
  fechaEmision,
}) {
  const correlativo = await nextCorrelativo(companyRuc, tipoDoc, serie);
  const catalogMap = new Map();
  for (const ln of lineas) {
    const item = await prisma.catalogItem.findFirst({ where: { id: ln.catalog_item_id, companyRuc } });
    if (!item) throw new Error(`Producto no encontrado ${ln.catalog_item_id}`);
    catalogMap.set(item.id, item);
  }

  const details = lineas.map((ln) => {
    const item = catalogMap.get(ln.catalog_item_id);
    const calc = comprobanteModel.calcularLinea(item, ln.cantidad, ln.precio_unitario);
    return {
      id: randomUUID(),
      catalogItemId: item.id,
      codigo: item.codigo || null,
      nombre: calc.nombre,
      descripcion: calc.descripcion,
      cantidad: calc.cantidad,
      unidad: item.unidad || 'NIU',
      mtoPrecioUnitario: calc.mtoPrecioUnitario,
      tipAfeIgv: calc.tipAfeIgv,
      mtoValorUnitario: calc.mtoValorUnitario,
      mtoValorVenta: calc.mtoValorVenta,
      mtoBaseIgv: calc.mtoBaseIgv,
      mtoIgv: calc.mtoIgv,
      porcentajeIgv: calc.porcentajeIgv,
      totalFactura: calc.totalFactura,
      precioCompra: calc.precioCompra,
      almacenId,
      estado: 'ACTIVO',
    };
  });

  const mtoIgv = details.reduce((s, d) => s + Number(d.mtoIgv || 0), 0);
  const gravadas = details.reduce((s, d) => s + Number(d.mtoValorVenta || 0), 0);
  const total = details.reduce((s, d) => s + Number(d.totalFactura || 0), 0);

  const inv = await prisma.invoice.create({
    data: {
      id: randomUUID(),
      companyRuc,
      tipoDoc,
      serie,
      correlativo,
      fechaEmision,
      tipoMoneda: 'PEN',
      estado: 'ACEPTADO',
      clienteId: cliente.id,
      almacenId,
      mtoOperGravadas: Math.round(gravadas * 10000) / 10000,
      mtoIgv: Math.round(mtoIgv * 10000) / 10000,
      totalImpuestos: Math.round(mtoIgv * 10000) / 10000,
      subTotal: Math.round(gravadas * 10000) / 10000,
      mtoImpVenta: Math.round(total * 10000) / 10000,
      sunatEstadoDirecto: 'ACEPTADO',
      sunatDescripcionDirecto: 'Seed análisis (demo)',
      details: { create: details },
    },
    include: { details: true },
  });
  return inv;
}

async function main() {
  await runWithEntorno('beta', async () => {
    const user = await prisma.usuario.findFirst({
      where: { email: { contains: 'mili@gmail.com' } },
      include: { company: true },
    });
    if (!user) throw new Error('Usuario mili@gmail.com no encontrado en beta');
    const companyRuc = user.companyRuc || user.company?.ruc || RUC;
    console.log(`Empresa ${companyRuc} · user ${user.email} · entorno beta`);

    const almacen = await prisma.almacen.findFirst({
      where: { companyRuc, activo: true },
      orderBy: { nombre: 'asc' },
    });
    if (!almacen) throw new Error('Sin almacén activo');

    const backfilled = await backfillPrecioCompraExistentes(companyRuc);
    console.log(`Precio compra backfill catálogo: ${backfilled}`);

    const nuevos = await ensureNuevosProductos(companyRuc);
    console.log(`Productos seed: ${nuevos.length} (${nuevos.map((p) => p.unidad).join(', ')})`);

    // Productos existentes sin serie (para ingreso + venta)
    const existentes = await prisma.catalogItem.findMany({
      where: {
        companyRuc,
        kind: 'PRODUCT',
        activo: true,
        manejaSerie: false,
        id: { notIn: nuevos.map((p) => p.id) },
      },
      take: 30,
      orderBy: { nombre: 'asc' },
    });
    const paraIngreso = [
      ...nuevos,
      ...existentes.map((p) => ({ ...p, seedQty: 40 })),
    ];

    const mov = await ingresar(companyRuc, almacen.id, user.id, paraIngreso);
    console.log(`Ingreso OK → ${mov?.numero || mov?.id} · ${paraIngreso.length} líneas`);

    const clienteFact = await ensureCliente(companyRuc, {
      tipoDoc: '6',
      numeroDoc: '20547854268',
      razonSocial: 'CLIENTE DEMO ANALISIS SAC',
    });
    const clienteBol = await ensureCliente(companyRuc, {
      tipoDoc: '1',
      numeroDoc: '45678901',
      razonSocial: 'JUAN PEREZ DEMO',
    });

    const hoy = hoyYmd();
    const porUnidad = {
      MTR: nuevos.filter((p) => p.unidad === 'MTR'),
      LTR: nuevos.filter((p) => p.unidad === 'LTR'),
      KGM: nuevos.filter((p) => p.unidad === 'KGM'),
      NIU: nuevos.filter((p) => p.unidad === 'NIU'),
    };

    const docs = [];

    // Factura con MTR + KGM
    docs.push(await crearVentaAceptada({
      companyRuc,
      tipoDoc: '01',
      serie: 'F001',
      cliente: clienteFact,
      almacenId: almacen.id,
      fechaEmision: hoy,
      lineas: [
        { catalog_item_id: porUnidad.MTR[0].id, cantidad: 120 },
        { catalog_item_id: porUnidad.KGM[0].id, cantidad: 50 },
        { catalog_item_id: porUnidad.NIU[0].id, cantidad: 3 },
      ],
    }));

    // Factura con LTR
    docs.push(await crearVentaAceptada({
      companyRuc,
      tipoDoc: '01',
      serie: 'F001',
      cliente: clienteFact,
      almacenId: almacen.id,
      fechaEmision: addDaysYmd(hoy, -2),
      lineas: [
        { catalog_item_id: porUnidad.LTR[0].id, cantidad: 8 },
        { catalog_item_id: porUnidad.LTR[1].id, cantidad: 5 },
        { catalog_item_id: porUnidad.MTR[1].id, cantidad: 40 },
      ],
    }));

    // Boleta NIU + MTR
    docs.push(await crearVentaAceptada({
      companyRuc,
      tipoDoc: '03',
      serie: 'B001',
      cliente: clienteBol,
      almacenId: almacen.id,
      fechaEmision: hoy,
      lineas: [
        { catalog_item_id: porUnidad.NIU[0].id, cantidad: 2 },
        { catalog_item_id: porUnidad.MTR[2].id, cantidad: 25 },
      ],
    }));

    // Boleta LTR + KGM
    docs.push(await crearVentaAceptada({
      companyRuc,
      tipoDoc: '03',
      serie: 'B001',
      cliente: clienteBol,
      almacenId: almacen.id,
      fechaEmision: addDaysYmd(hoy, -5),
      lineas: [
        { catalog_item_id: porUnidad.LTR[2].id, cantidad: 10 },
        { catalog_item_id: porUnidad.KGM[1].id, cantidad: 80 },
        { catalog_item_id: porUnidad.KGM[2].id, cantidad: 15 },
      ],
    }));

    // Factura mixta restante
    docs.push(await crearVentaAceptada({
      companyRuc,
      tipoDoc: '01',
      serie: 'F001',
      cliente: clienteFact,
      almacenId: almacen.id,
      fechaEmision: addDaysYmd(hoy, -1),
      lineas: nuevos.slice(0, 6).map((p) => ({
        catalog_item_id: p.id,
        cantidad: p.unidad === 'NIU' ? 2 : (p.unidad === 'LTR' ? 4 : 30),
      })),
    }));

    for (const d of docs) {
      console.log(
        `Venta ${d.tipoDoc === '01' ? 'F' : 'B'} ${d.serie}-${d.correlativo} · ${d.fechaEmision} · `
        + `${d.details.length} líneas · total S/ ${Number(d.mtoImpVenta).toFixed(2)}`,
      );
    }

    const resumen = await require('../src/models/analisisModel').resumenProductos(companyRuc, {
      periodo: '30d',
      solo_costo: '1',
      orden: 'venta',
      top: 20,
    });
    console.log(
      `Análisis 30d → productos=${resumen.kpis.productos} venta=S/ ${resumen.kpis.venta} `
      + `margen=S/ ${resumen.kpis.margen} (${resumen.kpis.margen_pct}%)`,
    );
    console.log('Listo.');
  });
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await disconnectPrisma();
  });
