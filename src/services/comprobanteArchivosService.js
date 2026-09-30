const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const storageConfig = require('../config/storage');
const objectStorageService = require('./objectStorageService');
const { resolveClienteFolderFromInvoice } = require('../utils/clienteStoragePath');
const { resolveHashFromEmisorData } = require('../utils/xmlHash');

const CONTENT_TYPES = {
  xml: 'application/xml',
  zip: 'application/zip',
  pdf: 'application/pdf',
};

const FILE_EXT = {
  xml: '.xml',
  cdr: '.zip',
  pdf: '.pdf',
};

function buildBasename(invoice) {
  return `${invoice.companyRuc}-${invoice.tipoDoc}-${invoice.serie}-${invoice.correlativo}`;
}

function getClientFolder(invoice) {
  return resolveClienteFolderFromInvoice(invoice);
}

function getInvoiceDir(companyRuc, clientFolder) {
  return path.join(storageConfig.comprobantesRoot, companyRuc, 'clientes', clientFolder);
}

function buildLocalPublicUrl(apiBaseUrl, companyRuc, clientFolder, filename) {
  if (!apiBaseUrl || !filename) return null;
  const base = apiBaseUrl.replace(/\/$/, '');
  return `${base}${storageConfig.comprobantesPublicPath}/${companyRuc}/clientes/${clientFolder}/${filename}`;
}

function buildApiArchivoUrl(apiBaseUrl, companyRuc, invoiceId, tipo) {
  if (!apiBaseUrl) return null;
  const base = apiBaseUrl.replace(/\/$/, '');
  return `${base}/api/empresas/${companyRuc}/comprobantes/${invoiceId}/archivos/${tipo}`;
}

function decodeBase64(b64) {
  if (!b64 || typeof b64 !== 'string') return null;
  const cleaned = b64.replace(/^data:[^;]+;base64,/, '').trim();
  if (!cleaned) return null;
  try {
    const buffer = Buffer.from(cleaned, 'base64');
    return buffer.length > 0 ? buffer : null;
  } catch {
    return null;
  }
}

function isR2Key(value) {
  return objectStorageService.isObjectKey(value, 'comprobantes');
}

function isLegacyStorageKey(value) {
  if (typeof value !== 'string') return false;
  const prefix = `${storageConfig.r2.prefixes?.comprobantes || 'comprobantes'}/`;
  return value.startsWith(prefix) && !value.includes('/clientes/');
}

function resolveFilename(invoice, tipo) {
  return `${buildBasename(invoice)}${FILE_EXT[tipo]}`;
}

function resolveR2KeyFromInvoice(invoice, tipo) {
  return objectStorageService.buildComprobanteKeyForInvoice(invoice, resolveFilename(invoice, tipo));
}

function getLegacyArchivos(invoice) {
  const raw = invoice.archivosJson;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  // Solo el formato CPE legado (xml/pdf/cdr). El mapa clave→valor de adjuntos no aplica aquí.
  if (!(raw.xml || raw.pdf || raw.cdr_zip || raw.cdr)) return null;
  return raw;
}

function getLegacyStorageKey(invoice, tipo) {
  const archivos = getLegacyArchivos(invoice);
  if (!archivos) return null;

  if (tipo === 'xml') return archivos.xml || null;
  if (tipo === 'cdr') return archivos.cdr_zip || archivos.cdr || null;
  if (tipo === 'pdf') return archivos.pdf || null;
  return null;
}

function resolveStorageKey(invoice, tipo) {
  const legacy = getLegacyStorageKey(invoice, tipo);
  if (legacy && (isR2Key(legacy) || isLegacyStorageKey(legacy))) return legacy;
  if (legacy && typeof legacy === 'string' && !legacy.includes('/')) return legacy;

  return resolveFilename(invoice, tipo);
}

async function writeLocalFile(dir, filename, buffer) {
  const filePath = path.join(dir, filename);
  await fsp.writeFile(filePath, buffer);
  return filename;
}

function resolveContentType(tipo) {
  if (tipo === 'cdr') return CONTENT_TYPES.zip;
  return CONTENT_TYPES[tipo] || 'application/octet-stream';
}

async function persistBuffer(invoice, buffer, tipo, apiBaseUrl) {
  if (!buffer?.length || !invoice?.id || !invoice?.companyRuc) return null;

  const filename = resolveFilename(invoice, tipo);
  const contentType = resolveContentType(tipo);
  const clientFolder = getClientFolder(invoice);

  if (objectStorageService.isEnabled()) {
    const key = objectStorageService.buildComprobanteKeyForInvoice(invoice, filename);
    const { url } = await objectStorageService.uploadBuffer(key, buffer, contentType);
    if (url) {
      return { filename, url, clientFolder };
    }
    console.warn(
      `[storage] Subido a R2 (${key}) pero falta S3_PUBLIC_BASE_URL; no se guardará URL del servidor en BD.`,
    );
    return { filename, url: null, clientFolder };
  }

  const dir = getInvoiceDir(invoice.companyRuc, clientFolder);
  await fsp.mkdir(dir, { recursive: true });
  await writeLocalFile(dir, filename, buffer);
  const url =
    buildLocalPublicUrl(apiBaseUrl, invoice.companyRuc, clientFolder, filename) ||
    buildApiArchivoUrl(apiBaseUrl, invoice.companyRuc, invoice.id, tipo);

  return { filename, url, clientFolder };
}

async function persistFile(invoice, filename, base64, tipo, apiBaseUrl) {
  const buffer = decodeBase64(base64);
  if (!buffer) return null;
  return persistBuffer(invoice, buffer, tipo, apiBaseUrl);
}

function isHttpUrl(value) {
  return objectStorageService.isHttpUrl(value);
}

function isServerProxyUrl(value) {
  if (!isHttpUrl(value)) return false;
  return /\/api\/empresas\/[^/]+\/comprobantes\/[^/]+\/archivos\//i.test(value);
}

function resolveR2PublicUrl(invoice, tipo) {
  if (!objectStorageService.isEnabled()) return null;
  const key = resolveR2KeyFromInvoice(invoice, tipo);
  return objectStorageService.buildPublicUrl(key);
}

function normalizeStoredUrl(value, invoice, tipo, apiBaseUrl) {
  if (!value || typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  if (isHttpUrl(trimmed)) {
    if (objectStorageService.isEnabled() && isServerProxyUrl(trimmed)) {
      return resolveR2PublicUrl(invoice, tipo);
    }
    return trimmed;
  }

  if (isR2Key(trimmed) || isLegacyStorageKey(trimmed)) {
    return objectStorageService.resolvePublicUrl(trimmed);
  }

  if (trimmed.length > 200) {
    return objectStorageService.isEnabled()
      ? resolveR2PublicUrl(invoice, tipo)
      : buildApiArchivoUrl(apiBaseUrl, invoice.companyRuc, invoice.id, tipo);
  }

  if (objectStorageService.isEnabled()) {
    return resolveR2PublicUrl(invoice, tipo);
  }

  return buildLocalPublicUrl(apiBaseUrl, invoice.companyRuc, getClientFolder(invoice), trimmed)
    || buildApiArchivoUrl(apiBaseUrl, invoice.companyRuc, invoice.id, tipo);
}

/** Migra rutas legacy del JSON `archivos` a las columnas planas. */
function resolveColumnUrlsFromLegacy(invoice, apiBaseUrl) {
  const archivos = getLegacyArchivos(invoice);
  if (!archivos) {
    return {
      pdfUrl: invoice.pdfUrl || null,
      xmlUrlDirecto: invoice.xmlUrlDirecto || null,
      cdrZipUrl: invoice.cdrZipUrl || null,
    };
  }

  const pick = (columnValue, legacyValue, tipo) => {
    const resolvedColumn = normalizeStoredUrl(columnValue, invoice, tipo, apiBaseUrl);
    if (resolvedColumn) return resolvedColumn;
    return normalizeStoredUrl(legacyValue, invoice, tipo, apiBaseUrl);
  };

  return {
    pdfUrl: pick(invoice.pdfUrl, archivos.pdf, 'pdf'),
    xmlUrlDirecto: pick(invoice.xmlUrlDirecto, archivos.xml, 'xml'),
    cdrZipUrl: pick(invoice.cdrZipUrl, archivos.cdr_zip || archivos.cdr, 'cdr'),
  };
}

/**
 * Decodifica xml / cdr_zip del EMISOR y sube a R2 (o disco local).
 * El PDF no se guarda: se regenera on-the-fly con PDFKit al descargar.
 */
async function persistEmisorArchivos(invoice, emisorData, apiBaseUrl) {
  const empty = {
    pdfUrl: null,
    cdrZipUrl: null,
    xmlUrlDirecto: null,
    hash: null,
  };

  if (!invoice?.id || !invoice?.companyRuc) return empty;

  const basename = buildBasename(invoice);
  const savedXml = await persistFile(invoice, `${basename}.xml`, emisorData.xml, 'xml', apiBaseUrl);
  const savedCdr = await persistFile(
    invoice,
    `${basename}.zip`,
    emisorData.cdr_zip || emisorData.cdr,
    'cdr',
    apiBaseUrl,
  );

  return {
    pdfUrl: null,
    cdrZipUrl: savedCdr?.url || null,
    xmlUrlDirecto: savedXml?.url || null,
    hash: resolveHashFromEmisorData(emisorData),
  };
}

function resolveLocalFilePath(invoice, filename) {
  const archivos = getLegacyArchivos(invoice);
  const clientFolder = archivos?.cliente_folder || getClientFolder(invoice);
  return path.join(getInvoiceDir(invoice.companyRuc, clientFolder), filename);
}

function readArchivoFromDisk(invoice, tipo) {
  const filename = resolveStorageKey(invoice, tipo);
  if (!filename || isR2Key(filename) || isLegacyStorageKey(filename)) return null;

  const filePath = resolveLocalFilePath(invoice, filename);
  if (!fs.existsSync(filePath)) return null;

  const ext = path.extname(filename).slice(1).toLowerCase();

  return {
    buffer: fs.readFileSync(filePath),
    contentType: CONTENT_TYPES[ext] || 'application/octet-stream',
    ext,
  };
}

function readArchivoFromBase64Legacy(invoice, tipo) {
  const archivos = getLegacyArchivos(invoice);
  if (!archivos) return null;

  if (tipo === 'xml' && archivos.xml && archivos.xml.length > 200 && !isR2Key(archivos.xml)) {
    const buffer = decodeBase64(archivos.xml);
    if (buffer) return { buffer, contentType: CONTENT_TYPES.xml, ext: 'xml' };
  }

  if (tipo === 'cdr') {
    const b64 = archivos.cdr_zip || archivos.cdr;
    if (b64 && b64.length > 200 && !isR2Key(b64)) {
      const buffer = decodeBase64(b64);
      if (buffer) return { buffer, contentType: CONTENT_TYPES.zip, ext: 'zip' };
    }
  }

  if (tipo === 'pdf' && archivos.pdf && archivos.pdf.length > 200 && !isR2Key(archivos.pdf)) {
    const buffer = decodeBase64(archivos.pdf);
    if (buffer) return { buffer, contentType: CONTENT_TYPES.pdf, ext: 'pdf' };
  }

  return null;
}

function readArchivoFromSunatJson(invoice, tipo) {
  const sunat = invoice.sunatJson && typeof invoice.sunatJson === 'object' ? invoice.sunatJson : null;
  if (!sunat) return null;

  if (tipo === 'xml' && sunat.xml) {
    const buffer = decodeBase64(sunat.xml);
    if (buffer) return { buffer, contentType: CONTENT_TYPES.xml, ext: 'xml' };
  }

  if (tipo === 'cdr') {
    const b64 = sunat.cdr_zip || sunat.cdr;
    if (b64) {
      const buffer = decodeBase64(b64);
      if (buffer) return { buffer, contentType: CONTENT_TYPES.zip, ext: 'zip' };
    }
  }

  if (tipo === 'pdf' && (sunat.pdf || sunat.pdf_base64)) {
    const buffer = decodeBase64(sunat.pdf || sunat.pdf_base64);
    if (buffer) return { buffer, contentType: CONTENT_TYPES.pdf, ext: 'pdf' };
  }

  return null;
}

async function readArchivoFromR2(invoice, tipo) {
  if (!objectStorageService.isEnabled()) return null;

  const keys = [];
  const columnUrl =
    tipo === 'xml' ? invoice.xmlUrlDirecto : tipo === 'cdr' ? invoice.cdrZipUrl : invoice.pdfUrl;
  const fromColumn = objectStorageService.extractObjectKey(columnUrl);
  if (fromColumn) keys.push(fromColumn);

  const legacy = getLegacyStorageKey(invoice, tipo);
  if (legacy && (isR2Key(legacy) || isLegacyStorageKey(legacy))) keys.push(legacy);
  keys.push(resolveR2KeyFromInvoice(invoice, tipo));

  for (const key of keys) {
    const buffer = await objectStorageService.getObjectBuffer(key);
    if (!buffer) continue;

    const ext = path.extname(key).slice(1).toLowerCase();
    return {
      buffer,
      contentType: CONTENT_TYPES[ext] || 'application/octet-stream',
      ext,
    };
  }

  return null;
}

async function getArchivoBuffer(invoice, tipo) {
  const fromR2 = await readArchivoFromR2(invoice, tipo);
  if (fromR2) return fromR2;

  const fromDisk = readArchivoFromDisk(invoice, tipo);
  if (fromDisk) return fromDisk;

  const fromLegacy = readArchivoFromBase64Legacy(invoice, tipo);
  if (fromLegacy) return fromLegacy;

  return readArchivoFromSunatJson(invoice, tipo);
}

function hasArchivoDisponible(invoice, tipo) {
  if (tipo === 'xml' && invoice.xmlUrlDirecto) return true;
  if (tipo === 'cdr' && invoice.cdrZipUrl) return true;
  if (tipo === 'pdf' && invoice.pdfUrl) return true;

  const legacy = getLegacyArchivos(invoice);
  if (tipo === 'xml' && legacy?.xml) return true;
  if (tipo === 'cdr' && (legacy?.cdr_zip || legacy?.cdr)) return true;
  if (tipo === 'pdf' && legacy?.pdf) return true;

  const sunat = invoice.sunatJson && typeof invoice.sunatJson === 'object' ? invoice.sunatJson : null;
  if (tipo === 'xml' && sunat?.xml) return true;
  if (tipo === 'cdr' && (sunat?.cdr_zip || sunat?.cdr)) return true;
  if (tipo === 'pdf' && (sunat?.pdf || sunat?.pdf_base64)) return true;

  return false;
}

function resolveFileUrls(invoice, apiBaseUrl, options = {}) {
  const columns = resolveColumnUrlsFromLegacy(invoice, apiBaseUrl);
  const r2Enabled = objectStorageService.isEnabled();
  // En compras recibidas el access RUC es el receptor (auth), no el emisor del CPE.
  const accessRuc = String(options.accessCompanyRuc || invoice.companyRuc || '').trim()
    || invoice.companyRuc;
  const base = apiBaseUrl
    ? `${apiBaseUrl.replace(/\/$/, '')}/api/empresas/${accessRuc}/comprobantes/${invoice.id}/archivos`
    : null;

  const pick = (storedUrl, tipo) => {
    if (storedUrl && !(r2Enabled && isServerProxyUrl(storedUrl))) {
      return storedUrl;
    }

    if (r2Enabled) {
      const publicUrl = resolveR2PublicUrl(invoice, tipo);
      if (publicUrl) return publicUrl;
    }

    if (base && (hasArchivoDisponible(invoice, tipo) || canServeGeneratedPdf(invoice, tipo))) {
      return `${base}/${tipo}`;
    }

    return null;
  };

  return {
    pdf_url: pick(columns.pdfUrl, 'pdf'),
    xml_url: pick(columns.xmlUrlDirecto, 'xml'),
    cdr_zip_url: pick(columns.cdrZipUrl, 'cdr'),
  };
}

/** PDF se puede generar on-the-fly (como emitidos) si no es borrador. */
function canServeGeneratedPdf(invoice, tipo) {
  if (tipo !== 'pdf') return false;
  const estado = String(invoice.estado || '').toUpperCase();
  return estado && estado !== 'BORRADOR';
}

module.exports = {
  persistEmisorArchivos,
  persistBuffer,
  /** No-op: el PDF se genera al descargar; no se sube a R2 ni a disco. */
  persistGeneratedPdf: async () => null,
  getArchivoBuffer,
  resolveFileUrls,
  resolveColumnUrlsFromLegacy,
  resolveR2PublicUrl,
  normalizeStoredUrl,
  hasArchivoDisponible,
  buildPublicUrl: buildLocalPublicUrl,
};
