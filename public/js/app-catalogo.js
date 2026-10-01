(function () {
  const form = document.getElementById('catalogoAppForm');
  if (!form) return;

  const kindInputs = form.querySelectorAll('input[name="kind"]');
  const unidadHidden = document.getElementById('unidadHidden');
  const wrapProducto = document.getElementById('unidadProductoWrap');
  const wrapServicio = document.getElementById('unidadServicioWrap');
  const serieWrap = document.getElementById('serieWrap');
  const loteSwitch = document.getElementById('loteSwitch');
  const venceSwitch = document.getElementById('venceSwitch');
  const manejaSerie = document.getElementById('manejaSerie');
  const manejaStock = document.getElementById('manejaStock');
  const manejaLote = document.getElementById('manejaLote');
  const manejaVencimiento = document.getElementById('manejaVencimiento');

  function selectedKind() {
    const el = form.querySelector('input[name="kind"]:checked');
    return el ? el.value : 'PRODUCT';
  }

  function syncKindUi() {
    const kind = selectedKind();
    const isService = kind === 'SERVICE';
    kindInputs.forEach((input) => {
      const label = input.closest('label');
      if (label) label.classList.toggle('is-on', input.checked);
    });
    if (wrapProducto) wrapProducto.hidden = isService;
    if (wrapServicio) wrapServicio.hidden = !isService;
    if (serieWrap) serieWrap.hidden = isService;
    if (loteSwitch) loteSwitch.hidden = isService;
    if (venceSwitch) venceSwitch.hidden = isService;

    if (isService) {
      unidadHidden.value = 'ZZ';
      if (manejaSerie) manejaSerie.checked = false;
      if (manejaStock) manejaStock.checked = false;
      if (manejaLote) manejaLote.checked = false;
      if (manejaVencimiento) manejaVencimiento.checked = false;
    } else {
      const chip = form.querySelector('input[name="unidadProducto"]:checked');
      unidadHidden.value = chip ? chip.value : 'NIU';
      // Solo default stock=on en alta nueva; nunca pisar el valor guardado al editar.
      if (manejaStock && !manejaStock.checked && form.getAttribute('data-is-edit') !== '1') {
        manejaStock.checked = true;
      }
      syncSerieAvailability();
    }
  }

  function syncSerieAvailability() {
    const unidad = String(unidadHidden.value || '').toUpperCase();
    const allow = selectedKind() === 'PRODUCT' && unidad === 'NIU';
    if (manejaSerie) {
      manejaSerie.disabled = !allow;
      if (!allow) manejaSerie.checked = false;
    }
  }

  form.addEventListener('submit', function () {
    // Los checkbox disabled no se envían en el POST.
    if (manejaSerie && manejaSerie.disabled) {
      manejaSerie.disabled = false;
      manejaSerie.checked = false;
    }
    const chipProd = form.querySelector('input[name="unidadProducto"]:checked');
    const chipServ = form.querySelector('input[name="unidadServicio"]:checked');
    if (selectedKind() === 'SERVICE') {
      unidadHidden.value = chipServ ? chipServ.value : 'ZZ';
    } else if (chipProd) {
      unidadHidden.value = chipProd.value;
    }
  });

  function syncUnidadChips() {
    form.querySelectorAll('.ios-chip').forEach((chip) => {
      const input = chip.querySelector('input');
      chip.classList.toggle('is-on', Boolean(input && input.checked));
    });
  }

  kindInputs.forEach((input) => input.addEventListener('change', syncKindUi));
  form.querySelectorAll('input[name="unidadProducto"], input[name="unidadServicio"]').forEach((input) => {
    input.addEventListener('change', () => {
      if (input.checked) {
        unidadHidden.value = input.value;
        syncUnidadChips();
        syncSerieAvailability();
      }
    });
  });

  syncKindUi();
  syncUnidadChips();

  // SUNAT picker
  const picker = document.getElementById('codigoSunatPicker');
  const inputCodigo = document.getElementById('codigoSunat');
  const inputNombre = document.getElementById('codigoSunatNombreHint');
  const btnAbrir = document.getElementById('btnAsignarCodigoSunat');
  const btnCerrar = document.getElementById('btnCerrarCodigoSunat');
  const btnLimpiar = document.getElementById('btnLimpiarCodigoSunat');
  const busqueda = document.getElementById('codigoSunatBusqueda');
  const status = document.getElementById('codigoSunatStatus');
  const resultados = document.getElementById('codigoSunatResultados');
  const searchUrl = picker?.dataset?.searchUrl || '/app/catalogo/codigos-sunat';

  let debounceTimer = null;
  let requestSeq = 0;

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function abrirPicker() {
    if (!picker) return;
    picker.hidden = false;
    picker.setAttribute('aria-hidden', 'false');
    busqueda.value = '';
    resultados.innerHTML = '';
    status.textContent = 'Escribe para buscar…';
    busqueda.focus();
    buscar('');
  }

  function cerrarPicker() {
    if (!picker) return;
    picker.hidden = true;
    picker.setAttribute('aria-hidden', 'true');
  }

  function asignar(item) {
    inputCodigo.value = item.codigo;
    if (inputNombre) inputNombre.textContent = item.nombre;
    cerrarPicker();
  }

  function renderItems(items) {
    resultados.innerHTML = '';
    if (!items.length) {
      status.textContent = 'Sin resultados.';
      return;
    }
    status.textContent = `${items.length} resultado(s)`;
    items.forEach((item) => {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'ios-sheet-item';
      row.innerHTML = `<strong>${escapeHtml(item.codigo)}</strong><span>${escapeHtml(item.nombre)}</span>`;
      row.addEventListener('click', () => asignar(item));
      resultados.appendChild(row);
    });
  }

  async function buscar(term) {
    const seq = ++requestSeq;
    status.textContent = 'Buscando…';
    try {
      const params = new URLSearchParams();
      if (term) params.set('q', term);
      params.set('limit', '50');
      const res = await fetch(`${searchUrl}?${params.toString()}`);
      if (!res.ok) throw new Error('Error');
      const data = await res.json();
      if (seq !== requestSeq) return;
      renderItems(data.items || []);
    } catch {
      if (seq !== requestSeq) return;
      status.textContent = 'No se pudo buscar.';
    }
  }

  btnAbrir?.addEventListener('click', abrirPicker);
  btnCerrar?.addEventListener('click', cerrarPicker);
  btnLimpiar?.addEventListener('click', () => {
    inputCodigo.value = '';
    if (inputNombre) inputNombre.textContent = 'Catálogo N° 25 SUNAT (UNSPSC)';
  });
  picker?.addEventListener('click', (e) => {
    if (e.target === picker) cerrarPicker();
  });
  busqueda?.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => buscar(busqueda.value.trim()), 280);
  });
})();
