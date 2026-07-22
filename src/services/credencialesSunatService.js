const objectStorageService = require('./objectStorageService');
const { toPem } = require('../utils/certificatePemConverter');

const GRE_TIPOS = new Set(['09', '31']);

/**
 * Credenciales del servidor de pruebas GRE (Greenter / Nubefact).
 * SUNAT no ofrece sandbox oficial para guías; esto solo aplica en entorno beta.
 * El RUC demo debe coincidir con el emisor del XML (EMISOR lo alinea en beta).
 */
const GRE_TEST_DEMO = {
  api_client_id: 'test-85e5b0ae-255c-4891-a595-0b98c65c9854',
  api_client_secret: 'test-Hty/M6QshYvPgItX2P0+Kw==',
  ruc: '20161515648',
  usuario_sol: 'MODDATOS',
  clave_sol: 'MODDATOS',
  razon_social: 'GREENTER SAC',
};

function allowIncompleteCredentials() {
  return String(process.env.EMISOR_SUNAT_ALLOW_INCOMPLETE || '').toLowerCase() === 'true';
}

function isProductionEntorno(entorno) {
  const value = String(entorno || 'beta').toLowerCase();
  return value === 'prod' || value === 'production';
}

async function loadCertificadoBuffer(company) {
  let buffer = await objectStorageService.getObjectBuffer(company.rutaFirma);
  if (buffer?.length) return buffer;

  const url = await objectStorageService.resolveCertificadoUrl(company.rutaFirma);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error('No se pudo descargar el certificado digital desde el almacenamiento.');
  }
  return Buffer.from(await response.arrayBuffer());
}

/**
 * EMISOR (PHP/OpenSSL 3) no abre algunos .p12 antiguos (RC2).
 * Convertimos a PEM en Node y enviamos certificado_base64 para evitar openssl_pkcs12_read.
 */
async function resolveCertificadoParaEmisor(company) {
  const buffer = await loadCertificadoBuffer(company);
  const pem = toPem(buffer, company.certificatePassword);
  return {
    certificado_base64: Buffer.from(pem, 'utf8').toString('base64'),
  };
}

/**
 * Arma el bloque credenciales_sunat que EMISOR espera en cada POST.
 */
async function buildForCompany(company, options = {}) {
  const tipoDoc = options.tipoDoc ? String(options.tipoDoc) : null;
  if (!company?.ruc) {
    throw new Error('No se encontró la empresa emisora.');
  }

  const isProd = isProductionEntorno(company.entorno);
  const isGre = Boolean(tipoDoc && GRE_TIPOS.has(tipoDoc));
  const useGreTest = isGre && !isProd;

  const missing = [];
  if (!useGreTest) {
    if (!company.solUser) missing.push('usuario SOL');
    if (!company.solPass) missing.push('clave SOL');
  }
  if (!company.rutaFirma) missing.push('certificado (.pfx)');
  if (!company.certificatePassword) missing.push('contraseña del certificado');

  if (isGre && isProd) {
    if (!company.clientId) missing.push('API client_id (GRE)');
    if (!company.clientSecret) missing.push('API client_secret (GRE)');
  }

  if (missing.length) {
    if (allowIncompleteCredentials()) {
      return null;
    }
    throw new Error(
      `Configura los datos SUNAT de la empresa en el panel web: falta ${missing.join(', ')}.`,
    );
  }

  const certificado = await resolveCertificadoParaEmisor(company);
  const modo = isProd ? 'prod' : 'beta';

  if (useGreTest) {
    // Guías en desarrollo: OAuth + endpoint de gre-test.nubefact.com.
    // El XML sigue firmándose con el certificado de la empresa.
    return {
      modo,
      ruc: GRE_TEST_DEMO.ruc,
      usuario_sol: GRE_TEST_DEMO.usuario_sol,
      clave_sol: GRE_TEST_DEMO.clave_sol,
      api_client_id: GRE_TEST_DEMO.api_client_id,
      api_client_secret: GRE_TEST_DEMO.api_client_secret,
      ...certificado,
    };
  }

  const credenciales = {
    modo,
    ruc: company.ruc,
    usuario_sol: company.solUser,
    clave_sol: company.solPass,
    ...certificado,
  };
  if (company.clientId) credenciales.api_client_id = company.clientId;
  if (company.clientSecret) credenciales.api_client_secret = company.clientSecret;

  return credenciales;
}

async function attachToPayload(company, payload, options = {}) {
  const tipoDoc = options.tipoDoc || payload.tipo_doc || null;
  const credenciales_sunat = await buildForCompany(company, { tipoDoc });
  if (!credenciales_sunat) return payload;
  return { ...payload, credenciales_sunat };
}

module.exports = {
  GRE_TEST_DEMO,
  buildForCompany,
  attachToPayload,
  isProductionEntorno,
};
