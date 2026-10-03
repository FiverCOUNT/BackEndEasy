const comprobanteModel = require('../models/comprobanteModel');
const clienteModel = require('../models/clienteModel');
const compraModel = require('../models/compraModel');
const movimientoModel = require('../models/movimientoModel');
const ubicacionModel = require('../models/ubicacionModel');
const almacenModel = require('../models/almacenModel');
const catalogItemModel = require('../models/catalogItemModel');
const usuarioModel = require('../models/usuarioModel');
const sunatRecibidosSyncService = require('../services/sunatRecibidosSyncService');
const compraPdfService = require('../services/compraPdfService');
const companyModel = require('../models/companyModel');
const prisma = require('../config/prisma');
const { parseLoadMoreQuery, buildLoadMoreMeta } = require('../utils/pagination');
const { appPath } = require('../config/appPanel');
const {
  layoutLocals,
  companyRucOf,
  parseFlash,
  redirectWithFlash,
  formatMoney,
  labelTipoDoc,
  esGrePorEvento,
  labelTipoComprobante,
  formatDocRef,
  formatFecha,
  formatFechaHora,
  formatFechaRelativa,
  labelMotivoNota,
  puedeReenviarPorFalloSunat,
  puedeCorregirGreEvento,
  puedeCorregirVenta,
  urlCorregirVenta,
  mesActualRango,
  isWebCompanyAdmin,
} = require('../utils/appWebHelpers');

function resolveAlmacenFilter(res, queryAlmacen) {
  const isAdmin = isWebCompanyAdmin(res.locals.webUser);
  const userAlmacen = res.locals.userAlmacenId || null;
  // USUARIO: siempre su almacén; sin asignar → null (el caller debe no listar todo).
  if (!isAdmin) return userAlmacen;
  const q = String(queryAlmacen || '').trim();
  return q || null;
}

/** True si el usuario de app no es admin y no tiene almacén: no debe ver movimientos ajenos. */
function debeBloquearMovimientosSinAlmacen(res) {
  return !isWebCompanyAdmin(res.locals.webUser) && !res.locals.userAlmacenId;
}

function resolveUsuarioFilter(queryUsuario) {
  const raw = String(queryUsuario || '').trim();
  if (!raw) return null;
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/** Origen / destino legibles (quién → dónde), no el tipo de movimiento. */
function resolveOrigenDestinoLabels(m, almacenesById = {}) {
  const tipo = String(m.tipo || '').toUpperCase();
  const alm = almacenesById[m.almacen_id] || m.almacenNombre || 'Almacén';
  const destAlm = almacenesById[m.almacen_destino_id] || m.almacenDestinoNombre || '';
  const cliente = m.cliente?.razon_social
    || m.clienteNombre
    || (m.cliente?.numero_doc || m.clienteDoc
      ? `Doc. ${m.cliente?.numero_doc || m.clienteDoc}`
      : '');
  const ref = String(m.referencia_tipo || m.refTipo || '').toUpperCase();
  const esCompra = ref === 'COMPRA' || ref.startsWith('COMPRA');

  if (tipo === 'ENTRADA') {
    const origen = cliente
      || (esCompra ? 'Proveedor' : 'Recepción externa');
    return { origenNombre: origen, destinoNombre: alm, esTraslado: false };
  }
  if (destAlm) {
    return { origenNombre: alm, destinoNombre: destAlm, esTraslado: true };
  }
  return {
    origenNombre: alm,
    destinoNombre: cliente || 'Cliente',
    esTraslado: false,
  };
}

function mapMovimientoListItem(m, almacenesById = {}, regresadosIds = null) {
  const usuario = m.usuario || null;
  const cliente = m.cliente || null;
  const lineas = Array.isArray(m.lineas) ? m.lineas : [];
  const comprobanteId = m.comprobante_id || m.guia_remision_id || null;
  const esSalidaRegresable = String(m.tipo || '') === 'SALIDA'
    && !m.almacen_destino_id
    && String(m.estado || '').toUpperCase() !== 'ANULADA';
  const mappedBase = {
    tipo: m.tipo || '',
    referencia_tipo: m.referencia_tipo || '',
    almacen_id: m.almacen_id,
    almacen_destino_id: m.almacen_destino_id,
    cliente,
    clienteNombre: cliente?.razon_social || '',
    clienteDoc: cliente?.numero_doc || '',
  };
  const { origenNombre, destinoNombre, esTraslado } = resolveOrigenDestinoLabels(
    mappedBase,
    almacenesById,
  );
  return {
    id: m.id,
    numero: m.numero || '—',
    fecha: formatFechaRelativa(m.fecha) || formatFecha(m.fecha),
    tipo: m.tipo || '',
    observaciones: m.observaciones || '',
    refTipo: m.referencia_tipo || '',
    refId: m.referencia_id || '',
    estado: m.estado || '',
    comprobanteId: comprobanteId || '',
    almacenNombre: almacenesById[m.almacen_id] || '',
    almacenDestinoNombre: almacenesById[m.almacen_destino_id] || '',
    origenNombre,
    destinoNombre,
    esTraslado,
    clienteNombre: cliente?.razon_social || '',
    clienteDoc: cliente?.numero_doc || '',
    usuarioNombre: usuario?.nombre || '',
    usuarioEmail: usuario?.email || '',
    lineasCount: lineas.length,
    lineas: lineas.map((l) => ({
      nombre: l.nombre || l.descripcion || 'Ítem',
      codigo: l.codigo || '',
      cantidad: l.cantidad,
      unidad: l.unidad || 'NIU',
      catalog_item_id: l.catalog_item_id || '',
      maneja_serie: Boolean(l.maneja_serie),
      serie: l.producto_serie?.numero_serie || l.serie || '',
      producto_serie_id: l.producto_serie_id || l.producto_serie?.id || '',
      lote: l.lote || '',
      fecha_vencimiento: l.fecha_vencimiento || '',
    })),
    almacenId: m.almacen_id || '',
    puedeRegresar: esSalidaRegresable
      && !(regresadosIds instanceof Set && regresadosIds.has(m.id)),
  };
}

async function loadRegresadosSalidaIds(companyRuc, movimientos = []) {
  const salidaIds = [...new Set(
    (movimientos || [])
      .filter((m) => m && m.tipo === 'SALIDA' && m.id && !m.almacen_destino_id)
      .map((m) => m.id),
  )];
  if (!salidaIds.length) return new Set();
  const rows = await prisma.movimiento.findMany({
    where: {
      companyRuc,
      tipo: 'ENTRADA',
      estado: { not: 'ANULADA' },
      referenciaId: { in: salidaIds },
      referenciaTipo: { in: ['DEVOLUCION_CLIENTE', 'REGRESO_SALIDA'] },
    },
    select: { referenciaId: true },
  });
  return new Set(rows.map((r) => r.referenciaId).filter(Boolean));
}

async function dashboard(req, res, next) {
  try {
    const companyRuc = companyRucOf(res);
    const { desde, hasta } = mesActualRango();
    const almacenId = resolveAlmacenFilter(res, req.query.almacen);

    if (debeBloquearMovimientosSinAlmacen(res)) {
      return res.render('app/dashboard', layoutLocals(res, {
        title: 'Inicio',
        active: 'inicio',
        stats: {
          comprobantesMes: 0,
          comprasMes: 0,
          salidas: 0,
          ingresos: 0,
        },
        mesLabel: new Date().toLocaleDateString('es-PE', { month: 'long', year: 'numeric' }),
        sinAlmacenAsignado: true,
      }));
    }

    const [comprobantes, compras, salidas, entradas] = await Promise.all([
      comprobanteModel.findAllByCompany(companyRuc, { desde, hasta }),
      isWebCompanyAdmin(res.locals.webUser)
        ? compraModel.listByCompany(companyRuc, { desde, hasta })
        : Promise.resolve([]),
      movimientoModel.findMany({
        companyRuc,
        tipo: 'SALIDA',
        almacenId,
      }),
      isWebCompanyAdmin(res.locals.webUser)
        ? movimientoModel.findMany({ companyRuc, tipo: 'ENTRADA', almacenId })
        : Promise.resolve([]),
    ]);

    res.render('app/dashboard', layoutLocals(res, {
      title: 'Inicio',
      active: 'inicio',
      stats: {
        comprobantesMes: comprobantes.length,
        comprasMes: compras.length,
        salidas: salidas.length,
        ingresos: entradas.length,
      },
      mesLabel: new Date().toLocaleDateString('es-PE', { month: 'long', year: 'numeric' }),
      sinAlmacenAsignado: false,
    }));
  } catch (err) {
    next(err);
  }
}

function emitir(req, res) {
  res.render('app/emitir', layoutLocals(res, {
    title: 'Emitir',
    active: 'emitir',
  }));
}

async function comprobantes(req, res, next) {
  try {
    const companyRuc = companyRucOf(res);
    const { q, pageSize } = parseLoadMoreQuery(req.query);
    const {
      resolvePeriodoPreset,
      formatPeriodoElegante,
    } = require('../utils/fechas');

    const rango = resolvePeriodoPreset(req.query);
    const { desde, hasta, periodo, fecha } = rango;
    const doc = String(req.query.doc || '').trim().toUpperCase();

    const DOC_TO_TIPO = {
      FACT: '01',
      BOL: '03',
      NC: '07',
      ND: '08',
      GRE: '09',
      GRT: '31',
      GREV: 'GREV',
    };
    const tipoDocFiltro = DOC_TO_TIPO[doc] || null;

    const { items: all } = await comprobanteModel.findAllByCompany(companyRuc, {
      desde,
      hasta,
      skip: 0,
      take: 10000,
    });

    let filtered = all;
    if (doc === 'GREV') {
      filtered = filtered.filter((row) => esGrePorEvento(row));
    } else if (tipoDocFiltro) {
      filtered = filtered.filter((row) => {
        const t = String(row.tipo_doc || row.tipoDoc || '').padStart(2, '0');
        if (t !== tipoDocFiltro) return false;
        // GRE / GRT no mezclan las emitidas por evento (chip GREV).
        if ((t === '09' || t === '31') && esGrePorEvento(row)) return false;
        return true;
      });
    }
    if (q) {
      const ql = q.toLowerCase();
      filtered = filtered.filter((row) => {
        const ref = formatDocRef(row).toLowerCase();
        const cliente = String(row.client?.nombre || row.client?.razon_social || '').toLowerCase();
        const numero = String(row.client?.numero_doc || row.client?.numeroDoc || '').toLowerCase();
        return ref.includes(ql) || cliente.includes(ql) || numero.includes(ql);
      });
    }

    const totalFiltered = filtered.length;
    const pageItems = filtered.slice(0, pageSize);

    const loadMore = buildLoadMoreMeta({
      total: totalFiltered,
      limit: pageSize,
      basePath: appPath('/comprobantes'),
      query: {
        q,
        periodo,
        fecha,
        desde,
        hasta,
        doc: doc || undefined,
        msg: req.query.msg,
        tipo: req.query.tipo,
      },
    });

    const tiposFiltro = [
      { siglas: 'FACT', label: 'Factura', tipo: '01' },
      { siglas: 'BOL', label: 'Boleta', tipo: '03' },
      { siglas: 'NC', label: 'Nota', tipo: '07' },
      { siglas: 'ND', label: 'N. débito', tipo: '08' },
      { siglas: 'GRE', label: 'Guía', tipo: '09' },
      { siglas: 'GRT', label: 'GRE transp.', tipo: '31' },
      { siglas: 'GREV', label: 'Por evento', tipo: 'GREV' },
    ];

    res.render('app/comprobantes/listar', layoutLocals(res, {
      title: 'Comprobantes',
      active: 'comprobantes',
      items: pageItems.map((row) => {
        const tipoDoc = String(row.tipo_doc || row.tipoDoc || '').padStart(2, '0');
        const porEvento = esGrePorEvento(row);
        return {
          id: row.id,
          ref: formatDocRef(row),
          tipoDoc,
          porEvento,
          tipoLabel: labelTipoComprobante(row),
          cliente: row.client?.nombre || row.client?.razon_social || row.client?.numero_doc || '—',
          clienteDoc: row.client?.numero_doc || row.client?.numeroDoc || '',
          fecha: formatFechaHora(row.fecha_emision),
          total: formatMoney(row.mto_imp_venta, row.tipo_moneda),
          totalRaw: Number(row.mto_imp_venta) || 0,
          subtotal: formatMoney(row.mto_oper_gravadas ?? row.sub_total, row.tipo_moneda),
          igv: formatMoney(row.mto_igv, row.tipo_moneda),
          estado: row.estado || row.sunat_estado || '—',
          observacion: row.observacion || '',
          sunatCodigo: row.sunat_codigo || '',
          sunatDescripcion: row.sunat_descripcion || '',
        puedeReenviar: puedeReenviarPorFalloSunat(row),
        puedeCorregirEvento: puedeCorregirGreEvento(row),
        puedeCorregirVenta: puedeCorregirVenta(row),
        corregirUrl: urlCorregirVenta(row),
          lineas: Array.isArray(row.details) ? row.details.length : (row._count?.details || 0),
        };
      }),
      total: totalFiltered,
      q,
      desde,
      hasta,
      periodo,
      fecha,
      hoyIso: require('../utils/fechas').hoyIsoPe(),
      doc,
      periodoLabel: formatPeriodoElegante(desde, hasta),
      tiposFiltro,
      loadMore,
      flash: parseFlash(req),
      detalleApiBase: appPath('/comprobantes'),
    }));
  } catch (err) {
    next(err);
  }
}

async function comprobanteDetalleJson(req, res, next) {
  try {
    const companyRuc = companyRucOf(res);
    const id = String(req.params.id || '').trim();
    const invoice = await comprobanteModel.findByIdForCompanyAccess(id, companyRuc);
    if (!invoice) {
      return res.status(404).json({ success: false, message: 'Comprobante no encontrado' });
    }
    const api = await comprobanteModel.toApiInvoiceEnriched(invoice, {
      apiBaseUrl: `${req.protocol}://${req.get('host')}`,
    });
    return res.json({
      success: true,
      comprobante: {
        id: api.id,
        ref: formatDocRef(api),
        tipoDoc: String(api.tipo_doc || '').padStart(2, '0'),
        tipoLabel: labelTipoComprobante(api),
        cliente: api.client?.nombre || api.client?.razon_social || api.cliente?.razon_social || '—',
        clienteDoc: api.client?.numero_doc || api.cliente?.numero_doc || '',
        clienteTipoDoc: api.client?.tipo_doc || api.cliente?.tipo_doc || '',
        fecha: formatFechaHora(api.fecha_emision),
        estado: api.estado || api.sunat_estado || '—',
        observacion: api.observacion || '',
        motivo: labelMotivoNota(api.tipo_doc, api.motivo_codigo, api.motivo_nota),
        motivoNota: api.motivo_nota || '',
        puedeReenviar: puedeReenviarPorFalloSunat(api),
        puedeCorregirEvento: puedeCorregirGreEvento(api),
        puedeCorregirVenta: puedeCorregirVenta(api),
        corregirUrl: urlCorregirVenta(api),
        corregirEventoUrl: puedeCorregirGreEvento(api)
          ? appPath(`/emitir/guia/eventos/GRE_POR_EVENTO?corregir=${encodeURIComponent(api.id)}`)
          : '',
        documentoAfectado: api.documento_afectado
          ? `${labelTipoDoc(api.documento_afectado.tipo_doc)} ${api.documento_afectado.serie || ''}-${api.documento_afectado.correlativo || ''}`
          : '',
        moneda: api.tipo_moneda || 'PEN',
        subtotal: formatMoney(api.mto_oper_gravadas ?? api.sub_total, api.tipo_moneda),
        igv: formatMoney(api.mto_igv, api.tipo_moneda),
        total: formatMoney(api.mto_imp_venta, api.tipo_moneda),
        lineas: (api.details || []).map((d) => ({
          nombre: d.descripcion || d.nombre || 'Ítem',
          cantidad: d.cantidad,
          unidad: d.unidad || 'NIU',
          precio: formatMoney(d.mto_precio_unitario ?? d.mtoPrecioUnitario, api.tipo_moneda),
          total: formatMoney(d.total ?? d.total_factura ?? d.mto_valor_venta, api.tipo_moneda),
          serie: d.producto_serie?.numero_serie || d.numero_serie || '',
        })),
        pdfA4Url: appPath(`/comprobantes/${api.id}/archivos/pdf?formato=a4`),
        pdfTicketUrl: appPath(`/comprobantes/${api.id}/archivos/pdf?formato=ticket`),
        xmlUrl: appPath(`/comprobantes/${api.id}/archivos/xml`),
      },
    });
  } catch (err) {
    next(err);
  }
}

async function comprobanteArchivo(req, res, next) {
  try {
    const companyRuc = companyRucOf(res);
    const id = String(req.params.id || '').trim();
    const tipo = String(req.params.tipo || 'pdf').trim().toLowerCase();
    const formato = String(req.query.formato || 'a4').trim().toLowerCase();
    const invoice = await comprobanteModel.findByIdForCompanyAccess(id, companyRuc);
    if (!invoice) {
      return res.status(404).json({ success: false, message: 'Comprobante no encontrado' });
    }

    if (tipo === 'pdf' && String(invoice.estado || '').toUpperCase() === 'BORRADOR') {
      return res.status(409).json({
        success: false,
        message: 'Este comprobante quedó en borrador: la emisión a SUNAT no se completó, por eso aún no hay PDF.',
      });
    }

    const archivo = await comprobanteModel.getArchivoBuffer(invoice, tipo, {
      formato,
      apiBaseUrl: `${req.protocol}://${req.get('host')}`,
    });
    if (!archivo?.buffer) {
      return res.status(404).json({ success: false, message: 'Archivo no disponible' });
    }

    const sufijo = tipo === 'pdf' && (formato === 'ticket' || formato === 'thermal') ? '-ticket' : '';
    const nombre = `${invoice.serie}-${invoice.correlativo}${sufijo}.${archivo.ext || 'pdf'}`;
    res.setHeader('Content-Type', archivo.contentType || 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${nombre}"`);
    return res.send(archivo.buffer);
  } catch (err) {
    next(err);
  }
}

async function reenviarComprobante(req, res, next) {
  const wantsJson = String(req.headers.accept || '').includes('application/json')
    || String(req.query.format || '') === 'json'
    || req.xhr;

  const reply = (message, type, extra = {}) => {
    if (wantsJson) {
      return res.status(type === 'error' ? 409 : 200).json({
        success: type !== 'error',
        message,
        ...extra,
      });
    }
    return redirectWithFlash(res, appPath('/comprobantes'), message, type);
  };

  try {
    const companyRuc = companyRucOf(res);
    const id = String(req.params.id || req.body?.id || '').trim();
    const invoice = await comprobanteModel.findByIdForEmission(id, companyRuc);
    if (!invoice) return reply('Comprobante no encontrado.', 'error');

    const snapshot = {
      estado: invoice.estado,
      tipo_doc: invoice.tipoDoc,
      sunat_codigo: invoice.sunatCodigoDirecto,
      sunat_descripcion: invoice.sunatDescripcionDirecto,
      observacion: invoice.observacion,
    };
    if (!puedeReenviarPorFalloSunat(snapshot)) {
      return reply(
        'Este rechazo es de SUNAT (datos del comprobante), no un fallo de conexión. No se puede reenviar igual.',
        'error',
      );
    }

    const comprobanteEmisionService = require('../services/comprobanteEmisionService');
    const comprobante = await comprobanteEmisionService.emitirComprobanteExistente(invoice, {
      apiBaseUrl: `${req.protocol}://${req.get('host')}`,
      almacenId: invoice.almacenId || res.locals.userAlmacenId || null,
      usuarioId: res.locals.webUser?.id || null,
    });
    const ref = formatDocRef(comprobante);
    const ok = ['ACEPTADO', 'ENVIADO'].includes(String(comprobante.estado || '').toUpperCase());
    const desc = comprobante.sunat_descripcion || comprobante.sunatDescripcion || '';
    return reply(
      ok ? `${ref} aceptado por SUNAT.` : (desc || `Guardado ${ref} (revisar SUNAT)`),
      ok ? 'success' : 'error',
      { id: comprobante.id, estado: comprobante.estado, ref },
    );
  } catch (err) {
    if (wantsJson) {
      return res.status(500).json({ success: false, message: err.message || 'No se pudo reenviar.' });
    }
    return redirectWithFlash(res, appPath('/comprobantes'), err.message || 'No se pudo reenviar.', 'error');
  }
}

async function eliminarComprobantes(req, res, next) {
  try {
    const companyRuc = companyRucOf(res);
    const raw = req.body?.ids ?? req.body?.id ?? [];
    const ids = Array.isArray(raw)
      ? raw
      : String(raw || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

    const result = await comprobanteModel.deleteManyForCompany(companyRuc, ids);
    const wantsJson = String(req.headers.accept || '').includes('application/json')
      || String(req.query.format || '') === 'json'
      || req.xhr;

    if (wantsJson) {
      return res.json({
        success: result.eliminados > 0,
        message: result.eliminados
          ? `Se eliminaron ${result.eliminados} comprobante(s).`
          : 'No se eliminó ningún comprobante.',
        ...result,
      });
    }

    if (!result.eliminados) {
      return redirectWithFlash(
        res,
        appPath('/comprobantes'),
        result.fallidos[0]?.message || 'No se eliminó ningún comprobante.',
        'error',
      );
    }
    const extra = result.fallidos.length
      ? ` (${result.fallidos.length} no se pudieron borrar)`
      : '';
    return redirectWithFlash(
      res,
      appPath('/comprobantes'),
      `Se eliminaron ${result.eliminados} comprobante(s).${extra}`,
    );
  } catch (err) {
    next(err);
  }
}

async function clientes(req, res, next) {
  try {
    const companyRuc = companyRucOf(res);
    const { q, pageSize } = parseLoadMoreQuery(req.query);

    const { total, items } = await clienteModel.findByCompanyPaginated(companyRuc, {
      q,
      skip: 0,
      take: pageSize,
    });

    const loadMore = buildLoadMoreMeta({
      total,
      limit: pageSize,
      basePath: appPath('/clientes'),
      query: { q, msg: req.query.msg, tipo: req.query.tipo },
    });

    res.render('app/clientes/listar', layoutLocals(res, {
      title: 'Clientes',
      active: 'clientes',
      items,
      total,
      q,
      loadMore,
      flash: parseFlash(req),
    }));
  } catch (err) {
    next(err);
  }
}

async function showClienteCreate(req, res, next) {
  try {
    res.render('app/clientes/form', layoutLocals(res, {
      title: 'Nuevo cliente',
      active: 'clientes',
      editId: null,
      error: null,
      form: { tipo_doc: '6', numero_doc: '', razon_social: '', email: '', telefono: '', address: {} },
    }));
  } catch (err) {
    next(err);
  }
}

async function createCliente(req, res, next) {
  try {
    const companyRuc = companyRucOf(res);
    const body = req.body || {};
    const numeroDoc = String(body.numero_doc || '').replace(/\D/g, '');
    const razonSocial = String(body.razon_social || body.nombre || '').trim();
    if (!numeroDoc || !razonSocial) {
      return res.render('app/clientes/form', layoutLocals(res, {
        title: 'Nuevo cliente',
        active: 'clientes',
        editId: null,
        error: 'Documento y razón social son obligatorios.',
        form: body,
      }));
    }
    await clienteModel.create({
      companyRuc,
      tipoDoc: body.tipo_doc || (numeroDoc.length === 11 ? '6' : '1'),
      numeroDoc,
      razonSocial,
      telefono: body.telefono || null,
      addressInput: body.address || null,
    });
    return redirectWithFlash(res, appPath('/clientes'), 'Cliente registrado.');
  } catch (err) {
    if (err.status === 409) {
      return res.render('app/clientes/form', layoutLocals(res, {
        title: 'Nuevo cliente',
        active: 'clientes',
        editId: null,
        error: err.message,
        form: req.body,
      }));
    }
    next(err);
  }
}

async function showClienteDetail(req, res, next) {
  try {
    const companyRuc = companyRucOf(res);
    const id = String(req.params.id || '').trim();
    const cliente = await clienteModel.findById(id, companyRuc);
    if (!cliente) {
      return redirectWithFlash(res, appPath('/clientes'), 'Cliente no encontrado.', 'error');
    }

    const almacenId = resolveAlmacenFilter(res, null);
    if (debeBloquearMovimientosSinAlmacen(res)) {
      return res.render('app/clientes/detalle', layoutLocals(res, {
        title: cliente.razon_social || 'Cliente',
        active: 'clientes',
        cliente,
        movimientos: [],
        entregas: 0,
        devoluciones: 0,
        flash: parseFlash(req),
        sinAlmacenAsignado: true,
      }));
    }

    const [movimientosRaw, almacenesAll] = await Promise.all([
      movimientoModel.findByCliente({ companyRuc, clienteId: id, almacenId }),
      almacenModel.findByCompanyRuc(companyRuc, { soloActivos: false }),
    ]);
    const almacenesById = Object.fromEntries(
      (almacenesAll || []).map((a) => [a.id, a.nombre || a.codigo || a.id]),
    );
    const regresadosIds = await loadRegresadosSalidaIds(companyRuc, movimientosRaw);
    const movimientos = (movimientosRaw || []).map((m) => mapMovimientoListItem(m, almacenesById, regresadosIds));
    const entregas = (movimientosRaw || []).filter(
      (m) => m.tipo === 'SALIDA' && !m.almacen_destino_id,
    ).length;
    const devoluciones = (movimientosRaw || []).filter(
      (m) => m.tipo === 'ENTRADA' && m.referencia_tipo === 'DEVOLUCION_CLIENTE',
    ).length;

    res.render('app/clientes/detalle', layoutLocals(res, {
      title: cliente.razon_social || 'Cliente',
      active: 'clientes',
      cliente,
      movimientos,
      entregas,
      devoluciones,
      almacenes: isWebCompanyAdmin(res.locals.webUser)
        ? (almacenesAll || []).filter((a) => a.activo !== false)
        : [],
      flash: parseFlash(req),
    }));
  } catch (err) {
    next(err);
  }
}

async function showClienteEdit(req, res, next) {
  try {
    const companyRuc = companyRucOf(res);
    const id = String(req.params.id || '').trim();
    const cliente = await clienteModel.findById(id, companyRuc);
    if (!cliente) {
      return redirectWithFlash(res, appPath('/clientes'), 'Cliente no encontrado.', 'error');
    }

    res.render('app/clientes/form', layoutLocals(res, {
      title: 'Editar cliente',
      active: 'clientes',
      editId: cliente.id,
      error: null,
      form: {
        tipo_doc: cliente.tipo_doc,
        numero_doc: cliente.numero_doc,
        razon_social: cliente.razon_social,
        telefono: cliente.telefono || '',
        address: cliente.address || {},
      },
    }));
  } catch (err) {
    next(err);
  }
}

async function updateCliente(req, res, next) {
  try {
    const companyRuc = companyRucOf(res);
    const id = String(req.params.id || '').trim();
    const body = req.body || {};
    const razonSocial = String(body.razon_social || body.nombre || '').trim();
    if (!razonSocial) {
      const cliente = await clienteModel.findById(id, companyRuc);
      if (!cliente) {
        return redirectWithFlash(res, appPath('/clientes'), 'Cliente no encontrado.', 'error');
      }
      return res.render('app/clientes/form', layoutLocals(res, {
        title: 'Editar cliente',
        active: 'clientes',
        editId: id,
        error: 'El nombre es obligatorio.',
        form: { ...cliente, ...body },
      }));
    }

    const row = await clienteModel.update(id, companyRuc, {
      razonSocial,
      telefono: Object.prototype.hasOwnProperty.call(body, 'telefono')
        ? (body.telefono || '').trim() || null
        : undefined,
      addressInput: Object.prototype.hasOwnProperty.call(body, 'address')
        ? (body.address || null)
        : undefined,
    });
    if (!row) {
      return redirectWithFlash(res, appPath('/clientes'), 'Cliente no encontrado.', 'error');
    }
    return redirectWithFlash(res, appPath(`/clientes/${id}`), 'Cliente actualizado.');
  } catch (err) {
    next(err);
  }
}

async function compras(req, res, next) {
  try {
    const companyRuc = companyRucOf(res);
    const { q, pageSize } = parseLoadMoreQuery(req.query);
    const {
      resolvePeriodoPreset,
      formatPeriodoElegante,
      hoyIsoPe,
    } = require('../utils/fechas');

    const rango = resolvePeriodoPreset(req.query);
    const { desde, hasta, periodo, fecha } = rango;
    const DOC_TO_TIPO = {
      FACT: '01',
      BOL: '03',
      NC: '07',
      ND: '08',
      GRE: '09',
      GRT: '31',
    };
    // Siempre un chip activo (default FACT) para no sincronizar todo junto.
    const docRaw = String(req.query.doc || '').trim().toUpperCase();
    const doc = DOC_TO_TIPO[docRaw] ? docRaw : 'FACT';
    const tipoDocFiltro = DOC_TO_TIPO[doc];

    const all = await compraModel.listByCompany(companyRuc, { desde, hasta });
    let filtered = all;
    filtered = filtered.filter((row) => String(row.tipo_doc || row.tipoDoc || '').padStart(2, '0') === tipoDocFiltro);
    if (q) {
      const ql = q.toLowerCase();
      filtered = filtered.filter((row) => {
        const ref = formatDocRef(row).toLowerCase();
        const prov = String(row.company?.nombre || row.company?.numero_doc || '').toLowerCase();
        const numero = String(row.company?.numero_doc || '').toLowerCase();
        return ref.includes(ql) || prov.includes(ql) || numero.includes(ql);
      });
    }

    const totalFiltered = filtered.length;
    const pageItems = filtered.slice(0, pageSize);
    const syncPeriodo = String(desde || '').replace(/-/g, '').slice(0, 6) || mesActualRango().periodo;

    const loadMore = buildLoadMoreMeta({
      total: totalFiltered,
      limit: pageSize,
      basePath: appPath('/compras'),
      query: {
        q,
        periodo,
        fecha,
        desde,
        hasta,
        doc,
        msg: req.query.msg,
        tipo: req.query.tipo,
      },
    });

    const tiposFiltro = [
      { siglas: 'FACT', label: 'Factura', tipo: '01' },
      { siglas: 'BOL', label: 'Boleta', tipo: '03' },
      { siglas: 'NC', label: 'Nota', tipo: '07' },
      { siglas: 'ND', label: 'N. débito', tipo: '08' },
      { siglas: 'GRE', label: 'Guía', tipo: '09' },
      { siglas: 'GRT', label: 'GRE transp.', tipo: '31' },
    ];

    res.render('app/compras/listar', layoutLocals(res, {
      title: 'Compras',
      active: 'compras',
      items: pageItems.map((row) => {
        const tipoDoc = String(row.tipo_doc || row.tipoDoc || '').padStart(2, '0');
        const esGre = tipoDoc === '09' || tipoDoc === '31';
        const nLineas = Array.isArray(row.details) ? row.details.length : 0;
        return {
          id: row.id,
          ref: formatDocRef(row),
          tipoDoc,
          tipoLabel: labelTipoDoc(row.tipo_doc),
          esGre,
          proveedor: row.company?.nombre || row.company?.numero_doc || '—',
          proveedorDoc: row.company?.numero_doc || '',
          fecha: formatFecha(row.fecha_emision),
          total: esGre
            ? `${nLineas} bien(es)`
            : formatMoney(row.mto_imp_venta, row.tipo_moneda),
          subtotal: esGre ? '' : formatMoney(row.mto_oper_gravadas ?? row.sub_total, row.tipo_moneda),
          igv: esGre ? '' : formatMoney(row.mto_igv, row.tipo_moneda),
          estado: row.estado || '—',
          sentido: row.sentido || 'RECIBIDO',
          observacion: row.observacion || '',
          lineas: nLineas,
          pdfUrl: appPath(`/compras/${row.id}/pdf`),
          xmlUrl: row.xml_url || '',
        };
      }),
      total: totalFiltered,
      q,
      desde,
      hasta,
      periodo,
      fecha,
      hoyIso: hoyIsoPe(),
      doc,
      periodoLabel: formatPeriodoElegante(desde, hasta),
      syncPeriodo,
      tiposFiltro,
      loadMore,
      flash: parseFlash(req),
      detalleApiBase: appPath('/compras'),
    }));
  } catch (err) {
    next(err);
  }
}

const COMPRA_RESERVED_IDS = new Set(['sincronizar', 'sync', 'eliminar', 'crear', 'editar']);

async function compraDetalleJson(req, res, next) {
  try {
    const companyRuc = companyRucOf(res);
    const id = String(req.params.id || '').trim();
    if (!id || COMPRA_RESERVED_IDS.has(id.toLowerCase())) {
      return res.status(404).json({ success: false, message: 'Ruta de compra no válida' });
    }
    const compra = await compraModel.findById(companyRuc, id);
    if (!compra) {
      return res.status(404).json({ success: false, message: 'Compra no encontrada' });
    }
    const tipoDoc = String(compra.tipo_doc || '').padStart(2, '0');
    const esGre = tipoDoc === '09' || tipoDoc === '31';
    const nLineas = Array.isArray(compra.details) ? compra.details.length : 0;
    const docsRel = Array.isArray(compra.documentos_relacionados)
      ? compra.documentos_relacionados
      : (Array.isArray(compra.facturas) ? compra.facturas : []);

    // Si es GRE y hay factura relacionada en compras, enriquecer precios por descripción.
    let lineasEnriquecidas = compra.details || [];
    if (esGre && docsRel.length) {
      lineasEnriquecidas = await enriquecerPreciosGreDesdeFacturas(companyRuc, lineasEnriquecidas, docsRel);
    }

    return res.json({
      success: true,
      compra: {
        id: compra.id,
        ref: formatDocRef(compra),
        tipoDoc,
        tipoLabel: labelTipoDoc(compra.tipo_doc),
        esGre,
        proveedor: compra.company?.nombre || compra.company?.numero_doc || '—',
        proveedorDoc: compra.company?.numero_doc || '',
        fecha: formatFecha(compra.fecha_emision),
        estado: compra.estado || '—',
        sentido: compra.sentido || 'RECIBIDO',
        observacion: compra.observacion || '',
        moneda: compra.tipo_moneda || 'PEN',
        subtotal: esGre ? null : formatMoney(compra.mto_oper_gravadas ?? compra.sub_total, compra.tipo_moneda),
        igv: esGre ? null : formatMoney(compra.mto_igv, compra.tipo_moneda),
        total: esGre
          ? `${nLineas} bien(es) trasladado(s)`
          : formatMoney(compra.mto_imp_venta, compra.tipo_moneda),
        documentosRelacionados: docsRel.map((d) => ({
          ref: `${d.serie || ''}-${d.correlativo || ''}`.replace(/^-|-$/g, ''),
          tipoDoc: String(d.tipo_doc || d.tipoDoc || '01').padStart(2, '0'),
          emisor: d.emisor_numero_doc || d.emisorNumeroDoc || '',
        })).filter((d) => d.ref),
        lineas: lineasEnriquecidas.map((d) => {
          const precioNum = Number(d.mto_precio_unitario ?? d.precio_unitario) || 0;
          const cant = Number(d.cantidad) || 0;
          if (esGre && precioNum <= 0) {
            return {
              nombre: d.descripcion || d.nombre || 'Ítem',
              cantidad: d.cantidad,
              unidad: d.unidad || 'NIU',
              precio: null,
              total: null,
              esBien: true,
            };
          }
          return {
            nombre: d.descripcion || d.nombre || 'Ítem',
            cantidad: d.cantidad,
            unidad: d.unidad || 'NIU',
            precio: formatMoney(precioNum, compra.tipo_moneda),
            total: formatMoney(cant * precioNum, compra.tipo_moneda),
            esBien: esGre,
          };
        }),
        pdfUrl: appPath(`/compras/${compra.id}/pdf`),
        pdfSunatUrl: compra.pdf_url || '',
        xmlUrl: compra.xml_url || '',
      },
    });
  } catch (err) {
    next(err);
  }
}

/** Copia precios de facturas relacionadas (si ya están en compras) a líneas GRE sin monto. */
async function enriquecerPreciosGreDesdeFacturas(companyRuc, lineas, docsRel) {
  const out = (lineas || []).map((l) => ({ ...l }));
  const priceByDesc = new Map();
  for (const doc of docsRel || []) {
    const serie = String(doc.serie || '').trim().toUpperCase();
    const corr = String(doc.correlativo || '').replace(/^0+/, '') || '0';
    if (!serie) continue;
    const rows = await prisma.compra.findMany({
      where: {
        companyRuc: String(companyRuc),
        serie,
        tipoDoc: String(doc.tipo_doc || doc.tipoDoc || '01').padStart(2, '0'),
      },
      take: 20,
    });
    const match = rows.find((r) => String(r.correlativo || '').replace(/^0+/, '') === corr);
    if (!match || !Array.isArray(match.lineasJson)) continue;
    for (const fl of match.lineasJson) {
      const key = String(fl.descripcion || fl.nombre || '').trim().toLowerCase();
      const pu = Number(fl.precio_unitario ?? fl.mto_precio_unitario) || 0;
      if (key && pu > 0) priceByDesc.set(key, pu);
    }
  }
  if (!priceByDesc.size) return out;
  for (const line of out) {
    const actual = Number(line.mto_precio_unitario ?? line.precio_unitario) || 0;
    if (actual > 0) continue;
    const key = String(line.descripcion || line.nombre || '').trim().toLowerCase();
    const pu = priceByDesc.get(key);
    if (pu > 0) {
      line.precio_unitario = pu;
      line.mto_precio_unitario = pu;
    }
  }
  return out;
}

/**
 * PDF de representación con datos de `compras.lineas` (JSON), igual que la app.
 * GET /app/compras/:id/pdf
 */
async function compraPdf(req, res, next) {
  try {
    const companyRuc = companyRucOf(res);
    const id = String(req.params.id || '').trim();
    if (!id || COMPRA_RESERVED_IDS.has(id.toLowerCase())) {
      return res.status(404).json({ success: false, message: 'Compra no encontrada' });
    }
    const compra = await compraModel.findById(companyRuc, id);
    if (!compra) {
      return res.status(404).json({ success: false, message: 'Compra no encontrada' });
    }
    const receptor = await companyModel.findByRuc(companyRuc);
    const buffer = await compraPdfService.generarPdfBuffer(compra, receptor);
    const nombre = `${compra.serie || 'DOC'}-${compra.correlativo || id}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${nombre}"`);
    return res.send(buffer);
  } catch (err) {
    next(err);
  }
}

async function eliminarCompras(req, res, next) {
  try {
    const companyRuc = companyRucOf(res);
    const raw = req.body?.ids ?? req.body?.id ?? [];
    const ids = Array.isArray(raw)
      ? raw
      : String(raw || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

    const result = await compraModel.deleteManyForCompany(companyRuc, ids);
    const wantsJson = String(req.headers.accept || '').includes('application/json')
      || String(req.query.format || '') === 'json'
      || req.xhr;

    if (wantsJson) {
      return res.json({
        success: result.eliminados > 0,
        message: result.eliminados
          ? `Se eliminaron ${result.eliminados} compra(s).`
          : 'No se eliminó ninguna compra.',
        ...result,
      });
    }

    if (!result.eliminados) {
      return redirectWithFlash(
        res,
        appPath('/compras'),
        result.fallidos[0]?.message || 'No se eliminó ninguna compra.',
        'error',
      );
    }
    const extra = result.fallidos.length
      ? ` (${result.fallidos.length} no se pudieron borrar)`
      : '';
    return redirectWithFlash(
      res,
      appPath('/compras'),
      `Se eliminaron ${result.eliminados} compra(s).${extra}`,
    );
  } catch (err) {
    next(err);
  }
}

function wantsJsonResponse(req) {
  return String(req.headers.accept || '').includes('application/json')
    || String(req.query.format || '') === 'json'
    || Boolean(req.xhr);
}

function parseForceFlag(value) {
  if (value === true || value === 1) return true;
  const s = String(value ?? '').trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'yes' || s === 'on';
}

async function sincronizarCompras(req, res, next) {
  const syncTimeoutMs = Number(process.env.SUNAT_RECIBIDOS_SYNC_HTTP_TIMEOUT_MS || 30 * 60 * 1000);
  try {
    if (typeof req.setTimeout === 'function') req.setTimeout(syncTimeoutMs);
    if (typeof res.setTimeout === 'function') res.setTimeout(syncTimeoutMs);
    const companyRuc = companyRucOf(res);
    const periodo = req.body?.periodo || req.query?.periodo || mesActualRango().periodo;
    const DOC_SYNC = new Set(['FACT', 'BOL', 'NC', 'ND', 'GRE', 'GRT', 'ALL']);
    const docRaw = String(req.body?.doc || req.query?.doc || '').trim().toUpperCase();
    const doc = DOC_SYNC.has(docRaw) ? docRaw : 'ALL';
    // Clic manual en la UI siempre fuerza (el cooldown solo aplica a sync automático).
    const force = parseForceFlag(req.body?.force ?? req.query?.force) || wantsJsonResponse(req);
    const result = await sunatRecibidosSyncService.sincronizarRecibidos(companyRuc, {
      periodo,
      force,
      doc,
      apiBaseUrl: null,
    });
    const creados = Number(result?.facturas_scraper?.creados || 0)
      + Number(result?.gre_scraper?.creados || 0)
      + Number(result?.sire?.creados || 0);
    const enriquecidos = Number(result?.facturas_scraper?.enriquecidos || 0)
      + Number(result?.gre_scraper?.enriquecidos || 0)
      + Number(result?.sire?.enriquecidos || 0);
    const scraperErr = result?.facturas_scraper_error || result?.gre_scraper_error || null;
    let msg;
    if (result.skipped) {
      msg = result.reason === 'sync_en_curso'
        ? 'Ya hay una sincronización en curso para este periodo.'
        : 'Sync omitido (cooldown). Usa forzar si necesitas actualizar ya.';
    } else if (scraperErr && creados === 0 && enriquecidos === 0) {
      msg = `Sync falló: ${scraperErr}`;
    } else {
      msg = result.message
        || `Sincronización OK · ${creados} nuevos · ${enriquecidos} actualizados · periodo ${periodo}`;
    }
    if (wantsJsonResponse(req)) {
      return res.json({
        success: true,
        skipped: Boolean(result.skipped),
        reason: result.reason || null,
        message: msg,
        periodo,
        doc: result.doc || doc || null,
        force,
        creados,
        enriquecidos,
        facturas_scraper: result.facturas_scraper || null,
        facturas_scraper_error: result.facturas_scraper_error || null,
        gre_scraper: result.gre_scraper || null,
        gre_scraper_error: result.gre_scraper_error || null,
      });
    }
    const qsDoc = doc ? `&doc=${encodeURIComponent(doc)}` : '';
    return redirectWithFlash(res, appPath(`/compras?periodo=mes${qsDoc}`), msg, scraperErr && !creados ? 'error' : 'success');
  } catch (err) {
    if (wantsJsonResponse(req)) {
      return res.status(err.status || 500).json({
        success: false,
        message: err.message || 'Error al sincronizar',
      });
    }
    return redirectWithFlash(
      res,
      appPath('/compras'),
      err.message || 'Error al sincronizar',
      'error',
    );
  }
}

async function salidas(req, res, next) {
  try {
    const companyRuc = companyRucOf(res);
    const isAdmin = isWebCompanyAdmin(res.locals.webUser);
    const almacenId = resolveAlmacenFilter(res, req.query.almacen);
    const usuarioId = isAdmin ? resolveUsuarioFilter(req.query.usuario) : null;
    const { pageSize } = parseLoadMoreQuery(req.query);

    if (debeBloquearMovimientosSinAlmacen(res)) {
      return res.render('app/inventario/movimientos', layoutLocals(res, {
        title: 'Salidas',
        active: 'salidas',
        tipo: 'SALIDA',
        items: [],
        total: 0,
        almacenes: [],
        almacenId: null,
        usuarios: [],
        usuarioId: null,
        loadMore: null,
        flash: parseFlash(req),
        sinAlmacenAsignado: true,
      }));
    }

    const [result, almacenesAll, usuarios] = await Promise.all([
      movimientoModel.findMany({
        companyRuc,
        tipo: 'SALIDA',
        almacenId,
        usuarioId,
        skip: 0,
        take: pageSize,
      }),
      almacenModel.findByCompanyRuc(companyRuc, { soloActivos: false }),
      isAdmin
        ? usuarioModel.findByCompanyRuc(companyRuc, { soloActivos: true })
        : Promise.resolve([]),
    ]);

    const almacenesById = Object.fromEntries(
      (almacenesAll || []).map((a) => [a.id, a.nombre || a.codigo || a.id]),
    );
    const almacenes = isAdmin
      ? (almacenesAll || []).filter((a) => a.activo !== false)
      : [];

    const loadMore = buildLoadMoreMeta({
      total: result.total,
      limit: pageSize,
      basePath: appPath('/salidas'),
      query: {
        almacen: almacenId || undefined,
        usuario: usuarioId || undefined,
      },
    });

    const regresadosIds = await loadRegresadosSalidaIds(companyRuc, result.items);

    res.render('app/inventario/movimientos', layoutLocals(res, {
      title: 'Salidas',
      active: 'salidas',
      tipo: 'SALIDA',
      items: result.items.map((m) => mapMovimientoListItem(m, almacenesById, regresadosIds)),
      total: result.total,
      almacenes,
      almacenId,
      usuarios,
      usuarioId,
      loadMore,
      flash: parseFlash(req),
      sinAlmacenAsignado: false,
    }));
  } catch (err) {
    next(err);
  }
}

function mapSalidaError(result) {
  const code = result?.error;
  const map = {
    almacen_not_found: 'Almacén no encontrado.',
    almacen_destino_not_found: 'Almacén destino no encontrado.',
    almacen_destino_requerido: 'Indica el almacén destino.',
    mismo_almacen: 'Origen y destino no pueden ser el mismo almacén.',
    cliente_requerido: 'Selecciona un cliente.',
    cliente_not_found: 'Cliente no encontrado.',
    lineas_vacias: 'Agrega al menos un producto.',
    item_not_found: 'Producto no encontrado.',
    item_inactivo: 'Hay un producto inactivo.',
    series_requeridas: 'Indica el número de serie.',
    cantidad_series: 'Con serie la cantidad debe ser 1.',
    cantidad_invalida: 'Cantidad inválida.',
    stock_insuficiente: `Stock insuficiente${result.catalogItemId ? ` (${result.catalogItemId})` : ''}.`,
    series_no_disponibles: `Serie no disponible${result.numeroSerie ? `: ${result.numeroSerie}` : ''}.`,
  };
  return map[code] || result?.message || 'No se pudo registrar la salida.';
}

function parseSalidaLineasFromBody(body = {}) {
  const catalogIds = [].concat(body.catalog_item_id || []);
  const cantidades = [].concat(body.cantidad || []);
  const seriesIds = [].concat(body.producto_serie_id || []);
  const numerosSerie = [].concat(body.numero_serie || []);
  const lotes = [].concat(body.lote || []);
  const fechas = [].concat(body.fecha_vencimiento || []);
  const loteIds = [].concat(body.producto_lote_id || []);
  const n = Math.max(
    catalogIds.length,
    cantidades.length,
    seriesIds.length,
    numerosSerie.length,
    lotes.length,
    fechas.length,
    loteIds.length,
  );
  const lineas = [];
  for (let i = 0; i < n; i += 1) {
    const catalogItemId = String(catalogIds[i] || '').trim();
    if (!catalogItemId) continue;
    const cantidad = Number(String(cantidades[i] || '').replace(',', '.'));
    const productoSerieId = String(seriesIds[i] || '').trim();
    const numeroSerie = String(numerosSerie[i] || '').trim();
    const lote = String(lotes[i] || '').trim().slice(0, 64);
    const fecha = String(fechas[i] || '').trim().slice(0, 10);
    const productoLoteId = String(loteIds[i] || '').trim();
    lineas.push({
      catalog_item_id: catalogItemId,
      cantidad: Number.isFinite(cantidad) && cantidad > 0 ? cantidad : (numeroSerie || productoSerieId ? 1 : 0),
      producto_serie_id: productoSerieId || undefined,
      numero_serie: numeroSerie || undefined,
      lote: lote || undefined,
      fecha_vencimiento: /^\d{4}-\d{2}-\d{2}$/.test(fecha) ? fecha : undefined,
      producto_lote_id: productoLoteId || undefined,
    });
  }
  return lineas.filter((l) => l.catalog_item_id && l.cantidad > 0);
}

async function loadSalidaFormLocals(res, { error = null, form = {}, lineasIniciales = [] } = {}) {
  const companyRuc = companyRucOf(res);
  const isAdmin = isWebCompanyAdmin(res.locals.webUser);
  const userAlmacenId = res.locals.userAlmacenId || null;
  const [almacenesAll, catalogo, clientesRaw] = await Promise.all([
    almacenModel.findByCompanyRuc(companyRuc, { soloActivos: true }),
    catalogItemModel.findByCompanyRuc(companyRuc).catch(() => []),
    clienteModel.findAllByCompany(companyRuc).catch(() => []),
  ]);
  const clientes = (Array.isArray(clientesRaw) ? clientesRaw : []).map((c) => ({
    id: c.id,
    nombre: c.razon_social || c.razonSocial || '',
    numero_doc: c.numero_doc || c.numeroDoc || '',
    tipo_doc_label: c.tipo_doc_label || c.tipoDocLabel || '',
  }));
  const almacenesOrigen = isAdmin
    ? almacenesAll
    : almacenesAll.filter((a) => a.id === userAlmacenId);
  const defaultAlmacenId = !isAdmin
    ? (userAlmacenId || '')
    : (userAlmacenId || (almacenesOrigen[0] && almacenesOrigen[0].id) || '');
  const origenBloqueado = !isAdmin;

  let formError = error;
  if (!formError && origenBloqueado && !userAlmacenId) {
    formError = 'Tu usuario no tiene almacén asignado. Pide a un admin que te asigne uno.';
  }

  return layoutLocals(res, {
    title: 'Nueva salida',
    active: 'salidas',
    error: formError,
    almacenesOrigen,
    almacenesDestino: almacenesAll,
    clientes,
    catalogo: Array.isArray(catalogo) ? catalogo : [],
    defaultAlmacenId,
    origenBloqueado,
    puedeTrasladar: isAdmin,
    lineasIniciales: Array.isArray(lineasIniciales) ? lineasIniciales : [],
    form: {
      almacen_id: origenBloqueado
        ? (userAlmacenId || '')
        : (form.almacen_id != null ? form.almacen_id : defaultAlmacenId),
      almacen_destino_id: isAdmin ? (form.almacen_destino_id || '') : '',
      cliente_id: form.cliente_id || '',
      observaciones: form.observaciones || '',
    },
    catalogoStockUrl: appPath('/emitir/catalogo-stock'),
    seriesApiUrl: appPath('/ordenes/catalogo'),
  });
}

async function showSalidaCreate(req, res, next) {
  try {
    res.render('app/inventario/salida-form', await loadSalidaFormLocals(res));
  } catch (err) {
    next(err);
  }
}

async function createSalida(req, res, next) {
  try {
    const companyRuc = companyRucOf(res);
    const isAdmin = isWebCompanyAdmin(res.locals.webUser);
    const userAlmacenId = res.locals.userAlmacenId || null;
    const webUser = res.locals.webUser || {};

    let almacenId = String(req.body.almacen_id || req.body.almacenId || '').trim();
    if (!isAdmin) {
      almacenId = userAlmacenId || '';
      if (!almacenId) {
        return res.status(400).render(
          'app/inventario/salida-form',
          await loadSalidaFormLocals(res, {
            error: 'Tu usuario no tiene almacén asignado. Pide a un admin que te asigne uno.',
            form: {
              almacen_id: '',
              almacen_destino_id: String(req.body.almacen_destino_id || '').trim(),
              cliente_id: String(req.body.cliente_id || '').trim(),
              observaciones: String(req.body.observaciones || ''),
            },
          }),
        );
      }
    }
    const almacenDestinoId = isAdmin
      ? String(req.body.almacen_destino_id || req.body.almacenDestinoId || '').trim()
      : '';
    const clienteId = String(req.body.cliente_id || req.body.clienteId || '').trim();
    const observaciones = String(req.body.observaciones || '').trim() || null;
    const formState = {
      almacen_id: almacenId,
      almacen_destino_id: almacenDestinoId,
      cliente_id: almacenDestinoId ? '' : clienteId,
      observaciones: observaciones || '',
    };

    if (!almacenId) {
      return res.status(400).render(
        'app/inventario/salida-form',
        await loadSalidaFormLocals(res, {
          error: 'Selecciona el almacén de origen.',
          form: formState,
        }),
      );
    }
    if (!almacenDestinoId && !clienteId) {
      return res.status(400).render(
        'app/inventario/salida-form',
        await loadSalidaFormLocals(res, {
          error: isAdmin
            ? 'Selecciona un cliente o un almacén de destino.'
            : 'Selecciona un cliente.',
          form: formState,
          lineasIniciales: parseSalidaLineasFromBody(req.body),
        }),
      );
    }

    const lineas = parseSalidaLineasFromBody(req.body);
    const result = await movimientoModel.registrarSalida({
      companyRuc,
      almacenId,
      almacenDestinoId: almacenDestinoId || null,
      lineas,
      observaciones,
      clienteId: almacenDestinoId ? null : clienteId,
      usuarioId: webUser.id != null ? Number(webUser.id) : null,
    });

    if (result.error) {
      return res.status(400).render(
        'app/inventario/salida-form',
        await loadSalidaFormLocals(res, {
          error: mapSalidaError(result),
          form: formState,
          lineasIniciales: lineas,
        }),
      );
    }

    const numero = result.movimiento?.numero || 'salida';
    return redirectWithFlash(res, appPath('/salidas'), `Salida ${numero} registrada.`);
  } catch (err) {
    next(err);
  }
}

function mapRegresarError(result) {
  const code = result?.error;
  const map = {
    not_found: 'Salida no encontrada.',
    no_es_salida: 'Solo se pueden regresar salidas.',
    anulada: 'La salida está anulada.',
    es_traslado: 'Los traslados no se regresan desde aquí.',
    ya_regresado: result?.numero
      ? `Esta salida ya fue regresada (${result.numero}).`
      : 'Esta salida ya fue regresada.',
    almacen_not_found: 'Almacén no encontrado.',
    almacen_inactivo: 'El almacén destino no está activo.',
    lineas_vacias: 'La salida no tiene productos para regresar.',
    nada_por_regresar: 'Los productos de esta salida ya están en almacén.',
    serie_no_entregada: `Serie no entregada${result.numeroSerie ? `: ${result.numeroSerie}` : ''}.`,
    serie_no_de_cliente: `Serie no corresponde al cliente${result.numeroSerie ? `: ${result.numeroSerie}` : ''}.`,
    serie_no_de_salida: `Serie no pertenece a esta salida${result.numeroSerie ? `: ${result.numeroSerie}` : ''}.`,
    cliente_requerido: 'La salida no tiene cliente asociado.',
    cliente_not_found: 'Cliente no encontrado.',
    item_not_found: 'Producto no encontrado.',
    item_inactivo: 'Hay un producto inactivo.',
    almacen_requerido: 'Selecciona el almacén de destino.',
  };
  return map[code] || result?.message || 'No se pudo registrar el ingreso.';
}

async function regresarSalida(req, res, next) {
  try {
    const companyRuc = companyRucOf(res);
    const webUser = res.locals.webUser || {};
    const isAdmin = isWebCompanyAdmin(webUser);
    const userAlmacenId = res.locals.userAlmacenId || null;
    const salidaId = String(req.params.id || '').trim();
    const body = req.body || {};
    const bodyAlmacenId = String(body.almacen_id || body.almacenId || '').trim();

    if (!isAdmin && !userAlmacenId) {
      return res.status(403).json({
        ok: false,
        error: 'sin_almacen',
        message: 'Tu usuario no tiene almacén asignado.',
      });
    }

    const salida = await movimientoModel.findById(salidaId, companyRuc);
    if (!salida) {
      return res.status(404).json({
        ok: false,
        error: 'not_found',
        message: 'Salida no encontrada.',
      });
    }

    if (!isAdmin) {
      if (String(salida.almacen_id || '') !== String(userAlmacenId)) {
        return res.status(403).json({
          ok: false,
          error: 'almacen_ajeno',
          message: 'Solo puedes regresar salidas de tu almacén.',
        });
      }
    }

    // Usuario: siempre al mismo almacén de la salida. Admin: elige destino.
    let destinoAlmacenId = isAdmin
      ? (bodyAlmacenId || salida.almacen_id || '')
      : String(salida.almacen_id || userAlmacenId || '');

    if (isAdmin && !destinoAlmacenId) {
      return res.status(400).json({
        ok: false,
        error: 'almacen_requerido',
        message: 'Selecciona el almacén de destino.',
      });
    }

    const result = await movimientoModel.regresarSalida({
      companyRuc,
      salidaId,
      almacenId: destinoAlmacenId,
      usuarioId: webUser.id != null ? Number(webUser.id) : null,
    });

    if (result.error) {
      return res.status(400).json({
        ok: false,
        error: result.error,
        message: mapRegresarError(result),
        movimiento_id: result.movimientoId || null,
        numero: result.numero || null,
      });
    }

    const mov = result.movimiento;
    return res.json({
      ok: true,
      message: `Ingreso ${mov?.numero || ''} registrado.`,
      movimiento: mov,
    });
  } catch (err) {
    next(err);
  }
}

async function ingresos(req, res, next) {
  try {
    const companyRuc = companyRucOf(res);
    const isAdmin = isWebCompanyAdmin(res.locals.webUser);
    const almacenId = resolveAlmacenFilter(res, req.query.almacen);
    const { pageSize } = parseLoadMoreQuery(req.query);

    if (debeBloquearMovimientosSinAlmacen(res)) {
      return res.render('app/inventario/movimientos', layoutLocals(res, {
        title: 'Ingresos',
        active: 'ingresos',
        tipo: 'ENTRADA',
        items: [],
        total: 0,
        almacenes: [],
        almacenId: null,
        usuarios: [],
        usuarioId: null,
        loadMore: null,
        flash: parseFlash(req),
        sinAlmacenAsignado: true,
      }));
    }

    const [result, almacenesAll] = await Promise.all([
      movimientoModel.findMany({
        companyRuc,
        tipo: 'ENTRADA',
        almacenId,
        usuarioId: null,
        skip: 0,
        take: pageSize,
      }),
      almacenModel.findByCompanyRuc(companyRuc, { soloActivos: false }),
    ]);

    const almacenesById = Object.fromEntries(
      (almacenesAll || []).map((a) => [a.id, a.nombre || a.codigo || a.id]),
    );
    const almacenes = isAdmin
      ? (almacenesAll || []).filter((a) => a.activo !== false)
      : [];

    const loadMore = buildLoadMoreMeta({
      total: result.total,
      limit: pageSize,
      basePath: appPath('/ingresos'),
      query: {
        almacen: almacenId || undefined,
      },
    });

    res.render('app/inventario/movimientos', layoutLocals(res, {
      title: 'Ingresos',
      active: 'ingresos',
      tipo: 'ENTRADA',
      items: result.items.map((m) => mapMovimientoListItem(m, almacenesById)),
      total: result.total,
      almacenes,
      almacenId,
      usuarios: [],
      usuarioId: null,
      loadMore,
      flash: parseFlash(req),
      sinAlmacenAsignado: false,
    }));
  } catch (err) {
    next(err);
  }
}

function mapIngresoError(result) {
  const code = result?.error;
  const map = {
    almacen_not_found: 'Almacén no encontrado.',
    lineas_vacias: 'Agrega al menos un producto.',
    item_not_found: 'Producto no encontrado.',
    item_inactivo: 'Hay un producto inactivo.',
    series_requeridas: 'Indica el número de serie.',
    cantidad_series: 'Con serie la cantidad debe ser 1.',
    cantidad_invalida: 'Cantidad inválida.',
    serie_existente: `La serie ya existe${result.numeroSerie ? `: ${result.numeroSerie}` : ''}.`,
    lote_requerido: `Indica el lote${result.nombre ? ` de ${result.nombre}` : ''}.`,
    vencimiento_requerido: `Indica la fecha de vencimiento${result.nombre ? ` de ${result.nombre}` : ''}.`,
    cliente_requerido: 'Selecciona un cliente.',
    cliente_not_found: 'Cliente no encontrado.',
  };
  return map[code] || result?.message || 'No se pudo registrar el ingreso.';
}

function disponibleParaIngresoCatalog(item) {
  if (!item || item.activo === false) return false;
  const kind = String(item.kind || 'PRODUCT').toUpperCase();
  if (kind === 'SERVICE') return false;
  const manejaStock = item.manejaStock === true || item.maneja_stock === true;
  const manejaSerie = item.manejaSerie === true || item.maneja_serie === true;
  return manejaStock || manejaSerie;
}

async function loadIngresoFormLocals(res, { error = null, form = {}, lineasIniciales = [] } = {}) {
  const companyRuc = companyRucOf(res);
  const isAdmin = isWebCompanyAdmin(res.locals.webUser);
  const userAlmacenId = res.locals.userAlmacenId || null;
  const [almacenesAll, catalogoRaw, clientesRaw] = await Promise.all([
    almacenModel.findByCompanyRuc(companyRuc, { soloActivos: true }),
    catalogItemModel.findByCompanyRuc(companyRuc).catch(() => []),
    clienteModel.findAllByCompany(companyRuc).catch(() => []),
  ]);
  const almacenes = isAdmin
    ? almacenesAll
    : almacenesAll.filter((a) => a.id === userAlmacenId);
  const defaultAlmacenId = !isAdmin
    ? (userAlmacenId || '')
    : (userAlmacenId || (almacenes[0] && almacenes[0].id) || '');
  const almacenBloqueado = !isAdmin;

  let formError = error;
  if (!formError && almacenBloqueado && !userAlmacenId) {
    formError = 'Tu usuario no tiene almacén asignado. Pide a un admin que te asigne uno.';
  }

  const catalogo = (Array.isArray(catalogoRaw) ? catalogoRaw : [])
    .filter(disponibleParaIngresoCatalog);
  const clientes = (Array.isArray(clientesRaw) ? clientesRaw : []).map((c) => ({
    id: c.id,
    nombre: c.razon_social || c.razonSocial || '',
    numero_doc: c.numero_doc || c.numeroDoc || '',
    tipo_doc_label: c.tipo_doc_label || c.tipoDocLabel || '',
  }));

  return layoutLocals(res, {
    title: 'Nuevo ingreso',
    active: 'ingresos',
    error: formError,
    almacenes,
    catalogo,
    clientes,
    defaultAlmacenId,
    almacenBloqueado,
    lineasIniciales: Array.isArray(lineasIniciales) ? lineasIniciales : [],
    form: {
      almacen_id: almacenBloqueado
        ? (userAlmacenId || '')
        : (form.almacen_id != null ? form.almacen_id : defaultAlmacenId),
      observaciones: form.observaciones || '',
      procedencia: form.procedencia === 'cliente' ? 'cliente' : 'externa',
      cliente_id: form.cliente_id || '',
      tipo_ingreso: 'nuevo',
    },
  });
}

async function showIngresoCreate(req, res, next) {
  try {
    res.render('app/inventario/ingreso-form', await loadIngresoFormLocals(res));
  } catch (err) {
    next(err);
  }
}

async function createIngreso(req, res, next) {
  try {
    const companyRuc = companyRucOf(res);
    const isAdmin = isWebCompanyAdmin(res.locals.webUser);
    const userAlmacenId = res.locals.userAlmacenId || null;
    const webUser = res.locals.webUser || {};

    let almacenId = String(req.body.almacen_id || req.body.almacenId || '').trim();
    if (!isAdmin) {
      almacenId = userAlmacenId || '';
      if (!almacenId) {
        return res.status(400).render(
          'app/inventario/ingreso-form',
          await loadIngresoFormLocals(res, {
            error: 'Tu usuario no tiene almacén asignado. Pide a un admin que te asigne uno.',
            form: { almacen_id: '', observaciones: String(req.body.observaciones || '') },
          }),
        );
      }
    }

    const observaciones = String(req.body.observaciones || '').trim() || null;
    const clienteId = String(req.body.cliente_id || '').trim();
    const procedencia = clienteId ? 'cliente' : 'externa';
    const formState = {
      almacen_id: almacenId,
      observaciones: observaciones || '',
      procedencia,
      cliente_id: clienteId,
      tipo_ingreso: 'nuevo',
    };

    if (!almacenId) {
      return res.status(400).render(
        'app/inventario/ingreso-form',
        await loadIngresoFormLocals(res, {
          error: 'Selecciona el almacén de destino.',
          form: formState,
        }),
      );
    }

    const lineas = parseSalidaLineasFromBody(req.body);
    const result = await movimientoModel.registrarEntrada({
      companyRuc,
      almacenId,
      lineas,
      observaciones,
      clienteId: clienteId || null,
      referenciaTipo: clienteId ? 'INGRESO_CLIENTE' : null,
      usuarioId: webUser.id != null ? Number(webUser.id) : null,
    });

    if (result.error) {
      return res.status(400).render(
        'app/inventario/ingreso-form',
        await loadIngresoFormLocals(res, {
          error: mapIngresoError(result),
          form: formState,
          lineasIniciales: lineas,
        }),
      );
    }

    const numero = result.movimiento?.numero || 'ingreso';
    return redirectWithFlash(res, appPath('/ingresos'), `Ingreso ${numero} registrado.`);
  } catch (err) {
    next(err);
  }
}

async function historial(req, res, next) {
  try {
    const companyRuc = companyRucOf(res);
    const { q, pageSize } = parseLoadMoreQuery(req.query, { step: 10 });
    const productoId = String(req.query.producto || req.query.producto_id || '').trim();
    let modo = String(req.query.modo || '').toLowerCase();
    const almacenId = resolveAlmacenFilter(res, req.query.almacen);

    if (debeBloquearMovimientosSinAlmacen(res)) {
      return res.render('app/inventario/historial', layoutLocals(res, {
        title: 'Historial',
        active: 'historial',
        items: [],
        series: [],
        total: 0,
        q,
        modo: modo || 'nombre',
        almacenes: [],
        almacenId: null,
        productos: [],
        productoSel: null,
        vista: 'vacio',
        loadMore: null,
        flash: parseFlash(req),
        sinAlmacenAsignado: true,
      }));
    }

    const isAdmin = isWebCompanyAdmin(res.locals.webUser);
    const [productosRaw, almacenesAll] = await Promise.all([
      catalogItemModel.findByCompanyRuc(companyRuc, {
        almacenId: null,
        restrictToAlmacen: false,
      }),
      almacenModel.findByCompanyRuc(companyRuc, { soloActivos: false }),
    ]);
    const almacenes = isAdmin
      ? (almacenesAll || []).filter((a) => a.activo !== false)
      : [];
    const almacenesById = Object.fromEntries(
      (almacenesAll || []).map((a) => [a.id, a.nombre || a.codigo || a.id]),
    );
    const almacenNombre = almacenId ? (almacenesById[almacenId] || '') : '';

    const productos = (productosRaw || [])
      .filter((p) => p && p.activo !== false && p.kind !== 'SERVICE')
      .map((p) => ({
        id: p.id,
        nombre: p.nombre || p.descripcion || 'Producto',
        codigo: p.codigo || '',
        maneja_serie: Boolean(p.maneja_serie || p.manejaSerie),
      }))
      .sort((a, b) => String(a.nombre).localeCompare(String(b.nombre), 'es'));

    let productoSel = null;
    if (productoId) {
      productoSel = productos.find((p) => p.id === productoId) || null;
      if (!productoSel) {
        const raw = await catalogItemModel.findById(productoId);
        if (raw && String(raw.companyRuc || '') === String(companyRuc)) {
          productoSel = {
            id: raw.id,
            nombre: raw.nombre || 'Producto',
            codigo: raw.codigo || '',
            maneja_serie: Boolean(raw.manejaSerie),
          };
        }
      }
    }

    if (productoSel) {
      modo = productoSel.maneja_serie ? 'serie' : 'producto';
    } else if (!modo) {
      modo = 'nombre';
    }

    let items = [];
    let series = [];
    let total = 0;
    let vista = 'vacio';

    if (productoSel && !productoSel.maneja_serie) {
      const result = await ubicacionModel.historialPorProducto({
        companyRuc,
        catalogItemId: productoSel.id,
        almacenId,
        limit: pageSize,
      });
      items = result.items || [];
      total = result.total || 0;
      vista = 'producto';
    } else if (productoSel?.maneja_serie && q.length < 2) {
      vista = 'serie_manual';
      total = 0;
    } else if (modo === 'serie' && q.length >= 2) {
      const result = await ubicacionModel.buscarPorSerie({
        companyRuc,
        q,
        almacenId,
        catalogItemId: productoSel?.maneja_serie ? productoSel.id : null,
        limit: 200,
        orden: 'asc',
      });
      items = result.items || [];
      series = result.series || [];
      total = items.length;
      vista = items.length ? 'serie_timeline' : 'vacio';
    } else if (q.length >= 2) {
      const all = await ubicacionModel.buscarPorNombre({
        companyRuc,
        q,
        almacenId,
        limit: 200,
      });
      total = all.length;
      items = all.slice(0, pageSize);
      vista = items.length ? 'nombre' : 'vacio';
    } else if (almacenId && !productoSel && q.length < 2) {
      const result = await ubicacionModel.historialPorAlmacen({
        companyRuc,
        almacenId,
        limit: pageSize,
      });
      items = result.items || [];
      total = result.total || 0;
      vista = 'almacen';
    }

    const loadMore = (vista === 'producto' || vista === 'nombre' || vista === 'almacen')
      ? buildLoadMoreMeta({
        total,
        limit: pageSize,
        step: 10,
        basePath: appPath('/historial'),
        query: {
          q: q || undefined,
          modo,
          producto: productoSel?.id || undefined,
          almacen: almacenId || undefined,
        },
      })
      : (total > 0
        ? { total, shown: items.length, hasMore: false }
        : null);

    res.render('app/inventario/historial', layoutLocals(res, {
      title: 'Historial',
      active: 'historial',
      items,
      series,
      total,
      q,
      modo,
      almacenes,
      almacenId,
      almacenNombre,
      productos,
      productoSel,
      vista,
      loadMore,
      flash: parseFlash(req),
      sinAlmacenAsignado: false,
    }));
  } catch (err) {
    next(err);
  }
}

async function almacenes(req, res, next) {
  try {
    const companyRuc = companyRucOf(res);
    const { q, pageSize, skip } = parseLoadMoreQuery(req.query);
    const { total, items } = await almacenModel.findPaginated({
      q,
      companyRuc,
      page: 1,
      pageSize,
      skip,
    });

    const loadMore = buildLoadMoreMeta({
      total,
      limit: pageSize,
      basePath: appPath('/almacenes'),
      query: { q, msg: req.query.msg, tipo: req.query.tipo },
    });

    res.render('app/almacenes/listar', layoutLocals(res, {
      title: 'Almacenes',
      active: 'almacenes',
      items,
      total,
      q,
      loadMore,
      flash: parseFlash(req),
    }));
  } catch (err) {
    next(err);
  }
}

function formAlmacenFromBody(body) {
  // En POST: checkbox ausente = inactivo (no default true).
  const parsed = almacenModel.parseBody(body, { activoDefault: false });
  return {
    codigo: parsed.codigo,
    nombre: parsed.nombre,
    activo: parsed.activo,
    ubigeo: String(body.ubigeo || '').trim(),
    departamento: String(body.departamento || '').trim(),
    provincia: String(body.provincia || '').trim(),
    distrito: String(body.distrito || '').trim(),
    direccion: String(body.direccion || '').trim(),
    codLocal: String(body.codLocal || body.cod_local || '0000').trim() || '0000',
  };
}

function formAlmacenFromRow(almacen) {
  const a = almacenModel.toPublic(almacen);
  return {
    codigo: a.codigo || '',
    nombre: a.nombre || '',
    activo: a.activo !== false,
    ubigeo: a.address?.ubigeo || '',
    departamento: a.address?.departamento || '',
    provincia: a.address?.provincia || '',
    distrito: a.address?.distrito || '',
    direccion: a.address?.direccion || '',
    codLocal: a.address?.codLocal || '0000',
  };
}

async function assertAlmacenEmpresa(res, id) {
  const companyRuc = companyRucOf(res);
  const almacen = await almacenModel.findById(id);
  if (!almacen || almacen.companyRuc !== companyRuc) return null;
  return almacen;
}

async function showAlmacenCreate(req, res) {
  res.render('app/almacenes/form', layoutLocals(res, {
    title: 'Nuevo almacén',
    active: 'almacenes',
    isEdit: false,
    itemId: null,
    error: null,
    form: {
      codigo: '',
      nombre: '',
      activo: true,
      ubigeo: '',
      departamento: '',
      provincia: '',
      distrito: '',
      direccion: '',
      codLocal: '0000',
    },
  }));
}

async function createAlmacen(req, res, next) {
  try {
    const companyRuc = companyRucOf(res);
    const form = formAlmacenFromBody({ ...req.body, companyRuc });
    const renderError = (error) => res.status(400).render('app/almacenes/form', layoutLocals(res, {
      title: 'Nuevo almacén',
      active: 'almacenes',
      isEdit: false,
      itemId: null,
      error,
      form,
    }));

    if (!form.codigo) return renderError('El código es obligatorio.');
    if (!form.nombre) return renderError('El nombre es obligatorio.');
    if (await almacenModel.findByCodigo(companyRuc, form.codigo)) {
      return renderError('Ya existe un almacén con ese código.');
    }

    await almacenModel.create({
      ...form,
      companyRuc,
      company_ruc: companyRuc,
      activo: form.activo ? 'on' : 'false',
    });
    return redirectWithFlash(res, appPath('/almacenes'), 'Almacén creado.');
  } catch (err) {
    next(err);
  }
}

async function showAlmacenEdit(req, res, next) {
  try {
    const id = String(req.params.id || '').trim();
    const almacen = await assertAlmacenEmpresa(res, id);
    if (!almacen) {
      return redirectWithFlash(res, appPath('/almacenes'), 'Almacén no encontrado.', 'error');
    }
    res.render('app/almacenes/form', layoutLocals(res, {
      title: 'Editar almacén',
      active: 'almacenes',
      isEdit: true,
      itemId: almacen.id,
      error: null,
      form: formAlmacenFromRow(almacen),
    }));
  } catch (err) {
    next(err);
  }
}

async function updateAlmacen(req, res, next) {
  try {
    const id = String(req.params.id || '').trim();
    const companyRuc = companyRucOf(res);
    const existing = await assertAlmacenEmpresa(res, id);
    if (!existing) {
      return redirectWithFlash(res, appPath('/almacenes'), 'Almacén no encontrado.', 'error');
    }

    const form = formAlmacenFromBody({ ...req.body, companyRuc });
    const renderError = (error) => res.status(400).render('app/almacenes/form', layoutLocals(res, {
      title: 'Editar almacén',
      active: 'almacenes',
      isEdit: true,
      itemId: id,
      error,
      form,
    }));

    if (!form.codigo) return renderError('El código es obligatorio.');
    if (!form.nombre) return renderError('El nombre es obligatorio.');
    if (await almacenModel.findByCodigoExceptId(companyRuc, form.codigo, id)) {
      return renderError('Ya existe otro almacén con ese código.');
    }

    await almacenModel.update(id, {
      ...form,
      companyRuc,
      company_ruc: companyRuc,
      activo: form.activo ? 'on' : 'false',
    });
    return redirectWithFlash(res, appPath('/almacenes'), 'Almacén actualizado.');
  } catch (err) {
    next(err);
  }
}

async function activarAlmacen(req, res, next) {
  try {
    const id = String(req.params.id || '').trim();
    const almacen = await assertAlmacenEmpresa(res, id);
    if (!almacen) {
      return redirectWithFlash(res, appPath('/almacenes'), 'Almacén no encontrado.', 'error');
    }
    await almacenModel.setActive(id, true);
    return redirectWithFlash(res, appPath('/almacenes'), 'Almacén activado.');
  } catch (err) {
    next(err);
  }
}

async function desactivarAlmacen(req, res, next) {
  try {
    const id = String(req.params.id || '').trim();
    const almacen = await assertAlmacenEmpresa(res, id);
    if (!almacen) {
      return redirectWithFlash(res, appPath('/almacenes'), 'Almacén no encontrado.', 'error');
    }
    await almacenModel.setActive(id, false);
    return redirectWithFlash(res, appPath('/almacenes'), 'Almacén desactivado.');
  } catch (err) {
    next(err);
  }
}

async function eliminarAlmacen(req, res, next) {
  try {
    const id = String(req.params.id || '').trim();
    const almacen = await assertAlmacenEmpresa(res, id);
    if (!almacen) {
      return redirectWithFlash(res, appPath('/almacenes'), 'Almacén no encontrado.', 'error');
    }
    const result = await almacenModel.remove(id);
    if (result.error === 'has_relations') {
      return redirectWithFlash(
        res,
        appPath('/almacenes'),
        'No se puede eliminar: tiene usuarios, stock o movimientos. Desactívalo en su lugar.',
        'error',
      );
    }
    if (result.error) {
      return redirectWithFlash(res, appPath('/almacenes'), 'No se pudo eliminar el almacén.', 'error');
    }
    return redirectWithFlash(res, appPath('/almacenes'), 'Almacén eliminado.');
  } catch (err) {
    next(err);
  }
}

module.exports = {
  dashboard,
  emitir,
  comprobantes,
  comprobanteDetalleJson,
  comprobanteArchivo,
  reenviarComprobante,
  eliminarComprobantes,
  clientes,
  showClienteCreate,
  createCliente,
  showClienteDetail,
  showClienteEdit,
  updateCliente,
  compras,
  compraDetalleJson,
  compraPdf,
  eliminarCompras,
  sincronizarCompras,
  salidas,
  showSalidaCreate,
  createSalida,
  regresarSalida,
  ingresos,
  showIngresoCreate,
  createIngreso,
  historial,
  almacenes,
  showAlmacenCreate,
  createAlmacen,
  showAlmacenEdit,
  updateAlmacen,
  activarAlmacen,
  desactivarAlmacen,
  eliminarAlmacen,
};
