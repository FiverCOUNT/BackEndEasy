const JSZip = require('jszip');
const prisma = require('../config/prisma');
const companyModel = require('../models/companyModel');
const { isProductionEntorno } = require('./credencialesSunatService');
const { getSireAccessToken } = require('./sunatOauthService');
const {
  registrarInvoiceRecibido,
  intentarParsedDesdeSspp,
} = require('./ssppReceptorService');
const { normalizeCorrelativoCompra } = require('../models/compraModel');

const SIRE_BASE = (process.env.SUNAT_SIRE_BASE || 'https://api-sire.sunat.gob.pe').replace(/\/$/, '');
const COD_LIBRO_RCE = '080000';

/**
 * Importa la propuesta SIRE RCE (compras) de un periodo YYYYMM
 * y guarda cada CPE en tabla `compras` (receptor = tu RUC).
 */
async function importarComprasDelPeriodo(companyRuc, periodoRaw = null) {
  const company = await companyModel.findByRuc(companyRuc);
  if (!company) {
    const err = new Error('Empresa no encontrada.');
    err.status = 404;
    throw err;
  }
  if (!isProductionEntorno(company.entorno)) {
    const err = new Error('Importar compras SIRE solo está disponible en entorno producción.');
    err.status = 403;
    throw err;
  }

  const periodo = normalizePeriodo(periodoRaw);
  const token = await getSireAccessToken({
    clientId: company.sireClientId || company.clientId,
    clientSecret: company.sireClientSecret || company.clientSecret,
    ruc: company.ruc,
    solUser: company.solUser,
    solPass: company.solPass,
  });
  assertTokenTieneSire(token);

  const { numTicket } = await solicitarExportacionPropuesta(token, periodo);
  const ticket = await esperarTicketListo(token, periodo, numTicket);
  const buffer = await descargarArchivoTicket(token, {
    periodo,
    numTicket,
    nomArchivoReporte: ticket.nomArchivoReporte,
    codTipoArchivoReporte: ticket.codTipoArchivoReporte || '00',
    codProceso: ticket.codProceso || '1',
  });

  const txt = await extractTextFromZipOrBuffer(buffer);
  const filas = parsePropuestaRceTxt(txt, company.ruc);

  const resultados = {
    periodo,
    ticket: numTicket,
    encontrados: filas.length,
    filas,
    creados: 0,
    enriquecidos: 0,
    duplicados: 0,
    sspp_ok: 0,
    sspp_fallback: 0,
    errores: [],
    invoices: [],
  };

  for (const fila of filas) {
    try {
      let parsed = filaToParsedCompra(fila, company.ruc);
      let fuente = 'sire_rce';
      let xml = null;
      let pdfBuffer = null;
      const fromSspp = await intentarParsedDesdeSspp(company, {
        emisor_ruc: fila.emisorRuc,
        tipo_doc: fila.tipoDoc,
        serie: fila.serie,
        correlativo: fila.correlativo,
        fecha_emision: fila.fechaEmision,
        monto: fila.mtoImpVenta,
      });
      if (fromSspp?.parsed?.lineas?.length) {
        // Conservar razón social SIRE si el XML viene corto.
        const parsedSspp = fromSspp.parsed;
        if (!parsedSspp.proveedor?.razon_social || parsedSspp.proveedor.razon_social === parsedSspp.proveedor.numero_doc) {
          parsedSspp.proveedor = {
            ...parsedSspp.proveedor,
            razon_social: parsed.proveedor.razon_social,
          };
        }
        parsed = parsedSspp;
        xml = fromSspp.xml || null;
        pdfBuffer = fromSspp.pdf || null;
        fuente = 'sire_sspp';
        resultados.sspp_ok += 1;
      } else {
        resultados.sspp_fallback += 1;
      }

      const r = await registrarInvoiceRecibido(company, parsed, {
        fuente,
        reemplazarResumen: true,
        xml,
        pdfBuffer,
      });
      if (r.creado) {
        resultados.creados += 1;
        resultados.invoices.push({
          id: r.invoice?.id,
          emisor: parsed.proveedor.numero_doc,
          tipo_doc: parsed.tipo_doc,
          serie: parsed.serie,
          correlativo: parsed.correlativo,
          fuente,
          lineas: parsed.lineas?.length || 0,
        });
      } else if (r.enriquecido) {
        resultados.enriquecidos += 1;
        resultados.invoices.push({
          id: r.invoice?.id,
          emisor: parsed.proveedor.numero_doc,
          tipo_doc: parsed.tipo_doc,
          serie: parsed.serie,
          correlativo: parsed.correlativo,
          fuente,
          enriquecido: true,
          lineas: parsed.lineas?.length || 0,
        });
      } else if (r.duplicado) {
        resultados.duplicados += 1;
      }
    } catch (e) {
      resultados.errores.push({
        serie: fila.serie,
        correlativo: fila.correlativo,
        emisor: fila.emisorRuc,
        message: e.message,
      });
    }
  }

  try {
    await prisma.company.updateMany({
      where: { ruc: company.ruc },
      data: { sireLastPeriodSynced: periodo },
    });
  } catch (_) {
    /* opcional */
  }

  return resultados;
}

function normalizePeriodo(value) {
  if (value && /^\d{6}$/.test(String(value).trim())) return String(value).trim();
  const now = new Date();
  // Periodo Perú (UTC-5)
  const pe = new Date(now.getTime() - 5 * 60 * 60 * 1000);
  const y = pe.getUTCFullYear();
  const m = String(pe.getUTCMonth() + 1).padStart(2, '0');
  return `${y}${m}`;
}

function decodeJwtPayload(token) {
  try {
    const part = String(token || '').split('.')[1];
    if (!part) return null;
    const json = Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    return JSON.parse(json);
  } catch {
    return null;
  }
}

/** Las credenciales API deben incluir recurso api-sire; las solo-CPE/SSPP fallan aquí. */
function assertTokenTieneSire(token) {
  const payload = decodeJwtPayload(token);
  if (!payload) return;
  const audRaw = typeof payload.aud === 'string' ? payload.aud : JSON.stringify(payload.aud || '');
  const hasSire = /api-sire\.sunat\.gob\.pe/i.test(audRaw);
  if (hasSire) return;

  const err = new Error(
    'Tus Credenciales API SUNAT no tienen acceso a SIRE (api-sire). '
      + 'En SOL → Empresas → Credenciales de API SUNAT genera (o regenera) credenciales con alcance SIRE '
      + 'y guárdalas en la empresa (client_id/secret o sire_client_id/secret). '
      + 'Sin eso no se puede importar el mes de compras; SSPP solo trae un CPE si ya conoces emisor/serie/número.',
  );
  err.status = 403;
  err.sunat = {
    aud: payload.aud || null,
    apis: 'cpe/sspp/gem (sin sire)',
  };
  throw err;
}

async function solicitarExportacionPropuesta(token, periodo) {
  const url = new URL(
    `${SIRE_BASE}/v1/contribuyente/migeigv/libros/rce/propuesta/web/propuesta/${periodo}/exportacioncomprobantepropuesta`,
  );
  url.searchParams.set('codTipoArchivo', '0'); // txt
  url.searchParams.set('codOrigenEnvio', '2');

  const res = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
  });
  const data = await readJson(res);
  const numTicket = data?.numTicket || data?.num_ticket || data?.ticket;
  if (!res.ok || !numTicket) {
    const err = new Error(
      data?.msg
        || data?.message
        || data?.errors?.[0]?.msg
        || `SIRE no generó ticket de propuesta (HTTP ${res.status}).`,
    );
    err.status = res.status === 422 ? 422 : 502;
    err.sunat = data;
    throw err;
  }
  return { numTicket: String(numTicket) };
}

async function esperarTicketListo(token, periodo, numTicket, { maxMs = 300_000 } = {}) {
  const started = Date.now();
  let delay = 3000;
  while (Date.now() - started < maxMs) {
    const info = await consultarTicket(token, periodo, numTicket);
    const estado = String(
      info.detalleTicket?.codEstadoEnvio
        || info.codEstadoEnvio
        || info.codEstadoProceso
        || '',
    ).trim();
    const archivo = Array.isArray(info.archivoReporte)
      ? info.archivoReporte[0]
      : (info.archivoReporte || null);
    const nom = info.detalleTicket?.nomArchivoReporte
      || info.nomArchivoReporte
      || archivo?.nomArchivoReporte
      || null;
    const des = String(
      info.detalleTicket?.desEstadoEnvio
        || info.desEstadoEnvio
        || info.desEstadoProceso
        || '',
    );

    // Terminado con archivo listo
    if (nom && ['03', '04', '06', '07', '10', '3', '4'].includes(estado)) {
      return {
        ...info,
        nomArchivoReporte: nom,
        codTipoArchivoReporte:
          archivo?.codTipoArchivoReporte
          || archivo?.codTipoAchivoReporte // typo que a veces envía SUNAT
          || info.codTipoArchivoReporte
          || info.detalleTicket?.codTipoArchivoReporte
          || '00',
        // codProceso del ticket de exportación RCE suele ser 10
        codProceso: info.codProceso || '10',
      };
    }
    // Si ya hay nombre de archivo, descargar aunque el código no esté mapeado
    if (nom && !['01', '02', '05'].includes(estado)) {
      return {
        ...info,
        nomArchivoReporte: nom,
        codTipoArchivoReporte:
          archivo?.codTipoArchivoReporte
          || info.codTipoArchivoReporte
          || '00',
        codProceso: info.codProceso || '10',
      };
    }

    // Fallidos reales (01/02/03/05 = en cola o en proceso)
    if (['07', '08', '09', '10', '11'].includes(estado) || /error|rechaz|falla/i.test(des)) {
      // Si ya tiene archivo a pesar del código raro, no fallar
      if (!nom) {
        const err = new Error(
          `Ticket SIRE ${numTicket} falló (estado ${estado}: ${des || 'sin detalle'}).`,
        );
        err.status = 502;
        err.sunat = info;
        throw err;
      }
    }

    await sleep(delay);
    delay = Math.min(delay * 1.4, 20000);
  }
  const err = new Error(`Timeout esperando ticket SIRE ${numTicket}.`);
  err.status = 504;
  throw err;
}

async function consultarTicket(token, periodo, numTicket) {
  const url = new URL(
    `${SIRE_BASE}/v1/contribuyente/migeigv/libros/rvierce/gestionprocesosmasivos/web/masivo/consultaestadotickets`,
  );
  url.searchParams.set('perIni', periodo);
  url.searchParams.set('perFin', periodo);
  url.searchParams.set('page', '1');
  url.searchParams.set('perPage', '20');
  url.searchParams.set('numTicket', numTicket);
  url.searchParams.set('codLibro', COD_LIBRO_RCE);
  url.searchParams.set('codOrigenEnvio', '2');

  const res = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
  });
  const data = await readJson(res);
  if (!res.ok) {
    const err = new Error(data?.msg || data?.message || `Error consultando ticket SIRE (${res.status}).`);
    err.status = 502;
    err.sunat = data;
    throw err;
  }
  const registros = Array.isArray(data?.registros) ? data.registros : [];
  const reg = registros.find((r) => String(r?.numTicket || '') === String(numTicket))
    || registros[0]
    || null;
  return {
    ...(reg || data || {}),
    detalleTicket: reg?.detalleTicket || data?.detalleTicket || null,
    archivoReporte: reg?.archivoReporte || data?.archivoReporte || null,
  };
}

async function descargarArchivoTicket(token, opts) {
  const url = new URL(
    `${SIRE_BASE}/v1/contribuyente/migeigv/libros/rvierce/gestionprocesosmasivos/web/masivo/archivoreporte`,
  );
  url.searchParams.set('nomArchivoReporte', opts.nomArchivoReporte);
  url.searchParams.set('codTipoArchivoReporte', String(opts.codTipoArchivoReporte || '00'));
  url.searchParams.set('perTributario', opts.periodo);
  url.searchParams.set('codProceso', String(opts.codProceso || '1'));
  url.searchParams.set('numTicket', opts.numTicket);

  const res = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/zip, application/octet-stream, */*',
    },
  });
  if (!res.ok) {
    const data = await readJson(res).catch(() => null);
    const err = new Error(data?.msg || data?.message || `No se pudo descargar archivo SIRE (${res.status}).`);
    err.status = 502;
    err.sunat = data;
    throw err;
  }
  const ab = await res.arrayBuffer();
  return Buffer.from(ab);
}

async function extractTextFromZipOrBuffer(buffer) {
  if (!buffer?.length) return '';
  // ZIP magic
  if (buffer[0] === 0x50 && buffer[1] === 0x4b) {
    const zip = await JSZip.loadAsync(buffer);
    const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir);
    const preferred = names.find((n) => /\.(txt|csv)$/i.test(n)) || names[0];
    if (!preferred) return '';
    return zip.files[preferred].async('string');
  }
  return buffer.toString('utf8');
}

/**
 * Parser de propuesta RCE (|). Formato oficial (cabecera del archivo SUNAT):
 * 0 RUC receptor | 1 razón receptor | 2 periodo | 3 CAR | 4 fecha emisión |
 * 5 fecha vcto | 6 tipo CP | 7 serie | 8 año | 9 nro CP | 10 nro final |
 * 11 tipo doc proveedor | 12 nro doc proveedor | 13 razón proveedor |
 * 14 BI DG | 15 IGV DG | ... | 24 Total CP | 25 Moneda
 */
function parsePropuestaRceTxt(txt, receptorRuc = null) {
  const receptor = String(receptorRuc || '').replace(/\D/g, '');
  const lines = String(txt || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const out = [];

  for (const line of lines) {
    if (/^RUC\|/i.test(line) || /^(periodo|tipo)\b/i.test(line)) continue;
    const cells = line.split('|').map((p) => String(p || '').trim());
    if (cells.length < 14) continue;

    const tipoDoc = String(cells[6] || '').padStart(2, '0');
    if (!/^(01|03|07|08|09|31)$/.test(tipoDoc)) continue;

    const serie = String(cells[7] || '').toUpperCase();
    const correlativo = normalizeCorrelativoCompra(cells[9]);
    let emisorRuc = String(cells[12] || '').replace(/\D/g, '');
    const emisorRazonSocial = String(cells[13] || '').trim() || emisorRuc;
    const fechaEmision = cells[4] || null;
    const moneda = cells[25] || 'PEN';
    const bi = Number(String(cells[14] || '0').replace(/,/g, '')) || 0;
    const igv = Number(String(cells[15] || '0').replace(/,/g, '')) || 0;
    const total = Number(String(cells[24] || '0').replace(/,/g, '')) || 0;

    // Fallback: si col 12 no es RUC, busca otro RUC distinto al receptor
    if (emisorRuc.length !== 11) {
      const rucs = cells
        .map((c) => String(c).replace(/\D/g, ''))
        .filter((c) => c.length === 11 && c !== receptor);
      emisorRuc = rucs[0] || '';
    }

    if (!emisorRuc || emisorRuc.length !== 11 || !serie || !correlativo) continue;
    if (receptor && emisorRuc === receptor) continue;

    out.push({
      tipoDoc,
      serie,
      correlativo,
      emisorRuc,
      emisorRazonSocial,
      fechaEmision,
      tipoMoneda: moneda || 'PEN',
      mtoOperGravadas: bi || null,
      mtoIgv: igv || null,
      mtoImpVenta: total || null,
      raw: line,
    });
  }

  const seen = new Set();
  return out.filter((r) => {
    const k = `${r.emisorRuc}|${r.tipoDoc}|${r.serie}|${r.correlativo}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function etiquetaTipoDocCpe(tipo) {
  const t = String(tipo || '').padStart(2, '0');
  return (
    {
      '01': 'Factura',
      '03': 'Boleta',
      '07': 'Nota de crédito',
      '08': 'Nota de débito',
      '09': 'Guía de remisión',
      31: 'Guía transportista',
    }[t] || `Documento ${t}`
  );
}

function filaToParsedCompra(fila, receptorRuc = null) {
  const total = Number(fila.mtoImpVenta) || 0;
  const bi = Number(fila.mtoOperGravadas) || 0;
  const sub = bi
    || (total > 0 ? Math.round((total / 1.18) * 100) / 100 : 0);
  const igv = Number(fila.mtoIgv)
    || (total > 0 && bi > 0 ? Math.round((total - sub) * 100) / 100 : 0);
  // La propuesta RCE no trae ítems UBL: armamos un resumen legible.
  // Con BI gravado → producto inventariable (NIU) para ingreso a almacén.
  // Sin BI (p.ej. comisiones bancarias) → servicio ZZ.
  const esInventariable = bi > 0;
  const unidad = esInventariable ? 'NIU' : 'ZZ';
  const proveedor = String(fila.emisorRazonSocial || fila.emisorRuc || 'Proveedor').trim();
  const tipoEtiqueta = etiquetaTipoDocCpe(fila.tipoDoc);
  const docRef = `${fila.serie}-${fila.correlativo}`;
  const esGre = /^(09|31)$/.test(String(fila.tipoDoc || '').padStart(2, '0'));
  const nombre = (
    esGre
      ? `GRE · ${proveedor}`
      : (esInventariable ? `Compra · ${proveedor}` : `Servicio · ${proveedor}`)
  ).slice(0, 255);
  const descripcion = `${nombre} · ${tipoEtiqueta} ${docRef}`.slice(0, 500);
  const codigo = `CMP-${fila.emisorRuc}-${fila.serie}-${fila.correlativo}`.slice(0, 64);

  return {
    tipo_doc: fila.tipoDoc,
    serie: fila.serie,
    correlativo: fila.correlativo,
    fecha_emision: fila.fechaEmision,
    tipo_moneda: fila.tipoMoneda || 'PEN',
    proveedor: {
      tipo_doc: '6',
      numero_doc: fila.emisorRuc,
      razon_social: fila.emisorRazonSocial || fila.emisorRuc,
    },
    receptor: { numero_doc: receptorRuc || null },
    sub_total: esGre ? 0 : (sub || null),
    mto_igv: esGre ? 0 : (igv || null),
    mto_imp_venta: esGre ? 0 : (total || null),
    lineas: (total || esGre)
      ? [{
          nombre,
          descripcion,
          cantidad: 1,
          unidad: esGre ? 'NIU' : unidad,
          precio_unitario: esGre ? 0 : total,
          codigo,
          kind: esGre || esInventariable ? 'PRODUCT' : 'SERVICE',
        }]
      : [],
    ...(esGre
      ? {
          guia_meta: {
            rol_recibido: 'DESTINATARIO',
            pendiente_sspp: true,
            envio: {
              cod_traslado: '01',
              mod_traslado: '01',
            },
          },
        }
      : {}),
  };
}

async function readJson(res) {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

module.exports = {
  importarComprasDelPeriodo,
  parsePropuestaRceTxt,
  filaToParsedCompra,
  normalizePeriodo,
};
