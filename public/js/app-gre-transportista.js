(function () {
  const form = document.getElementById('greTransportistaForm');
  if (!form) return;

  const pasosTitulos = {
    1: 'Documento relacionado',
    2: 'Remitente',
    3: 'Destinatario',
    4: 'Bienes y peso',
    5: 'Ruta',
    6: 'Vehículo y conductor',
    7: 'Fecha y flete',
    8: 'Resumen',
  };

  let step = 1;
  const max = 8;
  const companyRuc = String(form.dataset.companyRuc || '').replace(/\D/g, '');
  const appBase = form.dataset.appBase || '';
  const greRApi = form.dataset.greRApi || '';
  const envioApi = form.dataset.envioApi || '';
  const vehiculosApi = form.dataset.vehiculosApi || '';
  const conductoresApi = form.dataset.conductoresApi || '';
  const transportistasApi = form.dataset.transportistasApi || '';

  const btnPrev = document.getElementById('btnPrev');
  const btnNext = document.getElementById('btnNext');
  const btnSubmit = document.getElementById('btnSubmit');
  const titulo = document.getElementById('pasoTitulo');

  /** @type {Array<object>} */
  let docsSel = [];
  /** @type {Array<{descripcion:string,cantidad:number,unidad:string}>} */
  let bienes = [];
  let rutaBloqueada = false;
  let destBloqueado = false;
  let ubicTarget = 'partida';
  let catMode = 'vehiculo';
  /** @type {Array<object>} */
  let vehiculos = [];
  /** @type {Array<object>} */
  let conductores = [];
  /** @type {Array<object>} */
  let transportistas = [];
  /** @type {Array<object>} */
  let direccionesCache = [];

  function readJson(id, fallback) {
    try {
      const el = document.getElementById(id);
      if (!el) return fallback;
      return JSON.parse(el.textContent || 'null') ?? fallback;
    } catch {
      return fallback;
    }
  }

  vehiculos = readJson('gret-vehiculos-data', []);
  conductores = readJson('gret-conductores-data', []);
  transportistas = readJson('gret-transportistas-data', []);
  const docsSeed = readJson('gret-docs-data', { items: [] });
  let docsCache = Array.isArray(docsSeed.items) ? docsSeed.items : [];
  let docsOffset = docsSeed.next_offset || docsCache.length;
  let docsHasMore = Boolean(docsSeed.has_more);
  const lineasSeed = readJson('gret-lineas-data', []);
  if (Array.isArray(lineasSeed) && lineasSeed.length) {
    bienes = lineasSeed.map((l) => ({
      descripcion: l.descripcion || 'Ítem',
      cantidad: Number(l.cantidad) || 1,
      unidad: l.unidad || 'NIU',
    }));
  }

  function digits(v) {
    return String(v || '').replace(/\D/g, '');
  }

  function normTxt(v) {
    return String(v || '').trim().toLowerCase().replace(/\s+/g, ' ');
  }

  function docValido(doc) {
    const d = digits(doc);
    return d.length === 8 || d.length === 11;
  }

  function tipoDesdeDoc(doc) {
    return digits(doc).length === 11 ? '6' : '1';
  }

  function syncChoices() {
    form.querySelectorAll('.ios-choice').forEach((lab) => {
      const input = lab.querySelector('input');
      lab.classList.toggle('is-on', Boolean(input && input.checked));
    });
  }

  function showStep(n) {
    step = Math.max(1, Math.min(max, n));
    form.querySelectorAll('.ios-wizard-pane').forEach((p) => {
      p.classList.toggle('is-on', Number(p.dataset.step) === step);
    });
    document.querySelectorAll('.ios-wizard-dot').forEach((d) => {
      const id = Number(d.dataset.goto);
      d.classList.toggle('is-on', id === step);
      d.classList.toggle('is-done', id < step);
    });
    if (titulo) titulo.textContent = pasosTitulos[step] || '';
    if (btnPrev) btnPrev.hidden = step === 1;
    if (btnNext) btnNext.hidden = step === max;
    if (btnSubmit) btnSubmit.hidden = step !== max;
    if (step === 7) syncPagadorUi();
    if (step === 8) syncResumen();
  }

  function claveCompat(doc) {
    return {
      rem: digits(doc.cliente_doc || doc.remitente_doc),
      dest: digits(doc.destinatario_doc),
      pu: String(doc.partida?.ubigeo || '').trim(),
      pd: normTxt(doc.partida?.direccion),
      lu: String(doc.llegada?.ubigeo || '').trim(),
      ld: normTxt(doc.llegada?.direccion),
    };
  }

  function sonCompatibles(a, b) {
    const ka = claveCompat(a);
    const kb = claveCompat(b);
    if (!ka.rem || !kb.rem || !ka.dest || !kb.dest) return false;
    if (!ka.pu || !kb.pu || !ka.lu || !kb.lu) return false;
    return ka.rem === kb.rem
      && ka.dest === kb.dest
      && ka.pu === kb.pu
      && ka.pd === kb.pd
      && ka.lu === kb.lu
      && ka.ld === kb.ld;
  }

  function syncDocsHidden() {
    const wrap = document.getElementById('gretDocsHidden');
    if (!wrap) return;
    wrap.innerHTML = '';
    docsSel.forEach((d) => {
      if (d.id && !String(d.id).startsWith('manual:')) {
        const inp = document.createElement('input');
        inp.type = 'hidden';
        inp.name = 'compra_ids';
        inp.value = d.id;
        wrap.appendChild(inp);
      } else if (d.manual) {
        [['rel_tipo', '09'], ['rel_serie', d.serie], ['rel_numero', d.correlativo], ['rel_emisor', d.cliente_doc]].forEach(([name, val]) => {
          const inp = document.createElement('input');
          inp.type = 'hidden';
          inp.name = name;
          inp.value = val || '';
          wrap.appendChild(inp);
        });
      }
    });
  }

  function syncDocsUi() {
    const box = document.getElementById('gretDocsSel');
    const tit = document.getElementById('gretDocBtnTitulo');
    const det = document.getElementById('gretDocBtnDetalle');
    if (box) {
      box.innerHTML = docsSel.map((d) => {
        const key = d.id || d.ref;
        const canView = d.id && !String(d.id).startsWith('manual:');
        return `<div class="ios-selected-card">
          <div class="ios-selected-card-text">
            <strong>${d.ref || `${d.serie}-${d.correlativo}`}</strong>
            <span>${d.cliente || d.cliente_razon_social || ''} · ${d.cliente_doc || ''}</span>
          </div>
          <div class="ios-selected-card-actions">
            ${canView ? `<button type="button" class="ios-selected-card-change" data-ver-doc="${key}">Visualizar</button>` : ''}
            <button type="button" class="ios-selected-card-change is-muted" data-rm-doc="${key}">Quitar</button>
          </div>
        </div>`;
      }).join('');
      box.querySelectorAll('[data-rm-doc]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const key = btn.getAttribute('data-rm-doc');
          docsSel = docsSel.filter((d) => String(d.id || d.ref) !== key);
          aplicarDesdeDocs();
          syncDocsUi();
        });
      });
      box.querySelectorAll('[data-ver-doc]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const key = btn.getAttribute('data-ver-doc');
          const doc = docsSel.find((d) => String(d.id || d.ref) === key);
          if (!doc || !doc.id || String(doc.id).startsWith('manual:')) return;
          const url = `${appBase}/compras/${encodeURIComponent(doc.id)}/pdf`;
          window.open(url, '_blank', 'noopener,noreferrer');
        });
      });
    }
    if (tit) tit.textContent = docsSel.length ? `${docsSel.length} GRE-R seleccionada(s)` : 'Seleccionar GRE remitente';
    if (det) {
      det.textContent = docsSel.length
        ? 'Misma ruta y partes · puedes visualizar o quitar'
        : 'Solo guías donde tú eres el transportista';
    }
    syncDocsHidden();
  }

  function aplicarDesdeDocs() {
    if (!docsSel.length) {
      rutaBloqueada = false;
      destBloqueado = false;
      setRutaEditable(true);
      setDestEditable(true);
      syncBienesUi();
      return;
    }
    const first = docsSel[0];
    const remDoc = digits(first.cliente_doc);
    const remNom = first.cliente_razon_social || first.cliente || '';
    if (remDoc) {
      document.getElementById('gretRemDoc').value = remDoc;
      document.getElementById('gretRemTipo').value = tipoDesdeDoc(remDoc);
      document.getElementById('gretRemNombre').value = remNom;
    }

    const destDoc = digits(first.destinatario_doc);
    const destNom = first.destinatario_razon_social || '';
    if (destDoc) {
      document.getElementById('gretDestDoc').value = destDoc;
      document.getElementById('gretDestTipo').value = tipoDesdeDoc(destDoc);
      document.getElementById('gretDestNombre').value = destNom;
      destBloqueado = true;
      setDestEditable(false);
    } else {
      destBloqueado = false;
      setDestEditable(true);
    }

    const p = first.partida || {};
    const l = first.llegada || {};
    if (p.ubigeo && p.direccion && l.ubigeo && l.direccion) {
      setUbicacion('partida', p.ubigeo, p.direccion);
      setUbicacion('llegada', l.ubigeo, l.direccion);
      rutaBloqueada = true;
      setRutaEditable(false);
    } else {
      rutaBloqueada = false;
      setRutaEditable(true);
    }

    const merged = [];
    docsSel.forEach((d) => {
      (d.lineas || []).forEach((ln) => {
        const desc = String(ln.descripcion || '').trim();
        if (!desc) return;
        merged.push({
          descripcion: desc,
          cantidad: Number(ln.cantidad) || 1,
          unidad: ln.unidad || 'NIU',
        });
      });
    });
    if (merged.length) bienes = merged;

    const peso = docsSel.map((d) => Number(d.peso_total)).find((n) => Number.isFinite(n) && n > 0);
    if (peso) document.getElementById('gretPeso').value = String(peso);
    const und = docsSel.map((d) => d.und_peso_total).find(Boolean);
    if (und) document.getElementById('gretUndPeso').value = und;

    if (first.vehiculo_placa) document.getElementById('gretVehPlaca').value = first.vehiculo_placa;
    if (first.conductor_numero_doc) document.getElementById('gretCondDoc').value = digits(first.conductor_numero_doc);
    if (first.conductor_nombres) document.getElementById('gretCondNombre').value = first.conductor_nombres;
    if (first.conductor_licencia) document.getElementById('gretCondLic').value = first.conductor_licencia;

    syncBienesUi();
  }

  function setDestEditable(ok) {
    const doc = document.getElementById('gretDestDoc');
    const nom = document.getElementById('gretDestNombre');
    if (doc) doc.readOnly = !ok;
    if (nom) nom.readOnly = !ok;
    const hint = document.getElementById('gretDestHint');
    if (hint) {
      hint.textContent = ok
        ? 'Quién recibe la mercadería.'
        : 'Fijado por la(s) GRE remitente vinculada(s) — no editable.';
    }
  }

  function setRutaEditable(ok) {
    ['gretPartidaAbrir', 'gretLlegadaAbrir', 'gretPartidaQuitar', 'gretLlegadaQuitar'].forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      if (id.includes('Quitar')) el.hidden = !ok || !(id.includes('Partida')
        ? document.getElementById('partidaUbigeo').value
        : document.getElementById('llegadaUbigeo').value);
      else el.disabled = !ok;
    });
    const hint = document.getElementById('gretRutaHint');
    if (hint) {
      hint.textContent = ok
        ? 'Partida y llegada del traslado.'
        : 'Fijadas por la(s) GRE remitente. Para cambiarlas, quita los documentos.';
    }
  }

  function setUbicacion(kind, ubigeo, direccion) {
    const u = String(ubigeo || '').trim();
    const d = String(direccion || '').trim();
    const ubiEl = document.getElementById(`${kind}Ubigeo`);
    const dirEl = document.getElementById(`${kind}Direccion`);
    if (ubiEl) ubiEl.value = u;
    if (dirEl) dirEl.value = d;
    const tit = document.getElementById(`gret${kind === 'partida' ? 'Partida' : 'Llegada'}BtnTitulo`);
    const det = document.getElementById(`gret${kind === 'partida' ? 'Partida' : 'Llegada'}BtnDetalle`);
    const btn = document.getElementById(`gret${kind === 'partida' ? 'Partida' : 'Llegada'}Abrir`);
    const clr = document.getElementById(`gret${kind === 'partida' ? 'Partida' : 'Llegada'}Quitar`);
    if (tit) tit.textContent = d || 'Toca para elegir ubicación';
    if (det) det.textContent = u ? `Ubigeo ${u}` : 'Obligatorio';
    if (btn) btn.classList.toggle('is-empty', !(u && d));
    if (clr) clr.hidden = !(u && d) || rutaBloqueada;
  }

  function syncBienesHidden() {
    const wrap = document.getElementById('gretBienesHidden');
    if (!wrap) return;
    wrap.innerHTML = '';
    bienes.forEach((b) => {
      [
        ['linea_descripcion', b.descripcion],
        ['linea_cantidad', String(b.cantidad)],
        ['linea_unidad', b.unidad || 'NIU'],
        ['linea_precio', '0'],
        ['linea_catalog_item_id', ''],
      ].forEach(([name, val]) => {
        const inp = document.createElement('input');
        inp.type = 'hidden';
        inp.name = name;
        inp.value = val;
        wrap.appendChild(inp);
      });
    });
  }

  function syncBienesUi() {
    const lista = document.getElementById('gretBienesLista');
    const status = document.getElementById('gretBienesStatus');
    if (lista) {
      lista.innerHTML = bienes.map((b, i) => (
        `<div class="ios-nc-item">
          <div class="ios-nc-item-main">
            <strong>${b.descripcion}</strong>
            <small>${b.cantidad} ${b.unidad || 'NIU'}</small>
          </div>
          <button type="button" class="ios-btn-ghost" data-rm-bien="${i}">Quitar</button>
        </div>`
      )).join('') || '<p class="ios-muted">Sin bienes aún.</p>';
      lista.querySelectorAll('[data-rm-bien]').forEach((btn) => {
        btn.addEventListener('click', () => {
          bienes.splice(Number(btn.getAttribute('data-rm-bien')), 1);
          syncBienesUi();
        });
      });
    }
    if (status) {
      status.textContent = docsSel.length
        ? `Ítems de ${docsSel.length} GRE remitente · puedes quitar o añadir`
        : 'Agrega al menos un bien trasladado';
    }
    syncBienesHidden();
  }

  function pagadorIndicador() {
    return (form.querySelector('input[name="pagador_indicador"]:checked') || {}).value || 'REMITENTE';
  }

  function syncPagadorUi() {
    syncChoices();
    const ind = pagadorIndicador();
    const remVista = document.getElementById('gretPagadorRemVista');
    const extra = document.getElementById('gretPagadorExtra');
    const empBlock = document.getElementById('gretPagadorEmpBlock');
    const hint = document.getElementById('gretPagadorExtraHint');
    const remDoc = digits(document.getElementById('gretRemDoc').value);
    const remNom = document.getElementById('gretRemNombre').value.trim();
    const remDet = document.getElementById('gretPagadorRemDetalle');
    if (remDet) remDet.textContent = remNom ? `${remNom} · ${remDoc}` : 'Completa el paso Remitente primero';
    if (remVista) remVista.hidden = ind !== 'REMITENTE';
    if (extra) extra.hidden = ind === 'REMITENTE';
    if (empBlock) empBlock.hidden = ind !== 'SUBCONTRATADO';
    if (hint) {
      hint.textContent = ind === 'SUBCONTRATADO'
        ? 'RUC de quien te subcontrató (no el tuyo).'
        : 'Datos del tercero que paga el flete.';
    }
  }

  function syncResumen() {
    const set = (id, txt) => {
      const el = document.getElementById(id);
      if (el) el.textContent = txt || '—';
    };
    set('sumDocs', docsSel.length
      ? docsSel.map((d) => d.ref || `${d.serie}-${d.correlativo}`).join(', ')
      : 'Sin GRE-R');
    set('sumRem', `${document.getElementById('gretRemNombre').value} · ${document.getElementById('gretRemDoc').value}`);
    set('sumDest', `${document.getElementById('gretDestNombre').value} · ${document.getElementById('gretDestDoc').value}`);
    set('sumBienes', `${bienes.length} ítem(s) · ${document.getElementById('gretPeso').value} ${document.getElementById('gretUndPeso').value}`);
    set('sumRuta', `${document.getElementById('partidaDireccion').value || '—'} → ${document.getElementById('llegadaDireccion').value || '—'}`);
    set('sumTransporte', `${document.getElementById('gretVehPlaca').value || '—'} · ${document.getElementById('gretCondNombre').value || '—'}`);
    const ind = pagadorIndicador();
    const pagTxt = ind === 'REMITENTE'
      ? `Remitente · ${document.getElementById('gretRemNombre').value}`
      : `${ind} · ${document.getElementById('gretPagNombre').value} · ${document.getElementById('gretPagDoc').value}`;
    set('sumFlete', `${document.getElementById('gretFecha').value} · ${pagTxt}`);
  }

  function puedeAvanzar(p) {
    if (p === 1) return true;
    if (p === 2) {
      return docValido(document.getElementById('gretRemDoc').value)
        && document.getElementById('gretRemNombre').value.trim();
    }
    if (p === 3) {
      return docValido(document.getElementById('gretDestDoc').value)
        && document.getElementById('gretDestNombre').value.trim();
    }
    if (p === 4) {
      const peso = Number(String(document.getElementById('gretPeso').value).replace(',', '.'));
      return bienes.length > 0 && peso > 0;
    }
    if (p === 5) {
      return digits(document.getElementById('partidaUbigeo').value).length === 6
        && document.getElementById('partidaDireccion').value.trim()
        && digits(document.getElementById('llegadaUbigeo').value).length === 6
        && document.getElementById('llegadaDireccion').value.trim();
    }
    if (p === 6) {
      return document.getElementById('gretVehPlaca').value.trim()
        && digits(document.getElementById('gretCondDoc').value).length === 8
        && document.getElementById('gretCondNombre').value.trim();
    }
    if (p === 7) {
      if (!document.getElementById('gretFecha').value) return false;
      const ind = pagadorIndicador();
      if (ind === 'REMITENTE') return true;
      return docValido(document.getElementById('gretPagDoc').value)
        && document.getElementById('gretPagNombre').value.trim();
    }
    return true;
  }

  function mensajeBloqueo(p) {
    if (p === 2) return 'Completa el remitente (documento y razón social).';
    if (p === 3) return 'Completa el destinatario.';
    if (p === 4) return 'Agrega al menos un bien y un peso mayor a 0.';
    if (p === 5) return 'Completa partida y llegada (ubigeo 6 dígitos + dirección).';
    if (p === 6) return 'Placa, DNI (8) y nombres del conductor son obligatorios.';
    if (p === 7) return 'Fecha de inicio y datos del pagador del flete son obligatorios.';
    return 'Completa los datos del paso.';
  }

  function openSheet(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.hidden = false;
    el.setAttribute('aria-hidden', 'false');
  }

  function closeSheet(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.hidden = true;
    el.setAttribute('aria-hidden', 'true');
  }

  async function fetchGreR({ reset = false } = {}) {
    const periodoEl = document.getElementById('gretPeriodo');
    const q = document.getElementById('gretDocPickerBusqueda')?.value || '';
    const month = periodoEl?.value || '';
    const periodo = month.replace('-', '');
    if (reset) {
      docsCache = [];
      docsOffset = 0;
      docsHasMore = true;
    }
    const url = new URL(greRApi, window.location.origin);
    url.searchParams.set('offset', String(docsOffset));
    url.searchParams.set('limit', '20');
    if (q) url.searchParams.set('q', q);
    if (periodo.length === 6) url.searchParams.set('periodo', periodo);
    const status = document.getElementById('gretDocPickerStatus');
    if (status) status.textContent = 'Cargando…';
    const res = await fetch(url.toString(), { headers: { Accept: 'application/json' } });
    const data = await res.json();
    const items = Array.isArray(data.items) ? data.items : [];
    docsCache = reset ? items : docsCache.concat(items);
    docsOffset = data.next_offset != null ? data.next_offset : docsCache.length;
    docsHasMore = Boolean(data.has_more);
    renderDocPicker();
  }

  function renderDocPicker() {
    const lista = document.getElementById('gretDocPickerLista');
    const status = document.getElementById('gretDocPickerStatus');
    const more = document.getElementById('gretDocPickerMas');
    if (!lista) return;
    if (!docsCache.length) {
      lista.innerHTML = '';
      if (status) status.textContent = 'Sin GRE remitente en este mes.';
      if (more) more.hidden = true;
      return;
    }
    if (status) status.textContent = 'Toca para marcar · multi solo si son compatibles';
    lista.innerHTML = docsCache.map((d) => {
      const selected = docsSel.some((s) => s.id === d.id);
      const blocked = docsSel.length > 0 && !docsSel.some((s) => s.id === d.id)
        && !sonCompatibles(docsSel[0], d);
      return `<button type="button" class="ios-sheet-item ${selected ? 'is-on' : ''}" data-doc-id="${d.id}" ${blocked ? 'disabled' : ''}>
        <strong>${d.ref || ''}</strong>
        <small>${d.cliente || ''} · ${d.cliente_doc || ''}</small>
        ${blocked ? '<small style="color:#c62828;">No compatible con la selección</small>' : ''}
      </button>`;
    }).join('');
    lista.querySelectorAll('[data-doc-id]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-doc-id');
        const doc = docsCache.find((x) => x.id === id);
        if (!doc) return;
        const idx = docsSel.findIndex((x) => x.id === id);
        if (idx >= 0) docsSel.splice(idx, 1);
        else {
          if (docsSel.length && !sonCompatibles(docsSel[0], doc)) {
            if (status) status.textContent = 'Solo puedes amparar varias GRE-R si coinciden remitente, destinatario, partida y llegada.';
            return;
          }
          docsSel.push(doc);
        }
        aplicarDesdeDocs();
        syncDocsUi();
        renderDocPicker();
      });
    });
    if (more) more.hidden = !docsHasMore;
  }

  document.getElementById('gretDocAbrir')?.addEventListener('click', () => {
    openSheet('gretDocPicker');
    fetchGreR({ reset: true }).catch(() => {
      const status = document.getElementById('gretDocPickerStatus');
      if (status) status.textContent = 'No se pudieron cargar las GRE-R.';
    });
  });
  document.getElementById('gretDocPickerCerrar')?.addEventListener('click', () => closeSheet('gretDocPicker'));
  document.getElementById('gretDocPickerMas')?.addEventListener('click', () => fetchGreR());
  let searchTimer;
  document.getElementById('gretDocPickerBusqueda')?.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => fetchGreR({ reset: true }), 300);
  });

  // —— Selector mes iOS (wheel mes/año, igual que Compras) ——
  const MESES_ES = [
    'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
    'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
  ];
  const periodoHidden = document.getElementById('gretPeriodo');
  const periodoLabel = document.getElementById('gretPeriodoLabel');
  const mesSheet = document.getElementById('gretMesSheet');
  let mesWheelState = { month: 1, year: 2026 };

  function hoyPeParts() {
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Lima',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const [y, m] = fmt.format(new Date()).split('-').map(Number);
    return { year: y, month: m };
  }

  function parsePeriodoHidden() {
    const raw = String(periodoHidden?.value || '').trim();
    const m = raw.match(/^(\d{4})-(\d{2})$/);
    if (m) return { year: Number(m[1]), month: Number(m[2]) };
    const dig = raw.replace(/\D/g, '');
    if (dig.length === 6) return { year: Number(dig.slice(0, 4)), month: Number(dig.slice(4)) };
    return hoyPeParts();
  }

  function labelMes(year, month) {
    const nombre = MESES_ES[Math.max(0, Math.min(11, month - 1))] || '';
    return `${nombre} de ${year}`;
  }

  function syncPeriodoLabel() {
    const p = parsePeriodoHidden();
    if (periodoLabel) periodoLabel.textContent = labelMes(p.year, p.month);
  }

  function fillMesWheelList(ul, values, formatter) {
    if (!ul) return;
    let html = '<li class="ios-date-wheel-spacer" aria-hidden="true"></li><li class="ios-date-wheel-spacer" aria-hidden="true"></li>';
    values.forEach((v) => {
      html += `<li class="ios-date-wheel-item" data-value="${v}">${formatter ? formatter(v) : v}</li>`;
    });
    html += '<li class="ios-date-wheel-spacer" aria-hidden="true"></li><li class="ios-date-wheel-spacer" aria-hidden="true"></li>';
    ul.innerHTML = html;
  }

  function mesCol(name) {
    return document.querySelector(`#gretMesWheel .ios-date-wheel-unit[data-col="${name}"] .ios-date-wheel-col`);
  }

  function snapMes(name, value, instant) {
    const col = mesCol(name);
    if (!col) return;
    const item = col.querySelector(`.ios-date-wheel-item[data-value="${value}"]`);
    if (!item) return;
    const itemH = item.offsetHeight || 40;
    const top = item.offsetTop - (col.clientHeight / 2) + (itemH / 2);
    if (instant) col.scrollTop = top;
    else col.scrollTo({ top, behavior: 'smooth' });
    mesWheelState[name] = Number(value);
  }

  function readMesCol(name) {
    const col = mesCol(name);
    if (!col) return mesWheelState[name];
    const items = col.querySelectorAll('.ios-date-wheel-item');
    const mid = col.scrollTop + col.clientHeight / 2;
    let best = null;
    let bestDist = Infinity;
    items.forEach((item) => {
      const center = item.offsetTop + item.offsetHeight / 2;
      const dist = Math.abs(center - mid);
      if (dist < bestDist) {
        bestDist = dist;
        best = item;
      }
    });
    if (!best) return mesWheelState[name];
    const v = Number(best.getAttribute('data-value'));
    mesWheelState[name] = v;
    return v;
  }

  function stepMes(name, dir) {
    const col = mesCol(name);
    if (!col) return;
    const items = Array.from(col.querySelectorAll('.ios-date-wheel-item'));
    if (!items.length) return;
    const current = Number(mesWheelState[name]);
    const idx = items.findIndex((el) => Number(el.getAttribute('data-value')) === current);
    const next = Math.max(0, Math.min(items.length - 1, (idx < 0 ? 0 : idx) + dir));
    snapMes(name, Number(items[next].getAttribute('data-value')), false);
  }

  function buildMesWheel() {
    const hoy = hoyPeParts();
    fillMesWheelList(
      document.getElementById('gretMesWheelMonth'),
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
      (m) => MESES_ES[m - 1],
    );
    const years = [];
    for (let y = hoy.year - 5; y <= hoy.year; y += 1) years.push(y);
    fillMesWheelList(document.getElementById('gretMesWheelYear'), years);
  }

  function abrirMesSheet() {
    if (!mesSheet) return;
    const base = parsePeriodoHidden();
    const hoy = hoyPeParts();
    if (base.year > hoy.year || (base.year === hoy.year && base.month > hoy.month)) {
      base.year = hoy.year;
      base.month = hoy.month;
    }
    mesWheelState = { month: base.month, year: base.year };
    buildMesWheel();
    mesSheet.hidden = false;
    mesSheet.setAttribute('aria-hidden', 'false');
    requestAnimationFrame(() => {
      snapMes('month', mesWheelState.month, true);
      snapMes('year', mesWheelState.year, true);
    });
  }

  function cerrarMesSheet() {
    if (!mesSheet) return;
    mesSheet.hidden = true;
    mesSheet.setAttribute('aria-hidden', 'true');
  }

  function aplicarMesSheet() {
    readMesCol('month');
    readMesCol('year');
    const hoy = hoyPeParts();
    let { year, month } = mesWheelState;
    if (year > hoy.year || (year === hoy.year && month > hoy.month)) {
      year = hoy.year;
      month = hoy.month;
    }
    if (periodoHidden) {
      periodoHidden.value = `${year}-${String(month).padStart(2, '0')}`;
    }
    syncPeriodoLabel();
    cerrarMesSheet();
    fetchGreR({ reset: true }).catch(() => {});
  }

  document.getElementById('gretPeriodoAbrir')?.addEventListener('click', abrirMesSheet);
  document.getElementById('gretMesCancelar')?.addEventListener('click', cerrarMesSheet);
  document.getElementById('gretMesListo')?.addEventListener('click', aplicarMesSheet);
  if (mesSheet) {
    mesSheet.addEventListener('click', (ev) => {
      if (ev.target === mesSheet) cerrarMesSheet();
    });
    ['month', 'year'].forEach((name) => {
      const col = mesCol(name);
      const unit = document.querySelector(`#gretMesWheel .ios-date-wheel-unit[data-col="${name}"]`);
      if (!col) return;
      let wheelLock = false;
      let scrollTimer;
      col.addEventListener('scroll', () => {
        clearTimeout(scrollTimer);
        scrollTimer = setTimeout(() => readMesCol(name), 80);
      });
      const onWheel = (ev) => {
        ev.preventDefault();
        if (wheelLock) return;
        wheelLock = true;
        stepMes(name, ev.deltaY > 0 ? 1 : -1);
        setTimeout(() => { wheelLock = false; }, 60);
      };
      col.addEventListener('wheel', onWheel, { passive: false });
      if (unit) unit.addEventListener('wheel', onWheel, { passive: false });
    });
    mesSheet.querySelectorAll('#gretMesWheel .ios-date-wheel-step').forEach((btn) => {
      btn.addEventListener('click', () => {
        const unit = btn.closest('.ios-date-wheel-unit');
        const name = unit?.getAttribute('data-col');
        const dir = Number(btn.getAttribute('data-dir') || 0);
        if (name) stepMes(name, dir);
      });
    });
  }
  syncPeriodoLabel();

  document.getElementById('gretDocManualAbrir')?.addEventListener('click', () => openSheet('gretDocManualPicker'));
  document.getElementById('gretDocManualCerrar')?.addEventListener('click', () => closeSheet('gretDocManualPicker'));
  document.getElementById('gretDocManualAgregar')?.addEventListener('click', () => {
    const emisor = digits(document.getElementById('gretManualEmisor').value);
    const serie = String(document.getElementById('gretManualSerie').value || '').trim().toUpperCase();
    const numero = digits(document.getElementById('gretManualNumero').value);
    if (emisor.length !== 11 || !serie || !numero) {
      alert('Completa RUC emisor (11), serie y número.');
      return;
    }
    const ref = `${serie}-${numero}`;
    docsSel.push({
      id: `manual:${ref}`,
      manual: true,
      ref,
      serie,
      correlativo: numero,
      cliente_doc: emisor,
      cliente_razon_social: emisor,
      cliente: emisor,
      lineas: [],
      partida: {},
      llegada: {},
    });
    document.getElementById('gretRemDoc').value = emisor;
    document.getElementById('gretRemTipo').value = '6';
    aplicarDesdeDocs();
    syncDocsUi();
    closeSheet('gretDocManualPicker');
  });

  document.getElementById('gretBienAgregar')?.addEventListener('click', () => openSheet('gretBienSheet'));
  document.getElementById('gretBienCerrar')?.addEventListener('click', () => closeSheet('gretBienSheet'));
  document.getElementById('gretBienGuardar')?.addEventListener('click', () => {
    const desc = document.getElementById('gretBienDesc').value.trim();
    const cant = Number(document.getElementById('gretBienCant').value) || 1;
    const und = document.getElementById('gretBienUnd').value || 'NIU';
    if (!desc) return;
    bienes.push({ descripcion: desc, cantidad: cant, unidad: und });
    document.getElementById('gretBienDesc').value = '';
    syncBienesUi();
    closeSheet('gretBienSheet');
  });

  function openUbic(kind) {
    if (rutaBloqueada) return;
    if (!window.EasyUbicacion) return;
    window.EasyUbicacion.open({
      title: kind === 'partida' ? 'Punto de partida' : 'Punto de llegada',
      onSelect: function (sel) {
        setUbicacion(kind, sel.ubigeo, sel.direccion);
      },
    });
  }

  document.getElementById('gretPartidaAbrir')?.addEventListener('click', () => openUbic('partida'));
  document.getElementById('gretLlegadaAbrir')?.addEventListener('click', () => openUbic('llegada'));
  document.getElementById('gretPartidaQuitar')?.addEventListener('click', () => {
    if (!rutaBloqueada) setUbicacion('partida', '', '');
  });
  document.getElementById('gretLlegadaQuitar')?.addEventListener('click', () => {
    if (!rutaBloqueada) setUbicacion('llegada', '', '');
  });


  let catFormOpen = false;
  let catEditId = '';

  function catApiUrl() {
    if (catMode === 'vehiculo') return vehiculosApi;
    if (catMode === 'conductor') return conductoresApi;
    return transportistasApi;
  }

  function mostrarGretCatForm(on) {
    catFormOpen = !!on;
    const listaWrap = document.getElementById('gretCatListaWrap');
    const formWrap = document.getElementById('gretCatFormWrap');
    const nueva = document.getElementById('gretCatNueva');
    if (listaWrap) listaWrap.hidden = !!on;
    if (formWrap) formWrap.hidden = !on;
    if (nueva) nueva.hidden = !!on;
    const tituloEl = document.getElementById('gretCatTitulo');
    if (tituloEl) {
      if (on) tituloEl.textContent = catEditId ? 'Editar' : 'Añadir';
      else {
        tituloEl.textContent = catMode === 'vehiculo'
          ? 'Vehículos'
          : (catMode === 'conductor' ? 'Conductores' : 'Empresas de transporte');
      }
    }
  }

  function buildGretCatForm(item) {
    const fields = document.getElementById('gretCatFormFields');
    if (!fields) return;
    if (catMode === 'vehiculo') {
      fields.innerHTML =
        '<label class="ios-field"><span>Placa</span>'
        + '<input type="text" id="gretCatField_placa" maxlength="15" autocomplete="off" /></label>'
        + '<label class="ios-field"><span>Nro. circulación / TUCE (opcional)</span>'
        + '<input type="text" id="gretCatField_nro_circulacion" autocomplete="off" /></label>';
      if (item) {
        const placa = document.getElementById('gretCatField_placa');
        const nro = document.getElementById('gretCatField_nro_circulacion');
        if (placa) placa.value = item.placa || '';
        if (nro) nro.value = item.nro_circulacion || item.nroCirculacion || '';
      }
    } else if (catMode === 'conductor') {
      fields.innerHTML =
        '<label class="ios-field"><span>DNI / documento</span>'
        + '<input type="text" id="gretCatField_numero_doc" inputmode="numeric" maxlength="12" autocomplete="off" /></label>'
        + '<label class="ios-field"><span>Nombres completos</span>'
        + '<input type="text" id="gretCatField_nombres" autocomplete="off" /></label>'
        + '<label class="ios-field"><span>Licencia MTC</span>'
        + '<input type="text" id="gretCatField_licencia" maxlength="10" placeholder="Ej. Q007444402" autocomplete="off" style="text-transform:uppercase;" /></label>';
      if (item) {
        const doc = document.getElementById('gretCatField_numero_doc');
        const nom = document.getElementById('gretCatField_nombres');
        const lic = document.getElementById('gretCatField_licencia');
        if (doc) doc.value = item.numero_doc || item.num_doc || '';
        if (nom) nom.value = item.nombres_completos || item.nombres || item.nombre || '';
        if (lic) lic.value = item.licencia || '';
      }
    } else {
      fields.innerHTML =
        '<label class="ios-field"><span>RUC</span>'
        + '<input type="text" id="gretCatField_ruc" inputmode="numeric" maxlength="11" autocomplete="off" /></label>'
        + '<label class="ios-field"><span>Razón social</span>'
        + '<input type="text" id="gretCatField_razon" autocomplete="off" /></label>'
        + '<label class="ios-field"><span>Nro. MTC</span>'
        + '<input type="text" id="gretCatField_mtc" autocomplete="off" /></label>';
      if (item) {
        const ruc = document.getElementById('gretCatField_ruc');
        const raz = document.getElementById('gretCatField_razon');
        const mtc = document.getElementById('gretCatField_mtc');
        if (ruc) ruc.value = item.ruc || item.numero_doc || '';
        if (raz) raz.value = item.nombre || item.razon_social || '';
        if (mtc) mtc.value = item.nro_mtc || item.nroMtc || '';
      }
    }
  }

  function gretCatField(id) {
    return String(document.getElementById(id)?.value || '').trim();
  }

  function applyCatItem(it) {
    if (catMode === 'vehiculo') {
      document.getElementById('gretVehId').value = it.id || '';
      document.getElementById('gretVehPlaca').value = it.placa || '';
      document.getElementById('gretVehTuce').value = it.nro_circulacion || it.nroCirculacion || '';
      document.getElementById('gretVehBtnTitulo').textContent = it.placa || 'Vehículo';
      vehiculos = [{ ...it }, ...vehiculos.filter((v) => v.id !== it.id)];
    } else if (catMode === 'conductor') {
      document.getElementById('gretCondId').value = it.id || '';
      document.getElementById('gretCondDoc').value = digits(it.numero_doc || it.num_doc);
      document.getElementById('gretCondNombre').value = it.nombres_completos || it.nombres || it.nombre || '';
      document.getElementById('gretCondLic').value = it.licencia || '';
      document.getElementById('gretCondBtnTitulo').textContent = it.nombres_completos || it.nombres || it.nombre || 'Conductor';
      conductores = [{ ...it }, ...conductores.filter((c) => c.id !== it.id)];
    } else {
      const ruc = digits(it.ruc || it.numero_doc);
      document.getElementById('gretPagDoc').value = ruc;
      document.getElementById('gretPagTipo').value = '6';
      document.getElementById('gretPagNombre').value = it.nombre || it.razon_social || '';
      document.getElementById('gretPagadorEmpTitulo').textContent = it.nombre || it.razon_social || ruc;
      transportistas = [{ ...it }, ...transportistas.filter((t) => t.id !== it.id)];
    }
  }

  function guardarGretCatNuevo() {
    const api = catApiUrl();
    if (!api) return;
    let body;
    let err;
    if (catMode === 'vehiculo') {
      body = {
        placa: gretCatField('gretCatField_placa').toUpperCase().replace(/[\s-]+/g, ''),
        nro_circulacion: gretCatField('gretCatField_nro_circulacion'),
      };
      if (!body.placa || body.placa.length < 5) err = 'Placa inválida';
    } else if (catMode === 'conductor') {
      const lic = gretCatField('gretCatField_licencia').toUpperCase().replace(/[\s-]+/g, '');
      body = {
        tipo_doc: '1',
        numero_doc: gretCatField('gretCatField_numero_doc').replace(/\D/g, ''),
        nombres_completos: gretCatField('gretCatField_nombres'),
        licencia: lic,
      };
      if (body.numero_doc.length < 8) err = 'Documento inválido';
      else if (!body.nombres_completos) err = 'Nombres obligatorios';
      else if (lic && !/^[A-Z]\d{8,9}$/.test(lic)) {
        err = 'Licencia inválida (letra + 8 o 9 dígitos, ej. Q007444402)';
      }
    } else {
      body = {
        ruc: gretCatField('gretCatField_ruc').replace(/\D/g, ''),
        razon_social: gretCatField('gretCatField_razon'),
        nro_mtc: gretCatField('gretCatField_mtc'),
      };
      if (body.ruc.length !== 11) err = 'RUC de 11 dígitos';
      else if (!body.razon_social) err = 'Razón social obligatoria';
      else if (!body.nro_mtc) err = 'Nro. MTC obligatorio';
    }
    if (err) {
      alert(err);
      return;
    }
    const btn = document.getElementById('gretCatGuardar');
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Guardando…';
    }
    fetch(catEditId ? `${api}/${encodeURIComponent(catEditId)}` : api, {
      method: catEditId ? 'PUT' : 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
    })
      .then((r) => r.json().then((data) => {
        if (!r.ok) throw new Error(data.message || 'No se pudo guardar');
        return data;
      }))
      .then((saved) => {
        applyCatItem(saved);
        catEditId = '';
        mostrarGretCatForm(false);
        closeSheet('gretCatPicker');
      })
      .catch((e) => alert(e.message || 'Error al guardar'))
      .finally(() => {
        if (btn) {
          btn.disabled = false;
          btn.textContent = 'Guardar';
        }
      });
  }

  function openCat(mode) {
    catMode = mode;
    catEditId = '';
    mostrarGretCatForm(false);
    const nueva = document.getElementById('gretCatNueva');
    if (nueva) nueva.hidden = false;
    const busqueda = document.getElementById('gretCatBusqueda');
    if (busqueda) {
      busqueda.value = '';
      busqueda.placeholder = mode === 'vehiculo'
        ? 'Placa…'
        : (mode === 'conductor' ? 'Nombre, DNI…' : 'RUC o razón social…');
    }
    openSheet('gretCatPicker');
    renderCat();
  }

  function renderCat() {
    const q = (document.getElementById('gretCatBusqueda')?.value || '').toLowerCase();
    const lista = document.getElementById('gretCatLista');
    const status = document.getElementById('gretCatStatus');
    let items = [];
    if (catMode === 'vehiculo') {
      items = vehiculos.filter((v) => `${v.placa || ''}`.toLowerCase().includes(q));
    } else if (catMode === 'conductor') {
      items = conductores.filter((c) => `${c.nombres || c.nombre || c.nombres_completos || ''} ${c.numero_doc || ''}`.toLowerCase().includes(q));
    } else {
      items = transportistas.filter((t) => {
        const ruc = digits(t.ruc || t.numero_doc);
        return ruc !== companyRuc && `${t.nombre || t.razon_social || ''} ${ruc}`.toLowerCase().includes(q);
      });
    }
    if (status) {
      status.textContent = items.length
        ? 'Elige uno · ⋯ para editar'
        : (q ? 'Sin resultados' : 'Sin registros. Toca Añadir.');
    }
    if (!lista) return;
    lista.innerHTML = '';
    items.forEach((it) => {
      let title = '';
      let sub = '';
      if (catMode === 'vehiculo') {
        title = it.placa || '—';
        sub = it.nro_circulacion || it.nroCirculacion || '';
      } else if (catMode === 'conductor') {
        title = it.nombres_completos || it.nombres || it.nombre || '—';
        sub = [
          it.numero_doc || it.num_doc ? `DNI ${it.numero_doc || it.num_doc}` : '',
          it.licencia ? `Lic. ${it.licencia}` : '',
        ].filter(Boolean).join(' · ');
      } else {
        title = it.nombre || it.razon_social || '—';
        sub = `RUC ${it.ruc || it.numero_doc || ''}`;
      }
      const row = document.createElement('div');
      row.className = 'ios-sheet-item-row';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ios-sheet-item';
      btn.innerHTML = `<strong>${title}</strong><small>${sub}</small>`;
      btn.addEventListener('click', () => {
        applyCatItem(it);
        closeSheet('gretCatPicker');
      });
      const menu = document.createElement('details');
      menu.className = 'ios-menu';
      menu.innerHTML = '<summary aria-label="Opciones">⋯</summary><div class="ios-menu-panel"></div>';
      const panel = menu.querySelector('.ios-menu-panel');
      const editB = document.createElement('button');
      editB.type = 'button';
      editB.textContent = 'Editar';
      editB.addEventListener('click', (e) => {
        e.preventDefault();
        menu.removeAttribute('open');
        catEditId = it.id || '';
        buildGretCatForm(it);
        mostrarGretCatForm(true);
      });
      panel.appendChild(editB);
      menu.addEventListener('toggle', () => {
        if (!menu.open) return;
        lista.querySelectorAll('details.ios-menu[open]').forEach((other) => {
          if (other !== menu) other.removeAttribute('open');
        });
      });
      row.appendChild(btn);
      row.appendChild(menu);
      lista.appendChild(row);
    });
  }

  document.getElementById('gretVehAbrir')?.addEventListener('click', () => openCat('vehiculo'));
  document.getElementById('gretCondAbrir')?.addEventListener('click', () => openCat('conductor'));
  document.getElementById('gretPagadorEmpAbrir')?.addEventListener('click', () => openCat('transportista'));
  document.getElementById('gretCatCerrar')?.addEventListener('click', () => {
    if (catFormOpen) {
      catEditId = '';
      mostrarGretCatForm(false);
      renderCat();
      return;
    }
    closeSheet('gretCatPicker');
  });
  document.getElementById('gretCatNueva')?.addEventListener('click', () => {
    catEditId = '';
    buildGretCatForm(null);
    mostrarGretCatForm(true);
  });
  document.getElementById('gretCatGuardar')?.addEventListener('click', guardarGretCatNuevo);
  document.getElementById('gretCatBusqueda')?.addEventListener('input', renderCat);

  form.querySelectorAll('input[name="pagador_indicador"]').forEach((inp) => {
    inp.addEventListener('change', syncPagadorUi);
  });
  document.getElementById('gretRemDoc')?.addEventListener('input', () => {
    document.getElementById('gretRemTipo').value = tipoDesdeDoc(document.getElementById('gretRemDoc').value);
    syncPagadorUi();
  });
  document.getElementById('gretDestDoc')?.addEventListener('input', () => {
    document.getElementById('gretDestTipo').value = tipoDesdeDoc(document.getElementById('gretDestDoc').value);
  });

  btnPrev?.addEventListener('click', () => showStep(step - 1));
  btnNext?.addEventListener('click', () => {
    if (!puedeAvanzar(step)) {
      alert(mensajeBloqueo(step));
      return;
    }
    // Validación SUNAT: tu RUC no puede ser remitente ni destinatario
    if (step === 3) {
      const rem = digits(document.getElementById('gretRemDoc').value);
      const dest = digits(document.getElementById('gretDestDoc').value);
      if (companyRuc && (companyRuc === rem || companyRuc === dest)) {
        alert('En GRE transportista tu RUC no puede ser el remitente ni el destinatario.');
        return;
      }
    }
    showStep(step + 1);
  });

  document.querySelectorAll('.ios-wizard-dot').forEach((d) => {
    d.addEventListener('click', () => {
      const goto = Number(d.dataset.goto);
      if (goto < step) showStep(goto);
      else if (goto === step + 1 && puedeAvanzar(step)) showStep(goto);
    });
  });

  form.addEventListener('submit', (e) => {
    for (let p = 1; p <= 7; p += 1) {
      if (!puedeAvanzar(p)) {
        e.preventDefault();
        showStep(p);
        alert(mensajeBloqueo(p));
        return;
      }
    }
    const rem = digits(document.getElementById('gretRemDoc').value);
    const dest = digits(document.getElementById('gretDestDoc').value);
    if (companyRuc && (companyRuc === rem || companyRuc === dest)) {
      e.preventDefault();
      alert('En GRE transportista tu RUC no puede ser el remitente ni el destinatario.');
      return;
    }
    syncDocsHidden();
    syncBienesHidden();
    form.querySelectorAll(':disabled').forEach((el) => { el.disabled = false; });
    if (typeof window.showEmitLoading === 'function') {
      window.showEmitLoading('Emitiendo GRE-T…', 'Enviando a SUNAT. No cierres esta ventana.');
    }
    if (btnSubmit) {
      btnSubmit.disabled = true;
      btnSubmit.textContent = 'Emitiendo…';
    }
  });

  // Prefill ubicaciones from form
  setUbicacion('partida', document.getElementById('partidaUbigeo').value, document.getElementById('partidaDireccion').value);
  setUbicacion('llegada', document.getElementById('llegadaUbigeo').value, document.getElementById('llegadaDireccion').value);
  syncDocsUi();
  syncBienesUi();
  syncPagadorUi();
  showStep(1);

  // Refresh catalogs if APIs available
  if (vehiculosApi) {
    fetch(vehiculosApi, { headers: { Accept: 'application/json' } })
      .then((r) => r.json())
      .then((d) => { if (Array.isArray(d.items || d)) vehiculos = d.items || d; })
      .catch(() => {});
  }
  if (conductoresApi) {
    fetch(conductoresApi, { headers: { Accept: 'application/json' } })
      .then((r) => r.json())
      .then((d) => { if (Array.isArray(d.items || d)) conductores = d.items || d; })
      .catch(() => {});
  }
  if (transportistasApi) {
    fetch(transportistasApi, { headers: { Accept: 'application/json' } })
      .then((r) => r.json())
      .then((d) => { if (Array.isArray(d.items || d)) transportistas = d.items || d; })
      .catch(() => {});
  }
}());
