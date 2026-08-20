#!/usr/bin/env bash
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIST="$ROOT/minitool-dist"
ZIP="$ROOT/dist/emojpack-xhs.zip"

PASS=0
FAIL=0
RESULTS=""

check() {
  local label="$1"
  local ok="$2"
  if [ "$ok" = "1" ]; then
    PASS=$((PASS + 1))
    RESULTS="${RESULTS}PASS  $label\n"
  else
    FAIL=$((FAIL + 1))
    RESULTS="${RESULTS}FAIL  $label\n"
  fi
}

echo "== 小工具 zip 校验（依据 minitool-zip-builder skill）=="
echo ""

BANNED_PATTERNS=(
  'fetch\('
  'XMLHttpRequest'
  'new WebSocket\('
  'new EventSource\('
  'new RTCPeerConnection\('
  'navigator\.geolocation'
  'navigator\.clipboard'
  'execCommand\('
  'navigator\.bluetooth'
  'navigator\.usb'
  'navigator\.hid'
  'navigator\.serial'
  'navigator\.getBattery'
  'navigator\.connection'
  'navigator\.credentials'
  'navigator\.locks'
  'navigator\.storage\.persist'
  'serviceWorker'
  'enumerateDevices'
  'getDisplayMedia'
  'new Worker\('
  'new SharedWorker\('
  'new Accelerometer'
  'new Gyroscope'
  'new Magnetometer'
  'DeviceMotionEvent'
  'DeviceOrientationEvent'
  'requestFullscreen'
  'eval\('
  'new Function\('
  'WebAssembly'
  'window\.open\('
  'window\.prompt\('
  'location\.href'
  'location\.assign'
  'download\s*='
  'target=._blank'
  '<iframe'
  '<object'
  '<base '
  '<form'
  'javascript:'
  'on(click|change|input|load|error|submit)='
  'type=."module'
  '(import|export)\s+(default|const|let|var|function|class|\{|\*|from)'
  'import\s*\('
  'src=."http'
  'href=."http'
  'url\(http'
)

if [ ! -d "$DIST" ]; then
  echo "未找到 $DIST，请先运行 scripts/build-xhs.sh"
  exit 1
fi

SCAN_HITS=""
for pattern in "${BANNED_PATTERNS[@]}"; do
  hit=$(grep -rIlE "$pattern" "$DIST" --include='*.html' --include='*.js' --include='*.css' 2>/dev/null || true)
  if [ -n "$hit" ]; then
    SCAN_HITS="$SCAN_HITS  - $pattern => $hit\n"
  fi
done

if [ -z "$SCAN_HITS" ]; then
  check "端能力扫描：无禁用 API / 行为残留" 1
else
  check "端能力扫描：无禁用 API / 行为残留" 0
  RESULTS="$RESULTS$SCAN_HITS"
fi

INDEX="$DIST/index.html"
[ -f "$INDEX" ] && check "index.html 位于包根目录" 1 || check "index.html 位于包根目录" 0

grep -q '<!DOCTYPE html>' "$INDEX" && check "DOCTYPE 声明" 1 || check "DOCTYPE 声明" 0
grep -q 'lang="zh-CN"' "$INDEX" && check "lang=zh-CN" 1 || check "lang=zh-CN" 0
grep -q 'charset="UTF-8"' "$INDEX" && check "charset=UTF-8" 1 || check "charset=UTF-8" 0
grep -q 'viewport-fit=cover' "$INDEX" && check "viewport 含 viewport-fit=cover" 1 || check "viewport 含 viewport-fit=cover" 0

INLINE_SCRIPT=$(grep -cE '<script>[^<]|<script type=|<script[^>]*>[^<]+' "$INDEX" || true)
[ "$INLINE_SCRIPT" = "0" ] && check "无内联脚本（全部外置 src）" 1 || check "无内联脚本（全部外置 src）" 0

SCRIPT_TAGS=$(grep -o '<script src="[^"]*"' "$INDEX" | wc -l | tr -d ' ')
[ "$SCRIPT_TAGS" -ge 3 ] && check "脚本按依赖顺序外置引入（$SCRIPT_TAGS 个）" 1 || check "脚本按依赖顺序外置引入（$SCRIPT_TAGS 个）" 0

BAD_REFS=$(grep -oE '(src|href)="[^"]*"' "$INDEX" | grep -v '="\./' | grep -v '="data:' | grep -v '="#"' || true)
[ -z "$BAD_REFS" ] && check "资源引用全部为相对路径 ./ 或 data:" 1 || check "资源引用全部为相对路径 ./ 或 data:" 0

BAD_FILES=$(find "$DIST" -type f | grep -vE '\.(html|css|js|png|jpg|jpeg|gif|webp|svg|woff|woff2|json)$' || true)
[ -z "$BAD_FILES" ] && check "仅包含允许的文件类型" 1 || check "仅包含允许的文件类型：$BAD_FILES" 0

JUNK=$(find "$DIST" \( -name 'node_modules' -o -name '.git' -o -name '.DS_Store' -o -name '*.map' -o -name 'vite.config.*' -o -name 'webpack.config.*' \) || true)
[ -z "$JUNK" ] && check "无 node_modules/.git/.DS_Store/*.map/构建配置" 1 || check "存在垃圾文件：$JUNK" 0

REFS_USED=$(grep -oE '(src|href)="\./[^"]*"' "$INDEX" | sed 's/.*"\.\/\(.*\)"/\1/' | sort -u)
MISSING=""
for ref in $REFS_USED; do
  [ -f "$DIST/$ref" ] || MISSING="$MISSING $ref"
done
[ -z "$MISSING" ] && check "引用资源全部存在于包内" 1 || check "缺失资源：$MISSING" 0

if [ -f "$ZIP" ]; then
  ZIP_ROOT_INDEX=$(unzip -l "$ZIP" | awk '{print $4}' | grep -x 'index.html' || true)
  [ -n "$ZIP_ROOT_INDEX" ] && check "zip 解压后 index.html 直接在根" 1 || check "zip 解压后 index.html 直接在根" 0

  ZIP_EXTRA_DIR=$(unzip -l "$ZIP" | awk '{print $4}' | grep -E '^[^/]+/$' | grep -v '/$' || true)
  TOP_DIR_COUNT=$(unzip -l "$ZIP" | awk '{print $4}' | grep -v '^$' | grep -c '/$' || true)
  [ "$TOP_DIR_COUNT" -le 2 ] && check "zip 未多套目录（压缩内容而非文件夹）" 1 || check "zip 未多套目录（压缩内容而非文件夹）" 0

  ZIP_SIZE=$(stat -f%z "$ZIP" 2>/dev/null || stat -c%s "$ZIP")
  ZIP_KB=$((ZIP_SIZE / 1024))
  [ "$ZIP_SIZE" -le 10485760 ] && check "zip 总体积 ${ZIP_KB}KB ≤ 10MB（建议 ≤2MB）" 1 || check "zip 总体积 ${ZIP_KB}KB 超 10MB" 0
  [ "$ZIP_SIZE" -le 2097152 ] && check "体积优于 2MB 建议" 1 || check "体积超过 2MB 建议值（功能完整前提下可接受）" 0
else
  check "zip 产物存在" 0
fi

JS_SYNTAX_OK=1
for jsfile in "$DIST"/assets/*.js; do
  node --check "$jsfile" 2>/dev/null || JS_SYNTAX_OK=0
done
[ "$JS_SYNTAX_OK" = "1" ] && check "JS 语法检查（node --check）全部通过" 1 || check "JS 语法检查（node --check）失败" 0

printf "$RESULTS"
echo ""
echo "结果: $PASS 项通过, $FAIL 项未通过"
[ "$FAIL" = "0" ]
