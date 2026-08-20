var fs = require('fs');
var path = require('path');

global.window = {};
eval(fs.readFileSync(path.join(__dirname, '../app/assets/vendor/omggif.js'), 'utf8'));
var GifWriterCtor = global.window.GifWriter;

var SIZE = 480;
var FRAMES = 8;

function buildPalette() {
  var p = [];
  p.push(0x000000);
  for (var i = 0; i < 210; i++) {
    var h = i / 210;
    var r = Math.round((1 - h) * 255);
    var g = Math.round(h * 220);
    var b = Math.round((Math.sin(h * Math.PI) * 60) + 90);
    p.push((r << 16) | (g << 8) | b);
  }
  for (var k = 0; k < 45; k++) p.push((Math.round(k * 5) << 16) | (Math.round(k * 3) << 8) | (200 - k * 3));
  return p;
}

var PALETTE = buildPalette();

function makeFrame(frameIdx) {
  var data = new Uint8Array(SIZE * SIZE);
  var cx = 240, cy = 240, R = 200;
  var mx = 100 + frameIdx * 30, my = 100 + frameIdx * 12;
  for (var y = 0; y < SIZE; y++) {
    for (var x = 0; x < SIZE; x++) {
      var dx = x - cx, dy = y - cy;
      var dist = Math.sqrt(dx * dx + dy * dy);
      var idx = 0;
      if (dist < R) {
        idx = 1 + Math.min(209, Math.floor((dist / R) * 209));
        if (x >= mx && x < mx + 34 && y >= my && y < my + 34) idx = 220 + ((x + frameIdx) % 44);
        if (((x * 7 + y * 13 + frameIdx) % 97) === 0) idx = 255;
      }
      data[y * SIZE + x] = idx;
    }
  }
  return data;
}

var OUT = path.join(__dirname, '../test-assets');
var buf = new Uint8Array(4 * 1024 * 1024);
var gf = new GifWriterCtor(buf, SIZE, SIZE, { loop: 0 });
for (var f = 0; f < FRAMES; f++) {
  gf.addFrame(0, 0, SIZE, SIZE, makeFrame(f), { palette: PALETTE, delay: 12 });
}
var end = gf.end();
var p = path.join(OUT, 'real_1.gif');
fs.writeFileSync(p, Buffer.from(buf.slice(0, end)));
console.log(p, end, 'bytes');
