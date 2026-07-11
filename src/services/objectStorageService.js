const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const storageConfig = require('../config/storage');
const { resolveClienteFolderFromInvoice } = require('../utils/clienteStoragePath');

let client = null;

function getClient() {
  if (!storageConfig.r2.enabled) return null;
  if (!client) {
    client = new S3Client({
      region: storageConfig.r2.region,
      endpoint: storageConfig.r2.endpoint,
      credentials: {
        accessKeyId: storageConfig.r2.accessKeyId,
        secretAccessKey: storageConfig.r2.secretAccessKey,
      },
    });
  }
  return client;
}

function getPrefix(name) {
  return storageConfig.r2.prefixes[name] || name;
}

/** comprobantes/{RUC}/clientes/{tipoDoc-numeroDoc}/{archivo} */
function buildComprobanteKey(companyRuc, clientFolder, filename) {
  const folder = clientFolder || 'sin-cliente';
  return `${getPrefix('comprobantes')}/${companyRuc}/clientes/${folder}/${filename}`;
}

function buildComprobanteKeyForInvoice(invoice, filename) {
  const folder = resolveClienteFolderFromInvoice(invoice);
  return buildComprobanteKey(invoice.companyRuc, folder, filename);
}

/** certificados/{RUC}/{archivo.pfx} */
function buildCertificadoKey(companyRuc, filename) {
  const safeName = filename || `${companyRuc}.pfx`;
  return `${getPrefix('certificados')}/${companyRuc}/${safeName}`;
}

function isObjectKey(value, prefixName = 'comprobantes') {
  if (typeof value !== 'string') return false;
  const prefix = getPrefix(prefixName);
  return value.startsWith(`${prefix}/`);
}

function isHttpUrl(value) {
  return typeof value === 'string' && /^https?:\/\//i.test(value.trim());
}

function buildPublicUrl(key) {
  if (!key) return null;
  const base = storageConfig.r2.publicBaseUrl;
  if (!base) return null;
  return `${base}/${String(key).replace(/^\/+/, '')}`;
}

function extractObjectKey(value) {
  if (!value || typeof value !== 'string') return null;

  const trimmed = value.trim();
  if (isObjectKey(trimmed)) return trimmed;

  const base = storageConfig.r2.publicBaseUrl;
  if (base && trimmed.startsWith(`${base}/`)) {
    return trimmed.slice(base.length + 1);
  }

  if (!isHttpUrl(trimmed)) return null;

  try {
    const { pathname } = new URL(trimmed);
    const path = pathname.replace(/^\/+/, '');
    if (isObjectKey(path)) return path;

    const prefix = getPrefix('comprobantes');
    const idx = path.indexOf(`${prefix}/`);
    if (idx >= 0) return path.slice(idx);
  } catch {
    return null;
  }

  return null;
}

function resolvePublicUrl(keyOrUrl) {
  if (!keyOrUrl) return null;
  const trimmed = String(keyOrUrl).trim();
  if (isHttpUrl(trimmed)) return trimmed;
  return buildPublicUrl(trimmed);
}

function assertPublicBaseUrlConfigured() {
  if (!storageConfig.r2.publicBaseUrl) {
    throw new Error(
      'S3_PUBLIC_BASE_URL es obligatorio para guardar enlaces públicos de Cloudflare R2 en la base de datos.',
    );
  }
}

async function uploadBuffer(key, buffer, contentType) {
  const s3 = getClient();
  if (!s3) {
    throw new Error('R2/S3 no está configurado. Define S3_ACCESS_KEY_ID y S3_SECRET_ACCESS_KEY en .env');
  }

  await s3.send(
    new PutObjectCommand({
      Bucket: storageConfig.r2.bucket,
      Key: key,
      Body: buffer,
      ContentType: contentType,
    }),
  );

  const url = buildPublicUrl(key);
  if (!url && storageConfig.r2.enabled && storageConfig.isProduction) {
    assertPublicBaseUrlConfigured();
  }

  return { key, url };
}

async function getObjectBuffer(key) {
  const s3 = getClient();
  if (!s3 || !key) return null;

  try {
    const response = await s3.send(
      new GetObjectCommand({
        Bucket: storageConfig.r2.bucket,
        Key: key,
      }),
    );
    const bytes = await response.Body.transformToByteArray();
    return Buffer.from(bytes);
  } catch {
    return null;
  }
}

async function uploadCertificado(companyRuc, buffer, filename) {
  const key = buildCertificadoKey(companyRuc, filename);
  const isPem = /\.pem$/i.test(filename);
  const contentType = isPem ? 'application/x-pem-file' : 'application/x-pkcs12';
  return uploadBuffer(key, buffer, contentType);
}

async function getPresignedUrl(key, expiresInSeconds = 900) {
  const s3 = getClient();
  if (!s3) {
    throw new Error('R2/S3 no está configurado. Define S3_ACCESS_KEY_ID y S3_SECRET_ACCESS_KEY en .env');
  }

  return getSignedUrl(
    s3,
    new GetObjectCommand({
      Bucket: storageConfig.r2.bucket,
      Key: key,
    }),
    { expiresIn: expiresInSeconds },
  );
}

/** URL pública del bucket o presigned URL para que EMISOR descargue el .pfx. */
async function resolveCertificadoUrl(rutaFirma) {
  if (!rutaFirma || typeof rutaFirma !== 'string') {
    throw new Error('La empresa no tiene certificado digital (.pfx) configurado.');
  }

  const trimmed = rutaFirma.trim();
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }

  const publicUrl = buildPublicUrl(trimmed);
  if (publicUrl) {
    return publicUrl;
  }

  return getPresignedUrl(trimmed);
}

module.exports = {
  buildComprobanteKey,
  buildComprobanteKeyForInvoice,
  buildCertificadoKey,
  buildKey: buildComprobanteKeyForInvoice,
  buildPublicUrl,
  extractObjectKey,
  resolvePublicUrl,
  assertPublicBaseUrlConfigured,
  isHttpUrl,
  uploadBuffer,
  getObjectBuffer,
  uploadCertificado,
  getPresignedUrl,
  resolveCertificadoUrl,
  isObjectKey,
  isEnabled: () => storageConfig.r2.enabled,
  getPrefixes: () => storageConfig.r2.prefixes,
};
