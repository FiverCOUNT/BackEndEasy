/**
 * Botón de escáner junto al almacén del catálogo.
 * El código de barras es el número de serie: se busca en el almacén elegido.
 */
(function (global) {
  var sheet;
  var video;
  var input;
  var statusEl;
  var stream;
  var detector;
  var timer;
  var busqueda;
  var ultimo = '';
  var ultimoEn = 0;
  var opts = null;

  function estado(texto) {
    if (statusEl) statusEl.textContent = texto;
  }

  function pararCamara() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    detector = null;
    if (stream) {
      stream.getTracks().forEach(function (track) { track.stop(); });
      stream = null;
    }
    if (video) {
      video.srcObject = null;
      video.hidden = true;
    }
  }

  function cerrar() {
    pararCamara();
    if (!sheet) return;
    sheet.hidden = true;
    sheet.setAttribute('aria-hidden', 'true');
  }

  function leerCuadro() {
    if (!detector || !video || video.readyState < 2) {
      timer = setTimeout(leerCuadro, 180);
      return;
    }
    detector.detect(video).then(function (codes) {
      var raw = codes && codes[0] && codes[0].rawValue;
      if (raw) buscar(raw);
      timer = setTimeout(leerCuadro, 180);
    }).catch(function () {
      timer = setTimeout(leerCuadro, 280);
    });
  }

  function abrirCamara() {
    if (!navigator.mediaDevices || !window.BarcodeDetector) {
      estado('Escribe la serie o usa la pistola y presiona Enter.');
      return;
    }
    var formatos = ['code_128', 'code_39', 'ean_13', 'ean_8', 'qr_code', 'upc_a', 'upc_e', 'itf', 'codabar'];
    var listo = Promise.resolve(formatos);
    if (typeof BarcodeDetector.getSupportedFormats === 'function') {
      listo = BarcodeDetector.getSupportedFormats().then(function (ok) {
        var usable = formatos.filter(function (f) { return ok.indexOf(f) >= 0; });
        return usable.length ? usable : formatos;
      }).catch(function () { return formatos; });
    }
    listo.then(function (formatosOk) {
      detector = new BarcodeDetector({ formats: formatosOk });
      return navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      });
    }).then(function (media) {
      if (!sheet || sheet.hidden) {
        media.getTracks().forEach(function (track) { track.stop(); });
        return;
      }
      stream = media;
      if (video) {
        video.hidden = false;
        video.srcObject = media;
        video.play().catch(function () {});
      }
      estado('Apunta el código de barras de la serie.');
      leerCuadro();
    }).catch(function () {
      estado('Sin cámara. Escribe la serie o usa la pistola y presiona Enter.');
    });
  }

  function buscar(codigo) {
    var limpio = String(codigo || '').trim();
    if (!limpio || !opts || busqueda) return;
    var ahora = Date.now();
    if (limpio === ultimo && ahora - ultimoEn < 1600) return;
    ultimo = limpio;
    ultimoEn = ahora;
    if (opts.local) {
      var aviso = opts.onCode ? opts.onCode(limpio) : '';
      estado(aviso || ('Serie ' + limpio));
      if (input) input.value = '';
      return;
    }
    var almacenId = opts.getAlmacenId ? opts.getAlmacenId() : '';
    if (!almacenId) {
      estado('Selecciona el almacén.');
      return;
    }
    busqueda = true;
    estado('Buscando ' + limpio + '…');
    var url = (opts.url || '/app/catalogo/series/buscar')
      + '?codigo=' + encodeURIComponent(limpio)
      + '&almacen_id=' + encodeURIComponent(almacenId)
      + '&uso=' + encodeURIComponent(opts.uso || 'venta');
    fetch(url, { credentials: 'same-origin', headers: { Accept: 'application/json' } })
      .then(function (res) {
        return res.json().then(function (data) {
          if (!res.ok) throw new Error(data.message || 'No se encontró la serie');
          return data;
        });
      })
      .then(function (data) {
        var msg = opts.onFound ? opts.onFound(data) : '';
        estado(msg || ('Agregado: ' + limpio));
        if (input) input.value = '';
      })
      .catch(function (err) {
        estado(err.message || 'No se encontró la serie');
      })
      .finally(function () {
        busqueda = false;
      });
  }

  function abrir() {
    if (!sheet) return;
    sheet.hidden = false;
    sheet.setAttribute('aria-hidden', 'false');
    if (input) input.value = '';
    estado('Apunta la cámara o escribe la serie y presiona Enter.');
    abrirCamara();
    setTimeout(function () { input && input.focus(); }, 40);
  }

  function mount(options) {
    opts = options || {};
    var button = opts.button || document.getElementById('barcodeSerieBtn');
    sheet = document.getElementById('barcodeSerieSheet');
    video = document.getElementById('barcodeSerieVideo');
    input = document.getElementById('barcodeSerieInput');
    statusEl = document.getElementById('barcodeSerieStatus');
    if (!button || !sheet) return;
    button.addEventListener('click', function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      abrir();
    });
    var cerrarBtn = document.getElementById('barcodeSerieCerrar');
    if (cerrarBtn) cerrarBtn.addEventListener('click', cerrar);
    sheet.addEventListener('click', function (ev) {
      if (ev.target === sheet) cerrar();
    });
    if (input) {
      input.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter') {
          ev.preventDefault();
          buscar(input.value);
        }
      });
    }
    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape' && sheet && !sheet.hidden) {
        ev.stopPropagation();
        cerrar();
      }
    });
  }

  function consultar(opciones) {
    var codigo = String((opciones && opciones.codigo) || '').trim();
    var almacenId = opciones && opciones.almacenId ? String(opciones.almacenId) : '';
    var uso = (opciones && opciones.uso) || 'venta';
    var url = '/app/catalogo/series/buscar?codigo=' + encodeURIComponent(codigo)
      + '&almacen_id=' + encodeURIComponent(almacenId)
      + '&uso=' + encodeURIComponent(uso);
    return fetch(url, { credentials: 'same-origin', headers: { Accept: 'application/json' } })
      .then(function (res) {
        return res.json().then(function (data) {
          if (!res.ok) throw new Error(data.message || 'No se encontró la serie');
          return data;
        });
      });
  }

  function alEnter(input, fn) {
    if (!input || !fn) return;
    input.addEventListener('keydown', function (ev) {
      if (ev.key !== 'Enter') return;
      ev.preventDefault();
      fn(String(input.value || '').trim(), input);
    });
  }

  global.EasyBarcodeSerie = { mount: mount, consultar: consultar, alEnter: alEnter };
})(window);
