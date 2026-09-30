(function () {
  var card = document.getElementById('emitImagenesCard');
  if (!card) return;

  var max = Number(card.dataset.max || 3) || 3;
  var uploadUrl = card.dataset.uploadUrl || '/app/emitir/adjuntos';
  var grid = document.getElementById('emitImagenesGrid');
  var input = document.getElementById('emitImagenesInput');
  var addLabel = document.getElementById('emitImagenesAdd');
  var statusEl = document.getElementById('emitImagenesStatus');
  var hidden = document.getElementById('emitAdjuntosJson');
  var items = [];

  function setStatus(text, isError) {
    if (!statusEl) return;
    if (!text) {
      statusEl.hidden = true;
      statusEl.textContent = '';
      statusEl.classList.remove('is-error');
      return;
    }
    statusEl.hidden = false;
    statusEl.textContent = text;
    statusEl.classList.toggle('is-error', Boolean(isError));
  }

  function syncHidden() {
    if (!hidden) return;
    hidden.value = JSON.stringify(items.map(function (it) {
      return {
        key: it.key,
        url: it.url,
        nombre: it.nombre,
        content_type: it.content_type,
        size: it.size,
      };
    }));
  }

  function render() {
    if (!grid || !addLabel) return;
    grid.querySelectorAll('.ios-emit-imgs-thumb').forEach(function (el) { el.remove(); });
    items.forEach(function (it, idx) {
      var fig = document.createElement('div');
      fig.className = 'ios-emit-imgs-thumb';
      fig.innerHTML =
        '<img alt="" src="' + (it.preview || it.url) + '" />' +
        '<button type="button" class="ios-emit-imgs-remove" aria-label="Quitar imagen">×</button>';
      fig.querySelector('.ios-emit-imgs-remove').addEventListener('click', function () {
        if (it.preview && String(it.preview).indexOf('blob:') === 0) {
          try { URL.revokeObjectURL(it.preview); } catch (_e) { /* ignore */ }
        }
        items.splice(idx, 1);
        syncHidden();
        render();
        setStatus(items.length ? (items.length + ' / ' + max) : '');
      });
      grid.insertBefore(fig, addLabel);
    });
    addLabel.hidden = items.length >= max;
  }

  function uploadFile(file) {
    var preview = URL.createObjectURL(file);
    var formData = new FormData();
    formData.append('file', file);
    setStatus('Subiendo…');
    return fetch(uploadUrl, {
      method: 'POST',
      credentials: 'same-origin',
      body: formData,
    })
      .then(function (res) {
        return res.json().then(function (data) {
          if (!res.ok) throw new Error(data.message || 'No se pudo subir la imagen');
          return data;
        });
      })
      .then(function (data) {
        var adj = data.adjunto || data;
        items.push({
          key: adj.key,
          url: adj.url,
          nombre: adj.nombre || file.name,
          content_type: adj.content_type || file.type,
          size: adj.size || file.size,
          preview: preview,
        });
        syncHidden();
        render();
        setStatus(items.length + ' / ' + max);
      })
      .catch(function (err) {
        try { URL.revokeObjectURL(preview); } catch (_e) { /* ignore */ }
        setStatus(err.message || 'Error al subir', true);
      });
  }

  if (input) {
    input.addEventListener('change', function () {
      var files = Array.prototype.slice.call(input.files || []);
      input.value = '';
      var room = max - items.length;
      if (room <= 0) {
        setStatus('Máximo ' + max + ' imágenes', true);
        return;
      }
      var selected = files.filter(function (f) {
        return String(f.type || '').indexOf('image/') === 0;
      }).slice(0, room);
      if (!selected.length) {
        setStatus('Solo se permiten imágenes', true);
        return;
      }
      var chain = Promise.resolve();
      selected.forEach(function (file) {
        chain = chain.then(function () { return uploadFile(file); });
      });
    });
  }

  syncHidden();
  render();
})();
