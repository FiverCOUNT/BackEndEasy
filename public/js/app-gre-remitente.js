(function () {
  const form = document.getElementById('greRemitenteForm');
  if (!form) return;

  const pasosTitulos = {
    1: 'Motivo SUNAT',
    2: 'Detalle de bienes',
    3: 'Datos de la carga',
    4: 'Ruta',
    5: 'Modalidad',
    6: 'Transporte',
    7: 'Fechas y resumen',
  };

  let step = 1;
  const max = 7;
  const companyRuc = form.dataset.companyRuc || '';
  const companyNombre = form.dataset.companyNombre || '';

  const panes = () => [...form.querySelectorAll('.ios-wizard-pane')];
  const dots = () => [...document.querySelectorAll('.ios-wizard-dot')];
  const btnPrev = document.getElementById('btnPrev');
  const btnNext = document.getElementById('btnNext');
  const btnSubmit = document.getElementById('btnSubmit');
  const titulo = document.getElementById('pasoTitulo');

  function motivoRadio() {
    return form.querySelector('input[name="cod_traslado"]:checked');
  }

  function modalidad() {
    return (form.querySelector('input[name="mod_traslado"]:checked') || {}).value || '02';
  }

  function syncChoices() {
    form.querySelectorAll('.ios-choice').forEach((lab) => {
      const input = lab.querySelector('input');
      lab.classList.toggle('is-on', Boolean(input && input.checked));
    });
  }

  function applyMotivoUi() {
    const m = motivoRadio();
    const docs = m?.dataset.docs || 'facturas';

    const blockFacturas = document.getElementById('blockFacturas');
    const hint = document.getElementById('bienesHint');
    const fieldLabel = document.getElementById('greDocsFieldLabel');
    if (blockFacturas) blockFacturas.hidden = docs === 'ninguno';
    const blockMov = document.getElementById('blockMovimientos');
    if (blockMov) blockMov.hidden = docs !== 'ninguno';
    if (docs !== 'ninguno' && typeof clearMovimientosSel === 'function') clearMovimientosSel();
    else if (docs === 'ninguno' && typeof syncMovimientosUi === 'function') syncMovimientosUi();

    // Fuente del listado según motivo SUNAT.
    if (docs === 'compras') docFuente = 'compras';
    else if (docs === 'mixto') docFuente = docFuentePreferidaMixto || 'ventas';
    else if (docs === 'facturas' || docs === 'opcional') docFuente = 'ventas';
    else docFuente = 'ventas';

    if (fieldLabel) {
      if (docs === 'compras') fieldLabel.textContent = 'Compras recibidas';
      else if (docs === 'mixto') fieldLabel.textContent = 'Facturas o compras';
      else fieldLabel.textContent = 'Comprobantes emitidos';
    }

    if (hint) {
      if (docs === 'facturas') {
        hint.textContent = 'Puedes marcar varias facturas emitidas. Destinatario y bienes salen de ellas.';
      } else if (docs === 'compras') {
        hint.textContent = 'Puedes marcar varias compras recibidas. Destinatario = tu RUC; bienes salen de ellas.';
      } else if (docs === 'mixto') {
        hint.textContent = 'Puedes vincular facturas emitidas y/o compras recibidas (varias).';
      } else if (docs === 'ninguno') {
        hint.textContent = 'Traslado interno entre tus locales. Elige movimientos ya hechos para armar los bienes.';
      } else {
        hint.textContent = 'Documento afectado opcional. Si vinculas varios, los bienes se toman de ellos.';
      }
    }
    syncDocFuenteTabs();
    syncDestinatarioUi();
    if (typeof syncBienesUi === 'function') syncBienesUi();
    if (typeof pintarFacturasSel === 'function') pintarFacturasSel();
  }

  function clearTransportista() {
    setVal('transportistaRuc', '');
    setVal('transportistaNombre', '');
    setVal('transportistaMtc', '');
    if (typeof pintarTransPick === 'function') pintarTransPick();
  }

  function applyModalidadUi() {
    const esPublico = modalidad() === '01' && !m1Activo();
    const pub = document.getElementById('blockPublico');
    if (pub) {
      pub.hidden = !esPublico;
      pub.setAttribute('aria-hidden', esPublico ? 'false' : 'true');
    }
    const fechaEnt = document.getElementById('fechaEntregaWrap');
    if (fechaEnt) {
      fechaEnt.hidden = !esPublico;
      fechaEnt.setAttribute('aria-hidden', esPublico ? 'false' : 'true');
    }
    if (!esPublico) clearTransportista();
  }

  function m1Activo() {
    return Boolean(document.getElementById('trasladoVehiculoM1L')?.checked);
  }

  function clearConductorFields() {
    ['conductorId', 'conductorDoc', 'conductorNombre', 'conductorLicencia'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.value = id === 'conductorTipo' ? '1' : '';
    });
    const tipo = document.getElementById('conductorTipo');
    if (tipo) tipo.value = '1';
    const sec = document.getElementById('conductorSecundariosJson');
    if (sec) sec.value = '[]';
    if (typeof pintarCondPick === 'function') pintarCondPick();
    if (typeof pintarCondSecList === 'function') pintarCondSecList();
  }

  function applyM1Ui() {
    const on = m1Activo();
    const cond = document.getElementById('blockConductor');
    if (cond) {
      cond.hidden = on;
      cond.setAttribute('aria-hidden', on ? 'true' : 'false');
    }
    const secAdd = document.getElementById('greVehiAddSec');
    if (secAdd) secAdd.hidden = on;
    const secList = document.getElementById('greVehiSecList');
    if (secList && on) {
      secList.hidden = true;
      const secJson = document.getElementById('vehiculoSecundariosJson');
      if (secJson) secJson.value = '[]';
    }
    if (on) {
      const priv = form.querySelector('input[name="mod_traslado"][value="02"]');
      if (priv && !priv.checked) {
        priv.checked = true;
        form.querySelectorAll('input[name="mod_traslado"]').forEach((r) => {
          r.closest('.ios-choice')?.classList.toggle('is-on', r.checked);
        });
      }
      clearConductorFields();
      clearTransportista();
    }
    applyModalidadUi();
  }

  document.getElementById('trasladoVehiculoM1L')?.addEventListener('change', applyM1Ui);

  const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'set', 'oct', 'nov', 'dic'];
  const FECHA_ITEM_H = 40;
  const greFechaSheet = document.getElementById('greFechaSheet');
  const greFechaTitulo = document.getElementById('greFechaSheetTitulo');
  const greFechaHint = document.getElementById('greFechaSheetHint');
  let greFechaTarget = 'traslado';
  let greFechaWheel = { day: 1, month: 1, year: new Date().getFullYear() };
  let greFechaBuilt = false;

  function pad2(n) { return String(n).padStart(2, '0'); }

  function parseIsoFecha(iso) {
    const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return null;
    return { year: +m[1], month: +m[2], day: +m[3] };
  }

  function toIsoFecha(y, m, d) {
    return y + '-' + pad2(m) + '-' + pad2(d);
  }

  function hoyIsoLocal() {
    const n = new Date();
    return toIsoFecha(n.getFullYear(), n.getMonth() + 1, n.getDate());
  }

  function formatFechaUi(iso) {
    const p = parseIsoFecha(iso);
    if (!p) return 'Elegir';
    return p.day + ' ' + MESES_CORTOS[p.month - 1] + ' ' + p.year;
  }

  function fechaInputEl(kind) {
    return document.getElementById(kind === 'entrega' ? 'fechaEntrega' : 'fechaTraslado');
  }

  function fechaLabelEl(kind) {
    return document.getElementById(kind === 'entrega' ? 'greFechaEntregaLabel' : 'greFechaTrasladoLabel');
  }

  function pintarFechasUi() {
    const t = document.getElementById('fechaTraslado')?.value || '';
    const e = document.getElementById('fechaEntrega')?.value || '';
    const tl = fechaLabelEl('traslado');
    const el = fechaLabelEl('entrega');
    if (tl) {
      tl.textContent = formatFechaUi(t);
      tl.classList.toggle('is-empty', !t);
    }
    if (el) {
      el.textContent = formatFechaUi(e);
      el.classList.toggle('is-empty', !e);
    }
  }

  function daysInMonth(year, month) {
    return new Date(year, month, 0).getDate();
  }

  function buildFechaCol(listEl, values, formatter) {
    if (!listEl) return;
    let html = '<li class="ios-date-wheel-spacer" aria-hidden="true"></li><li class="ios-date-wheel-spacer" aria-hidden="true"></li>';
    values.forEach(function (v) {
      html += '<li class="ios-date-wheel-item" data-value="' + v + '">' + (formatter ? formatter(v) : v) + '</li>';
    });
    html += '<li class="ios-date-wheel-spacer" aria-hidden="true"></li><li class="ios-date-wheel-spacer" aria-hidden="true"></li>';
    listEl.innerHTML = html;
  }

  function greFechaCol(name) {
    return document.querySelector('#greFechaWheel .ios-date-wheel-unit[data-col="' + name + '"] .ios-date-wheel-col');
  }

  function snapFechaCol(name, value, instant) {
    const col = greFechaCol(name);
    if (!col) return;
    const item = col.querySelector('.ios-date-wheel-item[data-value="' + value + '"]');
    if (!item) return;
    const top = item.offsetTop - FECHA_ITEM_H * 2;
    if (instant) col.scrollTop = top;
    else col.scrollTo({ top: top, behavior: 'smooth' });
    greFechaWheel[name] = Number(value);
  }

  function readFechaCol(name) {
    const col = greFechaCol(name);
    if (!col) return greFechaWheel[name];
    const idx = Math.round(col.scrollTop / FECHA_ITEM_H);
    const items = col.querySelectorAll('.ios-date-wheel-item');
    const item = items[idx];
    if (!item) return greFechaWheel[name];
    const val = Number(item.getAttribute('data-value'));
    greFechaWheel[name] = val;
    return val;
  }

  function stepFechaCol(name, dir) {
    const col = greFechaCol(name);
    if (!col) return;
    const items = Array.from(col.querySelectorAll('.ios-date-wheel-item'));
    if (!items.length) return;
    const current = Number(greFechaWheel[name]);
    let idx = items.findIndex(function (el) {
      return Number(el.getAttribute('data-value')) === current;
    });
    if (idx < 0) idx = 0;
    const next = Math.max(0, Math.min(items.length - 1, idx + dir));
    const val = Number(items[next].getAttribute('data-value'));
    snapFechaCol(name, val, false);
    if (name === 'month' || name === 'year') rebuildFechaDays();
    else greFechaWheel.day = val;
  }

  function rebuildFechaDays() {
    const max = daysInMonth(greFechaWheel.year, greFechaWheel.month);
    if (greFechaWheel.day > max) greFechaWheel.day = max;
    const days = [];
    for (let d = 1; d <= max; d++) days.push(d);
    buildFechaCol(document.getElementById('greFechaWheelDay'), days, pad2);
    snapFechaCol('day', greFechaWheel.day, true);
  }

  function rebuildFechaWheel() {
    const months = [];
    for (let m = 1; m <= 12; m++) months.push(m);
    buildFechaCol(document.getElementById('greFechaWheelMonth'), months, function (v) {
      return MESES_CORTOS[v - 1];
    });
    const yNow = new Date().getFullYear();
    const years = [];
    for (let y = yNow - 1; y <= yNow + 2; y++) years.push(y);
    buildFechaCol(document.getElementById('greFechaWheelYear'), years);
    rebuildFechaDays();
    snapFechaCol('month', greFechaWheel.month, true);
    snapFechaCol('year', greFechaWheel.year, true);
  }

  function bindFechaWheelScroll() {
    if (greFechaBuilt) return;
    greFechaBuilt = true;
    ['day', 'month', 'year'].forEach(function (name) {
      const unit = document.querySelector('#greFechaWheel .ios-date-wheel-unit[data-col="' + name + '"]');
      const col = greFechaCol(name);
      if (!col) return;
      let timer = null;
      let wheelLock = false;
      col.addEventListener('scroll', function () {
        if (timer) clearTimeout(timer);
        timer = setTimeout(function () {
          const val = readFechaCol(name);
          const top = Math.round(col.scrollTop / FECHA_ITEM_H) * FECHA_ITEM_H;
          if (Math.abs(col.scrollTop - top) > 1) {
            col.scrollTo({ top: top, behavior: 'smooth' });
          }
          if (name === 'month' || name === 'year') rebuildFechaDays();
          else greFechaWheel.day = val;
        }, 80);
      }, { passive: true });
      function onWheel(ev) {
        ev.preventDefault();
        ev.stopPropagation();
        if (wheelLock) return;
        wheelLock = true;
        stepFechaCol(name, ev.deltaY > 0 ? 1 : -1);
        setTimeout(function () { wheelLock = false; }, 60);
      }
      col.addEventListener('wheel', onWheel, { passive: false });
      if (unit) unit.addEventListener('wheel', onWheel, { passive: false });
    });
    document.querySelectorAll('#greFechaWheel .ios-date-wheel-step').forEach(function (btn) {
      btn.addEventListener('click', function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        const unit = btn.closest('.ios-date-wheel-unit');
        const name = unit && unit.getAttribute('data-col');
        const dir = Number(btn.getAttribute('data-dir') || 0);
        if (name && dir) stepFechaCol(name, dir);
      });
    });
  }

  function abrirGreFecha(kind) {
    if (!greFechaSheet) return;
    greFechaTarget = kind === 'entrega' ? 'entrega' : 'traslado';
    const input = fechaInputEl(greFechaTarget);
    const parsed = parseIsoFecha(input && input.value) || parseIsoFecha(hoyIsoLocal());
    greFechaWheel = { day: parsed.day, month: parsed.month, year: parsed.year };
    if (greFechaTitulo) {
      greFechaTitulo.textContent = greFechaTarget === 'entrega'
        ? 'Entrega transportista'
        : 'Inicio traslado';
    }
    if (greFechaHint) {
      greFechaHint.textContent = greFechaTarget === 'entrega'
        ? 'Fecha de entrega al transportista'
        : 'Fecha de inicio del traslado';
    }
    bindFechaWheelScroll();
    greFechaSheet.hidden = false;
    greFechaSheet.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    rebuildFechaWheel();
    requestAnimationFrame(function () {
      snapFechaCol('day', greFechaWheel.day, true);
      snapFechaCol('month', greFechaWheel.month, true);
      snapFechaCol('year', greFechaWheel.year, true);
    });
  }

  function cerrarGreFecha() {
    if (!greFechaSheet) return;
    greFechaSheet.hidden = true;
    greFechaSheet.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  }

  function confirmarGreFecha() {
    readFechaCol('day');
    readFechaCol('month');
    readFechaCol('year');
    const max = daysInMonth(greFechaWheel.year, greFechaWheel.month);
    if (greFechaWheel.day > max) greFechaWheel.day = max;
    const iso = toIsoFecha(greFechaWheel.year, greFechaWheel.month, greFechaWheel.day);
    const input = fechaInputEl(greFechaTarget);
    if (input) input.value = iso;
    pintarFechasUi();
    cerrarGreFecha();
  }

  document.getElementById('greFechaTrasladoBtn')?.addEventListener('click', function () {
    abrirGreFecha('traslado');
  });
  document.getElementById('fechaEntregaWrap')?.addEventListener('click', function () {
    abrirGreFecha('entrega');
  });
  document.getElementById('greFechaCancelar')?.addEventListener('click', cerrarGreFecha);
  document.getElementById('greFechaListo')?.addEventListener('click', confirmarGreFecha);
  greFechaSheet?.addEventListener('click', function (e) {
    if (e.target === greFechaSheet) cerrarGreFecha();
  });
  pintarFechasUi();

  function parseJson(id) {
    try {
      return JSON.parse(document.getElementById(id)?.textContent || 'null');
    } catch (_e) {
      return null;
    }
  }

  const docsApi = form.dataset.docsApi || '';
  const facturaPicker = document.getElementById('greFacturaPicker');
  const facturaLista = document.getElementById('greFacturaPickerLista');
  const facturaStatus = document.getElementById('greFacturaPickerStatus');
  const facturaBusqueda = document.getElementById('greFacturaPickerBusqueda');
  const facturaMas = document.getElementById('greFacturaPickerMas');
  const facturaAbrir = document.getElementById('greFacturaAbrir');
  const facturaBtnTitulo = document.getElementById('greFacturaBtnTitulo');
  const facturaBtnDetalle = document.getElementById('greFacturaBtnDetalle');
  const facturaPickerTitulo = document.getElementById('greFacturaPickerTitulo');
  const facturaSelWrap = document.getElementById('greFacturasSel');
  const facturaHidden = document.getElementById('greFacturasHidden');
  const docFuenteTabs = document.getElementById('greDocFuenteTabs');
  const inicialDocsVentas = parseJson('gre-docs-facturas-data') || {};
  const inicialDocsCompras = parseJson('gre-docs-compras-data') || {};
  const inicialIds = parseJson('gre-facturas-sel-data') || [];
  const inicialCompraIds = parseJson('gre-compras-sel-data') || [];
  let docFuente = 'ventas';
  let docFuentePreferidaMixto = 'ventas';
  let docCache = {
    ventas: {
      items: Array.isArray(inicialDocsVentas.items) ? inicialDocsVentas.items.slice() : [],
      total: Number(inicialDocsVentas.total) || 0,
      next_offset: Number(inicialDocsVentas.next_offset) || (inicialDocsVentas.items || []).length,
      has_more: inicialDocsVentas.has_more === true,
      query: '',
      cliente_doc: String(inicialDocsVentas.cliente_doc || ''),
    },
    compras: {
      items: Array.isArray(inicialDocsCompras.items) ? inicialDocsCompras.items.slice() : [],
      total: Number(inicialDocsCompras.total) || 0,
      next_offset: Number(inicialDocsCompras.next_offset) || (inicialDocsCompras.items || []).length,
      has_more: inicialDocsCompras.has_more === true,
      query: '',
      cliente_doc: '',
    },
  };
  let docItems = docCache.ventas.items.slice();
  let docTotal = docCache.ventas.total;
  let docNextOffset = docCache.ventas.next_offset;
  let docHasMore = docCache.ventas.has_more;
  let docQuery = '';
  let docCargando = false;
  let docTimer = null;
  let docClienteCargado = docCache.ventas.cliente_doc;
  const facturasSel = new Map();
  const movimientosSel = new Map();
  let movItems = [];
  let movTotal = 0;
  let movNextOffset = 0;
  let movHasMore = false;
  let movQuery = '';
  let movCargando = false;
  let movTimer = null;
  const movimientosApi = form.dataset.movimientosApi || '';
  const movPicker = document.getElementById('greMovPicker');
  const movLista = document.getElementById('greMovPickerLista');
  const movStatus = document.getElementById('greMovPickerStatus');
  const movBusqueda = document.getElementById('greMovPickerBusqueda');
  const movMas = document.getElementById('greMovPickerMas');
  const movAbrir = document.getElementById('greMovAbrir');
  const movBtnTitulo = document.getElementById('greMovBtnTitulo');
  const movBtnDetalle = document.getElementById('greMovBtnDetalle');
  const movSelWrap = document.getElementById('greMovSel');
  const movHidden = document.getElementById('greMovHidden');
  const lineasHidden = document.getElementById('greLineasHidden');
  const movPickerCerrar = document.getElementById('greMovPickerCerrar');

  function docsMode() {
    return motivoRadio()?.dataset.docs || 'facturas';
  }

  function syncDocFuenteTabs() {
    const mode = docsMode();
    if (!docFuenteTabs) return;
    const show = mode === 'mixto';
    docFuenteTabs.hidden = !show;
    docFuenteTabs.querySelectorAll('[data-fuente]').forEach(function (btn) {
      const on = btn.getAttribute('data-fuente') === docFuente;
      btn.classList.toggle('is-on', on);
      btn.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    if (facturaPickerTitulo) {
      if (mode === 'compras' || docFuente === 'compras') {
        facturaPickerTitulo.textContent = 'Compras recibidas';
      } else if (mode === 'mixto') {
        facturaPickerTitulo.textContent = docFuente === 'compras'
          ? 'Compras recibidas'
          : 'Facturas emitidas';
      } else {
        facturaPickerTitulo.textContent = 'Facturas emitidas';
      }
    }
    if (facturaBusqueda) {
      facturaBusqueda.placeholder = docFuente === 'compras'
        ? 'Serie, número o proveedor…'
        : 'Serie, número o cliente…';
    }
  }

  function aplicarCacheFuente() {
    const cache = docCache[docFuente] || docCache.ventas;
    docItems = cache.items.slice();
    docTotal = cache.total;
    docNextOffset = cache.next_offset;
    docHasMore = cache.has_more;
    docQuery = cache.query || '';
    docClienteCargado = cache.cliente_doc || '';
  }

  function guardarCacheFuente() {
    docCache[docFuente] = {
      items: docItems.slice(),
      total: docTotal,
      next_offset: docNextOffset,
      has_more: docHasMore,
      query: docQuery,
      cliente_doc: docClienteCargado,
    };
  }

  function esEntregaTerceros() {
    return (motivoRadio()?.value || '') === '03';
  }

  function clienteFiltro() {
    if (docFuente === 'compras') return '';
    if (esEntregaTerceros()) return '';
    const doc = document.getElementById('receptorDoc');
    const n = doc ? String(doc.value || '').replace(/\D/g, '') : '';
    return n.length >= 8 ? n : '';
  }

  function facturaConCliente() {
    let first = null;
    facturasSel.forEach(function (d) {
      if (!first && d && !d.manual && d.origen !== 'compra' && (d.cliente_doc || d.cliente)) first = d;
    });
    if (first) return first;
    facturasSel.forEach(function (d) {
      if (!first && d && !d.manual && (d.cliente_doc || d.cliente)) first = d;
    });
    return first;
  }

  function etiquetaTipoDoc(tipo) {
    if (tipo === '1') return 'DNI';
    if (tipo === '4') return 'CE';
    return 'RUC';
  }

  let destTercerosElegido = false;
  let motivoPrev = (motivoRadio()?.value || '');

  function forzarPickerDestinatarioTerceros() {
    if (!esEntregaTerceros() || destTercerosElegido) return;
    aplicarDestinatario('6', '', '', false);
    syncDestBoton();
    const wrap = document.getElementById('destinatarioTerceros');
    if (wrap) wrap.hidden = false;
    const btnCambiar = document.getElementById('greDestCambiar');
    if (btnCambiar) btnCambiar.hidden = true;
    abrirDestPicker();
  }

  function pintarDestVista(nombre, numero, tipoDoc) {
    const vista = document.getElementById('destinatarioVista');
    const vistaNom = document.getElementById('destVistaNombre');
    const vistaDoc = document.getElementById('destVistaDoc');
    if (vistaNom) vistaNom.textContent = nombre || '—';
    if (vistaDoc) {
      vistaDoc.textContent = numero
        ? (etiquetaTipoDoc(tipoDoc) + ' ' + numero)
        : '';
    }
    if (vista) vista.hidden = !(nombre || numero);
  }

  function syncDestBoton() {
    const nom = document.getElementById('receptorNombre')?.value || '';
    const doc = document.getElementById('receptorDoc')?.value || '';
    const titulo = document.getElementById('greDestBtnTitulo');
    const detalle = document.getElementById('greDestBtnDetalle');
    if (titulo) titulo.textContent = nom || 'Elegir destinatario';
    if (detalle) {
      detalle.textContent = doc
        ? (etiquetaTipoDoc(document.getElementById('receptorTipo')?.value) + ' ' + doc)
        : 'Lista de clientes registrados';
    }
  }

  function aplicarDestinatario(tipoDoc, numero, nombre, desdeLista) {
    const tipo = document.getElementById('receptorTipo');
    const doc = document.getElementById('receptorDoc');
    const nom = document.getElementById('receptorNombre');
    if (tipo) tipo.value = tipoDoc || '6';
    if (doc) doc.value = numero || '';
    if (nom) nom.value = nombre || '';
    const tipoM = document.getElementById('receptorTipoManual');
    const docM = document.getElementById('receptorDocManual');
    const nomM = document.getElementById('receptorNombreManual');
    if (tipoM) tipoM.value = tipoDoc || '6';
    if (docM) docM.value = numero || '';
    if (nomM) nomM.value = nombre || '';
    if (desdeLista) destTercerosElegido = true;
    pintarDestVista(nombre, numero, tipoDoc || '6');
    syncDestBoton();
  }

  function docCompradorFactura() {
    const fac = facturaConCliente();
    if (!fac) return '';
    return String(fac.cliente_doc || '').replace(/\D/g, '');
  }

  function syncDestinatarioUi() {
    const m = motivoRadio();
    const fijo = m?.dataset.fijo === '1';
    const terceros = esEntregaTerceros();
    const tipo = document.getElementById('receptorTipo');
    const doc = document.getElementById('receptorDoc');
    const nom = document.getElementById('receptorNombre');
    const hint = document.getElementById('destinatarioHint');
    const manual = document.getElementById('destinatarioManual');
    const tercerosWrap = document.getElementById('destinatarioTerceros');
    const btnCambiar = document.getElementById('greDestCambiar');

    if (tercerosWrap) tercerosWrap.hidden = !terceros || destTercerosElegido;
    if (btnCambiar) btnCambiar.hidden = !(terceros && destTercerosElegido);

    if (!terceros) destTercerosElegido = false;

    if (fijo) {
      aplicarDestinatario('6', companyRuc, companyNombre || companyRuc, false);
      if (hint) {
        // Motivo 04 (misma empresa): no mostrar el texto de RUC; se fija en silencio.
        const cod = String(m?.value || '').trim();
        if (cod === '04') {
          hint.textContent = '';
          hint.hidden = true;
        } else {
          hint.hidden = false;
          hint.textContent = 'Destinatario = tu RUC (regla SUNAT).';
        }
      }
      if (manual) manual.hidden = true;
      return;
    }

    if (hint) hint.hidden = false;

    if (terceros) {
      if (hint) {
        hint.textContent = 'Venta con entrega a terceros: debes elegir un destinatario distinto al comprador.';
      }
      if (manual) manual.hidden = true;
      // Nunca prellenar con el comprador.
      if (!destTercerosElegido) {
        aplicarDestinatario('6', '', '', false);
      } else {
        const buyer = docCompradorFactura();
        const chosen = String((doc && doc.value) || '').replace(/\D/g, '');
        if (buyer && chosen && buyer === chosen) {
          destTercerosElegido = false;
          aplicarDestinatario('6', '', '', false);
        } else {
          aplicarDestinatario(
            (tipo && tipo.value) || '6',
            (doc && doc.value) || '',
            (nom && nom.value) || '',
            true,
          );
        }
      }
      if (tercerosWrap) tercerosWrap.hidden = destTercerosElegido;
      if (btnCambiar) btnCambiar.hidden = !destTercerosElegido;
      return;
    }

    const fac = facturaConCliente();
    if (fac) {
      aplicarDestinatario(
        fac.cliente_tipo_doc || '6',
        fac.cliente_doc || '',
        fac.cliente_razon_social || fac.cliente || '',
        false,
      );
      if (hint) hint.textContent = 'Cliente a quien se emitió ' + (fac.ref || 'la factura') + '.';
      if (manual) manual.hidden = true;
      return;
    }

    const soloManual = facturasSel.size > 0;
    if (!soloManual) aplicarDestinatario('6', '', '', false);
    if (hint) {
      hint.textContent = soloManual
        ? 'Documento manual: indica a quién se entrega.'
        : 'Se toma del cliente de la factura emitida vinculada.';
    }
    if (manual) manual.hidden = !soloManual;
    if (soloManual) {
      aplicarDestinatario(
        (tipo && tipo.value) || '6',
        (doc && doc.value) || '',
        (nom && nom.value) || '',
        false,
      );
    }
  }

  function pintarFacturasSel() {
    if (!facturaSelWrap || !facturaHidden) return;
    facturaSelWrap.innerHTML = '';
    facturaHidden.innerHTML = '';
    const n = facturasSel.size;
    const mode = docsMode();
    let nVentas = 0;
    let nCompras = 0;
    facturasSel.forEach(function (d) {
      if (d && d.origen === 'compra') nCompras += 1;
      else if (d && !d.manual) nVentas += 1;
    });
    if (facturaBtnTitulo) {
      if (!n) {
        facturaBtnTitulo.textContent = mode === 'compras'
          ? 'Seleccionar compras'
          : (mode === 'mixto' ? 'Seleccionar documentos' : 'Seleccionar facturas');
      } else {
        facturaBtnTitulo.textContent = n === 1
          ? '1 documento seleccionado'
          : n + ' documentos seleccionados';
      }
    }
    if (facturaBtnDetalle) {
      if (!n) {
        facturaBtnDetalle.textContent = mode === 'compras'
          ? 'Compras recibidas · puedes marcar varias'
          : (mode === 'mixto'
            ? 'Emitidos y/o recibidos · puedes marcar varias'
            : 'Últimos emitidos · puedes marcar varias');
      } else {
        const parts = [];
        if (nVentas) parts.push(nVentas + (nVentas === 1 ? ' emitido' : ' emitidos'));
        if (nCompras) parts.push(nCompras + (nCompras === 1 ? ' recibido' : ' recibidos'));
        facturaBtnDetalle.textContent = (parts.join(' · ') || 'Manual') + ' · toca para agregar o quitar';
      }
    }
    facturasSel.forEach(function (d) {
      const card = document.createElement('div');
      card.className = 'ios-selected-card';
      card.innerHTML =
        '<div class="ios-selected-card-text">' +
          '<strong></strong><span></span>' +
        '</div>' +
        '<button type="button" aria-label="Quitar">×</button>';
      const badge = d.origen === 'compra' ? 'Recibido' : (d.manual ? 'Manual' : 'Emitido');
      card.querySelector('strong').textContent = [d.ref, d.tipo_label || badge].filter(Boolean).join(' · ');
      card.querySelector('span').textContent = [d.cliente, d.fecha, badge].filter(Boolean).join(' · ');
      card.querySelector('button').addEventListener('click', function () {
        facturasSel.delete(d.id);
        pintarFacturasSel();
        pintarFacturaPicker();
      });
      facturaSelWrap.appendChild(card);

      if (d.manual) {
        [
          ['rel_tipo', d.tipo_doc || '01'],
          ['rel_serie', d.serie || ''],
          ['rel_numero', d.correlativo || ''],
          ['rel_emisor', d.emisor || companyRuc],
        ].forEach(function (par) {
          const input = document.createElement('input');
          input.type = 'hidden';
          input.name = par[0];
          input.value = par[1];
          facturaHidden.appendChild(input);
        });
      } else {
        const input = document.createElement('input');
        input.type = 'hidden';
        input.name = d.origen === 'compra' ? 'compra_ids' : 'factura_ids';
        input.value = d.id;
        facturaHidden.appendChild(input);
      }
    });
    syncDestinatarioUi();
    syncBienesUi();
    if (esEntregaTerceros() && !destTercerosElegido && facturasSel.size > 0) {
      setTimeout(forzarPickerDestinatarioTerceros, 180);
    }
  }

  function tieneFacturaInterna() {
    let ok = false;
    facturasSel.forEach(function (d) {
      if (d && d.id && !d.manual) ok = true;
    });
    return ok;
  }

  function etiquetaUnidad(cod) {
    const c = String(cod || 'NIU').trim().toUpperCase();
    if (c === 'NIU' || c === 'UND') return 'und';
    if (c === 'KGM') return 'kg';
    if (c === 'LTR' || c === 'LT') return 'lt';
    return c.toLowerCase();
  }

  function syncBienesUi() {
    const blockBienes = document.getElementById('blockBienesDoc');
    const internas = tieneFacturaInterna();
    if (blockBienes) blockBienes.hidden = !internas;
    if (internas) cargarBienesFacturas();
    else {
      const lista = document.getElementById('greBienesLista');
      const status = document.getElementById('greBienesStatus');
      if (lista) lista.innerHTML = '';
      if (status) status.textContent = 'Ítems de los documentos vinculados.';
    }
  }

  function pintarBienes(lineas) {
    const lista = document.getElementById('greBienesLista');
    const status = document.getElementById('greBienesStatus');
    if (!lista) return;
    lista.innerHTML = '';
    if (!lineas.length) {
      if (status) status.textContent = 'Estos documentos no tienen ítems para mostrar.';
      return;
    }
    if (status) status.textContent = lineas.length + ' ítem(s) de los documentos vinculados.';
    lineas.forEach(function (ln) {
      const row = document.createElement('div');
      row.className = 'ios-nc-item';
      const main = document.createElement('div');
      main.className = 'ios-nc-item-main';
      const titulo = document.createElement('strong');
      titulo.textContent = ln.descripcion || 'Ítem';
      const meta = document.createElement('small');
      meta.textContent = [ln.cantidad + ' ' + etiquetaUnidad(ln.unidad), ln.ref || ''].filter(Boolean).join(' · ');
      main.appendChild(titulo);
      main.appendChild(meta);
      if (ln.numero_serie) {
        const serie = document.createElement('small');
        serie.className = 'ios-orden-linea-serie';
        serie.textContent = 'Serie: ' + ln.numero_serie;
        main.appendChild(serie);
      }
      row.appendChild(main);
      lista.appendChild(row);
    });
  }

  function cargarBienesFacturas() {
    const lineasApi = form.dataset.docLineasApi || '';
    const ids = [];
    facturasSel.forEach(function (d) {
      if (d && d.id && !d.manual) ids.push(d.id);
    });
    const status = document.getElementById('greBienesStatus');
    if (!ids.length) {
      pintarBienes([]);
      return;
    }
    if (status) status.textContent = 'Cargando ítems…';
    Promise.all(ids.map(function (id) {
      return fetch(lineasApi + '/' + encodeURIComponent(id) + '/lineas', {
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
      }).then(function (res) { return res.json(); }).then(function (data) {
        const ref = data.ref || '';
        return (Array.isArray(data.lineas) ? data.lineas : []).map(function (ln) {
          return {
            descripcion: ln.descripcion || 'Ítem',
            cantidad: ln.cantidad || 1,
            unidad: ln.unidad || 'NIU',
            ref: ref,
            numero_serie: ln.numero_serie || ln.numeroSerie || '',
          };
        });
      }).catch(function () { return []; });
    })).then(function (grupos) {
      pintarBienes(grupos.reduce(function (acc, arr) { return acc.concat(arr); }, []));
    });
  }

  function clearMovimientosSel() {
    movimientosSel.clear();
    syncMovimientosUi();
  }

  function syncMovimientosUi() {
    const blockBienesMov = document.getElementById('blockBienesMov');
    const n = movimientosSel.size;
    if (movBtnTitulo) {
      movBtnTitulo.textContent = n
        ? (n === 1 ? '1 movimiento seleccionado' : n + ' movimientos seleccionados')
        : 'Seleccionar movimientos';
    }
    if (movBtnDetalle) {
      movBtnDetalle.textContent = n
        ? 'Toca para cambiar'
        : 'Traslados sin guía · puedes marcar varios';
    }
    if (movSelWrap) {
      movSelWrap.innerHTML = '';
      movimientosSel.forEach(function (m) {
        const chip = document.createElement('div');
        chip.className = 'ios-selected-card';
        chip.innerHTML =
          '<div class="ios-selected-card-text">' +
            '<strong>' + (m.numero || 'Traslado') + '</strong>' +
            '<span>' +
              [(m.almacen_nombre || 'Origen'), (m.almacen_destino_nombre || 'Destino')].join(' → ') +
            '</span>' +
          '</div>' +
          '<button type="button" data-mov-quitar="' + m.id + '" aria-label="Quitar">×</button>';
        movSelWrap.appendChild(chip);
      });
      movSelWrap.querySelectorAll('[data-mov-quitar]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          movimientosSel.delete(btn.getAttribute('data-mov-quitar'));
          syncMovimientosUi();
        });
      });
    }
    if (movHidden) {
      movHidden.innerHTML = '';
      movimientosSel.forEach(function (m) {
        const input = document.createElement('input');
        input.type = 'hidden';
        input.name = 'movimiento_ids';
        input.value = m.id;
        movHidden.appendChild(input);
      });
    }
    if (blockBienesMov) blockBienesMov.hidden = n === 0;
    if (n) cargarBienesMovimientos();
    else {
      if (lineasHidden) lineasHidden.innerHTML = '';
      const lista = document.getElementById('greBienesMovLista');
      const status = document.getElementById('greBienesMovStatus');
      if (lista) lista.innerHTML = '';
      if (status) status.textContent = 'Ítems de los movimientos seleccionados.';
    }
  }

  function pintarBienesMov(lineas) {
    const lista = document.getElementById('greBienesMovLista');
    const status = document.getElementById('greBienesMovStatus');
    if (!lista) return;
    lista.innerHTML = '';
    if (!lineas.length) {
      if (status) status.textContent = 'Estos movimientos no tienen ítems.';
      if (lineasHidden) lineasHidden.innerHTML = '';
      return;
    }
    if (status) status.textContent = lineas.length + ' ítem(s) de los traslados.';
    if (lineasHidden) lineasHidden.innerHTML = '';
    lineas.forEach(function (ln) {
      const row = document.createElement('div');
      row.className = 'ios-nc-item';
      const main = document.createElement('div');
      main.className = 'ios-nc-item-main';
      const titulo = document.createElement('strong');
      titulo.textContent = ln.descripcion || 'Ítem';
      const meta = document.createElement('small');
      meta.textContent = [ln.cantidad + ' ' + etiquetaUnidad(ln.unidad), ln.ref || ''].filter(Boolean).join(' · ');
      main.appendChild(titulo);
      main.appendChild(meta);
      if (ln.numero_serie) {
        const serie = document.createElement('small');
        serie.className = 'ios-orden-linea-serie';
        serie.textContent = 'Serie: ' + ln.numero_serie;
        main.appendChild(serie);
      }
      row.appendChild(main);
      lista.appendChild(row);

      if (lineasHidden) {
        function addH(name, value) {
          const input = document.createElement('input');
          input.type = 'hidden';
          input.name = name;
          input.value = value == null ? '' : String(value);
          lineasHidden.appendChild(input);
        }
        addH('linea_descripcion', ln.descripcion || 'Ítem');
        addH('linea_cantidad', ln.cantidad || 1);
        addH('linea_unidad', ln.unidad || 'NIU');
        addH('linea_precio', ln.precio_unitario != null ? ln.precio_unitario : 0);
        addH('linea_catalog_item_id', ln.catalog_item_id || '');
        addH('linea_almacen_id', ln.almacen_id || '');
        addH('linea_producto_serie_id', ln.producto_serie_id || '');
        addH('linea_numero_serie', ln.numero_serie || '');
      }
    });
  }

  function cargarBienesMovimientos() {
    const ids = Array.from(movimientosSel.keys());
    const status = document.getElementById('greBienesMovStatus');
    if (!ids.length) {
      pintarBienesMov([]);
      return;
    }
    if (status) status.textContent = 'Cargando ítems…';

    const fromCache = [];
    const needFetch = [];
    ids.forEach(function (id) {
      const m = movimientosSel.get(id);
      if (m && Array.isArray(m.lineas) && m.lineas.length) {
        m.lineas.forEach(function (ln) {
          fromCache.push({
            descripcion: ln.descripcion || 'Ítem',
            cantidad: ln.cantidad || 1,
            unidad: ln.unidad || 'NIU',
            catalog_item_id: ln.catalog_item_id || '',
            almacen_id: ln.almacen_id || '',
            producto_serie_id: ln.producto_serie_id || '',
            numero_serie: ln.numero_serie || '',
            precio_unitario: 0,
            ref: m.numero || 'Traslado',
          });
        });
      } else {
        needFetch.push(id);
      }
    });

    if (!needFetch.length) {
      pintarBienesMov(fromCache);
      return;
    }

    Promise.all(needFetch.map(function (id) {
      return fetch(movimientosApi + '/' + encodeURIComponent(id), {
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
      }).then(function (res) {
        return res.json().then(function (data) {
          if (!res.ok) throw new Error(data.message || 'Error al cargar movimiento');
          return data;
        });
      }).then(function (data) {
        const mov = data.movimiento || {};
        const ref = mov.numero || data.ref || '';
        const lineas = Array.isArray(data.lineas) ? data.lineas : [];
        const cached = movimientosSel.get(id);
        if (cached) cached.lineas = lineas;
        return lineas.map(function (ln) {
          return {
            descripcion: ln.descripcion || 'Ítem',
            cantidad: ln.cantidad || 1,
            unidad: ln.unidad || 'NIU',
            catalog_item_id: ln.catalog_item_id || '',
            almacen_id: ln.almacen_id || '',
            producto_serie_id: ln.producto_serie_id || '',
            numero_serie: ln.numero_serie || '',
            precio_unitario: 0,
            ref: ref,
          };
        });
      }).catch(function (err) {
        if (status) status.textContent = err.message || 'No se pudieron cargar los ítems';
        return [];
      });
    })).then(function (grupos) {
      const fetched = grupos.reduce(function (acc, arr) { return acc.concat(arr); }, []);
      pintarBienesMov(fromCache.concat(fetched));
    });
  }

  function pintarMovPicker() {
    if (!movLista) return;
    movLista.innerHTML = '';
    if (!movItems.length) {
      if (movStatus) movStatus.textContent = movCargando ? 'Buscando…' : 'Sin traslados pendientes de guía';
      if (movMas) movMas.hidden = true;
      return;
    }
    if (movStatus) {
      movStatus.textContent = movItems.length + ' de ' + movTotal + ' traslado(s) · toca para marcar';
    }
    movItems.forEach(function (m) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ios-sheet-item' + (movimientosSel.has(m.id) ? ' is-selected' : '');
      const ruta = [(m.almacen_nombre || 'Origen'), (m.almacen_destino_nombre || 'Destino')].join(' → ');
      btn.innerHTML = '<strong>' + (m.numero || 'Traslado') + '</strong><span>' +
        [m.fecha || '', ruta, (m.lineas_count || 0) + ' ítem(s)'].filter(Boolean).join(' · ') +
        '</span>';
      btn.addEventListener('click', function () {
        if (movimientosSel.has(m.id)) movimientosSel.delete(m.id);
        else movimientosSel.set(m.id, m);
        pintarMovPicker();
        syncMovimientosUi();
      });
      movLista.appendChild(btn);
    });
    if (movMas) movMas.hidden = !movHasMore;
  }

  function cargarMovimientos(reset) {
    if (!movimientosApi) return;
    if (movCargando) return;
    if (reset) {
      movItems = [];
      movNextOffset = 0;
      movHasMore = false;
      movTotal = 0;
    }
    movCargando = true;
    if (movStatus) movStatus.textContent = 'Buscando…';
    const url = movimientosApi
      + '?offset=' + encodeURIComponent(movNextOffset)
      + '&limit=10'
      + (movQuery ? '&q=' + encodeURIComponent(movQuery) : '');
    fetch(url, { credentials: 'same-origin', headers: { Accept: 'application/json' } })
      .then(function (res) { return res.json(); })
      .then(function (data) {
        const items = Array.isArray(data.items) ? data.items : [];
        movItems = reset ? items : movItems.concat(items);
        movTotal = data.total != null ? data.total : movItems.length;
        movNextOffset = data.next_offset != null ? data.next_offset : movItems.length;
        movHasMore = !!data.has_more;
        pintarMovPicker();
      })
      .catch(function () {
        if (movStatus) movStatus.textContent = 'No se pudieron cargar los movimientos';
      })
      .finally(function () {
        movCargando = false;
      });
  }

  function abrirMovPicker() {
    if (!movPicker) return;
    movPicker.hidden = false;
    movPicker.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    document.body.classList.add('ios-sheet-open');
    if (movBusqueda) movBusqueda.value = movQuery || '';
    cargarMovimientos(true);
    movBusqueda && movBusqueda.focus();
  }

  function cerrarMovPicker() {
    if (!movPicker) return;
    movPicker.hidden = true;
    movPicker.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
    document.body.classList.remove('ios-sheet-open');
  }

  movAbrir && movAbrir.addEventListener('click', abrirMovPicker);
  movPickerCerrar && movPickerCerrar.addEventListener('click', cerrarMovPicker);
  movPicker && movPicker.addEventListener('click', function (e) {
    if (e.target === movPicker) cerrarMovPicker();
  });
  movBusqueda && movBusqueda.addEventListener('input', function () {
    clearTimeout(movTimer);
    movTimer = setTimeout(function () {
      movQuery = movBusqueda.value || '';
      cargarMovimientos(true);
    }, 280);
  });
  movMas && movMas.addEventListener('click', function () {
    if (movHasMore && !movCargando) cargarMovimientos(false);
  });

  function pintarFacturaPicker() {
    if (!facturaLista) return;
    facturaLista.innerHTML = '';
    const filtro = clienteFiltro();
    const alcance = filtro
      ? (document.getElementById('receptorNombre')?.value || filtro)
      : '';
    const vacioMsg = docFuente === 'compras'
      ? 'Sin compras recibidas'
      : (filtro ? 'Sin documentos emitidos a ' + alcance : 'Sin documentos emitidos');
    if (!docItems.length) {
      if (facturaStatus) {
        facturaStatus.textContent = docCargando ? 'Buscando…' : vacioMsg;
      }
      if (facturaMas) facturaMas.hidden = true;
      return;
    }
    if (facturaStatus) {
      facturaStatus.textContent = docItems.length + ' de ' + docTotal + ' documento(s)'
        + (filtro && docFuente === 'ventas' ? ' de ' + alcance : '')
        + ' · toca para marcar varios';
    }
    docItems.forEach(function (d) {
      const item = Object.assign({}, d, {
        origen: d.origen || (docFuente === 'compras' ? 'compra' : 'venta'),
      });
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ios-sheet-item' + (facturasSel.has(item.id) ? ' is-selected' : '');
      btn.innerHTML =
        '<strong>' + (item.ref || '') + ' · ' + (item.tipo_label || '') + '</strong>' +
        '<span>' + (item.cliente || '') + '</span>' +
        '<span>' + (item.fecha || '') + ' · ' + (item.total || '') + '</span>';
      btn.addEventListener('click', function () {
        if (facturasSel.has(item.id)) facturasSel.delete(item.id);
        else facturasSel.set(item.id, item);
        pintarFacturasSel();
        pintarFacturaPicker();
      });
      facturaLista.appendChild(btn);
    });
    if (facturaMas) {
      facturaMas.hidden = !docHasMore;
      facturaMas.disabled = docCargando;
      facturaMas.textContent = docCargando ? 'Cargando…' : 'Ver más';
    }
  }

  function cargarFacturas(reset) {
    if (!docsApi || docCargando) return;
    docCargando = true;
    if (reset) {
      docItems = [];
      docNextOffset = 0;
      docHasMore = false;
    }
    pintarFacturaPicker();
    const filtro = clienteFiltro();
    docClienteCargado = filtro;
    const url = docsApi
      + '?offset=' + encodeURIComponent(docNextOffset)
      + '&limit=10'
      + '&q=' + encodeURIComponent(docQuery)
      + '&tipo=GUIA_EMISION'
      + '&fuente=' + encodeURIComponent(docFuente)
      + (filtro && docFuente === 'ventas' ? '&cliente_doc=' + encodeURIComponent(filtro) : '');
    fetch(url, { credentials: 'same-origin', headers: { Accept: 'application/json' } })
      .then(function (res) { return res.json(); })
      .then(function (data) {
        const nuevos = Array.isArray(data.items) ? data.items : [];
        docItems = docItems.concat(nuevos);
        docTotal = Number(data.total) || docItems.length;
        docNextOffset = Number(data.next_offset) || docItems.length;
        docHasMore = data.has_more === true;
        guardarCacheFuente();
      })
      .catch(function () {
        if (facturaStatus) facturaStatus.textContent = 'No se pudo cargar la lista';
      })
      .finally(function () {
        docCargando = false;
        pintarFacturaPicker();
      });
  }

  function abrirFacturaPicker() {
    if (!facturaPicker) return;
    syncDocFuenteTabs();
    aplicarCacheFuente();
    facturaPicker.hidden = false;
    facturaPicker.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    pintarFacturaPicker();
    const needReload = !docItems.length
      || (docFuente === 'ventas' && docClienteCargado !== clienteFiltro());
    if (needReload) cargarFacturas(true);
    if (facturaBusqueda) {
      facturaBusqueda.value = docQuery || '';
      facturaBusqueda.focus();
    }
  }

  function cerrarFacturaPicker() {
    if (!facturaPicker) return;
    facturaPicker.hidden = true;
    facturaPicker.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  }

  function seedSelectedIds(ids, origen, pool) {
    (ids || []).forEach(function (id) {
      const key = String(id || '').trim();
      if (!key) return;
      const found = (pool || []).find(function (d) { return d.id === key; })
        || docCache.ventas.items.find(function (d) { return d.id === key; })
        || docCache.compras.items.find(function (d) { return d.id === key; });
      if (found) {
        facturasSel.set(found.id, Object.assign({}, found, {
          origen: found.origen || origen,
        }));
      } else {
        facturasSel.set(key, {
          id: key,
          origen: origen,
          ref: origen === 'compra' ? 'Compra' : 'Documento',
          cliente: '',
        });
      }
    });
  }

  seedSelectedIds(inicialIds, 'venta', docCache.ventas.items);
  seedSelectedIds(inicialCompraIds, 'compra', docCache.compras.items);
  pintarFacturasSel();

  facturaAbrir && facturaAbrir.addEventListener('click', abrirFacturaPicker);
  document.getElementById('greFacturaPickerCerrar')?.addEventListener('click', cerrarFacturaPicker);
  facturaPicker && facturaPicker.addEventListener('click', function (e) {
    if (e.target === facturaPicker) cerrarFacturaPicker();
  });
  facturaMas && facturaMas.addEventListener('click', function () { cargarFacturas(false); });
  facturaBusqueda && facturaBusqueda.addEventListener('input', function () {
    docQuery = facturaBusqueda.value.trim();
    clearTimeout(docTimer);
    docTimer = setTimeout(function () { cargarFacturas(true); }, 250);
  });
  docFuenteTabs && docFuenteTabs.querySelectorAll('[data-fuente]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      const next = btn.getAttribute('data-fuente') || 'ventas';
      if (next === docFuente) return;
      guardarCacheFuente();
      docFuente = next;
      docFuentePreferidaMixto = next;
      syncDocFuenteTabs();
      aplicarCacheFuente();
      if (!docItems.length) cargarFacturas(true);
      else pintarFacturaPicker();
    });
  });
  const destPicker = document.getElementById('greDestPicker');
  const destPickerLista = document.getElementById('greDestPickerLista');
  const destPickerStatus = document.getElementById('greDestPickerStatus');
  const destPickerBusqueda = document.getElementById('greDestPickerBusqueda');
  const destClientes = parseJson('gre-clientes-data') || [];

  function normTexto(s) {
    return String(s || '').trim().toLowerCase();
  }

  function filtrarDestClientes(q) {
    const nq = normTexto(q);
    const buyer = esEntregaTerceros() ? docCompradorFactura() : '';
    let list = destClientes;
    if (buyer) {
      list = list.filter(function (c) {
        return String(c.numero_doc || '').replace(/\D/g, '') !== buyer;
      });
    }
    if (!nq) return list;
    return list.filter(function (c) {
      return normTexto(c.razon_social).indexOf(nq) >= 0 || normTexto(c.numero_doc).indexOf(nq) >= 0;
    });
  }

  function renderDestClientes(lista) {
    if (!destPickerLista) return;
    destPickerLista.innerHTML = '';
    if (!lista.length) {
      if (destPickerStatus) {
        destPickerStatus.textContent = destClientes.length
          ? (esEntregaTerceros()
            ? 'Sin otros clientes (debe ser distinto al comprador)'
            : 'Sin resultados')
          : 'No hay clientes registrados';
      }
      return;
    }
    if (destPickerStatus) {
      destPickerStatus.textContent = esEntregaTerceros()
        ? (lista.length + ' destinatario(s) distinto(s) al comprador')
        : (lista.length + ' cliente(s)');
    }
    lista.forEach(function (c) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ios-sheet-item';
      btn.innerHTML = '<strong></strong><span></span>';
      btn.querySelector('strong').textContent = c.razon_social || 'Sin nombre';
      btn.querySelector('span').textContent = [etiquetaTipoDoc(c.tipo_doc), c.numero_doc].filter(Boolean).join(' ');
      btn.addEventListener('click', function () {
        if (esEntregaTerceros()) {
          const buyer = docCompradorFactura();
          const chosen = String(c.numero_doc || '').replace(/\D/g, '');
          if (buyer && chosen && buyer === chosen) {
            alert('En entrega a terceros el destinatario debe ser distinto al comprador.');
            return;
          }
        }
        aplicarDestinatario(c.tipo_doc || '6', c.numero_doc || '', c.razon_social || '', true);
        cerrarDestPicker();
      });
      destPickerLista.appendChild(btn);
    });
  }

  function abrirDestPicker() {
    if (!destPicker) return;
    if (destPickerBusqueda) destPickerBusqueda.value = '';
    renderDestClientes(filtrarDestClientes(''));
    destPicker.hidden = false;
    destPicker.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    destPickerBusqueda && destPickerBusqueda.focus();
  }

  function cerrarDestPicker() {
    if (!destPicker) return;
    destPicker.hidden = true;
    destPicker.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  }

  document.getElementById('greDestAbrir')?.addEventListener('click', abrirDestPicker);
  document.getElementById('greDestCambiar')?.addEventListener('click', abrirDestPicker);
  document.getElementById('greDestPickerCerrar')?.addEventListener('click', cerrarDestPicker);
  destPickerBusqueda && destPickerBusqueda.addEventListener('input', function () {
    renderDestClientes(filtrarDestClientes(destPickerBusqueda.value));
  });
  destPicker && destPicker.addEventListener('click', function (e) {
    if (e.target === destPicker) cerrarDestPicker();
  });

  function pintarUbicCard(prefijo) {
    const ubigeo = document.getElementById(prefijo + 'Ubigeo')?.value || '';
    const dir = document.getElementById(prefijo + 'Direccion')?.value || '';
    const btn = document.getElementById(prefijo === 'partida' ? 'grePartidaAbrir' : 'greLlegadaAbrir');
    const btnTitulo = document.getElementById('gre' + (prefijo === 'partida' ? 'Partida' : 'Llegada') + 'BtnTitulo');
    const btnDetalle = document.getElementById('gre' + (prefijo === 'partida' ? 'Partida' : 'Llegada') + 'BtnDetalle');
    const quitar = document.getElementById(prefijo === 'partida' ? 'grePartidaQuitar' : 'greLlegadaQuitar');
    const hay = Boolean(dir || ubigeo);
    if (btn) {
      btn.classList.toggle('is-on', hay);
      btn.classList.toggle('is-empty', !hay);
    }
    if (btnTitulo) {
      btnTitulo.textContent = hay
        ? (dir || 'Ubicación seleccionada')
        : 'Toca para elegir ubicación';
    }
    if (btnDetalle) {
      btnDetalle.textContent = hay
        ? (ubigeo ? ('Ubigeo ' + ubigeo) : 'Toca para cambiar')
        : (prefijo === 'llegada'
          ? 'Obligatorio · recientes o Añadir'
          : 'Partida · recientes o Añadir');
    }
    if (quitar) quitar.hidden = !hay;
  }

  if (window.EasyUbicacion) {
    window.EasyUbicacion.bindPick({
      openBtn: 'grePartidaAbrir',
      clearBtn: 'grePartidaQuitar',
      pickBtn: 'grePartidaAbrir',
      titleEl: 'grePartidaBtnTitulo',
      detailEl: 'grePartidaBtnDetalle',
      title: 'Punto de partida',
      emptyDetail: 'Partida · recientes o Añadir',
      fields: { ubigeo: 'partidaUbigeo', direccion: 'partidaDireccion' },
      onApply: function () { pintarUbicCard('partida'); },
      onClear: function () { pintarUbicCard('partida'); },
    });
    window.EasyUbicacion.bindPick({
      openBtn: 'greLlegadaAbrir',
      clearBtn: 'greLlegadaQuitar',
      pickBtn: 'greLlegadaAbrir',
      titleEl: 'greLlegadaBtnTitulo',
      detailEl: 'greLlegadaBtnDetalle',
      title: 'Punto de llegada',
      emptyDetail: 'Obligatorio · recientes o Añadir',
      fields: { ubigeo: 'llegadaUbigeo', direccion: 'llegadaDireccion' },
      onApply: function () { pintarUbicCard('llegada'); },
      onClear: function () { pintarUbicCard('llegada'); },
    });
  }
  pintarUbicCard('partida');
  pintarUbicCard('llegada');

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    if (greFechaSheet && !greFechaSheet.hidden) cerrarGreFecha();
    else if (catPicker && !catPicker.hidden) cerrarCatPicker();
    else if (document.getElementById('easyUbicPicker') && !document.getElementById('easyUbicPicker').hidden && window.EasyUbicacion) window.EasyUbicacion.close();
    else if (destPicker && !destPicker.hidden) cerrarDestPicker();
    else if (manualPicker && !manualPicker.hidden) cerrarManualPicker();
    else if (facturaPicker && !facturaPicker.hidden) cerrarFacturaPicker();
  });

  const manualPicker = document.getElementById('greDocManualPicker');
  const manualAbrir = document.getElementById('greDocManualAbrir');
  const manualTipo = document.getElementById('greManualTipo');
  const manualEmisor = document.getElementById('greManualEmisor');
  const manualSerie = document.getElementById('greManualSerie');
  const manualNumero = document.getElementById('greManualNumero');

  function abrirManualPicker() {
    if (!manualPicker) return;
    if (manualEmisor && !manualEmisor.value) manualEmisor.value = companyRuc;
    manualPicker.hidden = false;
    manualPicker.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    if (manualSerie) manualSerie.focus();
  }

  function cerrarManualPicker() {
    if (!manualPicker) return;
    manualPicker.hidden = true;
    manualPicker.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  }

  function agregarManual() {
    const tipo = (manualTipo && manualTipo.value) || '01';
    const emisor = String(manualEmisor && manualEmisor.value || companyRuc).replace(/\D/g, '');
    const serie = String(manualSerie && manualSerie.value || '').trim().toUpperCase();
    const numero = String(manualNumero && manualNumero.value || '').replace(/\D/g, '');
    if (emisor.length !== 11 || !serie || !numero) {
      alert('Completa RUC emisor (11 dígitos), serie y número.');
      return;
    }
    const tipoLabels = {
      '01': 'Factura',
      '03': 'Boleta',
      '09': 'GRE remitente',
      '31': 'GRE transportista',
    };
    const id = 'manual:' + tipo + ':' + emisor + ':' + serie + ':' + numero;
    facturasSel.set(id, {
      id: id,
      manual: true,
      tipo_doc: tipo,
      tipo_label: tipoLabels[tipo] || ('Tipo ' + tipo),
      ref: serie + '-' + numero,
      serie: serie,
      correlativo: numero,
      emisor: emisor,
      cliente: 'RUC ' + emisor,
      fecha: 'Manual',
    });
    if (manualSerie) manualSerie.value = '';
    if (manualNumero) manualNumero.value = '';
    pintarFacturasSel();
    cerrarManualPicker();
  }

  function syncManualSeriePlaceholder() {
    const tipo = (manualTipo && manualTipo.value) || '01';
    if (!manualSerie) return;
    if (tipo === '09' || tipo === '31') manualSerie.placeholder = 'T001';
    else if (tipo === '03') manualSerie.placeholder = 'B001';
    else manualSerie.placeholder = 'F001';
  }

  manualTipo && manualTipo.addEventListener('change', syncManualSeriePlaceholder);
  syncManualSeriePlaceholder();

  manualAbrir && manualAbrir.addEventListener('click', abrirManualPicker);
  document.getElementById('greDocManualCerrar')?.addEventListener('click', cerrarManualPicker);
  document.getElementById('greDocManualAgregar')?.addEventListener('click', agregarManual);
  manualPicker && manualPicker.addEventListener('click', function (e) {
    if (e.target === manualPicker) cerrarManualPicker();
  });

  function renderResumen() {
    const m = motivoRadio();
    document.getElementById('sumMotivo').textContent = m
      ? `${m.value} · ${m.dataset.titulo || ''}`
      : '—';
    document.getElementById('sumModalidad').textContent = modalidad() === '01'
      ? 'Transporte público'
      : 'Transporte privado';
    const doc = document.getElementById('receptorDoc')?.value || '';
    const nom = document.getElementById('receptorNombre')?.value || '';
    document.getElementById('sumDest').textContent = nom || doc ? `${nom} · ${doc}` : '—';
    const pu = form.partida_ubigeo?.value || form.querySelector('[name="partida_ubigeo"]')?.value || '';
    const pd = form.querySelector('[name="partida_direccion"]')?.value || '';
    const lu = form.querySelector('[name="llegada_ubigeo"]')?.value || '';
    const ld = form.querySelector('[name="llegada_direccion"]')?.value || '';
    document.getElementById('sumRuta').textContent = `${pd || pu || 'Partida'} → ${ld || lu || 'Llegada'}`;
    const placa = document.getElementById('vehiculoPlaca')?.value || '';
    const cond = document.getElementById('conductorNombre')?.value || document.getElementById('conductorDoc')?.value || '';
    const nVehiSec = vehiSecList().length;
    const nCondSec = condSecList().length;
    const partes = [
      placa && ('Placa ' + placa),
      nVehiSec ? (nVehiSec + ' veh. sec.') : '',
      cond,
      nCondSec ? (nCondSec + ' cond. sec.') : '',
    ].filter(Boolean);
    document.getElementById('sumTransporte').textContent = partes.join(' · ') || '—';
    const ft = document.getElementById('fechaTraslado')?.value || '';
    const fe = document.getElementById('fechaEntrega')?.value || '';
    const sumFechas = document.getElementById('sumFechas');
    if (sumFechas) {
      const bits = [ft && ('Inicio ' + formatFechaUi(ft))];
      if (modalidad() === '01' && fe) bits.push('Entrega ' + formatFechaUi(fe));
      sumFechas.textContent = bits.filter(Boolean).join(' · ') || '—';
    }
  }

  function showStep(n) {
    step = Math.min(max, Math.max(1, n));
    panes().forEach((p) => p.classList.toggle('is-on', Number(p.dataset.step) === step));
    dots().forEach((d) => d.classList.toggle('is-on', Number(d.dataset.goto) === step));
    if (titulo) titulo.textContent = pasosTitulos[step] || 'GRE';
    btnPrev.hidden = step === 1;
    btnNext.hidden = step === max;
    btnSubmit.hidden = step !== max;
    if (btnNext) btnNext.setAttribute('aria-hidden', step === max ? 'true' : 'false');
    if (btnSubmit) btnSubmit.setAttribute('aria-hidden', step !== max ? 'true' : 'false');
    if (btnSubmit && step === max) btnSubmit.textContent = 'Emitir';
    if (step === 2) {
      applyMotivoUi();
      if (esEntregaTerceros() && !destTercerosElegido) {
        setTimeout(forzarPickerDestinatarioTerceros, 220);
      }
    }
    if (step === 6) applyModalidadUi();
    if (step === 7) renderResumen();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  form.addEventListener('change', (ev) => {
    if (ev.target.name === 'cod_traslado' || ev.target.name === 'mod_traslado') {
      const motivoAhora = motivoRadio()?.value || '';
      if (ev.target.name === 'cod_traslado') {
        if (motivoAhora === '03' && motivoPrev !== '03') {
          destTercerosElegido = false;
        }
        motivoPrev = motivoAhora;
      }
      syncChoices();
      applyMotivoUi();
      applyModalidadUi();
      if (ev.target.name === 'cod_traslado' && esEntregaTerceros() && !destTercerosElegido && step === 2) {
        setTimeout(forzarPickerDestinatarioTerceros, 120);
      }
    }
  });

  function copiarDestManual() {
    const tipo = document.getElementById('receptorTipo');
    const doc = document.getElementById('receptorDoc');
    const nom = document.getElementById('receptorNombre');
    const tipoM = document.getElementById('receptorTipoManual');
    const docM = document.getElementById('receptorDocManual');
    const nomM = document.getElementById('receptorNombreManual');
    if (tipo && tipoM) tipo.value = tipoM.value || '6';
    if (doc && docM) doc.value = docM.value || '';
    if (nom && nomM) nom.value = nomM.value || '';
    // En entrega a terceros el destinatario solo vale si salió del picker (no del comprador).
    pintarDestVista(
      (nom && nom.value) || '',
      (doc && doc.value) || '',
      (tipo && tipo.value) || '6',
    );
    syncDestBoton();
  }
  ['receptorTipoManual', 'receptorDocManual', 'receptorNombreManual'].forEach(function (id) {
    document.getElementById(id)?.addEventListener('input', copiarDestManual);
    document.getElementById(id)?.addEventListener('change', copiarDestManual);
  });

  const catPicker = document.getElementById('greCatalogPicker');
  const catLista = document.getElementById('greCatLista');
  const catListaWrap = document.getElementById('greCatListaWrap');
  const catFormWrap = document.getElementById('greCatFormWrap');
  const catFormFields = document.getElementById('greCatFormFields');
  const catStatus = document.getElementById('greCatStatus');
  const catBusqueda = document.getElementById('greCatBusqueda');
  const catTitulo = document.getElementById('greCatTitulo');
  const catNueva = document.getElementById('greCatNueva');
  const catGuardar = document.getElementById('greCatGuardar');
  const catMas = document.getElementById('greCatMas');
  let catKind = null;
  let catItems = [];
  let catEditId = null;
  let catOffset = 0;
  let catHasMore = false;
  let catTotal = 0;
  let catQuery = '';
  let catCargando = false;
  let catSearchTimer = null;
  let catPickMode = 'principal'; // principal | secundario
  let catSecIndex = -1; // -1 = nuevo secundario; >=0 = reemplazar

  function readJsonArr(id) {
    try {
      const raw = document.getElementById(id)?.value || '[]';
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  }
  function writeJsonArr(id, arr) {
    const el = document.getElementById(id);
    if (el) el.value = JSON.stringify(arr || []);
  }
  function normPlaca(v) {
    return String(v || '').trim().toUpperCase().replace(/[\s-]+/g, '');
  }
  function normDoc(v) {
    return String(v || '').replace(/\D/g, '');
  }

  function vehiSecList() { return readJsonArr('vehiculoSecundariosJson'); }
  function condSecList() { return readJsonArr('conductorSecundariosJson'); }

  function syncVehiSecJson(list) {
    writeJsonArr('vehiculoSecundariosJson', list);
    pintarVehiSecList();
  }
  function syncCondSecJson(list) {
    writeJsonArr('conductorSecundariosJson', list);
    pintarCondSecList();
  }

  function purgeVehiSecDup(placa) {
    const p = normPlaca(placa);
    if (!p) return;
    syncVehiSecJson(vehiSecList().filter(function (s) { return normPlaca(s.placa) !== p; }));
  }
  function purgeCondSecDup(doc) {
    const d = normDoc(doc);
    if (!d) return;
    syncCondSecJson(condSecList().filter(function (s) { return normDoc(s.numero_doc) !== d; }));
  }

  function addVehiSec(it) {
    const placa = normPlaca(it.placa);
    if (!placa) return;
    const principal = normPlaca(document.getElementById('vehiculoPlaca')?.value);
    if (principal && placa === principal) {
      alert('Esa placa ya es el vehículo principal.');
      return;
    }
    const list = vehiSecList();
    if (list.some(function (s) { return normPlaca(s.placa) === placa; })) {
      alert('Esa placa ya está como secundario.');
      return;
    }
    list.push({ id: it.id || '', placa: placa });
    syncVehiSecJson(list);
  }
  function replaceVehiSec(idx, it) {
    const placa = normPlaca(it.placa);
    if (!placa) return;
    const principal = normPlaca(document.getElementById('vehiculoPlaca')?.value);
    if (principal && placa === principal) {
      alert('Esa placa ya es el vehículo principal.');
      return;
    }
    const list = vehiSecList();
    if (list.some(function (s, i) { return i !== idx && normPlaca(s.placa) === placa; })) {
      alert('Esa placa ya está como secundario.');
      return;
    }
    list[idx] = { id: it.id || '', placa: placa };
    syncVehiSecJson(list);
  }
  function addCondSec(it) {
    const doc = normDoc(it.numero_doc);
    const nombres = String(it.nombres_completos || it.nombres || '').trim();
    if (!doc) return;
    const principal = normDoc(document.getElementById('conductorDoc')?.value);
    if (principal && doc === principal) {
      alert('Ese documento ya es el conductor principal.');
      return;
    }
    const list = condSecList();
    if (list.some(function (s) { return normDoc(s.numero_doc) === doc; })) {
      alert('Ese conductor ya está como secundario.');
      return;
    }
    list.push({
      id: it.id || '',
      tipo_doc: it.tipo_doc || '1',
      numero_doc: doc,
      nombres_completos: nombres,
      licencia: it.licencia || '',
    });
    syncCondSecJson(list);
  }
  function replaceCondSec(idx, it) {
    const doc = normDoc(it.numero_doc);
    const nombres = String(it.nombres_completos || it.nombres || '').trim();
    if (!doc) return;
    const principal = normDoc(document.getElementById('conductorDoc')?.value);
    if (principal && doc === principal) {
      alert('Ese documento ya es el conductor principal.');
      return;
    }
    const list = condSecList();
    if (list.some(function (s, i) { return i !== idx && normDoc(s.numero_doc) === doc; })) {
      alert('Ese conductor ya está como secundario.');
      return;
    }
    list[idx] = {
      id: it.id || '',
      tipo_doc: it.tipo_doc || '1',
      numero_doc: doc,
      nombres_completos: nombres,
      licencia: it.licencia || '',
    };
    syncCondSecJson(list);
  }

  function pintarVehiSecList() {
    const wrap = document.getElementById('greVehiSecList');
    if (!wrap) return;
    const list = vehiSecList();
    wrap.innerHTML = '';
    wrap.hidden = list.length === 0;
    list.forEach(function (item, idx) {
      const block = document.createElement('div');
      block.className = 'ios-sec-block';
      const title = document.createElement('h4');
      title.className = 'ios-sec-title';
      title.textContent = 'Vehículo secundario ' + (idx + 1);
      const row = document.createElement('div');
      row.className = 'ios-ubic-wrap';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ios-ubic-pick is-on';
      btn.innerHTML = '<span class="ios-ubic-pick-icon" aria-hidden="true">🚘</span>'
        + '<span class="ios-ubic-pick-text"><strong></strong><small>Toca para cambiar</small></span>'
        + '<span class="ios-chevron" aria-hidden="true">›</span>';
      btn.querySelector('strong').textContent = item.placa || '—';
      btn.addEventListener('click', function () {
        catPickMode = 'secundario';
        catSecIndex = idx;
        abrirCatPicker('vehiculo');
      });
      const quitar = document.createElement('button');
      quitar.type = 'button';
      quitar.className = 'ios-ubic-clear';
      quitar.setAttribute('aria-label', 'Quitar secundario');
      quitar.textContent = '×';
      quitar.addEventListener('click', function () {
        const next = vehiSecList();
        next.splice(idx, 1);
        syncVehiSecJson(next);
      });
      row.appendChild(btn);
      row.appendChild(quitar);
      block.appendChild(title);
      block.appendChild(row);
      wrap.appendChild(block);
    });
  }

  function pintarCondSecList() {
    const wrap = document.getElementById('greCondSecList');
    if (!wrap) return;
    const list = condSecList();
    wrap.innerHTML = '';
    wrap.hidden = list.length === 0;
    list.forEach(function (item, idx) {
      const block = document.createElement('div');
      block.className = 'ios-sec-block';
      const title = document.createElement('h4');
      title.className = 'ios-sec-title';
      title.textContent = 'Conductor secundario ' + (idx + 1);
      const row = document.createElement('div');
      row.className = 'ios-ubic-wrap';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ios-ubic-pick is-on';
      btn.innerHTML = '<span class="ios-ubic-pick-icon" aria-hidden="true">👤</span>'
        + '<span class="ios-ubic-pick-text"><strong></strong><small></small></span>'
        + '<span class="ios-chevron" aria-hidden="true">›</span>';
      btn.querySelector('strong').textContent = item.nombres_completos || ('Doc. ' + (item.numero_doc || ''));
      btn.querySelector('small').textContent = [
        item.numero_doc,
        item.licencia ? ('Lic. ' + item.licencia) : '',
      ].filter(Boolean).join(' · ') || 'Toca para cambiar';
      btn.addEventListener('click', function () {
        catPickMode = 'secundario';
        catSecIndex = idx;
        abrirCatPicker('conductor');
      });
      const quitar = document.createElement('button');
      quitar.type = 'button';
      quitar.className = 'ios-ubic-clear';
      quitar.setAttribute('aria-label', 'Quitar secundario');
      quitar.textContent = '×';
      quitar.addEventListener('click', function () {
        const next = condSecList();
        next.splice(idx, 1);
        syncCondSecJson(next);
      });
      row.appendChild(btn);
      row.appendChild(quitar);
      block.appendChild(title);
      block.appendChild(row);
      wrap.appendChild(block);
    });
  }

  function setVal(id, v) {
    const el = document.getElementById(id);
    if (el) el.value = v || '';
  }
  function valField(name) {
    const el = document.getElementById('greCatField_' + name);
    return el ? String(el.value || '').trim() : '';
  }
  function setField(name, v) {
    const el = document.getElementById('greCatField_' + name);
    if (el) el.value = v || '';
  }

  const catDefs = {
    transportista: {
      titulo: 'Empresa transportista',
      api: form.dataset.transportistasApi || '/app/emitir/transportistas',
      seedId: 'gre-transportistas-data',
      searchPh: 'RUC o razón social…',
      fields: [
        { id: 'ruc', label: 'RUC', attrs: 'inputmode="numeric" maxlength="11"' },
        { id: 'razon_social', label: 'Razón social' },
        { id: 'nro_mtc', label: 'Nro. MTC' },
      ],
      titleOf: function (it) { return it.razon_social || it.nombre || 'Transportista'; },
      subOf: function (it) {
        return ['RUC ' + (it.ruc || ''), it.nro_mtc ? ('MTC ' + it.nro_mtc) : ''].filter(Boolean).join(' · ');
      },
      match: function (it, q) {
        return [it.razon_social, it.nombre, it.ruc, it.nro_mtc].join(' ').toLowerCase().indexOf(q) >= 0;
      },
      apply: function (it) {
        setVal('transportistaRuc', it.ruc || '');
        setVal('transportistaNombre', it.razon_social || it.nombre || '');
        setVal('transportistaMtc', it.nro_mtc || '');
        pintarTransPick();
      },
      readForm: function () {
        return { ruc: valField('ruc'), razon_social: valField('razon_social'), nro_mtc: valField('nro_mtc') };
      },
      fillForm: function (it) {
        setField('ruc', it && it.ruc);
        setField('razon_social', it && (it.razon_social || it.nombre));
        setField('nro_mtc', it && it.nro_mtc);
      },
      validate: function (body) {
        if (String(body.ruc || '').replace(/\D/g, '').length !== 11) return 'RUC de 11 dígitos';
        if (!body.razon_social) return 'Razón social obligatoria';
        if (!body.nro_mtc) return 'Nro. MTC obligatorio';
        return null;
      },
    },
    vehiculo: {
      titulo: 'Vehículos',
      api: form.dataset.vehiculosApi || '/app/emitir/vehiculos',
      seedId: 'gre-vehiculos-data',
      searchPh: 'Placa…',
      fields: [
        { id: 'placa', label: 'Placa', attrs: 'maxlength="15"' },
        { id: 'nro_circulacion', label: 'Nro. circulación / TUCE (opcional)' },
      ],
      titleOf: function (it) { return it.placa || 'Vehículo'; },
      subOf: function (it) { return it.nro_circulacion ? ('TUCE ' + it.nro_circulacion) : 'Flota'; },
      match: function (it, q) {
        return [it.placa, it.nro_circulacion].join(' ').toLowerCase().indexOf(q) >= 0;
      },
      apply: function (it) {
        if (catPickMode === 'secundario' && catSecIndex === -1) {
          addVehiSec(it);
        } else if (catPickMode === 'secundario' && catSecIndex >= 0) {
          replaceVehiSec(catSecIndex, it);
        } else {
          setVal('vehiculoId', it.id || '');
          setVal('vehiculoPlaca', it.placa || '');
          pintarVehiPick();
          // Si el principal coincide con un secundario, quitarlo
          purgeVehiSecDup(it.placa);
        }
      },
      readForm: function () {
        return { placa: valField('placa'), nro_circulacion: valField('nro_circulacion') };
      },
      fillForm: function (it) {
        setField('placa', it && it.placa);
        setField('nro_circulacion', it && it.nro_circulacion);
      },
      validate: function (body) {
        if (!body.placa || body.placa.length < 5) return 'Placa inválida';
        return null;
      },
    },
    conductor: {
      titulo: 'Conductores',
      api: form.dataset.conductoresApi || '/app/emitir/conductores',
      seedId: 'gre-conductores-data',
      searchPh: 'Nombre, DNI o licencia…',
      fields: [
        { id: 'numero_doc', label: 'DNI / documento', attrs: 'inputmode="numeric" maxlength="12"' },
        { id: 'nombres_completos', label: 'Nombres completos' },
        { id: 'licencia', label: 'Licencia' },
      ],
      titleOf: function (it) { return it.nombres_completos || it.nombres || 'Conductor'; },
      subOf: function (it) {
        return [it.numero_doc, it.licencia ? ('Lic. ' + it.licencia) : ''].filter(Boolean).join(' · ');
      },
      match: function (it, q) {
        return [it.nombres_completos, it.nombres, it.numero_doc, it.licencia].join(' ').toLowerCase().indexOf(q) >= 0;
      },
      apply: function (it) {
        if (catPickMode === 'secundario' && catSecIndex === -1) {
          addCondSec(it);
        } else if (catPickMode === 'secundario' && catSecIndex >= 0) {
          replaceCondSec(catSecIndex, it);
        } else {
          setVal('conductorId', it.id || '');
          setVal('conductorTipo', it.tipo_doc || '1');
          setVal('conductorDoc', it.numero_doc || '');
          setVal('conductorNombre', it.nombres_completos || it.nombres || '');
          setVal('conductorLicencia', it.licencia || '');
          pintarCondPick();
          purgeCondSecDup(it.numero_doc);
        }
      },
      readForm: function () {
        return {
          tipo_doc: '1',
          numero_doc: valField('numero_doc'),
          nombres_completos: valField('nombres_completos'),
          licencia: valField('licencia'),
        };
      },
      fillForm: function (it) {
        setField('numero_doc', it && it.numero_doc);
        setField('nombres_completos', it && (it.nombres_completos || it.nombres));
        setField('licencia', it && it.licencia);
      },
      validate: function (body) {
        if (!body.numero_doc || body.numero_doc.length < 8) return 'Documento inválido';
        if (!body.nombres_completos) return 'Nombres obligatorios';
        return null;
      },
    },
  };

  function pintarPickBtn(btnId, tituloId, detalleId, quitarId, hay, titulo, detalle, emptyTitulo, emptyDetalle) {
    const btn = document.getElementById(btnId);
    const t = document.getElementById(tituloId);
    const d = document.getElementById(detalleId);
    const q = document.getElementById(quitarId);
    if (btn) {
      btn.classList.toggle('is-on', hay);
      btn.classList.toggle('is-empty', !hay);
    }
    if (t) t.textContent = hay ? titulo : emptyTitulo;
    if (d) d.textContent = hay ? detalle : emptyDetalle;
    if (q) q.hidden = !hay;
  }

  function pintarTransPick() {
    const ruc = document.getElementById('transportistaRuc')?.value || '';
    const nom = document.getElementById('transportistaNombre')?.value || '';
    const mtc = document.getElementById('transportistaMtc')?.value || '';
    pintarPickBtn(
      'greTransAbrir', 'greTransBtnTitulo', 'greTransBtnDetalle', 'greTransQuitar',
      Boolean(ruc || nom),
      nom || ('RUC ' + ruc),
      [ruc && ('RUC ' + ruc), mtc && ('MTC ' + mtc)].filter(Boolean).join(' · ') || 'Toca para cambiar',
      'Toca para elegir transportista',
      'Lista guardada o Añadir',
    );
  }

  function pintarVehiPick() {
    const placa = document.getElementById('vehiculoPlaca')?.value || '';
    pintarPickBtn(
      'greVehiAbrir', 'greVehiBtnTitulo', 'greVehiBtnDetalle', 'greVehiQuitar',
      Boolean(placa),
      placa,
      'Principal · toca para cambiar',
      'Toca para elegir vehículo',
      'Principal · flota guardada o Añadir',
    );
  }

  function pintarCondPick() {
    const nom = document.getElementById('conductorNombre')?.value || '';
    const doc = document.getElementById('conductorDoc')?.value || '';
    const lic = document.getElementById('conductorLicencia')?.value || '';
    pintarPickBtn(
      'greCondAbrir', 'greCondBtnTitulo', 'greCondBtnDetalle', 'greCondQuitar',
      Boolean(nom || doc),
      nom || ('Doc. ' + doc),
      [doc, lic && ('Lic. ' + lic)].filter(Boolean).join(' · ') || 'Principal · toca para cambiar',
      'Toca para elegir conductor',
      'Principal · lista guardada o Añadir',
    );
  }

  function def() { return catDefs[catKind]; }

  function mostrarCatForm(on) {
    if (catListaWrap) catListaWrap.hidden = !!on;
    if (catFormWrap) catFormWrap.hidden = !on;
    if (catNueva) catNueva.hidden = !!on;
    const d = def();
    if (catTitulo && d) {
      if (on) {
        catTitulo.textContent = catEditId ? 'Editar' : 'Añadir';
      } else if (catPickMode === 'secundario') {
        catTitulo.textContent = catKind === 'vehiculo'
          ? 'Vehículo secundario'
          : catKind === 'conductor'
            ? 'Conductor secundario'
            : d.titulo;
      } else {
        catTitulo.textContent = d.titulo;
      }
    }
    if (catGuardar) catGuardar.textContent = 'Guardar';
    syncCatMas();
  }

  function buildCatForm(item) {
    const d = def();
    if (!catFormFields || !d) return;
    catFormFields.innerHTML = '';
    d.fields.forEach(function (f) {
      const lab = document.createElement('label');
      lab.className = 'ios-field';
      lab.innerHTML = '<span>' + f.label + '</span><input type="text" id="greCatField_' + f.id + '" ' + (f.attrs || '') + ' />';
      catFormFields.appendChild(lab);
    });
    d.fillForm(item || null);
  }

  function renderCatLista() {
    const d = def();
    if (!catLista || !d) return;
    catLista.innerHTML = '';
    if (!catItems.length) {
      if (catStatus) {
        catStatus.textContent = catCargando
          ? 'Cargando…'
          : (catQuery ? 'Sin resultados' : 'Sin registros. Toca Añadir.');
      }
      syncCatMas();
      return;
    }
    if (catStatus) {
      catStatus.textContent = catItems.length + (catTotal ? (' de ' + catTotal) : '') + ' registro(s)';
    }
    catItems.forEach(function (item) {
      const row = document.createElement('div');
      row.className = 'ios-sheet-item-row';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ios-sheet-item';
      btn.innerHTML = '<strong></strong><span></span>';
      btn.querySelector('strong').textContent = d.titleOf(item);
      btn.querySelector('span').textContent = d.subOf(item);
      btn.addEventListener('click', function () {
        d.apply(item);
        cerrarCatPicker();
      });
      const menu = document.createElement('details');
      menu.className = 'ios-menu';
      menu.innerHTML = '<summary aria-label="Opciones">⋯</summary><div class="ios-menu-panel"></div>';
      const panel = menu.querySelector('.ios-menu-panel');
      const editB = document.createElement('button');
      editB.type = 'button';
      editB.textContent = 'Editar';
      editB.addEventListener('click', function (e) {
        e.preventDefault();
        menu.removeAttribute('open');
        catEditId = item.id;
        buildCatForm(item);
        mostrarCatForm(true);
      });
      const delB = document.createElement('button');
      delB.type = 'button';
      delB.className = 'is-danger';
      delB.textContent = 'Eliminar';
      delB.addEventListener('click', function (e) {
        e.preventDefault();
        menu.removeAttribute('open');
        if (!confirm('¿Eliminar este registro?')) return;
        fetch(d.api + '/' + encodeURIComponent(item.id), {
          method: 'DELETE',
          credentials: 'same-origin',
          headers: { Accept: 'application/json' },
        })
          .then(function (res) {
            return res.json().then(function (data) {
              if (!res.ok) throw new Error(data.message || 'No se pudo eliminar');
            });
          })
          .then(function () { return cargarCatLista(true); })
          .catch(function (err) { alert(err.message || 'Error'); });
      });
      panel.appendChild(editB);
      panel.appendChild(delB);
      menu.addEventListener('toggle', function () {
        if (!menu.open) return;
        catLista.querySelectorAll('details.ios-menu[open]').forEach(function (other) {
          if (other !== menu) other.removeAttribute('open');
        });
      });
      row.appendChild(btn);
      row.appendChild(menu);
      catLista.appendChild(row);
    });
    syncCatMas();
  }

  function syncCatMas() {
    if (!catMas) return;
    catMas.hidden = !catHasMore || (catFormWrap && !catFormWrap.hidden);
    catMas.disabled = catCargando;
    catMas.textContent = catCargando ? 'Cargando…' : 'Ver más';
  }

  function cargarCatLista(reset) {
    const d = def();
    if (!d || catCargando) return Promise.resolve();
    catCargando = true;
    if (reset) {
      catItems = [];
      catOffset = 0;
      catHasMore = false;
      catTotal = 0;
    }
    renderCatLista();
    const url = d.api
      + '?offset=' + encodeURIComponent(catOffset)
      + '&limit=10&q=' + encodeURIComponent(catQuery);
    return fetch(url, {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    })
      .then(function (res) {
        if (!res.ok) throw new Error('No se pudo cargar');
        return res.json();
      })
      .then(function (data) {
        const nuevos = Array.isArray(data.items) ? data.items : (Array.isArray(data) ? data : []);
        catItems = catItems.concat(nuevos);
        catTotal = Number(data.total) || catItems.length;
        catOffset = Number(data.next_offset) || catItems.length;
        catHasMore = data.has_more === true;
      })
      .catch(function (err) {
        if (catStatus) catStatus.textContent = err.message || 'Error';
      })
      .finally(function () {
        catCargando = false;
        renderCatLista();
      });
  }

  function buscarCatDebounced(q) {
    catQuery = String(q || '').trim();
    if (catSearchTimer) clearTimeout(catSearchTimer);
    catSearchTimer = setTimeout(function () {
      cargarCatLista(true);
    }, 280);
  }

  function abrirCatPicker(kind) {
    if (!catPicker || !catDefs[kind]) return;
    catKind = kind;
    catEditId = null;
    catQuery = '';
    const d = def();
    const sheetTitle = catPickMode === 'secundario'
      ? (kind === 'vehiculo' ? 'Vehículo secundario' : kind === 'conductor' ? 'Conductor secundario' : d.titulo)
      : d.titulo;
    catItems = parseJson(d.seedId) || [];
    catOffset = catItems.length;
    catHasMore = catItems.length >= 10;
    catTotal = catItems.length;
    if (catTitulo) catTitulo.textContent = sheetTitle;
    if (catBusqueda) {
      catBusqueda.value = '';
      catBusqueda.placeholder = d.searchPh || 'Buscar…';
    }
    mostrarCatForm(false);
    if (catTitulo) catTitulo.textContent = sheetTitle;
    renderCatLista();
    catPicker.hidden = false;
    catPicker.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    cargarCatLista(true).then(function () { catBusqueda && catBusqueda.focus(); });
  }

  function cerrarCatPicker() {
    if (!catPicker) return;
    mostrarCatForm(false);
    catEditId = null;
    catKind = null;
    catPickMode = 'principal';
    catSecIndex = -1;
    catPicker.hidden = true;
    catPicker.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  }

  function guardarCat() {
    const d = def();
    if (!d) return;
    const body = d.readForm();
    const errMsg = d.validate(body);
    if (errMsg) {
      alert(errMsg);
      return;
    }
    if (catGuardar) {
      catGuardar.disabled = true;
      catGuardar.dataset.originalText = catGuardar.textContent;
      catGuardar.textContent = 'Guardando…';
    }
    const url = catEditId ? (d.api + '/' + encodeURIComponent(catEditId)) : d.api;
    fetch(url, {
      method: catEditId ? 'PUT' : 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
    })
      .then(function (res) {
        return res.json().then(function (data) {
          if (!res.ok) throw new Error(data.message || 'No se pudo guardar');
          return data;
        });
      })
      .then(function (saved) {
        d.apply(saved);
        cerrarCatPicker();
      })
      .catch(function (err) {
        alert(err.message || 'Error al guardar');
      })
      .finally(function () {
        if (catGuardar) {
          catGuardar.disabled = false;
          catGuardar.textContent = catGuardar.dataset.originalText || 'Guardar';
        }
      });
  }

  document.getElementById('greTransAbrir')?.addEventListener('click', function () {
    catPickMode = 'principal';
    catSecIndex = -1;
    abrirCatPicker('transportista');
  });
  document.getElementById('greVehiAbrir')?.addEventListener('click', function () {
    catPickMode = 'principal';
    catSecIndex = -1;
    abrirCatPicker('vehiculo');
  });
  document.getElementById('greCondAbrir')?.addEventListener('click', function () {
    catPickMode = 'principal';
    catSecIndex = -1;
    abrirCatPicker('conductor');
  });
  document.getElementById('greVehiAddSec')?.addEventListener('click', function () {
    if (!normPlaca(document.getElementById('vehiculoPlaca')?.value)) {
      alert('Primero elige el vehículo principal.');
      return;
    }
    catPickMode = 'secundario';
    catSecIndex = -1;
    abrirCatPicker('vehiculo');
  });
  document.getElementById('greCondAddSec')?.addEventListener('click', function () {
    if (!normDoc(document.getElementById('conductorDoc')?.value)) {
      alert('Primero elige el conductor principal.');
      return;
    }
    catPickMode = 'secundario';
    catSecIndex = -1;
    abrirCatPicker('conductor');
  });
  document.getElementById('greTransQuitar')?.addEventListener('click', function () {
    setVal('transportistaRuc', '');
    setVal('transportistaNombre', '');
    setVal('transportistaMtc', '');
    pintarTransPick();
  });
  document.getElementById('greVehiQuitar')?.addEventListener('click', function () {
    setVal('vehiculoId', '');
    setVal('vehiculoPlaca', '');
    syncVehiSecJson([]);
    pintarVehiPick();
  });
  document.getElementById('greCondQuitar')?.addEventListener('click', function () {
    setVal('conductorId', '');
    setVal('conductorTipo', '1');
    setVal('conductorDoc', '');
    setVal('conductorNombre', '');
    setVal('conductorLicencia', '');
    syncCondSecJson([]);
    pintarCondPick();
  });
  document.getElementById('greCatCerrar')?.addEventListener('click', function () {
    if (catFormWrap && !catFormWrap.hidden) mostrarCatForm(false);
    else cerrarCatPicker();
  });
  catNueva?.addEventListener('click', function () {
    catEditId = null;
    buildCatForm(null);
    mostrarCatForm(true);
  });
  catGuardar?.addEventListener('click', guardarCat);
  catBusqueda?.addEventListener('input', function () {
    buscarCatDebounced(catBusqueda.value);
  });
  catMas?.addEventListener('click', function () {
    if (catHasMore && !catCargando) cargarCatLista(false);
  });
  catPicker?.addEventListener('click', function (e) {
    if (e.target === catPicker) cerrarCatPicker();
  });
  pintarTransPick();
  pintarVehiPick();
  pintarCondPick();
  pintarVehiSecList();
  pintarCondSecList();

  dots().forEach((d) => d.addEventListener('click', () => showStep(Number(d.dataset.goto))));
  btnPrev?.addEventListener('click', () => showStep(step - 1));
  btnNext?.addEventListener('click', () => {
    if (step === 1 && !motivoRadio()) {
      alert('Elige un motivo de traslado.');
      return;
    }
    if (step === 2) {
      copiarDestManual();
      const m = motivoRadio();
      const docs = m?.dataset.docs || '';
      if ((docs === 'facturas' || docs === 'mixto' || docs === 'compras') && !facturasSel.size) {
        abrirFacturaPicker();
        if (facturaStatus) {
          facturaStatus.textContent = docs === 'compras'
            ? 'Elige al menos una compra o ingrésala a mano'
            : 'Elige al menos un documento o ingrésalo a mano';
        }
        return;
      }
      if (docs === 'ninguno' && (!movimientosSel || !movimientosSel.size)) {
        abrirMovPicker();
        if (movStatus) movStatus.textContent = 'Elige al menos un movimiento de traslado';
        return;
      }
      const destDoc = document.getElementById('receptorDoc')?.value || '';
      if (esEntregaTerceros()) {
        if (!destTercerosElegido || !destDoc) {
          alert('En entrega a terceros debes elegir el destinatario (distinto al comprador).');
          abrirDestPicker();
          return;
        }
        const buyer = docCompradorFactura();
        const chosen = String(destDoc).replace(/\D/g, '');
        if (buyer && chosen && buyer === chosen) {
          alert('El destinatario debe ser distinto al comprador de la factura.');
          destTercerosElegido = false;
          aplicarDestinatario('6', '', '', false);
          abrirDestPicker();
          return;
        }
      } else if (!destDoc) {
        alert('Falta el destinatario. Vincula un documento o complétalo manualmente.');
        return;
      }
    }
    if (step === 4) {
      const llegadaDir = document.getElementById('llegadaDireccion')?.value || '';
      const llegadaUbi = document.getElementById('llegadaUbigeo')?.value || '';
      if (!llegadaDir && !llegadaUbi) {
        abrirUbicPicker('llegada');
        if (ubicStatus) ubicStatus.textContent = 'Elige el punto de llegada';
        return;
      }
    }
    showStep(step + 1);
  });

  form.addEventListener('submit', (ev) => {
    copiarDestManual();
    const ft = document.getElementById('fechaTraslado')?.value || '';
    if (!ft) {
      ev.preventDefault();
      alert('Elige la fecha de inicio de traslado.');
      showStep(7);
      abrirGreFecha('traslado');
      return;
    }
    form.querySelectorAll(':disabled').forEach((el) => { el.disabled = false; });
    if (typeof window.showEmitLoading === 'function') {
      window.showEmitLoading('Emitiendo GRE…', 'Enviando a SUNAT. No cierres esta ventana.');
    }
    if (btnSubmit) {
      btnSubmit.disabled = true;
      btnSubmit.textContent = 'Emitiendo…';
    }
  });

  syncChoices();
  applyMotivoUi();
  applyModalidadUi();
  applyM1Ui();
  showStep(1);
})();
