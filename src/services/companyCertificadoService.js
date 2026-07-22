const path = require('path');
const objectStorageService = require('./objectStorageService');
const { toPem } = require('../utils/certificatePemConverter');

const ALLOWED_EXT = new Set(['.pfx', '.p12', '.pem']);

function resolveCertFilename(companyRuc, originalName) {
  return `${companyRuc}.pem`;
}

async function uploadCertificado(companyRuc, file, { password = '' } = {}) {
  if (!file?.buffer?.length) return null;

  if (!objectStorageService.isEnabled()) {
    throw new Error('R2/S3 no está configurado. Revisa S3_ACCESS_KEY_ID y S3_SECRET_ACCESS_KEY en .env');
  }

  const ext = path.extname(file.originalname || '').toLowerCase();
  // Siempre normalizamos a PEM RSA (LF). Un .pem con CRLF/PKCS#8 rompe la firma en EMISOR.
  if (ext !== '.pem' && !password) {
    throw new Error('Indica la contraseña del certificado al subir un archivo .pfx o .p12.');
  }
  const pem = toPem(file.buffer, password);
  const uploadBuffer = Buffer.from(pem, 'utf8');

  const filename = resolveCertFilename(companyRuc, file.originalname);

  try {
    const result = await objectStorageService.uploadCertificado(companyRuc, uploadBuffer, filename);
    return {
      key: result.key,
      url: result.url,
      filename,
    };
  } catch (err) {
    if (err?.Code === 'AccessDenied' || err?.name === 'AccessDenied') {
      throw new Error(
        'Cloudflare R2 rechazó la subida: el API token solo tiene lectura. '
          + 'En Cloudflare → R2 → Manage API Tokens, crea uno con permiso "Object Read & Write" '
          + 'sobre el bucket sistemafacturacion y actualiza S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY en .env.',
      );
    }
    throw err;
  }
}

module.exports = {
  uploadCertificado,
};
