/**
 * Modal compartido de ubicación (región → provincia → distrito + dirección).
 * Registra en addresses y muestra recientes en el mismo menú.
 *
 * EasyUbicacion.open({ title, initial, persist, onSelect })
 * EasyUbicacion.bindPick({ openBtn, clearBtn, pickBtn, titleEl, detailEl, fields, title })
 */
(function (global) {
  'use strict';

  var root = null;
  var onSelectCb = null;
  var persist = true;
  var editandoId = null;
  var items = [];
  var offset = 0;
  var hasMore = false;
  var total = 0;
  var query = '';
  var cargando = false;
  var searchTimer = null;
  var regionesCache = null;
  var wired = false;

  function $(id) {
    return document.getElementById(id);
  }

  function appBase() {
    if (!root) return '/app';
    return root.getAttribute('data-app-base') || '/app';
  }

  function ubigeoApi() {
    return (root && root.getAttribute('data-ubigeo-api')) || (appBase() + '/ubigeo');
  }

  function ubicApi() {
    return (root && root.getAttribute('data-ubicaciones-api')) || (appBase() + '/ubicaciones');
  }

  function ensureRoot() {
    if (root) return root;
    root = $('easyUbicPicker');
    if (root) wireOnce();
    return root;
  }

  function fetchJson(url, opts) {
    return fetch(url, Object.assign({
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    }, opts || {})).then(function (res) {
      return res.json().then(function (data) {
        if (!res.ok) throw new Error((data && data.message) || 'Error de red');
        return data;
      });
    });
  }

  function showLista(on) {
    var listaWrap = $('easyUbicListaWrap');
    var formWrap = $('easyUbicFormWrap');
    var nueva = $('easyUbicNueva');
    if (listaWrap) listaWrap.hidden = !on;
    if (formWrap) formWrap.hidden = on;
    if (nueva) nueva.hidden = !on;
  }

  function setUbigeoHint(code) {
    var hint = $('easyUbicUbigeoHint');
    var hid = $('easyUbicUbigeo');
    if (hid) hid.value = code || '';
    if (hint) hint.textContent = 'Ubigeo: ' + (code || '—');
  }

  function fillSelect(sel, rows, placeholder, valueKey, labelKey) {
    if (!sel) return;
    var prev = sel.value;
    sel.innerHTML = '';
    var opt0 = document.createElement('option');
    opt0.value = '';
    opt0.textContent = placeholder || 'Selecciona…';
    sel.appendChild(opt0);
    (rows || []).forEach(function (row) {
      var o = document.createElement('option');
      o.value = row[valueKey || 'codigo'] || '';
      o.textContent = row[labelKey || 'nombre'] || o.value;
      sel.appendChild(o);
    });
    if (prev && Array.prototype.some.call(sel.options, function (o) { return o.value === prev; })) {
      sel.value = prev;
    }
  }

  function loadRegiones() {
    if (regionesCache) {
      fillSelect($('easyUbicRegion'), regionesCache, 'Selecciona…');
      return Promise.resolve(regionesCache);
    }
    return fetchJson(ubigeoApi() + '/regiones').then(function (data) {
      regionesCache = data.items || [];
      fillSelect($('easyUbicRegion'), regionesCache, 'Selecciona…');
      return regionesCache;
    });
  }

  function loadProvincias(regionCodigo) {
    var sel = $('easyUbicProvincia');
    var dist = $('easyUbicDistrito');
    if (!regionCodigo) {
      fillSelect(sel, [], 'Selecciona región…');
      if (sel) sel.disabled = true;
      fillSelect(dist, [], 'Selecciona provincia…');
      if (dist) dist.disabled = true;
      setUbigeoHint('');
      return Promise.resolve([]);
    }
    if (sel) sel.disabled = true;
    return fetchJson(ubigeoApi() + '/regiones/' + encodeURIComponent(regionCodigo) + '/provincias')
      .then(function (data) {
        var rows = data.items || [];
        fillSelect(sel, rows, 'Selecciona…');
        if (sel) sel.disabled = false;
        fillSelect(dist, [], 'Selecciona provincia…');
        if (dist) dist.disabled = true;
        setUbigeoHint('');
        return rows;
      });
  }

  function loadDistritos(provinciaCodigo) {
    var dist = $('easyUbicDistrito');
    if (!provinciaCodigo) {
      fillSelect(dist, [], 'Selecciona provincia…');
      if (dist) dist.disabled = true;
      setUbigeoHint('');
      return Promise.resolve([]);
    }
    if (dist) dist.disabled = true;
    return fetchJson(ubigeoApi() + '/provincias/' + encodeURIComponent(provinciaCodigo) + '/distritos')
      .then(function (data) {
        var rows = data.items || [];
        fillSelect(dist, rows, 'Selecciona…', 'codigo', 'nombre');
        if (dist) dist.disabled = false;
        setUbigeoHint('');
        return rows;
      });
  }

  function onDistritoChange() {
    var dist = $('easyUbicDistrito');
    setUbigeoHint(dist && dist.value ? dist.value : '');
  }

  function limpiarForm() {
    editandoId = null;
    ['easyUbicEtiqueta', 'easyUbicDireccion', 'easyUbicUrbanizacion'].forEach(function (id) {
      var node = $(id);
      if (node) node.value = '';
    });
    setUbigeoHint('');
    var reg = $('easyUbicRegion');
    if (reg) reg.value = '';
    fillSelect($('easyUbicProvincia'), [], 'Selecciona región…');
    var prov = $('easyUbicProvincia');
    if (prov) prov.disabled = true;
    fillSelect($('easyUbicDistrito'), [], 'Selecciona provincia…');
    var dist = $('easyUbicDistrito');
    if (dist) dist.disabled = true;
  }

  function prefillFromUbigeo(ubigeo, extra) {
    extra = extra || {};
    var code = String(ubigeo || '').replace(/\D/g, '');
    if (code.length !== 6) {
      if (extra.direccion && $('easyUbicDireccion')) $('easyUbicDireccion').value = extra.direccion;
      if (extra.urbanizacion && $('easyUbicUrbanizacion')) $('easyUbicUrbanizacion').value = extra.urbanizacion;
      if (extra.etiqueta && $('easyUbicEtiqueta')) $('easyUbicEtiqueta').value = extra.etiqueta;
      return Promise.resolve();
    }
    var region = code.slice(0, 2);
    var provincia = code.slice(0, 4);
    return loadRegiones()
      .then(function () {
        var reg = $('easyUbicRegion');
        if (reg) reg.value = region;
        return loadProvincias(region);
      })
      .then(function () {
        var prov = $('easyUbicProvincia');
        if (prov) prov.value = provincia;
        return loadDistritos(provincia);
      })
      .then(function () {
        var dist = $('easyUbicDistrito');
        if (dist) dist.value = code;
        setUbigeoHint(code);
        if (extra.direccion && $('easyUbicDireccion')) $('easyUbicDireccion').value = extra.direccion;
        if (extra.urbanizacion && $('easyUbicUrbanizacion')) $('easyUbicUrbanizacion').value = extra.urbanizacion || '';
        if (extra.etiqueta && $('easyUbicEtiqueta')) $('easyUbicEtiqueta').value = extra.etiqueta || '';
      })
      .catch(function () { /* ignore */ });
  }

  function syncMas() {
    var mas = $('easyUbicMas');
    if (!mas) return;
    mas.hidden = !hasMore;
    mas.disabled = cargando;
    mas.textContent = cargando ? 'Cargando…' : 'Ver más';
  }

  function emitSelect(payload) {
    var cb = onSelectCb;
    close();
    if (typeof cb === 'function') cb(payload);
  }

  function aplicarItem(item) {
    var addr = (item && item.address) || {};
    var payload = {
      id: item.id || null,
      etiqueta: item.etiqueta || '',
      ubigeo: addr.ubigeo || '',
      departamento: addr.departamento || '',
      provincia: addr.provincia || '',
      distrito: addr.distrito || '',
      urbanizacion: addr.urbanizacion || '',
      direccion: addr.direccion || '',
      address: addr,
    };
    // Aplicar de inmediato; /tocar solo actualiza el orden de recientes en background.
    emitSelect(payload);
    if (payload.id && persist) {
      fetchJson(ubicApi() + '/' + encodeURIComponent(payload.id) + '/tocar', { method: 'POST' })
        .catch(function () { /* ignore */ });
    }
  }

  function renderLista() {
    var lista = $('easyUbicLista');
    var status = $('easyUbicStatus');
    if (!lista) return;
    lista.innerHTML = '';
    if (!items.length) {
      if (status) {
        status.textContent = cargando
          ? 'Cargando ubicaciones…'
          : (query ? 'Sin resultados' : 'Sin ubicaciones recientes. Toca Añadir.');
      }
      syncMas();
      return;
    }
    if (status) {
      status.textContent = items.length + (total ? (' de ' + total) : '') + ' reciente(s)';
    }
    items.forEach(function (item) {
      var row = document.createElement('div');
      row.className = 'ios-sheet-item-row';
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ios-sheet-item';
      var a = item.address || {};
      var sub = [a.direccion, a.distrito, a.ubigeo].filter(Boolean).join(' · ') || '—';
      btn.innerHTML = '<strong></strong><span></span>';
      btn.querySelector('strong').textContent = item.etiqueta || a.distrito || 'Ubicación';
      btn.querySelector('span').textContent = sub;
      btn.addEventListener('click', function () { aplicarItem(item); });

      var menu = document.createElement('details');
      menu.className = 'ios-menu';
      menu.innerHTML = '<summary aria-label="Opciones">⋯</summary><div class="ios-menu-panel"></div>';
      var panel = menu.querySelector('.ios-menu-panel');
      var editA = document.createElement('button');
      editA.type = 'button';
      editA.textContent = 'Editar';
      editA.addEventListener('click', function (e) {
        e.preventDefault();
        menu.removeAttribute('open');
        abrirForm(item);
      });
      var delA = document.createElement('button');
      delA.type = 'button';
      delA.className = 'is-danger';
      delA.textContent = 'Eliminar';
      delA.addEventListener('click', function (e) {
        e.preventDefault();
        menu.removeAttribute('open');
        eliminarItem(item);
      });
      panel.appendChild(editA);
      panel.appendChild(delA);
      menu.addEventListener('toggle', function () {
        if (!menu.open) return;
        lista.querySelectorAll('details.ios-menu[open]').forEach(function (other) {
          if (other !== menu) other.removeAttribute('open');
        });
      });

      row.appendChild(btn);
      row.appendChild(menu);
      lista.appendChild(row);
    });
    syncMas();
  }

  function cargar(reset) {
    if (cargando) return Promise.resolve();
    cargando = true;
    if (reset) {
      items = [];
      offset = 0;
      hasMore = false;
      total = 0;
    }
    renderLista();
    var url = ubicApi()
      + '?offset=' + encodeURIComponent(offset)
      + '&limit=10&q=' + encodeURIComponent(query);
    return fetchJson(url)
      .then(function (data) {
        var nuevos = Array.isArray(data.items) ? data.items : [];
        items = items.concat(nuevos);
        total = Number(data.total) || items.length;
        offset = Number(data.next_offset) || items.length;
        hasMore = data.has_more === true;
      })
      .catch(function (err) {
        var status = $('easyUbicStatus');
        if (status) status.textContent = err.message || 'Error al cargar';
      })
      .finally(function () {
        cargando = false;
        renderLista();
      });
  }

  function abrirForm(item) {
    limpiarForm();
    var titulo = $('easyUbicTitulo');
    if (item) {
      editandoId = item.id;
      var a = item.address || {};
      if (titulo) titulo.textContent = 'Editar ubicación';
      prefillFromUbigeo(a.ubigeo, {
        direccion: a.direccion,
        urbanizacion: a.urbanizacion,
        etiqueta: item.etiqueta,
      });
    } else {
      if (titulo) titulo.textContent = 'Nueva ubicación';
      loadRegiones();
    }
    showLista(false);
  }

  function eliminarItem(item) {
    if (!item || !item.id) return;
    if (!confirm('¿Eliminar esta ubicación?')) return;
    fetchJson(ubicApi() + '/' + encodeURIComponent(item.id), { method: 'DELETE' })
      .then(function () { return cargar(true); })
      .catch(function (err) { alert(err.message || 'No se pudo eliminar'); });
  }

  function nombresSeleccionados() {
    var reg = $('easyUbicRegion');
    var prov = $('easyUbicProvincia');
    var dist = $('easyUbicDistrito');
    function labelOf(sel) {
      if (!sel || !sel.selectedOptions || !sel.selectedOptions[0]) return '';
      return String(sel.selectedOptions[0].textContent || '').trim();
    }
    return {
      departamento: labelOf(reg),
      provincia: labelOf(prov),
      distrito: labelOf(dist),
      ubigeo: (dist && dist.value) || '',
    };
  }

  function guardar() {
    var names = nombresSeleccionados();
    var direccion = ($('easyUbicDireccion') && $('easyUbicDireccion').value || '').trim();
    var urbanizacion = ($('easyUbicUrbanizacion') && $('easyUbicUrbanizacion').value || '').trim();
    var etiqueta = ($('easyUbicEtiqueta') && $('easyUbicEtiqueta').value || '').trim();
    if (!names.departamento || !names.provincia || !names.distrito || !names.ubigeo) {
      alert('Selecciona región, provincia y distrito.');
      return;
    }
    if (!direccion) {
      alert('Escribe la dirección (mz, lote, calle…).');
      return;
    }
    var body = {
      etiqueta: etiqueta,
      address_envio: {
        departamento: names.departamento,
        provincia: names.provincia,
        distrito: names.distrito,
        urbanizacion: urbanizacion || null,
        direccion: direccion,
        ubigeo: names.ubigeo,
      },
    };
    var btn = $('easyUbicGuardar');
    if (btn) {
      btn.disabled = true;
      btn.dataset.originalText = btn.textContent;
      btn.textContent = 'Guardando…';
    }

    function done(payload) {
      if (btn) {
        btn.disabled = false;
        btn.textContent = btn.dataset.originalText || 'Guardar y usar';
      }
      emitSelect(payload);
    }

    function fail(err) {
      if (btn) {
        btn.disabled = false;
        btn.textContent = btn.dataset.originalText || 'Guardar y usar';
      }
      alert(err.message || 'Error al guardar');
    }

    if (!persist) {
      done({
        id: null,
        etiqueta: etiqueta || (names.distrito + ' · ' + direccion),
        ubigeo: names.ubigeo,
        departamento: names.departamento,
        provincia: names.provincia,
        distrito: names.distrito,
        urbanizacion: urbanizacion,
        direccion: direccion,
        address: body.address_envio,
      });
      return;
    }

    var url = editandoId ? (ubicApi() + '/' + encodeURIComponent(editandoId)) : ubicApi();
    fetchJson(url, {
      method: editandoId ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
    }).then(function (saved) {
      done({
        id: saved.id,
        etiqueta: saved.etiqueta,
        ubigeo: (saved.address && saved.address.ubigeo) || names.ubigeo,
        departamento: (saved.address && saved.address.departamento) || names.departamento,
        provincia: (saved.address && saved.address.provincia) || names.provincia,
        distrito: (saved.address && saved.address.distrito) || names.distrito,
        urbanizacion: (saved.address && saved.address.urbanizacion) || urbanizacion,
        direccion: (saved.address && saved.address.direccion) || direccion,
        address: saved.address || body.address_envio,
      });
    }).catch(fail);
  }

  function open(opts) {
    opts = opts || {};
    if (!ensureRoot()) {
      console.warn('EasyUbicacion: falta el partial ubicacion-picker');
      return;
    }
    onSelectCb = typeof opts.onSelect === 'function' ? opts.onSelect : null;
    persist = opts.persist !== false;
    editandoId = null;
    query = '';
    var busq = $('easyUbicBusqueda');
    if (busq) busq.value = '';
    var titulo = $('easyUbicTitulo');
    if (titulo) titulo.textContent = opts.title || 'Ubicación';

    var initial = opts.initial || null;
    if (opts.mode === 'form' || (initial && opts.forceForm)) {
      showLista(false);
      limpiarForm();
      if (titulo) titulo.textContent = opts.title || 'Nueva ubicación';
      if (initial) {
        editandoId = initial.id || null;
        prefillFromUbigeo(initial.ubigeo, {
          direccion: initial.direccion,
          urbanizacion: initial.urbanizacion,
          etiqueta: initial.etiqueta,
        });
      } else {
        loadRegiones();
      }
    } else {
      showLista(true);
      cargar(true).then(function () {
        if (busq) busq.focus();
      });
    }

    root.hidden = false;
    root.setAttribute('aria-hidden', 'false');
    document.body.classList.add('ios-sheet-open');
    document.body.style.overflow = 'hidden';
  }

  function close() {
    if (!root) return;
    showLista(true);
    limpiarForm();
    root.hidden = true;
    root.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('ios-sheet-open');
    document.body.style.overflow = '';
    onSelectCb = null;
  }

  function wireOnce() {
    if (wired || !root) return;
    wired = true;

    $('easyUbicCerrar') && $('easyUbicCerrar').addEventListener('click', function () {
      var formWrap = $('easyUbicFormWrap');
      if (formWrap && !formWrap.hidden) {
        showLista(true);
        var titulo = $('easyUbicTitulo');
        if (titulo) titulo.textContent = titulo.dataset.listTitle || 'Ubicación';
        return;
      }
      close();
    });
    $('easyUbicNueva') && $('easyUbicNueva').addEventListener('click', function () {
      abrirForm(null);
    });
    $('easyUbicGuardar') && $('easyUbicGuardar').addEventListener('click', guardar);
    $('easyUbicMas') && $('easyUbicMas').addEventListener('click', function () {
      if (hasMore && !cargando) cargar(false);
    });
    $('easyUbicBusqueda') && $('easyUbicBusqueda').addEventListener('input', function (e) {
      query = String(e.target.value || '').trim();
      if (searchTimer) clearTimeout(searchTimer);
      searchTimer = setTimeout(function () { cargar(true); }, 280);
    });
    $('easyUbicRegion') && $('easyUbicRegion').addEventListener('change', function () {
      loadProvincias($('easyUbicRegion').value);
    });
    $('easyUbicProvincia') && $('easyUbicProvincia').addEventListener('change', function () {
      loadDistritos($('easyUbicProvincia').value);
    });
    $('easyUbicDistrito') && $('easyUbicDistrito').addEventListener('change', onDistritoChange);
    root.addEventListener('click', function (e) {
      if (e.target === root) close();
    });
  }

  function setField(map, key, value) {
    if (!map || !map[key]) return;
    var node = typeof map[key] === 'string' ? $(map[key]) : map[key];
    if (node) node.value = value || '';
  }

  function getField(map, key) {
    if (!map || !map[key]) return '';
    var node = typeof map[key] === 'string' ? $(map[key]) : map[key];
    return node ? String(node.value || '') : '';
  }

  function paintPick(cfg, selected) {
    var hay = Boolean(selected && (selected.direccion || selected.ubigeo));
    var pickBtn = cfg.pickBtn ? (typeof cfg.pickBtn === 'string' ? $(cfg.pickBtn) : cfg.pickBtn) : null;
    var titleEl = cfg.titleEl ? (typeof cfg.titleEl === 'string' ? $(cfg.titleEl) : cfg.titleEl) : null;
    var detailEl = cfg.detailEl ? (typeof cfg.detailEl === 'string' ? $(cfg.detailEl) : cfg.detailEl) : null;
    var clearBtn = cfg.clearBtn ? (typeof cfg.clearBtn === 'string' ? $(cfg.clearBtn) : cfg.clearBtn) : null;
    if (pickBtn) {
      pickBtn.classList.toggle('is-on', hay);
      pickBtn.classList.toggle('is-empty', !hay);
    }
    if (titleEl) {
      titleEl.textContent = hay
        ? (selected.direccion || 'Ubicación seleccionada')
        : (cfg.emptyTitle || 'Toca para elegir ubicación');
    }
    if (detailEl) {
      detailEl.textContent = hay
        ? [
          selected.distrito,
          selected.ubigeo ? ('Ubigeo ' + selected.ubigeo) : '',
        ].filter(Boolean).join(' · ') || 'Toca para cambiar'
        : (cfg.emptyDetail || 'Lista reciente o Añadir');
    }
    if (clearBtn) clearBtn.hidden = !hay;
  }

  function applyToFields(cfg, sel) {
    var f = cfg.fields || {};
    setField(f, 'id', sel.id);
    setField(f, 'ubigeo', sel.ubigeo);
    setField(f, 'direccion', sel.direccion);
    setField(f, 'departamento', sel.departamento);
    setField(f, 'provincia', sel.provincia);
    setField(f, 'distrito', sel.distrito);
    setField(f, 'urbanizacion', sel.urbanizacion);
    setField(f, 'etiqueta', sel.etiqueta);
    paintPick(cfg, sel);
    if (typeof cfg.onApply === 'function') cfg.onApply(sel);
  }

  function clearFields(cfg) {
    var f = cfg.fields || {};
    Object.keys(f).forEach(function (k) { setField(f, k, ''); });
    paintPick(cfg, null);
    if (typeof cfg.onClear === 'function') cfg.onClear();
  }

  function bindPick(cfg) {
    cfg = cfg || {};
    var openBtn = cfg.openBtn ? (typeof cfg.openBtn === 'string' ? $(cfg.openBtn) : cfg.openBtn) : null;
    var clearBtn = cfg.clearBtn ? (typeof cfg.clearBtn === 'string' ? $(cfg.clearBtn) : cfg.clearBtn) : null;
    var f = cfg.fields || {};

    function current() {
      return {
        id: getField(f, 'id'),
        ubigeo: getField(f, 'ubigeo'),
        direccion: getField(f, 'direccion'),
        departamento: getField(f, 'departamento'),
        provincia: getField(f, 'provincia'),
        distrito: getField(f, 'distrito'),
        urbanizacion: getField(f, 'urbanizacion'),
        etiqueta: getField(f, 'etiqueta'),
      };
    }

    paintPick(cfg, current());

    if (openBtn) {
      openBtn.addEventListener('click', function () {
        if (openBtn.disabled) return;
        open({
          title: cfg.title || 'Ubicación',
          persist: cfg.persist !== false,
          onSelect: function (sel) { applyToFields(cfg, sel); },
        });
      });
    }
    if (clearBtn) {
      clearBtn.addEventListener('click', function () {
        if (clearBtn.disabled) return;
        clearFields(cfg);
      });
    }
    return {
      paint: function () { paintPick(cfg, current()); },
      apply: function (sel) { applyToFields(cfg, sel); },
      clear: function () { clearFields(cfg); },
      open: function () {
        open({
          title: cfg.title || 'Ubicación',
          persist: cfg.persist !== false,
          onSelect: function (sel) { applyToFields(cfg, sel); },
        });
      },
    };
  }

  if (typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded', function () {
      ensureRoot();
    });
  }

  global.EasyUbicacion = {
    open: open,
    close: close,
    bindPick: bindPick,
    ensure: ensureRoot,
  };
})(typeof window !== 'undefined' ? window : this);
