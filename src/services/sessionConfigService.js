const prisma = require('../config/prisma');
const companyModel = require('../models/companyModel');
const almacenModel = require('../models/almacenModel');

async function loadCompanyForSession(companyId) {
  if (!companyId) return null;
  return prisma.company.findUnique({
    where: { id: BigInt(companyId) },
  });
}

async function buildConfiguracion(company) {
  if (!company?.ruc) return null;

  const almacenes = await prisma.almacen.findMany({
    where: { companyRuc: company.ruc },
    orderBy: [{ nombre: 'asc' }, { codigo: 'asc' }],
  });

  return {
    empresa: companyModel.toPublic(company),
    almacenes: almacenes.map(almacenModel.toApi),
    actualizado_en: new Date().toISOString(),
  };
}

module.exports = {
  loadCompanyForSession,
  buildConfiguracion,
};
