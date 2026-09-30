/**
 * Facturas/boletas recibidas del scraper SOL → compras.
 * Ítems desde XML UBL; cabecera desde propuesta RCE + consulta portal.
 */
const { parseUblCompraXml } = require('./ublCompraParser');

const TIPOS_SOPORTADOS = new Set(['01', '03', '07', '08']);

function digits(value) {
  return String(value || '').replace(/\D/g, '');
}

function normalizeCorrelativo(value) {
  const n = digits(value);
  return n.replace(/^0+/, '') || '0';
}

function resolveTipoDoc(factura) {
  const cod = String(factura?.tipo || factura?.cod_cpe || '').padStart(2, '0');
  if (TIPOS_SOPORTADOS.has(cod)) return cod;
  return '01';
}

function emisorRucFromFactura(factura) {
  return digits(factura?.ruc_emisor || factura?.emisor?.ruc || factura?.emisor);
}

function resolveSerieCorrelativo(factura) {
  const serie = String(factura?.serie || '').trim().toUpperCase();
  const correlativo = normalizeCorrelativo(factura?.numero ?? factura?.correlativo);
  return { serie, correlativo };
}

function parseFechaEmision(factura) {
  const consulta = factura?.consulta && typeof factura.consulta === 'object' ? factura.consulta : {};
  const raw = String(
    factura?.fecha_emision
    || factura?.fechaEmision
    || factura?.fec_emision
    || factura?.fecha
    || consulta['Fecha de emisión']
    || consulta['Fecha de emision']
    || consulta['Fecha Emisión']
    || consulta['Fecha Emision']
    || consulta.fecha_emision
    || '',
  ).trim();
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  const m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return raw || null;
}

function parseImporte(value) {
  if (value == null || value === '') return null;
  const n = Number(String(value).replace(/[^\d.,-]/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

/** Solo CPE que otros emitieron hacia tu RUC (compras recibidas). */
function facturaAplicaParaReceptor(factura, receptorRuc) {
  const target = digits(receptorRuc);
  const emisor = emisorRucFromFactura(factura);
  if (!target || !emisor) return false;
  return emisor !== target;
}

function decodeXmlFromFactura(factura) {
  if (!factura?.xml_base64) return null;
  try {
    const xml = Buffer.from(String(factura.xml_base64).replace(/\s/g, ''), 'base64').toString('utf8');
    return xml.startsWith('<') ? xml : null;
  } catch {
    return null;
  }
}

function totalesDesdeFactura(factura, lineas) {
  const sumLineas = lineas.reduce(
    (s, l) => s + (Number(l.precio_unitario) || 0) * (Number(l.cantidad) || 1),
    0,
  );
  let total = parseImporte(factura?.importe_total || factura?.total || factura?.consulta?.['Importe total']);
  if ((total == null || total === 0) && sumLineas > 0) {
    total = Math.round(sumLineas * 100) / 100;
  }
  let subTotal = parseImporte(factura?.subtotal);
  let mtoIgv = parseImporte(factura?.igv);
  if (subTotal == null && total != null) {
    subTotal = Math.round((total / 1.18) * 100) / 100;
  }
  if (mtoIgv == null && total != null && subTotal != null) {
    mtoIgv = Math.round((total - subTotal) * 100) / 100;
  }
  return {
    sub_total: subTotal,
    mto_igv: mtoIgv,
    mto_imp_venta: total,
  };
}

function lineasFromFacturaItems(factura) {
  const items = factura?.items;
  if (!Array.isArray(items) || !items.length) return [];
  return items.map((it, idx) => {
    const desc = String(it.descripcion || it.desItem || `Ítem ${idx + 1}`).trim();
    const cantidad = Number(String(it.cantidad || '1').replace(',', '.')) || 1;
    const pu = parseImporte(it.precio_unitario) ?? parseImporte(it.valor_venta) ?? 0;
    const unidad = String(it.unidad || 'NIU').slice(0, 8);
    return {
      nombre: desc.slice(0, 255),
      descripcion: desc.slice(0, 500),
      cantidad,
      unidad,
      precio_unitario: pu,
      codigo: String(it.codigo || it.desCodigo || '').slice(0, 64) || null,
      kind: unidad.toUpperCase() === 'ZZ' ? 'SERVICE' : 'PRODUCT',
    };
  });
}

function esNombreSoloRuc(nombre, ruc) {
  const v = String(nombre || '').trim();
  if (!v) return true;
  const digits = v.replace(/\D/g, '');
  const r = String(ruc || '').replace(/\D/g, '');
  return digits === r || /^\d{11}$/.test(v);
}

/** Razón social del emisor desde respuesta FE Recibidas (formulario Consulta CPE). */
function nombreEmisorDesdeConsultaSunat(factura, emisorRuc) {
  const consulta = factura?.consulta && typeof factura.consulta === 'object'
    ? factura.consulta
    : {};
  const candidatos = [
    factura?.razon_social,
    factura?.emisor?.razon_social,
    factura?.emisor?.desRazonSocialEmis,
    consulta['Apellidos y nombres, denominación o razón social'],
    consulta['Apellidos y Nombres, Denominación o Razón Social'],
    consulta['Razón social'],
    consulta['Razon social'],
    consulta['Denominación'],
    consulta['Denominacion'],
    consulta['Nombre comercial'],
  ];

  for (const [clave, valor] of Object.entries(consulta)) {
    const k = String(clave || '').toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
    if (k.includes('receptor')) continue;
    if (k.includes('razon') || k.includes('denominacion') || k.includes('nombre') || k.includes('apellidos')) {
      candidatos.push(valor);
    }
  }

  for (const cand of candidatos) {
    const s = String(cand || '').trim();
    if (s && !esNombreSoloRuc(s, emisorRuc)) return s.slice(0, 255);
  }
  return null;
}

function inferNombreDesdeItems(factura, emisorRuc) {
  const items = factura?.items;
  if (!Array.isArray(items)) return null;
  for (const it of items) {
    const desc = String(it.descripcion || it.desItem || '').trim();
    if (desc && !esNombreSoloRuc(desc, emisorRuc)) {
      return desc.slice(0, 255);
    }
  }
  return null;
}

function facturaJsonToParsed(factura, receptorCompany, xml = null) {
  const { serie, correlativo } = resolveSerieCorrelativo(factura);
  const emisorRuc = emisorRucFromFactura(factura);
  const emisorNombre = nombreEmisorDesdeConsultaSunat(factura, emisorRuc)
    || inferNombreDesdeItems(factura, emisorRuc)
    || emisorRuc;

  if (xml) {
    try {
      const parsed = parseUblCompraXml(xml);
      const nombreSunat = nombreEmisorDesdeConsultaSunat(factura, emisorRuc);
      if (
        !parsed.proveedor?.razon_social
        || esNombreSoloRuc(parsed.proveedor.razon_social, emisorRuc)
      ) {
        parsed.proveedor = {
          ...parsed.proveedor,
          razon_social: nombreSunat || emisorNombre || parsed.proveedor?.razon_social || emisorRuc,
        };
      }
      if (!parsed.lineas?.length) {
        parsed.lineas = lineasFromFacturaItems(factura);
      }
      if (!parsed.fecha_emision) {
        parsed.fecha_emision = parseFechaEmision(factura);
      }
      parsed.origen = 'FACTURAS_SCRAPER';
      return parsed;
    } catch {
      /* fallback resumen */
    }
  }

  const lineasApi = lineasFromFacturaItems(factura);
  if (lineasApi.length) {
    const tipoDoc = resolveTipoDoc(factura);
    const { sub_total: subTotal, mto_igv: mtoIgv, mto_imp_venta: total } = totalesDesdeFactura(factura, lineasApi);
    return {
      tipo_doc: tipoDoc,
      serie,
      correlativo,
      fecha_emision: parseFechaEmision(factura),
      tipo_moneda: factura?.moneda || 'PEN',
      proveedor: {
        tipo_doc: '6',
        numero_doc: emisorRuc,
        razon_social: emisorNombre || emisorRuc,
      },
      receptor: {
        tipo_doc: '6',
        numero_doc: receptorCompany.ruc,
        razon_social: receptorCompany.nombre || receptorCompany.ruc,
      },
      sub_total: subTotal,
      mto_igv: mtoIgv,
      mto_imp_venta: total,
      lineas: lineasApi,
      origen: 'FACTURAS_SCRAPER',
      en_camino: false,
    };
  }

  const tipoDoc = resolveTipoDoc(factura);
  const { sub_total: subTotal, mto_igv: mtoIgv, mto_imp_venta: total } = totalesDesdeFactura(factura, []);

  return {
    tipo_doc: tipoDoc,
    serie,
    correlativo,
    fecha_emision: parseFechaEmision(factura),
    tipo_moneda: 'PEN',
    proveedor: {
      tipo_doc: '6',
      numero_doc: emisorRuc,
      razon_social: emisorNombre || emisorRuc,
    },
    receptor: {
      tipo_doc: '6',
      numero_doc: receptorCompany.ruc,
      razon_social: receptorCompany.nombre || receptorCompany.ruc,
    },
    sub_total: subTotal,
    mto_igv: mtoIgv,
    mto_imp_venta: total,
    lineas: [],
    origen: 'FACTURAS_SCRAPER',
    en_camino: false,
  };
}

module.exports = {
  facturaJsonToParsed,
  facturaAplicaParaReceptor,
  decodeXmlFromFactura,
  resolveTipoDoc,
  TIPOS_SOPORTADOS,
};
