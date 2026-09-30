/**
 * Líneas de productos estilo emitir/órdenes (picker + stock + series).
 * Uso: EasyLineasProductos.init({ form, ... })
 */
(function (global) {
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

  function init(options) {
    options = options || {};
    var form = options.form;
    if (!form) return null;

    var catalogo = Array.isArray(options.catalogo) ? options.catalogo.slice() : [];
    var almacenes = Array.isArray(options.almacenes) ? options.almacenes : [];
    var lineas = Array.isArray(options.lineasIniciales) ? options.lineasIniciales.slice() : [];
    var stockApi = options.stockApi || form.getAttribute('data-stock-api') || '/app/emitir/catalogo-stock';
    var seriesApiBase = options.seriesApi || form.getAttribute('data-series-api') || '/app/ordenes/catalogo';
    var lockAlmacen = options.lockAlmacen === true;
    var showPrices = options.showPrices !== false;
    var showTotals = options.showTotals === true;
    /** 'salida' (elige series existentes) | 'ingreso' (serie nueva / sin stock) */
    var mode = String(options.mode || 'salida').toLowerCase() === 'ingreso' ? 'ingreso' : 'salida';
    var isIngreso = mode === 'ingreso';
    var fields = Object.assign({
      catalog_item_id: 'catalog_item_id',
      cantidad: 'cantidad',
      unidad: null,
      precio: null,
      almacen_id: null,
      producto_serie_id: 'producto_serie_id',
      numero_serie: 'numero_serie',
      descripcion: null,
    }, options.fields || {});

    var defaultAlmacenId = options.defaultAlmacenId
      || form.getAttribute('data-almacen-default')
      || (almacenes[0] && almacenes[0].id)
      || '';
    var almacenActivoId = defaultAlmacenId;
    var stockLoadedFor = '';
    var stockLoading = null;

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

    var seriePicker = document.getElementById('seriePicker');
    var seriePickerBusqueda = document.getElementById('seriePickerBusqueda');
    var seriePickerLista = document.getElementById('seriePickerLista');
    var seriePickerStatus = document.getElementById('seriePickerStatus');
    var seriePickerCerrar = document.getElementById('seriePickerCerrar');
    var seriePickerTitulo = document.getElementById('seriePickerTitulo');
    var seriePickerAgregar = document.getElementById('seriePickerAgregar');

    var escaneoMasivo = document.getElementById('escaneoMasivoSheet');
    var escaneoMasivoTitulo = document.getElementById('escaneoMasivoTitulo');
    var escaneoMasivoSub = document.getElementById('escaneoMasivoSub');
    var escaneoMasivoInput = document.getElementById('escaneoMasivoInput');
    var escaneoMasivoStatus = document.getElementById('escaneoMasivoStatus');
    var escaneoMasivoLista = document.getElementById('escaneoMasivoLista');
    var escaneoMasivoCerrar = document.getElementById('escaneoMasivoCerrar');
    var escaneoMasivoAgregar = document.getElementById('escaneoMasivoAgregar');
    var escaneoMasivoLimpiar = document.getElementById('escaneoMasivoLimpiar');
    var escaneoMasivoConfirmar = document.getElementById('escaneoMasivoConfirmar');

    var productoSeriePendiente = null;
    var seriesDisponibles = [];
    var seriesSeleccionadas = new Set();
    var escaneoProducto = null;
    var escaneoSeries = [];

    function resolveAlmacenId() {
      if (typeof options.getAlmacenId === 'function') {
        var fromCb = options.getAlmacenId();
        if (fromCb) return String(fromCb);
      }
      if (productoAlmacenSelect && productoAlmacenSelect.value) {
        return String(productoAlmacenSelect.value);
      }
      return String(almacenActivoId || defaultAlmacenId || '');
    }

    function nombreAlmacen(id) {
      if (!id) return 'Almacén';
      var a = almacenes.find(function (x) { return String(x.id) === String(id); });
      return a ? a.nombre : 'Almacén';
    }

    function actualizarLabelAlmacen() {
      if (!productoAlmacenSelect) return;
      var id = resolveAlmacenId();
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
      if (lockAlmacen || !almacenes.length) {
        productoAlmacenSelect.disabled = true;
        productoAlmacenSelect.hidden = lockAlmacen;
        if (!almacenes.length) {
          var empty = document.createElement('option');
          empty.value = '';
          empty.textContent = 'Sin almacenes';
          productoAlmacenSelect.appendChild(empty);
        } else if (lockAlmacen) {
          var locked = almacenes.find(function (a) { return String(a.id) === current; }) || almacenes[0];
          var opt = document.createElement('option');
          opt.value = locked.id;
          opt.textContent = locked.nombre || locked.codigo || 'Almacén';
          opt.selected = true;
          productoAlmacenSelect.appendChild(opt);
          almacenActivoId = locked.id;
        }
        actualizarLabelAlmacen();
        return;
      }
      productoAlmacenSelect.hidden = false;
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
      var alm = resolveAlmacenId();
      if (productoPickerStatus) {
        if (isIngreso) {
          productoPickerStatus.textContent = lista.length + ' producto(s) · referenciar para ingresar';
        } else {
          productoPickerStatus.textContent = lista.length + ' producto(s) · ' + nombreAlmacen(alm);
        }
      }
      lista.forEach(function (p) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'ios-sheet-item';
        var precio = showPrices && p.precio_unitario != null ? formatearSoles(p.precio_unitario) : '';
        var metaBits = [];
        if (p.codigo) metaBits.push(p.codigo);
        if (precio) metaBits.push(precio);
        if (isIngreso) {
          if (p.maneja_serie === true) metaBits.push('Con serie');
          else metaBits.push('Cantidad');
        } else if (controlaStock(p)) {
          var disponible = stockDisponiblePara(p.id, alm, null);
          metaBits.push('Stock ' + (disponible != null ? disponible : stockDe(p)));
          if (disponible != null && disponible <= 0) {
            btn.className += ' is-disabled';
            btn.disabled = true;
          }
        }
        var meta = metaBits.join(' · ');
        btn.innerHTML = '<strong>' + (p.nombre || 'Ítem') + '</strong><span>' + meta + '</span>';
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
      var alm = resolveAlmacenId();
      if (!alm) {
        window.alert(isIngreso ? 'Selecciona primero el almacén de destino.' : 'Selecciona primero el almacén de origen.');
        return;
      }
      almacenActivoId = alm;
      var q = productoInput ? productoInput.value : '';
      if (productoPickerBusqueda) productoPickerBusqueda.value = q;
      renderAlmacenesToolbar();
      productoPicker.hidden = false;
      productoPicker.setAttribute('aria-hidden', 'false');
      document.body.style.overflow = 'hidden';
      document.body.classList.add('ios-sheet-open');
      if (isIngreso) {
        renderCatalogo(filtrarCatalogo(q));
        productoPickerBusqueda && productoPickerBusqueda.focus();
        return;
      }
      cargarStockAlmacen(alm).then(function () {
        renderCatalogo(filtrarCatalogo(q));
        productoPickerBusqueda && productoPickerBusqueda.focus();
      });
    }

    function cerrarProductoPicker() {
      if (!productoPicker) return;
      productoPicker.hidden = true;
      productoPicker.setAttribute('aria-hidden', 'true');
      document.body.style.overflow = '';
      document.body.classList.remove('ios-sheet-open');
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
      if (!(productoPicker && !productoPicker.hidden)) {
        document.body.classList.remove('ios-sheet-open');
      }
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
      document.body.classList.add('ios-sheet-open');

      var alm = resolveAlmacenId();
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
      var alm = resolveAlmacenId();
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
      var alm = resolveAlmacenId();
      if (!alm) {
        window.alert(isIngreso ? 'Selecciona el almacén de destino' : 'Selecciona un almacén de origen');
        return;
      }
      if (esSerie) {
        if (isIngreso) {
          cerrarProductoPicker();
          abrirEscaneoMasivo(p);
          return;
        }
        var dispSerie = stockDisponiblePara(p.id, alm, null);
        if (dispSerie != null && dispSerie <= 0) {
          window.alert('"' + (p.nombre || 'Producto') + '" no tiene series disponibles en este almacén.');
          return;
        }
        abrirSeriePicker(p);
        return;
      }
      if (!isIngreso && controlaStock(p)) {
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
        if (!isIngreso) {
          var max = stockDisponiblePara(p.id, alm, existente);
          if (max != null && nuevaCant > max) {
            window.alert('Solo hay ' + max + ' disponible(s) de "' + (p.nombre || 'Producto') + '".');
            return;
          }
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

    function seriesIngresoDeProducto(catalogItemId) {
      return lineas
        .filter(function (ln) {
          return String(ln.catalog_item_id) === String(catalogItemId) && ln.maneja_serie;
        })
        .map(function (ln) { return String(ln.numero_serie || '').trim(); })
        .filter(Boolean);
    }

    function renderEscaneoLista() {
      if (!escaneoMasivoLista) return;
      escaneoMasivoLista.innerHTML = '';
      escaneoSeries.forEach(function (num, idx) {
        var row = document.createElement('div');
        row.className = 'ios-scan-serie-row';
        row.innerHTML =
          '<span class="ios-scan-serie-num">' + num + '</span>' +
          '<button type="button" class="ios-scan-serie-remove" aria-label="Quitar">×</button>';
        row.querySelector('button').addEventListener('click', function () {
          escaneoSeries.splice(idx, 1);
          renderEscaneoLista();
        });
        escaneoMasivoLista.appendChild(row);
      });
      if (escaneoMasivoStatus) {
        escaneoMasivoStatus.textContent = escaneoSeries.length
          ? (escaneoSeries.length + ' serie(s) listas')
          : 'Escanea con pistola (Enter) o pega un lote';
      }
      if (escaneoMasivoConfirmar) {
        escaneoMasivoConfirmar.disabled = escaneoSeries.length === 0;
        escaneoMasivoConfirmar.textContent = escaneoSeries.length
          ? ('Confirmar ' + escaneoSeries.length + ' serie(s)')
          : 'Confirmar series';
      }
    }

    function agregarSeriesDesdeTexto(raw) {
      var existentes = {};
      escaneoSeries.forEach(function (s) { existentes[String(s).toLowerCase()] = true; });
      String(raw || '')
        .split(/[\n\r,;\t ]+/)
        .map(function (s) { return String(s || '').trim(); })
        .filter(Boolean)
        .forEach(function (num) {
          var key = num.toLowerCase();
          if (existentes[key]) return;
          existentes[key] = true;
          escaneoSeries.push(num);
        });
      renderEscaneoLista();
    }

    function abrirEscaneoMasivo(producto) {
      if (!escaneoMasivo || !producto) {
        var numSerie = window.prompt('Número de serie de "' + (producto && producto.nombre || 'producto') + '":');
        if (numSerie == null) return;
        numSerie = String(numSerie).trim();
        if (!numSerie) return;
        var almFb = resolveAlmacenId();
        lineas.push({
          catalog_item_id: producto.id || '',
          nombre: producto.nombre || '',
          cantidad: 1,
          precio_unitario: producto.precio_unitario != null ? Number(producto.precio_unitario) : null,
          unidad: producto.unidad || 'NIU',
          maneja_serie: true,
          maneja_stock: controlaStock(producto),
          almacen_id: almFb,
          numero_serie: numSerie,
          producto_serie_id: '',
        });
        renderLineas();
        return;
      }
      escaneoProducto = producto;
      escaneoSeries = seriesIngresoDeProducto(producto.id);
      if (escaneoMasivoTitulo) escaneoMasivoTitulo.textContent = 'Escaneo masivo';
      if (escaneoMasivoSub) escaneoMasivoSub.textContent = producto.nombre || 'Producto';
      if (escaneoMasivoInput) escaneoMasivoInput.value = '';
      renderEscaneoLista();
      escaneoMasivo.hidden = false;
      escaneoMasivo.setAttribute('aria-hidden', 'false');
      document.body.style.overflow = 'hidden';
      document.body.classList.add('ios-sheet-open');
      setTimeout(function () {
        escaneoMasivoInput && escaneoMasivoInput.focus();
      }, 50);
    }

    function cerrarEscaneoMasivo() {
      if (!escaneoMasivo) return;
      escaneoMasivo.hidden = true;
      escaneoMasivo.setAttribute('aria-hidden', 'true');
      escaneoProducto = null;
      escaneoSeries = [];
      if (!productoPicker || productoPicker.hidden) {
        document.body.style.overflow = '';
        document.body.classList.remove('ios-sheet-open');
      }
    }

    function confirmarEscaneoMasivo() {
      if (!escaneoProducto || !escaneoSeries.length) return;
      var alm = resolveAlmacenId();
      var catalogId = escaneoProducto.id;
      var precio = escaneoProducto.precio_unitario != null ? Number(escaneoProducto.precio_unitario) : null;
      lineas = lineas.filter(function (ln) {
        return !(String(ln.catalog_item_id) === String(catalogId) && ln.maneja_serie);
      });
      escaneoSeries.forEach(function (num) {
        lineas.push({
          catalog_item_id: catalogId || '',
          nombre: escaneoProducto.nombre || '',
          cantidad: 1,
          precio_unitario: precio,
          unidad: escaneoProducto.unidad || 'NIU',
          maneja_serie: true,
          maneja_stock: controlaStock(escaneoProducto),
          almacen_id: alm,
          numero_serie: num,
          producto_serie_id: '',
        });
      });
      renderLineas();
      cerrarEscaneoMasivo();
    }

    function addHidden(name, value) {
      if (!name || !lineasHidden) return;
      var input = document.createElement('input');
      input.type = 'hidden';
      input.name = name;
      input.value = value == null ? '' : String(value);
      lineasHidden.appendChild(input);
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
            (!isIngreso && maxStock != null ? (' max="' + maxStock + '"') : '') + ' data-qty />';
        var qtyHtml = '<div class="ios-orden-linea-qty-wrap">' + qtyInner +
          '<span class="ios-orden-linea-unidad">' + unidadLbl + '</span></div>';
        var serieHtml = '';
        if (ln.maneja_serie) {
          if (ln.numero_serie) {
            serieHtml = '<small class="ios-orden-linea-serie">Serie: ' + ln.numero_serie + '</small>';
          } else if (isIngreso) {
            serieHtml = '<button type="button" class="ios-orden-linea-serie-btn" data-ingresar-serie>Ingresar serie</button>';
          } else {
            serieHtml = '<button type="button" class="ios-orden-linea-serie-btn" data-elegir-serie>Elegir serie</button>';
          }
        }
        var stockHint = '';
        if (!isIngreso && dispStock != null) {
          stockHint = ' · Disp. ' + dispStock;
        }
        var detailParts = [];
        if (showPrices) detailParts.push(formatearSoles(ln.precio_unitario) + ' c/u');
        if (ln.almacen_id && !lockAlmacen) detailParts.push(nombreAlmacen(ln.almacen_id));
        if (stockHint) detailParts.push(stockHint.replace(/^ · /, ''));
        if (isIngreso && ln.maneja_serie) detailParts.push('Producto serializado');
        var moreBtn = (isIngreso && ln.maneja_serie)
          ? '<button type="button" class="ios-orden-linea-more" data-series-masivas title="Ingreso masivo de series" aria-label="Series masivas">⋯</button>'
          : '';
        row.innerHTML =
          '<div class="ios-orden-linea-text">' +
            '<strong>' + (ln.nombre || 'Ítem') + '</strong>' +
            serieHtml +
            (detailParts.length ? ('<small>' + detailParts.join(' · ') + '</small>') : '') +
          '</div>' +
          qtyHtml +
          moreBtn +
          '<button type="button" data-remove-linea aria-label="Quitar">×</button>';

        var elegirSerieBtn = row.querySelector('[data-elegir-serie]');
        if (elegirSerieBtn) {
          elegirSerieBtn.addEventListener('click', function () {
            if (prod) abrirSeriePicker(prod);
          });
        }
        var ingresarSerieBtn = row.querySelector('[data-ingresar-serie]');
        if (ingresarSerieBtn) {
          ingresarSerieBtn.addEventListener('click', function () {
            if (prod) abrirEscaneoMasivo(prod);
          });
        }
        var masivasBtn = row.querySelector('[data-series-masivas]');
        if (masivasBtn) {
          masivasBtn.addEventListener('click', function () {
            if (prod) abrirEscaneoMasivo(prod);
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
            if (!isIngreso) {
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

        addHidden(fields.catalog_item_id, ln.catalog_item_id || '');
        addHidden(fields.cantidad, ln.cantidad);
        addHidden(fields.unidad, ln.unidad || 'NIU');
        addHidden(fields.precio, ln.precio_unitario != null ? ln.precio_unitario : '');
        addHidden(fields.almacen_id, ln.almacen_id || '');
        addHidden(fields.producto_serie_id, ln.producto_serie_id || '');
        addHidden(fields.numero_serie, ln.numero_serie || '');
        addHidden(fields.descripcion, ln.nombre || '');
      });

      if (ordenTotal) {
        if (!showTotals || !lineas.length) {
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

    function validate() {
      if (!lineas.length) {
        window.alert('Agrega al menos un producto.');
        return false;
      }
      var sinSerie = lineas.find(function (ln) {
        if (!ln.maneja_serie) return false;
        if (isIngreso) return !ln.numero_serie;
        return !ln.producto_serie_id && !ln.numero_serie;
      });
      if (sinSerie) {
        window.alert(
          (isIngreso ? 'Indica la serie de: ' : 'Elige la serie de: ')
            + (sinSerie.nombre || 'producto'),
        );
        return false;
      }
      if (!isIngreso) {
        for (var i = 0; i < lineas.length; i += 1) {
          var ln = lineas[i];
          var max = stockDisponiblePara(ln.catalog_item_id, ln.almacen_id, i);
          if (max != null && Number(ln.cantidad) > max) {
            window.alert('"' + (ln.nombre || 'Producto') + '" solo tiene ' + max + ' disponible(s).');
            return false;
          }
        }
      }
      return true;
    }

    function clearLineas() {
      lineas = [];
      stockLoadedFor = '';
      renderLineas();
    }

    function syncAlmacenFromForm() {
      var alm = resolveAlmacenId();
      if (alm && String(almacenActivoId) !== String(alm)) {
        almacenActivoId = alm;
        stockLoadedFor = '';
        clearLineas();
      }
      actualizarLabelAlmacen();
    }

    productoAbrir && productoAbrir.addEventListener('click', abrirProductoPicker);
    productoInput && productoInput.addEventListener('click', abrirProductoPicker);
    productoInput && productoInput.addEventListener('focus', function () {
      abrirProductoPicker();
    });
    productoPickerCerrar && productoPickerCerrar.addEventListener('click', cerrarProductoPicker);
    productoAlmacenSelect && productoAlmacenSelect.addEventListener('change', function () {
      if (lockAlmacen) return;
      almacenActivoId = productoAlmacenSelect.value || '';
      cargarStockAlmacen(almacenActivoId, true).then(function () {
        renderCatalogo(filtrarCatalogo(productoPickerBusqueda ? productoPickerBusqueda.value : ''));
        renderLineas();
      });
    });
    productoPickerBusqueda && productoPickerBusqueda.addEventListener('input', function () {
      renderCatalogo(filtrarCatalogo(productoPickerBusqueda.value));
    });

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
          if (productoPickerStatus) {
            productoPickerStatus.textContent = 'Sin resultados para «' + codigo + '»';
          }
          return;
        }
        if (input) input.value = '';
        if (productoInput && productoInput !== input) productoInput.value = '';
        if (productoPickerBusqueda && productoPickerBusqueda !== input) productoPickerBusqueda.value = '';
        agregarLinea(prod);
      }
      if (isIngreso || !window.EasyBarcodeSerie) {
        usarProducto();
        return;
      }
      window.EasyBarcodeSerie.consultar({
        codigo: codigo,
        uso: 'salida',
        almacenId: resolveAlmacenId(),
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
      if (!isIngreso && document.getElementById('barcodeSerieBtn')) {
        window.EasyBarcodeSerie.mount({
          uso: 'salida',
          button: document.getElementById('barcodeSerieBtn'),
          getAlmacenId: resolveAlmacenId,
          onFound: function (data) {
            return agregarSerieEscaneada(data);
          },
        });
      }
    }
    if (productoInput) {
      productoInput.addEventListener('input', function () {
        if (!productoPicker || productoPicker.hidden) return;
        if (productoPickerBusqueda) productoPickerBusqueda.value = productoInput.value;
        renderCatalogo(filtrarCatalogo(productoInput.value));
      });
    }
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

    if (escaneoMasivo) {
      escaneoMasivoCerrar && escaneoMasivoCerrar.addEventListener('click', cerrarEscaneoMasivo);
      escaneoMasivoConfirmar && escaneoMasivoConfirmar.addEventListener('click', confirmarEscaneoMasivo);
      escaneoMasivoLimpiar && escaneoMasivoLimpiar.addEventListener('click', function () {
        escaneoSeries = [];
        renderEscaneoLista();
        escaneoMasivoInput && escaneoMasivoInput.focus();
      });
      escaneoMasivoAgregar && escaneoMasivoAgregar.addEventListener('click', function () {
        agregarSeriesDesdeTexto(escaneoMasivoInput ? escaneoMasivoInput.value : '');
        if (escaneoMasivoInput) escaneoMasivoInput.value = '';
        escaneoMasivoInput && escaneoMasivoInput.focus();
      });
      escaneoMasivo && escaneoMasivo.addEventListener('click', function (e) {
        if (e.target === escaneoMasivo) cerrarEscaneoMasivo();
      });
      if (escaneoMasivoInput) {
        escaneoMasivoInput.addEventListener('keydown', function (e) {
          if (e.key === 'Enter') {
            e.preventDefault();
            agregarSeriesDesdeTexto(escaneoMasivoInput.value);
            escaneoMasivoInput.value = '';
          }
        });
        escaneoMasivoInput.addEventListener('input', function () {
          var v = escaneoMasivoInput.value || '';
          if (v.indexOf('\n') >= 0 || v.indexOf('\r') >= 0) {
            agregarSeriesDesdeTexto(v);
            escaneoMasivoInput.value = '';
          }
        });
        escaneoMasivoInput.addEventListener('paste', function () {
          setTimeout(function () {
            var v = escaneoMasivoInput.value || '';
            if (v.indexOf('\n') >= 0 || v.indexOf(',') >= 0 || v.indexOf('\t') >= 0 || v.indexOf(';') >= 0) {
              agregarSeriesDesdeTexto(v);
              escaneoMasivoInput.value = '';
            }
          }, 0);
        });
      }
    }

    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      if (escaneoMasivo && !escaneoMasivo.hidden) cerrarEscaneoMasivo();
      else if (seriePicker && !seriePicker.hidden) cerrarSeriePicker();
      else if (productoPicker && !productoPicker.hidden) cerrarProductoPicker();
    });

    if (options.validateOnSubmit !== false) {
      form.addEventListener('submit', function (e) {
        if (!validate()) e.preventDefault();
      });
    }

    lineas = lineas.map(function (ln) {
      var cat = productoPorId(ln.catalog_item_id);
      return Object.assign({}, ln, {
        nombre: ln.nombre || (cat && cat.nombre) || 'Ítem',
        unidad: ln.unidad || (cat && cat.unidad) || 'NIU',
        almacen_id: ln.almacen_id || resolveAlmacenId(),
        maneja_serie: ln.maneja_serie === true || (cat && cat.maneja_serie === true && !!(ln.producto_serie_id || ln.numero_serie)),
        maneja_stock: ln.maneja_stock === true || (cat && controlaStock(cat)),
        precio_unitario: ln.precio_unitario != null
          ? ln.precio_unitario
          : (cat && cat.precio_unitario != null ? Number(cat.precio_unitario) : null),
      });
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
        maneja_stock: true,
        almacen_id: serie.almacen_id || resolveAlmacenId(),
        producto_serie_id: serieId,
        numero_serie: numero,
      });
      renderLineas();
      return 'Agregado: ' + (item.nombre || 'Producto') + ' · ' + numero;
    }

    actualizarLabelAlmacen();
    renderLineas();

    var almInicial = resolveAlmacenId();
    if (almInicial && !isIngreso) {
      cargarStockAlmacen(almInicial).then(function () {
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
    }

    return {
      validate: validate,
      clearLineas: clearLineas,
      syncAlmacenFromForm: syncAlmacenFromForm,
      getLineas: function () { return lineas.slice(); },
      renderLineas: renderLineas,
    };
  }

  global.EasyLineasProductos = { init: init };
})(window);
