(function () {
  function norm(s) {
    return String(s || '').trim().toLowerCase();
  }

  function formatearSoles(n) {
    var v = Number(n);
    if (!Number.isFinite(v)) return 'S/ 0.00';
    return 'S/ ' + v.toFixed(2);
  }

  function etiquetaUnidad(cod) {
    var c = String(cod || 'NIU').trim().toUpperCase();
    if (c === 'NIU' || c === 'UND') return 'und';
    if (c === 'KGM') return 'kg';
    if (c === 'LTR' || c === 'LT') return 'lt';
    if (c === 'MTR' || c === 'MT') return 'm';
    if (c === 'ZZ') return 'serv';
    return c.toLowerCase();
  }

  function parseJson(id) {
    try {
      return JSON.parse(document.getElementById(id)?.textContent || '[]');
    } catch (_e) {
      return [];
    }
  }

  const form = document.getElementById('emitirForm');
  if (!form) return;

  function mostrarCargaEmision() {
    if (typeof window.showEmitLoading === 'function') {
      window.showEmitLoading('Emitiendo comprobante…', 'Enviando a SUNAT. No cierres esta ventana.');
    }
    var btn = form.querySelector('button[type="submit"]');
    if (btn) {
      btn.disabled = true;
      btn.dataset.originalText = btn.textContent;
      btn.textContent = 'Emitiendo…';
    }
  }

  const lineasUi = form.dataset.lineasUi || 'classic';
  const clientes = parseJson('emitir-clientes-data');

  // —— Cliente bottom sheet ——
  const clienteInput = document.getElementById('clienteBusqueda');
  const clienteAbrir = document.getElementById('clienteAbrirLista');
  const clientePicker = document.getElementById('clientePicker');
  const clientePickerBusqueda = document.getElementById('clientePickerBusqueda');
  const clientePickerLista = document.getElementById('clientePickerLista');
  const clientePickerStatus = document.getElementById('clientePickerStatus');
  const clientePickerCerrar = document.getElementById('clientePickerCerrar');
  const clienteSeleccionado = document.getElementById('clienteSeleccionado');
  const clienteSelNombre = document.getElementById('clienteSelNombre');
  const clienteSelDoc = document.getElementById('clienteSelDoc');
  const clienteSelQuitar = document.getElementById('clienteSelQuitar');
  const receptorTipo = document.getElementById('receptorTipoDoc') || form.querySelector('[name="receptor_tipo_doc"]');
  const receptorDoc = document.getElementById('receptorNumeroDoc') || form.querySelector('[name="receptor_numero_doc"]');
  const receptorNombre = document.getElementById('receptorRazonSocial') || form.querySelector('[name="receptor_razon_social"]');

  function filtrarClientes(q) {
    var nq = norm(q);
    if (!nq) return clientes;
    return clientes.filter(function (c) {
      return norm(c.razon_social).indexOf(nq) >= 0 || norm(c.numero_doc).indexOf(nq) >= 0;
    });
  }

  function seleccionarCliente(c) {
    var nombre = c.razon_social || '';
    var doc = c.numero_doc || '';
    if (receptorTipo && c.tipo_doc) receptorTipo.value = c.tipo_doc;
    if (receptorDoc) receptorDoc.value = doc;
    if (receptorNombre) receptorNombre.value = nombre;
    if (clienteInput) clienteInput.value = nombre;
    if (clienteSelNombre) clienteSelNombre.textContent = nombre;
    if (clienteSelDoc) clienteSelDoc.textContent = doc;
    if (clienteSeleccionado) clienteSeleccionado.hidden = false;
  }

  function quitarCliente() {
    if (clienteInput) clienteInput.value = '';
    if (clienteSeleccionado) clienteSeleccionado.hidden = true;
  }

  function renderClientes(lista) {
    if (!clientePickerLista) return;
    clientePickerLista.innerHTML = '';
    if (!lista.length) {
      if (clientePickerStatus) clientePickerStatus.textContent = 'Sin resultados';
      return;
    }
    if (clientePickerStatus) clientePickerStatus.textContent = lista.length + ' cliente(s)';
    lista.forEach(function (c) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ios-sheet-item';
      btn.innerHTML = '<strong>' + (c.razon_social || 'Sin nombre') + '</strong><span>' + (c.numero_doc || '') + '</span>';
      btn.addEventListener('click', function () {
        seleccionarCliente(c);
        cerrarClientePicker();
      });
      clientePickerLista.appendChild(btn);
    });
  }

  function abrirClientePicker() {
    if (!clientePicker) return;
    if (clientePickerBusqueda) clientePickerBusqueda.value = '';
    renderClientes(filtrarClientes(''));
    clientePicker.hidden = false;
    clientePicker.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    clientePickerBusqueda && clientePickerBusqueda.focus();
  }

  function cerrarClientePicker() {
    if (!clientePicker) return;
    clientePicker.hidden = true;
    clientePicker.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  }

  clienteAbrir && clienteAbrir.addEventListener('click', abrirClientePicker);
  clienteInput && clienteInput.addEventListener('click', abrirClientePicker);
  clientePickerCerrar && clientePickerCerrar.addEventListener('click', cerrarClientePicker);
  clienteSelQuitar && clienteSelQuitar.addEventListener('click', quitarCliente);
  clientePickerBusqueda && clientePickerBusqueda.addEventListener('input', function () {
    renderClientes(filtrarClientes(clientePickerBusqueda.value));
  });
  clientePicker && clientePicker.addEventListener('click', function (e) {
    if (e.target === clientePicker) cerrarClientePicker();
  });

  // Prefill selected card if receptor already filled
  if (receptorNombre && receptorNombre.value && clienteSelNombre) {
    clienteSelNombre.textContent = receptorNombre.value;
    if (clienteSelDoc) clienteSelDoc.textContent = receptorDoc ? receptorDoc.value : '';
    if (clienteInput) clienteInput.value = receptorNombre.value;
    if (clienteSeleccionado) clienteSeleccionado.hidden = false;
  }

  // —— Documento afectado + motivo (NC / ND) ——
  const docAfectadoId = document.getElementById('docAfectadoId');
  if (docAfectadoId) {
    const docsApi = form.dataset.docsAfectadosApi || '';
    const docPicker = document.getElementById('docAfectadoPicker');
    const docPickerLista = document.getElementById('docAfectadoPickerLista');
    const docPickerStatus = document.getElementById('docAfectadoPickerStatus');
    const docPickerBusqueda = document.getElementById('docAfectadoPickerBusqueda');
    const docPickerMas = document.getElementById('docAfectadoPickerMas');
    const docPickerCerrar = document.getElementById('docAfectadoPickerCerrar');
    const docAbrir = document.getElementById('docAfectadoAbrir');
    const docBtnTitulo = document.getElementById('docAfectadoBtnTitulo');
    const docBtnDetalle = document.getElementById('docAfectadoBtnDetalle');
    const docSelCard = document.getElementById('docAfectadoSeleccionado');
    const docSelRef = document.getElementById('docAfectadoSelRef');
    const docSelInfo = document.getElementById('docAfectadoSelInfo');
    const docQuitar = document.getElementById('docAfectadoQuitar');

    const inicial = parseJson('emitir-docs-afectados-data') || {};
    let docItems = Array.isArray(inicial.items) ? inicial.items.slice() : [];
    let docTotal = Number(inicial.total) || docItems.length;
    let docNextOffset = Number(inicial.next_offset) || docItems.length;
    let docHasMore = inicial.has_more === true;
    let docQuery = '';
    let cargando = false;
    let buscarTimer = null;
    let docClienteCargado = String(inicial.cliente_doc || '');
    let docSelClienteDoc = (docItems.filter(function (d) {
      return d.id === docAfectadoId.value;
    })[0] || {}).cliente_doc || '';

    /** Solo se pueden acreditar documentos emitidos al mismo cliente. */
    function clienteFiltro() {
      const doc = receptorDoc ? String(receptorDoc.value || '').replace(/\D/g, '') : '';
      return doc.length >= 8 ? doc : '';
    }

    function pintarDocs() {
      if (!docPickerLista) return;
      docPickerLista.innerHTML = '';
      const filtro = clienteFiltro();
      const alcance = filtro
        ? (receptorNombre && receptorNombre.value ? receptorNombre.value : filtro)
        : '';
      if (!docItems.length) {
        if (docPickerStatus) {
          docPickerStatus.textContent = cargando
            ? 'Buscando…'
            : (filtro
              ? 'Sin documentos emitidos a ' + alcance
              : 'Sin documentos emitidos');
        }
        if (docPickerMas) docPickerMas.hidden = true;
        return;
      }
      if (docPickerStatus) {
        docPickerStatus.textContent = docItems.length + ' de ' + docTotal + ' documento(s)'
          + (filtro ? ' de ' + alcance : '');
      }
      docItems.forEach(function (d) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'ios-sheet-item';
        if (d.id === docAfectadoId.value) btn.classList.add('is-selected');
        btn.innerHTML =
          '<strong>' + (d.ref || '') + ' · ' + (d.tipo_label || '') + '</strong>' +
          '<span>' + (d.cliente || '') + '</span>' +
          '<span>' + (d.fecha || '') + ' · ' + (d.total || '') + '</span>';
        btn.addEventListener('click', function () {
          seleccionarDoc(d);
          cerrarDocPicker();
        });
        docPickerLista.appendChild(btn);
      });
      if (docPickerMas) {
        docPickerMas.hidden = !docHasMore;
        docPickerMas.disabled = cargando;
        docPickerMas.textContent = cargando ? 'Cargando…' : 'Ver más';
      }
    }

    function cargarDocs(reset) {
      if (!docsApi || cargando) return;
      cargando = true;
      if (reset) {
        docItems = [];
        docNextOffset = 0;
        docHasMore = false;
      }
      pintarDocs();
      docClienteCargado = clienteFiltro();
      const url = docsApi + '?offset=' + encodeURIComponent(docNextOffset) +
        '&limit=10&q=' + encodeURIComponent(docQuery) +
        '&cliente_doc=' + encodeURIComponent(docClienteCargado) +
        '&tipo=' + encodeURIComponent(form.dataset.tipoKey || '');
      fetch(url, { credentials: 'same-origin', headers: { Accept: 'application/json' } })
        .then(function (res) { return res.json(); })
        .then(function (data) {
          const nuevos = Array.isArray(data.items) ? data.items : [];
          docItems = docItems.concat(nuevos);
          docTotal = Number(data.total) || docItems.length;
          docNextOffset = Number(data.next_offset) || docItems.length;
          docHasMore = data.has_more === true;
        })
        .catch(function () {
          if (docPickerStatus) docPickerStatus.textContent = 'No se pudo cargar la lista';
        })
        .finally(function () {
          cargando = false;
          pintarDocs();
        });
    }

    function seleccionarDoc(d) {
      docAfectadoId.value = d.id || '';
      docSelClienteDoc = String(d.cliente_doc || '').replace(/\D/g, '');
      if (docBtnTitulo) docBtnTitulo.textContent = d.ref || 'Seleccionar documento';
      if (docBtnDetalle) docBtnDetalle.textContent = [d.cliente, d.total].filter(Boolean).join(' · ');
      if (docSelRef) docSelRef.textContent = [d.ref, d.tipo_label].filter(Boolean).join(' · ');
      if (docSelInfo) docSelInfo.textContent = [d.cliente, d.fecha].filter(Boolean).join(' · ');
      if (docSelCard) docSelCard.hidden = false;
      // La nota va al mismo cliente del documento acreditado.
      if (docSelClienteDoc) {
        seleccionarCliente({
          tipo_doc: d.cliente_tipo_doc || '6',
          numero_doc: docSelClienteDoc,
          razon_social: d.cliente_razon_social || d.cliente || '',
        });
      }
      sincronizarItems();
    }

    function quitarDoc() {
      docAfectadoId.value = '';
      docSelClienteDoc = '';
      if (docBtnTitulo) docBtnTitulo.textContent = 'Seleccionar documento';
      if (docBtnDetalle) docBtnDetalle.textContent = 'Elige entre tus últimos emitidos';
      if (docSelCard) docSelCard.hidden = true;
      sincronizarItems();
    }

    function abrirDocPicker() {
      if (!docPicker) return;
      docPicker.hidden = false;
      docPicker.setAttribute('aria-hidden', 'false');
      document.body.style.overflow = 'hidden';
      pintarDocs();
      if (!docItems.length || docClienteCargado !== clienteFiltro()) cargarDocs(true);
      if (docPickerBusqueda) docPickerBusqueda.focus();
    }

    // Si cambia el cliente, el documento elegido deja de ser válido.
    receptorDoc && receptorDoc.addEventListener('change', function () {
      const filtro = clienteFiltro();
      if (docSelClienteDoc && filtro && filtro !== docSelClienteDoc) quitarDoc();
    });

    function cerrarDocPicker() {
      if (!docPicker) return;
      docPicker.hidden = true;
      docPicker.setAttribute('aria-hidden', 'true');
      document.body.style.overflow = '';
    }

    docAbrir && docAbrir.addEventListener('click', abrirDocPicker);
    docQuitar && docQuitar.addEventListener('click', quitarDoc);
    docPickerCerrar && docPickerCerrar.addEventListener('click', cerrarDocPicker);
    docPickerMas && docPickerMas.addEventListener('click', function () { cargarDocs(false); });
    docPicker && docPicker.addEventListener('click', function (e) {
      if (e.target === docPicker) cerrarDocPicker();
    });
    docPickerBusqueda && docPickerBusqueda.addEventListener('input', function () {
      docQuery = docPickerBusqueda.value.trim();
      clearTimeout(buscarTimer);
      buscarTimer = setTimeout(function () { cargarDocs(true); }, 250);
    });

    // —— Motivo SUNAT ——
    const motivos = parseJson('emitir-motivos-data') || [];
    const motivoCodigo = document.getElementById('motivoCodigo');
    const motivoNota = document.getElementById('motivoNota');
    const motivoBtnTitulo = document.getElementById('motivoBtnTitulo');
    const motivoAbrir = document.getElementById('motivoAbrir');
    const motivoPicker = document.getElementById('motivoPicker');
    const motivoPickerLista = document.getElementById('motivoPickerLista');
    const motivoPickerCerrar = document.getElementById('motivoPickerCerrar');

    const nuevaFacturaWrap = document.getElementById('nuevaFacturaWrap');
    const nuevaFacturaCampos = [
      document.getElementById('nuevaFacturaSerie'),
      document.getElementById('nuevaFacturaNumero'),
    ].filter(Boolean);

    function motivoSeleccionado() {
      if (!motivoCodigo) return null;
      return motivos.filter(function (m) { return m.codigo === motivoCodigo.value; })[0] || null;
    }

    function esDescripcionAutomatica(valor) {
      const actual = String(valor || '').trim();
      if (!actual) return true;
      return motivos.some(function (m) { return m.titulo === actual; });
    }

    /** Solo la anulación por error en el RUC pide la factura que reemplaza. */
    function sincronizarMotivo() {
      const sel = motivoSeleccionado();
      const pide = !!(sel && sel.pide_nueva_factura);
      if (nuevaFacturaWrap) nuevaFacturaWrap.hidden = !pide;
      nuevaFacturaCampos.forEach(function (el) {
        el.disabled = !pide;
        el.required = pide;
      });
    }

    function pintarMotivos() {
      if (!motivoPickerLista) return;
      motivoPickerLista.innerHTML = '';
      motivos.forEach(function (m) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'ios-sheet-item';
        if (motivoCodigo && m.codigo === motivoCodigo.value) btn.classList.add('is-selected');
        btn.innerHTML = '<strong>' + (m.titulo || '') + '</strong>';
        btn.addEventListener('click', function () {
          if (motivoCodigo) motivoCodigo.value = m.codigo || '';
          // La descripción se precarga con el motivo, pero respeta lo que escribió el usuario.
          if (motivoNota && esDescripcionAutomatica(motivoNota.value)) {
            motivoNota.value = m.titulo || '';
          }
          if (motivoBtnTitulo) motivoBtnTitulo.textContent = m.titulo || 'Seleccionar motivo';
          cerrarMotivoPicker();
          sincronizarMotivo();
          sincronizarItems();
        });
        motivoPickerLista.appendChild(btn);
      });
    }

    function abrirMotivoPicker() {
      if (!motivoPicker) return;
      pintarMotivos();
      motivoPicker.hidden = false;
      motivoPicker.setAttribute('aria-hidden', 'false');
      document.body.style.overflow = 'hidden';
    }

    function cerrarMotivoPicker() {
      if (!motivoPicker) return;
      motivoPicker.hidden = true;
      motivoPicker.setAttribute('aria-hidden', 'true');
      document.body.style.overflow = '';
    }

    motivoAbrir && motivoAbrir.addEventListener('click', abrirMotivoPicker);
    motivoPickerCerrar && motivoPickerCerrar.addEventListener('click', cerrarMotivoPicker);
    motivoPicker && motivoPicker.addEventListener('click', function (e) {
      if (e.target === motivoPicker) cerrarMotivoPicker();
    });

    // —— Ítems del documento afectado (descuento / devolución) ——
    const itemsCard = document.getElementById('itemsAfectadosCard');
    const itemsTitulo = document.getElementById('itemsAfectadosTitulo');
    const itemsLista = document.getElementById('itemsAfectadosLista');
    const itemsStatus = document.getElementById('itemsAfectadosStatus');
    const itemsHidden = document.getElementById('itemsAfectadosHidden');
    const itemsResumen = document.getElementById('itemsAfectadosResumen');
    const itemsNota = document.getElementById('itemsAfectadosNota');
    const itemsGlobalWrap = document.getElementById('itemsAfectadosGlobal');
    const itemsGlobalValor = document.getElementById('itemsGlobalTotalValor');
    const itemsGlobalLabel = document.getElementById('itemsGlobalTotalLabel');
    const itemsGlobalInfo = document.getElementById('itemsGlobalInfo');
    const itemsMontoWrap = document.getElementById('itemsAfectadosMonto');
    const itemsMontoValor = document.getElementById('itemsMontoValor');
    const itemsMontoLabel = document.getElementById('itemsMontoLabel');
    const itemsMontoInfo = document.getElementById('itemsMontoInfo');
    const itemsStockWrap = document.getElementById('itemsAfectadosStockWrap');
    const itemsStock = document.getElementById('itemsAfectadosStock');
    const itemsStockDetalle = document.getElementById('itemsAfectadosStockDetalle');
    const lineasClassicCard = document.getElementById('lineasClassicCard');
    const emitirBloqueo = document.getElementById('emitirBloqueo');
    const docLineasApi = form.dataset.docLineasApi || '';
    let itemsLineas = [];
    let itemsDocId = '';
    let itemsRef = '';
    let itemsAlmacen = '';
    let itemsSalidaRegistrada = false;
    let itemsCargando = false;

    const TITULOS_ITEMS = {
      descuento: 'Ítems del documento',
      descuento_global: 'Ítems de la venta',
      aumento: 'Ítems de la venta',
      monto: 'Importe de la nota',
      anulacion: 'Ítems que se anulan',
      devolucion_total: 'Ítems que se devuelven',
      devolucion_item: 'Ítems a devolver',
      seleccion: 'Ítems de la nota',
    };

    const NOTAS_ITEMS = {
      descuento: 'Escribe el nuevo precio unitario de los ítems con descuento. La nota se emite por la diferencia.',
      descuento_global: 'Escribe el nuevo precio de cada ítem; el nuevo total de la venta se calcula solo.',
      aumento: 'Escribe cuánto sube cada ítem (con IGV), igual que en la app. El agua +3 → 3.',
      monto: 'Escribe el importe. No mueve almacén: solo ajusta el cobro sobre el documento afectado.',
      anulacion: 'La nota anula todo el documento. Marca solo los productos que vuelven al almacén.',
      devolucion_total: 'Marca los productos que se devuelven. La cantidad va completa.',
      devolucion_item: 'Marca los productos que el cliente devuelve y ajusta la cantidad.',
      seleccion: 'Marca los ítems que entran en la nota y ajusta la cantidad.',
    };

    /** 'descuento' | 'anulacion' | 'devolucion_total' | 'devolucion_item' | '' */
    function modoItems() {
      if (!motivoCodigo) return '';
      const sel = motivos.filter(function (m) { return m.codigo === motivoCodigo.value; })[0];
      return (sel && sel.modo_items) || '';
    }

    /** Modos donde el usuario escribe el precio nuevo de cada ítem. */
    function esDescuento(modo) {
      return modo === 'descuento' || modo === 'descuento_global';
    }

    function esAumento(modo) {
      return modo === 'aumento';
    }

    function esMonto(modo) {
      return modo === 'monto';
    }

    function esPrecioNuevo(modo) {
      return esDescuento(modo) || esAumento(modo);
    }

    function tituloMotivoSel() {
      const sel = motivos.filter(function (m) { return motivoCodigo && m.codigo === motivoCodigo.value; })[0];
      return (sel && sel.titulo) || 'Ajuste';
    }

    /** Modos que devuelven mercadería al almacén (todo el ítem o parte). */
    function esDevolucion(modo) {
      return modo === 'anulacion' || modo === 'devolucion_total' || modo === 'devolucion_item';
    }

    function esTotal(modo) {
      return modo === 'anulacion' || modo === 'devolucion_total';
    }

    function bloquearLineasClassic(bloquear) {
      if (!lineasClassicCard) return;
      lineasClassicCard.hidden = bloquear;
      const campos = lineasClassicCard.querySelectorAll('input, select, textarea, button');
      Array.prototype.forEach.call(campos, function (el) { el.disabled = bloquear; });
    }

    function descuentoDeLinea(ln) {
      const nuevo = Number(ln.nuevo_precio);
      if (ln.nuevo_precio === '' || ln.nuevo_precio == null || !Number.isFinite(nuevo)) return 0;
      const dif = Math.round((ln.precio_unitario - nuevo) * 100) / 100;
      return dif > 0 ? dif : 0;
    }

    /** ND aumento: el campo es el monto adicional por unidad (con IGV), como en la app. */
    function aumentoDeLinea(ln) {
      const extra = Number(ln.nuevo_precio);
      if (ln.nuevo_precio === '' || ln.nuevo_precio == null || !Number.isFinite(extra)) return 0;
      return extra > 0 ? Math.round(extra * 100) / 100 : 0;
    }

    /** Cantidad que entra en la nota. Anulación cubre todo; devolución solo lo marcado. */
    function cantidadDevolucion(ln, modo) {
      if (modo === 'anulacion') return ln.cantidad;
      if (!ln.incluida) return 0;
      if (modo === 'devolucion_total') return ln.cantidad;
      const qty = Number(ln.cantidad_devuelta);
      if (!Number.isFinite(qty) || qty <= 0) return 0;
      return Math.min(qty, ln.cantidad);
    }

    /** El usuario marcó que este producto vuelve al almacén. */
    function vuelveAlAlmacen(ln) {
      return ln.retorna_almacen === true && ln.incluida === true;
    }

    function agregarHidden(campos) {
      campos.forEach(function (par) {
        const input = document.createElement('input');
        input.type = 'hidden';
        input.name = par[0];
        input.value = par[1];
        itemsHidden.appendChild(input);
      });
    }

    function totalDocumento() {
      return itemsLineas.reduce(function (acc, ln) {
        return acc + ln.precio_unitario * ln.cantidad;
      }, 0);
    }

    /**
     * Descuento global: el precio nuevo lo escribe el usuario ítem por ítem y
     * el nuevo total de la venta sale de la suma (la NC referencia las líneas
     * del documento afectado, así que el detalle manda).
     */
    function refrescarGlobal(diferencia, conDif, sentido) {
      const totalActual = totalDocumento();
      const esUp = sentido === 'aumento';
      const nuevoTotal = Math.round((esUp ? totalActual + diferencia : totalActual - diferencia) * 100) / 100;

      if (itemsGlobalLabel) {
        itemsGlobalLabel.textContent = 'Nuevo total de la venta';
      }
      if (itemsGlobalValor) {
        itemsGlobalValor.textContent = conDif ? formatearSoles(nuevoTotal) : '—';
      }
      if (itemsGlobalInfo) {
        if (!conDif) {
          itemsGlobalInfo.textContent = 'Total actual ' + formatearSoles(totalActual)
            + (esUp
              ? '. Escribe el aumento por unidad (con IGV) de los ítems que suben.'
              : '. Escribe el precio nuevo de los ítems que bajan de precio.');
        } else {
          const pct = totalActual > 0 ? (diferencia / totalActual) * 100 : 0;
          itemsGlobalInfo.textContent = 'Antes ' + formatearSoles(totalActual)
            + (esUp ? ' · aumento ' : ' · descuento ')
            + formatearSoles(diferencia) + ' (' + pct.toFixed(1) + '%) con IGV.';
        }
      }
    }

    function refrescarItemsCalculo() {
      limpiarBloqueo();
      if (!itemsHidden) return;
      const modo = modoItems();
      itemsHidden.innerHTML = '';
      let total = 0;
      let incluidos = 0;
      let retornan = 0;

      if (esMonto(modo)) {
        const raw = itemsMontoValor ? String(itemsMontoValor.value || '').trim() : '';
        const monto = Number(raw);
        const valido = raw !== '' && Number.isFinite(monto) && monto > 0;
        if (itemsMontoValor) itemsMontoValor.classList.toggle('is-invalid', raw !== '' && !valido);
        if (itemsMontoInfo) {
          itemsMontoInfo.textContent = valido
            ? 'La nota de débito se emite por ' + formatearSoles(monto) + ' sobre ' + (itemsRef || 'el documento.')
            : 'Escribe el importe (intereses o penalidad). No se devuelve ni se descuenta stock.';
        }
        if (valido) {
          incluidos = 1;
          total = Math.round(monto * 100) / 100;
          agregarHidden([
            ['linea_descripcion', tituloMotivoSel()],
            ['linea_unidad', 'NIU'],
            ['linea_cantidad', '1'],
            ['linea_precio', total.toFixed(2)],
          ]);
        }
        if (itemsResumen) {
          itemsResumen.hidden = !valido;
          itemsResumen.innerHTML = valido
            ? '<div class="ios-orden-totales-row is-total"><span>Total de la nota</span><strong>'
              + formatearSoles(total) + '</strong></div>'
            : '';
        }
        if (itemsStockWrap) itemsStockWrap.hidden = true;
        if (itemsStock) {
          itemsStock.disabled = true;
          itemsStock.checked = false;
        }
        return;
      }

      itemsLineas.forEach(function (ln) {
        if (esPrecioNuevo(modo)) {
          const dif = esAumento(modo) ? aumentoDeLinea(ln) : descuentoDeLinea(ln);
          if (ln.hintEl) {
            ln.hintEl.textContent = dif > 0
              ? (esAumento(modo) ? 'Aumento (con IGV): ' : 'Nota: ') + formatearSoles(dif * ln.cantidad)
              : '';
          }
          if (ln.inputEl) {
            ln.inputEl.classList.toggle('is-invalid', ln.nuevo_precio !== '' && dif <= 0);
          }
          if (dif <= 0) return;
          incluidos += 1;
          total += dif * ln.cantidad;
          agregarHidden([
            ['linea_sale_detail_id', ln.id],
            ['linea_descripcion', ln.descripcion],
            ['linea_unidad', ln.unidad],
            ['linea_cantidad', String(ln.cantidad)],
            ['linea_precio', dif.toFixed(2)],
          ]);
          return;
        }

        const qty = cantidadDevolucion(ln, modo);
        const vuelve = vuelveAlAlmacen(ln);
        if (ln.hintEl) {
          if (vuelve) {
            ln.hintEl.textContent = '↩ vuelve a ' + (ln.almacen_nombre || 'almacén');
          } else if (ln.retorna_almacen) {
            ln.hintEl.textContent = 'No vuelve al almacén';
          } else {
            ln.hintEl.textContent = 'No afecta stock';
          }
        }
        if (qty <= 0) return;
        incluidos += 1;
        if (vuelve) retornan += 1;
        total += ln.precio_unitario * qty;
        const campos = [
          ['linea_sale_detail_id', ln.id],
          ['linea_descripcion', ln.descripcion],
          ['linea_unidad', ln.unidad],
          ['linea_cantidad', String(qty)],
          ['linea_precio', String(ln.precio_unitario)],
          ['linea_catalog_item_id', vuelve ? (ln.catalog_item_id || '') : ''],
          ['linea_almacen_id', vuelve ? (ln.almacen_id || '') : ''],
        ];
        agregarHidden(campos);
      });

      if (modo === 'descuento_global') refrescarGlobal(total, incluidos > 0, 'descuento');
      if (esAumento(modo)) refrescarGlobal(total, incluidos > 0, 'aumento');

      if (itemsResumen) {
        itemsResumen.hidden = incluidos === 0;
        if (incluidos > 0) {
          const filaExtra = esAumento(modo)
            ? '<div class="ios-orden-totales-row"><span>Ítems con aumento</span><strong>' + incluidos + '</strong></div>'
            : esDescuento(modo)
            ? '<div class="ios-orden-totales-row"><span>Ítems con descuento</span><strong>' + incluidos + '</strong></div>'
            : '<div class="ios-orden-totales-row"><span>Ítems en la nota</span><strong>' + incluidos
              + (itemsSalidaRegistrada ? ' · ' + retornan + ' al almacén' : '') + '</strong></div>';
          itemsResumen.innerHTML = filaExtra
            + '<div class="ios-orden-totales-row is-total"><span>Total de la nota</span><strong>'
            + formatearSoles(total) + '</strong></div>';
        } else {
          itemsResumen.innerHTML = '';
        }
      }

      // Switch solo en anulación / devolución. El usuario elige qué productos vuelven.
      if (itemsStock) {
        const aplica = esDevolucion(modo) && itemsLineas.length > 0;
        const puedeStock = aplica && itemsSalidaRegistrada && retornan > 0;
        if (itemsStockWrap) itemsStockWrap.hidden = !aplica;
        if (puedeStock && itemsStock.disabled) itemsStock.checked = true;
        itemsStock.disabled = !puedeStock;
        if (!puedeStock) itemsStock.checked = false;
        if (itemsStockDetalle && aplica) {
          if (puedeStock) {
            itemsStockDetalle.textContent = retornan + (retornan === 1 ? ' ítem vuelve a ' : ' ítems vuelven a ')
              + (itemsAlmacen || 'tu almacén');
          } else if (!itemsSalidaRegistrada) {
            itemsStockDetalle.textContent = 'Esta venta no descontó almacén: no hay stock por devolver';
          } else {
            itemsStockDetalle.textContent = 'Ninguno de estos ítems mueve stock (servicio o serie ya no entregada)';
          }
        }
      }
    }

    function pintarItems() {
      if (!itemsLista || !itemsStatus) return;
      const modo = modoItems();
      itemsLista.innerHTML = '';
      if (itemsHidden) itemsHidden.innerHTML = '';
      if (itemsResumen) itemsResumen.hidden = true;
      if (itemsStockWrap) itemsStockWrap.hidden = true;
      if (itemsStock) itemsStock.disabled = true;
      const esGlobal = modo === 'descuento_global' || esAumento(modo);
      if (itemsGlobalWrap) itemsGlobalWrap.hidden = !esGlobal || !itemsLineas.length;
      if (itemsMontoWrap) itemsMontoWrap.hidden = !esMonto(modo);
      if (itemsMontoLabel) {
        itemsMontoLabel.textContent = tituloMotivoSel() + ' *';
      }
      if (itemsLista) itemsLista.hidden = esMonto(modo);
      if (itemsTitulo) itemsTitulo.textContent = TITULOS_ITEMS[modo] || 'Ítems del documento';
      if (itemsNota) itemsNota.textContent = NOTAS_ITEMS[modo] || '';

      if (!docAfectadoId.value) {
        itemsStatus.textContent = 'Selecciona primero el documento afectado.';
        return;
      }
      if (itemsCargando) {
        itemsStatus.textContent = 'Cargando ítems…';
        return;
      }
      if (esMonto(modo)) {
        itemsStatus.textContent = itemsRef
          ? itemsRef + ' · escribe el importe de ' + tituloMotivoSel().toLowerCase()
          : 'Escribe el importe de la nota.';
        refrescarItemsCalculo();
        return;
      }
      if (!itemsLineas.length) {
        itemsStatus.textContent = 'Este documento ya no tiene ítems por acreditar: ya se emitieron notas por todos.';
        return;
      }

      const alcance = itemsRef
        ? itemsRef + ' · ' + itemsLineas.length + ' ítem(s)'
        : itemsLineas.length + ' ítem(s)';
      if (esDevolucion(modo)) {
        itemsStatus.textContent = itemsSalidaRegistrada
          ? alcance + ' · almacén ' + (itemsAlmacen || '—')
          : alcance + ' · la venta no descontó almacén, no hay stock por devolver';
      } else {
        itemsStatus.textContent = alcance;
      }

      itemsLineas.forEach(function (ln) {
        const row = document.createElement('div');
        row.className = 'ios-nc-item';

        const main = document.createElement('div');
        main.className = 'ios-nc-item-main';
        const titulo = document.createElement('strong');
        titulo.textContent = ln.descripcion;
        const meta = document.createElement('small');
        const partes = esAumento(modo)
          ? [ln.cantidad + ' ' + etiquetaUnidad(ln.unidad), 'Facturado ' + formatearSoles(ln.precio_unitario)]
          : [ln.cantidad + ' ' + etiquetaUnidad(ln.unidad), formatearSoles(ln.precio_unitario)];
        if (ln.numero_serie) partes.push('serie ' + ln.numero_serie);
        if (esDevolucion(modo)) {
          partes.push(ln.retorna_almacen
            ? (ln.almacen_nombre || 'almacén')
            : 'no afecta stock');
        }
        meta.textContent = partes.join(' · ');
        const hint = document.createElement('small');
        hint.className = 'ios-nc-item-hint';
        main.appendChild(titulo);
        main.appendChild(meta);
        main.appendChild(hint);
        ln.hintEl = hint;
        ln.inputEl = null;

        if (esPrecioNuevo(modo)) {
          const wrap = document.createElement('label');
          wrap.className = 'ios-nc-item-precio';
          const etiqueta = document.createElement('span');
          etiqueta.textContent = esAumento(modo) ? 'Aumento' : 'Nuevo';
          const input = document.createElement('input');
          input.type = 'number';
          input.step = '0.01';
          input.min = esAumento(modo) ? '0.01' : '0';
          if (!esAumento(modo)) input.max = String(ln.precio_unitario);
          input.inputMode = 'decimal';
          input.placeholder = esAumento(modo) ? '0.00' : Number(ln.precio_unitario).toFixed(2);
          input.value = ln.nuevo_precio || '';
          input.addEventListener('input', function () {
            ln.nuevo_precio = input.value;
            refrescarItemsCalculo();
          });
          wrap.appendChild(etiqueta);
          wrap.appendChild(input);
          ln.inputEl = input;
          row.appendChild(main);
          row.appendChild(wrap);
        } else {
          const qtyFija = esTotal(modo);
          const puedeMarcar = modo === 'anulacion' ? ln.retorna_almacen : true;
          if (!puedeMarcar) ln.incluida = false;
          const check = document.createElement('input');
          check.type = 'checkbox';
          check.className = 'ios-nc-item-check';
          check.checked = puedeMarcar && ln.incluida !== false;
          check.disabled = !puedeMarcar;
          check.title = modo === 'anulacion'
            ? (puedeMarcar ? 'Volver este producto al almacén' : 'Este ítem no mueve stock')
            : 'Incluir este producto en la devolución';
          const wrap = document.createElement('label');
          wrap.className = 'ios-nc-item-precio';
          const etiqueta = document.createElement('span');
          etiqueta.textContent = 'Cant.';
          const input = document.createElement('input');
          input.type = 'number';
          input.step = ln.maneja_serie ? '1' : '0.01';
          input.min = '0';
          input.max = String(ln.cantidad);
          input.inputMode = 'decimal';
          input.value = qtyFija ? String(ln.cantidad) : ln.cantidad_devuelta;
          input.disabled = qtyFija || !check.checked;
          input.addEventListener('input', function () {
            ln.cantidad_devuelta = input.value;
            refrescarItemsCalculo();
          });
          check.addEventListener('change', function () {
            ln.incluida = check.checked;
            if (!qtyFija) input.disabled = !check.checked;
            row.classList.toggle('is-off', !check.checked);
            refrescarItemsCalculo();
          });
          wrap.appendChild(etiqueta);
          wrap.appendChild(input);
          row.classList.toggle('is-off', !check.checked);
          row.appendChild(check);
          row.appendChild(main);
          row.appendChild(wrap);
          ln.inputEl = input;
        }

        itemsLista.appendChild(row);
      });

      refrescarItemsCalculo();
    }

    function cargarItemsDoc(docId) {
      if (!docLineasApi) return;
      itemsCargando = true;
      itemsLineas = [];
      itemsRef = '';
      itemsAlmacen = '';
      itemsSalidaRegistrada = false;
      itemsDocId = docId;
      pintarItems();
      fetch(docLineasApi + '/' + encodeURIComponent(docId) + '/lineas', {
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
      })
        .then(function (res) { return res.json(); })
        .then(function (data) {
          if (itemsDocId !== docId) return;
          itemsRef = data.ref || '';
          itemsAlmacen = data.almacen_nombre || '';
          itemsSalidaRegistrada = data.salida_registrada === true;
          itemsLineas = (Array.isArray(data.lineas) ? data.lineas : []).map(function (ln) {
            const cantidad = Number(ln.cantidad) || 1;
            return {
              id: ln.id,
              descripcion: ln.descripcion || 'Ítem',
              unidad: ln.unidad || 'NIU',
              cantidad,
              precio_unitario: Number(ln.precio_unitario) || 0,
              catalog_item_id: ln.catalog_item_id || '',
              almacen_id: ln.almacen_id || '',
              almacen_nombre: ln.almacen_nombre || '',
              numero_serie: ln.numero_serie || '',
              maneja_serie: ln.maneja_serie === true,
              retorna_almacen: ln.retorna_almacen === true,
              nuevo_precio: '',
              incluida: true,
              cantidad_devuelta: String(cantidad),
            };
          });
        })
        .catch(function () {
          if (itemsStatus) itemsStatus.textContent = 'No se pudieron cargar los ítems.';
        })
        .finally(function () {
          if (itemsDocId !== docId) return;
          itemsCargando = false;
          pintarItems();
        });
    }

    function sincronizarItems() {
      if (!itemsCard) return;
      const activo = Boolean(modoItems());
      itemsCard.hidden = !activo;
      bloquearLineasClassic(activo);
      if (!activo) {
        itemsLineas = [];
        itemsDocId = '';
        if (itemsLista) itemsLista.innerHTML = '';
        if (itemsHidden) itemsHidden.innerHTML = '';
        if (itemsResumen) itemsResumen.hidden = true;
        if (itemsStockWrap) itemsStockWrap.hidden = true;
        if (itemsStock) itemsStock.disabled = true;
        if (itemsGlobalWrap) itemsGlobalWrap.hidden = true;
        if (itemsMontoWrap) itemsMontoWrap.hidden = true;
        return;
      }
      if (!docAfectadoId.value) {
        itemsLineas = [];
        itemsDocId = '';
        pintarItems();
        return;
      }
      if (docAfectadoId.value !== itemsDocId) {
        cargarItemsDoc(docAfectadoId.value);
        return;
      }
      pintarItems();
    }

    /** Aviso junto al botón: el usuario no siempre ve el estado dentro de la tarjeta. */
    function bloquearEmision(mensaje) {
      if (emitirBloqueo) {
        emitirBloqueo.textContent = mensaje;
        emitirBloqueo.hidden = false;
      }
      if (itemsStatus && !itemsCargando && itemsLineas.length) itemsStatus.textContent = mensaje;
      if (itemsCard && !itemsCard.hidden && itemsCard.scrollIntoView) {
        itemsCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }

    function limpiarBloqueo() {
      if (emitirBloqueo) {
        emitirBloqueo.hidden = true;
        emitirBloqueo.textContent = '';
      }
    }

    itemsMontoValor && itemsMontoValor.addEventListener('input', refrescarItemsCalculo);

    sincronizarMotivo();
    sincronizarItems();

    form.addEventListener('submit', function (e) {
      limpiarBloqueo();
      if (!docAfectadoId.value) {
        e.preventDefault();
        e.stopImmediatePropagation();
        abrirDocPicker();
        if (docPickerStatus) docPickerStatus.textContent = 'Elige el documento afectado';
        return;
      }
      if (motivoCodigo && !motivoCodigo.value) {
        e.preventDefault();
        e.stopImmediatePropagation();
        abrirMotivoPicker();
        return;
      }
      const modo = modoItems();
      if (!modo) return;

      if (itemsCargando) {
        e.preventDefault();
        e.stopImmediatePropagation();
        bloquearEmision('Espera un momento: aún se cargan los ítems del documento.');
        return;
      }
      if (!esMonto(modo) && !itemsLineas.length) {
        e.preventDefault();
        e.stopImmediatePropagation();
        bloquearEmision('Este documento ya no tiene ítems por acreditar. Elige otro documento.');
        return;
      }
      if (!itemsHidden || !itemsHidden.children.length) {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (esMonto(modo)) {
          bloquearEmision('Escribe el importe de la nota.');
          if (itemsMontoValor) itemsMontoValor.focus();
        } else if (esAumento(modo)) {
          bloquearEmision('Escribe el aumento (con IGV) de al menos un ítem.');
        } else if (esDescuento(modo)) {
          bloquearEmision('Escribe el nuevo precio (menor al actual) de al menos un ítem.');
        } else if (modo === 'anulacion') {
          bloquearEmision('Este documento ya no tiene ítems por acreditar.');
        } else {
          bloquearEmision('Marca al menos un producto para devolver.');
        }
      }
    });

    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      if (motivoPicker && !motivoPicker.hidden) cerrarMotivoPicker();
      else if (docPicker && !docPicker.hidden) cerrarDocPicker();
    });
  }

  // —— Classic líneas (NC / ND / guías) ——
  const lineasWrap = document.getElementById('lineasWrap');
  const btnAdd = document.getElementById('btnAddLinea');

  function bindCatalog(selectEl) {
    if (!selectEl) return;
    selectEl.addEventListener('change', function () {
      const opt = selectEl.selectedOptions[0];
      if (!opt || !opt.value) return;
      const row = selectEl.closest('[data-linea]');
      if (!row) return;
      const desc = row.querySelector('[data-desc]');
      const unidad = row.querySelector('[data-unidad]');
      const precio = row.querySelector('[data-precio]');
      if (desc && opt.dataset.nombre) desc.value = opt.dataset.nombre;
      if (unidad && opt.dataset.unidad) unidad.value = opt.dataset.unidad;
      if (precio && opt.dataset.precio) precio.value = opt.dataset.precio;
    });
  }

  if (lineasWrap) {
    lineasWrap.querySelectorAll('[data-catalog]').forEach(bindCatalog);
    lineasWrap.addEventListener('click', function (ev) {
      const btn = ev.target.closest('[data-remove-linea]');
      if (!btn) return;
      const row = btn.closest('[data-linea]');
      if (row && lineasWrap.querySelectorAll('[data-linea]').length > 1) row.remove();
    });
  }

  if (btnAdd && lineasWrap) {
    btnAdd.addEventListener('click', function () {
      const first = lineasWrap.querySelector('[data-linea]');
      if (!first) return;
      const clone = first.cloneNode(true);
      clone.querySelectorAll('input').forEach(function (input) {
        if (input.name === 'linea_cantidad') input.value = '1';
        else if (input.name === 'linea_unidad') input.value = 'NIU';
        else input.value = '';
      });
      clone.querySelectorAll('select').forEach(function (sel) { sel.selectedIndex = 0; });
      if (!clone.querySelector('[data-remove-linea]')) {
        const rm = document.createElement('button');
        rm.type = 'button';
        rm.className = 'ios-btn-ghost';
        rm.setAttribute('data-remove-linea', '');
        rm.textContent = 'Quitar línea';
        clone.appendChild(rm);
      }
      lineasWrap.appendChild(clone);
      bindCatalog(clone.querySelector('[data-catalog]'));
    });
  }

  if (lineasUi !== 'orden') {
    form.addEventListener('submit', function () {
      mostrarCargaEmision();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && clientePicker && !clientePicker.hidden) cerrarClientePicker();
    });
    return;
  }

  // —— Líneas estilo nueva orden (FACTURA / BOLETA) ——
  let catalogo = parseJson('emitir-catalogo-data');
  const almacenes = parseJson('emitir-almacenes-data');
  let lineas = parseJson('emitir-lineas-data');
  let defaultAlmacenId = form.dataset.almacenDefault || '';
  if (!defaultAlmacenId && almacenes.length) defaultAlmacenId = almacenes[0].id || '';
  let almacenActivoId = defaultAlmacenId || (almacenes[0] && almacenes[0].id) || '';
  const seriesApiBase = form.dataset.seriesApi || '/app/ordenes/catalogo';
  const stockApi = form.dataset.stockApi || '/app/emitir/catalogo-stock';
  let stockLoadedFor = '';
  let stockLoading = null;

  const productoInput = document.getElementById('productoBusqueda');
  const productoAbrir = document.getElementById('productoAbrirLista');
  const productoPicker = document.getElementById('productoPicker');
  const productoPickerBusqueda = document.getElementById('productoPickerBusqueda');
  const productoPickerLista = document.getElementById('productoPickerLista');
  const productoPickerStatus = document.getElementById('productoPickerStatus');
  const productoPickerCerrar = document.getElementById('productoPickerCerrar');
  const productoAlmacenSelect = document.getElementById('productoAlmacenSelect');
  const lineasBox = document.getElementById('lineasOrden');
  const lineasHidden = document.getElementById('lineasHidden');
  const ordenTotal = document.getElementById('ordenTotal');

  const seriePicker = document.getElementById('seriePicker');
  const seriePickerBusqueda = document.getElementById('seriePickerBusqueda');
  const seriePickerLista = document.getElementById('seriePickerLista');
  const seriePickerStatus = document.getElementById('seriePickerStatus');
  const seriePickerCerrar = document.getElementById('seriePickerCerrar');
  const seriePickerTitulo = document.getElementById('seriePickerTitulo');
  const seriePickerAgregar = document.getElementById('seriePickerAgregar');

  let productoSeriePendiente = null;
  let seriesDisponibles = [];
  let seriesSeleccionadas = new Set();

  function nombreAlmacen(id) {
    if (!id) return 'Almacén';
    var a = almacenes.find(function (x) { return String(x.id) === String(id); });
    return a ? a.nombre : 'Almacén';
  }

  function almacenActivo() {
    if (productoAlmacenSelect && productoAlmacenSelect.value) {
      return String(productoAlmacenSelect.value);
    }
    return almacenActivoId || defaultAlmacenId || (almacenes[0] && almacenes[0].id) || '';
  }

  function actualizarLabelAlmacen() {
    if (!productoAlmacenSelect) return;
    var id = almacenActivoId || defaultAlmacenId || '';
    if (id && productoAlmacenSelect.value !== String(id)) {
      productoAlmacenSelect.value = String(id);
    }
  }

  function productoPorId(id) {
    return catalogo.find(function (c) { return String(c.id) === String(id); }) || null;
  }

  function controlaStock(p) {
    if (!p) return false;
    if (p.kind === 'SERVICE') return false;
    return p.maneja_stock === true || p.maneja_serie === true;
  }

  function stockDe(p) {
    if (!controlaStock(p)) return null;
    var n = Number(p.stock_actual);
    return Number.isFinite(n) ? n : 0;
  }

  function cantidadYaPedida(catalogItemId, almacenId, exceptIdx) {
    var total = 0;
    lineas.forEach(function (ln, idx) {
      if (exceptIdx != null && idx === exceptIdx) return;
      if (String(ln.catalog_item_id) !== String(catalogItemId)) return;
      if (String(ln.almacen_id || '') !== String(almacenId || '')) return;
      total += Number(ln.cantidad) || 0;
    });
    return total;
  }

  function stockDisponiblePara(catalogItemId, almacenId, exceptIdx) {
    var p = productoPorId(catalogItemId);
    if (!controlaStock(p)) return null;
    var stock = stockDe(p);
    var usada = cantidadYaPedida(catalogItemId, almacenId, exceptIdx);
    return Math.max(0, stock - usada);
  }

  function cargarStockAlmacen(almacenId, force) {
    if (!almacenId) return Promise.resolve();
    if (!force && stockLoadedFor === String(almacenId)) return Promise.resolve();
    if (stockLoading && stockLoadedFor === String(almacenId)) return stockLoading;
    if (productoPickerStatus) productoPickerStatus.textContent = 'Cargando stock…';
    stockLoading = fetch(stockApi + '?almacen_id=' + encodeURIComponent(almacenId), {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    })
      .then(function (res) {
        return res.json().then(function (data) {
          if (!res.ok) throw new Error(data.message || 'No se pudo cargar el stock');
          return data;
        });
      })
      .then(function (data) {
        var items = Array.isArray(data.items) ? data.items : [];
        var byId = {};
        items.forEach(function (it) { byId[String(it.id)] = it; });
        catalogo = catalogo.map(function (p) {
          var fresh = byId[String(p.id)];
          if (!fresh) {
            return Object.assign({}, p, {
              stock_actual: controlaStock(p) ? 0 : null,
            });
          }
          return Object.assign({}, p, {
            nombre: fresh.nombre || p.nombre,
            codigo: fresh.codigo != null ? fresh.codigo : p.codigo,
            unidad: fresh.unidad || p.unidad,
            precio_unitario: fresh.precio_unitario != null ? fresh.precio_unitario : p.precio_unitario,
            maneja_stock: fresh.maneja_stock === true,
            maneja_serie: fresh.maneja_serie === true,
            stock_actual: fresh.stock_actual,
            kind: fresh.kind || p.kind,
          });
        });
        // Include any products only returned by stock endpoint
        items.forEach(function (it) {
          if (!productoPorId(it.id)) catalogo.push(it);
        });
        stockLoadedFor = String(almacenId);
      })
      .catch(function (err) {
        if (productoPickerStatus) {
          productoPickerStatus.textContent = err.message || 'Error al cargar stock';
        }
      })
      .finally(function () {
        stockLoading = null;
      });
    return stockLoading;
  }

  function filtrarCatalogo(q) {
    var nq = norm(q);
    if (!nq) return catalogo;
    return catalogo.filter(function (p) {
      return norm(p.nombre).indexOf(nq) >= 0 || norm(p.codigo).indexOf(nq) >= 0;
    });
  }

  function renderAlmacenesToolbar() {
    if (!productoAlmacenSelect) return;
    var current = String(almacenActivoId || defaultAlmacenId || '');
    productoAlmacenSelect.innerHTML = '';
    if (!almacenes.length) {
      productoAlmacenSelect.disabled = true;
      var empty = document.createElement('option');
      empty.value = '';
      empty.textContent = 'Sin almacenes';
      productoAlmacenSelect.appendChild(empty);
      return;
    }
    productoAlmacenSelect.disabled = false;
    almacenes.forEach(function (a) {
      var opt = document.createElement('option');
      opt.value = a.id;
      opt.textContent = a.nombre || a.codigo || 'Almacén';
      if (String(a.id) === current) opt.selected = true;
      productoAlmacenSelect.appendChild(opt);
    });
    if (!productoAlmacenSelect.value && almacenes[0]) {
      productoAlmacenSelect.value = String(almacenes[0].id);
      almacenActivoId = almacenes[0].id;
    } else if (productoAlmacenSelect.value) {
      almacenActivoId = productoAlmacenSelect.value;
    }
  }

  function renderCatalogo(lista) {
    if (!productoPickerLista) return;
    productoPickerLista.innerHTML = '';
    if (!lista.length) {
      if (productoPickerStatus) productoPickerStatus.textContent = 'Sin resultados';
      return;
    }
    if (productoPickerStatus) {
      productoPickerStatus.textContent = lista.length + ' producto(s) · ' + nombreAlmacen(almacenActivo());
    }
    var alm = almacenActivo();
    lista.forEach(function (p) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ios-sheet-item';
      var precio = p.precio_unitario != null ? formatearSoles(p.precio_unitario) : '—';
      var stockTxt = '';
      var disponible = null;
      if (controlaStock(p)) {
        disponible = stockDisponiblePara(p.id, alm, null);
        stockTxt = ' · Stock ' + (disponible != null ? disponible : stockDe(p));
        if (disponible != null && disponible <= 0) {
          btn.className += ' is-disabled';
          btn.disabled = true;
        }
      }
      btn.innerHTML = '<strong>' + (p.nombre || 'Ítem') + '</strong><span>' +
        (p.codigo ? p.codigo + ' · ' : '') + precio + stockTxt + '</span>';
      if (!btn.disabled) {
        btn.addEventListener('click', function () {
          agregarLinea(p);
        });
      }
      productoPickerLista.appendChild(btn);
    });
  }

  function abrirProductoPicker() {
    if (!productoPicker) return;
    var q = productoInput ? productoInput.value : '';
    if (productoPickerBusqueda) productoPickerBusqueda.value = q;
    renderAlmacenesToolbar();
    productoPicker.hidden = false;
    productoPicker.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    cargarStockAlmacen(almacenActivo()).then(function () {
      renderCatalogo(filtrarCatalogo(q));
      productoPickerBusqueda && productoPickerBusqueda.focus();
    });
  }

  function cerrarProductoPicker() {
    if (!productoPicker) return;
    productoPicker.hidden = true;
    productoPicker.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  }

  function seriesYaUsadas(catalogItemId) {
    return new Set(
      lineas
        .filter(function (ln) {
          return ln.catalog_item_id === catalogItemId && ln.producto_serie_id;
        })
        .map(function (ln) { return String(ln.producto_serie_id); }),
    );
  }

  function filtrarSeries(q) {
    var nq = norm(q);
    if (!nq) return seriesDisponibles;
    return seriesDisponibles.filter(function (s) {
      return norm(s.numero_serie || s.numeroSerie).indexOf(nq) >= 0;
    });
  }

  function actualizarBtnSeries() {
    if (!seriePickerAgregar) return;
    var n = seriesSeleccionadas.size;
    seriePickerAgregar.disabled = n === 0;
    seriePickerAgregar.textContent = n > 0 ? ('Agregar (' + n + ')') : 'Agregar seleccionadas';
  }

  function renderSeriesPicker(lista) {
    if (!seriePickerLista) return;
    seriePickerLista.innerHTML = '';
    var usadas = productoSeriePendiente ? seriesYaUsadas(productoSeriePendiente.id) : new Set();
    if (!lista.length) {
      if (seriePickerStatus) seriePickerStatus.textContent = 'No hay series disponibles en este almacén';
      actualizarBtnSeries();
      return;
    }
    if (seriePickerStatus) seriePickerStatus.textContent = lista.length + ' serie(s)';
    lista.forEach(function (s) {
      var id = String(s.id || '');
      var num = s.numero_serie || s.numeroSerie || '';
      var ya = usadas.has(id);
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ios-sheet-item' + (seriesSeleccionadas.has(id) ? ' is-selected' : '');
      btn.disabled = ya;
      btn.innerHTML = '<strong>' + num + '</strong><span>' + (ya ? 'Ya agregada' : 'Disponible') + '</span>';
      if (!ya) {
        btn.addEventListener('click', function () {
          if (seriesSeleccionadas.has(id)) seriesSeleccionadas.delete(id);
          else seriesSeleccionadas.add(id);
          renderSeriesPicker(filtrarSeries(seriePickerBusqueda ? seriePickerBusqueda.value : ''));
        });
      }
      seriePickerLista.appendChild(btn);
    });
    actualizarBtnSeries();
  }

  function cerrarSeriePicker() {
    if (!seriePicker) return;
    seriePicker.hidden = true;
    seriePicker.setAttribute('aria-hidden', 'true');
    productoSeriePendiente = null;
    seriesSeleccionadas = new Set();
    document.body.style.overflow = productoPicker && !productoPicker.hidden ? 'hidden' : '';
  }

  function abrirSeriePicker(producto) {
    if (!seriePicker || !producto) return;
    productoSeriePendiente = producto;
    seriesSeleccionadas = new Set();
    seriesDisponibles = [];
    if (seriePickerTitulo) seriePickerTitulo.textContent = producto.nombre || 'Elegir serie';
    if (seriePickerBusqueda) seriePickerBusqueda.value = '';
    if (seriePickerStatus) seriePickerStatus.textContent = 'Cargando series…';
    if (seriePickerLista) seriePickerLista.innerHTML = '';
    actualizarBtnSeries();
    seriePicker.hidden = false;
    seriePicker.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';

    var alm = almacenActivo();
    var url = seriesApiBase + '/' + encodeURIComponent(producto.id) + '/series?almacen_id=' + encodeURIComponent(alm);
    fetch(url, { credentials: 'same-origin', headers: { Accept: 'application/json' } })
      .then(function (res) {
        return res.json().then(function (data) {
          if (!res.ok) throw new Error(data.message || 'No se pudieron cargar las series');
          return data;
        });
      })
      .then(function (data) {
        seriesDisponibles = Array.isArray(data.items) ? data.items : (Array.isArray(data) ? data : []);
        renderSeriesPicker(filtrarSeries(''));
        seriePickerBusqueda && seriePickerBusqueda.focus();
      })
      .catch(function (err) {
        if (seriePickerStatus) seriePickerStatus.textContent = err.message || 'Error al cargar series';
      });
  }

  function confirmarSeriesSeleccionadas() {
    var producto = productoSeriePendiente;
    if (!producto || seriesSeleccionadas.size === 0) return;
    var alm = almacenActivo();
    var precio = producto.precio_unitario != null ? Number(producto.precio_unitario) : null;
    var usadas = seriesYaUsadas(producto.id);
    seriesDisponibles.forEach(function (s) {
      var id = String(s.id || '');
      if (!seriesSeleccionadas.has(id) || usadas.has(id)) return;
      lineas.push({
        catalog_item_id: producto.id || '',
        nombre: producto.nombre || '',
        cantidad: 1,
        precio_unitario: precio,
        unidad: producto.unidad || 'NIU',
        maneja_serie: true,
        almacen_id: s.almacen_id || s.almacenId || alm,
        producto_serie_id: id,
        numero_serie: s.numero_serie || s.numeroSerie || '',
      });
      usadas.add(id);
    });
    renderLineas();
    cerrarSeriePicker();
    cerrarProductoPicker();
  }

  function agregarLinea(p) {
    var esSerie = p.maneja_serie === true;
    var precio = p.precio_unitario != null ? Number(p.precio_unitario) : null;
    var alm = almacenActivo();
    if (!alm && almacenes.length) {
      window.alert('Selecciona un almacén arriba');
      if (productoAlmacenSelect) productoAlmacenSelect.focus();
      return;
    }
    if (esSerie) {
      var dispSerie = stockDisponiblePara(p.id, alm, null);
      if (dispSerie != null && dispSerie <= 0) {
        window.alert('"' + (p.nombre || 'Producto') + '" no tiene series disponibles en este almacén.');
        return;
      }
      abrirSeriePicker(p);
      return;
    }
    if (controlaStock(p)) {
      var disponible = stockDisponiblePara(p.id, alm, null);
      if (disponible != null && disponible <= 0) {
        window.alert('"' + (p.nombre || 'Producto') + '" no tiene stock disponible en este almacén.');
        return;
      }
    }
    var existente = lineas.findIndex(function (ln) {
      return ln.catalog_item_id === p.id && !ln.maneja_serie && String(ln.almacen_id || '') === String(alm || '');
    });
    if (existente >= 0) {
      var nuevaCant = Number(lineas[existente].cantidad || 0) + 1;
      var max = stockDisponiblePara(p.id, alm, existente);
      if (max != null && nuevaCant > max) {
        window.alert('Solo hay ' + max + ' disponible(s) de "' + (p.nombre || 'Producto') + '".');
        return;
      }
      lineas[existente].cantidad = nuevaCant;
    } else {
      lineas.push({
        catalog_item_id: p.id || '',
        nombre: p.nombre || '',
        cantidad: 1,
        precio_unitario: precio,
        unidad: p.unidad || 'NIU',
        maneja_serie: false,
        maneja_stock: controlaStock(p),
        almacen_id: alm,
      });
    }
    renderLineas();
    cerrarProductoPicker();
  }

  function renderLineas() {
    if (!lineasBox || !lineasHidden) return;
    lineasBox.innerHTML = '';
    lineasHidden.innerHTML = '';
    var total = 0;
    lineas.forEach(function (ln, idx) {
      var sub = (Number(ln.precio_unitario) || 0) * (Number(ln.cantidad) || 0);
      total += sub;
      var unidadLbl = etiquetaUnidad(ln.unidad);
      var prod = productoPorId(ln.catalog_item_id);
      var maxStock = stockDisponiblePara(ln.catalog_item_id, ln.almacen_id, idx);
      var dispStock = stockDisponiblePara(ln.catalog_item_id, ln.almacen_id, null);
      var row = document.createElement('div');
      row.className = 'ios-orden-linea';
      var qtyInner = ln.maneja_serie
        ? '<span class="ios-orden-linea-qty">× 1</span>'
        : '<input class="ios-orden-linea-qty-input" type="number" min="0.0001" step="any" value="' + ln.cantidad + '"' +
          (maxStock != null ? (' max="' + maxStock + '"') : '') + ' data-qty />';
      var qtyHtml = '<div class="ios-orden-linea-qty-wrap">' + qtyInner +
        '<span class="ios-orden-linea-unidad">' + unidadLbl + '</span></div>';
      var serieHtml = '';
      if (ln.maneja_serie) {
        if (ln.numero_serie) {
          serieHtml = '<small class="ios-orden-linea-serie">Serie: ' + ln.numero_serie + '</small>';
        } else {
          serieHtml = '<button type="button" class="ios-orden-linea-serie-btn" data-elegir-serie>Elegir serie</button>';
        }
      }
      var stockHint = '';
      if (dispStock != null) {
        stockHint = ' · Disp. ' + dispStock;
      }
      row.innerHTML =
        '<div class="ios-orden-linea-text">' +
          '<strong>' + (ln.nombre || 'Ítem') + '</strong>' +
          serieHtml +
          '<small>' + formatearSoles(ln.precio_unitario) + ' c/u · ' +
          (ln.catalog_item_id ? nombreAlmacen(ln.almacen_id) : 'Sin almacén') + stockHint + '</small>' +
        '</div>' +
        qtyHtml +
        '<button type="button" data-remove-linea aria-label="Quitar">×</button>';

      var elegirSerieBtn = row.querySelector('[data-elegir-serie]');
      if (elegirSerieBtn) {
        elegirSerieBtn.addEventListener('click', function () {
          if (prod) abrirSeriePicker(prod);
        });
      }
      var qtyInput = row.querySelector('[data-qty]');
      if (qtyInput) {
        qtyInput.addEventListener('change', function () {
          var v = Number(qtyInput.value);
          if (!Number.isFinite(v) || v <= 0) {
            lineas.splice(idx, 1);
            renderLineas();
            return;
          }
          var max = stockDisponiblePara(ln.catalog_item_id, ln.almacen_id, idx);
          if (max != null && v > max) {
            window.alert('Solo hay ' + max + ' disponible(s) de "' + (ln.nombre || 'Producto') + '".');
            qtyInput.value = String(max > 0 ? max : lineas[idx].cantidad);
            if (max <= 0) {
              lineas.splice(idx, 1);
            } else {
              lineas[idx].cantidad = max;
            }
            renderLineas();
            return;
          }
          lineas[idx].cantidad = v;
          renderLineas();
        });
      }
      row.querySelector('[data-remove-linea]').addEventListener('click', function () {
        lineas.splice(idx, 1);
        renderLineas();
      });
      lineasBox.appendChild(row);

      function addHidden(name, value) {
        var input = document.createElement('input');
        input.type = 'hidden';
        input.name = name;
        input.value = value == null ? '' : String(value);
        lineasHidden.appendChild(input);
      }
      addHidden('linea_catalog_item_id', ln.catalog_item_id || '');
      addHidden('linea_descripcion', ln.nombre || '');
      addHidden('linea_cantidad', ln.cantidad);
      addHidden('linea_unidad', ln.unidad || 'NIU');
      addHidden('linea_precio', ln.precio_unitario != null ? ln.precio_unitario : '');
      addHidden('linea_almacen_id', ln.almacen_id || '');
      addHidden('linea_producto_serie_id', ln.producto_serie_id || '');
      addHidden('linea_numero_serie', ln.numero_serie || '');
      addHidden('linea_kind', ln.kind || '');
      addHidden('linea_afectacion', ln.afectacion_igv || '');
      addHidden('linea_codigo', ln.codigo || '');
      addHidden('linea_codigo_sunat', ln.codigo_sunat || '');
    });
    if (ordenTotal) {
      if (!lineas.length) {
        ordenTotal.hidden = true;
        ordenTotal.innerHTML = '';
      } else {
        var subtotal = 0;
        var igv = 0;
        lineas.forEach(function (ln) {
          var bruto = (Number(ln.precio_unitario) || 0) * (Number(ln.cantidad) || 0);
          var afe = String(ln.afectacion_igv || '10');
          if (afe === '20' || afe === '30') {
            subtotal += bruto;
          } else {
            var base = bruto / 1.18;
            subtotal += base;
            igv += bruto - base;
          }
        });
        var totalConIgv = subtotal + igv;
        ordenTotal.hidden = false;
        ordenTotal.innerHTML =
          '<div class="ios-orden-totales-row"><span>Subtotal</span><strong>' + formatearSoles(subtotal) + '</strong></div>' +
          '<div class="ios-orden-totales-row"><span>IGV</span><strong>' + formatearSoles(igv) + '</strong></div>' +
          '<div class="ios-orden-totales-row is-total"><span>Total</span><strong>' + formatearSoles(totalConIgv) + '</strong></div>';
      }
    }
  }

  (function bindItemPuntual() {
    var sheet = document.getElementById('itemPuntualSheet');
    var abrir = document.getElementById('productoPuntualAbrir');
    var cerrar = document.getElementById('itemPuntualCerrar');
    var aceptar = document.getElementById('itemPuntualAceptar');
    if (!sheet || !abrir) return;
    var cantidadEl = document.getElementById('itemCantidad');
    var unidadEl = document.getElementById('itemUnidad');
    var codigoEl = document.getElementById('itemCodigo');
    var descEl = document.getElementById('itemDescripcion');
    var valorEl = document.getElementById('itemValor');
    var descueEl = document.getElementById('itemDescuento');
    var iscEl = document.getElementById('itemIsc');
    var icbperEl = document.getElementById('itemIcbper');
    var totalLbl = document.getElementById('itemTotalLbl');

    function radio(name) {
      var el = sheet.querySelector('input[name="' + name + '"]:checked');
      return el ? el.value : '';
    }
    function extrasBloquean() {
      var bolsas = radio('item_bolsas') === 'si';
      var descue = Number(descueEl && descueEl.value) > 0;
      var isc = !!(iscEl && iscEl.value);
      var igvRaro = radio('item_igv_pct') === '10.5' && radio('item_afe') === '10';
      var icbper = !!(icbperEl && icbperEl.value);
      return bolsas || descue || isc || igvRaro || icbper;
    }
    function refrescarTotal() {
      var cant = Number(cantidadEl && cantidadEl.value) || 0;
      var valor = Number(valorEl && valorEl.value) || 0;
      var afe = radio('item_afe') || '10';
      var bruto = afe === '10' ? valor * 1.18 * cant : valor * cant;
      if (totalLbl) totalLbl.textContent = 'Importe total del ítem: S/ ' + (bruto > 0 ? bruto.toFixed(2) : '0.00');
    }
    function resetForm() {
      sheet.querySelectorAll('input[name="item_kind"]').forEach(function (el) {
        el.checked = el.value === 'SERVICE';
      });
      sheet.querySelectorAll('input[name="item_codigo_tipo"]').forEach(function (el) {
        el.checked = el.value === 'usuario';
      });
      sheet.querySelectorAll('input[name="item_bolsas"]').forEach(function (el) {
        el.checked = el.value === 'no';
      });
      sheet.querySelectorAll('input[name="item_igv_pct"]').forEach(function (el) {
        el.checked = el.value === '18';
      });
      sheet.querySelectorAll('input[name="item_afe"]').forEach(function (el) {
        el.checked = el.value === '10';
      });
      if (cantidadEl) cantidadEl.value = '1';
      if (unidadEl) unidadEl.value = 'ZZ';
      if (codigoEl) codigoEl.value = '';
      if (descEl) descEl.value = '';
      if (valorEl) valorEl.value = '0';
      if (descueEl) descueEl.value = '0';
      if (iscEl) iscEl.value = '';
      if (icbperEl) icbperEl.value = '';
      refrescarTotal();
    }
    sheet.addEventListener('change', function (ev) {
      if (ev.target && ev.target.name === 'item_kind' && unidadEl) {
        unidadEl.value = ev.target.value === 'SERVICE' ? 'ZZ' : 'NIU';
      }
      refrescarTotal();
    });
    valorEl && valorEl.addEventListener('input', refrescarTotal);
    cantidadEl && cantidadEl.addEventListener('input', refrescarTotal);
    abrir.addEventListener('click', function () {
      resetForm();
      sheet.hidden = false;
      sheet.setAttribute('aria-hidden', 'false');
    });
    function cerrarSheet() {
      sheet.hidden = true;
      sheet.setAttribute('aria-hidden', 'true');
    }
    cerrar && cerrar.addEventListener('click', cerrarSheet);
    aceptar && aceptar.addEventListener('click', function () {
      var descripcion = String(descEl && descEl.value || '').trim();
      var cant = Number(cantidadEl && cantidadEl.value);
      var valor = Number(valorEl && valorEl.value);
      var afe = radio('item_afe') || '10';
      if (!descripcion) {
        window.alert('Escribe la descripción del ítem.');
        return;
      }
      if (!(cant > 0) || !(valor > 0)) {
        window.alert('Cantidad y valor unitario tienen que ser mayores a 0.');
        return;
      }
      if (extrasBloquean()) {
        window.alert('Bolsas, descuento, ISC, IGV 10.5 % e ICBPER todavía no se declaran en el comprobante. Déjalos en NO, 0, 18 % y sin ISC/ICBPER.');
        return;
      }
      var kind = radio('item_kind') === 'PRODUCT' ? 'PRODUCT' : 'SERVICE';
      var tipoCod = radio('item_codigo_tipo') || 'usuario';
      var codigoRaw = String(codigoEl && codigoEl.value || '').trim();
      var precio = afe === '10' ? Math.round(valor * 1.18 * 100) / 100 : Math.round(valor * 100) / 100;
      lineas.push({
        catalog_item_id: '',
        nombre: descripcion,
        cantidad: cant,
        precio_unitario: precio,
        unidad: (unidadEl && unidadEl.value) || (kind === 'SERVICE' ? 'ZZ' : 'NIU'),
        maneja_serie: false,
        maneja_stock: false,
        almacen_id: '',
        kind: kind,
        afectacion_igv: afe,
        codigo: tipoCod === 'sunat' ? '' : codigoRaw,
        codigo_sunat: tipoCod === 'sunat' ? codigoRaw.replace(/\D/g, '') : '',
      });
      renderLineas();
      cerrarSheet();
    });
  })();

  function agregarSerieEscaneada(payload) {
    var item = payload.item || {};
    var serie = payload.serie || {};
    var serieId = String(serie.id || '');
    var numero = String(serie.numero_serie || '');
    if (!serieId) return 'No se encontró la serie.';
    var repetida = lineas.some(function (ln) {
      return String(ln.producto_serie_id || '') === serieId || (numero && String(ln.numero_serie || '') === numero);
    });
    if (repetida) return 'Esa serie ya está en la lista.';
    lineas.push({
      catalog_item_id: item.id || '',
      nombre: item.nombre || '',
      cantidad: 1,
      precio_unitario: item.precio_unitario != null ? Number(item.precio_unitario) : null,
      unidad: item.unidad || 'NIU',
      maneja_serie: true,
      maneja_stock: true,
      almacen_id: serie.almacen_id || almacenActivo(),
      producto_serie_id: serieId,
      numero_serie: numero,
    });
    renderLineas();
    return 'Agregado: ' + (item.nombre || 'Producto') + ' · ' + numero;
  }

  function productoExacto(codigo) {
    var nq = norm(codigo);
    if (!nq) return null;
    var exactos = catalogo.filter(function (p) {
      return norm(p.codigo) === nq || norm(p.nombre) === nq;
    });
    if (exactos.length === 1) return exactos[0];
    var lista = filtrarCatalogo(codigo);
    return lista.length === 1 ? lista[0] : null;
  }

  function tomarBusqueda(codigo, input) {
    if (!codigo) return;
    function usarProducto() {
      var prod = productoExacto(codigo);
      if (!prod) {
        if (productoPickerStatus) productoPickerStatus.textContent = 'Sin resultados para «' + codigo + '»';
        return;
      }
      if (input) input.value = '';
      if (productoInput && productoInput !== input) productoInput.value = '';
      if (productoPickerBusqueda && productoPickerBusqueda !== input) productoPickerBusqueda.value = '';
      agregarLinea(prod);
    }
    if (!window.EasyBarcodeSerie) {
      usarProducto();
      return;
    }
    window.EasyBarcodeSerie.consultar({
      codigo: codigo,
      uso: 'venta',
      almacenId: almacenActivo(),
    }).then(function (data) {
      var msg = agregarSerieEscaneada(data);
      if (input) input.value = '';
      if (productoInput && productoInput !== input) productoInput.value = '';
      if (productoPickerBusqueda && productoPickerBusqueda !== input) productoPickerBusqueda.value = '';
      renderCatalogo(filtrarCatalogo(''));
      if (productoPickerStatus && msg) productoPickerStatus.textContent = msg;
      cerrarProductoPicker();
    }).catch(function () {
      usarProducto();
    });
  }

  if (window.EasyBarcodeSerie) {
    window.EasyBarcodeSerie.alEnter(productoPickerBusqueda, tomarBusqueda);
    window.EasyBarcodeSerie.alEnter(productoInput, tomarBusqueda);
    window.EasyBarcodeSerie.mount({
      uso: 'venta',
      button: document.getElementById('barcodeSerieBtn'),
      getAlmacenId: almacenActivo,
      onFound: function (data) {
        return agregarSerieEscaneada(data);
      },
    });
  }

  productoAbrir && productoAbrir.addEventListener('click', abrirProductoPicker);
  productoInput && productoInput.addEventListener('click', abrirProductoPicker);
  productoInput && productoInput.addEventListener('focus', function () {
    abrirProductoPicker();
  });
  productoPickerCerrar && productoPickerCerrar.addEventListener('click', cerrarProductoPicker);
  productoAlmacenSelect && productoAlmacenSelect.addEventListener('change', function () {
    almacenActivoId = productoAlmacenSelect.value || '';
    cargarStockAlmacen(almacenActivoId, true).then(function () {
      renderCatalogo(filtrarCatalogo(productoPickerBusqueda ? productoPickerBusqueda.value : ''));
      renderLineas();
    });
  });
  productoPickerBusqueda && productoPickerBusqueda.addEventListener('input', function () {
    renderCatalogo(filtrarCatalogo(productoPickerBusqueda.value));
  });
  productoPicker && productoPicker.addEventListener('click', function (e) {
    if (e.target === productoPicker) cerrarProductoPicker();
  });
  seriePickerCerrar && seriePickerCerrar.addEventListener('click', cerrarSeriePicker);
  seriePickerAgregar && seriePickerAgregar.addEventListener('click', confirmarSeriesSeleccionadas);
  seriePickerBusqueda && seriePickerBusqueda.addEventListener('input', function () {
    renderSeriesPicker(filtrarSeries(seriePickerBusqueda.value));
  });
  seriePicker && seriePicker.addEventListener('click', function (e) {
    if (e.target === seriePicker) cerrarSeriePicker();
  });

  form.addEventListener('submit', function (e) {
    if (!lineas.length) {
      e.preventDefault();
      window.alert('Agrega al menos un producto.');
      return;
    }
    var sinSerie = lineas.find(function (ln) {
      return ln.maneja_serie && !ln.producto_serie_id;
    });
    if (sinSerie) {
      e.preventDefault();
      window.alert('Elige la serie de: ' + (sinSerie.nombre || 'producto'));
      return;
    }
    for (var i = 0; i < lineas.length; i += 1) {
      var ln = lineas[i];
      var max = stockDisponiblePara(ln.catalog_item_id, ln.almacen_id, i);
      if (max != null && Number(ln.cantidad) > max) {
        e.preventDefault();
        window.alert('"' + (ln.nombre || 'Producto') + '" solo tiene ' + max + ' disponible(s).');
        return;
      }
    }
    mostrarCargaEmision();
  });

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    if (seriePicker && !seriePicker.hidden) cerrarSeriePicker();
    else if (productoPicker && !productoPicker.hidden) cerrarProductoPicker();
    else if (clientePicker && !clientePicker.hidden) cerrarClientePicker();
  });

  // Ensure prefilled lines have almacen + unidad from catalog when missing
  lineas = lineas.map(function (ln) {
    var cat = productoPorId(ln.catalog_item_id);
    return Object.assign({}, ln, {
      nombre: ln.nombre || (cat && cat.nombre) || 'Ítem',
      unidad: ln.unidad || (cat && cat.unidad) || 'NIU',
      almacen_id: ln.almacen_id || almacenActivoId,
      maneja_serie: ln.maneja_serie === true || (cat && cat.maneja_serie === true && !!(ln.producto_serie_id || ln.numero_serie)),
      maneja_stock: ln.maneja_stock === true || (cat && controlaStock(cat)),
      precio_unitario: ln.precio_unitario != null
        ? ln.precio_unitario
        : (cat && cat.precio_unitario != null ? Number(cat.precio_unitario) : null),
    });
  });

  cargarStockAlmacen(almacenActivo()).then(function () {
    // Clamp prefilled quantities that exceed stock
    var adjusted = false;
    lineas.forEach(function (ln, idx) {
      var max = stockDisponiblePara(ln.catalog_item_id, ln.almacen_id, idx);
      if (max != null && Number(ln.cantidad) > max) {
        ln.cantidad = max;
        adjusted = true;
      }
    });
    lineas = lineas.filter(function (ln) {
      var p = productoPorId(ln.catalog_item_id);
      if (!controlaStock(p)) return true;
      return Number(ln.cantidad) > 0;
    });
    if (adjusted) {
      window.alert('Algunas cantidades se ajustaron al stock disponible del almacén.');
    }
    renderLineas();
  });

  // —— Documentos relacionados (FACTURA / BOLETA): GRE de terceros, etc. ——
  (function initDocsRelacionadosFactura() {
    var tipoKey = form.getAttribute('data-tipo-key') || '';
    if (tipoKey !== 'FACTURA' && tipoKey !== 'BOLETA') return;

    var picker = document.getElementById('feDocManualPicker');
    var abrir = document.getElementById('feDocManualAbrir');
    var selWrap = document.getElementById('feDocsSel');
    var hiddenWrap = document.getElementById('feDocsHidden');
    var manualTipo = document.getElementById('feManualTipo');
    var manualEmisor = document.getElementById('feManualEmisor');
    var manualSerie = document.getElementById('feManualSerie');
    var manualNumero = document.getElementById('feManualNumero');
    var companyRuc = String(manualEmisor && manualEmisor.value || '').replace(/\D/g, '');
    var docsSel = new Map();

    var tipoLabels = {
      '01': 'Factura',
      '03': 'Boleta',
      '09': 'GRE remitente',
      '31': 'GRE transportista',
    };

    function syncSeriePlaceholder() {
      var tipo = (manualTipo && manualTipo.value) || '09';
      if (!manualSerie) return;
      if (tipo === '09' || tipo === '31') manualSerie.placeholder = 'T001';
      else if (tipo === '03') manualSerie.placeholder = 'B001';
      else manualSerie.placeholder = 'F001';
    }

    function pintar() {
      if (!selWrap || !hiddenWrap) return;
      selWrap.innerHTML = '';
      hiddenWrap.innerHTML = '';
      docsSel.forEach(function (d) {
        var card = document.createElement('div');
        card.className = 'ios-selected-card';
        card.innerHTML =
          '<div class="ios-selected-card-text">' +
            '<strong></strong><span></span>' +
          '</div>' +
          '<button type="button" aria-label="Quitar">×</button>';
        card.querySelector('strong').textContent = [d.ref, d.tipo_label].filter(Boolean).join(' · ');
        card.querySelector('span').textContent = 'RUC ' + d.emisor + ' · Manual';
        card.querySelector('button').addEventListener('click', function () {
          docsSel.delete(d.id);
          pintar();
        });
        selWrap.appendChild(card);
        [
          ['rel_tipo', d.tipo_doc],
          ['rel_serie', d.serie],
          ['rel_numero', d.correlativo],
          ['rel_emisor', d.emisor],
        ].forEach(function (par) {
          var input = document.createElement('input');
          input.type = 'hidden';
          input.name = par[0];
          input.value = par[1];
          hiddenWrap.appendChild(input);
        });
      });
    }

    function abrirPicker() {
      if (!picker) return;
      if (manualEmisor && !manualEmisor.value) manualEmisor.value = companyRuc;
      syncSeriePlaceholder();
      picker.hidden = false;
      picker.setAttribute('aria-hidden', 'false');
      document.body.style.overflow = 'hidden';
      if (manualSerie) manualSerie.focus();
    }

    function cerrarPicker() {
      if (!picker) return;
      picker.hidden = true;
      picker.setAttribute('aria-hidden', 'true');
      document.body.style.overflow = '';
    }

    function agregar() {
      var tipo = (manualTipo && manualTipo.value) || '09';
      var emisor = String(manualEmisor && manualEmisor.value || companyRuc).replace(/\D/g, '');
      var serie = String(manualSerie && manualSerie.value || '').trim().toUpperCase();
      var numero = String(manualNumero && manualNumero.value || '').replace(/\D/g, '');
      if (emisor.length !== 11 || !serie || !numero) {
        alert('Completa RUC emisor (11 dígitos), serie y número.');
        return;
      }
      var id = 'manual:' + tipo + ':' + emisor + ':' + serie + ':' + numero;
      docsSel.set(id, {
        id: id,
        tipo_doc: tipo,
        tipo_label: tipoLabels[tipo] || ('Tipo ' + tipo),
        ref: serie + '-' + numero,
        serie: serie,
        correlativo: numero,
        emisor: emisor,
      });
      if (manualSerie) manualSerie.value = '';
      if (manualNumero) manualNumero.value = '';
      pintar();
      cerrarPicker();
    }

    manualTipo && manualTipo.addEventListener('change', syncSeriePlaceholder);
    syncSeriePlaceholder();
    abrir && abrir.addEventListener('click', abrirPicker);
    document.getElementById('feDocManualCerrar')?.addEventListener('click', cerrarPicker);
    document.getElementById('feDocManualAgregar')?.addEventListener('click', agregar);
    picker && picker.addEventListener('click', function (e) {
      if (e.target === picker) cerrarPicker();
    });
  })();
})();
