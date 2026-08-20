(function () {
  'use strict';

  var IS_XHS = !!(window.xhs && window.xhs.miniTool);
  window.IS_XHS = IS_XHS;

  var els = {
    fileInput: document.getElementById('fileInput'),
    dropzone: document.getElementById('dropzone'),
    thumbs: document.getElementById('thumbs'),
    btnClear: document.getElementById('btnClear'),
    countLabel: document.getElementById('countLabel'),
    layoutPicker: document.getElementById('layoutPicker'),
    fitSeg: document.getElementById('fitSeg'),
    modeHint: document.getElementById('modeHint'),
    gapRange: document.getElementById('gapRange'),
    gapOut: document.getElementById('gapOut'),
    cornerRange: document.getElementById('cornerRange'),
    cornerOut: document.getElementById('cornerOut'),
    padRange: document.getElementById('padRange'),
    padOut: document.getElementById('padOut'),
    bgChips: document.getElementById('bgChips'),
    bgColor: document.getElementById('bgColor'),
    customSwatch: document.getElementById('customSwatch'),
    customChip: document.getElementById('customChip'),
    preview: document.getElementById('preview'),
    previewWrap: document.getElementById('previewWrap'),
    previewEmpty: document.getElementById('previewEmpty'),
    previewLoading: document.getElementById('previewLoading'),
    formatNote: document.getElementById('formatNote'),
    modal: document.getElementById('modal'),
    toast: document.getElementById('toast')
  };

  var toastTimer = null;
  var renderPending = false;
  var loadingCount = 0;
  var uid = 0;
  var animRAF = null;
  var animStart = 0;
  var loopTime = 0;

  function toast(msg) {
    els.toast.textContent = msg;
    els.toast.classList.add('is-visible');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      els.toast.classList.remove('is-visible');
    }, 2400);
  }

  function setLoading(delta) {
    loadingCount = Math.max(0, loadingCount + delta);
    els.previewLoading.hidden = loadingCount === 0;
    if (loadingCount === 0) document.getElementById('previewLoadingText').textContent = '正在装货…';
  }

  function previewSide() {
    var dpr = window.devicePixelRatio || 1;
    var cssWidth = els.previewWrap.clientWidth || 320;
    var side = Math.round(Math.min(720, Math.max(320, cssWidth * dpr)));
    if (cssWidth <= 0) side = 480;
    return side;
  }

  function stopAnimLoop() {
    if (animRAF) {
      cancelAnimationFrame(animRAF);
      animRAF = null;
    }
  }

  function startAnimLoop() {
    stopAnimLoop();
    animStart = performance.now() - loopTime;
    var tickFn = function () {
      if (!EP.hasAnimated()) {
        stopAnimLoop();
        return;
      }
      loopTime = performance.now() - animStart;
      EP.renderAt(EP.state.photos, EP.state.settings, els.preview, previewSide(), loopTime);
      animRAF = requestAnimationFrame(tickFn);
    };
    animRAF = requestAnimationFrame(tickFn);
  }

  function requestPreview() {
    if (renderPending) return;
    renderPending = true;
    requestAnimationFrame(function () {
      renderPending = false;
      var count = EP.state.photos.length;
      els.previewEmpty.style.display = count > 0 ? 'none' : 'grid';
      if (count === 0) {
        stopAnimLoop();
        loopTime = 0;
      } else if (EP.hasAnimated()) {
        if (!animRAF) startAnimLoop();
      } else {
        stopAnimLoop();
        loopTime = 0;
        EP.renderAt(EP.state.photos, EP.state.settings, els.preview, previewSide(), 0);
      }
      updateCount();
      updateFormatNote();
    });
  }

  function updateCount() {
    var n = EP.state.photos.length;
    els.countLabel.textContent = '已装 ' + n + ' / ' + EP.MAX_PHOTOS;
    els.btnClear.hidden = n === 0;
    els.thumbs.hidden = n === 0;
  }

  function updateFormatNote() {
    var btnCopy = document.getElementById('btnCopy');
    if (EP.hasAnimated()) {
      els.formatNote.textContent =
        '含动图 · 导出 GIF 动图 · 自动控制在 1MB 内 · 无限循环';
      if (btnCopy) btnCopy.disabled = true;
    } else {
      var transparent = EP.isTransparent(EP.state.settings);
      var format = transparent ? 'PNG' : 'JPG';
      els.formatNote.textContent =
        '导出宽 ' + EP.EXPORT_SIZE + ' · 高度随内容 · 当前背景保存为 ' + format;
      if (btnCopy) btnCopy.disabled = false;
    }
  }

  function makeThumbEl(photo, index) {
    var thumb = document.createElement('div');
    thumb.className = 'thumb';
    thumb.setAttribute('role', 'listitem');
    thumb.setAttribute('aria-label', '表情 ' + (index + 1) + '，按住拖动调整顺序');

    var img = document.createElement('img');
    img.src = photo.thumbUrl;
    img.alt = '';
    img.draggable = false;
    thumb.appendChild(img);

    var idx = document.createElement('span');
    idx.className = 'thumb-idx';
    idx.textContent = String(index + 1);
    thumb.appendChild(idx);

    if (photo.animated) {
      var badge = document.createElement('span');
      badge.className = 'thumb-badge';
      badge.textContent = 'GIF';
      thumb.appendChild(badge);
    }

    var del = document.createElement('button');
    del.type = 'button';
    del.className = 'thumb-del';
    del.setAttribute('aria-label', '删除第 ' + (index + 1) + ' 张');
    del.innerHTML =
      '<svg viewBox="0 0 14 14" width="12" height="12"><path d="M2 2l10 10M12 2L2 12" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>';
    thumb.appendChild(del);

    del.addEventListener('click', function () {
      var i = EP.state.photos.indexOf(photo);
      if (i >= 0) {
        EP.state.photos.splice(i, 1);
        refresh();
      }
    });

    var cap = document.createElement('button');
    cap.type = 'button';
    cap.className = 'thumb-cap';
    cap.setAttribute('aria-label', '设置第 ' + (index + 1) + ' 张配文');
    cap.textContent = '文';
    cap.addEventListener('click', function () {
      openCaptionEditor(photo);
    });
    thumb.appendChild(cap);

    if (photo.caption) {
      var captag = document.createElement('span');
      captag.className = 'thumb-captag';
      captag.textContent = photo.caption;
      thumb.appendChild(captag);
    }

    bindDrag(thumb, photo);
    return thumb;
  }

  function drawCapPreview(canvas, photo, text) {
    var side = canvas.width;
    var ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, side, side);
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, side, side);
    var src = photo.animated && photo.frameAt ? photo.frameAt(performance.now()) : photo.source;
    if (src && src.width) {
      // contain：完整展示图片，不裁切，配文位置与导出一致
      var scale = Math.min(side / src.width, side / src.height);
      var dw = src.width * scale;
      var dh = src.height * scale;
      ctx.drawImage(src, (side - dw) / 2, (side - dh) / 2, dw, dh);
    }
    EP.drawCaption(ctx, text, { x: 0, y: 0, w: side, h: side });
  }

  function closeModal() {
    els.modal.hidden = true;
    els.modal.innerHTML = '';
  }

  function openCaptionEditor(photo) {
    els.modal.innerHTML = '';

    var card = document.createElement('div');
    card.className = 'modal-card';

    var title = document.createElement('p');
    title.className = 'modal-title';
    title.textContent = '给这张表情配个文';

    var preview = document.createElement('canvas');
    preview.className = 'cap-preview';
    preview.width = 320;
    preview.height = 320;
    preview.setAttribute('role', 'img');
    preview.setAttribute('aria-label', '配文效果预览');
    drawCapPreview(preview, photo, photo.caption || '');

    var input = document.createElement('input');
    input.type = 'text';
    input.className = 'cap-input';
    input.maxLength = 14;
    input.placeholder = '红底白字，留空不显示';
    input.value = photo.caption || '';
    input.setAttribute('aria-label', '配文内容');

    var hint = document.createElement('p');
    hint.className = 'modal-hint';
    hint.textContent = '最多 14 字 · 每张表情单独设置';

    var actions = document.createElement('div');
    actions.className = 'modal-actions';

    var btnClear = document.createElement('button');
    btnClear.type = 'button';
    btnClear.className = 'btn btn-ghost';
    btnClear.textContent = '清除配文';

    var btnSave = document.createElement('button');
    btnSave.type = 'button';
    btnSave.className = 'btn btn-primary';
    btnSave.textContent = '保存';

    function save(value) {
      photo.caption = value;
      closeModal();
      refresh();
    }

    btnClear.addEventListener('click', function () { save(''); });
    btnSave.addEventListener('click', function () { save(input.value.trim()); });
    input.addEventListener('input', function () {
      drawCapPreview(preview, photo, input.value);
    });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') save(input.value.trim());
    });

    actions.appendChild(btnClear);
    actions.appendChild(btnSave);

    var btnClose = document.createElement('button');
    btnClose.type = 'button';
    btnClose.className = 'btn btn-ghost modal-close';
    btnClose.textContent = '取消';
    btnClose.addEventListener('click', closeModal);

    card.appendChild(title);
    card.appendChild(preview);
    card.appendChild(input);
    card.appendChild(hint);
    card.appendChild(actions);
    card.appendChild(btnClose);
    els.modal.appendChild(card);
    els.modal.hidden = false;
    input.focus();
  }

  function renderThumbs() {
    els.thumbs.innerHTML = '';
    EP.state.photos.forEach(function (photo, i) {
      els.thumbs.appendChild(makeThumbEl(photo, i));
    });
  }

  function refresh() {
    renderThumbs();
    renderLayoutPicker();
    requestPreview();
  }

  function bindDrag(thumb, photo) {
    var startX = 0;
    var startY = 0;
    var dragging = false;
    var targetEl = null;

    function clearTarget() {
      if (targetEl) {
        targetEl.classList.remove('is-target');
        targetEl = null;
      }
    }

    function thumbAt(x, y) {
      var nodes = els.thumbs.querySelectorAll('.thumb');
      for (var i = 0; i < nodes.length; i++) {
        var rect = nodes[i].getBoundingClientRect();
        if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
          return nodes[i];
        }
      }
      return null;
    }

    function onMove(e) {
      var dx = e.clientX - startX;
      var dy = e.clientY - startY;
      if (!dragging) {
        if (Math.hypot(dx, dy) < 8) return;
        dragging = true;
        thumb.classList.add('is-dragging');
        try { thumb.setPointerCapture(e.pointerId); } catch (err) {}
      }
      e.preventDefault();
      thumb.style.transform = 'translate(' + dx + 'px, ' + dy + 'px)';
      var hit = thumbAt(e.clientX, e.clientY);
      if (hit !== thumb && hit !== targetEl) {
        clearTarget();
        targetEl = hit;
        if (targetEl) targetEl.classList.add('is-target');
      }
    }

    function onUp(e) {
      thumb.removeEventListener('pointermove', onMove);
      thumb.removeEventListener('pointerup', onUp);
      thumb.removeEventListener('pointercancel', onUp);
      if (dragging) {
        thumb.classList.remove('is-dragging');
        thumb.style.transform = '';
        clearTarget();
        var hit = thumbAt(e.clientX, e.clientY);
        if (hit && hit !== thumb) {
          var from = EP.state.photos.indexOf(photo);
          var to = Array.prototype.indexOf.call(els.thumbs.children, hit);
          if (from >= 0 && to >= 0 && from !== to) {
            EP.state.photos.splice(from, 1);
            EP.state.photos.splice(to, 0, photo);
            refresh();
          }
        }
      }
    }

    thumb.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (e.target.closest('.thumb-del, .thumb-cap')) return;
      if (EP.state.photos.length < 2) return;
      startX = e.clientX;
      startY = e.clientY;
      dragging = false;
      thumb.addEventListener('pointermove', onMove);
      thumb.addEventListener('pointerup', onUp);
      thumb.addEventListener('pointercancel', onUp);
    });
  }

  async function addFiles(fileList) {
    var files = Array.prototype.slice.call(fileList).filter(function (f) {
      return f.type.indexOf('image/') === 0;
    });
    if (!files.length) {
      toast('只认图片文件哦');
      return;
    }
    var room = EP.MAX_PHOTOS - EP.state.photos.length;
    if (files.length > room) {
      files = files.slice(0, Math.max(0, room));
      toast('一次最多打包 ' + EP.MAX_PHOTOS + ' 张');
    }
    if (!files.length) return;

    var total = EP.state.photos.length + files.length;
    var cap = EP.capFor(total);
    setLoading(1);
    for (var i = 0; i < files.length; i++) {
      try {
        var photo = await EP.decodeFile(files[i], cap);
        photo.id = ++uid;
        EP.state.photos.push(photo);
        requestPreview();
      } catch (err) {
        toast('有张图读不出来，跳过了');
      }
    }
    setLoading(-1);
    refresh();
  }

  function renderLayoutPicker() {
    var s = EP.state.settings;
    var count = EP.state.photos.length;
    els.layoutPicker.innerHTML = '';
    if (!count) {
      els.layoutPicker.hidden = true;
      els.modeHint.textContent = '先装表情，这里会出现可选造型';
      return;
    }
    els.layoutPicker.hidden = false;
    var layouts = EP.layoutsFor(count);
    var activeId = EP.activeLayoutId(count, s);
    for (var i = 0; i < layouts.length; i++) {
      (function (rows) {
        var id = rows.join('-');
        var chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'layout-chip' + (id === activeId ? ' is-active' : '');
        chip.setAttribute('role', 'radio');
        chip.setAttribute('aria-checked', id === activeId ? 'true' : 'false');
        chip.setAttribute('aria-label', '布局 ' + rows.join(' 加 '));

        var mini = document.createElement('span');
        mini.className = 'layout-mini';
        mini.setAttribute('aria-hidden', 'true');
        for (var r = 0; r < rows.length; r++) {
          var row = document.createElement('span');
          row.className = 'lm-row';
          for (var c = 0; c < rows[r]; c++) {
            var cell = document.createElement('i');
            cell.className = 'lm-cell';
            row.appendChild(cell);
          }
          mini.appendChild(row);
        }
        chip.appendChild(mini);

        chip.addEventListener('click', function () {
          s.layout = id;
          saveSettingsAndRefresh();
        });
        els.layoutPicker.appendChild(chip);
      })(layouts[i]);
    }
    els.modeHint.textContent = count + ' 张 · 当前组合：' + activeId.replace(/-/g, ' + ');
  }

  function saveSettingsAndRefresh() {
    EP.saveSettings();
    renderLayoutPicker();
    requestPreview();
  }

  function syncControls() {
    var s = EP.state.settings;
    var fitButtons = els.fitSeg.querySelectorAll('.seg-btn');
    for (var i = 0; i < fitButtons.length; i++) {
      var fitValue = fitButtons[i].getAttribute('data-aspect');
      var active = (fitValue === 'fit') === (s.aspect !== false);
      fitButtons[i].classList.toggle('is-active', active);
      fitButtons[i].setAttribute('aria-checked', active ? 'true' : 'false');
    }
    els.gapRange.value = s.gap;
    els.cornerRange.value = s.corner;
    els.padRange.value = s.padding;
    els.gapOut.textContent = s.gap + '%';
    els.cornerOut.textContent = s.corner + '%';
    els.padOut.textContent = s.padding + '%';
    els.bgColor.value = /^#[0-9a-fA-F]{6}$/.test(s.bg) ? s.bg : '#FFD84D';
    els.customSwatch.style.background = els.bgColor.value;
    syncBgChips(s.bg);
    renderLayoutPicker();
  }

  function syncBgChips(bg) {
    var chips = els.bgChips.querySelectorAll('.bg-chip');
    for (var i = 0; i < chips.length; i++) {
      var value = chips[i].getAttribute('data-bg');
      var active = value === bg || (value === 'custom' && bg !== '#FFFFFF' && bg !== '#1A1A1A' && bg !== 'transparent');
      chips[i].classList.toggle('is-active', active);
    }
  }

  function onSettingChange() {
    EP.saveSettings();
    requestPreview();
  }

  function bind() {
    els.fileInput.addEventListener('change', function () {
      if (els.fileInput.files && els.fileInput.files.length) {
        addFiles(els.fileInput.files);
      }
      els.fileInput.value = '';
    });

    ['dragenter', 'dragover'].forEach(function (type) {
      els.dropzone.addEventListener(type, function (e) {
        e.preventDefault();
        els.dropzone.classList.add('is-drag');
      });
    });
    ['dragleave', 'drop'].forEach(function (type) {
      els.dropzone.addEventListener(type, function (e) {
        e.preventDefault();
        els.dropzone.classList.remove('is-drag');
      });
    });
    els.dropzone.addEventListener('drop', function (e) {
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) {
        addFiles(e.dataTransfer.files);
      }
    });
    window.addEventListener('dragover', function (e) { e.preventDefault(); });
    window.addEventListener('drop', function (e) { e.preventDefault(); });

    document.addEventListener('paste', function (e) {
      if (e.clipboardData && e.clipboardData.files && e.clipboardData.files.length) {
        addFiles(e.clipboardData.files);
      }
    });

    els.btnClear.addEventListener('click', function () {
      EP.state.photos = [];
      refresh();
      toast('已清空，重新装');
    });

    els.fitSeg.addEventListener('click', function (e) {
      var btn = e.target.closest('.seg-btn');
      if (!btn) return;
      EP.state.settings.aspect = btn.getAttribute('data-aspect') === 'fit';
      syncControls();
      onSettingChange();
    });

    els.gapRange.addEventListener('input', function () {
      EP.state.settings.gap = parseFloat(els.gapRange.value);
      els.gapOut.textContent = els.gapRange.value + '%';
      onSettingChange();
    });
    els.cornerRange.addEventListener('input', function () {
      EP.state.settings.corner = parseFloat(els.cornerRange.value);
      els.cornerOut.textContent = els.cornerRange.value + '%';
      onSettingChange();
    });
    els.padRange.addEventListener('input', function () {
      EP.state.settings.padding = parseFloat(els.padRange.value);
      els.padOut.textContent = els.padRange.value + '%';
      onSettingChange();
    });

    els.bgChips.addEventListener('click', function (e) {
      var chip = e.target.closest('.bg-chip');
      if (!chip || chip.getAttribute('data-bg') === 'custom') return;
      EP.state.settings.bg = chip.getAttribute('data-bg');
      syncBgChips(EP.state.settings.bg);
      onSettingChange();
    });

    els.bgColor.addEventListener('input', function () {
      EP.state.settings.bg = els.bgColor.value;
      els.customSwatch.style.background = els.bgColor.value;
      syncBgChips(els.bgColor.value);
      onSettingChange();
    });

    if (window.ResizeObserver) {
      new ResizeObserver(requestPreview).observe(els.previewWrap);
    } else {
      window.addEventListener('resize', requestPreview);
    }

    els.modal.addEventListener('click', function (e) {
      if (e.target === els.modal) closeModal();
    });
  }

  document.body.classList.add(IS_XHS ? 'env-xhs' : 'env-web');

  window.EPUI = {
    toast: toast,
    refresh: refresh,
    requestPreview: requestPreview,
    setLoading: setLoading,
    setBusy: function (busy, text) {
      els.previewLoading.hidden = !busy;
      if (busy && text) {
        document.getElementById('previewLoadingText').textContent = text;
      } else if (!busy) {
        document.getElementById('previewLoadingText').textContent = '正在装货…';
      }
    },
    setBusyText: function (text) {
      document.getElementById('previewLoadingText').textContent = text;
    },
    canPack: function () {
      if (EP.state.photos.length === 0) {
        toast('先装点表情进来');
        return false;
      }
      return true;
    }
  };

  bind();
  syncControls();
  updateCount();
  updateFormatNote();
})();
