const { randomUUID } = require('crypto');
const prisma = require('../config/prisma');

function toApi(row) {
  if (!row) return null;
  return {
    id: row.id,
    nombre: row.nombre,
    fecha_vencimiento: row.fechaVencimiento || null,
  };
}

function normalizarFilas(nombres, fechas) {
  const nums = [].concat(nombres || []);
  const fecs = [].concat(fechas || []);
  const n = Math.max(nums.length, fecs.length);
  const filas = [];
  const vistos = new Set();
  for (let i = 0; i < n; i += 1) {
    const nombre = String(nums[i] || '').trim().slice(0, 64);
    const fechaRaw = String(fecs[i] || '').trim().slice(0, 10);
    if (!nombre && !fechaRaw) continue;
    if (!nombre) return { error: 'El nombre del lote es obligatorio.' };
    const key = nombre.toLowerCase();
    if (vistos.has(key)) return { error: `El lote ${nombre} está repetido.` };
    vistos.add(key);
    const fecha = /^\d{4}-\d{2}-\d{2}$/.test(fechaRaw) ? fechaRaw : '';
    if (fechaRaw && !fecha) return { error: `La fecha de ${nombre} no es válida.` };
    filas.push({ nombre, fecha: fecha || null });
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

async function guardarFilas({ companyRuc, nombres, fechas }) {
  const parsed = normalizarFilas(nombres, fechas);
  if (parsed.error) return parsed;
  for (const fila of parsed.filas) {
    const found = await prisma.productoLote.findUnique({
      where: {
        companyRuc_nombre: { companyRuc, nombre: fila.nombre },
      },
    });
    if (found) {
      if (fila.fecha && found.fechaVencimiento !== fila.fecha) {
        await prisma.productoLote.update({
          where: { id: found.id },
          data: { fechaVencimiento: fila.fecha },
        });
      }
    } else {
      await prisma.productoLote.create({
        data: {
          id: randomUUID(),
          companyRuc,
          nombre: fila.nombre,
          fechaVencimiento: fila.fecha,
        },
      });
    }
  }
  return { ok: true, total: parsed.filas.length };
}

module.exports = {
  toApi,
  normalizarFilas,
  listByCompany,
  guardarFilas,
};
