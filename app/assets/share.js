(function () {
  'use strict';

  if (window.IS_XHS) return;

  var btnDownload = document.getElementById('btnDownload');
  var btnCopy = document.getElementById('btnCopy');
  var modal = document.getElementById('modal');

  function currentExt(result) {
    return result.animated ? 'gif' : (EP.isTransparent(EP.state.settings) ? 'png' : 'jpg');
  }

  function stamp() {
    var d = new Date();
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return '' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes());
  }

  async function buildExport() {
    if (EP.hasAnimated()) {
      var blob = await EP.encodeGif(EP.state.photos, EP.state.settings, function (done, total) {
        EPUI.setBusyText('正在打包动图 ' + Math.round((done / total) * 100) + '%');
      });
      return { blob: blob, mime: 'image/gif', animated: true };
    }
    var canvas = document.createElement('canvas');
    EP.renderAt(EP.state.photos, EP.state.settings, canvas, EP.EXPORT_SIZE, 0);
    var transparent = EP.isTransparent(EP.state.settings);
    var mime = transparent ? 'image/png' : 'image/jpeg';
    blob = await new Promise(function (resolve) {
      canvas.toBlob(resolve, mime, 0.92);
    });
    if (!blob) throw new Error('no blob');
    return { blob: blob, mime: mime, animated: false };
  }

  function triggerDownload(blob, filename) {
    var a = document.createElement('a');
    var url = URL.createObjectURL(blob);
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 4000);
  }

  function withBusy(btn, fn) {
    var label = btn.textContent;
    btn.disabled = true;
    btn.textContent = '打包中…';
    EPUI.setBusy(true, null);
    Promise.resolve()
      .then(fn)
      .catch(function (err) {
        EPUI.toast('打包失败，请重试');
      })
      .then(function () {
        EPUI.setBusy(false, null);
        btn.disabled = false;
        btn.textContent = label;
      });
  }

  function fmtSize(bytes) {
    if (bytes >= 1048576) return (bytes / 1048576).toFixed(1) + ' MB';
    return Math.round(bytes / 1024) + ' KB';
  }

  function openModal(result, filename) {
    modal.innerHTML = '';

    var card = document.createElement('div');
    card.className = 'modal-card';

    var title = document.createElement('p');
    title.className = 'modal-title';
    title.textContent = result.animated ? '打包完成（GIF 动图）' : '打包完成';

    var imgWrap = document.createElement('div');
    imgWrap.className = 'modal-img-wrap';
    var img = document.createElement('img');
    img.src = URL.createObjectURL(result.blob);
    img.alt = '打包结果';
    imgWrap.appendChild(img);

    var hint = document.createElement('p');
    hint.className = 'modal-hint';
    hint.textContent = result.animated
      ? fmtSize(result.blob.size) + ' · 手机浏览器可长按图片保存（会动）'
      : '手机浏览器可长按图片保存到相册';

    var actions = document.createElement('div');
    actions.className = 'modal-actions';

    var btnAgain = document.createElement('button');
    btnAgain.type = 'button';
    btnAgain.className = 'btn btn-primary';
    btnAgain.textContent = '再存一次';
    btnAgain.addEventListener('click', function () {
      triggerDownload(result.blob, filename);
      EPUI.toast('已开始下载');
    });

    var btnCopy2 = document.createElement('button');
    btnCopy2.type = 'button';
    btnCopy2.className = 'btn btn-ghost';
    btnCopy2.textContent = '复制图片';
    if (result.animated) {
      btnCopy2.disabled = true;
    } else {
      btnCopy2.addEventListener('click', function () {
        copyImage();
      });
    }

    actions.appendChild(btnAgain);
    actions.appendChild(btnCopy2);

    var btnClose = document.createElement('button');
    btnClose.type = 'button';
    btnClose.className = 'btn btn-ghost modal-close';
    btnClose.textContent = '关闭';
    btnClose.addEventListener('click', function () {
      modal.hidden = true;
      modal.innerHTML = '';
    });

    card.appendChild(title);
    card.appendChild(imgWrap);
    card.appendChild(hint);
    card.appendChild(actions);
    card.appendChild(btnClose);
    modal.appendChild(card);
    modal.hidden = false;
  }

  modal.addEventListener('click', function (e) {
    if (e.target === modal) {
      modal.hidden = true;
      modal.innerHTML = '';
    }
  });

  async function copyImage() {
    var canvas = document.createElement('canvas');
    EP.renderAt(EP.state.photos, EP.state.settings, canvas, EP.EXPORT_SIZE, 0);
    var blob = await new Promise(function (resolve) {
      canvas.toBlob(resolve, 'image/png');
    });
    if (!blob) throw new Error('no blob');
    if (!navigator.clipboard || typeof ClipboardItem === 'undefined') {
      EPUI.toast('当前浏览器不支持复制图片');
      return;
    }
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      EPUI.toast('已复制，去聊天框粘贴吧');
    } catch (err) {
      EPUI.toast('复制被浏览器拦下了，用下载吧');
    }
  }

  btnDownload.addEventListener('click', function () {
    if (!EPUI.canPack()) return;
    withBusy(btnDownload, async function () {
      var result = await buildExport();
      var filename = 'emojpack-' + stamp() + '.' + currentExt(result);
      triggerDownload(result.blob, filename);
      EPUI.toast(result.animated ? 'GIF 打包完成，开始下载' : '打包完成，开始下载');
      openModal(result, filename);
    });
  });

  btnCopy.addEventListener('click', function () {
    if (EP.hasAnimated()) {
      EPUI.toast('动图请使用下载保存');
      return;
    }
    if (!EPUI.canPack()) return;
    withBusy(btnCopy, function () {
      return copyImage();
    });
  });
})();
