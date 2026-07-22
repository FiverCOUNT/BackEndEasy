(function () {
  const picker = document.getElementById('codigoSunatPicker');
  const inputCodigo = document.getElementById('codigoSunat');
  const inputNombre = document.getElementById('codigoSunatNombreHint');
  const btnAbrir = document.getElementById('btnAsignarCodigoSunat');
  const btnCerrar = document.getElementById('btnCerrarCodigoSunat');
  const busqueda = document.getElementById('codigoSunatBusqueda');
  const status = document.getElementById('codigoSunatStatus');
  const resultados = document.getElementById('codigoSunatResultados');

  if (!picker || !inputCodigo || !btnAbrir) return;

  let debounceTimer = null;
  let requestSeq = 0;

  function abrirPicker() {
    picker.hidden = false;
    picker.setAttribute('aria-hidden', 'false');
    document.body.classList.add('sunat-picker-open');
    busqueda.value = '';
    resultados.innerHTML = '';
    status.textContent = 'Escribe para buscar…';
    busqueda.focus();
    buscar('');
  }

  function cerrarPicker() {
    picker.hidden = true;
    picker.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('sunat-picker-open');
  }

  function asignar(item) {
    inputCodigo.value = item.codigo;
    if (inputNombre) {
      inputNombre.textContent = item.nombre;
    }
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
      const row = document.createElement('div');
      row.className = 'sunat-picker-item';
      row.innerHTML = `
        <div class="sunat-picker-item-main">
          <strong>${escapeHtml(item.codigo)}</strong>
          <span>${escapeHtml(item.nombre)}</span>
        </div>
        <button type="button" class="btn-sm btn-success">Asignar</button>
      `;
      row.querySelector('button').addEventListener('click', () => asignar(item));
      resultados.appendChild(row);
    });
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  async function buscar(term) {
    const seq = ++requestSeq;
    status.textContent = 'Buscando…';
    try {
      const params = new URLSearchParams();
      if (term) params.set('q', term);
      params.set('limit', '50');
      const res = await fetch(`/catalogo/codigos-sunat?${params.toString()}`);
      if (!res.ok) throw new Error('Error al buscar');
      const data = await res.json();
      if (seq !== requestSeq) return;
      renderItems(data.items || []);
    } catch (err) {
      if (seq !== requestSeq) return;
      status.textContent = 'No se pudo cargar el catálogo.';
      resultados.innerHTML = '';
    }
  }

  btnAbrir.addEventListener('click', abrirPicker);
  btnCerrar.addEventListener('click', cerrarPicker);
  picker.addEventListener('click', (ev) => {
    if (ev.target === picker) cerrarPicker();
  });
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && !picker.hidden) cerrarPicker();
  });
  busqueda.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => buscar(busqueda.value.trim()), 250);
  });
})();
