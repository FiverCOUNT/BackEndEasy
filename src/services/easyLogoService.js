const fs = require('fs');
const path = require('path');
const storageConfig = require('../config/storage');
const objectStorageService = require('./objectStorageService');

const ALLOWED_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.svg', '.gif']);
const MIME_BY_EXT = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.gif': 'image/gif',
};

function extOf(filename, mimetype) {
  const fromName = path.extname(String(filename || '')).toLowerCase();
  if (ALLOWED_EXT.has(fromName)) return fromName;
  const map = {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/webp': '.webp',
    'image/svg+xml': '.svg',
    'image/gif': '.gif',
  };
  return map[String(mimetype || '').toLowerCase()] || '';
}

function assertLogoFile(file) {
  if (!file?.buffer?.length) {
    throw new Error('Selecciona un archivo de logo.');
  }
  const ext = extOf(file.originalname, file.mimetype);
  if (!ext) {
    throw new Error('El logo debe ser PNG, JPG, WEBP, SVG o GIF.');
  }
  if (file.buffer.length > 2 * 1024 * 1024) {
    throw new Error('El logo no puede superar 2 MB.');
  }
  return ext;
}

async function uploadLocal(buffer, ext, contentType) {
  const dir = storageConfig.logosRoot;
  fs.mkdirSync(dir, { recursive: true });
  // Un solo logo Easy vigente
  for (const old of fs.readdirSync(dir)) {
    if (/^logo\./i.test(old)) {
      try { fs.unlinkSync(path.join(dir, old)); } catch { /* ignore */ }
    }
  }
  const filename = `logo${ext}`;
  const abs = path.join(dir, filename);
  fs.writeFileSync(abs, buffer);
  return {
    key: `local:${filename}`,
    url: `${storageConfig.logosPublicPath}/${filename}`,
    nombre: filename,
    contentType,
  };
}

/**
 * Sube el logo de marca Easy a Cloudflare R2 (prefijo configuracion/easy/).
 * Si R2 no está configurado, guarda en storage/configuracion local.
 */
async function uploadEasyLogo(file) {
  const ext = assertLogoFile(file);
  const contentType = MIME_BY_EXT[ext] || file.mimetype || 'image/png';
  const filename = `logo${ext}`;

  if (storageConfig.r2.enabled) {
    const uploaded = await objectStorageService.uploadEasyLogo(file.buffer, filename, contentType);
    if (!uploaded.url) {
      objectStorageService.assertPublicBaseUrlConfigured();
    }
    return {
      key: uploaded.key,
      url: uploaded.url,
      nombre: uploaded.nombre || filename,
    };
  }

  return uploadLocal(file.buffer, ext, contentType);
}

module.exports = {
  uploadEasyLogo,
  assertLogoFile,
};
