# 表情打包机

把多张表情（比如一叠道歉表情）打包成一张 1:1 组合大图，诚意拉满。纯前端、零依赖、图片不上传。

## 效果示例

动图打包效果（含动图时导出 GIF，无限循环）：

| 心意满满 | 答应你了 | 疑问三连 | 暴哭认错 |
| --- | --- | --- | --- |
| ![heart](examples/heart.gif) | ![ok](examples/ok.gif) | ![question](examples/question.gif) | ![cry](examples/cry.gif) |

## 产物

| 产物 | 路径 | 说明 |
| --- | --- | --- |
| Web 版（Cloudflare Pages） | `app/` | 直接部署该目录即可，电脑 / 手机浏览器通用 |
| 小红书小工具 zip | `dist/emojpack-xhs.zip` | 上传到小红书小工具平台 |

## 功能

- 选图：相册 / 拖拽 / 粘贴，最多 9 张，缩略图拖动排序，单张删除
- 排版：智能拼图（按张数自动布局）或等分网格；间距 / 圆角 / 边距滑杆；白 / 黑 / 透明 / 自定义背景
- 导出：2160×2160（白/黑/自定义背景 → JPG，透明 → PNG）
  - Web 版：下载（附长按保存兜底弹窗）、复制图片（Chrome/Edge/Safari 16.4+）
  - 小红书版：`saveImageToPhotosAlbum` 存相册、`postNote` 发笔记
- 设置自动记忆（localStorage），移动优先响应式，安全区适配

## 本地开发

```bash
python3 -m http.server 8787 --directory app   # Web 版 http://localhost:8787
```

## 构建 & 校验小红书包

```bash
scripts/build-xhs.sh     # app/ + xhs/bridge.js → minitool-dist/ → dist/emojpack-xhs.zip
scripts/validate-xhs.sh  # 按 minitool-zip-builder skill 规范校验（17 项）
```

## 部署 Web 版到 Cloudflare Pages

方式一（网页）：dash.cloudflare.com → Workers & Pages → Create → Pages → Upload assets，把 `app/` 目录拖进去。

方式二（CLI）：

```bash
npx wrangler pages deploy app --project-name emojpack
```

## 结构

```
app/            # Web 版源码（index.html + assets/{core,anim,ui,share}.js + vendor/{omggif,gifenc} + style.css）
xhs/            # 小红书版（bridge.js 构建时替换 share.js；app-icon.png 应用图标）
examples/       # 效果示例图（工具生成）
minitool-dist/  # 小红书包构建目录（生成物）
dist/           # 最终 zip 产物
scripts/        # 构建 / 校验 / 测试图生成
test-assets/    # 测试用表情图（生成物）
emoj/           # 真实测试表情
.skill/         # 小红书官方 minitool-zip-builder skill
```

## 动图流水线（标准化）

1. **解码归一化**：GIF → 规范帧序列（每帧完整画幅快照 + 起始时间），disposal/部分帧/透明在单次遍历中消化，无共享可变状态
2. **统一时间轴**：全局固定 tick（取各图最短帧间隔，40–100ms 归整）；每图任意时刻显示 `start ≤ t` 的最后一帧（吸附 + 缺帧复制 hold）
3. **纯函数渲染**：`renderAt(photos, settings, canvas, side, time)`，预览与导出共用
4. **编码**：多帧采样全局调色板 + 顺序无关稳定 LUT；透明导出用专用透明索引（色彩 15-bit）
