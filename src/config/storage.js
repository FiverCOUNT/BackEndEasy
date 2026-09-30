require('dotenv').config();
const path = require('path');

function normalizePrefix(value, fallback) {
  return String(value || fallback)
    .trim()
    .replace(/^\/+|\/+$/g, '');
}

const comprobantesRoot = path.join(__dirname, '../../storage/comprobantes');

const s3Endpoint = (process.env.S3_ENDPOINT || '').replace(/\/$/, '');
const s3Bucket = process.env.S3_BUCKET || '';
const s3AccessKey = process.env.S3_ACCESS_KEY_ID || '';
const s3SecretKey = process.env.S3_SECRET_ACCESS_KEY || '';
const s3PublicBaseUrl = (process.env.S3_PUBLIC_BASE_URL || '').replace(/\/$/, '');
const s3Region = process.env.S3_REGION || 'auto';

const prefixComprobantes = normalizePrefix(process.env.S3_PREFIX_COMPROBANTES, 'comprobantes');
const prefixCertificados = normalizePrefix(process.env.S3_PREFIX_CERTIFICADOS, 'certificados');
const prefixAdjuntos = normalizePrefix(process.env.S3_PREFIX_ADJUNTOS, 'adjuntos');
const prefixConfiguracion = normalizePrefix(process.env.S3_PREFIX_CONFIGURACION, 'configuracion');
const prefixLogos = normalizePrefix(process.env.S3_PREFIX_LOGOS, 'logos');
const logosRoot = path.join(__dirname, '../../storage/configuracion');
const companyLogosRoot = path.join(__dirname, '../../storage/logos');

const r2Enabled = Boolean(s3Endpoint && s3Bucket && s3AccessKey && s3SecretKey);
const isProduction = process.env.NODE_ENV === 'production';

function assertR2ProductionConfig() {
  if (!r2Enabled || !isProduction) return;
  if (!s3PublicBaseUrl) {
    throw new Error(
      'En producción con R2 habilitado debes definir S3_PUBLIC_BASE_URL (URL pública del bucket Cloudflare).',
    );
  }
}

function warnR2PublicUrlMissing() {
  if (!r2Enabled || s3PublicBaseUrl) return;
  console.warn(
    '[storage] R2 activo pero falta S3_PUBLIC_BASE_URL. Los archivos se suben a Cloudflare, '
      + 'pero pdf_url/xml_url/cdr_zip_url en BD quedarán vacíos hasta configurar la URL pública del bucket.',
  );
}

module.exports = {
  comprobantesRoot,
  logosRoot,
  companyLogosRoot,
  comprobantesPublicPath: '/storage/comprobantes',
  logosPublicPath: '/storage/configuracion',
  companyLogosPublicPath: '/storage/logos',
  isProduction,
  assertR2ProductionConfig,
  warnR2PublicUrlMissing,
  r2: {
    enabled: r2Enabled,
    endpoint: s3Endpoint,
    bucket: s3Bucket,
    accessKeyId: s3AccessKey,
    secretAccessKey: s3SecretKey,
    publicBaseUrl: s3PublicBaseUrl,
    region: s3Region,
    prefixes: {
      comprobantes: prefixComprobantes,
      certificados: prefixCertificados,
      adjuntos: prefixAdjuntos,
      configuracion: prefixConfiguracion,
      logos: prefixLogos,
    },
  },
};
