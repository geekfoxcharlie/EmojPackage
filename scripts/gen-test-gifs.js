var fs = require('fs');
var path = require('path');

global.window = {};
eval(fs.readFileSync(path.join(__dirname, '../app/assets/vendor/omggif.js'), 'utf8'));
var GifWriterCtor = global.window.GifWriter;

var SIZE = 480;
var FRAMES = [
  [229, 72, 77],
  [245, 165, 36],
  [70, 167, 88],
  [0, 178, 255]
];

function frameIndex(rgb) {
  var buf = new Uint8Array(SIZE * SIZE);
  var r = (rgb[0] >> 4) * 17, g = (rgb[1] >> 4) * 17, b = (rgb[2] >> 4) * 17;
  var color = (r << 16) | (g << 8) | b;
  for (var i = 0; i < buf.length; i++) buf[i] = 1;
  return { data: buf, palette: [0x000000, color] };
}

var OUT = path.join(__dirname, '../test-assets');
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT);

var buf = new Uint8Array(1024 * 1024);
var gf = new GifWriterCtor(buf, SIZE, SIZE, { loop: 0 });
FRAMES.forEach(function (rgb) {
  var f = frameIndex(rgb);
  gf.addFrame(0, 0, SIZE, SIZE, f.data, { palette: f.palette, delay: 30 });
});
var end = gf.end();

var outPath = path.join(OUT, 'anim_1.gif');
fs.writeFileSync(outPath, Buffer.from(buf.slice(0, end)));
console.log(outPath, end, 'bytes');

var buf2 = new Uint8Array(1024 * 1024);
var gf2 = new GifWriterCtor(buf2, SIZE, SIZE, { loop: 0 });
[[142, 78, 198], [255, 122, 182], [255, 224, 102]].forEach(function (rgb) {
  var f = frameIndex(rgb);
  gf2.addFrame(0, 0, SIZE, SIZE, f.data, { palette: f.palette, delay: 50 });
});
var end2 = gf2.end();
var outPath2 = path.join(OUT, 'anim_2.gif');
fs.writeFileSync(outPath2, Buffer.from(buf2.slice(0, end2)));
console.log(outPath2, end2, 'bytes');
