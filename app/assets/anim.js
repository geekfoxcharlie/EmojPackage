(function () {
  'use strict';

  /* ============================================================
   * 标准化动图流水线
   *
   * 阶段 1 · 解码归一化（一次性）
   *   GIF 文件 → 规范帧序列 frames[i] = { canvas, start }
   *   每帧都是"完整画幅快照"：disposal / 部分帧 / 透明
   *   在单次正向遍历中彻底消化，之后不再有任何共享可变状态。
   *
   * 阶段 2 · 统一时间轴
   *   全局固定 tick（统一帧率）。每张图在任意时刻 t
   *   显示"start ≤ (t % duration) 的最后一帧"（缺帧处 hold 补齐）。
   *   纯函数查询，无状态。
   *
   * 阶段 3 · 渲染
   *   renderAt(photos, settings, canvas, side, time) 为纯函数，
   *   预览循环与导出编码共用，行为必然一致。
   *
   * 阶段 4 · 编码（小体积三板斧）
   *   a. 全局调色板（降采样全像素采样）+ 稳定 LUT，色带与处理顺序无关；
   *      调色板永远保留最后一个槽位作为透明索引。
   *   b. 帧间差分：与上一写入帧相同的像素填透明索引（dispose=1 不清除画布），
   *      只把"变化区域的包围盒"作为子帧矩形写入 → 未变化区域是长行程透明，
   *      LZW 压缩率极高；连续静帧不重复编码，时长并入下一帧。
   *   c. 透明导出时若出现"不透明 → 透明"的像素（需要擦除），差分帧无法表达，
   *      该帧退回整帧 + dispose=2，保证语义正确。
   * ============================================================ */

  var HAS_GIF = typeof GifReader === 'function';
  var MIN_DELAY = 20;
  var ZERO_DELAY = 100;
  var MAX_EXPORT_FRAMES = 240;
  var MAX_STORED_FRAMES = 96;
  var MAX_SOURCE_DIM = 720;
  var GIF_EXPORT_SIZE = 720;
  var SAMPLE_SIZE = 160;
  var SAMPLE_COUNT = 24;
  var MIN_TICK = 60;
  var MAX_TICK = 100;

  function normalizeDelay(cs) {
    var ms = cs * 10;
    if (ms <= 0) return ZERO_DELAY;
    return Math.max(ms, MIN_DELAY);
  }

  async function fileToArrayBuffer(file) {
    if (file.arrayBuffer) return file.arrayBuffer();
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(reader.result); };
      reader.onerror = function () { reject(new Error('read failed')); };
      reader.readAsArrayBuffer(file);
    });
  }

  /* ---------- 阶段 1：解码归一化 ---------- */

  function compositeCanonicalFrames(reader, width, height) {
    var numFrames = reader.numFrames();
    if (numFrames < 1) return null;

    var scratch = document.createElement('canvas');
    scratch.width = width;
    scratch.height = height;
    var sctx = scratch.getContext('2d', { willReadFrequently: true });

    var patchCanvas = document.createElement('canvas');
    patchCanvas.width = width;
    patchCanvas.height = height;
    var pctx = patchCanvas.getContext('2d');

    var savedState = null;
    var prevDisposal = 0;
    var prevRect = null;
    var frames = [];
    var time = 0;

    for (var i = 0; i < numFrames && frames.length < MAX_STORED_FRAMES; i++) {
      var info;
      try {
        info = reader.frameInfo(i);
      } catch (e) {
        break;
      }
      var patch = new Uint8ClampedArray(width * height * 4);
      try {
        reader.decodeAndBlitFrameRGBA(i, patch);
      } catch (e) {
        break;
      }

      if (prevDisposal === 3 && savedState) {
        sctx.putImageData(savedState, 0, 0);
        savedState = null;
      } else if (prevDisposal === 2 && prevRect) {
        sctx.clearRect(prevRect.x, prevRect.y, prevRect.w, prevRect.h);
      }

      if (info.disposal === 3) {
        savedState = sctx.getImageData(0, 0, width, height);
      }

      pctx.putImageData(new ImageData(patch, width, height), 0, 0);
      sctx.drawImage(patchCanvas, 0, 0);
      prevDisposal = info.disposal;
      prevRect = { x: info.x, y: info.y, w: info.width, h: info.height };

      var snapshot = document.createElement('canvas');
      snapshot.width = width;
      snapshot.height = height;
      snapshot.getContext('2d').drawImage(scratch, 0, 0);
      frames.push({ canvas: snapshot, start: time });

      time += normalizeDelay(info.delay);
    }

    if (frames.length < 1) return null;
    return { frames: frames, duration: time };
  }

  function downscaleFrames(frames, width, height, target) {
    var scale = target / Math.max(width, height);
    var tw = Math.max(1, Math.round(width * scale));
    var th = Math.max(1, Math.round(height * scale));
    for (var i = 0; i < frames.length; i++) {
      var small = document.createElement('canvas');
      small.width = tw;
      small.height = th;
      var c = small.getContext('2d');
      c.imageSmoothingQuality = 'high';
      c.drawImage(frames[i].canvas, 0, 0, tw, th);
      frames[i].canvas = small;
    }
    return { frames: frames, width: tw, height: th };
  }

  function makeFrameAt(photo) {
    var frames = photo.frames;
    var n = frames.length;
    return function (time) {
      if (n === 1) return frames[0].canvas;
      var local = ((time % photo.duration) + photo.duration) % photo.duration;
      var lo = 0, hi = n - 1;
      while (lo < hi) {
        var mid = (lo + hi + 1) >> 1;
        if (frames[mid].start <= local) lo = mid; else hi = mid - 1;
      }
      return frames[lo].canvas;
    };
  }

  async function decodeAnimatedGif(file) {
    if (!HAS_GIF) return null;
    var isGif = file.type === 'image/gif' || /\.gif$/i.test(file.name || '');
    if (!isGif) return null;

    var buffer;
    try {
      buffer = await fileToArrayBuffer(file);
    } catch (e) {
      return null;
    }

    var bytes = new Uint8Array(buffer);
    if (bytes.length < 6 ||
        bytes[0] !== 0x47 || bytes[1] !== 0x49 || bytes[2] !== 0x46) {
      return null;
    }

    var reader;
    try {
      reader = new GifReader(bytes);
    } catch (e) {
      return null;
    }

    var result = compositeCanonicalFrames(reader, reader.width, reader.height);
    if (!result) return null;

    var width = reader.width;
    var height = reader.height;
    if (Math.max(width, height) > MAX_SOURCE_DIM) {
      var scaled = downscaleFrames(result.frames, width, height, MAX_SOURCE_DIM);
      width = scaled.width;
      height = scaled.height;
    }

    var first = result.frames[0].canvas;
    var thumb = document.createElement('canvas');
    thumb.width = 240;
    thumb.height = 240;
    thumb.getContext('2d').drawImage(first, 0, 0, 240, 240);

    var photo = {
      id: 0,
      name: file.name || 'image.gif',
      animated: result.frames.length > 1,
      width: width,
      height: height,
      frames: result.frames,
      duration: result.duration,
      source: first,
      thumbUrl: thumb.toDataURL('image/png'),
      frameAt: null,
      getDrawable: null
    };

    photo.getDrawable = photo.frameAt = makeFrameAt(photo);
    return photo;
  }

  /* ---------- 阶段 2：统一时间轴参数 ---------- */

  function anyAnimated(photos) {
    for (var i = 0; i < photos.length; i++) {
      if (photos[i] && photos[i].animated) return true;
    }
    return false;
  }

  function computeTick(photos) {
    var minDelay = Infinity;
    for (var i = 0; i < photos.length; i++) {
      var p = photos[i];
      if (!p || !p.animated) continue;
      for (var j = 0; j < p.frames.length; j++) {
        var next = j + 1 < p.frames.length ? p.frames[j + 1].start : p.duration;
        var d = next - p.frames[j].start;
        if (d > 0 && d < minDelay) minDelay = d;
      }
    }
    if (!isFinite(minDelay)) minDelay = 50;
    // 格子越多，整幅画布每 tick 的变化越密、体积越大；
    // 密集组合适当降低帧率下限，肉眼在聊天窗口尺寸下几乎无感。
    var count = photos.length;
    var floor = count >= 7 ? 80 : count >= 5 ? 70 : MIN_TICK;
    var tick = Math.min(MAX_TICK, Math.max(floor, minDelay));
    return Math.round(tick / 10) * 10;
  }

  function totalDuration(photos) {
    var max = 0;
    for (var i = 0; i < photos.length; i++) {
      if (photos[i] && photos[i].animated && photos[i].duration > max) {
        max = photos[i].duration;
      }
    }
    return max;
  }

  /* 按最大源图尺寸推导导出边长：格子刚好容纳源图原生分辨率即可，
   * 避免无谓放大 —— 放大既多耗像素又引入插值噪声，双双推高体积。 */
  function exportSideFor(photos, settings) {
    var maxDim = 0;
    for (var i = 0; i < photos.length; i++) {
      var p = photos[i];
      if (!p) continue;
      var d = Math.max(p.width || 0, p.height || 0);
      if (d > maxDim) maxDim = d;
    }
    if (maxDim <= 0) return GIF_EXPORT_SIZE;

    var rows = EP.rowsFor(photos.length, settings.mode);
    if (!rows.length) return GIF_EXPORT_SIZE;

    var pad = settings.padding / 100;
    var gap = settings.gap / 100;
    var worst = 1;
    for (var r = 0; r < rows.length; r++) {
      var n = rows[r];
      var fw = (1 - 2 * pad - gap * (n - 1)) / n;
      var fh = (1 - 2 * pad - gap * (rows.length - 1)) / rows.length;
      var f = Math.min(fw, fh);
      if (f > 0 && f < worst) worst = f;
    }
    var side = Math.ceil(maxDim / worst);
    // 密集组合收紧边长上限：聊天窗口里 600 与 720 肉眼无差，体积差 42%。
    var cap = photos.length >= 7 ? 600 : photos.length >= 5 ? 640 : GIF_EXPORT_SIZE;
    return Math.max(360, Math.min(cap, side));
  }

  /* ---------- 阶段 3：纯函数渲染 ---------- */

  function drawCover(ctx, drawable, cell) {
    var sw = drawable.width;
    var sh = drawable.height;
    if (!sw || !sh) return;
    var scale = Math.max(cell.w / sw, cell.h / sh);
    var dw = sw * scale;
    var dh = sh * scale;
    ctx.drawImage(drawable, cell.x + (cell.w - dw) / 2, cell.y + (cell.h - dh) / 2, dw, dh);
  }

  function renderAt(photos, settings, canvas, side, time) {
    canvas.width = side;
    canvas.height = side;
    var ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, side, side);
    var transparent = settings.bg === 'transparent';
    if (!transparent) {
      ctx.fillStyle = settings.bg;
      ctx.fillRect(0, 0, side, side);
    }
    var t = time || 0;
    var cells = EP.layoutCells(photos.length, side, settings);
    for (var i = 0; i < cells.length && i < photos.length; i++) {
      var photo = photos[i];
      var drawable = photo.animated ? photo.frameAt(t) : photo.source;
      if (!drawable) drawable = photo.source;
      var cell = cells[i];
      var radius = Math.min(cell.w, cell.h) * (settings.corner / 100);
      ctx.save();
      EP.roundRectPath(ctx, cell.x, cell.y, cell.w, cell.h, radius);
      ctx.clip();
      drawCover(ctx, drawable, cell);
      ctx.restore();
    }
    return canvas;
  }

  /* ---------- 阶段 4：编码 ---------- */

  function key565(r, g, b) {
    return ((r << 8) & 63488) | ((g << 2) & 992) | (b >> 3);
  }

  function expand565(key) {
    return [(key >> 11) * 8 + 4, ((key >> 5) & 63) * 4 + 2, (key & 31) * 8 + 4];
  }

  function paletteKey565(entry) {
    return key565(entry[0], entry[1], entry[2]);
  }

  function dedupePalette(palette) {
    var seen = Object.create(null);
    var out = [];
    for (var i = 0; i < palette.length; i++) {
      var key = paletteKey565(palette[i]);
      if (!seen[key]) {
        seen[key] = true;
        out.push(palette[i]);
      }
    }
    return out;
  }

  function buildStableLUT(colorEntries) {
    var lut = new Int16Array(65536);
    var i;
    for (i = 0; i < lut.length; i++) lut[i] = -1;

    var present = [];
    for (i = 0; i < colorEntries.length; i++) {
      var key = paletteKey565(colorEntries[i]);
      if (lut[key] === -1) {
        lut[key] = i;
        present.push(key);
      }
    }

    var anchors = [];
    for (i = 0; i < present.length; i++) {
      anchors.push({ idx: lut[present[i]], rgb: expand565(present[i]) });
    }

    for (var b = 0; b < 65536; b++) {
      if (lut[b] !== -1) continue;
      var target = expand565(b);
      var best = anchors[0].idx;
      var bestD = Infinity;
      for (var a = 0; a < anchors.length; a++) {
        var c = anchors[a].rgb;
        var dr = c[0] - target[0];
        var dg = c[1] - target[1];
        var db = c[2] - target[2];
        var d = dr * dr + dg * dg + db * db;
        if (d < bestD) { bestD = d; best = anchors[a].idx; }
      }
      lut[b] = best;
    }
    return lut;
  }

  function applyPaletteStable(rgba, lut, transparentIndex) {
    var n = rgba.length >> 2;
    var index = new Uint8Array(n);
    var hasAlpha = transparentIndex >= 0;
    for (var i = 0; i < n; i++) {
      var o = i * 4;
      if (hasAlpha && rgba[o + 3] < 128) {
        index[i] = transparentIndex;
      } else {
        index[i] = lut[key565(rgba[o], rgba[o + 1], rgba[o + 2])];
      }
    }
    return index;
  }

  function collectPaletteSamples(photos, settings, side, tick, frameCount, transparent) {
    var canvas = document.createElement('canvas');
    canvas.width = SAMPLE_SIZE;
    canvas.height = SAMPLE_SIZE;
    var ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingQuality = 'high';

    var full = document.createElement('canvas');
    full.width = side;
    full.height = side;

    var sampleCount = Math.min(frameCount, SAMPLE_COUNT);
    var chunks = [];
    for (var s = 0; s < sampleCount; s++) {
      var sampleTime = Math.floor((s / sampleCount) * frameCount) * tick;
      renderAt(photos, settings, full, side, sampleTime);
      ctx.clearRect(0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
      ctx.drawImage(full, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
      var data = ctx.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE).data;
      if (!transparent) {
        chunks.push(data.subarray(0, data.length));
      } else {
        var arr = [];
        for (var p = 0; p < data.length; p += 4) {
          if (data[p + 3] >= 128) arr.push(data[p], data[p + 1], data[p + 2], 255);
        }
        chunks.push(new Uint8Array(arr));
      }
    }
    return chunks;
  }

  function sameBytes(a, b) {
    for (var i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return false;
    }
    return true;
  }

  async function encodeGif(photos, settings, onProgress) {
    var side = exportSideFor(photos, settings);
    var tick = computeTick(photos);
    var duration = totalDuration(photos);
    var frameCount = Math.max(1, Math.ceil(duration / tick));
    if (frameCount > MAX_EXPORT_FRAMES) frameCount = MAX_EXPORT_FRAMES;

    var transparentBg = settings.bg === 'transparent';

    var chunks = collectPaletteSamples(photos, settings, side, tick, frameCount, transparentBg);
    var merged = [];
    for (var c = 0; c < chunks.length; c++) {
      for (var k = 0; k < chunks[c].length; k++) merged.push(chunks[c][k]);
    }
    var samples = new Uint8Array(merged);

    // 调色板永远预留最后一个槽位作透明索引：
    // 透明背景时代表真实透明像素；帧间差分时充当"与上一帧相同"的标记。
    var palette = quantize(samples, 255, { format: 'rgb565' });
    palette = dedupePalette(palette);
    palette.push([0, 0, 0, 0]);
    var transparentIndex = palette.length - 1;
    var lut = buildStableLUT(palette.slice(0, -1));

    var canvas = document.createElement('canvas');
    canvas.width = side;
    canvas.height = side;
    var ctx = canvas.getContext('2d', { willReadFrequently: true });

    var encoder = new GIFEncoder();
    var n = side * side;
    var diff = new Uint8Array(n);
    var prevWritten = null;
    var pending = null;

    function buildFrame(index) {
      if (!prevWritten) {
        return { kind: 'full', index: index };
      }

      var minX = side, minY = side, maxX = -1, maxY = -1;
      var needsErase = false;
      for (var p = 0; p < n; p++) {
        var cur = index[p];
        var old = prevWritten[p];
        if (cur === old) {
          diff[p] = transparentIndex;
        } else {
          if (transparentBg && old !== transparentIndex && cur === transparentIndex) {
            needsErase = true;
          }
          diff[p] = cur;
          var px = p % side;
          var py = (p - px) / side;
          if (px < minX) minX = px;
          if (px > maxX) maxX = px;
          if (py < minY) minY = py;
          if (py > maxY) maxY = py;
        }
      }

      if (needsErase) {
        // 有像素从不透明变为透明：差分帧（dispose=1）无法擦除已画内容，
        // 该帧退回整帧重绘 + dispose=2（先清屏再画，擦除语义成立）。
        return { kind: 'erase', index: index };
      }

      var w = maxX - minX + 1;
      var h = maxY - minY + 1;
      var patch = new Uint8Array(w * h);
      for (var r = 0; r < h; r++) {
        var from = (minY + r) * side + minX;
        patch.set(diff.subarray(from, from + w), r * w);
      }
      return { kind: 'diff', index: index, patch: patch, x: minX, y: minY, w: w, h: h };
    }

    function flushPending() {
      if (!pending) return;
      if (pending.kind === 'full') {
        encoder.writeFrame(pending.index, side, side, {
          palette: palette,
          delay: pending.delay,
          repeat: 0,
          transparent: transparentBg,
          transparentIndex: transparentIndex,
          dispose: 1
        });
      } else if (pending.kind === 'diff') {
        encoder.writeFrame(pending.patch, pending.w, pending.h, {
          x: pending.x,
          y: pending.y,
          delay: pending.delay,
          transparent: true,
          transparentIndex: transparentIndex,
          dispose: 1
        });
      } else {
        encoder.writeFrame(pending.index, side, side, {
          delay: pending.delay,
          transparent: transparentBg,
          transparentIndex: transparentIndex,
          dispose: 2
        });
      }
      prevWritten = pending.index;
      pending = null;
    }

    for (var f = 0; f < frameCount; f++) {
      renderAt(photos, settings, canvas, side, f * tick);
      var rgba = ctx.getImageData(0, 0, side, side).data;
      var index = applyPaletteStable(rgba, lut, transparentBg ? transparentIndex : -1);

      if (pending && sameBytes(pending.index, index)) {
        // 静帧：不重复编码，时长攒给下一帧
        pending.delay += tick;
      } else {
        flushPending();
        pending = buildFrame(index);
        pending.delay = tick;
      }

      if (onProgress) onProgress(f + 1, frameCount);
      await new Promise(function (r) { setTimeout(r, 0); });
    }
    flushPending();

    encoder.finish();
    return new Blob([encoder.bytesView()], { type: 'image/gif' });
  }

  /* ---------- 接入核心 ---------- */

  var origDecode = EP.decodeFile;
  EP.decodeFile = async function (file, cap) {
    var animated = await decodeAnimatedGif(file);
    if (animated) return animated;
    var photo = await origDecode(file, cap);
    photo.getDrawable = null;
    return photo;
  };

  EP.hasAnimated = function () {
    return anyAnimated(EP.state.photos);
  };
  EP.renderAt = renderAt;
  EP.encodeGif = encodeGif;
  EP.decodeAnimatedGif = decodeAnimatedGif;
  EP.GIF_EXPORT_SIZE = GIF_EXPORT_SIZE;
  EP.exportSideFor = exportSideFor;
  EP.gifExportSide = function () {
    return exportSideFor(EP.state.photos, EP.state.settings);
  };
})();
