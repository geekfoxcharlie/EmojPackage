(function () {
  'use strict';

  var MAX_PHOTOS = 9;
  var EXPORT_SIZE = 2160;
  var SETTINGS_KEY = 'emojpack.settings.v1';

  var DEFAULT_SETTINGS = {
    layout: '',
    aspect: true,
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

  /* 每个张数的可选布局目录（行 → 每行格数），第一个为默认；
   * 覆盖旧版 smart / grid 两种模式，grid 排布也收录在内 */
  var LAYOUT_CATALOG = {
    1: [[1]],
    2: [[2], [1, 1]],
    3: [[2, 1], [3], [1, 2], [1, 1, 1]],
    4: [[2, 2], [1, 3], [3, 1], [2, 1, 1], [1, 1, 1, 1], [4]],
    5: [[2, 2, 1], [1, 2, 2], [2, 1, 2], [3, 2], [2, 3], [5]],
    6: [[3, 3], [2, 2, 2], [1, 2, 3], [3, 2, 1], [2, 3, 1], [6]],
    7: [[1, 3, 3], [3, 3, 1], [3, 1, 3], [2, 3, 2], [2, 2, 3], [3, 2, 2]],
    8: [[2, 3, 3], [3, 3, 2], [3, 2, 3], [4, 4], [2, 2, 2, 2], [2, 2, 4]],
    9: [[3, 3, 3], [1, 4, 4], [4, 4, 1], [2, 3, 4], [4, 3, 2], [2, 2, 2, 3]]
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

  function layoutsFor(count) {
    if (count >= 1 && LAYOUT_CATALOG[count]) return LAYOUT_CATALOG[count];
    return count > 0 ? [gridRows(count)] : [];
  }

  function activeRows(count, settings) {
    if (count <= 0) return [];
    var wanted = String(settings.layout || '');
    var list = layoutsFor(count);
    if (wanted) {
      for (var i = 0; i < list.length; i++) {
        if (list[i].join('-') === wanted) return list[i];
      }
    }
    return list[0];
  }

  function activeLayoutId(count, settings) {
    return activeRows(count, settings).join('-');
  }

  function aspectOf(photo) {
    if (photo && photo.width && photo.height) {
      var a = photo.width / photo.height;
      if (isFinite(a) && a > 0) return a;
    }
    return 1;
  }

  /* 画布只锁宽度，高度随内容：
   * - 贴合比例：每行行高 = 行可用宽 / Σ(图片宽高比)，格子宽 = 比例 × 行高
   *   → 每个格子与图片等比，整图零裁切显示
   * - 等宽方格：行等高、格等宽（旧正方形审美，cover 裁切） */
  function computeLayout(photos, targetW, settings) {
    var count = photos.length;
    if (count <= 0) return { w: targetW, h: targetW, cells: [] };
    var rows = activeRows(count, settings);
    var pad = targetW * (settings.padding / 100);
    var gap = targetW * (settings.gap / 100);
    var inner = targetW - pad * 2;
    var adaptive = settings.aspect !== false;
    var rowCount = rows.length;

    var rowHeights = [];
    var idx = 0;
    for (var r = 0; r < rowCount; r++) {
      var n = rows[r];
      var availW = inner - gap * (n - 1);
      if (adaptive) {
        var sum = 0;
        for (var c = 0; c < n; c++) {
          sum += aspectOf(photos[idx + c] || photos[count - 1]);
        }
        rowHeights.push(availW / sum);
      } else {
        rowHeights.push((inner - gap * (rowCount - 1)) / rowCount);
      }
      idx += n;
    }

    var totalH = pad * 2 + gap * (rowCount - 1);
    for (r = 0; r < rowCount; r++) totalH += rowHeights[r];

    var cells = [];
    idx = 0;
    var y = pad;
    for (r = 0; r < rowCount; r++) {
      var n2 = rows[r];
      var rh = rowHeights[r];
      var x = pad;
      for (var c2 = 0; c2 < n2; c2++) {
        var photo = photos[idx + c2] || photos[count - 1];
        var w = adaptive ? aspectOf(photo) * rh : (inner - gap * (n2 - 1)) / n2;
        cells.push({ x: x, y: y, w: w, h: rh });
        x += w + gap;
      }
      y += rh + gap;
      idx += n2;
    }
    return { w: targetW, h: totalH, cells: cells };
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

  var CAPTION_RED = '#E50113';
  var CAPTION_FONT = '900 {size}px -apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif';

  /* 高雅表情包同款：红底白字长条，悬浮在格子底部居中；空文案直接跳过 */
  function drawCaption(ctx, text, cell) {
    if (!text) return;
    var fontSize = Math.min(cell.w, cell.h) * 0.13;
    var font = function (size) {
      return CAPTION_FONT.replace('{size}', Math.round(size));
    };
    ctx.font = font(fontSize);
    var maxW = cell.w * 0.9;
    var w = ctx.measureText(text).width;
    if (w > maxW) {
      fontSize = Math.max(6, fontSize * maxW / w);
      ctx.font = font(fontSize);
      w = ctx.measureText(text).width;
    }
    var padX = fontSize * 0.42;
    var padY = fontSize * 0.26;
    var barW = Math.min(cell.w, w + padX * 2);
    var barH = fontSize + padY * 2;
    var x = cell.x + (cell.w - barW) / 2;
    var y = cell.y + cell.h - barH - cell.h * 0.05;
    ctx.fillStyle = CAPTION_RED;
    ctx.fillRect(x, y, barW, barH);
    ctx.fillStyle = '#FFFFFF';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x + barW / 2, y + barH / 2 + fontSize * 0.05);
  }

  function renderTo(canvas, targetW) {
    var s = state.settings;
    var lay = computeLayout(state.photos, targetW, s);
    canvas.width = Math.round(lay.w);
    canvas.height = Math.round(lay.h);
    var ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!isTransparent(s)) {
      ctx.fillStyle = s.bg;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    var cells = lay.cells;
    for (var i = 0; i < cells.length && i < state.photos.length; i++) {
      var cell = cells[i];
      var radius = Math.min(cell.w, cell.h) * (s.corner / 100);
      ctx.save();
      roundRectPath(ctx, cell.x, cell.y, cell.w, cell.h, radius);
      ctx.clip();
      drawCover(ctx, state.photos[i].source, cell);
      ctx.restore();
      drawCaption(ctx, state.photos[i].caption, cell);
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
    layoutsFor: layoutsFor,
    activeRows: activeRows,
    activeLayoutId: activeLayoutId,
    computeLayout: computeLayout,
    renderTo: renderTo,
    roundRectPath: roundRectPath,
    drawCaption: drawCaption,
    decodeFile: decodeFile,
    capFor: capFor,
    saveSettings: saveSettings,
    isTransparent: isTransparent
  };
})();
