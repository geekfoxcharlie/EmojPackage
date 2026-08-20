(function () {
  'use strict';

  var MAX_PHOTOS = 9;
  var EXPORT_SIZE = 2160;
  var SETTINGS_KEY = 'emojpack.settings.v1';

  var DEFAULT_SETTINGS = {
    mode: 'smart',
    gap: 2,
    corner: 6,
    padding: 2,
    bg: '#FFFFFF'
  };

  function loadSettings() {
    try {
      var raw = localStorage.getItem(SETTINGS_KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          return Object.assign({}, DEFAULT_SETTINGS, parsed);
        }
      }
    } catch (e) {}
    return Object.assign({}, DEFAULT_SETTINGS);
  }

  var state = {
    photos: [],
    settings: loadSettings()
  };

  function saveSettings() {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
    } catch (e) {}
  }

  var SMART_MAP = {
    1: [1],
    2: [2],
    3: [2, 1],
    4: [2, 2],
    5: [2, 2, 1],
    6: [3, 3],
    7: [1, 3, 3],
    8: [2, 3, 3],
    9: [3, 3, 3]
  };

  function gridRows(n) {
    var cols = Math.ceil(Math.sqrt(n));
    var rows = Math.ceil(n / cols);
    var out = [];
    var left = n;
    for (var r = 0; r < rows; r++) {
      out.push(Math.min(cols, left));
      left -= Math.min(cols, left);
    }
    return out;
  }

  function rowsFor(count, mode) {
    if (count <= 0) return [];
    if (mode === 'grid') return gridRows(count);
    return SMART_MAP[count] || gridRows(count);
  }

  function layoutCells(count, side, settings) {
    var cells = [];
    if (count <= 0) return cells;
    var rows = rowsFor(count, settings.mode);
    var pad = side * (settings.padding / 100);
    var gap = side * (settings.gap / 100);
    var inner = side - pad * 2;
    var rowCount = rows.length;
    var rowH = (inner - gap * (rowCount - 1)) / rowCount;
    var y = pad;
    for (var r = 0; r < rowCount; r++) {
      var n = rows[r];
      var cellW = (inner - gap * (n - 1)) / n;
      var x = pad;
      for (var c = 0; c < n; c++) {
        cells.push({ x: x, y: y, w: cellW, h: rowH });
        x += cellW + gap;
      }
      y += rowH + gap;
    }
    return cells;
  }

  function roundRectPath(ctx, x, y, w, h, r) {
    var rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  function drawCover(ctx, source, cell) {
    var sw = source.width;
    var sh = source.height;
    if (!sw || !sh) return;
    var scale = Math.max(cell.w / sw, cell.h / sh);
    var dw = sw * scale;
    var dh = sh * scale;
    ctx.drawImage(source, cell.x + (cell.w - dw) / 2, cell.y + (cell.h - dh) / 2, dw, dh);
  }

  function isTransparent(settings) {
    return settings.bg === 'transparent';
  }

  function renderTo(canvas, side) {
    canvas.width = side;
    canvas.height = side;
    var ctx = canvas.getContext('2d');
    var s = state.settings;
    ctx.clearRect(0, 0, side, side);
    if (!isTransparent(s)) {
      ctx.fillStyle = s.bg;
      ctx.fillRect(0, 0, side, side);
    }
    var cells = layoutCells(state.photos.length, side, s);
    for (var i = 0; i < cells.length && i < state.photos.length; i++) {
      var cell = cells[i];
      var radius = Math.min(cell.w, cell.h) * (s.corner / 100);
      ctx.save();
      roundRectPath(ctx, cell.x, cell.y, cell.w, cell.h, radius);
      ctx.clip();
      drawCover(ctx, state.photos[i].source, cell);
      ctx.restore();
    }
    return canvas;
  }

  function capFor(total) {
    if (total <= 2) return 2160;
    if (total <= 4) return 1600;
    return 1360;
  }

  function loadViaImage(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        resolve({ img: img, url: url });
      };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error('decode failed'));
      };
      img.src = url;
    });
  }

  async function decodeFile(file, cap) {
    var decoded = null;
    var imgUrl = null;

    try {
      decoded = await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch (e1) {
      try {
        decoded = await createImageBitmap(file);
      } catch (e2) {
        decoded = null;
      }
    }

    if (!decoded) {
      var loaded = await loadViaImage(file);
      decoded = loaded.img;
      imgUrl = loaded.url;
    }

    var width = decoded.width || decoded.naturalWidth;
    var height = decoded.height || decoded.naturalHeight;

    var canvas = document.createElement('canvas');
    var scale = Math.min(1, cap / Math.max(width, height));
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    var cctx = canvas.getContext('2d');
    cctx.imageSmoothingEnabled = true;
    cctx.imageSmoothingQuality = 'high';
    cctx.drawImage(decoded, 0, 0, canvas.width, canvas.height);

    if (decoded.close) decoded.close();
    if (imgUrl) URL.revokeObjectURL(imgUrl);

    var thumb = document.createElement('canvas');
    var tside = 240;
    thumb.width = tside;
    thumb.height = tside;
    thumb.getContext('2d').drawImage(canvas, 0, 0, tside, tside);

    return {
      source: canvas,
      width: canvas.width,
      height: canvas.height,
      thumbUrl: thumb.toDataURL('image/png'),
      name: file.name || 'image'
    };
  }

  window.EP = {
    MAX_PHOTOS: MAX_PHOTOS,
    EXPORT_SIZE: EXPORT_SIZE,
    state: state,
    rowsFor: rowsFor,
    layoutCells: layoutCells,
    renderTo: renderTo,
    roundRectPath: roundRectPath,
    decodeFile: decodeFile,
    capFor: capFor,
    saveSettings: saveSettings,
    isTransparent: isTransparent
  };
})();
