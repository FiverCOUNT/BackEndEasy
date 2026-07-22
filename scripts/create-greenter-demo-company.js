/**
 * Crea/actualiza la empresa demo Greenter (RUC 20161515648) con:
 * - Clave SOL MODDATOS
 * - Client ID/Secret de gre-test.nubefact.com
 * - Certificado PEM oficial del repo thegreenter/demo
 * - Usuario app + almacén básico
 *
 * Uso: node scripts/create-greenter-demo-company.js
 */
require('../src/config/env');

const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const bcrypt = require('bcryptjs');
const prisma = require('../src/config/prisma');
const companyModel = require('../src/models/companyModel');
const { GRE_TEST_DEMO } = require('../src/services/credencialesSunatService');
const { defaultSeriesConfig } = require('../src/utils/seriesConfig');

const CERT_URL =
  'https://raw.githubusercontent.com/thegreenter/demo/master/resources/cert.pem';
const CERT_LOCAL = path.join(__dirname, '..', 'tmp', 'greenter-cert.pem');
const APP_EMAIL = 'greenter@demo.local';
const APP_PASSWORD = 'demo123';

async function ensureCertFile() {
  if (fs.existsSync(CERT_LOCAL) && fs.statSync(CERT_LOCAL).size > 500) {
    return CERT_LOCAL;
  }
  fs.mkdirSync(path.dirname(CERT_LOCAL), { recursive: true });
  const res = await fetch(CERT_URL);
  if (!res.ok) {
    throw new Error(`No se pudo descargar el certificado demo: HTTP ${res.status}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(CERT_LOCAL, buf);
  return CERT_LOCAL;
}

async function main() {
  const certPath = await ensureCertFile();
  const { toPem } = require('../src/utils/certificatePemConverter');
  const certBuffer = Buffer.from(toPem(fs.readFileSync(certPath), ''), 'utf8');

  const body = {
    ruc: GRE_TEST_DEMO.ruc,
    nombre: GRE_TEST_DEMO.razon_social,
    nombreComercial: 'Greenter Demo',
    tipoDoc: '6',
    numeroDoc: GRE_TEST_DEMO.ruc,
    email: 'demo@greenter.dev',
    telefono: '01-0000000',
    entorno: 'beta',
    plan: 'pro',
    taxRegime: 'RER',
    activo: true,
    isActive: true,
    creadoEn: new Date().toISOString().slice(0, 10),
    solUser: GRE_TEST_DEMO.usuario_sol,
    solPass: GRE_TEST_DEMO.clave_sol,
    clientId: GRE_TEST_DEMO.api_client_id,
    clientSecret: GRE_TEST_DEMO.api_client_secret,
    // PEM no usa contraseña; el validador exige valor no vacío.
    certificatePassword: 'greenter-demo',
    ubigeo: '150101',
    departamento: 'LIMA',
    provincia: 'LIMA',
    distrito: 'LIMA',
    direccion: 'AV. LIMA 123 - DEMO GREENTER',
    codLocal: '0000',
    serieFactura: 'F001',
    serieBoleta: 'B001',
    serieGuia: 'T001',
    serieNotaCredito: 'FC01',
    serieNotaDebito: 'FD01',
  };

  const certFile = {
    buffer: certBuffer,
    originalname: 'cert.pem',
  };

  const existing = await companyModel.findByRuc(GRE_TEST_DEMO.ruc);
  let company;
  if (existing) {
    company = await companyModel.update(existing.id, body, { certFile, existing });
    console.log(`Empresa actualizada id=${company.id.toString()} RUC=${company.ruc}`);
  } else {
    company = await companyModel.create(body, { certFile });
    console.log(`Empresa creada id=${company.id.toString()} RUC=${company.ruc}`);
  }

  company = await prisma.company.update({
    where: { id: company.id },
    data: { seriesConfigJson: defaultSeriesConfig() },
    include: { address: true },
  });

  let almacen = await prisma.almacen.findFirst({
    where: { companyRuc: GRE_TEST_DEMO.ruc, codigo: 'ALM01' },
  });
  if (!almacen) {
    almacen = await prisma.almacen.create({
      data: {
        id: randomUUID(),
        companyRuc: GRE_TEST_DEMO.ruc,
        codigo: 'ALM01',
        nombre: 'Almacén Demo Greenter',
        activo: true,
      },
    });
    console.log(`Almacén creado: ${almacen.codigo}`);
  }

  const hash = await bcrypt.hash(APP_PASSWORD, 10);
  const userExisting = await prisma.usuario.findUnique({ where: { email: APP_EMAIL } });
  if (userExisting) {
    await prisma.usuario.update({
      where: { id: userExisting.id },
      data: {
        contrasena: hash,
        companyId: company.id,
        almacenId: almacen.id,
        rol: 'USUARIO',
        estado: 'ACTIVO',
        lastUpdated: BigInt(Date.now()),
        token: null,
        refreshToken: null,
      },
    });
    console.log(`Usuario actualizado: ${APP_EMAIL}`);
  } else {
    await prisma.usuario.create({
      data: {
        email: APP_EMAIL,
        contrasena: hash,
        companyId: company.id,
        almacenId: almacen.id,
        rol: 'USUARIO',
        estado: 'ACTIVO',
        lastUpdated: BigInt(Date.now()),
      },
    });
    console.log(`Usuario creado: ${APP_EMAIL}`);
  }

  console.log('');
  console.log('--- Greenter demo listo ---');
  console.log(`RUC:            ${GRE_TEST_DEMO.ruc}`);
  console.log(`Razón social:   ${GRE_TEST_DEMO.razon_social}`);
  console.log(`Entorno:        beta`);
  console.log(`SOL:            ${GRE_TEST_DEMO.usuario_sol} / ${GRE_TEST_DEMO.clave_sol}`);
  console.log(`API client_id:  ${GRE_TEST_DEMO.api_client_id}`);
  console.log(`Certificado:    ${company.rutaFirma || '(subido)'}`);
  console.log(`App login:      ${APP_EMAIL} / ${APP_PASSWORD}`);
  console.log('');
  console.log('Certificado descargado de:');
  console.log(`  ${CERT_URL}`);
  console.log('Copia local:', CERT_LOCAL);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
