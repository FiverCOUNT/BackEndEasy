(function () {
  const form = document.getElementById('greEventoForm');
  if (!form) return;

  const pasosTitulos = {
    1: 'Tipo de evento',
    2: 'Documento relacionado',
    3: 'Detalle de la GRE',
    4: 'Nuevo tramo',
    5: 'Vehículo y conductor',
    6: 'Observación y resumen',
  };

  let step = 1;
  const max = 6;
  const PAGE = 10;
  const appBase = form.dataset.appBase || '/app';
  const guiasApi = form.dataset.guiasApi || '';
  const recibidasApi = form.dataset.recibidasApi || '';
  const vehiculosApi = form.dataset.vehiculosApi || '';
  const conductoresApi = form.dataset.conductoresApi || '';
  const btnPrev = document.getElementById('btnPrev');
  const btnNext = document.getElementById('btnNext');
  const btnSubmit = document.getElementById('btnSubmit');
  const titulo = document.getElementById('pasoTitulo');

  let guiaSel = null;
  /** Partida/llegada de la GRE relacionada (para validar destino distinto en eventos 2/3). */
  let tramoOriginal = { partida: {}, llegada: {} };
  let catMode = 'vehiculo';

  const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const FECHA_ITEM_H = 40;
  let fechaWheel = { day: 1, month: 1, year: new Date().getFullYear() };
  let fechaBuilt = false;

  function val(id) {
    return document.getElementById(id)?.value || '';
  }
  function setVal(id, value) {
    const el = document.getElementById(id);
    if (el) el.value = value == null ? '' : String(value);
  }
  function txt(v) {
    return String(v || '').trim();
  }
  function digits(v) {
    return String(v || '').replace(/\D/g, '');
  }
  /** Licencia MTC: letra + 8 o 9 dígitos (ej. Q007444402). SUNAT 2573 si no cumple. */
  function normalizeLicencia(v) {
    return String(v || '').trim().toUpperCase().replace(/[\s-]+/g, '');
  }
  function licenciaOk(v) {
    return /^[A-Z]\d{8,9}$/.test(normalizeLicencia(v));
  }

  function eventoSel() {
    return form.querySelector('input[name="codigo_evento"]:checked');
  }

  function eventoMeta() {
    const el = eventoSel();
    if (!el) return null;
    return {
      codigo: el.value,
      titulo: el.getAttribute('data-titulo') || el.value,
      pidePartida: el.getAttribute('data-partida') === '1',
      pideLlegada: el.getAttribute('data-llegada') === '1',
      pideVehiculo: el.getAttribute('data-vehiculo') === '1',
      pideConductor: el.getAttribute('data-conductor') === '1',
      pideCita: el.getAttribute('data-cita') === '1',
      vehiculoNuevo: el.getAttribute('data-vehiculo-nuevo') === '1',
      llegadaNueva: el.getAttribute('data-llegada-nueva') === '1',
      tramoFijo: el.getAttribute('data-tramo-fijo') === '1',
    };
  }

  function normUbic(dir, ubi) {
    return `${digits(ubi)}|${txt(dir).toUpperCase().replace(/\s+/g, ' ')}`;
  }

  function mismaLlegadaQueOriginal() {
    const orig = tramoOriginal.llegada || {};
    const oKey = normUbic(orig.direccion, orig.ubigeo);
    if (!digits(orig.ubigeo) && !txt(orig.direccion)) return false;
    const nKey = normUbic(val('llegadaDireccion'), val('llegadaUbigeo'));
    return Boolean(nKey) && nKey === oKey;
  }

  function showStep(n) {
    step = Math.max(1, Math.min(max, n));
    form.querySelectorAll('.ios-wizard-pane').forEach((pane) => {
      pane.classList.toggle('is-on', Number(pane.getAttribute('data-step')) === step);
    });
    document.querySelectorAll('#wizardSteps .ios-wizard-dot').forEach((dot) => {
      dot.classList.toggle('is-on', Number(dot.getAttribute('data-goto')) === step);
    });
    if (titulo) titulo.textContent = pasosTitulos[step] || '';
    if (btnPrev) btnPrev.hidden = step === 1;
    if (btnNext) btnNext.hidden = step === max;
    if (btnSubmit) btnSubmit.hidden = step !== max;
    if (step === 3) renderDetalle();
    if (step === 4) syncTramo();
    if (step === 5) syncTransporte();
    if (step === 6) renderResumen();
  }

  form.querySelectorAll('input[name="codigo_evento"]').forEach((el) => {
    el.addEventListener('change', () => {
      form.querySelectorAll('input[name="codigo_evento"]').forEach((r) => {
        r.closest('.ios-choice')?.classList.toggle('is-on', r.checked);
      });
      syncCita();
      syncTramo();
      syncTransporte();
      if (guiaSel) applyGuia(guiaSel);
    });
  });
  // Asegura selección visible de “Transbordo no programado” (u otra ya marcada).
  if (!eventoSel()) {
    const first = form.querySelector('input[name="codigo_evento"]');
    if (first) {
      first.checked = true;
      first.closest('.ios-choice')?.classList.add('is-on');
    }
  } else {
    eventoSel()?.closest('.ios-choice')?.classList.add('is-on');
  }
  syncCita();
  syncTramo();
  syncTransporte();

  function syncCita() {
    const wrap = document.getElementById('grevCitaWrap');
    const meta = eventoMeta();
    if (wrap) wrap.hidden = !(meta && meta.pideCita);
  }

  function setUbicLocked(kind, locked) {
    const abrir = document.getElementById(kind === 'partida' ? 'grevPartidaAbrir' : 'grevLlegadaAbrir');
    const quitar = document.getElementById(kind === 'partida' ? 'grevPartidaQuitar' : 'grevLlegadaQuitar');
    const hint = document.getElementById(kind === 'partida' ? 'grevPartidaFijoHint' : 'grevLlegadaFijoHint');
    if (abrir) {
      abrir.disabled = Boolean(locked);
      abrir.style.pointerEvents = locked ? 'none' : '';
      abrir.style.opacity = locked ? '0.85' : '';
    }
    if (quitar) quitar.hidden = true;
    if (hint) hint.hidden = !locked;
  }

  function syncTramo() {
    const meta = eventoMeta() || {};
    const esManual = val('grevGuiaOrigen') === 'manual' || guiaSel?.origen === 'manual';
    const fijo = Boolean(meta.tramoFijo) && !esManual;
    const hint = document.getElementById('grevTramoHint');
    const llegadaLab = document.getElementById('grevLlegadaLabel');
    const partidaLab = document.getElementById('grevPartidaLabel');
    const llegadaNuevaHint = document.getElementById('grevLlegadaNuevaHint');
    if (hint) {
      hint.textContent = esManual
        ? 'GRE manual: indica partida y llegada del tramo (no viven en Easy).'
        : (fijo
          ? 'Transbordo: partida y llegada se mantienen. Solo cambias vehículo y conductor en el siguiente paso.'
          : (meta.llegadaNueva || meta.pideLlegada
            ? 'Indica dónde se reinicia el traslado y el nuevo punto de llegada (distinto al original). El destinatario no cambia.'
            : 'Registra el tramo donde se reinicia el traslado.'));
    }
    if (partidaLab) {
      partidaLab.textContent = fijo ? 'Punto de inicio (GRE original)' : 'Punto de inicio del tramo *';
    }
    if (llegadaLab) {
      llegadaLab.textContent = (meta.pideLlegada || meta.llegadaNueva || esManual)
        ? 'Nuevo punto de llegada *'
        : 'Punto de llegada (GRE original)';
    }
    if (llegadaNuevaHint) {
      llegadaNuevaHint.hidden = !(meta.llegadaNueva || meta.pideLlegada) || fijo || esManual;
    }
    setUbicLocked('partida', fijo);
    setUbicLocked('llegada', fijo || (!meta.pideLlegada && !meta.llegadaNueva && !esManual));
    paintUbicCards();
  }

  function syncTransporte() {
    const meta = eventoMeta() || {};
    const veh = document.getElementById('grevVehCard');
    const cond = document.getElementById('grevCondCard');
    const hint = document.getElementById('grevTransHint');
    if (veh) veh.hidden = meta.pideVehiculo === false;
    if (cond) cond.hidden = meta.pideConductor === false;
    if (hint) {
      const esGret = String(val('grevGuiaTipo') || guiaSel?.tipo_doc) === '31';
      hint.textContent = meta.vehiculoNuevo
        ? 'Transbordo: placa y conductor del otro vehículo (mismo emisor).'
        : (meta.llegadaNueva || meta.pideLlegada
          ? 'Vehículo y conductor del tramo que se reinicia hacia el nuevo destino.'
          : (esGret
            ? 'GRE-T: placa y conductor del tramo (tú eres el transportista).'
            : 'GRE-R: placa y conductor del tramo (transporte privado del remitente).'));
    }
  }

  function envioDe(guia) {
    return (guia && guia.envio && typeof guia.envio === 'object') ? guia.envio : {};
  }

  function dirDe(punto) {
    if (!punto || typeof punto !== 'object') return '';
    const dir = txt(punto.direccion || punto.address || '');
    const ubi = txt(punto.ubigeo || '');
    return [dir, ubi].filter(Boolean).join(' · ') || '—';
  }

  function renderDocSel() {
    const wrap = document.getElementById('grevDocSel');
    const tituloBtn = document.getElementById('grevDocBtnTitulo');
    const detBtn = document.getElementById('grevDocBtnDetalle');
    if (!guiaSel) {
      if (wrap) wrap.innerHTML = '';
      if (tituloBtn) tituloBtn.textContent = 'Seleccionar GRE';
      if (detBtn) detBtn.textContent = 'Emitidas, recibidas o manual';
      return;
    }
    const ref = `${guiaSel.serie || ''}-${guiaSel.correlativo || ''}`;
    const tipo = String(guiaSel.tipo_doc || '09') === '31' ? 'GRE-T' : 'GRE-R';
    const esManual = guiaSel.origen === 'manual' || val('grevGuiaOrigen') === 'manual';
    if (tituloBtn) tituloBtn.textContent = `${tipo} ${ref}`;
    if (detBtn) {
      detBtn.textContent = esManual
        ? 'Referencia manual'
        : (guiaSel.destinatario || guiaSel.estado || '');
    }
    if (wrap) {
      const esRecibida = guiaSel.origen === 'compra' || guiaSel.origen === 'recibida'
        || val('grevGuiaOrigen') === 'recibida';
      let actions = '';
      if (!esManual && guiaSel.id) {
        const pdfUrl = esRecibida
          ? `${appBase}/compras/${encodeURIComponent(guiaSel.id)}/pdf`
          : `${appBase}/comprobantes/${encodeURIComponent(guiaSel.id)}/archivos/pdf?formato=a4`;
        actions = `<div class="ios-selected-card-actions">
            <a class="ios-selected-card-change" href="${pdfUrl}" target="_blank" rel="noopener" id="grevDocPdf">Visualizar</a>
          </div>`;
      }
      const badge = esManual ? 'Manual' : (esRecibida ? 'Recibida' : 'Emitida');
      wrap.innerHTML = `
        <div class="ios-selected-card">
          <div class="ios-selected-card-text">
            <strong>${tipo} ${ref}</strong>
            <span>${guiaSel.destinatario || guiaSel.cliente || guiaSel.destinatario_razon_social || ''} · ${badge}</span>
          </div>
          ${actions}
        </div>`;
    }
  }

  function applyGuia(guia) {
    guiaSel = guia;
    const origen = guia?.origen === 'compra' || guia?.origen === 'recibida'
      ? 'recibida'
      : (guia?.origen === 'manual' ? 'manual' : 'emitida');
    setVal('grevGuiaId', origen === 'manual' ? '' : (guia?.id || ''));
    setVal('grevGuiaOrigen', origen);
    setVal('grevGuiaTipo', guia?.tipo_doc || '09');
    setVal('grevGuiaSerie', guia?.serie || '');
    setVal('grevGuiaCorrelativo', guia?.correlativo || '');
    setVal('grevGuiaEmisorRuc', guia?.emisor_ruc || guia?.emisor_numero_doc || '');
    // Recibida GRE-R (soy transportista) → evento GRE-T (01). Emitida GRE-R → privado (02).
    if (origen === 'recibida' || String(guia?.tipo_doc) === '31') {
      setVal('grevModTraslado', '01');
    } else {
      setVal('grevModTraslado', '02');
    }
    setVal('grevRecTipo', guia?.destinatario_tipo_doc || '6');
    setVal('grevRecDoc', guia?.destinatario_doc || '');
    setVal('grevRecNombre', guia?.destinatario || guia?.destinatario_razon_social || '');
    setVal('grevRemTipo', guia?.remitente_tipo_doc || guia?.cliente_tipo_doc || '6');
    setVal('grevRemDoc', guia?.remitente_doc || guia?.cliente_doc || '');
    setVal('grevRemNombre', guia?.remitente || guia?.cliente_razon_social || guia?.cliente || '');
    const envio = envioDe(guia);
    setVal('grevCodTraslado', envio.cod_traslado || envio.codTraslado || '01');
    setVal('grevPeso', envio.peso_total || envio.pesoTotal || guia?.peso_total || '1');
    setVal('grevUndPeso', envio.und_peso_total || envio.undPesoTotal || guia?.und_peso_total || 'KGM');
    const partida = envio.partida || guia?.partida || {};
    const llegada = envio.llegada || guia?.llegada || {};
    // Conserva tramo original para validar destino distinto (eventos 2/3).
    if (origen !== 'manual') {
      tramoOriginal = {
        partida: {
          direccion: partida.direccion || '',
          ubigeo: partida.ubigeo || '',
        },
        llegada: {
          direccion: llegada.direccion || '',
          ubigeo: llegada.ubigeo || '',
        },
      };
    } else {
      tramoOriginal = { partida: {}, llegada: {} };
    }
    if (origen === 'manual') {
      setVal('partidaDireccion', '');
      setVal('partidaUbigeo', '');
      setVal('llegadaDireccion', '');
      setVal('llegadaUbigeo', '');
    } else {
      // Solo pisar si viene dato (el click rápido aplica resumen sin envío; el detalle llega luego).
      if (partida.direccion || partida.ubigeo) {
        setVal('partidaDireccion', partida.direccion || '');
        setVal('partidaUbigeo', partida.ubigeo || '');
      }
      if (llegada.direccion || llegada.ubigeo) {
        setVal('llegadaDireccion', llegada.direccion || '');
        setVal('llegadaUbigeo', llegada.ubigeo || '');
      }
    }
    const meta = eventoMeta() || {};
    // Eventos 2/3: forzar elegir nuevo destino (como transbordo fuerza otra placa).
    const esCorreccion = !!txt(val('grevComprobanteId'));
    if ((meta.llegadaNueva || meta.pideLlegada) && !meta.tramoFijo && origen !== 'manual' && !esCorreccion) {
      setVal('llegadaDireccion', '');
      setVal('llegadaUbigeo', '');
    }
    paintUbicCards();
    syncTramo();
    // Transbordo: no heredar placa/conductor (debe ser otro vehículo).
    if (!meta.vehiculoNuevo) {
      const veh = envio.vehiculo || {};
      const placa = veh.placa || guia?.vehiculo_placa || '';
      if (!txt(val('grevVehPlaca'))) setVal('grevVehPlaca', placa);
      const cond = envio.conductor || {};
      if (!txt(val('grevCondDoc'))) {
        setVal('grevCondDoc', cond.numero_doc || cond.num_doc || guia?.conductor_numero_doc || '');
      }
      if (!txt(val('grevCondNombre'))) {
        setVal('grevCondNombre', cond.nombres || cond.nombre || guia?.conductor_nombres || '');
      }
      if (!txt(val('grevCondLic'))) setVal('grevCondLic', cond.licencia || guia?.conductor_licencia || '');
    } else {
      setVal('grevVehId', '');
      setVal('grevVehPlaca', '');
      setVal('grevCondId', '');
      setVal('grevCondDoc', '');
      setVal('grevCondNombre', '');
      setVal('grevCondLic', '');
      const vt = document.getElementById('grevVehBtnTitulo');
      const vd = document.getElementById('grevVehBtnDetalle');
      const ct = document.getElementById('grevCondBtnTitulo');
      const cd = document.getElementById('grevCondBtnDetalle');
      if (vt) vt.textContent = 'Elegir otro vehículo';
      if (vd) vd.textContent = 'Placa distinta a la GRE original';
      if (ct) ct.textContent = 'Elegir conductor';
      if (cd) cd.textContent = 'DNI del conductor del nuevo tramo';
    }
    const hidden = document.getElementById('grevBienesHidden');
    if (hidden) {
      hidden.innerHTML = '';
      const lineas = (guia.lineas && guia.lineas.length)
        ? guia.lineas
        : (origen === 'manual'
          ? [{ descripcion: `Bienes según ${String(guia.tipo_doc) === '31' ? 'GRE-T' : 'GRE-R'} ${guia.serie}-${guia.correlativo}`, cantidad: 1, unidad: 'NIU' }]
          : []);
      lineas.forEach((l) => {
        hidden.insertAdjacentHTML('beforeend', [
          `<input type="hidden" name="linea_descripcion" value="${escapeAttr(l.descripcion || l.nombre || 'Ítem')}" />`,
          `<input type="hidden" name="linea_unidad" value="${escapeAttr(l.unidad || 'NIU')}" />`,
          `<input type="hidden" name="linea_cantidad" value="${escapeAttr(l.cantidad || 1)}" />`,
          `<input type="hidden" name="linea_precio_unitario" value="0" />`,
          l.catalog_item_id ? `<input type="hidden" name="linea_catalog_item_id" value="${escapeAttr(l.catalog_item_id)}" />` : '',
        ].join(''));
      });
    }
    renderDocSel();
    renderDetalle();
  }

  function escapeAttr(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;');
  }

  function renderDetalle() {
    const guia = guiaSel;
    const envio = envioDe(guia);
    const esManual = guia?.origen === 'manual' || val('grevGuiaOrigen') === 'manual';
    const hint = document.getElementById('grevDetalleHint');
    if (hint) {
      hint.textContent = esManual
        ? 'Referencia manual: partida y llegada las defines en el siguiente paso.'
        : 'Datos tomados de la GRE original. No se editan aquí.';
    }
    setText('grevDetRef', guia ? `${String(guia.tipo_doc) === '31' ? 'GRE-T' : 'GRE-R'} ${guia.serie}-${guia.correlativo}${esManual ? ' · Manual' : ''}` : 'Selecciona una GRE');
    setText('grevDetDest', guia ? `${guia.destinatario || '—'} · ${guia.destinatario_doc || ''}` : '—');
    setText('grevDetPartida', esManual ? 'La defines en el tramo' : dirDe(envio.partida));
    setText('grevDetLlegada', esManual ? 'La defines en el tramo' : dirDe(envio.llegada));
    const bienes = (guia?.lineas || []).map((l) => `${l.cantidad || 1} ${l.unidad || 'NIU'} ${l.descripcion || l.nombre || ''}`.trim());
    setText('grevDetBienes', bienes.length ? bienes.join(' · ') : (esManual ? 'Referencia genérica' : '—'));
  }

  function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value || '—';
  }

  function renderResumen() {
    const meta = eventoMeta();
    setText('sumEvento', meta ? `${meta.codigo} · ${meta.titulo}` : '—');
    setText('sumDoc', guiaSel ? `${guiaSel.serie}-${guiaSel.correlativo}` : '—');
    setText('sumTramo', [
      txt(val('partidaDireccion')) || 'Sin partida',
      txt(val('llegadaDireccion')) || 'Llegada original',
      val('grevFecha'),
    ].filter(Boolean).join(' → '));
    setText('sumTransporte', [
      txt(val('grevVehPlaca')) ? `Placa ${txt(val('grevVehPlaca')).toUpperCase()}` : '',
      txt(val('grevCondNombre')) || txt(val('grevCondDoc')),
    ].filter(Boolean).join(' · ') || '—');
  }

  function validateStep() {
    if (step === 1 && !eventoSel()) return 'Selecciona el tipo de evento.';
    if (step === 2) {
      const hayId = txt(val('grevGuiaId'));
      const hayManual = val('grevGuiaOrigen') === 'manual'
        && txt(val('grevGuiaSerie'))
        && txt(val('grevGuiaCorrelativo'));
      if (!hayId && !hayManual) return 'Selecciona o agrega la GRE relacionada.';
      if (hayManual && !digits(val('grevRecDoc'))) return 'Indica el documento del destinatario.';
      if (hayManual && !txt(val('grevRecNombre'))) return 'Indica el nombre del destinatario.';
      if (hayManual && String(val('grevGuiaTipo')) === '31') {
        if (!digits(val('grevRemDoc'))) return 'En GRE-T indica el RUC del remitente.';
        if (!txt(val('grevRemNombre'))) return 'En GRE-T indica la razón social del remitente.';
      }
    }
    if (step === 4) {
      const meta = eventoMeta() || {};
      const esManual = val('grevGuiaOrigen') === 'manual';
      if (!val('grevFecha')) {
        const n = new Date();
        setVal('grevFecha', `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`);
      }
      if (meta.tramoFijo && !esManual) {
        if (!txt(val('partidaDireccion')) || digits(val('partidaUbigeo')).length !== 6) {
          return 'La GRE relacionada no tiene punto de partida completo.';
        }
        if (!txt(val('llegadaDireccion')) || digits(val('llegadaUbigeo')).length !== 6) {
          return 'La GRE relacionada no tiene punto de llegada completo.';
        }
        return '';
      }
      if ((meta.pidePartida !== false || esManual || meta.tramoFijo)
        && (!txt(val('partidaDireccion')) || digits(val('partidaUbigeo')).length !== 6)) {
        return 'Completa el punto de inicio del tramo (dirección y ubigeo de 6 dígitos).';
      }
      if ((meta.pideLlegada || meta.llegadaNueva || esManual || meta.tramoFijo)
        && (!txt(val('llegadaDireccion')) || digits(val('llegadaUbigeo')).length !== 6)) {
        return esManual || meta.tramoFijo
          ? 'Completa el punto de llegada.'
          : 'Este evento pide un nuevo punto de llegada.';
      }
      if ((meta.llegadaNueva || meta.pideLlegada) && !esManual && !meta.tramoFijo && mismaLlegadaQueOriginal()) {
        return 'El nuevo punto de llegada debe ser distinto al de la GRE original.';
      }
      if (meta.pideCita && !txt(val('grevCita'))) return 'Indica el número de cita u orden de entrega.';
    }
    if (step === 5) {
      const meta = eventoMeta() || {};
      const placa = txt(val('grevVehPlaca')).toUpperCase().replace(/[\s-]+/g, '');
      if (meta.pideVehiculo !== false && !placa) {
        return meta.vehiculoNuevo
          ? 'Indica la placa del otro vehículo (transbordo).'
          : 'La placa del vehículo es obligatoria.';
      }
      if (meta.vehiculoNuevo) {
        const orig = String(envioDe(guiaSel).vehiculo?.placa || '').toUpperCase().replace(/[\s-]+/g, '');
        if (orig && placa === orig) {
          return 'En transbordo la placa debe ser distinta a la de la GRE original.';
        }
      }
      if (meta.pideConductor !== false && (digits(val('grevCondDoc')).length !== 8 || !txt(val('grevCondNombre')))) {
        return 'El conductor (DNI de 8 dígitos y nombres) es obligatorio.';
      }
      if (meta.pideConductor !== false) {
        const lic = normalizeLicencia(val('grevCondLic'));
        if (!lic) return 'La licencia de conducir es obligatoria (formato MTC, ej. Q007444402).';
        if (!licenciaOk(lic)) {
          return 'Licencia inválida. Debe ser letra + 8 o 9 dígitos (ej. Q007444402). SUNAT rechaza valores como nombres o textos cortos.';
        }
        setVal('grevCondLic', lic);
      }
    }
    return '';
  }

  btnNext?.addEventListener('click', () => {
    const err = validateStep();
    if (err) {
      alert(err);
      return;
    }
    showStep(step + 1);
  });
  btnPrev?.addEventListener('click', () => showStep(step - 1));
  document.querySelectorAll('#wizardSteps .ios-wizard-dot').forEach((dot) => {
    dot.addEventListener('click', () => {
      const dest = Number(dot.getAttribute('data-goto'));
      if (dest < step) showStep(dest);
    });
  });

  form.addEventListener('submit', (ev) => {
    const err = validateStep();
    if (err) {
      ev.preventDefault();
      alert(err);
      return;
    }
    if (typeof window.showEmitLoading === 'function') {
      window.showEmitLoading('Emitiendo GRE por evento…', 'Enviando a SUNAT. No cierres esta ventana.');
    }
  });

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

  function renderGuiasLista() {
    const lista = document.getElementById('grevDocLista');
    const status = document.getElementById('grevDocStatus');
    const mas = document.getElementById('grevDocMas');
    const esRecibida = docState.origen === 'recibida';
    if (status) {
      if (docState.loading && !docState.items.length) status.textContent = 'Cargando…';
      else if (!docState.items.length) {
        status.textContent = esRecibida
          ? 'No hay GRE-R recibidas (donde eres transportista)'
          : 'No hay GRE emitidas aceptadas';
      } else {
        status.textContent = docState.hasMore
          ? `${docState.items.length} de ${docState.total}`
          : `${docState.total} guía${docState.total === 1 ? '' : 's'}`;
      }
    }
    if (lista) {
      lista.innerHTML = '';
      docState.items.forEach((g) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'ios-sheet-item';
        const tipo = String(g.tipo_doc) === '31' ? 'GRE-T' : 'GRE-R';
        const sub = esRecibida
          ? (g.cliente || g.cliente_razon_social || g.ref || '')
          : (g.destinatario || g.estado || '');
        btn.innerHTML = `<strong>${tipo} ${g.serie}-${g.correlativo}</strong><span>${sub}</span>`;
        btn.addEventListener('click', () => elegirGuia(g));
        lista.appendChild(btn);
      });
    }
    if (mas) {
      mas.hidden = !docState.hasMore;
      mas.disabled = docState.loading;
      mas.textContent = docState.loading ? 'Cargando…' : 'Ver más';
    }
  }

  function docApiBase() {
    return docState.origen === 'recibida' ? recibidasApi : guiasApi;
  }

  function cargarGuias(reset) {
    const api = docApiBase();
    if (!api || docState.loading) return;
    if (reset) {
      docState.items = [];
      docState.offset = 0;
      docState.hasMore = false;
      docState.total = 0;
    }
    docState.loading = true;
    renderGuiasLista();
    const url = api
      + '?offset=' + encodeURIComponent(docState.offset)
      + '&limit=' + PAGE
      + '&q=' + encodeURIComponent(docState.q);
    fetch(url, { credentials: 'same-origin', headers: { Accept: 'application/json' } })
      .then((r) => r.json())
      .then((data) => {
        const nuevos = Array.isArray(data.items) ? data.items : [];
        docState.items = docState.items.concat(nuevos);
        docState.total = Number(data.total) || docState.items.length;
        docState.offset = Number(data.next_offset) || docState.items.length;
        docState.hasMore = data.has_more === true;
      })
      .catch(() => {
        const status = document.getElementById('grevDocStatus');
        if (status) status.textContent = 'No se pudo cargar la lista';
      })
      .finally(() => {
        docState.loading = false;
        renderGuiasLista();
      });
  }

  function mapRecibidaToGuia(item) {
    return {
      id: item.id,
      origen: 'recibida',
      tipo_doc: item.tipo_doc || '09',
      serie: item.serie,
      correlativo: item.correlativo,
      estado: item.estado || 'ACEPTADO',
      destinatario: item.destinatario_razon_social || item.destinatario || '',
      destinatario_doc: item.destinatario_doc || '',
      destinatario_tipo_doc: item.destinatario_tipo_doc || '6',
      remitente: item.cliente_razon_social || item.cliente || '',
      remitente_doc: item.cliente_doc || '',
      remitente_tipo_doc: item.cliente_tipo_doc || '6',
      cliente: item.cliente,
      cliente_doc: item.cliente_doc,
      cliente_razon_social: item.cliente_razon_social,
      peso_total: item.peso_total,
      und_peso_total: item.und_peso_total,
      vehiculo_placa: item.vehiculo_placa,
      conductor_numero_doc: item.conductor_numero_doc,
      conductor_nombres: item.conductor_nombres,
      conductor_licencia: item.conductor_licencia,
      partida: item.partida,
      llegada: item.llegada,
      envio: {
        peso_total: item.peso_total,
        und_peso_total: item.und_peso_total || 'KGM',
        partida: item.partida || {},
        llegada: item.llegada || {},
        vehiculo: item.vehiculo_placa ? { placa: item.vehiculo_placa } : undefined,
        conductor: item.conductor_numero_doc ? {
          numero_doc: item.conductor_numero_doc,
          nombres: item.conductor_nombres,
          licencia: item.conductor_licencia,
        } : undefined,
      },
      lineas: item.lineas || [],
    };
  }

  function elegirGuia(resumen) {
    const id = resumen && resumen.id;
    if (!id) return;
    if (docState.origen === 'recibida' || resumen.origen === 'compra' || resumen.origen === 'recibida') {
      applyGuia(mapRecibidaToGuia(resumen));
      closeSheet('grevDocPicker');
      return;
    }
    // Aplicar de inmediato con lo de la lista; el detalle (envio/líneas) llega en background.
    resumen.origen = 'emitida';
    applyGuia(resumen);
    closeSheet('grevDocPicker');
    if (!guiasApi) return;
    fetch(guiasApi.replace(/\/?$/, '/') + encodeURIComponent(id), {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    })
      .then((r) => r.json())
      .then((data) => {
        const item = data.item || data;
        if (!item || !item.id) return;
        // Solo si sigue seleccionada la misma guía.
        if (String(val('grevGuiaId')) !== String(item.id)) return;
        item.origen = 'emitida';
        applyGuia(item);
      })
      .catch(() => { /* ya quedó la selección básica */ });
  }

  const docState = {
    items: [], offset: 0, hasMore: false, total: 0, q: '', loading: false, timer: null, origen: 'emitida',
  };

  document.querySelectorAll('#grevDocOrigenSeg label').forEach((lab) => {
    lab.addEventListener('click', () => {
      const origen = lab.getAttribute('data-origen') || 'emitida';
      docState.origen = origen;
      document.querySelectorAll('#grevDocOrigenSeg label').forEach((l) => {
        l.classList.toggle('is-on', l === lab);
      });
      const search = document.getElementById('grevDocBusqueda');
      if (search) {
        search.placeholder = origen === 'recibida'
          ? 'Serie, remitente…'
          : 'Serie, destinatario…';
      }
      cargarGuias(true);
    });
  });

  document.getElementById('grevDocAbrir')?.addEventListener('click', () => {
    openSheet('grevDocPicker');
    if (!docState.items.length) cargarGuias(true);
    else renderGuiasLista();
  });
  document.getElementById('grevDocCerrar')?.addEventListener('click', () => closeSheet('grevDocPicker'));
  document.getElementById('grevDocMas')?.addEventListener('click', () => {
    if (docState.hasMore && !docState.loading) cargarGuias(false);
  });
  document.getElementById('grevDocBusqueda')?.addEventListener('input', (e) => {
    docState.q = txt(e.target.value);
    clearTimeout(docState.timer);
    docState.timer = setTimeout(() => cargarGuias(true), 280);
  });

  function abrirManualGuia() {
    closeSheet('grevDocPicker');
    const serieEl = document.getElementById('grevManualSerie');
    const numEl = document.getElementById('grevManualNumero');
    if (serieEl && !serieEl.value && docState.q) {
      const parts = docState.q.split(/[\s-]+/).map((p) => p.trim()).filter(Boolean);
      if (parts[0]) serieEl.value = parts[0].toUpperCase().slice(0, 4);
      if (parts[1] && numEl) numEl.value = parts[1].replace(/\D/g, '').slice(0, 8);
    }
    openSheet('grevDocManualPicker');
    serieEl?.focus();
  }
  function cerrarManualGuia() {
    closeSheet('grevDocManualPicker');
  }
  function syncManualRemWrap() {
    const tipo = document.getElementById('grevManualTipo')?.value || '09';
    const wrap = document.getElementById('grevManualRemWrap');
    if (wrap) wrap.hidden = tipo !== '31';
  }

  function agregarGuiaManual() {
    const tipo = String(document.getElementById('grevManualTipo')?.value || '09').trim();
    const serie = String(document.getElementById('grevManualSerie')?.value || '').trim().toUpperCase();
    const numero = digits(document.getElementById('grevManualNumero')?.value || '');
    const emisorRuc = digits(document.getElementById('grevManualEmisorRuc')?.value || '');
    const destDoc = digits(document.getElementById('grevManualDestDoc')?.value || '');
    const destNombre = txt(document.getElementById('grevManualDestNombre')?.value || '');
    const remDoc = digits(document.getElementById('grevManualRemDoc')?.value || '');
    const remNombre = txt(document.getElementById('grevManualRemNombre')?.value || '');
    if (!serie || !numero) {
      alert('Indica serie y número de la GRE.');
      return;
    }
    if (serie.length > 4) {
      alert('La serie debe tener hasta 4 caracteres.');
      return;
    }
    if (emisorRuc && emisorRuc.length !== 11) {
      alert('El RUC emisor debe tener 11 dígitos.');
      return;
    }
    if (!destDoc || !destNombre) {
      alert('Indica documento y nombre del destinatario.');
      return;
    }
    if (tipo === '31' && (!remDoc || !remNombre)) {
      alert('En GRE-T indica el remitente (RUC y razón social).');
      return;
    }
    const corr = String(Number(numero) || numero);
    const stub = {
      id: '',
      origen: 'manual',
      tipo_doc: tipo,
      serie,
      correlativo: corr,
      emisor_ruc: emisorRuc,
      emisor_numero_doc: emisorRuc,
      destinatario_tipo_doc: destDoc.length === 11 ? '6' : '1',
      destinatario_doc: destDoc,
      destinatario: destNombre,
      destinatario_razon_social: destNombre,
      remitente_tipo_doc: '6',
      remitente_doc: remDoc,
      remitente: remNombre,
      cliente_doc: remDoc,
      cliente_razon_social: remNombre,
      cliente: remNombre,
      estado: 'MANUAL',
      lineas: [{
        descripcion: `Bienes según ${tipo === '31' ? 'GRE-T' : 'GRE-R'} ${serie}-${corr}`,
        cantidad: 1,
        unidad: 'NIU',
      }],
      envio: {},
    };
    cerrarManualGuia();
    applyGuia(stub);
  }
  document.getElementById('grevDocManualAbrir')?.addEventListener('click', abrirManualGuia);
  document.getElementById('grevDocManualDesdeLista')?.addEventListener('click', abrirManualGuia);
  document.getElementById('grevDocManualCerrar')?.addEventListener('click', cerrarManualGuia);
  document.getElementById('grevDocManualAgregar')?.addEventListener('click', agregarGuiaManual);
  document.getElementById('grevDocManualPicker')?.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) cerrarManualGuia();
  });
  document.getElementById('grevManualTipo')?.addEventListener('change', () => {
    const tipo = document.getElementById('grevManualTipo')?.value || '09';
    const serie = document.getElementById('grevManualSerie');
    if (serie && !serie.value) serie.placeholder = tipo === '31' ? 'EG07' : 'T001';
    syncManualRemWrap();
  });
  syncManualRemWrap();

  const catState = {
    vehiculo: { items: [], offset: 0, hasMore: false, total: 0, q: '', loading: false },
    conductor: { items: [], offset: 0, hasMore: false, total: 0, q: '', loading: false },
    timer: null,
  };
  let catFormOpen = false;
  let catEditId = '';

  function catApi() {
    return catMode === 'vehiculo' ? vehiculosApi : conductoresApi;
  }

  function mostrarCatForm(on) {
    catFormOpen = !!on;
    const listaWrap = document.getElementById('grevCatListaWrap');
    const formWrap = document.getElementById('grevCatFormWrap');
    const nueva = document.getElementById('grevCatNueva');
    const tituloEl = document.getElementById('grevCatTitulo');
    if (listaWrap) listaWrap.hidden = !!on;
    if (formWrap) formWrap.hidden = !on;
    if (nueva) nueva.hidden = !!on;
    if (tituloEl) {
      tituloEl.textContent = on
        ? (catEditId ? 'Editar' : 'Añadir')
        : (catMode === 'vehiculo' ? 'Vehículos' : 'Conductores');
    }
    const mas = document.getElementById('grevCatMas');
    if (mas && on) mas.hidden = true;
  }

  function buildCatForm(item) {
    const fields = document.getElementById('grevCatFormFields');
    if (!fields) return;
    if (catMode === 'vehiculo') {
      fields.innerHTML =
        '<label class="ios-field"><span>Placa</span>'
        + '<input type="text" id="grevCatField_placa" maxlength="15" autocomplete="off" /></label>'
        + '<label class="ios-field"><span>Nro. circulación / TUCE (opcional)</span>'
        + '<input type="text" id="grevCatField_nro_circulacion" autocomplete="off" /></label>';
      if (item) {
        setVal('grevCatField_placa', item.placa || '');
        setVal('grevCatField_nro_circulacion', item.nro_circulacion || item.nroCirculacion || '');
      }
    } else {
      fields.innerHTML =
        '<label class="ios-field"><span>DNI / documento</span>'
        + '<input type="text" id="grevCatField_numero_doc" inputmode="numeric" maxlength="12" autocomplete="off" /></label>'
        + '<label class="ios-field"><span>Nombres completos</span>'
        + '<input type="text" id="grevCatField_nombres" autocomplete="off" /></label>'
        + '<label class="ios-field"><span>Licencia MTC</span>'
        + '<input type="text" id="grevCatField_licencia" maxlength="10" placeholder="Ej. Q007444402" autocomplete="off" style="text-transform:uppercase;" /></label>';
      if (item) {
        setVal('grevCatField_numero_doc', item.numero_doc || item.num_doc || '');
        setVal('grevCatField_nombres', item.nombres_completos || item.nombres || item.nombre || '');
        setVal('grevCatField_licencia', item.licencia || '');
      }
    }
  }

  function catField(id) {
    return txt(document.getElementById(id)?.value);
  }

  function aplicarVehiculo(it) {
    setVal('grevVehId', it.id || '');
    setVal('grevVehPlaca', it.placa || '');
    const t = document.getElementById('grevVehBtnTitulo');
    const d = document.getElementById('grevVehBtnDetalle');
    if (t) t.textContent = it.placa || 'Vehículo';
    if (d) d.textContent = it.nro_circulacion || it.nombre || 'Seleccionado';
  }

  function aplicarConductor(it) {
    const nom = it.nombres_completos || it.nombres || it.nombre || '';
    setVal('grevCondId', it.id || '');
    setVal('grevCondDoc', it.numero_doc || '');
    setVal('grevCondNombre', nom);
    setVal('grevCondLic', it.licencia || '');
    const t = document.getElementById('grevCondBtnTitulo');
    const d = document.getElementById('grevCondBtnDetalle');
    if (t) t.textContent = nom || 'Conductor';
    if (d) d.textContent = it.numero_doc || 'Seleccionado';
  }

  function guardarCatNuevo() {
    const api = catApi();
    if (!api) return;
    let body;
    let err;
    if (catMode === 'vehiculo') {
      body = {
        placa: catField('grevCatField_placa').toUpperCase().replace(/[\s-]+/g, ''),
        nro_circulacion: catField('grevCatField_nro_circulacion'),
      };
      if (!body.placa || body.placa.length < 5) err = 'Placa inválida';
    } else {
      body = {
        tipo_doc: '1',
        numero_doc: catField('grevCatField_numero_doc').replace(/\D/g, ''),
        nombres_completos: catField('grevCatField_nombres'),
        licencia: normalizeLicencia(catField('grevCatField_licencia')),
      };
      if (body.numero_doc.length < 8) err = 'Documento inválido';
      else if (!body.nombres_completos) err = 'Nombres obligatorios';
      else if (body.licencia && !licenciaOk(body.licencia)) {
        err = 'Licencia inválida (letra + 8 o 9 dígitos, ej. Q007444402)';
      }
    }
    if (err) {
      alert(err);
      return;
    }
    const btn = document.getElementById('grevCatGuardar');
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Guardando…';
    }
    const url = catEditId ? `${api}/${encodeURIComponent(catEditId)}` : api;
    fetch(url, {
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
        if (catMode === 'vehiculo') aplicarVehiculo(saved);
        else aplicarConductor(saved);
        catEditId = '';
        mostrarCatForm(false);
        closeSheet('grevCatPicker');
        catState[catMode].items = [];
      })
      .catch((e) => alert(e.message || 'Error al guardar'))
      .finally(() => {
        if (btn) {
          btn.disabled = false;
          btn.textContent = 'Guardar';
        }
      });
  }

  function renderCat() {
    const st = catState[catMode];
    const lista = document.getElementById('grevCatLista');
    const status = document.getElementById('grevCatStatus');
    const mas = document.getElementById('grevCatMas');
    if (status) {
      if (st.loading && !st.items.length) status.textContent = 'Cargando…';
      else if (!st.items.length) status.textContent = st.q ? 'Sin resultados' : 'Sin registros. Toca Añadir.';
      else status.textContent = st.hasMore
        ? `${st.items.length} de ${st.total}`
        : `${st.total}`;
    }
    if (lista) {
      lista.innerHTML = '';
      st.items.forEach((it) => {
        const row = document.createElement('div');
        row.className = 'ios-sheet-item-row';
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'ios-sheet-item';
        if (catMode === 'vehiculo') {
          btn.innerHTML = `<strong>${it.placa || 'Sin placa'}</strong><span>${it.nro_circulacion || it.nombre || it.marca || ''}</span>`;
          btn.addEventListener('click', () => {
            aplicarVehiculo(it);
            closeSheet('grevCatPicker');
          });
        } else {
          const nom = it.nombres_completos || it.nombres || it.nombre || '';
          const lic = it.licencia ? ` · Lic. ${it.licencia}` : '';
          btn.innerHTML = `<strong>${nom || it.numero_doc || 'Conductor'}</strong><span>${it.numero_doc || ''}${lic}</span>`;
          btn.addEventListener('click', () => {
            aplicarConductor(it);
            closeSheet('grevCatPicker');
          });
        }
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
          buildCatForm(it);
          mostrarCatForm(true);
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
    if (mas) {
      mas.hidden = !st.hasMore || catFormOpen;
      mas.disabled = st.loading;
      mas.textContent = st.loading ? 'Cargando…' : 'Ver más';
    }
  }

  function cargarCat(reset) {
    const st = catState[catMode];
    const api = catApi();
    if (!api || st.loading) return;
    if (reset) {
      st.items = [];
      st.offset = 0;
      st.hasMore = false;
      st.total = 0;
    }
    st.loading = true;
    renderCat();
    const url = api
      + '?offset=' + encodeURIComponent(st.offset)
      + '&limit=' + PAGE
      + '&q=' + encodeURIComponent(st.q);
    fetch(url, { credentials: 'same-origin', headers: { Accept: 'application/json' } })
      .then((r) => r.json())
      .then((data) => {
        const nuevos = Array.isArray(data.items) ? data.items : [];
        st.items = st.items.concat(nuevos);
        st.total = Number(data.total) || st.items.length;
        st.offset = Number(data.next_offset) || st.items.length;
        st.hasMore = data.has_more === true;
      })
      .catch(() => {
        const status = document.getElementById('grevCatStatus');
        if (status) status.textContent = 'No se pudo cargar la lista';
      })
      .finally(() => {
        st.loading = false;
        renderCat();
      });
  }

  function openCat(mode) {
    catMode = mode;
    catEditId = '';
    mostrarCatForm(false);
    const busqueda = document.getElementById('grevCatBusqueda');
    if (busqueda) {
      busqueda.value = catState[mode].q || '';
      busqueda.placeholder = mode === 'vehiculo' ? 'Placa…' : 'Nombre, DNI o licencia…';
    }
    openSheet('grevCatPicker');
    const st = catState[catMode];
    if (!st.items.length) cargarCat(true);
    else renderCat();
  }

  function closeCatPicker() {
    mostrarCatForm(false);
    closeSheet('grevCatPicker');
  }

  document.getElementById('grevVehAbrir')?.addEventListener('click', () => openCat('vehiculo'));
  document.getElementById('grevCondAbrir')?.addEventListener('click', () => openCat('conductor'));
  document.getElementById('grevCatCerrar')?.addEventListener('click', () => {
    if (catFormOpen) {
      catEditId = '';
      mostrarCatForm(false);
      renderCat();
      return;
    }
    closeCatPicker();
  });
  document.getElementById('grevCatNueva')?.addEventListener('click', () => {
    catEditId = '';
    buildCatForm(null);
    mostrarCatForm(true);
  });
  document.getElementById('grevCatGuardar')?.addEventListener('click', guardarCatNuevo);
  document.getElementById('grevCatMas')?.addEventListener('click', () => {
    const st = catState[catMode];
    if (st.hasMore && !st.loading) cargarCat(false);
  });
  document.getElementById('grevCatBusqueda')?.addEventListener('input', (e) => {
    catState[catMode].q = txt(e.target.value);
    clearTimeout(catState.timer);
    catState.timer = setTimeout(() => cargarCat(true), 280);
  });

  function paintUbicCards() {
    const meta = eventoMeta() || {};
    [['partida', 'grevPartida'], ['llegada', 'grevLlegada']].forEach(([kind, prefix]) => {
      const u = txt(val(kind + 'Ubigeo'));
      const d = txt(val(kind + 'Direccion'));
      const hay = Boolean(u || d);
      const btn = document.getElementById(prefix + 'Abrir');
      const tit = document.getElementById(prefix + 'BtnTitulo');
      const det = document.getElementById(prefix + 'BtnDetalle');
      const clr = document.getElementById(prefix + 'Quitar');
      if (btn) {
        btn.classList.toggle('is-on', hay);
        btn.classList.toggle('is-empty', !hay);
      }
      if (tit) tit.textContent = hay ? (d || 'Ubicación seleccionada') : 'Toca para elegir ubicación';
      if (det) {
        if (hay) {
          det.textContent = u ? ('Ubigeo ' + u) : 'Toca para cambiar';
        } else if (kind === 'partida') {
          det.textContent = 'Obligatorio · región, distrito y dirección';
        } else if (meta.llegadaNueva || meta.pideLlegada) {
          det.textContent = 'Obligatorio · distinto al de la GRE original';
        } else {
          det.textContent = 'Se mantiene el de la GRE relacionada';
        }
      }
      if (clr) clr.hidden = !hay || Boolean(meta.tramoFijo);
    });
  }

  if (window.EasyUbicacion) {
    window.EasyUbicacion.bindPick({
      openBtn: 'grevPartidaAbrir',
      clearBtn: 'grevPartidaQuitar',
      pickBtn: 'grevPartidaAbrir',
      titleEl: 'grevPartidaBtnTitulo',
      detailEl: 'grevPartidaBtnDetalle',
      title: 'Inicio del tramo',
      fields: { ubigeo: 'partidaUbigeo', direccion: 'partidaDireccion' },
      onApply: paintUbicCards,
      onClear: paintUbicCards,
    });
    window.EasyUbicacion.bindPick({
      openBtn: 'grevLlegadaAbrir',
      clearBtn: 'grevLlegadaQuitar',
      pickBtn: 'grevLlegadaAbrir',
      titleEl: 'grevLlegadaBtnTitulo',
      detailEl: 'grevLlegadaBtnDetalle',
      title: 'Nuevo punto de llegada',
      emptyDetail: 'Obligatorio · distinto al de la GRE original',
      fields: { ubigeo: 'llegadaUbigeo', direccion: 'llegadaDireccion' },
      onApply: paintUbicCards,
      onClear: paintUbicCards,
    });
  }
  paintUbicCards();

  function pad2(n) {
    return String(n).padStart(2, '0');
  }
  function daysInMonth(year, month) {
    return new Date(year, month, 0).getDate();
  }
  function parseIsoFecha(iso) {
    const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) {
      const now = new Date();
      return { day: now.getDate(), month: now.getMonth() + 1, year: now.getFullYear() };
    }
    return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
  }
  function toIsoFecha(y, mo, d) {
    return `${y}-${pad2(mo)}-${pad2(d)}`;
  }
  function formatFechaUi(iso) {
    const p = parseIsoFecha(iso);
    if (!iso) return 'Elegir';
    return `${p.day} ${MESES[p.month - 1]} ${p.year}`;
  }
  function pintarFechaLabel() {
    const iso = val('grevFecha');
    const lab = document.getElementById('grevFechaLabel');
    if (lab) {
      lab.textContent = formatFechaUi(iso);
      lab.classList.toggle('is-empty', !iso);
    }
  }
  function fechaCol(name) {
    return document.querySelector(`#grevFechaWheel .ios-date-wheel-unit[data-col="${name}"] .ios-date-wheel-col`);
  }
  function buildFechaCol(listEl, values, formatter) {
    if (!listEl) return;
    let html = '<li class="ios-date-wheel-spacer" aria-hidden="true"></li><li class="ios-date-wheel-spacer" aria-hidden="true"></li>';
    values.forEach((v) => {
      html += `<li class="ios-date-wheel-item" data-value="${v}">${formatter ? formatter(v) : v}</li>`;
    });
    html += '<li class="ios-date-wheel-spacer" aria-hidden="true"></li><li class="ios-date-wheel-spacer" aria-hidden="true"></li>';
    listEl.innerHTML = html;
  }
  function snapFechaCol(name, value, instant) {
    const col = fechaCol(name);
    if (!col) return;
    const item = col.querySelector(`.ios-date-wheel-item[data-value="${value}"]`);
    if (!item) return;
    const top = item.offsetTop - FECHA_ITEM_H * 2;
    if (instant) col.scrollTop = top;
    else col.scrollTo({ top, behavior: 'smooth' });
    fechaWheel[name] = Number(value);
  }
  function rebuildFechaDays() {
    const maxD = daysInMonth(fechaWheel.year, fechaWheel.month);
    if (fechaWheel.day > maxD) fechaWheel.day = maxD;
    const days = [];
    for (let d = 1; d <= maxD; d++) days.push(d);
    buildFechaCol(document.getElementById('grevFechaWheelDay'), days, pad2);
    snapFechaCol('day', fechaWheel.day, true);
  }
  function rebuildFechaWheel() {
    const months = [];
    for (let m = 1; m <= 12; m++) months.push(m);
    const yNow = new Date().getFullYear();
    const years = [];
    for (let y = yNow - 1; y <= yNow + 2; y++) years.push(y);
    buildFechaCol(document.getElementById('grevFechaWheelMonth'), months, (v) => MESES[v - 1]);
    buildFechaCol(document.getElementById('grevFechaWheelYear'), years);
    rebuildFechaDays();
    snapFechaCol('month', fechaWheel.month, true);
    snapFechaCol('year', fechaWheel.year, true);
  }
  function ensureFechaWheel() {
    if (fechaBuilt) return;
    fechaBuilt = true;
    ['day', 'month', 'year'].forEach((name) => {
      const col = fechaCol(name);
      if (!col) return;
      let timer = null;
      col.addEventListener('scroll', () => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          const idx = Math.round(col.scrollTop / FECHA_ITEM_H);
          const items = col.querySelectorAll('.ios-date-wheel-item');
          const item = items[idx];
          if (!item) return;
          const v = Number(item.getAttribute('data-value'));
          fechaWheel[name] = v;
          if (name === 'month' || name === 'year') rebuildFechaDays();
        }, 80);
      });
    });
    document.querySelectorAll('#grevFechaWheel .ios-date-wheel-step').forEach((btn) => {
      btn.addEventListener('click', () => {
        const unit = btn.closest('.ios-date-wheel-unit');
        const name = unit?.getAttribute('data-col');
        const dir = Number(btn.getAttribute('data-dir')) || 0;
        if (!name) return;
        const col = fechaCol(name);
        const items = Array.from(col?.querySelectorAll('.ios-date-wheel-item') || []);
        let idx = items.findIndex((el) => Number(el.getAttribute('data-value')) === fechaWheel[name]);
        if (idx < 0) idx = 0;
        const next = Math.max(0, Math.min(items.length - 1, idx + dir));
        const v = Number(items[next].getAttribute('data-value'));
        snapFechaCol(name, v, false);
        if (name === 'month' || name === 'year') rebuildFechaDays();
      });
    });
  }
  function abrirFechaSheet() {
    const sheet = document.getElementById('grevFechaSheet');
    if (!sheet) return;
    ensureFechaWheel();
    fechaWheel = parseIsoFecha(val('grevFecha'));
    rebuildFechaWheel();
    sheet.hidden = false;
    sheet.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
  }
  function cerrarFechaSheet() {
    const sheet = document.getElementById('grevFechaSheet');
    if (!sheet) return;
    sheet.hidden = true;
    sheet.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  }
  function confirmarFecha() {
    const maxD = daysInMonth(fechaWheel.year, fechaWheel.month);
    if (fechaWheel.day > maxD) fechaWheel.day = maxD;
    setVal('grevFecha', toIsoFecha(fechaWheel.year, fechaWheel.month, fechaWheel.day));
    pintarFechaLabel();
    cerrarFechaSheet();
  }

  document.getElementById('grevFechaBtn')?.addEventListener('click', abrirFechaSheet);
  document.getElementById('grevFechaCancelar')?.addEventListener('click', cerrarFechaSheet);
  document.getElementById('grevFechaListo')?.addEventListener('click', confirmarFecha);
  document.getElementById('grevFechaSheet')?.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) cerrarFechaSheet();
  });
  if (!val('grevFecha')) {
    const n = new Date();
    setVal('grevFecha', toIsoFecha(n.getFullYear(), n.getMonth() + 1, n.getDate()));
  }
  pintarFechaLabel();

  const preId = txt(val('grevGuiaId'));
  const corrigiendo = !!txt(val('grevComprobanteId'));

  function hydrateGuiaDesdeForm() {
    const serie = txt(val('grevGuiaSerie'));
    const corr = txt(val('grevGuiaCorrelativo'));
    if (!serie && !corr && !preId) return;
    guiaSel = {
      id: preId || '',
      origen: val('grevGuiaOrigen') === 'manual' ? 'manual' : 'emitida',
      tipo_doc: val('grevGuiaTipo') || '09',
      serie,
      correlativo: corr,
      emisor_ruc: val('grevGuiaEmisorRuc') || '',
      destinatario: val('grevRecNombre') || '',
      destinatario_doc: val('grevRecDoc') || '',
      destinatario_tipo_doc: val('grevRecTipo') || '6',
      remitente: val('grevRemNombre') || '',
      remitente_doc: val('grevRemDoc') || '',
      estado: corrigiendo ? 'CORRECCIÓN' : '',
      lineas: Array.from(document.querySelectorAll('#grevBienesHidden input[name="linea_descripcion"]')).map((el, i) => ({
        descripcion: el.value,
        cantidad: document.querySelectorAll('#grevBienesHidden input[name="linea_cantidad"]')[i]?.value || 1,
        unidad: document.querySelectorAll('#grevBienesHidden input[name="linea_unidad"]')[i]?.value || 'NIU',
      })),
      envio: {
        partida: {
          direccion: val('partidaDireccion'),
          ubigeo: val('partidaUbigeo'),
        },
        llegada: {
          direccion: val('llegadaDireccion'),
          ubigeo: val('llegadaUbigeo'),
        },
        vehiculo: { placa: val('grevVehPlaca') },
        conductor: {
          numero_doc: val('grevCondDoc'),
          nombres: val('grevCondNombre'),
          licencia: val('grevCondLic'),
        },
      },
    };
    renderDocSel();
    renderDetalle();
    paintUbicCards();
    syncTramo();
    syncTransporte();
    const placa = txt(val('grevVehPlaca'));
    if (placa) {
      const vt = document.getElementById('grevVehBtnTitulo');
      const vd = document.getElementById('grevVehBtnDetalle');
      if (vt) vt.textContent = placa.toUpperCase();
      if (vd) vd.textContent = 'Vehículo del tramo';
    }
    const nom = txt(val('grevCondNombre'));
    if (nom || txt(val('grevCondDoc'))) {
      const ct = document.getElementById('grevCondBtnTitulo');
      const cd = document.getElementById('grevCondBtnDetalle');
      if (ct) ct.textContent = nom || 'Conductor';
      if (cd) cd.textContent = val('grevCondDoc') || 'Seleccionado';
    }
  }

  if (corrigiendo) {
    hydrateGuiaDesdeForm();
    // Al corregir, salta al paso de vehículo/conductor (lo más frecuente a arreglar).
    showStep(5);
  } else if (preId && guiasApi) {
    fetch(guiasApi.replace(/\/?$/, '/') + encodeURIComponent(preId), {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    })
      .then((r) => r.json())
      .then((data) => {
        const item = data.item || data;
        if (item && item.id) applyGuia(item);
      })
      .catch(() => {});
    showStep(1);
  } else {
    showStep(1);
  }
})();
