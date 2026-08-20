(function () {
  'use strict';

  var api = window.xhs && window.xhs.miniTool;
  var btnSaveAlbum = document.getElementById('btnSaveAlbum');
  var btnPost = document.getElementById('btnPost');

  if (!api) {
    var guide = function () {
      EPUI.toast('请在小红书内打开，才能存图 / 发笔记');
    };
    btnSaveAlbum.addEventListener('click', guide);
    btnPost.addEventListener('click', guide);
    return;
  }

  async function buildDataURI() {
    if (EP.hasAnimated()) {
      var blob = await EP.encodeGif(EP.state.photos, EP.state.settings, function (done, total) {
        EPUI.setBusyText('正在打包动图 ' + Math.round((done / total) * 100) + '%');
      });
      return await new Promise(function (resolve, reject) {
        var reader = new FileReader();
        reader.onload = function () { resolve(reader.result); };
        reader.onerror = function () { reject(new Error('read failed')); };
        reader.readAsDataURL(blob);
      });
    }
    var canvas = document.createElement('canvas');
    EP.renderAt(EP.state.photos, EP.state.settings, canvas, EP.EXPORT_SIZE, 0);
    return EP.isTransparent(EP.state.settings)
      ? canvas.toDataURL('image/png')
      : canvas.toDataURL('image/jpeg', 0.92);
  }

  function withBusy(btn, fn) {
    var label = btn.textContent;
    btn.disabled = true;
    btn.textContent = '处理中…';
    EPUI.setBusy(true, null);
    Promise.resolve()
      .then(fn)
      .catch(function (err) {
        var msg = (err && err.errMsg) ? err.errMsg : '';
        EPUI.toast('没成功，再试一次' + (msg ? '（' + msg + '）' : ''));
      })
      .then(function () {
        EPUI.setBusy(false, null);
        btn.disabled = false;
        btn.textContent = label;
      });
  }

  btnSaveAlbum.addEventListener('click', function () {
    if (!EPUI.canPack()) return;
    withBusy(btnSaveAlbum, async function () {
      var dataURI = await buildDataURI();
      await api.saveImageToPhotosAlbum({ filePath: dataURI });
      EPUI.toast('已存到相册');
    });
  });

  btnPost.addEventListener('click', function () {
    if (!EPUI.canPack()) return;
    withBusy(btnPost, async function () {
      var dataURI = await buildDataURI();
      await api.postNote({
        pageType: 'photo_publish',
        mediaInfo: {
          image_resources: [{ url: dataURI }]
        }
      });
      EPUI.toast('已拉起发布');
    });
  });
})();
