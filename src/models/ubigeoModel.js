const prisma = require('../config/prisma');
const { runWithEntorno } = require('../config/prisma');
const { formarUbigeo, partirUbigeo, assertUbigeoPeru } = require('../utils/ubigeo');

function toRegionApi(row) {
  if (!row) return null;
  return { codigo: row.codigo, nombre: row.nombre };
}

function toProvinciaApi(row) {
  if (!row) return null;
  return {
    codigo: row.codigo,
    codigo_local: row.codigoLocal,
    nombre: row.nombre,
    region_codigo: row.regionCodigo,
  };
}

function toDistritoApi(row) {
  if (!row) return null;
  return {
    codigo: row.codigo,
    codigo_local: row.codigoLocal,
    nombre: row.nombre,
    provincia_codigo: row.provinciaCodigo,
    ubigeo: row.codigo,
  };
}

async function listRegiones() {
  return runWithEntorno('prod', async () => {
    const rows = await prisma.region.findMany({ orderBy: { codigo: 'asc' } });
    return rows.map(toRegionApi);
  });
}

async function listProvinciasByRegion(regionCodigo) {
  return runWithEntorno('prod', async () => {
    const codigo = String(regionCodigo || '').replace(/\D/g, '').padStart(2, '0').slice(-2);
    const rows = await prisma.provincia.findMany({
      where: { regionCodigo: codigo },
      orderBy: { codigo: 'asc' },
    });
    return rows.map(toProvinciaApi);
  });
}

async function listDistritosByProvincia(provinciaCodigo) {
  return runWithEntorno('prod', async () => {
    const codigo = String(provinciaCodigo || '').replace(/\D/g, '').padStart(4, '0').slice(-4);
    const rows = await prisma.distrito.findMany({
      where: { provinciaCodigo: codigo },
      orderBy: { codigo: 'asc' },
    });
    return rows.map(toDistritoApi);
  });
}

async function findDistritoByUbigeo(ubigeo) {
  return runWithEntorno('prod', async () => {
    const codigo = assertUbigeoPeru(ubigeo);
    const row = await prisma.distrito.findUnique({
      where: { codigo },
      include: { provincia: { include: { region: true } } },
    });
    if (!row) return null;
    const region = row.provincia?.region || null;
    const provincia = row.provincia || null;
    return {
      ...toDistritoApi(row),
      departamento: region?.nombre || '',
      provincia: provincia?.nombre || '',
      distrito: row.nombre || '',
      region: toRegionApi(region),
      provincia_obj: toProvinciaApi(provincia),
    };
  });
}

/**
 * Resuelve nombres + ubigeo a partir de códigos locales.
 * @param {{ regionCodigo: string, provinciaLocal: string, distritoLocal: string }} codes
 */
async function resolveFromCodes({ regionCodigo, provinciaLocal, distritoLocal }) {
  const ubigeo = formarUbigeo(regionCodigo, provinciaLocal, distritoLocal);
  return findDistritoByUbigeo(ubigeo);
}

module.exports = {
  listRegiones,
  listProvinciasByRegion,
  listDistritosByProvincia,
  findDistritoByUbigeo,
  resolveFromCodes,
  formarUbigeo,
  partirUbigeo,
  toRegionApi,
  toProvinciaApi,
  toDistritoApi,
};
