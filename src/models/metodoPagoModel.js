const { randomUUID } = require('crypto');
const prisma = require('../config/prisma');

const TIPOS = new Set(['YAPE', 'CCI', 'PLIN', 'TRANSFERENCIA', 'EFECTIVO', 'OTRO']);
const TIPOS_SIN_VALOR = new Set(['EFECTIVO']);

function normalizeTipo(raw) {
  const t = String(raw || '').trim().toUpperCase();
  if (TIPOS.has(t)) return t;
  if (/yape/i.test(t)) return 'YAPE';
  if (/cci|interbanc/i.test(t)) return 'CCI';
  if (/plin/i.test(t)) return 'PLIN';
  if (/efect|cash|contado/i.test(t)) return 'EFECTIVO';
  if (/transf|banco|bcp|interbank|bbva/i.test(t)) return 'TRANSFERENCIA';
  return 'OTRO';
}

function normalizeValor(tipo, raw) {
  if (TIPOS_SIN_VALOR.has(tipo)) return '';
  const s = String(raw || '').trim();
  if (tipo === 'YAPE' || tipo === 'PLIN') {
    return s.replace(/\D/g, '').slice(0, 15);
  }
  if (tipo === 'CCI') {
    return s.replace(/\D/g, '').slice(0, 20);
  }
  return s.slice(0, 80);
}

function requiereValor(tipo) {
  return !TIPOS_SIN_VALOR.has(normalizeTipo(tipo));
}

function toApi(row) {
  if (!row) return null;
  return {
    id: row.id,
    company_ruc: row.companyRuc,
    nombre: row.nombre,
    tipo: row.tipo,
    valor: row.valor,
    activo: row.activo !== false,
    creado_en: row.creadoEn || undefined,
    actualizado_en: row.actualizadoEn || undefined,
  };
}

async function listByCompany(companyRuc, { soloActivos = false, q = '' } = {}) {
  const ruc = String(companyRuc || '').trim();
  if (!ruc) return [];
  const query = String(q || '').trim();
  const rows = await prisma.metodoPago.findMany({
    where: {
      companyRuc: ruc,
      ...(soloActivos ? { activo: true } : {}),
      ...(query
        ? {
            OR: [
              { nombre: { contains: query } },
              { tipo: { contains: query } },
              { valor: { contains: query } },
            ],
          }
        : {}),
    },
    orderBy: [{ activo: 'desc' }, { nombre: 'asc' }],
  });
  return rows.map(toApi);
}

async function findById(companyRuc, id) {
  const row = await prisma.metodoPago.findFirst({
    where: { id: String(id || '').trim(), companyRuc: String(companyRuc || '').trim() },
  });
  return toApi(row);
}

async function create(companyRuc, body = {}) {
  const ruc = String(companyRuc || '').trim();
  const nombre = String(body.nombre || '').trim().slice(0, 120);
  const tipo = normalizeTipo(body.tipo);
  const valor = normalizeValor(tipo, body.valor);
  if (!ruc) throw Object.assign(new Error('Empresa no encontrada.'), { status: 400 });
  if (!nombre) throw Object.assign(new Error('El nombre es obligatorio.'), { status: 400 });
  if (requiereValor(tipo) && !valor) {
    throw Object.assign(new Error('El valor (celular o CCI) es obligatorio.'), { status: 400 });
  }

  const row = await prisma.metodoPago.create({
    data: {
      id: randomUUID(),
      companyRuc: ruc,
      nombre,
      tipo,
      valor,
      activo: body.activo !== false && body.activo !== '0' && body.activo !== 'false',
    },
  });
  return toApi(row);
}

async function update(companyRuc, id, body = {}) {
  const existing = await prisma.metodoPago.findFirst({
    where: { id: String(id || '').trim(), companyRuc: String(companyRuc || '').trim() },
  });
  if (!existing) {
    const err = new Error('Método de pago no encontrado.');
    err.status = 404;
    throw err;
  }

  const tipo = body.tipo != null ? normalizeTipo(body.tipo) : existing.tipo;
  const data = {};
  if (body.nombre != null) {
    const nombre = String(body.nombre || '').trim().slice(0, 120);
    if (!nombre) throw Object.assign(new Error('El nombre es obligatorio.'), { status: 400 });
    data.nombre = nombre;
  }
  if (body.tipo != null) data.tipo = tipo;
  if (body.valor != null || body.tipo != null) {
    const valor = normalizeValor(tipo, body.valor != null ? body.valor : existing.valor);
    if (requiereValor(tipo) && !valor) {
      throw Object.assign(new Error('El valor (celular o CCI) es obligatorio.'), { status: 400 });
    }
    data.valor = valor;
  }
  if (body.activo != null) {
    data.activo = body.activo === true || body.activo === '1' || body.activo === 'true' || body.activo === 'on';
  }

  const row = await prisma.metodoPago.update({ where: { id: existing.id }, data });
  return toApi(row);
}

async function remove(companyRuc, id) {
  const existing = await prisma.metodoPago.findFirst({
    where: { id: String(id || '').trim(), companyRuc: String(companyRuc || '').trim() },
    select: { id: true },
  });
  if (!existing) {
    const err = new Error('Método de pago no encontrado.');
    err.status = 404;
    throw err;
  }
  // Soft-delete: desactivar para no romper facturas ya emitidas.
  await prisma.metodoPago.update({
    where: { id: existing.id },
    data: { activo: false },
  });
  return { id: existing.id, activo: false };
}

module.exports = {
  TIPOS: [...TIPOS],
  TIPOS_SIN_VALOR: [...TIPOS_SIN_VALOR],
  requiereValor,
  toApi,
  listByCompany,
  findById,
  create,
  update,
  remove,
};
