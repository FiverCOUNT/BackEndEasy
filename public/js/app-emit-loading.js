(function () {
  var navLockHandler = null;
  var beforeUnloadHandler = null;

  function ensureModal() {
    var el = document.getElementById('emitLoading');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'emitLoading';
    el.className = 'ios-emit-loading';
    el.hidden = true;
    el.setAttribute('aria-hidden', 'true');
    el.setAttribute('role', 'alertdialog');
    el.setAttribute('aria-busy', 'true');
    el.innerHTML =
      '<div class="ios-emit-loading-card">' +
        '<div class="ios-emit-loading-spinner" aria-hidden="true"></div>' +
        '<strong id="emitLoadingTitle">Emitiendo…</strong>' +
        '<p id="emitLoadingText">Espera un momento, no cierres esta ventana.</p>' +
      '</div>';
    document.body.appendChild(el);
    return el;
  }

  function lockNavigation() {
    document.documentElement.classList.add('is-emit-busy');
    if (!navLockHandler) {
      navLockHandler = function (e) {
        var t = e.target;
        if (!t || !t.closest) return;
        if (t.closest('#emitLoading')) return;
        if (t.closest('a[href], button, [data-nav], summary')) {
          e.preventDefault();
          e.stopPropagation();
        }
      };
      document.addEventListener('click', navLockHandler, true);
    }
    if (!beforeUnloadHandler) {
      beforeUnloadHandler = function (e) {
        e.preventDefault();
        e.returnValue = '';
      };
      window.addEventListener('beforeunload', beforeUnloadHandler);
    }
  }

  function unlockNavigation() {
    document.documentElement.classList.remove('is-emit-busy');
    if (navLockHandler) {
      document.removeEventListener('click', navLockHandler, true);
      navLockHandler = null;
    }
    if (beforeUnloadHandler) {
      window.removeEventListener('beforeunload', beforeUnloadHandler);
      beforeUnloadHandler = null;
    }
  }

  /**
   * @param {string} [title]
   * @param {string} [text]
   * @param {{ lockNav?: boolean }} [opts] lockNav=true bloquea salir hasta hideEmitLoading
   */
  window.showEmitLoading = function (title, text, opts) {
    var el = ensureModal();
    var t = document.getElementById('emitLoadingTitle');
    var p = document.getElementById('emitLoadingText');
    if (t) t.textContent = title || 'Emitiendo…';
    if (p) p.textContent = text || 'Espera un momento, no cierres esta ventana.';
    el.hidden = false;
    el.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    document.querySelectorAll('button[type="submit"]').forEach(function (btn) {
      btn.disabled = true;
    });
    if (opts && opts.lockNav) lockNavigation();
  };

  window.hideEmitLoading = function () {
    var el = document.getElementById('emitLoading');
    if (el) {
      el.hidden = true;
      el.setAttribute('aria-hidden', 'true');
    }
    document.body.style.overflow = '';
    unlockNavigation();
  };

  /** Suelta el bloqueo de salida sin ocultar el modal (p. ej. antes de redirigir). */
  window.releaseEmitLoadingNav = function () {
    unlockNavigation();
  };
})();
