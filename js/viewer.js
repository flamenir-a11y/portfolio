(function () {
  var PDFJS_VERSION = '3.11.174';
  var PAGE_RENDER_TIMEOUT = 10000;
  var ZOOM_MIN = 0.6, ZOOM_MAX = 2.4, ZOOM_STEP = 0.2;
  var overlay, body, titleEl, closeBtn, pager, navGroup, zoomGroup,
      prevBtn, nextBtn, pageIndicator, zoomOutBtn, zoomInBtn, zoomLevelEl, lastFocused;

  function ensurePdfJs(cb) {
    if (window.pdfjsLib) { cb(); return; }
    var s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/' + PDFJS_VERSION + '/pdf.min.js';
    s.onload = function () {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc =
        'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/' + PDFJS_VERSION + '/pdf.worker.min.js';
      cb();
    };
    s.onerror = function () { body.innerHTML = '<div class="viewer-loading">לא ניתן לטעון את מציג המסמכים.</div>'; };
    document.head.appendChild(s);
  }

  function buildOverlay() {
    overlay = document.createElement('div');
    overlay.className = 'viewer-overlay';
    overlay.hidden = true;
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.innerHTML =
      '<div class="viewer-box">' +
        '<div class="viewer-bar">' +
          '<span class="viewer-title"></span>' +
          '<button type="button" class="viewer-close" aria-label="סגירה">✕</button>' +
        '</div>' +
        '<div class="viewer-body"></div>' +
        '<div class="viewer-pager" hidden>' +
          '<div class="viewer-zoom">' +
            '<button type="button" class="viewer-zoom-out" aria-label="הקטנת טקסט">−</button>' +
            '<span class="viewer-zoom-level">100%</span>' +
            '<button type="button" class="viewer-zoom-in" aria-label="הגדלת טקסט">+</button>' +
          '</div>' +
          '<div class="viewer-nav">' +
            '<button type="button" class="viewer-prev">‹ הקודם</button>' +
            '<span class="viewer-page-indicator"></span>' +
            '<button type="button" class="viewer-next">הבא ›</button>' +
          '</div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);
    body = overlay.querySelector('.viewer-body');
    titleEl = overlay.querySelector('.viewer-title');
    closeBtn = overlay.querySelector('.viewer-close');
    pager = overlay.querySelector('.viewer-pager');
    navGroup = overlay.querySelector('.viewer-nav');
    zoomGroup = overlay.querySelector('.viewer-zoom');
    prevBtn = overlay.querySelector('.viewer-prev');
    nextBtn = overlay.querySelector('.viewer-next');
    pageIndicator = overlay.querySelector('.viewer-page-indicator');
    zoomOutBtn = overlay.querySelector('.viewer-zoom-out');
    zoomInBtn = overlay.querySelector('.viewer-zoom-in');
    zoomLevelEl = overlay.querySelector('.viewer-zoom-level');
    closeBtn.addEventListener('click', closeViewer);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) closeViewer(); });
    document.addEventListener('keydown', function (e) {
      if (!overlay || overlay.hidden) return;
      if (e.key === 'Escape') closeViewer();
      if (e.key === 'Tab') {
        // Keep keyboard focus inside the open viewer instead of tabbing
        // through the page hidden behind it.
        var items = Array.prototype.filter.call(
          overlay.querySelectorAll('button:not([disabled]), a[href], iframe'),
          function (el) { return el.offsetParent !== null; });
        if (items.length) {
          var first = items[0], last = items[items.length - 1];
          if (!overlay.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
          else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
          else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        }
      }
      if (!navGroup.hidden) {
        if (e.key === 'ArrowLeft') goToPage(currentPage + (isRtlDoc ? -1 : 1));
        if (e.key === 'ArrowRight') goToPage(currentPage + (isRtlDoc ? 1 : -1));
      }
      if (e.key === '+' || e.key === '=') zoomBy(ZOOM_STEP);
      if (e.key === '-') zoomBy(-ZOOM_STEP);
    });
    prevBtn.addEventListener('click', function () { goToPage(currentPage - 1); });
    nextBtn.addEventListener('click', function () { goToPage(currentPage + 1); });
    zoomInBtn.addEventListener('click', function () { zoomBy(ZOOM_STEP); });
    zoomOutBtn.addEventListener('click', function () { zoomBy(-ZOOM_STEP); });
  }

  function closeViewer() {
    overlay.hidden = true;
    body.innerHTML = '';
    pager.hidden = true;
    document.body.style.overflow = '';
    currentPdf = null;
    currentFrame = null;
    if (lastFocused && lastFocused.focus) lastFocused.focus();
  }

  function openOverlay(title) {
    lastFocused = document.activeElement;
    titleEl.textContent = title || '';
    overlay.setAttribute('aria-label', title || 'תצוגת מסמך');
    overlay.hidden = false;
    pager.hidden = true;
    zoomLevel = 1;
    document.body.style.overflow = 'hidden';
    closeBtn.focus();
  }

  var currentFrame = null;

  function isLocalReader(src) {
    return src.indexOf('http:') !== 0 && src.indexOf('https:') !== 0;
  }

  function openFrame(src, title) {
    openOverlay(title);
    body.innerHTML = '<iframe src="' + src + '" title="' + (title || 'תצוגה') + '"></iframe>';
    currentFrame = body.querySelector('iframe');
    if (isLocalReader(src)) {
      navGroup.hidden = true;
      zoomGroup.hidden = false;
      pager.hidden = false;
      updateZoomLabel();
      currentFrame.addEventListener('load', function () { applyFrameZoom(); });
    }
  }

  var currentPdf = null;
  var currentPage = 1;
  var zoomLevel = 1;
  var isRtlDoc = true; // document nav mirrors the page's own RTL reading direction

  function updateZoomLabel() {
    zoomLevelEl.textContent = Math.round(zoomLevel * 100) + '%';
    zoomOutBtn.disabled = zoomLevel <= ZOOM_MIN + 1e-6;
    zoomInBtn.disabled = zoomLevel >= ZOOM_MAX - 1e-6;
  }

  function applyFrameZoom() {
    if (!currentFrame) return;
    try {
      currentFrame.contentDocument.body.style.zoom = String(zoomLevel);
    } catch (e) { /* cross-origin: not zoomable, controls hidden anyway */ }
  }

  function zoomBy(delta) {
    var next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round((zoomLevel + delta) * 100) / 100));
    if (next === zoomLevel) return;
    zoomLevel = next;
    updateZoomLabel();
    if (currentPdf) renderCurrentPage();
    else if (currentFrame) applyFrameZoom();
  }

  function withTimeout(promise, ms) {
    return new Promise(function (resolve, reject) {
      var timer = setTimeout(function () { reject(new Error('timeout')); }, ms);
      promise.then(function (v) { clearTimeout(timer); resolve(v); },
                    function (e) { clearTimeout(timer); reject(e); });
    });
  }

  function renderCurrentPage() {
    body.innerHTML = '<div class="viewer-loading">טוען עמוד…</div>';
    currentPdf.getPage(currentPage).then(function (page) {
      var targetWidth = body.clientWidth || 760;
      var baseViewport = page.getViewport({ scale: 1 });
      var fitScale = Math.min(targetWidth / baseViewport.width, 2);
      var viewport = page.getViewport({ scale: fitScale * zoomLevel });
      var outputScale = window.devicePixelRatio || 1;
      var canvas = document.createElement('canvas');
      canvas.width = Math.floor(viewport.width * outputScale);
      canvas.height = Math.floor(viewport.height * outputScale);
      canvas.style.width = Math.floor(viewport.width) + 'px';
      canvas.style.height = Math.floor(viewport.height) + 'px';
      var renderContext = { canvasContext: canvas.getContext('2d'), viewport: viewport };
      if (outputScale !== 1) renderContext.transform = [outputScale, 0, 0, outputScale, 0, 0];
      return withTimeout(page.render(renderContext).promise, PAGE_RENDER_TIMEOUT).then(function () {
        body.innerHTML = '';
        var wrapper = document.createElement('div');
        wrapper.style.position = 'relative';
        wrapper.style.width = canvas.style.width;
        wrapper.style.height = canvas.style.height;
        wrapper.style.margin = '0 auto';
        wrapper.appendChild(canvas);
        body.appendChild(wrapper);
        return page.getAnnotations({ intent: 'display' }).then(function (annotations) {
          annotations.forEach(function (ann) {
            var url = ann.url || ann.unsafeUrl;
            if (!url && !ann.dest) return;
            var rect = viewport.convertToViewportRectangle(ann.rect);
            var x = Math.min(rect[0], rect[2]), y = Math.min(rect[1], rect[3]);
            var w = Math.abs(rect[2] - rect[0]), h = Math.abs(rect[3] - rect[1]);
            var el = document.createElement(url ? 'a' : 'div');
            if (url) {
              el.href = url;
              el.target = '_blank';
              el.rel = 'noopener noreferrer';
            } else {
              el.style.cursor = 'pointer';
              el.addEventListener('click', function () {
                resolveDestPage(ann.dest).then(function (pageNum) {
                  if (pageNum) goToPage(pageNum);
                });
              });
            }
            el.style.position = 'absolute';
            el.style.left = x + 'px';
            el.style.top = y + 'px';
            el.style.width = w + 'px';
            el.style.height = h + 'px';
            wrapper.appendChild(el);
          });
        }).catch(function () {});
      });
    }).catch(function () {
      body.innerHTML = '<div class="viewer-loading">לא ניתן להציג עמוד זה.</div>';
    }).then(function () {
      pageIndicator.textContent = 'עמוד ' + currentPage + ' מתוך ' + currentPdf.numPages;
      prevBtn.disabled = currentPage <= 1;
      nextBtn.disabled = currentPage >= currentPdf.numPages;
      updateZoomLabel();
    });
  }

  function resolveDestPage(dest) {
    var destPromise = typeof dest === 'string' ? currentPdf.getDestination(dest) : Promise.resolve(dest);
    return destPromise.then(function (explicitDest) {
      if (!explicitDest) return null;
      return currentPdf.getPageIndex(explicitDest[0]).then(function (index) { return index + 1; });
    }).catch(function () { return null; });
  }

  function goToPage(n) {
    if (!currentPdf || n < 1 || n > currentPdf.numPages) return;
    currentPage = n;
    renderCurrentPage();
  }

  function openPdf(src, title) {
    openOverlay(title);
    body.innerHTML = '<div class="viewer-loading">טוען מסמך…</div>';
    ensurePdfJs(function () {
      withTimeout(window.pdfjsLib.getDocument(src).promise, 20000).then(function (pdf) {
        currentPdf = pdf;
        currentPage = 1;
        pager.hidden = false;
        navGroup.hidden = pdf.numPages <= 1;
        zoomGroup.hidden = false;
        renderCurrentPage();
      }).catch(function () {
        body.innerHTML = '<div class="viewer-loading">לא ניתן לטעון את המסמך.</div>';
      });
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    buildOverlay();
    document.addEventListener('click', function (e) {
      var trigger = e.target.closest('[data-viewer-src]');
      if (!trigger) return;
      e.preventDefault();
      var type = trigger.getAttribute('data-viewer-type') || 'frame';
      var src = trigger.getAttribute('data-viewer-src');
      var title = trigger.getAttribute('data-viewer-title');
      if (type === 'pdf') openPdf(src, title);
      else openFrame(src, title);
    });
  });
})();
