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
    if (c === 'LTR') return 'lt';
    if (c === 'MTR') return 'm';
    if (c === 'ZZ') return 'srv';
    return c.toLowerCase();
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

  function initOrdenForm(root) {
    if (!root) return;

    var clientes = [];
    var catalogo = [];
    var almacenes = [];
    var defaultAlmacenId = root.dataset.almacenDefault || '';
    try {
      clientes = JSON.parse(document.getElementById('ordenes-clientes-data')?.textContent || '[]');
      catalogo = JSON.parse(document.getElementById('ordenes-catalogo-data')?.textContent || '[]');
      almacenes = JSON.parse(document.getElementById('ordenes-almacenes-data')?.textContent || '[]');
    } catch (_e) {
      return;
    }

    if (!defaultAlmacenId && almacenes.length) {
      defaultAlmacenId = almacenes[0].id || '';
    }

    var almacenActivoId = defaultAlmacenId || (almacenes[0] && almacenes[0].id) || '';

    var clienteInput = document.getElementById('clienteBusqueda');
    var clienteAbrir = document.getElementById('clienteAbrirLista');
    var clientePicker = document.getElementById('clientePicker');
    var clientePickerBusqueda = document.getElementById('clientePickerBusqueda');
    var clientePickerLista = document.getElementById('clientePickerLista');
    var clientePickerStatus = document.getElementById('clientePickerStatus');
    var clientePickerCerrar = document.getElementById('clientePickerCerrar');
    var clienteSeleccionado = document.getElementById('clienteSeleccionado');
    var clienteSelNombre = document.getElementById('clienteSelNombre');
    var clienteSelDoc = document.getElementById('clienteSelDoc');
    var clienteSelQuitar = document.getElementById('clienteSelQuitar');
    var clienteIdInput = document.getElementById('clienteId');

    var productoInput = document.getElementById('productoBusqueda');
    var productoAbrir = document.getElementById('productoAbrirLista');
    var productoPicker = document.getElementById('productoPicker');
    var productoPickerBusqueda = document.getElementById('productoPickerBusqueda');
    var productoPickerLista = document.getElementById('productoPickerLista');
    var productoPickerStatus = document.getElementById('productoPickerStatus');
    var productoPickerCerrar = document.getElementById('productoPickerCerrar');
    var productoAlmacenSelect = document.getElementById('productoAlmacenSelect');
    var lineasBox = document.getElementById('lineasOrden');
    var lineasHidden = document.getElementById('lineasHidden');
    var ordenTotal = document.getElementById('ordenTotal');

    var lineas = [];
    var seriesApiBase = root.dataset.seriesApi || '/app/ordenes/catalogo';
    var productoSeriePendiente = null;
    var seriesDisponibles = [];
    var seriesSeleccionadas = new Set();

    var seriePicker = document.getElementById('seriePicker');
    var seriePickerBusqueda = document.getElementById('seriePickerBusqueda');
    var seriePickerLista = document.getElementById('seriePickerLista');
    var seriePickerStatus = document.getElementById('seriePickerStatus');
    var seriePickerCerrar = document.getElementById('seriePickerCerrar');
    var seriePickerTitulo = document.getElementById('seriePickerTitulo');
    var seriePickerAgregar = document.getElementById('seriePickerAgregar');

    function filtrarClientes(q) {
      var nq = norm(q);
      if (!nq) return clientes;
      return clientes.filter(function (c) {
        var nombre = norm(c.razon_social || c.razonSocial);
        var doc = norm(c.numero_doc || c.numeroDoc);
        return nombre.indexOf(nq) >= 0 || doc.indexOf(nq) >= 0;
      });
    }

    function filtrarCatalogo(q) {
      var nq = norm(q);
      if (!nq) return catalogo;
      return catalogo.filter(function (p) {
        var nombre = norm(p.nombre);
        var codigo = norm(p.codigo);
        return nombre.indexOf(nq) >= 0 || codigo.indexOf(nq) >= 0;
      });
    }

    function renderClientes(lista) {
      if (!clientePickerLista) return;
      clientePickerLista.innerHTML = '';
      if (!lista.length) {
        clientePickerStatus.textContent = 'Sin resultados';
        return;
      }
      clientePickerStatus.textContent = lista.length + ' cliente(s)';
      lista.forEach(function (c) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'ios-sheet-item';
        var nombre = c.razon_social || c.razonSocial || 'Sin nombre';
        var doc = c.numero_doc || c.numeroDoc || '';
        btn.innerHTML = '<strong>' + nombre + '</strong><span>' + doc + '</span>';
        btn.addEventListener('click', function () {
          seleccionarCliente(c);
          cerrarClientePicker();
        });
        clientePickerLista.appendChild(btn);
      });
    }

    function nombreAlmacen(id) {
      if (!id) return 'Almacén';
      var a = almacenes.find(function (x) { return String(x.id) === String(id); });
      return a ? a.nombre : 'Almacén';
    }

    function actualizarLabelAlmacen() {
      if (!productoAlmacenSelect) return;
      var id = almacenActivoId || defaultAlmacenId || '';
      if (id && productoAlmacenSelect.value !== String(id)) {
        productoAlmacenSelect.value = String(id);
      }
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

    function almacenActivo() {
      if (productoAlmacenSelect && productoAlmacenSelect.value) {
        return String(productoAlmacenSelect.value);
      }
      return almacenActivoId || defaultAlmacenId || (almacenes[0] && almacenes[0].id) || '';
    }

    function renderCatalogo(lista) {
      if (!productoPickerLista) return;
      productoPickerLista.innerHTML = '';
      if (!lista.length) {
        productoPickerStatus.textContent = 'Sin resultados';
        return;
      }
      productoPickerStatus.textContent = lista.length + ' producto(s) · ' + nombreAlmacen(almacenActivo());
      lista.forEach(function (p) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'ios-sheet-item';
        var precio = p.precio_unitario != null ? formatearSoles(p.precio_unitario) : '—';
        btn.innerHTML = '<strong>' + (p.nombre || 'Ítem') + '</strong><span>' +
          (p.codigo ? p.codigo + ' · ' : '') + precio + '</span>';
        btn.addEventListener('click', function () {
          agregarLinea(p);
        });
        productoPickerLista.appendChild(btn);
      });
    }

    var envioAddressIdInput = document.getElementById('envioAddressId');
    var envioSelNombre = document.getElementById('envioSelNombre');
    var envioSelDir = document.getElementById('envioSelDir');
    var envioSelQuitar = document.getElementById('envioSelQuitar');
    var envioAbrir = document.getElementById('envioAbrirLista');

    function addressTieneDatos(addr) {
      if (!addr || typeof addr !== 'object') return false;
      return !!(addr.direccion || addr.ubigeo || addr.departamento || addr.provincia || addr.distrito || addr.urbanizacion);
    }

    function addressLinea(addr) {
      if (!addr) return '';
      if (addr.direccion) return addr.direccion;
      return [addr.distrito, addr.provincia, addr.departamento].filter(Boolean).join(', ');
    }

    function setAddressEnvio(addr, etiqueta, addressId) {
      var a = addr || {};
      var map = {
        envioUbigeo: a.ubigeo || '',
        envioDepartamento: a.departamento || '',
        envioProvincia: a.provincia || '',
        envioDistrito: a.distrito || '',
        envioUrbanizacion: a.urbanizacion || '',
        envioDireccion: a.direccion || '',
      };
      Object.keys(map).forEach(function (id) {
        var el = document.getElementById(id);
        if (el) el.value = map[id];
      });
      if (envioAddressIdInput) envioAddressIdInput.value = addressId || '';
      var pick = document.getElementById('envioAbrirLista');
      if (addressTieneDatos(a)) {
        var titulo = a.direccion || etiqueta || a.distrito || 'Dirección de envío';
        if (envioSelNombre) envioSelNombre.textContent = titulo;
        if (envioSelDir) {
          envioSelDir.textContent = [a.distrito, a.ubigeo ? ('Ubigeo ' + a.ubigeo) : ''].filter(Boolean).join(' · ') || addressLinea(a) || '—';
        }
        if (pick) {
          pick.classList.add('is-on');
          pick.classList.remove('is-empty');
        }
        if (envioSelQuitar) envioSelQuitar.hidden = false;
      } else {
        if (envioAddressIdInput) envioAddressIdInput.value = '';
        if (envioSelNombre) envioSelNombre.textContent = 'Toca para elegir ubicación';
        if (envioSelDir) envioSelDir.textContent = 'Recientes o Añadir';
        if (pick) {
          pick.classList.add('is-empty');
          pick.classList.remove('is-on');
        }
        if (envioSelQuitar) envioSelQuitar.hidden = true;
      }
    }

    function seleccionarCliente(c) {
      var id = c.id || '';
      var nombre = c.razon_social || c.razonSocial || '';
      var doc = c.numero_doc || c.numeroDoc || '';
      if (clienteIdInput) clienteIdInput.value = id;
      if (clienteInput) clienteInput.value = nombre;
      if (clienteSelNombre) clienteSelNombre.textContent = nombre;
      if (clienteSelDoc) clienteSelDoc.textContent = doc;
      if (clienteSeleccionado) clienteSeleccionado.hidden = false;
    }

    function quitarCliente() {
      if (clienteIdInput) clienteIdInput.value = '';
      if (clienteInput) clienteInput.value = '';
      if (clienteSeleccionado) clienteSeleccionado.hidden = true;
    }

    function quitarEnvio() {
      setAddressEnvio(null, null, null);
    }

    if (window.EasyUbicacion) {
      window.EasyUbicacion.bindPick({
        openBtn: 'envioAbrirLista',
        clearBtn: 'envioSelQuitar',
        pickBtn: 'envioAbrirLista',
        titleEl: 'envioSelNombre',
        detailEl: 'envioSelDir',
        title: 'Dirección de envío',
        emptyDetail: 'Recientes o Añadir',
        fields: {
          id: 'envioAddressId',
          ubigeo: 'envioUbigeo',
          departamento: 'envioDepartamento',
          provincia: 'envioProvincia',
          distrito: 'envioDistrito',
          urbanizacion: 'envioUrbanizacion',
          direccion: 'envioDireccion',
        },
        onApply: function (sel) {
          setAddressEnvio({
            ubigeo: sel.ubigeo,
            departamento: sel.departamento,
            provincia: sel.provincia,
            distrito: sel.distrito,
            urbanizacion: sel.urbanizacion,
            direccion: sel.direccion,
          }, sel.etiqueta, sel.id);
        },
        onClear: quitarEnvio,
      });
    } else if (envioAbrir) {
      envioAbrir.addEventListener('click', function () {
        window.alert('No se pudo cargar el selector de ubicación.');
      });
    }
    if (envioSelQuitar) envioSelQuitar.addEventListener('click', quitarEnvio);

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
        return norm(s.numero_serie).indexOf(nq) >= 0;
      });
    }

    function actualizarBtnSeries() {
      if (!seriePickerAgregar) return;
      var n = seriesSeleccionadas.size;
      seriePickerAgregar.disabled = n === 0;
      seriePickerAgregar.textContent = n > 0
        ? ('Agregar (' + n + ')')
        : 'Agregar seleccionadas';
    }

    function renderSeriesPicker(lista) {
      if (!seriePickerLista) return;
      seriePickerLista.innerHTML = '';
      var usadas = productoSeriePendiente
        ? seriesYaUsadas(productoSeriePendiente.id)
        : new Set();
      if (!lista.length) {
        if (seriePickerStatus) {
          seriePickerStatus.textContent = 'No hay series disponibles en este almacén';
        }
        return;
      }
      if (seriePickerStatus) {
        seriePickerStatus.textContent = lista.length + ' serie(s) disponible(s)';
      }
      lista.forEach(function (s) {
        var id = String(s.id || '');
        var num = s.numero_serie || s.numeroSerie || '—';
        var ocupada = usadas.has(id);
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'ios-sheet-item' + (seriesSeleccionadas.has(id) ? ' is-selected' : '');
        btn.disabled = ocupada;
        btn.innerHTML = '<strong>' + num + '</strong><span>' +
          (ocupada ? 'Ya agregada a la orden' : 'DISPONIBLE') + '</span>';
        btn.addEventListener('click', function () {
          if (ocupada) return;
          if (seriesSeleccionadas.has(id)) seriesSeleccionadas.delete(id);
          else seriesSeleccionadas.add(id);
          renderSeriesPicker(filtrarSeries(seriePickerBusqueda ? seriePickerBusqueda.value : ''));
          actualizarBtnSeries();
        });
        seriePickerLista.appendChild(btn);
      });
    }

    function cargarSeriesProducto(producto, almacenId) {
      if (!producto || !almacenId) return Promise.resolve();
      var url = seriesApiBase + '/' + encodeURIComponent(producto.id)
        + '/series?almacen_id=' + encodeURIComponent(almacenId);
      if (seriePickerStatus) seriePickerStatus.textContent = 'Cargando series…';
      return fetch(url, { credentials: 'same-origin', headers: { Accept: 'application/json' } })
        .then(function (res) {
          if (!res.ok) throw new Error('No se pudieron cargar las series');
          return res.json();
        })
        .then(function (data) {
          seriesDisponibles = Array.isArray(data) ? data : [];
          seriesSeleccionadas = new Set();
          renderSeriesPicker(filtrarSeries(''));
          actualizarBtnSeries();
        })
        .catch(function (err) {
          if (seriePickerStatus) {
            seriePickerStatus.textContent = err.message || 'Error al cargar series';
          }
        });
    }

    function abrirSeriePicker(producto) {
      var alm = almacenActivo();
      if (!producto || !alm) {
        window.alert('Selecciona un almacén antes de elegir series');
        return;
      }
      productoSeriePendiente = producto;
      seriesDisponibles = [];
      seriesSeleccionadas = new Set();
      if (seriePickerTitulo) {
        seriePickerTitulo.textContent = 'Serie · ' + (producto.nombre || 'Producto');
      }
      if (seriePickerBusqueda) seriePickerBusqueda.value = '';
      if (seriePicker) {
        seriePicker.hidden = false;
        seriePicker.setAttribute('aria-hidden', 'false');
        document.body.style.overflow = 'hidden';
      }
      cargarSeriesProducto(producto, alm).then(function () {
        seriePickerBusqueda && seriePickerBusqueda.focus();
      });
    }

    function cerrarSeriePicker() {
      productoSeriePendiente = null;
      seriesDisponibles = [];
      seriesSeleccionadas = new Set();
      if (seriePicker) {
        seriePicker.hidden = true;
        seriePicker.setAttribute('aria-hidden', 'true');
        document.body.style.overflow = '';
      }
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
          unidad: producto.unidad || '',
          maneja_serie: true,
          almacen_id: alm,
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
      if (!alm) {
        window.alert('Selecciona un almacén arriba');
        if (productoAlmacenSelect) productoAlmacenSelect.focus();
        return;
      }
      if (esSerie) {
        abrirSeriePicker(p);
        return;
      }
      var existente = lineas.findIndex(function (ln) {
        return ln.catalog_item_id === p.id && !ln.maneja_serie && ln.almacen_id === alm;
      });
      if (existente >= 0) {
        lineas[existente].cantidad = Number(lineas[existente].cantidad || 0) + 1;
      } else {
        lineas.push({
          catalog_item_id: p.id || '',
          nombre: p.nombre || '',
          cantidad: 1,
          precio_unitario: precio,
          unidad: p.unidad || '',
          maneja_serie: false,
          almacen_id: alm,
        });
      }
      renderLineas();
    }

    function renderLineas() {
      if (!lineasBox || !lineasHidden) return;
      lineasBox.innerHTML = '';
      lineasHidden.innerHTML = '';
      var total = 0;
      lineas.forEach(function (ln, idx) {
        var sub = (ln.precio_unitario || 0) * ln.cantidad;
        total += sub;
        var unidadLbl = etiquetaUnidad(ln.unidad);
        var row = document.createElement('div');
        row.className = 'ios-orden-linea';
        var qtyInner = ln.maneja_serie
          ? '<span class="ios-orden-linea-qty">× 1</span>'
          : '<input class="ios-orden-linea-qty-input" type="number" min="0.0001" step="any" value="' + ln.cantidad + '" data-qty />';
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
        row.innerHTML =
          '<div class="ios-orden-linea-text">' +
            '<strong>' + ln.nombre + '</strong>' +
            serieHtml +
            '<small>' + formatearSoles(ln.precio_unitario) + ' c/u · ' +
            nombreAlmacen(ln.almacen_id) + '</small>' +
          '</div>' +
          qtyHtml +
          '<button type="button" data-remove-linea aria-label="Quitar">×</button>';
        var elegirSerieBtn = row.querySelector('[data-elegir-serie]');
        if (elegirSerieBtn) {
          elegirSerieBtn.addEventListener('click', function () {
            var prod = catalogo.find(function (c) { return c.id === ln.catalog_item_id; });
            if (prod) abrirSeriePicker(prod);
          });
        }
        var qtyInput = row.querySelector('[data-qty]');
        if (qtyInput) {
          qtyInput.addEventListener('change', function () {
            var v = Number(qtyInput.value);
            if (!Number.isFinite(v) || v <= 0) {
              lineas.splice(idx, 1);
            } else {
              lineas[idx].cantidad = v;
            }
            renderLineas();
          });
        }
        row.querySelector('[data-remove-linea]').addEventListener('click', function () {
          lineas.splice(idx, 1);
          renderLineas();
        });
        lineasBox.appendChild(row);

        ['catalog_item_id', 'cantidad', 'precio_unitario', 'nombre_linea', 'almacen_id', 'producto_serie_id', 'numero_serie'].forEach(function (name) {
          var input = document.createElement('input');
          input.type = 'hidden';
          input.name = name;
          if (name === 'catalog_item_id') input.value = ln.catalog_item_id;
          else if (name === 'cantidad') input.value = String(ln.cantidad);
          else if (name === 'precio_unitario') input.value = ln.precio_unitario != null ? String(ln.precio_unitario) : '';
          else if (name === 'almacen_id') input.value = ln.almacen_id || '';
          else if (name === 'producto_serie_id') input.value = ln.producto_serie_id || '';
          else if (name === 'numero_serie') input.value = ln.numero_serie || '';
          else input.value = ln.nombre;
          lineasHidden.appendChild(input);
        });
      });
      if (ordenTotal) {
        if (!lineas.length) {
          ordenTotal.hidden = true;
          ordenTotal.innerHTML = '';
        } else {
          var totalConIgv = total;
          var subtotal = totalConIgv / 1.18;
          var igv = totalConIgv - subtotal;
          ordenTotal.hidden = false;
          ordenTotal.innerHTML =
            '<div class="ios-orden-totales-row"><span>Subtotal</span><strong>' + formatearSoles(subtotal) + '</strong></div>' +
            '<div class="ios-orden-totales-row"><span>IGV (18%)</span><strong>' + formatearSoles(igv) + '</strong></div>' +
            '<div class="ios-orden-totales-row is-total"><span>Total</span><strong>' + formatearSoles(totalConIgv) + '</strong></div>';
        }
      }
    }

    function abrirClientePicker() {
      if (!clientePicker) return;
      var q = clienteInput ? clienteInput.value : '';
      if (clientePickerBusqueda) clientePickerBusqueda.value = q;
      renderClientes(filtrarClientes(q));
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

    function abrirProductoPicker() {
      if (!productoPicker) return;
      var q = productoInput ? productoInput.value : '';
      if (productoPickerBusqueda) productoPickerBusqueda.value = q;
      renderAlmacenesToolbar();
      renderCatalogo(filtrarCatalogo(q));
      productoPicker.hidden = false;
      productoPicker.setAttribute('aria-hidden', 'false');
      document.body.style.overflow = 'hidden';
      productoPickerBusqueda && productoPickerBusqueda.focus();
    }

    function cerrarProductoPicker() {
      if (!productoPicker) return;
      productoPicker.hidden = true;
      productoPicker.setAttribute('aria-hidden', 'true');
      document.body.style.overflow = '';
    }

    clienteAbrir && clienteAbrir.addEventListener('click', abrirClientePicker);
    productoAbrir && productoAbrir.addEventListener('click', abrirProductoPicker);
    productoInput && productoInput.addEventListener('click', abrirProductoPicker);
    productoInput && productoInput.addEventListener('focus', abrirProductoPicker);
    productoPickerCerrar && productoPickerCerrar.addEventListener('click', cerrarProductoPicker);
    productoAlmacenSelect && productoAlmacenSelect.addEventListener('change', function () {
      almacenActivoId = productoAlmacenSelect.value || '';
      renderCatalogo(filtrarCatalogo(productoPickerBusqueda ? productoPickerBusqueda.value : ''));
    });
    clienteSelQuitar && clienteSelQuitar.addEventListener('click', quitarCliente);

    seriePickerCerrar && seriePickerCerrar.addEventListener('click', cerrarSeriePicker);
    seriePickerAgregar && seriePickerAgregar.addEventListener('click', confirmarSeriesSeleccionadas);
    seriePickerBusqueda && seriePickerBusqueda.addEventListener('input', function () {
      renderSeriesPicker(filtrarSeries(seriePickerBusqueda.value));
    });

    clienteInput && clienteInput.addEventListener('input', function () {
      if (clientePicker && !clientePicker.hidden) {
        renderClientes(filtrarClientes(clienteInput.value));
      }
    });
    clientePickerBusqueda && clientePickerBusqueda.addEventListener('input', function () {
      renderClientes(filtrarClientes(clientePickerBusqueda.value));
    });
    productoInput && productoInput.addEventListener('input', function () {
      if (productoPicker && !productoPicker.hidden) {
        renderCatalogo(filtrarCatalogo(productoInput.value));
      }
    });
    productoPickerBusqueda && productoPickerBusqueda.addEventListener('input', function () {
      renderCatalogo(filtrarCatalogo(productoPickerBusqueda.value));
    });

    clientePicker && clientePicker.addEventListener('click', function (e) {
      if (e.target === clientePicker) cerrarClientePicker();
    });
    seriePicker && seriePicker.addEventListener('click', function (e) {
      if (e.target === seriePicker) cerrarSeriePicker();
    });
    productoPicker && productoPicker.addEventListener('click', function (e) {
      if (e.target === productoPicker) cerrarProductoPicker();
    });

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
        almacen_id: serie.almacen_id || almacenActivo(),
        producto_serie_id: serieId,
        numero_serie: numero,
      });
      renderLineas();
      return 'Agregado: ' + (item.nombre || 'Producto') + ' · ' + numero;
    }

    function tomarBusqueda(codigo, input) {
      if (!codigo || !window.EasyBarcodeSerie) return;
      window.EasyBarcodeSerie.consultar({
        codigo: codigo,
        uso: 'orden',
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
        var nq = norm(codigo);
        var exactos = catalogo.filter(function (p) {
          return norm(p.codigo) === nq || norm(p.nombre) === nq;
        });
        var prod = exactos.length === 1 ? exactos[0] : null;
        if (!prod) {
          var lista = filtrarCatalogo(codigo);
          prod = lista.length === 1 ? lista[0] : null;
        }
        if (!prod) {
          if (productoPickerStatus) productoPickerStatus.textContent = 'Sin resultados para «' + codigo + '»';
          return;
        }
        if (input) input.value = '';
        agregarLinea(prod);
      });
    }

    if (window.EasyBarcodeSerie) {
      window.EasyBarcodeSerie.alEnter(productoPickerBusqueda, tomarBusqueda);
      window.EasyBarcodeSerie.alEnter(productoInput, tomarBusqueda);
    }

    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      if (clientePicker && !clientePicker.hidden) cerrarClientePicker();
      else if (seriePicker && !seriePicker.hidden) cerrarSeriePicker();
      else if (document.getElementById('easyUbicPicker') && !document.getElementById('easyUbicPicker').hidden && window.EasyUbicacion) window.EasyUbicacion.close();
      else if (productoPicker && !productoPicker.hidden) cerrarProductoPicker();
    });

    root.addEventListener('submit', function (e) {
      if (!clienteIdInput || !clienteIdInput.value) {
        e.preventDefault();
        window.alert('Selecciona un cliente');
        return;
      }
      if (!lineas.length) {
        e.preventDefault();
        window.alert('Agrega al menos un producto');
        return;
      }
      var sinAlm = lineas.some(function (ln) { return !ln.almacen_id; });
      if (sinAlm) {
        e.preventDefault();
        window.alert('Cada línea debe tener un almacén');
        return;
      }
      var sinSerie = lineas.some(function (ln) {
        return ln.maneja_serie && !ln.producto_serie_id;
      });
      if (sinSerie) {
        e.preventDefault();
        window.alert('Hay productos con serie sin número seleccionado');
        return;
      }
      if (typeof window.showEmitLoading === 'function') {
        var creando = !(root.getAttribute('action') || '').match(/\/ordenes\/[^/]+$/);
        window.showEmitLoading(
          creando ? 'Creando orden…' : 'Guardando orden…',
          'Espera un momento, no cierres esta ventana.',
        );
      }
    });

    renderAlmacenesToolbar();

    // Precarga en modo edición
    var clienteInicial = root.dataset.clienteInicial || '';
    if (clienteInicial) {
      var cli = clientes.find(function (c) { return String(c.id) === String(clienteInicial); });
      if (cli) seleccionarCliente(cli);
    }
    var envioDir = document.getElementById('envioDireccion');
    var envioInicialId = root.dataset.envioInicialId || '';
    if (envioDir && String(envioDir.value || '').trim()) {
      setAddressEnvio({
        ubigeo: document.getElementById('envioUbigeo')?.value || '',
        departamento: document.getElementById('envioDepartamento')?.value || '',
        provincia: document.getElementById('envioProvincia')?.value || '',
        distrito: document.getElementById('envioDistrito')?.value || '',
        urbanizacion: document.getElementById('envioUrbanizacion')?.value || '',
        direccion: envioDir.value || '',
      }, document.getElementById('envioDistrito')?.value || 'Dirección guardada', envioInicialId);
    }
    try {
      var lineasIniciales = JSON.parse(document.getElementById('ordenes-lineas-data')?.textContent || '[]');
      if (Array.isArray(lineasIniciales) && lineasIniciales.length) {
        lineas = lineasIniciales.map(function (ln) {
          return {
            catalog_item_id: ln.catalog_item_id || '',
            nombre: ln.nombre_linea || ln.nombre || '',
            cantidad: Number(ln.cantidad || 1),
            precio_unitario: ln.precio_unitario != null ? Number(ln.precio_unitario) : null,
            unidad: ln.unidad || '',
            almacen_id: ln.almacen_id || defaultAlmacenId || '',
            maneja_serie: ln.maneja_serie === true || Boolean(ln.producto_serie_id),
            producto_serie_id: ln.producto_serie_id || '',
            numero_serie: ln.numero_serie || '',
          };
        });
        renderLineas();
      }
    } catch (_e2) { /* ignore */ }
  }

  document.addEventListener('DOMContentLoaded', function () {
    initOrdenForm(document.getElementById('orden-form'));
  });
})();
