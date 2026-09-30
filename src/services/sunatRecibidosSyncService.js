/**
 * Sincroniza comprobantes RECIBIDOS (tú = adquiriente) desde SUNAT
 * hacia tabla `compras` + XML/PDF en Cloudflare R2.
 *
 * Fuente oficial (misma data del portal SOL / SIRE):
 *  - SIRE RCE → listado del periodo (facturas, boletas, NC, ND…)
 *  - SSPP Envíos SP → XML UBL facturas/notas (no GRE)
 *  - Scraper GRE (puerto 3001) → guías 09/31 recibidas con XML del portal SOL
 *  - Scraper facturas (puerto 3001) → facturas/boletas/notas con XML e ítems UBL
 */
const companyModel = require('../models/companyModel');
const compraModel = require('../models/compraModel');
const { isProductionEntorno } = require('./credencialesSunatService');
const sireRceImportService = require('./sireRceImportService');
const greRecibidosSyncService = require('./greRecibidosSyncService');
const facturasRecibidosSyncService = require('./facturasRecibidosSyncService');
const {
  intentarParsedDesdeSspp,
  registrarInvoiceRecibido,
} = require('./ssppReceptorService');
const { periodoYyyyMmToRangoIso } = require('../utils/fechas');

/** Evita sync concurrente / spam por empresa+periodo. */
const locks = new Map();
const lastOkAt = new Map();
const SYNC_LOCK_MAX_MS = Number(process.env.SUNAT_SYNC_LOCK_MAX_MS || 20 * 60 * 1000);
/** Meses pasados: cooldown largo. Mes actual: corto (la app fuerza sync al entrar). */
const COOLDOWN_MS = Number(process.env.SUNAT_RECIBIDOS_SYNC_COOLDOWN_MS || 3 * 60 * 1000);
const COOLDOWN_MES_ACTUAL_MS = Number(
  process.env.SUNAT_RECIBIDOS_SYNC_COOLDOWN_CURRENT_MS || 45 * 1000,
);

/** Chip de Compras → qué scrapers correr y con qué filtros. */
const DOC_SYNC_SCOPE = {
  FACT: { facturas: true, gre: false, tiposFactura: ['01'], consultas: ['11'], label: 'facturas' },
  BOL: { facturas: true, gre: false, tiposFactura: ['03'], consultas: ['11'], label: 'boletas' },
  NC: { facturas: true, gre: false, tiposFactura: ['07'], consultas: ['14'], label: 'notas de crédito' },
  ND: { facturas: true, gre: false, tiposFactura: ['08'], consultas: ['16'], label: 'notas de débito' },
  GRE: { facturas: false, gre: true, tiposGre: ['09'], label: 'GRE remitente' },
  GRT: { facturas: false, gre: true, tiposGre: ['31'], label: 'GRE transportista' },
  /** App móvil sin chip: FE + GRE/GRT del periodo (no omite guías). */
  ALL: {
    facturas: true,
    gre: true,
    tiposFactura: ['01', '03', '07', '08'],
    consultas: ['11', '14', '16'],
    tiposGre: ['09', '31'],
    label: 'todos',
  },
};

function resolveSyncScope(docRaw) {
  const doc = String(docRaw || '').trim().toUpperCase();
  if (doc && DOC_SYNC_SCOPE[doc]) {
    return { doc, ...DOC_SYNC_SCOPE[doc] };
  }
  // Sin chip: ALL (antes caía en FACT y la app nunca importaba GRE).
  return { doc: 'ALL', ...DOC_SYNC_SCOPE.ALL };
}

function periodoActualPeru() {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Lima',
    year: 'numeric',
    month: '2-digit',
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(new Date()).map((p) => [p.type, p.value]),
  );
  return `${parts.year}${parts.month}`;
}

function normalizePeriodo(raw) {
  if (!raw) return periodoActualPeru();
  const digits = String(raw).replace(/\D/g, '');
  if (/^\d{6}$/.test(digits)) return digits;
  if (/^\d{4}-\d{2}/.test(String(raw))) {
    return String(raw).slice(0, 7).replace('-', '');
  }
  const err = new Error('periodo inválido (usa YYYYMM).');
  err.status = 400;
  throw err;
}

function lockKey(ruc, periodo) {
  return `${ruc}:${periodo}`;
}

/**
 * @param {string} companyRuc
 * @param {{ periodo?: string, force?: boolean, doc?: string, apiBaseUrl?: string|null }} options
 */
async function sincronizarRecibidos(companyRuc, options = {}) {
  const company = await companyModel.findByRuc(companyRuc);
  if (!company) {
    const err = new Error('Empresa no encontrada.');
    err.status = 404;
    throw err;
  }

  const isProd = isProductionEntorno(company.entorno);
  const tieneCredencialesSire = Boolean(
    (company.sireClientId || company.clientId)
    && (company.sireClientSecret || company.clientSecret),
  );

  if (isProd && (!company.solUser || !company.solPass)) {
    const err = new Error('Falta usuario/clave SOL en la empresa para consultar SUNAT.');
    err.status = 400;
    throw err;
  }

  const periodo = normalizePeriodo(options.periodo);
  const force = Boolean(options.force);
  const scope = resolveSyncScope(options.doc || options.tipoDoc || options.tipo);
  const key = lockKey(company.ruc, `${periodo}:${scope.doc || 'ALL'}`);

  const lockStarted = locks.get(key);
  if (lockStarted != null) {
    const lockAge = Date.now() - lockStarted;
    if (lockAge < SYNC_LOCK_MAX_MS) {
      return {
        success: true,
        skipped: true,
        reason: 'sync_en_curso',
        message: 'Ya hay una sincronización en curso para este periodo.',
        periodo,
        doc: scope.doc || null,
        fuente: isProd ? 'sire_sspp_gre' : 'sin_sunat',
      };
    }
    locks.delete(key);
  }

  const last = lastOkAt.get(key) || 0;
  const esMesActual = periodo === periodoActualPeru();
  const cooldownMs = esMesActual ? COOLDOWN_MES_ACTUAL_MS : COOLDOWN_MS;
  if (!force && Date.now() - last < cooldownMs) {
    return {
      success: true,
      skipped: true,
      reason: 'cooldown',
      message: esMesActual
        ? 'Compras del mes actual ya sincronizadas hace unos segundos.'
        : 'Compras ya sincronizadas hace poco. Mostrando lo de la base.',
      periodo,
      doc: scope.doc || null,
      cooldown_segundos: Math.ceil((cooldownMs - (Date.now() - last)) / 1000),
      fuente: isProd ? 'sire_sspp_gre' : 'sin_sunat',
    };
  }

  locks.set(key, Date.now());
  const started = Date.now();
  try {
    let sire = null;
    let xmlEnrich = null;
    let greScraper = null;
    let greScraperError = null;
    let facturasScraper = null;
    let facturasScraperError = null;

    // Por defecto NO usamos SIRE RCE: trae el registro de compras completo
    // (otros meses / bancos / etc.) y no coincide con "Consultar Factura y Nota".
    // Fuente oficial de FE/NC/ND recibidas = scraper ww1 del periodo seleccionado.
    const usarSire = String(process.env.SUNAT_SYNC_USE_SIRE || '').toLowerCase() === 'true';
    if (usarSire && isProd && tieneCredencialesSire && scope.facturas && !scope.doc) {
      try {
        sire = await sireRceImportService.importarComprasDelPeriodo(company.ruc, periodo);
        xmlEnrich = await enriquecerRecibidosSinXml(company, periodo, options.apiBaseUrl || null);
      } catch (err) {
        console.warn('[sync-recibidos] SIRE:', err.message);
        greScraperError = greScraperError || `SIRE: ${err.message}`;
      }
    }

    if (isProd && company.solUser && company.solPass) {
      if (scope.facturas) {
        try {
          facturasScraper = await facturasRecibidosSyncService.importarFacturasDesdeScraper(company.ruc, {
            periodo,
            apiBaseUrl: options.apiBaseUrl || null,
            filasSire: null,
            tipos: scope.tiposFactura || undefined,
            consultas: scope.consultas || undefined,
          });
        } catch (err) {
          console.warn('[sync-recibidos] Facturas scraper:', err.message);
          facturasScraperError = err.message;
        }
      }

      if (scope.gre) {
        // Con force o filtro GRE/GRT siempre consultar portal (no omitir por “ya en base”).
        const necesitaGre = force || Boolean(scope.doc)
          || await facturasRecibidosSyncService.necesitaGreScraper(company.ruc, periodo);

        if (necesitaGre) {
          try {
            const rangoGre = periodoYyyyMmToRangoIso(periodo, { capHoy: true });
            greScraper = await greRecibidosSyncService.importarGreDesdeScraper(company.ruc, {
              periodo,
              fecha_inicio: rangoGre.fecha_inicio,
              fecha_fin: rangoGre.fecha_fin,
              tipos: scope.tiposGre || undefined,
              apiBaseUrl: options.apiBaseUrl || null,
            });
          } catch (err) {
            console.warn('[sync-recibidos] GRE scraper:', err.message);
            greScraperError = err.message;
          }
        } else {
          greScraper = {
            omitido: true,
            mensaje: 'GRE del periodo ya descargadas.',
            candidatos: 0,
            creados: 0,
            enriquecidos: 0,
            duplicados: 0,
            gre_r: 0,
            gre_t: 0,
          };
        }
      }
    }

    const dedupe = await compraModel.dedupeComprasDuplicadasEnBd(company.ruc);

    const guiasAgregado = {
      candidatos: greScraper?.candidatos || 0,
      creados: greScraper?.creados || 0,
      enriquecidos: greScraper?.enriquecidos || 0,
      duplicados: greScraper?.duplicados || 0,
      gre_r: greScraper?.gre_r || 0,
      gre_t: greScraper?.gre_t || 0,
    };

    lastOkAt.set(key, Date.now());

    const partes = [];
    if (scope.doc) partes.push(`filtro ${scope.label}`);
    if (usarSire && isProd && sire) {
      partes.push('SIRE (opcional)');
    }
    if (scope.facturas) {
      if (facturasScraper?.omitido) {
        partes.push('facturas ya en base');
      } else if (facturasScraper && ((facturasScraper.creados || 0) + (facturasScraper.enriquecidos || 0) > 0)) {
        partes.push(
          `Consultar Factura ${periodo} (${facturasScraper.creados || 0} nuevos, ${facturasScraper.con_lineas || 0} con ítems)`,
        );
      } else if (facturasScraper && (facturasScraper.total_scraper || 0) === 0) {
        partes.push(`sin FE/NC/ND en ${periodo}`);
      } else if (facturasScraperError) {
        partes.push(`facturas: ${facturasScraperError}`);
      }
    }
    if (scope.gre) {
      if (greScraper?.omitido) {
        partes.push('GRE ya en base');
      } else if (greScraper && ((greScraper.creados || 0) + (greScraper.enriquecidos || 0) > 0)) {
        partes.push(
          `GRE portal (${greScraper.gre_r || 0} remitente, ${greScraper.gre_t || 0} transportista)`,
        );
      } else if (greScraper && (greScraper.total_scraper || 0) === 0) {
        partes.push(`sin GRE en ${periodo}`);
      } else if (greScraperError) {
        partes.push(`GRE: ${greScraperError}`);
      }
    }

    return {
      success: true,
      skipped: false,
      periodo,
      doc: scope.doc || null,
      scope: scope.label,
      fuente: isProd ? 'ww1_gre' : 'sin_sunat',
      message: isProd
        ? (partes.length
          ? `Comprobantes del periodo ${periodo}: ${partes.join(' · ')}.`
          : `Periodo ${periodo} al día: no había comprobantes nuevos.`)
        : 'Entorno beta: no se importan GRE de prueba. Pon la empresa en producción con SOL para sincronizar SUNAT.',
      sire: sire
        ? {
            encontrados: sire.encontrados,
            creados: sire.creados,
            enriquecidos: sire.enriquecidos,
            duplicados: sire.duplicados,
            sspp_ok: sire.sspp_ok,
            sspp_fallback: sire.sspp_fallback,
            errores: sire.errores?.slice?.(0, 20) || sire.errores || [],
          }
        : null,
      xml_enrich: xmlEnrich,
      facturas_scraper: facturasScraper,
      facturas_scraper_error: facturasScraperError || undefined,
      gre_scraper: greScraper,
      gre_scraper_error: greScraperError || undefined,
      guias: {
        soportado: true,
        scraper: greScraper,
        ...guiasAgregado,
        message: greScraperError
          ? `GRE scraper: ${greScraperError}`
          : 'GRE recibidas (otros → tu RUC) vía scraper SOL.',
      },
      duracion_ms: Date.now() - started,
      dedupe,
    };
  } finally {
    locks.delete(key);
  }
}

/**
 * Segunda pasada: recibidos del periodo sin xml_url → intenta SSPP otra vez.
 */
async function enriquecerRecibidosSinXml(company, periodo, apiBaseUrl) {
  const { desde, hasta } = periodoYyyyMmToRangoIso(periodo, { capHoy: false });

  const compraModel = require('../models/compraModel');
  const rows = await compraModel.listSinXml(company.ruc, { desde, hasta, take: 80 });

  const out = {
    candidatos: rows.length,
    xml_ok: 0,
    pdf_ok: 0,
    fallidos: 0,
  };

  for (const compra of rows) {
    const fromSspp = await intentarParsedDesdeSspp(company, {
      emisor_ruc: compra.proveedorNumeroDoc,
      tipo_doc: compra.tipoDoc,
      serie: compra.serie,
      correlativo: compra.correlativo,
      fecha_emision: toFechaApi(compra.fechaEmision),
      monto: compra.mtoImpVenta,
    });
    if (!fromSspp?.parsed) {
      out.fallidos += 1;
      continue;
    }
    try {
      const r = await registrarInvoiceRecibido(company, fromSspp.parsed, {
        fuente: 'sire_sspp',
        reemplazarResumen: true,
        xml: fromSspp.xml,
        pdfBuffer: fromSspp.pdf,
        apiBaseUrl,
      });
      if (r.archivos?.xml_url || fromSspp.xml) out.xml_ok += 1;
      if (r.archivos?.pdf_url || fromSspp.pdf) out.pdf_ok += 1;
    } catch {
      out.fallidos += 1;
    }
  }

  return out;
}

function toFechaApi(value) {
  if (!value) return null;
  const s = String(value);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  return s;
}

module.exports = {
  sincronizarRecibidos,
  normalizePeriodo,
  periodoActualPeru,
  COOLDOWN_MS,
  COOLDOWN_MES_ACTUAL_MS,
};
