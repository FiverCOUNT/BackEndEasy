const fs = require('fs');
const path = require('path');
const storageConfig = require('../config/storage');
const objectStorageService = require('./objectStorageService');
const { assertLogoFile } = require('./easyLogoService');

const MIME_BY_EXT = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.gif': 'image/gif',
};

/** Extensiones que PDFKit puede embeber de forma fiable. */
const PDF_SAFE_EXT = new Set(['.png', '.jpg', '.jpeg']);

async function uploadLocal(companyRuc, buffer, ext) {
  const ruc = String(companyRuc || '').replace(/\D/g, '') || 'sin-ruc';
  const dir = path.join(storageConfig.companyLogosRoot, ruc);
  fs.mkdirSync(dir, { recursive: true });
  for (const old of fs.readdirSync(dir)) {
    if (/^logo\./i.test(old)) {
      try { fs.unlinkSync(path.join(dir, old)); } catch { /* ignore */ }
    }
  }
  const filename = `logo${ext}`;
  fs.writeFileSync(path.join(dir, filename), buffer);
  return {
    key: `local:logos/${ruc}/${filename}`,
    url: `${storageConfig.companyLogosPublicPath}/${ruc}/${filename}`,
    nombre: filename,
  };
}

/**
 * Foto/logo de la empresa → R2 logos/{RUC}/ o storage/logos/{RUC}/.
 */
async function uploadCompanyLogo(companyRuc, file) {
  const ruc = String(companyRuc || '').replace(/\D/g, '');
  if (!ruc) throw new Error('Empresa sin RUC para guardar el logo.');
  const ext = assertLogoFile(file);
  const contentType = MIME_BY_EXT[ext] || file.mimetype || 'image/png';
  const filename = `logo${ext}`;

  if (storageConfig.r2.enabled) {
    const uploaded = await objectStorageService.uploadCompanyLogo(
      ruc,
      file.buffer,
      filename,
      contentType,
    );
    if (!uploaded.url) {
      objectStorageService.assertPublicBaseUrlConfigured();
    }
    return {
      key: uploaded.key,
      url: uploaded.url,
      nombre: uploaded.nombre || filename,
    };
  }

  return uploadLocal(ruc, file.buffer, ext);
}

function extOfPath(p) {
  return path.extname(String(p || '').split('?')[0]).toLowerCase();
}

function isPdfSafeLogo(extOrUrl) {
  const ext = extOfPath(extOrUrl);
  if (PDF_SAFE_EXT.has(ext)) return true;
  // URL/key sin extensión: se intenta igual (muchas son PNG/JPG).
  return !ext;
}

/**
 * Buffer del logo de empresa para PDF (PNG/JPG).
 * Acepta rutaLogo local, key R2 o URL http(s).
 */
async function loadCompanyLogoBuffer(company) {
  if (!company) return null;
  const raw = String(company.rutaLogo || company.logoUrl || company.logo_url || '').trim();
  if (!raw) return null;

  try {
    if (raw.startsWith('local:')) {
      const rest = raw.slice('local:'.length).replace(/^\/+/, '');
      if (!isPdfSafeLogo(rest)) return null;
      const abs = path.join(__dirname, '../../storage', rest);
      return await fs.promises.readFile(abs);
    }

    if (raw.startsWith('/storage/')) {
      if (!isPdfSafeLogo(raw)) return null;
      const abs = path.join(__dirname, '../..', raw.replace(/^\//, ''));
      return await fs.promises.readFile(abs);
    }

    if (/^https?:\/\//i.test(raw)) {
      const res = await fetch(raw);
      if (!res.ok) return null;
      const buf = Buffer.from(await res.arrayBuffer());
      return buf.length ? buf : null;
    }

    // Key R2 (p. ej. logos/2061…/logo.png)
    if (objectStorageService.isEnabled()) {
      if (!isPdfSafeLogo(raw)) return null;
      return await objectStorageService.getObjectBuffer(raw);
    }

    // Fallback local por RUC
    const ruc = String(company.ruc || company.companyRuc || '').replace(/\D/g, '');
    if (ruc) {
      const dir = path.join(storageConfig.companyLogosRoot, ruc);
      if (fs.existsSync(dir)) {
        const file = fs.readdirSync(dir).find((f) => /^logo\.(png|jpe?g)$/i.test(f));
        if (file) return await fs.promises.readFile(path.join(dir, file));
      }
    }
  } catch (_e) {
    return null;
  }
  return null;
}

module.exports = { uploadCompanyLogo, loadCompanyLogoBuffer };
