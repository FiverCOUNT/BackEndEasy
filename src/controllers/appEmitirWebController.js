const companyModel = require('../models/companyModel');
const clienteModel = require('../models/clienteModel');
const catalogItemModel = require('../models/catalogItemModel');
const comprobanteModel = require('../models/comprobanteModel');
const compraModel = require('../models/compraModel');
const ordenModel = require('../models/ordenModel');
const almacenModel = require('../models/almacenModel');
const metodoPagoModel = require('../models/metodoPagoModel');
const inventarioModel = require('../models/inventarioModel');
const movimientoModel = require('../models/movimientoModel');
const empresaVehiculoModel = require('../models/empresaVehiculoModel');
const empresaConductorModel = require('../models/empresaConductorModel');
const comprobanteEmisionService = require('../services/comprobanteEmisionService');
const { emptySunatDatos, parseSunatDatos, sunatParaBoleta, MEDIOS_PAGO_DETRACCION } = require('../services/sunatDatosEmitir');
const detraccionModel = require('../models/detraccionModel');
const greEventoService = require('../services/greEventoService');
const objectStorageService = require('../services/objectStorageService');
const { resolveTipoConfig } = require('../utils/seriesConfig');
const {
  MOTIVOS_TRASLADO_GRE,
  MODALIDADES_TRANSPORTE,
  UNIDADES_PESO,
  PASOS_GRE_REMITENTE,
  motivoPorCodigo,
} = require('../utils/greRemitenteCatalog');
const {
  PASOS_GRE_TRANSPORTISTA,
  PAGADORES_FLETE_GRE,
  UNIDADES_PESO_GRE_T,
  UNIDADES_BIEN_GRE,
  pagadorPorCodigo,
} = require('../utils/greTransportistaCatalog');
const {
  TIPOS_EVENTO_GRE,
  PASOS_GRE_EVENTO,
  tipoEventoPorCodigo,
} = require('../utils/greEventoCatalog');
const { GRE_ENVIO_INDICADORES } = require('../utils/greEnvioIndicadoresSunat');
const { appPath } = require('../config/appPanel');
const { parseOffsetLimit, buildOffsetPage } = require('../utils/pagination');
const {
  layoutLocals,
  companyRucOf,
  redirectWithFlash,
  parseFlash,
  formatDocRef,
  formatFecha,
  formatMoney,
  isWebCompanyAdmin,
  esGrePorEvento,
} = require('../utils/appWebHelpers');
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

const MAX_IMAGENES_EMIT = 3;
const IMAGE_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

/** Documentos afectados mostrados por página en el selector web. */
const DOCS_AFECTADOS_PAGE = 10;

/** Catálogo 09 SUNAT: motivos de nota de crédito. */
const MOTIVOS_NOTA_CREDITO = [
  { codigo: '01', titulo: 'Anulación de la operación', modo_items: 'anulacion' },
  { codigo: '02', titulo: 'Anulación por error en el RUC', modo_items: 'anulacion', pide_nueva_factura: true },
  { codigo: '03', titulo: 'Corrección por error en la descripción', modo_items: 'seleccion' },
  { codigo: '04', titulo: 'Descuento global', modo_items: 'descuento_global' },
  { codigo: '05', titulo: 'Descuento por ítem', modo_items: 'descuento' },
  { codigo: '06', titulo: 'Devolución total', modo_items: 'devolucion_total' },
  { codigo: '07', titulo: 'Devolución por ítem', modo_items: 'devolucion_item' },
  { codigo: '08', titulo: 'Bonificación', modo_items: 'seleccion' },
  { codigo: '09', titulo: 'Disminución en el valor', modo_items: 'descuento_global' },
];

/** Catálogo 10 SUNAT: motivos de nota de débito. */
const MOTIVOS_NOTA_DEBITO = [
  { codigo: '01', titulo: 'Intereses por mora', modo_items: 'monto' },
  { codigo: '02', titulo: 'Aumento en el valor', modo_items: 'aumento' },
  { codigo: '03', titulo: 'Penalidades / otros conceptos', modo_items: 'monto' },
];

function motivosNotaPorTipo(tipoKey) {
  if (tipoKey === 'NOTA_CREDITO') return MOTIVOS_NOTA_CREDITO;
  if (tipoKey === 'NOTA_DEBITO') return MOTIVOS_NOTA_DEBITO;
  return [];
}

/** Item liviano para el selector de documento afectado (venta emitida). */
function docAfectadoItem(row) {
  return {
    id: row.id,
    origen: 'venta',
    ref: formatDocRef(row),
    tipo_label: String(row.tipo_doc) === '03' ? 'Boleta' : 'Factura',
    cliente: row.cliente_razon_social || row.cliente_numero_doc || '—',
    cliente_doc: row.cliente_numero_doc || '',
    cliente_tipo_doc: row.cliente_tipo_doc || '6',
    cliente_razon_social: row.cliente_razon_social || '',
    fecha: formatFecha(row.fecha_emision),
    total: formatMoney(row.mto_imp_venta, row.tipo_moneda),
    estado: row.estado || '',
  };
}

/** Item liviano para compras recibidas (proveedor → tú). */
function docAfectadoItemCompra(row) {
  const tipo = String(row.tipo_doc || '').padStart(2, '0');
  const proveedor = row.company || {};
  return {
    id: row.id,
    origen: 'compra',
    ref: formatDocRef(row),
    tipo_label: tipo === '03' ? 'Boleta recibida' : 'Factura recibida',
    cliente: proveedor.nombre || proveedor.numero_doc || '—',
    cliente_doc: String(proveedor.numero_doc || '').replace(/\D/g, ''),
    cliente_tipo_doc: proveedor.tipo_doc || '6',
    cliente_razon_social: proveedor.nombre || '',
    fecha: formatFecha(row.fecha_emision),
    total: formatMoney(row.mto_imp_venta, row.tipo_moneda),
    estado: row.estado || '',
  };
}

async function docsAfectadosPage(
  companyRuc,
  { skip = 0, take = DOCS_AFECTADOS_PAGE, q = '', clienteDoc = '', tipoKey = '' } = {},
) {
  const { items, total } = await comprobanteModel.findVentasParaNotaPaginated(companyRuc, {
    skip,
    take,
    q,
    clienteDoc,
    // La nota de crédito consume líneas: si ya no quedan, el documento no se ofrece.
    conLineasActivas: tipoKey === 'NOTA_CREDITO',
  });
  const mapped = (items || []).map(docAfectadoItem);
  return {
    items: mapped,
    total,
    offset: skip,
    limit: take,
    fuente: 'ventas',
    cliente_doc: String(clienteDoc || '').replace(/\D/g, ''),
    has_more: skip + mapped.length < total,
    next_offset: skip + mapped.length,
  };
}

async function docsComprasPage(
  companyRuc,
  { skip = 0, take = DOCS_AFECTADOS_PAGE, q = '' } = {},
) {
  const page = await compraModel.listCpeParaGrePaginated(companyRuc, { skip, take, q });
  const mapped = (page.items || []).map(docAfectadoItemCompra);
  return {
    items: mapped,
    total: page.total || 0,
    offset: skip,
    limit: take,
    fuente: 'compras',
    cliente_doc: '',
    has_more: page.has_more === true,
    next_offset: page.next_offset != null ? page.next_offset : skip + mapped.length,
  };
}

/** GET /app/emitir/documentos-afectados — ventas emitidas y/o compras recibidas. */
async function documentosAfectadosJson(req, res, next) {
  try {
    const companyRuc = companyRucOf(res);
    const skip = Math.max(0, Number.parseInt(req.query.offset, 10) || 0);
    const takeRaw = Number.parseInt(req.query.limit, 10) || DOCS_AFECTADOS_PAGE;
    const take = Math.min(Math.max(takeRaw, 1), 50);
    const q = String(req.query.q || '').trim();
    const clienteDoc = String(req.query.cliente_doc || '').replace(/\D/g, '');
    const tipoKey = resolveTipoKey(req.query.tipo) || 'NOTA_CREDITO';
    const fuenteRaw = String(req.query.fuente || req.query.source || 'ventas').trim().toLowerCase();
    let fuente = 'ventas';
    if (['compras', 'compra', 'recibidos'].includes(fuenteRaw)) fuente = 'compras';
    else if (['mixto', 'ambos', 'all'].includes(fuenteRaw)) fuente = 'mixto';

    if (fuente === 'compras') {
      const page = await docsComprasPage(companyRuc, { skip, take, q });
      return res.json({ success: true, ...page });
    }

    if (fuente === 'mixto') {
      // Página intercalada: mitad ventas + mitad compras (suficiente para el selector).
      const half = Math.max(1, Math.ceil(take / 2));
      const [ventas, compras] = await Promise.all([
        docsAfectadosPage(companyRuc, {
          skip: Math.floor(skip / 2),
          take: half,
          q,
          clienteDoc,
          tipoKey: 'GUIA_EMISION',
        }),
        docsComprasPage(companyRuc, {
          skip: Math.floor(skip / 2),
          take: half,
          q,
        }),
      ]);
      const items = [...ventas.items, ...compras.items];
      const total = (ventas.total || 0) + (compras.total || 0);
      return res.json({
        success: true,
        items,
        total,
        offset: skip,
        limit: take,
        fuente: 'mixto',
        cliente_doc: clienteDoc,
        has_more: ventas.has_more || compras.has_more,
        next_offset: skip + items.length,
      });
    }

    const page = await docsAfectadosPage(companyRuc, {
      skip, take, q, clienteDoc, tipoKey,
    });
    return res.json({ success: true, ...page });
  } catch (err) {
    next(err);
  }
}

/** GET /app/emitir/documento-afectado/:id/lineas — ítems de venta o compra. */
async function documentoAfectadoLineasJson(req, res, next) {
  try {
    const companyRuc = companyRucOf(res);
    const id = String(req.params.id || '').trim();
    const doc = await comprobanteModel.findLineasVentaParaNota(companyRuc, id);
    if (doc) {
      return res.json({ success: true, origen: 'venta', ...doc });
    }

    const compra = await compraModel.findById(companyRuc, id);
    if (!compra) {
      return res.status(404).json({ success: false, message: 'Documento no encontrado.' });
    }
    const lineas = (compra.details || []).map((d) => ({
      id: d.id,
      codigo: d.codigo || '',
      descripcion: d.descripcion || d.nombre || 'Ítem',
      cantidad: Number(d.cantidad) || 1,
      unidad: d.unidad || 'NIU',
      precio_unitario: Number(d.mto_precio_unitario ?? d.precio_unitario) || 0,
      catalog_item_id: d.catalog_item_id || '',
      almacen_id: '',
      almacen_nombre: '',
      numero_serie: '',
      maneja_serie: false,
      retorna_almacen: false,
    }));
    return res.json({
      success: true,
      origen: 'compra',
      id: compra.id,
      tipo_doc: compra.tipo_doc,
      ref: formatDocRef(compra),
      tipo_moneda: compra.tipo_moneda || 'PEN',
      lineas,
    });
  } catch (err) {
    next(err);
  }
}

/** GET /app/emitir/movimientos-traslado — salidas/traslados listos para GRE motivo 04. */
async function movimientosTrasladoJson(req, res, next) {
  try {
    const companyRuc = companyRucOf(res);
    const q = String(req.query.q || '').trim().toLowerCase();
    const isAdmin = isWebCompanyAdmin(res.locals.webUser);
    const userAlmacenId = res.locals.userAlmacenId || null;
    if (!isAdmin && !userAlmacenId) {
      return res.json({
        success: true,
        ...buildOffsetPage({ items: [], total: 0, offset: 0, limit: 10 }),
      });
    }
    const { skip, take } = (() => {
      const skipN = Math.max(0, Number.parseInt(req.query.offset, 10) || 0);
      const takeRaw = Number.parseInt(req.query.limit, 10) || 10;
      return { skip: skipN, take: Math.min(Math.max(takeRaw, 1), 50) };
    })();
    const result = await movimientoModel.findMany({
      companyRuc,
      tipo: 'SALIDA',
      almacenId: isAdmin ? null : userAlmacenId,
      soloTraslado: true,
      sinGuia: true,
      skip,
      take,
    });
    const almacenes = await almacenModel.findByCompanyRuc(companyRuc, { soloActivos: false });
    const almacenesById = Object.fromEntries(
      (almacenes || []).map((a) => [a.id, a.nombre || a.codigo || a.id]),
    );

    let items = (result.items || []).map((m) => ({
      id: m.id,
      numero: m.numero || '—',
      fecha: formatFecha(m.fecha) || m.fecha || '',
      observaciones: m.observaciones || '',
      almacen_id: m.almacen_id || '',
      almacen_nombre: almacenesById[m.almacen_id] || '',
      almacen_destino_id: m.almacen_destino_id || '',
      almacen_destino_nombre: almacenesById[m.almacen_destino_id] || '',
      lineas_count: Array.isArray(m.lineas) ? m.lineas.length : 0,
      ref: m.referencia_tipo || 'TRASLADO',
      lineas: (m.lineas || []).map((ln) => ({
        catalog_item_id: ln.catalog_item_id || '',
        descripcion: ln.nombre || ln.descripcion || 'Ítem',
        cantidad: Number(ln.cantidad) || 1,
        unidad: ln.unidad || 'NIU',
        precio_unitario: 0,
        almacen_id: ln.almacen_id || m.almacen_id || '',
        producto_serie_id: ln.producto_serie_id || '',
        numero_serie: ln.producto_serie?.numero_serie
          || ln.producto_serie?.numeroSerie
          || '',
      })),
    }));

    if (q) {
      items = items.filter((m) => {
        const blob = [m.numero, m.observaciones, m.almacen_nombre, m.almacen_destino_nombre]
          .join(' ')
          .toLowerCase();
        return blob.includes(q);
      });
    }

    return res.json({
      success: true,
      ...buildOffsetPage({
        items,
        total: result.total ?? items.length,
        offset: skip,
        limit: take,
      }),
    });
  } catch (err) {
    next(err);
  }
}

/** GET /app/emitir/movimientos-traslado/:id — detalle + líneas para armar bienes GRE. */
async function movimientoTrasladoDetalleJson(req, res, next) {
  try {
    const companyRuc = companyRucOf(res);
    const id = String(req.params.id || '').trim();
    const mov = await movimientoModel.findById(id, companyRuc);
    if (!mov) {
      return res.status(404).json({ success: false, message: 'Movimiento no encontrado.' });
    }
    if (mov.tipo !== 'SALIDA' || (!mov.almacen_destino_id && mov.referencia_tipo !== 'TRASLADO')) {
      return res.status(400).json({ success: false, message: 'Solo traslados entre almacenes.' });
    }

    const almacenes = await almacenModel.findByCompanyRuc(companyRuc, { soloActivos: false });
    const almacenesById = Object.fromEntries(
      (almacenes || []).map((a) => [a.id, a.nombre || a.codigo || a.id]),
    );

    const lineas = (mov.lineas || []).map((ln) => ({
      catalog_item_id: ln.catalog_item_id || '',
      descripcion: ln.nombre || ln.descripcion || 'Ítem',
      cantidad: Number(ln.cantidad) || 1,
      unidad: ln.unidad || 'NIU',
      precio_unitario: 0,
      almacen_id: ln.almacen_id || mov.almacen_id || '',
      producto_serie_id: ln.producto_serie_id || '',
      numero_serie: ln.producto_serie?.numero_serie || ln.producto_serie?.numeroSerie || '',
    }));

    return res.json({
      success: true,
      movimiento: {
        id: mov.id,
        numero: mov.numero || '—',
        fecha: formatFecha(mov.fecha) || mov.fecha || '',
        observaciones: mov.observaciones || '',
        almacen_id: mov.almacen_id || '',
        almacen_nombre: almacenesById[mov.almacen_id] || '',
        almacen_destino_id: mov.almacen_destino_id || '',
        almacen_destino_nombre: almacenesById[mov.almacen_destino_id] || '',
      },
      lineas,
      ref: mov.numero || 'Traslado',
    });
  } catch (err) {
    next(err);
  }
}

const TIPOS = {
  FACTURA: {
    key: 'FACTURA',
    titulo: 'Factura electrónica',
    detalle: 'Venta gravada a cliente con RUC',
    icon: '🧾',
    color: '#1565C0',
    bg: '#BBDEFB',
  },
  BOLETA: {
    key: 'BOLETA',
    titulo: 'Boleta electrónica',
    detalle: 'Consumidor final con DNI',
    icon: '📄',
    color: '#2E7D32',
    bg: '#C8E6C9',
  },
  NOTA_CREDITO: {
    key: 'NOTA_CREDITO',
    titulo: 'Nota de crédito',
    detalle: 'Emisión paso a paso · factura relacionada y motivo SUNAT',
    icon: '↺',
    color: '#6A1B9A',
    bg: '#E1BEE7',
  },
  NOTA_DEBITO: {
    key: 'NOTA_DEBITO',
    titulo: 'Nota de débito',
    detalle: 'Ajuste de importe sobre documento',
    icon: '+',
    color: '#E65100',
    bg: '#FFE0B2',
  },
};

const GRE_OPCIONES = [
  {
    key: 'GUIA_EMISION',
    titulo: 'GRE remitente',
    detalle: 'Cat. 09 · Traslado emitido por quien envía las mercancías',
    icon: '📤',
    color: '#006064',
    bg: '#B2EBF2',
    href: '/emitir/GUIA_EMISION',
  },
  {
    key: 'GUIA_TRANSPORTISTA',
    titulo: 'GRE transportista',
    detalle: 'Cat. 31 · Traslado emitido por el transportista',
    icon: '🚚',
    color: '#EF6C00',
    bg: '#FFE0B2',
    href: '/emitir/GUIA_TRANSPORTISTA',
  },
  {
    key: 'EVENTOS',
    titulo: 'GRE por evento',
    detalle: 'Transbordo no programado o imposibilidad de arribo / entrega',
    icon: '⚠️',
    color: '#6A1B9A',
    bg: '#E1BEE7',
    href: '/emitir/guia/eventos',
  },
];

const EVENTOS = [
  {
    key: 'GRE_POR_EVENTO',
    titulo: 'Emitir GRE por evento',
    detalle: 'Transbordo no programado · imposibilidad de arribo · imposibilidad de entrega',
  },
];

function serieDeCompany(company, tipoKey) {
  try {
    return resolveTipoConfig(tipoKey, company).serie;
  } catch {
    return '—';
  }
}

function cuentasBancoNacion(metodos) {
  return (Array.isArray(metodos) ? metodos : []).flatMap((m) => {
    const tipo = String(m.tipo || '').toUpperCase();
    if (tipo === 'YAPE' || tipo === 'PLIN' || tipo === 'EFECTIVO') return [];
    const cuenta = String(m.valor || '').replace(/\D/g, '').slice(0, 20);
    if (cuenta.length < 4) return [];
    return [{
      id: m.id,
      nombre: m.nombre || tipo,
      tipo,
      cuenta,
    }];
  });
}

async function loadCuentasBn(res) {
  const list = await metodoPagoModel.listByCompany(companyRucOf(res), { soloActivos: true }).catch(() => []);
  return cuentasBancoNacion(list);
}

async function datosSunat(req, res, next) {
  try {
    const parsed = req.session?.emitSunat
      ? { ok: true, datos: req.session.emitSunat, error: null }
      : { datos: emptySunatDatos(), error: null };
    const cuentasBn = await loadCuentasBn(res);
    const detracciones = await detraccionModel.listar();
    res.render('app/emitir/datos-sunat', layoutLocals(res, {
      title: 'Datos SUNAT',
      active: 'emitir',
      datos: parsed.datos,
      error: null,
      cuentasBn,
      mediosPagoDetraccion: MEDIOS_PAGO_DETRACCION,
      detracciones,
    }));
  } catch (error) {
    next(error);
  }
}

async function guardarDatosSunat(req, res, next) {
  try {
    const parsed = parseSunatDatos(req.body || {});
    const cuentasBn = await loadCuentasBn(res);
    const detracciones = await detraccionModel.listar();
    if (parsed.ok) {
      const detError = detraccionModel.aplicarCatalogo(detracciones, parsed.datos);
      if (detError) parsed.ok = false;
      if (detError) parsed.error = detError;
    }
    if (!parsed.ok) {
      return res.status(400).render('app/emitir/datos-sunat', layoutLocals(res, {
        title: 'Datos SUNAT',
        active: 'emitir',
        datos: parsed.datos,
        error: parsed.error,
        cuentasBn,
        mediosPagoDetraccion: MEDIOS_PAGO_DETRACCION,
        detracciones,
      }));
    }
    if (req.session) req.session.emitSunat = parsed.datos;
    const nextQuery = String(req.session?.emitFacturaQuery || '');
    if (req.session) delete req.session.emitFacturaQuery;
    const base = appPath('/emitir/FACTURA') + (nextQuery.startsWith('?') ? nextQuery : '');
    const sep = base.includes('?') ? '&' : '?';
    return res.redirect(`${base}${sep}continuar=1`);
  } catch (error) {
    return next(error);
  }
}

async function menu(req, res, next) {
  try {
    const company = await companyModel.findByRuc(companyRucOf(res));
    const opciones = Object.values(TIPOS).map((t) => ({
      ...t,
      serie: serieDeCompany(company, t.key),
      href: `/emitir/${t.key}`,
    }));

    res.render('app/emitir', layoutLocals(res, {
      title: 'Emitir',
      active: 'emitir',
      opciones,
      guiaHref: '/emitir/guia',
    }));
  } catch (err) {
    next(err);
  }
}

async function guiaMenu(req, res, next) {
  try {
    const company = await companyModel.findByRuc(companyRucOf(res));
    const opciones = GRE_OPCIONES.map((o) => ({
      ...o,
      serie: o.key.startsWith('GUIA') ? serieDeCompany(company, o.key) : null,
    }));
    res.render('app/emitir/guia', layoutLocals(res, {
      title: 'Guía de remisión',
      active: 'emitir',
      opciones,
    }));
  } catch (err) {
    next(err);
  }
}

function eventosMenu(req, res) {
  res.render('app/emitir/eventos', layoutLocals(res, {
    title: 'GRE por evento',
    active: 'emitir',
    opciones: EVENTOS,
    flash: parseFlash(req),
  }));
}

function dirPunto(punto) {
  if (!punto || typeof punto !== 'object') return { direccion: '', ubigeo: '' };
  return {
    direccion: String(punto.direccion || punto.address || '').trim(),
    ubigeo: String(punto.ubigeo || '').trim(),
  };
}

async function listGuiasEvento(companyRuc, { skip = 0, take = 10, q = '' } = {}) {
  return comprobanteModel.findGuiasParaEventoPaginated(companyRuc, { skip, take, q });
}

function emptyGreEventoForm(company) {
  return {
    codigo_evento: '1',
    guia_id: '',
    guia_origen: 'emitida',
    guia_tipo_doc: '09',
    guia_serie: '',
    guia_correlativo: '',
    guia_emisor_ruc: '',
    comprobante_id: '',
    sunat_error: '',
    corregir_ref: '',
    receptor_tipo_doc: '6',
    receptor_numero_doc: '',
    receptor_razon_social: '',
    remitente_tipo_doc: '6',
    remitente_ruc: '',
    remitente_razon_social: '',
    cod_traslado: '01',
    mod_traslado: '02',
    peso_total: '1',
    und_peso_total: 'KGM',
    partida_ubigeo: company?.address?.ubigeo || company?.addressJson?.ubigeo || '',
    partida_direccion: company?.address?.direccion || company?.addressJson?.direccion || '',
    llegada_ubigeo: '',
    llegada_direccion: '',
    fecha_traslado: hoyIsoPe(),
    vehiculo_id: '',
    vehiculo_placa: '',
    conductor_id: '',
    conductor_numero_doc: '',
    conductor_nombres: '',
    conductor_licencia: '',
    cita_terminal: '',
    observacion: '',
    lineas: [],
  };
}

function formFromGreEventoRechazado(invoice, company) {
  const meta = invoice.guiaMetaJson && typeof invoice.guiaMetaJson === 'object'
    ? invoice.guiaMetaJson
    : {};
  const envio = meta.envio && typeof meta.envio === 'object' ? meta.envio : {};
  const rem = meta.remitente && typeof meta.remitente === 'object' ? meta.remitente : {};
  const cliente = invoice.cliente || {};
  const rel = (invoice.lineInvoices || [])[0]?.invoice2 || null;
  const cond = envio.conductor || {};
  const veh = envio.vehiculo || {};
  const partida = envio.partida || {};
  const llegada = envio.llegada || {};
  const tipoEv = String(envio.tipo_evento || envio.tipoEvento || '1').trim() || '1';
  const obs = String(invoice.observacion || '');
  const obsUser = obs.replace(/^GRE por evento[^—]*—\s*/i, '').trim();

  return {
    ...emptyGreEventoForm(company),
    comprobante_id: invoice.id,
    corregir_ref: `${invoice.serie || ''}-${invoice.correlativo || ''}`,
    sunat_error: [
      invoice.sunatCodigoDirecto ? `SUNAT ${invoice.sunatCodigoDirecto}` : '',
      invoice.sunatDescripcionDirecto || '',
    ].filter(Boolean).join(' · '),
    codigo_evento: tipoEv,
    guia_id: rel?.id || '',
    guia_origen: 'emitida',
    guia_tipo_doc: String(rel?.tipoDoc || invoice.tipoDoc || '09').padStart(2, '0'),
    guia_serie: rel?.serie || '',
    guia_correlativo: rel?.correlativo != null ? String(rel.correlativo) : '',
    guia_emisor_ruc: rel?.companyRuc || company.ruc || '',
    receptor_tipo_doc: cliente.tipoDoc || '6',
    receptor_numero_doc: cliente.numeroDoc || '',
    receptor_razon_social: cliente.razonSocial || '',
    remitente_tipo_doc: rem.tipo_doc || rem.tipoDoc || '6',
    remitente_ruc: rem.numero_doc || rem.ruc || '',
    remitente_razon_social: rem.razon_social || rem.nombre || '',
    cod_traslado: envio.cod_traslado || envio.codTraslado || '01',
    mod_traslado: envio.mod_traslado || envio.modTraslado || '01',
    peso_total: String(envio.peso_total || envio.pesoTotal || '1'),
    und_peso_total: envio.und_peso_total || envio.undPesoTotal || 'KGM',
    partida_ubigeo: partida.ubigeo || '',
    partida_direccion: partida.direccion || '',
    llegada_ubigeo: llegada.ubigeo || '',
    llegada_direccion: llegada.direccion || '',
    fecha_traslado: envio.fecha_traslado || envio.fechaTraslado || hoyIsoPe(),
    vehiculo_placa: veh.placa || '',
    conductor_numero_doc: cond.numero_doc || cond.num_doc || '',
    conductor_nombres: cond.nombres || cond.nombre || '',
    conductor_licencia: cond.licencia || '',
    cita_terminal: envio.cita_terminal || '',
    observacion: obsUser,
    nro_mtc: envio.nro_mtc || company?.nroMtc || company?.nro_mtc || '',
    lineas: (invoice.details || []).map((d) => ({
      descripcion: d.descripcion || d.nombre || 'Ítem',
      cantidad: d.cantidad || 1,
      unidad: d.unidad || 'NIU',
      catalog_item_id: d.catalogItemId || '',
    })),
  };
}

async function showGreEventoWizard(req, res, next, { error = null, form = null } = {}) {
  try {
    const company = await companyModel.findByRuc(companyRucOf(res));
    let formData = form || emptyGreEventoForm(company);
    const corregirId = String(req.query?.corregir || formData.comprobante_id || '').trim();
    if (!form && corregirId) {
      const invoice = await comprobanteModel.findByIdForEmission(corregirId, company.ruc);
      if (!invoice || String(invoice.estado || '').toUpperCase() !== 'RECHAZADO' || !esGrePorEvento(invoice)) {
        return redirectWithFlash(
          res,
          appPath('/comprobantes'),
          'Solo puedes corregir una GRE por evento rechazada.',
          'error',
        );
      }
      formData = formFromGreEventoRechazado(invoice, company);
    }
    res.status(error ? 400 : 200).render('app/emitir/gre-evento', layoutLocals(res, {
      title: formData.comprobante_id ? 'Corregir GRE por evento' : 'GRE por evento',
      active: 'emitir',
      pasos: PASOS_GRE_EVENTO,
      tiposEvento: TIPOS_EVENTO_GRE,
      form: formData,
      error,
      flash: parseFlash(req),
    }));
  } catch (err) {
    next(err);
  }
}

async function guiasEventoJson(req, res, next) {
  try {
    const { q, offset, limit } = parseOffsetLimit(req.query, { defaultLimit: 10, maxLimit: 10 });
    const page = await listGuiasEvento(companyRucOf(res), { skip: offset, take: limit, q });
    res.json(buildOffsetPage({
      items: page.items,
      total: page.total,
      offset,
      limit,
    }));
  } catch (err) {
    next(err);
  }
}

async function guiaEventoDetalleJson(req, res, next) {
  try {
    const item = await comprobanteModel.findGuiaParaEventoById(
      companyRucOf(res),
      req.params.id,
    );
    if (!item) {
      return res.status(404).json({ success: false, message: 'GRE no encontrada.' });
    }
    res.json({ success: true, item });
  } catch (err) {
    next(err);
  }
}

async function submitGreEvento(req, res, next) {
  try {
    const companyRuc = companyRucOf(res);
    const company = await companyModel.findByRuc(companyRuc);
    const body = req.body || {};
    const tipoEv = tipoEventoPorCodigo(body.codigo_evento);
    const reerror = (message) => {
      const form = {
        ...emptyGreEventoForm(company),
        ...Object.fromEntries(
          Object.entries(body).map(([k, v]) => [k, Array.isArray(v) ? v : v]),
        ),
      };
      if (form.comprobante_id && !form.corregir_ref) {
        form.corregir_ref = form.comprobante_id;
      }
      return showGreEventoWizard(req, res, next, { error: message, form });
    };

    if (!tipoEv) return reerror('Selecciona el tipo de evento.');
    const guiaId = String(body.guia_id || '').trim();
    const guiaOrigen = String(body.guia_origen || 'emitida').trim().toLowerCase();

    let tipoKey;
    let envioOrigen = {};
    let metaOrigen = {};
    let origenTipoDoc = '09';
    let origenSerie = '';
    let origenCorrelativo = '';
    let relEmisorRuc = company.ruc;
    let origenDetails = [];
    const esManual = guiaOrigen === 'manual';

    if (esManual) {
      origenTipoDoc = ['09', '31'].includes(String(body.guia_tipo_doc || '').padStart(2, '0'))
        ? String(body.guia_tipo_doc).padStart(2, '0')
        : '09';
      origenSerie = String(body.guia_serie || '').trim().toUpperCase();
      origenCorrelativo = String(body.guia_correlativo || '').replace(/\D/g, '');
      if (!origenSerie || !origenCorrelativo) {
        return reerror('Indica serie y número de la GRE relacionada.');
      }
      if (!String(body.receptor_numero_doc || '').replace(/\D/g, '')
        || !String(body.receptor_razon_social || '').trim()) {
        return reerror('Indica el destinatario de la GRE relacionada.');
      }
      tipoKey = origenTipoDoc === '31' ? 'GUIA_TRANSPORTISTA' : 'GUIA_EMISION';
      relEmisorRuc = String(body.guia_emisor_ruc || company.ruc || '').replace(/\D/g, '') || company.ruc;
      if (tipoKey === 'GUIA_TRANSPORTISTA'
        && (!String(body.remitente_ruc || '').replace(/\D/g, '')
          || !String(body.remitente_razon_social || '').trim())) {
        return reerror('En GRE-T indica el remitente (RUC y razón social).');
      }
    } else if (!guiaId) {
      return reerror('Selecciona la GRE relacionada.');
    } else if (guiaOrigen === 'recibida' || guiaOrigen === 'compra') {
      // GRE-R recibida donde soy transportista → evento como GRE-T.
      const compra = await compraModel.findById(companyRuc, guiaId);
      if (!compra || String(compra.tipo_doc || '').padStart(2, '0') !== '09') {
        return reerror('La GRE-R recibida no es válida.');
      }
      const yo = String(companyRuc || '').replace(/\D/g, '');
      const transp = String(
        compra.envio?.transportista?.numero_doc
        || compra.envio?.transportista?.num_doc
        || compra.envio?.transportista?.ruc
        || compra.guia_meta?.envio?.transportista?.numero_doc
        || compra.guia_meta?.envio?.transportista?.num_doc
        || '',
      ).replace(/\D/g, '');
      const rol = String(compra.guia_meta?.rol_recibido || compra.rol_recibido || '').toUpperCase();
      if (rol !== 'TRANSPORTISTA' && transp && transp !== yo) {
        return reerror('Solo puedes usar GRE-R recibidas donde figuras como transportista.');
      }
      tipoKey = 'GUIA_TRANSPORTISTA';
      origenTipoDoc = '09';
      origenSerie = compra.serie;
      origenCorrelativo = String(compra.correlativo);
      relEmisorRuc = String(compra.company?.ruc || compra.company?.numero_doc || '').replace(/\D/g, '') || company.ruc;
      metaOrigen = compra.guia_meta && typeof compra.guia_meta === 'object' ? compra.guia_meta : {};
      envioOrigen = (compra.envio && typeof compra.envio === 'object')
        ? compra.envio
        : (metaOrigen.envio && typeof metaOrigen.envio === 'object' ? metaOrigen.envio : {});
      origenDetails = Array.isArray(compra.details) ? compra.details : [];

      const remProv = compra.company || {};
      const dest = compra.cliente || compra.client || metaOrigen.destinatario || {};
      body.remitente_tipo_doc = body.remitente_tipo_doc || remProv.tipo_doc || '6';
      body.remitente_ruc = body.remitente_ruc || remProv.numero_doc || remProv.ruc || '';
      body.remitente_razon_social = body.remitente_razon_social || remProv.nombre || remProv.razon_social || '';
      body.receptor_tipo_doc = body.receptor_tipo_doc || dest.tipo_doc || dest.tipoDoc || '6';
      body.receptor_numero_doc = body.receptor_numero_doc || dest.numero_doc || dest.numeroDoc || dest.ruc || '';
      body.receptor_razon_social = body.receptor_razon_social
        || dest.razon_social || dest.razonSocial || dest.nombre || '';
    } else {
      const origen = await comprobanteModel.findByIdForEmission(guiaId, companyRuc);
      if (!origen || !['09', '31'].includes(String(origen.tipoDoc))) {
        return reerror('La GRE relacionada no es válida.');
      }
      if (!['ACEPTADO', 'ENVIADO'].includes(String(origen.estado || '').toUpperCase())) {
        return reerror('Solo puedes complementar una GRE aceptada o enviada a SUNAT.');
      }
      tipoKey = origen.tipoDoc === '31' ? 'GUIA_TRANSPORTISTA' : 'GUIA_EMISION';
      origenTipoDoc = origen.tipoDoc;
      origenSerie = origen.serie;
      origenCorrelativo = String(origen.correlativo);
      relEmisorRuc = company.ruc;
      metaOrigen = origen.guiaMetaJson && typeof origen.guiaMetaJson === 'object'
        ? origen.guiaMetaJson
        : {};
      envioOrigen = metaOrigen.envio && typeof metaOrigen.envio === 'object' ? metaOrigen.envio : {};
      origenDetails = Array.isArray(origen.details) ? origen.details : [];
      if (!String(body.receptor_numero_doc || '').replace(/\D/g, '') && origen.cliente) {
        body.receptor_tipo_doc = origen.cliente.tipoDoc || '6';
        body.receptor_numero_doc = origen.cliente.numeroDoc || '';
        body.receptor_razon_social = origen.cliente.razonSocial || '';
      }
    }

    const partidaOrig = dirPunto(envioOrigen.partida);
    const llegadaOrig = dirPunto(envioOrigen.llegada);

    const merged = { ...body };
    if (!String(merged.receptor_numero_doc || '').replace(/\D/g, '') && body.receptor_numero_doc) {
      merged.receptor_tipo_doc = body.receptor_tipo_doc;
      merged.receptor_numero_doc = body.receptor_numero_doc;
      merged.receptor_razon_social = body.receptor_razon_social;
    }
    // Art. 7 RS 123-2022: privado → remitente (GRE-R / 02); público → transportista (GRE-T / 01).
    if (tipoKey === 'GUIA_TRANSPORTISTA') {
      const rem = metaOrigen.remitente || {};
      if (!String(merged.remitente_ruc || '').replace(/\D/g, '')) {
        merged.remitente_tipo_doc = rem.tipo_doc || merged.remitente_tipo_doc || '6';
        merged.remitente_ruc = rem.numero_doc || rem.ruc || merged.remitente_ruc || '';
        merged.remitente_razon_social = rem.razon_social || rem.nombre || merged.remitente_razon_social || '';
      }
      merged.mod_traslado = '01';
      merged.nro_mtc = merged.nro_mtc || company?.nroMtc || company?.nro_mtc || '';
      if (!String(merged.nro_mtc || '').trim()) {
        return reerror('Tu empresa necesita Nro. MTC para emitir GRE-T por evento (transporte público).');
      }
    } else {
      merged.mod_traslado = '02';
      delete merged.transportista_ruc;
      delete merged.transportista_razon_social;
      delete merged.transportista_mtc;
      delete merged.nro_mtc;
    }
    // Motivo/cod_traslado se heredan de la GRE original (no se re-elige en el evento).
    merged.cod_traslado = envioOrigen.cod_traslado || envioOrigen.codTraslado || merged.cod_traslado || '01';
    merged.peso_total = merged.peso_total || envioOrigen.peso_total || envioOrigen.pesoTotal || 1;
    merged.und_peso_total = merged.und_peso_total || envioOrigen.und_peso_total || envioOrigen.undPesoTotal || 'KGM';
    if (!String(merged.partida_direccion || '').trim()) merged.partida_direccion = partidaOrig.direccion;
    if (!String(merged.partida_ubigeo || '').trim()) merged.partida_ubigeo = partidaOrig.ubigeo;
    if (!tipoEv.pideLlegada) {
      // Transbordo: llegada = la de la GRE original (art. 7.2 / 19-B).
      merged.llegada_direccion = llegadaOrig.direccion || merged.llegada_direccion;
      merged.llegada_ubigeo = llegadaOrig.ubigeo || merged.llegada_ubigeo;
    }
    // Art. 19-B: placa y conductor del tramo que se reinicia.
    if (!String(merged.vehiculo_placa || '').trim() && envioOrigen.vehiculo?.placa && !tipoEv.vehiculoNuevo) {
      merged.vehiculo_placa = envioOrigen.vehiculo.placa;
    }
    if (!String(merged.conductor_numero_doc || '').trim() && envioOrigen.conductor && !tipoEv.vehiculoNuevo) {
      merged.conductor_numero_doc = envioOrigen.conductor.numero_doc || envioOrigen.conductor.num_doc || '';
      merged.conductor_nombres = envioOrigen.conductor.nombres || envioOrigen.conductor.nombre || '';
      merged.conductor_licencia = envioOrigen.conductor.licencia || '';
    }

    if (!parseLineasFromBody(merged).length && origenDetails.length) {
      merged.linea_descripcion = origenDetails.map((d) => d.descripcion || d.nombre || 'Ítem');
      merged.linea_unidad = origenDetails.map((d) => d.unidad || 'NIU');
      merged.linea_cantidad = origenDetails.map((d) => d.cantidad || 1);
      merged.linea_precio_unitario = origenDetails.map(() => 0);
      merged.linea_catalog_item_id = origenDetails.map((d) => d.catalogItemId || d.catalog_item_id || '');
    }

    // Relacionar la GRE original como documento relacionado (09/31).
    delete merged.factura_ids;
    delete merged.compra_ids;
    merged.rel_tipo = [origenTipoDoc];
    merged.rel_serie = [origenSerie];
    merged.rel_numero = [String(origenCorrelativo)];
    merged.rel_emisor = [relEmisorRuc];
    merged.afectar_inventario = false;

    const obsUser = String(merged.observacion || '').trim();
    const obs = [`GRE por evento ${tipoEv.codigo} · ${tipoEv.titulo}`, obsUser].filter(Boolean).join(' — ');

    if (!String(merged.partida_direccion || '').trim() || String(merged.partida_ubigeo || '').replace(/\D/g, '').length !== 6) {
      return reerror(esManual || tipoEv.pidePartida
        ? 'Completa el punto de inicio del tramo (dirección y ubigeo).'
        : 'Falta el punto de partida de la GRE relacionada.');
    }
    if (tipoEv.pidePartida && (!String(merged.partida_direccion || '').trim() || String(merged.partida_ubigeo || '').replace(/\D/g, '').length !== 6)) {
      return reerror('Completa el punto de inicio del tramo (dirección y ubigeo).');
    }
    if (tipoEv.pideLlegada && (!String(merged.llegada_direccion || '').trim() || String(merged.llegada_ubigeo || '').replace(/\D/g, '').length !== 6)) {
      return reerror('Completa el nuevo punto de llegada.');
    }
    if (tipoEv.pideLlegada || tipoEv.llegadaNueva) {
      const norm = (dir, ubi) => `${String(ubi || '').replace(/\D/g, '')}|${String(dir || '').trim().toUpperCase().replace(/\s+/g, ' ')}`;
      const origKey = norm(llegadaOrig.direccion, llegadaOrig.ubigeo);
      const newKey = norm(merged.llegada_direccion, merged.llegada_ubigeo);
      const origTiene = String(llegadaOrig.ubigeo || '').replace(/\D/g, '').length === 6
        || String(llegadaOrig.direccion || '').trim();
      if (origTiene && newKey === origKey) {
        return reerror('El nuevo punto de llegada debe ser distinto al de la GRE original.');
      }
    }
    if (!String(merged.llegada_direccion || '').trim() || String(merged.llegada_ubigeo || '').replace(/\D/g, '').length !== 6) {
      return reerror(esManual || tipoEv.pideLlegada || tipoEv.llegadaNueva
        ? 'Completa el nuevo punto de llegada (dirección y ubigeo).'
        : 'Falta el punto de llegada de la GRE relacionada.');
    }
    if (!String(merged.fecha_traslado || '').trim()) {
      merged.fecha_traslado = hoyIsoPe();
    }
    if (tipoEv.pideCita && !String(merged.cita_terminal || '').trim()) {
      return reerror('Indica el número de cita u orden de entrega del terminal.');
    }
    if (tipoEv.pideVehiculo && !String(merged.vehiculo_placa || '').trim()) {
      return reerror(tipoEv.vehiculoNuevo
        ? 'Indica la placa del otro vehículo (transbordo).'
        : 'La placa del vehículo es obligatoria (SUNAT art. 19-B).');
    }
    if (tipoEv.pideConductor) {
      const dni = String(merged.conductor_numero_doc || '').replace(/\D/g, '');
      if (dni.length !== 8 || !String(merged.conductor_nombres || '').trim()) {
        return reerror('El conductor (DNI y nombres) es obligatorio (SUNAT art. 19-B).');
      }
      const lic = String(merged.conductor_licencia || '').trim().toUpperCase().replace(/[\s-]+/g, '');
      if (!lic) {
        return reerror('La licencia de conducir es obligatoria (formato MTC, ej. Q007444402).');
      }
      if (!/^[A-Z]\d{8,9}$/.test(lic)) {
        return reerror('Licencia inválida: debe ser letra + 8 o 9 dígitos (ej. Q007444402). SUNAT error 2573.');
      }
      merged.conductor_licencia = lic;
    }
    if (tipoEv.vehiculoNuevo) {
      const placaNueva = String(merged.vehiculo_placa || '').trim().toUpperCase().replace(/[\s-]+/g, '');
      const placaOrig = String(envioOrigen.vehiculo?.placa || '').trim().toUpperCase().replace(/[\s-]+/g, '');
      if (placaOrig && placaNueva && placaNueva === placaOrig) {
        return reerror('En transbordo la placa debe ser de otro vehículo (distinta a la GRE original).');
      }
    }

    const emitBody = buildEmitBody(tipoKey, merged, company);
    emitBody.observacion = obs;
    emitBody.observaciones = obs;
    emitBody.afectar_inventario = false;
    if (emitBody.envio) {
      if (tipoKey === 'GUIA_EMISION') {
        // Remitente / privado: placa + conductor, sin CarrierParty.
        emitBody.envio.mod_traslado = '02';
        delete emitBody.envio.transportista;
        delete emitBody.envio.nro_mtc;
        delete emitBody.envio.registrar_vehiculos_conductores;
      } else {
        // Transportista / público: el emisor ES el transportista (art. 7).
        emitBody.envio.mod_traslado = '01';
        emitBody.envio.nro_mtc = merged.nro_mtc;
      }
      emitBody.envio.tipo_evento = tipoEv.codigo;
      emitBody.envio.descripcion_evento = tipoEv.titulo;
      emitBody.envio.gre_por_evento = true;
      if (tipoEv.codigo === '1') {
        emitBody.envio.indicadores = (emitBody.envio.indicadores || []).filter(
          (tag) => tag !== GRE_ENVIO_INDICADORES.TRANSBORDO_PROGRAMADO,
        );
      }
      const cita = String(merged.cita_terminal || '').trim();
      if (cita) emitBody.envio.cita_terminal = cita;
    }

    if (!emitBody.receptor?.numero_doc) {
      return reerror(esManual
        ? 'Indica el destinatario de la GRE relacionada.'
        : 'La GRE relacionada no tiene destinatario.');
    }
    if (!emitBody.lineas.length && !(emitBody.facturas || []).length) {
      return reerror(esManual
        ? 'No se pudo armar el detalle de bienes. Vuelve a agregar la GRE manual.'
        : 'No se pudieron copiar los bienes de la GRE relacionada.');
    }

    let result;
    try {
      const corregirId = String(body.comprobante_id || '').trim();
      if (corregirId) {
        const existente = await comprobanteModel.findByIdForEmission(corregirId, companyRuc);
        if (
          !existente
          || String(existente.estado || '').toUpperCase() !== 'RECHAZADO'
          || !esGrePorEvento(existente)
        ) {
          return reerror('Solo puedes corregir una GRE por evento rechazada.');
        }
        const actualizado = await comprobanteModel.updateRejectedFromMobileRequest(
          corregirId,
          companyRuc,
          emitBody,
        );
        const comprobante = await comprobanteEmisionService.emitirComprobanteExistente(
          actualizado || existente,
          {
            apiBaseUrl: `${req.protocol}://${req.get('host')}`,
            usuarioId: res.locals.webUser?.id != null ? Number(res.locals.webUser.id) : null,
            almacenId: res.locals.userAlmacenId || null,
            afectarInventario: false,
          },
        );
        const okEmit = ['ACEPTADO', 'ENVIADO'].includes(String(comprobante.estado || '').toUpperCase());
        result = {
          body: {
            ...comprobante,
            success: okEmit,
            sunat_ok: okEmit,
            message: comprobante.sunat_descripcion || comprobante.sunatDescripcion || comprobante.message,
          },
        };
      } else {
        result = await comprobanteEmisionService.crearYEmitirDesdeMobile(companyRuc, emitBody, {
          apiBaseUrl: `${req.protocol}://${req.get('host')}`,
          usuarioId: res.locals.webUser?.id != null ? Number(res.locals.webUser.id) : null,
          almacenId: res.locals.userAlmacenId || null,
          afectarInventario: false,
        });
      }
    } catch (err) {
      console.error('[emitir] GRE por evento', err);
      return reerror(err.message || 'No se pudo emitir la GRE por evento.');
    }

    const ok = result.body?.sunat_ok === true || result.body?.success === true
      || ['ACEPTADO', 'ENVIADO'].includes(result.body?.estado);
    const ref = result.body?.serie && result.body?.correlativo
      ? `${result.body.serie}-${result.body.correlativo}`
      : 'GRE por evento';
    const msg = ok
      ? `${ref} emitida.`
      : (result.body?.message || `Se guardó ${ref}, pero SUNAT no la aceptó.`);
    return redirectWithFlash(
      res,
      appPath(ok ? '/comprobantes' : '/emitir/guia/eventos'),
      msg,
      ok ? 'success' : 'error',
    );
  } catch (err) {
    next(err);
  }
}

function resolveTipoKey(raw) {
  const key = String(raw || '').trim().toUpperCase();
  const allowed = new Set([
    'FACTURA',
    'BOLETA',
    'NOTA_CREDITO',
    'NOTA_DEBITO',
    'GUIA_EMISION',
    'GUIA_TRANSPORTISTA',
  ]);
  return allowed.has(key) ? key : null;
}

function metaTipo(tipoKey) {
  if (TIPOS[tipoKey]) return TIPOS[tipoKey];
  if (tipoKey === 'GUIA_EMISION') {
    return {
      key: tipoKey,
      titulo: 'GRE remitente',
      detalle: 'Guía de remisión electrónica · remitente',
      icon: '📤',
      color: '#006064',
      bg: '#B2EBF2',
    };
  }
  if (tipoKey === 'GUIA_TRANSPORTISTA') {
    return {
      key: tipoKey,
      titulo: 'GRE transportista',
      detalle: 'Guía de remisión electrónica · transportista',
      icon: '🚚',
      color: '#EF6C00',
      bg: '#FFE0B2',
    };
  }
  return null;
}

async function showForm(req, res, next) {
  try {
    const tipoKey = resolveTipoKey(req.params.tipo);
    const meta = metaTipo(tipoKey);
    if (!meta) {
      return redirectWithFlash(res, appPath('/emitir'), 'Tipo de comprobante no válido.', 'error');
    }

    if (tipoKey === 'GUIA_EMISION') {
      return showGreRemitenteWizard(req, res, next, { error: null, form: null });
    }
    if (tipoKey === 'GUIA_TRANSPORTISTA') {
      return showGreTransportistaWizard(req, res, next, { error: null, form: null });
    }

    const companyRuc = companyRucOf(res);
    const company = await companyModel.findByRuc(companyRuc);
    const tipoConfig = resolveTipoConfig(tipoKey, company);

    const esNota = tipoKey === 'NOTA_CREDITO' || tipoKey === 'NOTA_DEBITO';
    const esVenta = tipoKey === 'FACTURA' || tipoKey === 'BOLETA';
    const corregirId = String(req.query.corregir || '').trim();
    let correccion = null;
    if (corregirId && esVenta) {
      correccion = await comprobanteModel.findByIdForEmission(corregirId, companyRuc);
      const tipoEsperado = tipoKey === 'BOLETA' ? '03' : '01';
      if (!correccion
        || String(correccion.estado || '').toUpperCase().indexOf('RECHAZ') < 0
        || String(correccion.tipoDoc) !== tipoEsperado) {
        return redirectWithFlash(
          res,
          appPath('/comprobantes'),
          'Solo puedes corregir una factura o boleta rechazada.',
          'error',
        );
      }
      const sunatGuardada = correccion.guiaMetaJson && correccion.guiaMetaJson.sunat_emision;
      if (sunatGuardada && sunatGuardada.forma_pago && req.session) {
        req.session.emitSunat = sunatGuardada;
      }
    }
    if (tipoKey === 'FACTURA' && String(req.query.continuar || '') !== '1') {
      const qIndex = String(req.originalUrl || '').indexOf('?');
      if (req.session) req.session.emitFacturaQuery = qIndex >= 0 ? req.originalUrl.slice(qIndex) : '';
      return res.redirect(appPath('/emitir/datos'));
    }
    const isAdmin = isWebCompanyAdmin(res.locals.webUser);
    const userAlmacenId = res.locals.userAlmacenId || null;
    let loadError = null;
    const [clientes, catalogo, docsAfectados, almacenesRaw, metodosPago] = await Promise.all([
      clienteModel.findAllByCompany(companyRuc).catch((err) => {
        loadError = loadError || err.message || 'No se pudieron cargar clientes';
        return [];
      }),
      catalogItemModel.findByCompanyRuc(companyRuc).catch((err) => {
        loadError = loadError || err.message || 'No se pudo cargar el catálogo';
        return [];
      }),
      esNota
        ? docsAfectadosPage(companyRuc, { skip: 0, take: DOCS_AFECTADOS_PAGE, tipoKey })
          .catch(() => ({ items: [], total: 0, has_more: false, next_offset: 0 }))
        : Promise.resolve({ items: [], total: 0, has_more: false, next_offset: 0 }),
      esVenta
        ? almacenModel.findByCompanyRuc(companyRuc).catch((err) => {
          loadError = loadError || err.message || 'No se pudieron cargar almacenes';
          return [];
        })
        : Promise.resolve([]),
      esVenta
        ? metodoPagoModel.listByCompany(companyRuc, { soloActivos: true }).catch(() => [])
        : Promise.resolve([]),
    ]);

    let almacenes = Array.isArray(almacenesRaw) ? almacenesRaw : [];
    if (esVenta && !isAdmin) {
      if (!userAlmacenId) {
        almacenes = [];
      } else {
        almacenes = almacenes.filter((a) => String(a.id) === String(userAlmacenId));
      }
    }

    const ordenId = String(req.query.orden || '').trim();
    let form = emptyForm(tipoKey);
    let ordenPrefill = null;
    if (ordenId && (tipoKey === 'FACTURA' || tipoKey === 'BOLETA')) {
      ordenPrefill = await ordenModel.findById(companyRuc, ordenId);
      if (!ordenPrefill) {
        return redirectWithFlash(res, appPath('/ordenes'), 'Orden no encontrada.', 'error');
      }
      if (ordenPrefill.estado === 'FACTURADA' || ordenPrefill.estado === 'ANULADA' || ordenPrefill.invoice_id) {
        return redirectWithFlash(
          res,
          appPath(`/ordenes/${ordenId}`),
          `La orden está ${ordenPrefill.estado} y no se puede volver a facturar.`,
          'error',
        );
      }
      form = formFromOrden(tipoKey, ordenPrefill);
    }
    if (correccion) {
      form = formFromRejected(tipoKey, correccion);
    }

    res.render('app/emitir/form', layoutLocals(res, {
      title: meta.titulo,
      active: 'emitir',
      meta,
      tipoKey,
      serie: correccion ? (correccion.serie || tipoConfig.serie) : tipoConfig.serie,
      companyRuc,
      clientes: Array.isArray(clientes) ? clientes : [],
      catalogo: Array.isArray(catalogo) ? catalogo : [],
      almacenes: Array.isArray(almacenes) ? almacenes : [],
      metodosPago: Array.isArray(metodosPago) ? metodosPago : [],
      docsAfectados,
      motivosNota: motivosNotaPorTipo(tipoKey),
      form,
      ordenPrefill,
      error: null,
      sunat: tipoKey === 'FACTURA' ? (req.session?.emitSunat || null) : null,
      flash: loadError
        ? { text: loadError, type: 'error' }
        : parseFlash(req),
    }));
  } catch (err) {
    next(err);
  }
}

function hoyIsoPe() {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Lima',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return fmt.format(new Date());
}

function emptyGreForm(company) {
  return {
    cod_traslado: '01',
    mod_traslado: '02',
    peso_total: '1',
    und_peso_total: 'KGM',
    fecha_traslado: hoyIsoPe(),
    fecha_entrega_transportista: hoyIsoPe(),
    receptor_tipo_doc: '6',
    receptor_numero_doc: '',
    receptor_razon_social: '',
    partida_ubigeo: company?.address?.ubigeo || '',
    partida_direccion: company?.address?.direccion || '',
    llegada_ubigeo: '',
    llegada_direccion: '',
    vehiculo_id: '',
    vehiculo_placa: '',
    vehiculo_secundarios_json: '[]',
    conductor_id: '',
    conductor_tipo_doc: '1',
    conductor_numero_doc: '',
    conductor_nombres: '',
    conductor_licencia: '',
    conductor_secundarios_json: '[]',
    transportista_ruc: '',
    transportista_razon_social: '',
    transportista_mtc: '',
    traslado_vehiculo_m1_l: false,
    factura_ids: [],
    compra_ids: [],
    lineas: [],
  };
}

async function loadGreWizardData(companyRuc) {
  const [
    clientes,
    docsFacturas,
    docsCompras,
    vehiculos,
    conductores,
    transportistas,
    almacenes,
  ] = await Promise.all([
    clienteModel.findAllByCompany(companyRuc).catch(() => []),
    docsAfectadosPage(companyRuc, {
      skip: 0,
      take: DOCS_AFECTADOS_PAGE,
      tipoKey: 'GUIA_EMISION',
    }).catch(() => ({ items: [], total: 0, has_more: false, next_offset: 0, fuente: 'ventas' })),
    docsComprasPage(companyRuc, {
      skip: 0,
      take: DOCS_AFECTADOS_PAGE,
    }).catch(() => ({ items: [], total: 0, has_more: false, next_offset: 0, fuente: 'compras' })),
    empresaVehiculoModel.listAll(companyRuc, { take: 10 }).catch(() => []),
    empresaConductorModel.listAll(companyRuc, { take: 10 }).catch(() => []),
    companyModel.listForTransporte({ soloConMtc: true, take: 10 }).catch(() => []),
    almacenModel.findByCompanyRuc(companyRuc).catch(() => []),
  ]);

  return {
    clientes: Array.isArray(clientes) ? clientes : [],
    docsFacturas,
    docsCompras,
    compras: docsCompras,
    vehiculos: Array.isArray(vehiculos) ? vehiculos.map(empresaVehiculoModel.toApi) : [],
    conductores: Array.isArray(conductores) ? conductores.map(empresaConductorModel.toApi) : [],
    transportistas: Array.isArray(transportistas) ? transportistas.map(toTransportistaApi) : [],
    almacenes: Array.isArray(almacenes) ? almacenes : [],
  };
}

async function showGreRemitenteWizard(req, res, next, { error = null, form = null } = {}) {
  try {
    const companyRuc = companyRucOf(res);
    const company = await companyModel.findByRuc(companyRuc);
    const tipoConfig = resolveTipoConfig('GUIA_EMISION', company);
    const data = await loadGreWizardData(companyRuc);
    const meta = metaTipo('GUIA_EMISION');

    res.status(error ? 400 : 200).render('app/emitir/gre-remitente', layoutLocals(res, {
      title: meta.titulo,
      active: 'emitir',
      meta,
      serie: tipoConfig.serie,
      company,
      companyRuc,
      companyNombre: company?.nombre || '',
      motivos: MOTIVOS_TRASLADO_GRE,
      modalidades: MODALIDADES_TRANSPORTE,
      unidadesPeso: UNIDADES_PESO,
      pasos: PASOS_GRE_REMITENTE,
      ...data,
      form: form || emptyGreForm(company),
      error,
      flash: parseFlash(req),
    }));
  } catch (err) {
    next(err);
  }
}

function emptyGreTForm(company) {
  return {
    fecha_traslado: hoyIsoPe(),
    peso_total: '1',
    und_peso_total: 'KGM',
    receptor_tipo_doc: '6',
    receptor_numero_doc: '',
    receptor_razon_social: '',
    remitente_tipo_doc: '6',
    remitente_ruc: '',
    remitente_razon_social: '',
    partida_ubigeo: '',
    partida_direccion: '',
    llegada_ubigeo: '',
    llegada_direccion: '',
    vehiculo_id: '',
    vehiculo_placa: '',
    vehiculo_nro_circulacion: '',
    vehiculo_secundarios_json: '[]',
    conductor_id: '',
    conductor_tipo_doc: '1',
    conductor_numero_doc: '',
    conductor_nombres: '',
    conductor_licencia: '',
    conductor_secundarios_json: '[]',
    nro_mtc: company?.nro_mtc || company?.nroMtc || '',
    pagador_indicador: 'REMITENTE',
    pagador_tipo_doc: '6',
    pagador_numero_doc: '',
    pagador_razon_social: '',
    compra_ids: [],
    lineas: [],
  };
}

async function showGreTransportistaWizard(req, res, next, { error = null, form = null } = {}) {
  try {
    const companyRuc = companyRucOf(res);
    const company = await companyModel.findByRuc(companyRuc);
    const tipoConfig = resolveTipoConfig('GUIA_TRANSPORTISTA', company);
    const data = await loadGreWizardData(companyRuc);
    const meta = metaTipo('GUIA_TRANSPORTISTA');
    const hoy = hoyIsoPe();
    const periodo = hoy.slice(0, 7).replace('-', '');
    const docsGreR = await compraModel.listGreParaTransportistaPaginated(companyRuc, {
      skip: 0,
      take: DOCS_AFECTADOS_PAGE,
      desde: `${hoy.slice(0, 8)}01`,
      hasta: hoy,
    }).catch(() => ({ items: [], total: 0, has_more: false, next_offset: 0 }));

    res.status(error ? 400 : 200).render('app/emitir/gre-transportista', layoutLocals(res, {
      title: meta.titulo,
      active: 'emitir',
      meta,
      serie: tipoConfig.serie,
      company,
      companyRuc,
      companyNombre: company?.nombre || '',
      pagadores: PAGADORES_FLETE_GRE,
      unidadesPeso: UNIDADES_PESO_GRE_T,
      unidadesBien: UNIDADES_BIEN_GRE,
      pasos: PASOS_GRE_TRANSPORTISTA,
      docsGreR,
      periodoDefault: periodo,
      ...data,
      form: form || emptyGreTForm(company),
      error,
      flash: parseFlash(req),
    }));
  } catch (err) {
    next(err);
  }
}

/** GET /app/emitir/gre-remitente-recibidas — GRE-R donde soy transportista. */
async function greRemitenteRecibidasJson(req, res, next) {
  try {
    const companyRuc = companyRucOf(res);
    const skip = Math.max(0, Number.parseInt(req.query.offset, 10) || 0);
    const takeRaw = Number.parseInt(req.query.limit, 10) || DOCS_AFECTADOS_PAGE;
    const take = Math.min(Math.max(takeRaw, 1), 50);
    const q = String(req.query.q || '').trim();
    const periodo = String(req.query.periodo || '').replace(/\D/g, '');
    let desde = null;
    let hasta = null;
    if (periodo.length === 6) {
      const y = periodo.slice(0, 4);
      const m = periodo.slice(4, 6);
      desde = `${y}-${m}-01`;
      const last = new Date(Number(y), Number(m), 0).getDate();
      hasta = `${y}-${m}-${String(last).padStart(2, '0')}`;
    }
    const page = await compraModel.listGreParaTransportistaPaginated(companyRuc, {
      skip, take, q, desde, hasta,
    });
    const items = (page.items || []).map((inv) => {
      const envio = inv.envio || inv.guia_meta?.envio || {};
      const partida = envio.partida || {};
      const llegada = envio.llegada || {};
      const dest = inv.cliente || inv.client || {};
      const rem = inv.company || {};
      return {
        id: inv.id,
        origen: 'compra',
        ref: formatDocRef(inv),
        tipo_label: 'GRE remitente',
        tipo_doc: '09',
        serie: inv.serie,
        correlativo: inv.correlativo,
        cliente: rem.nombre || rem.numero_doc || '—',
        cliente_doc: String(rem.numero_doc || rem.ruc || '').replace(/\D/g, ''),
        cliente_tipo_doc: rem.tipo_doc || '6',
        cliente_razon_social: rem.nombre || '',
        destinatario_doc: String(dest.numero_doc || dest.ruc || '').replace(/\D/g, ''),
        destinatario_tipo_doc: dest.tipo_doc || '6',
        destinatario_razon_social: dest.razon_social || dest.nombre || '',
        fecha: formatFecha(inv.fecha_emision),
        peso_total: envio.peso_total ?? envio.pesoTotal ?? null,
        und_peso_total: envio.und_peso_total || envio.undPesoTotal || 'KGM',
        partida: {
          ubigeo: String(partida.ubigeo || '').trim(),
          direccion: String(partida.direccion || '').trim(),
        },
        llegada: {
          ubigeo: String(llegada.ubigeo || '').trim(),
          direccion: String(llegada.direccion || '').trim(),
        },
        vehiculo_placa: envio.vehiculo?.placa || '',
        conductor_numero_doc: envio.conductor?.numero_doc || envio.conductor?.num_doc || '',
        conductor_nombres: envio.conductor?.nombres || envio.conductor?.nombre || '',
        conductor_licencia: envio.conductor?.licencia || '',
        lineas: (inv.details || []).map((d) => ({
          descripcion: d.descripcion || d.nombre || 'Ítem',
          cantidad: Number(d.cantidad) || 1,
          unidad: d.unidad || 'NIU',
        })),
      };
    });
    return res.json({
      success: true,
      items,
      total: page.total,
      offset: skip,
      limit: take,
      has_more: page.has_more,
      next_offset: page.next_offset,
      periodo: periodo || null,
    });
  } catch (err) {
    next(err);
  }
}

function emptyForm(tipoKey) {
  const esBoleta = tipoKey === 'BOLETA';
  return {
    receptor_tipo_doc: esBoleta ? '1' : '6',
    receptor_numero_doc: '',
    receptor_razon_social: '',
    documento_afectado_id: '',
    motivo_codigo: '01',
    motivo_nota: '',
    afectar_inventario: true,
    orden_id: '',
    metodo_pago_id: '',
    lineas: [{ descripcion: '', unidad: 'NIU', cantidad: '1', precio_unitario: '', catalog_item_id: '' }],
    motivo_traslado: '01',
    peso_bruto: '1',
    llegada_ubigeo: '',
    llegada_direccion: '',
    partida_ubigeo: '',
    partida_direccion: '',
    vehiculo_placa: '',
    conductor_tipo_doc: '1',
    conductor_numero_doc: '',
    conductor_nombres: '',
    conductor_apellidos: '',
    conductor_licencia: '',
    remitente_ruc: '',
    remitente_razon_social: '',
  };
}

function formFromOrden(tipoKey, orden) {
  const form = emptyForm(tipoKey);
  if (!orden) return form;
  const cli = orden.cliente || {};
  form.orden_id = orden.id || '';
  form.receptor_tipo_doc = cli.tipo_doc || form.receptor_tipo_doc;
  form.receptor_numero_doc = cli.numero_doc || '';
  form.receptor_razon_social = cli.razon_social || '';
  form.motivo_nota = orden.observacion || '';
  const dets = Array.isArray(orden.detalles) ? orden.detalles : [];
  if (dets.length) {
    form.lineas = dets.map((d) => ({
      descripcion: d.nombre || d.descripcion || '',
      unidad: d.unidad || d.catalog_item?.unidad || 'NIU',
      cantidad: d.cantidad != null ? String(d.cantidad) : '1',
      precio_unitario: d.mto_precio_unitario != null ? String(d.mto_precio_unitario) : '',
      catalog_item_id: d.catalog_item_id || '',
      almacen_id: d.almacen_id || d.almacen?.id || '',
      producto_serie_id: d.producto_serie_id || d.producto_serie?.id || '',
      numero_serie: d.producto_serie?.numero_serie || d.numero_serie || '',
      maneja_serie: Boolean(d.producto_serie_id || d.producto_serie?.id || d.catalog_item?.maneja_serie),
    }));
  }
  return form;
}

function formFromRejected(tipoKey, invoice) {
  const form = emptyForm(tipoKey);
  if (!invoice) return form;
  const cli = invoice.cliente || {};
  form.comprobante_id = invoice.id || '';
  form.correlativo = invoice.correlativo != null ? String(invoice.correlativo) : '';
  form.receptor_tipo_doc = cli.tipoDoc || form.receptor_tipo_doc;
  form.receptor_numero_doc = cli.numeroDoc || '';
  form.receptor_razon_social = cli.razonSocial || '';
  form.sunat_aviso = invoice.sunatDescripcionDirecto || invoice.sunatDescripcion || '';
  const dets = Array.isArray(invoice.details) ? invoice.details : [];
  if (dets.length) {
    form.lineas = dets.map((d) => {
      const unidad = d.unidad || 'NIU';
      const afe = String(d.tipAfeIgv || '10');
      return {
        descripcion: d.nombre || d.descripcion || '',
        unidad,
        cantidad: d.cantidad != null ? String(d.cantidad) : '1',
        precio_unitario: d.mtoPrecioUnitario != null ? String(d.mtoPrecioUnitario) : '',
        catalog_item_id: d.catalogItemId || '',
        almacen_id: d.almacenId || '',
        producto_serie_id: d.productoSerieId || '',
        kind: d.catalogItemId ? '' : (String(unidad).toUpperCase() === 'ZZ' ? 'SERVICE' : 'PRODUCT'),
        afectacion_igv: afe,
        codigo: d.codigo || '',
        codigo_sunat: d.codigoSunat || '',
      };
    });
  }
  return form;
}

function parseLineasFromBody(body) {
  const descripciones = [].concat(body.linea_descripcion || []);
  const unidades = [].concat(body.linea_unidad || []);
  const cantidades = [].concat(body.linea_cantidad || []);
  const precios = [].concat(body.linea_precio || []);
  const catalogIds = [].concat(body.linea_catalog_item_id || []);
  const almacenIds = [].concat(body.linea_almacen_id || []);
  const serieIds = [].concat(body.linea_producto_serie_id || []);
  const numerosSerie = [].concat(body.linea_numero_serie || []);
  const saleDetailIds = [].concat(body.linea_sale_detail_id || []);
  const kinds = [].concat(body.linea_kind || []);
  const afectaciones = [].concat(body.linea_afectacion || []);
  const codigos = [].concat(body.linea_codigo || []);
  const codigosSunat = [].concat(body.linea_codigo_sunat || []);
  const n = Math.max(descripciones.length, catalogIds.length, 1);
  const lineas = [];
  for (let i = 0; i < n; i += 1) {
    const descripcion = String(descripciones[i] || '').trim();
    const cantidad = Number(cantidades[i] || 0);
    const precio = Number(precios[i] || 0);
    const catalogItemId = String(catalogIds[i] || '').trim();
    if (!descripcion && !catalogItemId) continue;
    const row = {
      descripcion: descripcion || 'Ítem',
      unidad: String(unidades[i] || 'NIU').trim() || 'NIU',
      cantidad: Number.isFinite(cantidad) && cantidad > 0 ? cantidad : 1,
      precio_unitario: Number.isFinite(precio) ? precio : 0,
    };
    const kind = String(kinds[i] || '').trim();
    if (kind) row.kind = kind;
    const afectacion = String(afectaciones[i] || '').trim();
    if (afectacion) row.afectacion_igv = afectacion;
    const codigo = String(codigos[i] || '').trim();
    if (codigo) row.codigo = codigo;
    const codigoSunat = String(codigosSunat[i] || '').trim();
    if (codigoSunat) row.codigo_sunat = codigoSunat;
    if (!catalogItemId && descripcion) row.nombre = descripcion;
    if (catalogItemId) row.catalog_item_id = catalogItemId;
    const saleDetailId = String(saleDetailIds[i] || '').trim();
    if (saleDetailId) row.sale_detail_id = saleDetailId;
    const almacenId = String(almacenIds[i] || '').trim();
    if (almacenId) row.almacen_id = almacenId;
    const serieId = String(serieIds[i] || '').trim();
    if (serieId) row.producto_serie_id = serieId;
    const numeroSerie = String(numerosSerie[i] || '').trim();
    if (numeroSerie) row.numero_serie = numeroSerie;
    lineas.push(row);
  }
  return lineas;
}

/**
 * Valida que las cantidades pedidas no superen el stock del almacén
 * para productos inventariables (maneja_stock / maneja_serie).
 */
async function validateStockLineas(companyRuc, lineas) {
  const pedidos = new Map();
  for (const linea of lineas || []) {
    const catalogItemId = String(linea.catalog_item_id || '').trim();
    if (!catalogItemId) continue;
    const almacenId = String(linea.almacen_id || '').trim();
    const cantidad = Number(linea.cantidad);
    const qty = Number.isFinite(cantidad) && cantidad > 0 ? cantidad : 0;
    if (qty <= 0) continue;
    const key = `${catalogItemId}::${almacenId || '_'}`;
    const prev = pedidos.get(key) || { catalogItemId, almacenId, cantidad: 0, nombre: linea.descripcion || '' };
    prev.cantidad += qty;
    if (!prev.nombre && linea.descripcion) prev.nombre = linea.descripcion;
    pedidos.set(key, prev);
  }

  for (const pedido of pedidos.values()) {
    const item = await catalogItemModel.findById(pedido.catalogItemId);
    if (!item || item.companyRuc !== companyRuc) {
      return `Producto no encontrado: ${pedido.nombre || pedido.catalogItemId}`;
    }
    if (item.kind === 'SERVICE' || (!item.manejaStock && !item.manejaSerie)) {
      continue;
    }
    if (!pedido.almacenId) {
      return `Indica el almacén para "${item.nombre || pedido.nombre}".`;
    }
    const stock = await inventarioModel.getCantidadEnAlmacen(pedido.catalogItemId, pedido.almacenId, {
      manejaSerie: item.manejaSerie,
    });
    if (pedido.cantidad > stock) {
      const nombre = item.nombre || pedido.nombre || 'Producto';
      return `"${nombre}" solo tiene ${stock} disponible(s) en el almacén (pediste ${pedido.cantidad}).`;
    }
  }
  return null;
}

async function catalogoStockJson(req, res, next) {
  try {
    const companyRuc = companyRucOf(res);
    const almacenId = String(req.query.almacen_id || req.query.almacenId || '').trim();
    if (!almacenId) {
      return res.status(400).json({ success: false, message: 'almacen_id es obligatorio.' });
    }
    const almacen = await almacenModel.findById(almacenId);
    if (!almacen || almacen.companyRuc !== companyRuc) {
      return res.status(404).json({ success: false, message: 'Almacén no encontrado.' });
    }

    const items = await catalogItemModel.findByCompanyRuc(companyRuc, { almacenId });
    return res.json({
      almacen_id: almacenId,
      items: (items || []).map((it) => ({
        id: it.id,
        nombre: it.nombre,
        codigo: it.codigo || '',
        unidad: it.unidad || 'NIU',
        precio_unitario: it.precio_unitario != null ? it.precio_unitario : (it.precioUnitario || 0),
        maneja_stock: it.maneja_stock === true || it.manejaStock === true,
        maneja_serie: it.maneja_serie === true || it.manejaSerie === true,
        stock_actual: it.stock_actual != null ? Number(it.stock_actual) : (it.stockActual != null ? Number(it.stockActual) : null),
        kind: it.kind || 'PRODUCT',
      })),
    });
  } catch (err) {
    next(err);
  }
}

function parseAdjuntosFromBody(body) {
  let raw = body?.adjuntos_json ?? body?.adjuntosJson ?? body?.adjuntos;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return [];
    try {
      raw = JSON.parse(trimmed);
    } catch (_e) {
      return [];
    }
  }
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const key = String(item.key || '').trim();
    const url = String(item.url || '').trim();
    if (!key && !url) continue;
    const contentType = String(item.content_type || item.contentType || '').trim().toLowerCase();
    if (contentType && !IMAGE_MIME.has(contentType) && !contentType.startsWith('image/')) {
      continue;
    }
    out.push({
      key: key || undefined,
      url: url || undefined,
      nombre: String(item.nombre || item.name || '').trim() || undefined,
      content_type: contentType || undefined,
      size: Number(item.size) > 0 ? Number(item.size) : undefined,
    });
    if (out.length >= MAX_IMAGENES_EMIT) break;
  }
  return out;
}

async function uploadAdjuntoLocal(companyRuc, file) {
  const ruc = String(companyRuc || '').replace(/\D/g, '') || 'sin-ruc';
  const dir = path.join(__dirname, '../../storage/adjuntos', ruc);
  await fs.promises.mkdir(dir, { recursive: true });
  const ext = path.extname(file.originalname || '').toLowerCase() || '.jpg';
  const safeExt = /^\.(jpe?g|png|webp|gif)$/i.test(ext) ? ext : '.jpg';
  const filename = `${randomUUID()}${safeExt}`;
  const abs = path.join(dir, filename);
  await fs.promises.writeFile(abs, file.buffer);
  const key = `local/${ruc}/${filename}`;
  const url = `/storage/adjuntos/${ruc}/${filename}`;
  return {
    key,
    url,
    nombre: path.basename(String(file.originalname || filename)),
    content_type: file.mimetype || 'image/jpeg',
    size: file.buffer?.length || 0,
  };
}

async function uploadAdjuntoWeb(req, res, next) {
  try {
    const companyRuc = companyRucOf(res);
    const file = req.file;
    if (!file || !file.buffer) {
      return res.status(400).json({ success: false, message: 'Imagen requerida.' });
    }
    const mime = String(file.mimetype || '').toLowerCase();
    if (!IMAGE_MIME.has(mime)) {
      return res.status(400).json({ success: false, message: 'Solo se permiten imágenes JPG, PNG, WEBP o GIF.' });
    }

    let adjunto;
    if (objectStorageService.isEnabled()) {
      adjunto = await objectStorageService.uploadAdjunto(
        companyRuc,
        file.buffer,
        file.originalname,
        file.mimetype,
      );
    } else {
      adjunto = await uploadAdjuntoLocal(companyRuc, file);
    }

    return res.status(201).json({ success: true, adjunto });
  } catch (err) {
    if (err.message && /tipo de archivo|file size|File too large|R2|S3/i.test(err.message)) {
      return res.status(400).json({ success: false, message: err.message });
    }
    next(err);
  }
}

function buildEmitBody(tipoKey, body, company) {
  const receptor = {
    tipo_doc: String(body.receptor_tipo_doc || (tipoKey === 'BOLETA' ? '1' : '6')).trim(),
    numero_doc: String(body.receptor_numero_doc || '').replace(/\D/g, ''),
    razon_social: String(body.receptor_razon_social || '').trim(),
    nombre: String(body.receptor_razon_social || '').trim(),
  };

  const payload = {
    tipo: tipoKey,
    receptor,
    lineas: parseLineasFromBody(body),
    afectar_inventario: body.afectar_inventario === 'on' || body.afectar_inventario === 'true',
  };
  const comprobanteId = String(body.comprobante_id || body.comprobanteId || '').trim();
  if (comprobanteId && (tipoKey === 'FACTURA' || tipoKey === 'BOLETA')) {
    payload.comprobante_id = comprobanteId;
  }

  const adjuntos = parseAdjuntosFromBody(body);
  if (adjuntos.length) payload.adjuntos = adjuntos;

  // Almacén de la venta: explícito o el de la primera línea con almacén.
  let almacenVenta = String(body.almacen_id || body.almacenId || '').trim();
  if (!almacenVenta) {
    for (const ln of payload.lineas) {
      const id = String(ln.almacen_id || '').trim();
      if (id) {
        almacenVenta = id;
        break;
      }
    }
  }
  if (almacenVenta) {
    payload.almacen_id = almacenVenta;
    payload.lineas = payload.lineas.map((ln) => (
      ln.catalog_item_id && !ln.almacen_id ? { ...ln, almacen_id: almacenVenta } : ln
    ));
  }

  // Documentos relacionados manuales (GRE de terceros, etc.) — factura/boleta y GRE.
  const relTipos = [].concat(body.rel_tipo || []);
  const relSeries = [].concat(body.rel_serie || []);
  const relNumeros = [].concat(body.rel_numero || []);
  const relEmisores = [].concat(body.rel_emisor || []);
  const manuals = [];
  const nRel = Math.max(relTipos.length, relSeries.length, relNumeros.length);
  for (let i = 0; i < nRel; i += 1) {
    const serie = String(relSeries[i] || '').trim().toUpperCase();
    const correlativo = String(relNumeros[i] || '').replace(/\D/g, '');
    const emisor = String(relEmisores[i] || company.ruc || '').replace(/\D/g, '');
    if (!serie || !correlativo) continue;
    manuals.push({
      tipo_doc: String(relTipos[i] || '09').trim() || '09',
      serie,
      correlativo,
      emisor_tipo_doc: '6',
      emisor_numero_doc: emisor,
    });
  }
  if (tipoKey === 'FACTURA' || tipoKey === 'BOLETA') {
    const facturaIds = [].concat(body.factura_ids || []).map(String).filter(Boolean);
    const docsRel = [
      ...facturaIds.map((id) => ({ id })),
      ...manuals,
    ];
    if (docsRel.length) payload.facturas = docsRel;
    const metodoPagoId = String(body.metodo_pago_id || body.metodoPagoId || '').trim();
    if (metodoPagoId) payload.metodo_pago_id = metodoPagoId;
    const sunat = parseSunatDatos(body);
    if (!sunat.ok) {
      const err = new Error(sunat.error);
      err.status = 400;
      throw err;
    }
    if (sunat.datos.bloqueos.length && tipoKey === 'FACTURA') {
      const err = new Error(
        `Marcaste Sí en: ${sunat.datos.bloqueos.join(', ')}. SUNAT pide el detalle de esa opción y todavía no se envía en el comprobante. Elige No, o completa solo contado/crédito, moneda y detracción.`,
      );
      err.status = 400;
      throw err;
    }
    const datosSunat = tipoKey === 'BOLETA' ? sunatParaBoleta(sunat.datos) : sunat.datos;
    payload.forma_pago = datosSunat.forma_pago;
    payload.tipo_moneda = datosSunat.tipo_moneda;
    payload.fecha_pago = datosSunat.fecha_pago || null;
    payload.tipo_operacion = datosSunat.tipo_operacion;
    payload.sunat_datos = datosSunat;
  }

  if (tipoKey === 'NOTA_CREDITO' || tipoKey === 'NOTA_DEBITO') {
    payload.documento_afectado = { id: String(body.documento_afectado_id || '').trim() };
    // El panel manda el importe a acreditar por línea (descuento por ítem y global),
    // así que los montos deben prorratearse también por precio, no solo por cantidad.
    payload.escalar_montos_por_precio = true;
    payload.motivo_codigo = String(body.motivo_codigo || '01').trim();
    payload.motivo_nota = String(body.motivo_nota || '').trim();
    // Anulación por error en el RUC: SUNAT exige la factura que reemplaza.
    const nuevaFactura = String(body.nueva_factura || '').trim();
    if (nuevaFactura) payload.nueva_factura = nuevaFactura;
    const serieNueva = String(body.serie_nueva_fe || '').trim();
    const numeroNueva = String(body.numero_nueva_fe || '').trim();
    if (serieNueva) payload.serie_nueva_fe = serieNueva;
    if (numeroNueva) payload.numero_nueva_fe = numeroNueva;
    // Descuento (04/05/09): solo acredita el importe, no devuelve mercadería.
    if (tipoKey === 'NOTA_CREDITO' && ['04', '05', '09'].includes(payload.motivo_codigo)) {
      payload.afectar_inventario = false;
    }
    if (tipoKey === 'NOTA_DEBITO') payload.afectar_inventario = false;
  }

  if (tipoKey === 'GUIA_EMISION') {
    const motivo = motivoPorCodigo(body.cod_traslado || body.motivo_traslado || '01');
    const codTraslado = motivo.codigo;
    payload.motivo_codigo = codTraslado;
    payload.motivo_nota = motivo.titulo;

    if (motivo.destinatarioFijo) {
      payload.receptor = {
        tipo_doc: '6',
        numero_doc: company.ruc,
        razon_social: company.nombre || company.ruc,
        nombre: company.nombre || company.ruc,
      };
    }

    const facturaIds = [].concat(body.factura_ids || []).map(String).filter(Boolean);
    const compraIds = [].concat(body.compra_ids || []).map(String).filter(Boolean);
    const relTipos = [].concat(body.rel_tipo || []);
    const relSeries = [].concat(body.rel_serie || []);
    const relNumeros = [].concat(body.rel_numero || []);
    const relEmisores = [].concat(body.rel_emisor || []);
    const manuals = [];
    const nRel = Math.max(relTipos.length, relSeries.length, relNumeros.length);
    for (let i = 0; i < nRel; i += 1) {
      const serie = String(relSeries[i] || '').trim().toUpperCase();
      const correlativo = String(relNumeros[i] || '').replace(/\D/g, '');
      const emisor = String(relEmisores[i] || company.ruc || '').replace(/\D/g, '');
      if (!serie || !correlativo) continue;
      manuals.push({
        tipo_doc: String(relTipos[i] || '01').trim() || '01',
        serie,
        correlativo,
        emisor_tipo_doc: '6',
        emisor_numero_doc: emisor,
      });
    }
    const docsRel = [
      ...facturaIds.map((id) => ({ id })),
      ...compraIds.map((id) => ({ id })),
      ...manuals,
    ];
    if (docsRel.length) {
      payload.facturas = docsRel;
      // Bienes salen de los documentos internos (ventas o compras con detalle).
      if (['01', '02', '03', '06'].includes(codTraslado) && (facturaIds.length || compraIds.length)) {
        payload.lineas = [];
      }
    }

    const m1Activo = ['1', 'true', 'on', 'si', 'sí'].includes(
      String(body.traslado_vehiculo_m1_l || body.trasladoVehiculoM1L || '').trim().toLowerCase(),
    );
    // M1/L: forzar privado (portal SUNAT solo pide placa).
    const modTraslado = m1Activo
      ? '02'
      : (String(body.mod_traslado || '02').trim() === '01' ? '01' : '02');
    const placa = String(body.vehiculo_placa || '').trim().toUpperCase().replace(/[\s-]+/g, '');
    const condDoc = m1Activo ? '' : String(body.conductor_numero_doc || '').replace(/\D/g, '');
    const condNombre = m1Activo ? '' : String(body.conductor_nombres || '').trim();
    const parseJsonList = (raw) => {
      if (Array.isArray(raw)) return raw;
      if (typeof raw !== 'string' || !raw.trim()) return [];
      try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    };
    const vehSec = m1Activo ? [] : parseJsonList(body.vehiculo_secundarios_json)
      .map((s) => ({
        placa: String(s?.placa || '').trim().toUpperCase().replace(/[\s-]+/g, ''),
        id: s?.id || undefined,
      }))
      .filter((s) => s.placa && s.placa !== placa);
    const condSec = m1Activo ? [] : parseJsonList(body.conductor_secundarios_json)
      .map((s) => {
        const doc = String(s?.numero_doc || s?.num_doc || '').replace(/\D/g, '');
        const nombres = String(s?.nombres_completos || s?.nombres || s?.nombre || '').trim();
        return {
          id: s?.id || undefined,
          tipo_doc: String(s?.tipo_doc || '1').trim() || '1',
          numero_doc: doc,
          num_doc: doc,
          nombres,
          nombre: nombres,
          nombres_completos: nombres,
          licencia: String(s?.licencia || '').trim() || undefined,
        };
      })
      .filter((s) => s.numero_doc && s.numero_doc !== condDoc);

    payload.envio = {
      cod_traslado: codTraslado,
      mod_traslado: modTraslado,
      fecha_traslado: String(body.fecha_traslado || hoyIsoPe()).trim(),
      fecha_entrega_transportista: String(body.fecha_entrega_transportista || body.fecha_traslado || hoyIsoPe()).trim(),
      peso_total: Number(body.peso_total || body.peso_bruto || 1) || 1,
      und_peso_total: String(body.und_peso_total || 'KGM').trim() || 'KGM',
      traslado_vehiculo_m1_l: m1Activo,
      partida: {
        ubigeo: String(body.partida_ubigeo || '').trim() || (company?.address?.ubigeo || ''),
        direccion: String(body.partida_direccion || '').trim()
          || company?.address?.direccion
          || company?.nombre
          || '',
      },
      llegada: {
        ubigeo: String(body.llegada_ubigeo || '').trim(),
        direccion: String(body.llegada_direccion || '').trim(),
      },
    };

    if (m1Activo || modTraslado === '02') {
      delete payload.envio.transportista;
      delete payload.envio.nro_mtc;
      delete payload.envio.registrar_vehiculos_conductores;
      if (m1Activo) delete payload.envio.fecha_entrega_transportista;
    } else if (modTraslado === '01') {
      const tRuc = String(body.transportista_ruc || '').replace(/\D/g, '');
      if (tRuc) {
        payload.envio.transportista = {
          tipo_doc: '6',
          numero_doc: tRuc,
          ruc: tRuc,
          razon_social: String(body.transportista_razon_social || '').trim(),
          nro_mtc: String(body.transportista_mtc || '').trim() || undefined,
        };
        payload.envio.nro_mtc = String(body.transportista_mtc || '').trim() || undefined;
      }
      if (placa || condDoc) {
        payload.envio.registrar_vehiculos_conductores = true;
      }
    }

    if (placa) {
      payload.envio.vehiculo = { placa };
      if (vehSec.length) {
        payload.envio.vehiculo.secundarios = vehSec.map((s) => ({ placa: s.placa }));
      }
    }
    if (!m1Activo && condDoc) {
      payload.envio.conductor = {
        tipo_doc: String(body.conductor_tipo_doc || '1').trim(),
        numero_doc: condDoc,
        num_doc: condDoc,
        nombres: condNombre,
        nombre: condNombre,
        licencia: String(body.conductor_licencia || '').trim() || undefined,
      };
      if (condSec.length) {
        payload.envio.conductor.secundarios = condSec.map((s) => ({
          tipo_doc: s.tipo_doc,
          numero_doc: s.numero_doc,
          num_doc: s.numero_doc,
          nombres: s.nombres,
          licencia: s.licencia,
        }));
      }
    }

    return payload;
  }

  if (tipoKey === 'GUIA_TRANSPORTISTA') {
    const parseJsonList = (raw) => {
      if (Array.isArray(raw)) return raw;
      if (typeof raw !== 'string' || !raw.trim()) return [];
      try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    };

    const remDoc = String(body.remitente_ruc || body.remitente_numero_doc || '').replace(/\D/g, '');
    const remNombre = String(body.remitente_razon_social || '').trim();
    const remTipo = remDoc.length === 11 ? '6' : String(body.remitente_tipo_doc || '6').trim() || '6';
    payload.remitente = {
      tipo_doc: remTipo,
      numero_doc: remDoc,
      ruc: remDoc,
      razon_social: remNombre,
      nombre: remNombre,
    };

    // Destinatario = receptor (ya armado arriba desde body).
    const destDoc = String(payload.receptor.numero_doc || '').replace(/\D/g, '');
    if (destDoc.length && destDoc.length !== 11) {
      payload.receptor.tipo_doc = String(body.receptor_tipo_doc || '1').trim() || '1';
    }

    const compraIds = [].concat(body.compra_ids || body.factura_ids || []).map(String).filter(Boolean);
    const relTipos = [].concat(body.rel_tipo || []);
    const relSeries = [].concat(body.rel_serie || []);
    const relNumeros = [].concat(body.rel_numero || []);
    const relEmisores = [].concat(body.rel_emisor || []);
    const manuals = [];
    const nRel = Math.max(relTipos.length, relSeries.length, relNumeros.length);
    for (let i = 0; i < nRel; i += 1) {
      const serie = String(relSeries[i] || '').trim().toUpperCase();
      const correlativo = String(relNumeros[i] || '').replace(/\D/g, '');
      const emisor = String(relEmisores[i] || remDoc || '').replace(/\D/g, '');
      if (!serie || !correlativo) continue;
      manuals.push({
        tipo_doc: String(relTipos[i] || '09').trim() || '09',
        serie,
        correlativo,
        emisor_tipo_doc: '6',
        emisor_numero_doc: emisor,
      });
    }
    const docsRel = [
      ...compraIds.map((id) => ({ id })),
      ...manuals,
    ];
    if (docsRel.length) payload.facturas = docsRel;

    const placa = String(body.vehiculo_placa || '').trim().toUpperCase().replace(/[\s-]+/g, '');
    const condDoc = String(body.conductor_numero_doc || '').replace(/\D/g, '');
    const condNombre = String(body.conductor_nombres || '').trim();
    const vehSec = parseJsonList(body.vehiculo_secundarios_json)
      .map((s) => ({
        placa: String(s?.placa || '').trim().toUpperCase().replace(/[\s-]+/g, ''),
        nro_circulacion: String(s?.nro_circulacion || s?.nroCirculacion || '').trim() || undefined,
      }))
      .filter((s) => s.placa && s.placa !== placa);
    const condSec = parseJsonList(body.conductor_secundarios_json)
      .map((s) => {
        const doc = String(s?.numero_doc || s?.num_doc || '').replace(/\D/g, '');
        const nombres = String(s?.nombres_completos || s?.nombres || s?.nombre || '').trim();
        return {
          tipo_doc: String(s?.tipo_doc || '1').trim() || '1',
          numero_doc: doc,
          num_doc: doc,
          nombres,
          nombre: nombres,
          licencia: String(s?.licencia || '').trim() || undefined,
        };
      })
      .filter((s) => s.numero_doc && s.nombres);

    payload.envio = {
      mod_traslado: '01',
      fecha_traslado: String(body.fecha_traslado || hoyIsoPe()).trim(),
      peso_total: Number(body.peso_total || body.peso_bruto || 1) || 1,
      und_peso_total: String(body.und_peso_total || 'KGM').trim() || 'KGM',
      nro_mtc: String(body.nro_mtc || company?.nro_mtc || company?.nroMtc || '').trim() || undefined,
      partida: {
        ubigeo: String(body.partida_ubigeo || '').trim(),
        direccion: String(body.partida_direccion || '').trim(),
      },
      llegada: {
        ubigeo: String(body.llegada_ubigeo || '').trim(),
        direccion: String(body.llegada_direccion || '').trim(),
      },
    };
    if (placa) {
      payload.envio.vehiculo = {
        placa,
        nro_circulacion: String(body.vehiculo_nro_circulacion || '').trim() || undefined,
      };
      if (vehSec.length) payload.envio.vehiculo.secundarios = vehSec;
    }
    if (condDoc) {
      payload.envio.conductor = {
        tipo_doc: String(body.conductor_tipo_doc || '1').trim() || '1',
        numero_doc: condDoc,
        num_doc: condDoc,
        nombres: condNombre,
        nombre: condNombre,
        licencia: String(body.conductor_licencia || '').trim() || undefined,
      };
      if (condSec.length) payload.envio.conductor.secundarios = condSec;
    }

    const indPagador = pagadorPorCodigo(body.pagador_indicador || body.pagador_flete_indicador).codigo;
    if (indPagador === 'REMITENTE') {
      payload.pagador_flete = {
        indicador: 'REMITENTE',
        tipo_doc: remTipo,
        numero_doc: remDoc,
        razon_social: remNombre,
      };
    } else {
      const pagDoc = String(body.pagador_numero_doc || '').replace(/\D/g, '');
      const pagNombre = String(body.pagador_razon_social || '').trim();
      const pagTipo = pagDoc.length === 11
        ? '6'
        : String(body.pagador_tipo_doc || '6').trim() || '6';
      payload.pagador_flete = {
        indicador: indPagador,
        tipo_doc: pagTipo,
        numero_doc: pagDoc,
        razon_social: pagNombre,
      };
    }

    return payload;
  }

  return payload;
}

async function submitForm(req, res, next) {
  try {
    const tipoKey = resolveTipoKey(req.params.tipo);
    const meta = metaTipo(tipoKey);
    if (!meta) {
      return redirectWithFlash(res, appPath('/emitir'), 'Tipo de comprobante no válido.', 'error');
    }

    const companyRuc = companyRucOf(res);
    const company = await companyModel.findByRuc(companyRuc);
    let emitBody;
    try {
      emitBody = buildEmitBody(tipoKey, {
        ...(req.body || {}),
        ...(tipoKey === 'FACTURA' ? (req.session?.emitSunat || {}) : {}),
      }, company);
    } catch (err) {
      return reRenderForm(res, {
        companyRuc, company, tipoKey, meta, body: req.body, error: err.message,
      });
    }

    if (tipoKey === 'GUIA_EMISION') {
      const firstFacturaId = [].concat(req.body?.factura_ids || []).map(String).find(Boolean);
      const motivoGre = motivoPorCodigo(emitBody.motivo_codigo || req.body?.cod_traslado);
      if (firstFacturaId && !motivoGre.destinatarioFijo && motivoGre.codigo !== '03') {
        const inv = await comprobanteModel.findByIdForEmission(firstFacturaId, companyRuc);
        const cli = inv?.cliente;
        if (cli?.numeroDoc) {
          emitBody.receptor = {
            tipo_doc: String(cli.tipoDoc || '6').trim() || '6',
            numero_doc: String(cli.numeroDoc).replace(/\D/g, ''),
            razon_social: String(cli.razonSocial || '').trim(),
            nombre: String(cli.razonSocial || '').trim(),
          };
        }
      }
    }

    const reerror = (message) => {
      if (tipoKey === 'GUIA_EMISION') {
        const form = {
          ...emptyGreForm(company),
          ...Object.fromEntries(
            Object.entries(req.body || {}).map(([k, v]) => [k, Array.isArray(v) ? v : v]),
          ),
          factura_ids: [].concat(req.body?.factura_ids || []),
          compra_ids: [].concat(req.body?.compra_ids || []),
          lineas: parseLineasFromBody(req.body || {}).map((l) => ({
            descripcion: l.descripcion,
            unidad: l.unidad,
            cantidad: String(l.cantidad),
            precio_unitario: String(l.precio_unitario),
            catalog_item_id: l.catalog_item_id || '',
          })),
          traslado_vehiculo_m1_l: ['1', 'true', 'on', 'si', 'sí'].includes(
            String(req.body?.traslado_vehiculo_m1_l || '').trim().toLowerCase(),
          ),
        };
        if (!form.lineas.length) form.lineas = emptyGreForm(company).lineas;
        return showGreRemitenteWizard(req, res, next, { error: message, form });
      }
      if (tipoKey === 'GUIA_TRANSPORTISTA') {
        const form = {
          ...emptyGreTForm(company),
          ...Object.fromEntries(
            Object.entries(req.body || {}).map(([k, v]) => [k, Array.isArray(v) ? v : v]),
          ),
          compra_ids: [].concat(req.body?.compra_ids || []),
          lineas: parseLineasFromBody(req.body || {}).map((l) => ({
            descripcion: l.descripcion,
            unidad: l.unidad,
            cantidad: String(l.cantidad),
            precio_unitario: String(l.precio_unitario || 0),
            catalog_item_id: l.catalog_item_id || '',
          })),
        };
        return showGreTransportistaWizard(req, res, next, { error: message, form });
      }
      return reRenderForm(res, {
        companyRuc, company, tipoKey, meta, body: req.body, error: message,
      });
    };

    if (!emitBody.receptor.numero_doc) {
      return reerror('Completa el destinatario (o selecciona facturas / motivo con destinatario fijo).');
    }
    const necesitaLineas = !(tipoKey === 'GUIA_EMISION' && (emitBody.facturas || []).length
      && ['01', '03', '06'].includes(String(emitBody.motivo_codigo)));
    if (necesitaLineas && !emitBody.lineas.length && !(emitBody.facturas || []).length) {
      return reerror(
        tipoKey === 'GUIA_TRANSPORTISTA'
          ? 'Agrega al menos un bien trasladado o vincula una GRE remitente.'
          : motivoPorCodigo(emitBody.motivo_codigo || req.body?.cod_traslado).docs === 'ninguno'
            ? 'Selecciona al menos un movimiento de traslado para armar los bienes.'
            : 'Vincula al menos una factura para tomar los bienes y el destinatario.',
      );
    }
    if ((tipoKey === 'NOTA_CREDITO' || tipoKey === 'NOTA_DEBITO') && !emitBody.documento_afectado?.id) {
      return reerror('Selecciona el documento afectado.');
    }
    if (tipoKey === 'NOTA_CREDITO' || tipoKey === 'NOTA_DEBITO') {
      if (!emitBody.motivo_nota) {
        return reerror(tipoKey === 'NOTA_DEBITO'
          ? 'Describe el motivo de la nota de débito.'
          : 'Describe el motivo de la nota de crédito.');
      }
      // Solo anulación por error en el RUC (NC 02) pide la factura que reemplaza.
      // En nota de débito el 02 es aumento en el valor y no lleva factura nueva.
      const motivoSel = motivosNotaPorTipo(tipoKey).find((m) => m.codigo === emitBody.motivo_codigo);
      if (motivoSel?.pide_nueva_factura && !emitBody.nueva_factura
        && !(emitBody.serie_nueva_fe && emitBody.numero_nueva_fe)) {
        return reerror('Para anulación por error en el RUC indica la serie y el número de la nueva factura.');
      }
    }
    if (tipoKey === 'GUIA_EMISION') {
      if (!emitBody.envio?.llegada?.ubigeo || !emitBody.envio?.llegada?.direccion) {
        return reerror('Completa el punto de llegada (ubigeo y dirección).');
      }
      if (emitBody.envio?.mod_traslado === '02' && !emitBody.envio?.vehiculo?.placa) {
        return reerror('En transporte privado la placa del vehículo es obligatoria.');
      }
      const m1Emit = emitBody.envio?.traslado_vehiculo_m1_l === true
        || emitBody.envio?.trasladoVehiculoM1L === true
        || ['1', 'true', 'si', 'sí'].includes(String(emitBody.envio?.traslado_vehiculo_m1_l || '').toLowerCase());
      if (emitBody.envio?.mod_traslado === '02' && !m1Emit && !emitBody.envio?.conductor?.numero_doc) {
        return reerror('En transporte privado el conductor es obligatorio.');
      }
    }
    if (tipoKey === 'GUIA_TRANSPORTISTA') {
      const yo = String(companyRuc || '').replace(/\D/g, '');
      const rem = String(emitBody.remitente?.numero_doc || '').replace(/\D/g, '');
      const dest = String(emitBody.receptor?.numero_doc || '').replace(/\D/g, '');
      if (!rem || !emitBody.remitente?.razon_social) {
        return reerror('Completa el remitente (documento y razón social).');
      }
      if (yo && (yo === rem || yo === dest)) {
        return reerror(
          'En GRE transportista tu RUC no puede ser el remitente ni el destinatario. Tú solo eres el transportista.',
        );
      }
      if (!emitBody.envio?.partida?.ubigeo || !emitBody.envio?.partida?.direccion) {
        return reerror('Completa el punto de partida (ubigeo y dirección).');
      }
      if (!emitBody.envio?.llegada?.ubigeo || !emitBody.envio?.llegada?.direccion) {
        return reerror('Completa el punto de llegada (ubigeo y dirección).');
      }
      if (!emitBody.envio?.vehiculo?.placa) {
        return reerror('La placa del vehículo es obligatoria.');
      }
      if (!emitBody.envio?.conductor?.numero_doc || !emitBody.envio?.conductor?.nombres) {
        return reerror('El conductor (DNI y nombres) es obligatorio.');
      }
      if (!emitBody.envio?.fecha_traslado) {
        return reerror('Indica la fecha de inicio de traslado.');
      }
      const ind = String(emitBody.pagador_flete?.indicador || 'REMITENTE').toUpperCase();
      if (ind !== 'REMITENTE') {
        const pDoc = String(emitBody.pagador_flete?.numero_doc || '').replace(/\D/g, '');
        const pNom = String(emitBody.pagador_flete?.razon_social || '').trim();
        if (!pDoc || !pNom) {
          return reerror(
            ind === 'SUBCONTRATADO'
              ? 'En subcontratado indica el RUC y razón social de quien te subcontrató.'
              : 'Completa los datos del tercero pagador del flete.',
          );
        }
        if (yo && pDoc === yo) {
          return reerror('El pagador del flete no puede ser tu propio RUC.');
        }
      }
    }

    if (tipoKey === 'FACTURA' || tipoKey === 'BOLETA') {
      const stockError = await validateStockLineas(companyRuc, emitBody.lineas);
      if (stockError) return reerror(stockError);
    }

    let result;
    try {
      result = await comprobanteEmisionService.crearYEmitirDesdeMobile(companyRuc, emitBody, {
        apiBaseUrl: `${req.protocol}://${req.get('host')}`,
        usuarioId: res.locals.webUser?.id != null ? Number(res.locals.webUser.id) : null,
        almacenId: res.locals.userAlmacenId || null,
      });
    } catch (err) {
      console.error('[emitir] crearYEmitirDesdeMobile', err);
      return reerror(err.message || 'No se pudo registrar el comprobante.');
    }

    const ok = result.body?.sunat_ok === true || result.body?.success === true
      || ['ACEPTADO', 'ENVIADO'].includes(result.body?.estado);
    const ref = result.body?.serie && result.body?.correlativo
      ? `${result.body.serie}-${result.body.correlativo}`
      : 'comprobante';
    const msg = ok
      ? `Emitido ${ref} · ${result.body?.estado || 'OK'}`
      : (result.body?.message || `Guardado ${ref} (revisar SUNAT)`);

    const ordenId = String(req.body.orden_id || '').trim();
    const invoiceId = String(result.body?.id || '').trim();
    if (ordenId && invoiceId && (tipoKey === 'FACTURA' || tipoKey === 'BOLETA')) {
      try {
        await ordenModel.update(companyRuc, ordenId, {
          invoice_id: invoiceId,
          estado: 'FACTURADA',
        });
      } catch (_) {
        // La emisión ya ocurrió; no bloqueamos por el vínculo.
      }
    }

    if (tipoKey === 'GUIA_EMISION' && invoiceId) {
      const movIds = [].concat(req.body.movimiento_ids || req.body.movimiento_id || [])
        .map((id) => String(id || '').trim())
        .filter(Boolean);
      if (movIds.length) {
        try {
          await movimientoModel.vincularGuiaRemision({
            companyRuc,
            movimientoIds: movIds,
            guiaRemisionId: invoiceId,
          });
        } catch (linkErr) {
          console.error('[emitir] vincularGuiaRemision', linkErr);
        }
      }
    }

    return redirectWithFlash(
      res,
      appPath('/comprobantes'),
      msg,
      ok ? 'success' : 'error',
    );
  } catch (err) {
    next(err);
  }
}

async function reRenderForm(res, { companyRuc, company, tipoKey, meta, body, error }) {
  const tipoConfig = resolveTipoConfig(tipoKey, company);
  const esNota = tipoKey === 'NOTA_CREDITO' || tipoKey === 'NOTA_DEBITO';
  const esVenta = tipoKey === 'FACTURA' || tipoKey === 'BOLETA';
  const isAdmin = isWebCompanyAdmin(res.locals.webUser);
  const userAlmacenId = res.locals.userAlmacenId || null;
  let loadError = null;
  const [clientes, catalogo, docsAfectados, almacenesRaw, metodosPago] = await Promise.all([
    clienteModel.findAllByCompany(companyRuc).catch((err) => {
      loadError = loadError || err.message || 'No se pudieron cargar clientes';
      return [];
    }),
    catalogItemModel.findByCompanyRuc(companyRuc).catch((err) => {
      loadError = loadError || err.message || 'No se pudo cargar el catálogo';
      return [];
    }),
    esNota
      ? docsAfectadosPage(companyRuc, {
        skip: 0,
        take: DOCS_AFECTADOS_PAGE,
        clienteDoc: String(body?.receptor_numero_doc || ''),
        tipoKey,
      })
        .catch(() => ({ items: [], total: 0, has_more: false, next_offset: 0 }))
      : Promise.resolve({ items: [], total: 0, has_more: false, next_offset: 0 }),
    esVenta
      ? almacenModel.findByCompanyRuc(companyRuc).catch((err) => {
        loadError = loadError || err.message || 'No se pudieron cargar almacenes';
        return [];
      })
      : Promise.resolve([]),
    esVenta
      ? metodoPagoModel.listByCompany(companyRuc, { soloActivos: true }).catch(() => [])
      : Promise.resolve([]),
  ]);

  let almacenes = Array.isArray(almacenesRaw) ? almacenesRaw : [];
  if (esVenta && !isAdmin) {
    almacenes = userAlmacenId
      ? almacenes.filter((a) => String(a.id) === String(userAlmacenId))
      : [];
  }

  const form = {
    ...emptyForm(tipoKey),
    ...Object.fromEntries(
      Object.entries(body || {}).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]),
    ),
    orden_id: String(body?.orden_id || '').trim(),
    lineas: parseLineasFromBody(body || {}).map((l) => ({
      descripcion: l.descripcion,
      unidad: l.unidad,
      cantidad: String(l.cantidad),
      precio_unitario: String(l.precio_unitario),
      catalog_item_id: l.catalog_item_id || '',
      almacen_id: l.almacen_id || '',
      producto_serie_id: l.producto_serie_id || '',
      numero_serie: l.numero_serie || '',
      maneja_serie: Boolean(l.producto_serie_id || l.numero_serie),
    })),
  };
  if (!form.lineas.length) form.lineas = emptyForm(tipoKey).lineas;

  const formError = [error, loadError].filter(Boolean).join(' · ') || error;

  return res.status(400).render('app/emitir/form', layoutLocals(res, {
    title: meta.titulo,
    active: 'emitir',
    meta,
    tipoKey,
    serie: tipoConfig.serie,
    companyRuc,
    clientes: Array.isArray(clientes) ? clientes : [],
    catalogo: Array.isArray(catalogo) ? catalogo : [],
    almacenes,
    metodosPago: Array.isArray(metodosPago) ? metodosPago : [],
    docsAfectados,
    motivosNota: motivosNotaPorTipo(tipoKey),
    form,
    error: formError,
    flash: null,
  }));
}

async function submitEvento(req, res, next) {
  try {
    const modo = String(req.params.modo || '').toUpperCase();
    const companyRuc = companyRucOf(res);
    const body = req.body || {};
    const guiaId = String(body.guia_id || '').trim();
    const backPath = '/emitir/guia/eventos';

    if (!guiaId) {
      return redirectWithFlash(res, appPath(backPath), 'Selecciona una guía.', 'error');
    }

    const result = await greEventoService.registrarEvento(companyRuc, guiaId, body);

    return redirectWithFlash(
      res,
      appPath(result.success ? '/comprobantes' : backPath),
      result.message || (result.success ? 'OK' : 'Error SUNAT'),
      result.success ? 'success' : 'error',
    );
  } catch (err) {
    if (err.message) {
      return redirectWithFlash(res, appPath('/emitir/guia/eventos'), err.message, 'error');
    }
    next(err);
  }
}

async function showEventoForm(req, res, next) {
  try {
    const modo = String(req.params.modo || '').toUpperCase();
    if (modo === 'GRE_POR_EVENTO') {
      return showGreEventoWizard(req, res, next);
    }
    const meta = EVENTOS.find((e) => e.key === modo);
    if (!meta) {
      return redirectWithFlash(res, appPath('/emitir/guia'), 'Opción no válida.', 'error');
    }

    res.render('app/emitir/evento-form', layoutLocals(res, {
      title: meta.titulo,
      active: 'emitir',
      meta,
      modo,
      backHref: '/emitir/guia/eventos',
      flash: parseFlash(req),
      error: null,
    }));
  } catch (err) {
    next(err);
  }
}

function toTransportistaApi(row) {
  if (!row) return null;
  const pub = companyModel.toPublic(row);
  return {
    id: pub.id,
    ruc: pub.ruc,
    razon_social: pub.nombre,
    nombre: pub.nombre,
    nro_mtc: pub.nro_mtc || pub.nroMtc || null,
  };
}

function makeCatalogHandlers(model, label) {
  return {
    async list(req, res, next) {
      try {
        const companyRuc = companyRucOf(res);
        const { q, offset, limit } = parseOffsetLimit(req.query);
        const [rows, total] = await Promise.all([
          model.listAll(companyRuc, { q: q || null, skip: offset, take: limit }),
          model.countAll(companyRuc, { q: q || null }),
        ]);
        return res.json(buildOffsetPage({
          items: rows.map(model.toApi),
          total,
          offset,
          limit,
        }));
      } catch (err) {
        next(err);
      }
    },
    async create(req, res, next) {
      try {
        const row = await model.create(companyRucOf(res), req.body || {});
        return res.status(201).json(model.toApi(row));
      } catch (err) {
        if (err.status) return res.status(err.status).json({ success: false, message: err.message });
        next(err);
      }
    },
    async update(req, res, next) {
      try {
        const row = await model.update(req.params.id, companyRucOf(res), req.body || {});
        return res.json(model.toApi(row));
      } catch (err) {
        if (err.status) return res.status(err.status).json({ success: false, message: err.message });
        next(err);
      }
    },
    async destroy(req, res, next) {
      try {
        const result = await model.remove(req.params.id, companyRucOf(res));
        return res.json({ success: true, id: result.id });
      } catch (err) {
        if (err.status) return res.status(err.status).json({ success: false, message: err.message });
        next(err);
      }
    },
    label,
  };
}

const vehiculosWeb = makeCatalogHandlers(empresaVehiculoModel, 'vehículo');
const conductoresWeb = makeCatalogHandlers(empresaConductorModel, 'conductor');

const transportistasWeb = {
  async list(req, res, next) {
    try {
      const { q, offset, limit } = parseOffsetLimit(req.query);
      const [rows, total] = await Promise.all([
        companyModel.listForTransporte({
          q: q || null,
          soloConMtc: true,
          skip: offset,
          take: limit,
        }),
        companyModel.countForTransporte({ q: q || null, soloConMtc: true }),
      ]);
      return res.json(buildOffsetPage({
        items: rows.map(toTransportistaApi),
        total,
        offset,
        limit,
      }));
    } catch (err) {
      next(err);
    }
  },
  async create(req, res, next) {
    try {
      const body = req.body || {};
      if (!String(body.nro_mtc || body.nroMtc || '').trim()) {
        return res.status(400).json({ success: false, message: 'El Nro. MTC es obligatorio' });
      }
      const row = await companyModel.upsertTransporte(body);
      return res.status(201).json(toTransportistaApi(row));
    } catch (err) {
      if (err.status) return res.status(err.status).json({ success: false, message: err.message });
      next(err);
    }
  },
  async update(req, res, next) {
    try {
      const body = req.body || {};
      if (body.nro_mtc !== undefined || body.nroMtc !== undefined) {
        if (!String(body.nro_mtc || body.nroMtc || '').trim()) {
          return res.status(400).json({ success: false, message: 'El Nro. MTC es obligatorio' });
        }
      }
      const row = await companyModel.updateTransporte(req.params.id, body);
      return res.json(toTransportistaApi(row));
    } catch (err) {
      if (err.status) return res.status(err.status).json({ success: false, message: err.message });
      next(err);
    }
  },
  async destroy(req, res, next) {
    try {
      const result = await companyModel.removeTransporteIfSafe(req.params.id);
      return res.json({ success: true, id: result.id });
    } catch (err) {
      if (err.status) return res.status(err.status).json({ success: false, message: err.message });
      next(err);
    }
  },
};

module.exports = {
  datosSunat,
  guardarDatosSunat,
  menu,
  guiaMenu,
  eventosMenu,
  showGreEventoWizard,
  submitGreEvento,
  guiasEventoJson,
  guiaEventoDetalleJson,
  showForm,
  submitForm,
  catalogoStockJson,
  documentosAfectadosJson,
  documentoAfectadoLineasJson,
  greRemitenteRecibidasJson,
  movimientosTrasladoJson,
  movimientoTrasladoDetalleJson,
  uploadAdjuntoWeb,
  showEventoForm,
  submitEvento,
  listVehiculosJson: vehiculosWeb.list,
  createVehiculoJson: vehiculosWeb.create,
  updateVehiculoJson: vehiculosWeb.update,
  destroyVehiculoJson: vehiculosWeb.destroy,
  listConductoresJson: conductoresWeb.list,
  createConductorJson: conductoresWeb.create,
  updateConductorJson: conductoresWeb.update,
  destroyConductorJson: conductoresWeb.destroy,
  listTransportistasJson: transportistasWeb.list,
  createTransportistaJson: transportistasWeb.create,
  updateTransportistaJson: transportistasWeb.update,
  destroyTransportistaJson: transportistasWeb.destroy,
};
