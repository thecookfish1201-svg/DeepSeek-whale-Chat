#!/usr/bin/env node
/**
 * 立绘预处理脚本
 * - 读取原始绿幕 PNG
 * - 移除绿色背景（色度抠图）
 * - 以角色身体（最大连通区域）为基准，统一缩放并对齐到同一透明画布
 * - 输出到 assets/ 目录，供 index.html 直接使用
 *
 * 用法：node tools/process-assets.js
 */
const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

const ROOT = path.resolve(__dirname, '..');
const SRC_DIR = ROOT;
const OUT_DIR = path.join(ROOT, 'assets');

// 输出画布与对齐参数：所有立绘都落在同一坐标系，切换时不会位移
const CANVAS_W = 1200;
const CANVAS_H = 1600;
const TARGET_BODY_H = 1400; // 角色身体统一高度
const BODY_CENTER_Y = CANVAS_H * 0.5; // 身体中心位于画布中部

// 文件名映射（原始文件 -> 情绪状态文件名）
const ASSET_MAP = [
  ['DeepSeek（常态）.png', 'normal.png'],
  ['DeepSeek（开心）.png', 'happy.png'],
  ['DeepSeek（惊喜）.png', 'surprised.png'],
  ['DeepSeek（愤怒）.png', 'angry.png'],
  ['DeepSeek（疑惑）.png', 'thinking.png'],
  ['DeepSeek（被震撼）.png', 'sad.png'],      // 带泪的震撼表情，作为“悲伤”的近似素材
  ['DeepSeek（紧张、心虚、害怕）.png', 'nervous.png'],
  ['DeepSeek（傻乐呵、“流口水”）.png', 'silly.png'],
  ['DeepSeek（干饭、吃token）.png', 'eating.png'],
  ['受击打.png', 'hit.png'],
];

// 判断是否为绿幕像素
function isGreen(r, g, b, a) {
  if (a < 10) return true;
  return g > 100 && g > r * 1.35 && g > b * 1.35;
}

// 提取前景掩码，并找出最大连通区域（角色身体）
function bodyBBox(png) {
  const { width, height, data } = png;
  const mask = new Uint8Array(width * height);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
    mask[p] = isGreen(r, g, b, a) ? 0 : 1;
  }

  const visited = new Uint8Array(width * height);
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  let best = null;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x;
      if (!mask[p] || visited[p]) continue;
      const stack = [p];
      visited[p] = 1;
      let size = 0, minX = x, minY = y, maxX = x, maxY = y;

      while (stack.length) {
        const cp = stack.pop();
        const cx = cp % width;
        const cy = (cp / width) | 0;
        size++;
        if (cx < minX) minX = cx;
        if (cx > maxX) maxX = cx;
        if (cy < minY) minY = cy;
        if (cy > maxY) maxY = cy;
        for (const [dx, dy] of dirs) {
          const nx = cx + dx, ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const np = ny * width + nx;
          if (mask[np] && !visited[np]) {
            visited[np] = 1;
            stack.push(np);
          }
        }
      }

      if (!best || size > best.size) {
        best = { size, minX, minY, maxX, maxY };
      }
    }
  }

  return best;
}

// 双线性采样：从源图读取一个坐标处的 RGBA
function samplePixel(source, sx, sy) {
  const { width, height, data } = source;
  const x0 = Math.floor(sx);
  const y0 = Math.floor(sy);
  const x1 = Math.min(x0 + 1, width - 1);
  const y1 = Math.min(y0 + 1, height - 1);
  const x = sx - x0;
  const y = sy - y0;

  const idx = (xx, yy) => ((yy * width + xx) * 4);
  const i00 = idx(x0, y0), i10 = idx(x1, y0), i01 = idx(x0, y1), i11 = idx(x1, y1);

  const out = [0, 0, 0, 0];
  for (let c = 0; c < 4; c++) {
    const v00 = data[i00 + c];
    const v10 = data[i10 + c];
    const v01 = data[i01 + c];
    const v11 = data[i11 + c];
    out[c] = v00 * (1 - x) * (1 - y) + v10 * x * (1 - y) + v01 * (1 - x) * y + v11 * x * y;
  }
  return out;
}

// 将源图按身体中心对齐并缩放绘制到统一透明画布
function renderToCanvas(source, bbox) {
  const bodyW = bbox.maxX - bbox.minX + 1;
  const bodyH = bbox.maxY - bbox.minY + 1;
  const scale = TARGET_BODY_H / bodyH;
  const srcCx = (bbox.minX + bbox.maxX + 1) / 2;
  const srcCy = (bbox.minY + bbox.maxY + 1) / 2;
  const dstCx = CANVAS_W / 2;
  const dstCy = BODY_CENTER_Y;

  const out = new PNG({ width: CANVAS_W, height: CANVAS_H });
  const outData = out.data;

  for (let dy = 0; dy < CANVAS_H; dy++) {
    for (let dx = 0; dx < CANVAS_W; dx++) {
      const sx = (dx - dstCx) / scale + srcCx;
      const sy = (dy - dstCy) / scale + srcCy;
      // 超出源图范围的像素保持透明
      if (sx < 0 || sy < 0 || sx >= source.width || sy >= source.height) continue;

      const s = samplePixel(source, sx, sy);
      const i = (dy * CANVAS_W + dx) * 4;
      // 直接写入采样 RGBA；源图绿幕处 alpha 已通过采样保留为接近 0
      outData[i] = Math.round(s[0]);
      outData[i + 1] = Math.round(s[1]);
      outData[i + 2] = Math.round(s[2]);
      outData[i + 3] = Math.round(s[3]);
    }
  }

  return out;
}

// 对输出再做一次边缘清理：把残留绿边压暗/透明
function cleanupGreenEdge(png) {
  const { width, height, data } = png;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
    if (a > 0) {
      // 边缘仍带绿但并非主体颜色，将 alpha 降低并去除绿色分量
      const greenExcess = Math.max(0, g - Math.max(r, b));
      if (greenExcess > 12) {
        const reduce = Math.min(1, (greenExcess - 12) / 40);
        data[i] = r;
        data[i + 1] = Math.max(r, b);
        data[i + 2] = b;
        data[i + 3] = Math.round(a * (1 - reduce));
      }
    }
  }
  return png;
}

if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

for (const [srcName, outName] of ASSET_MAP) {
  const srcPath = path.join(SRC_DIR, srcName);
  if (!fs.existsSync(srcPath)) {
    console.warn(`跳过（未找到）: ${srcName}`);
    continue;
  }

  const source = PNG.sync.read(fs.readFileSync(srcPath));
  const bbox = bodyBBox(source);
  if (!bbox) {
    console.warn(`跳过（无前景）: ${srcName}`);
    continue;
  }

  let canvas = renderToCanvas(source, bbox);
  canvas = cleanupGreenEdge(canvas);
  const outPath = path.join(OUT_DIR, outName);
  fs.writeFileSync(outPath, PNG.sync.write(canvas));
  console.log(`生成 ${outName} <- ${srcName} (身体 ${bbox.maxX - bbox.minX + 1}x${bbox.maxY - bbox.minY + 1})`);
}

// 额外生成 calm.png 作为 normal.png 的别名，兼容“平静”回退名称
const normalSrc = path.join(OUT_DIR, 'normal.png');
if (fs.existsSync(normalSrc)) {
  fs.copyFileSync(normalSrc, path.join(OUT_DIR, 'calm.png'));
  console.log('生成 calm.png <- normal.png');
}

// 同时生成中文文件名的别名，方便直接按状态名引用
const CN_ALIASES = {
  'normal.png': ['平静.png', '常态.png'],
  'happy.png': ['开心.png'],
  'surprised.png': ['惊喜.png'],
  'angry.png': ['愤怒.png'],
  'thinking.png': ['思索.png'],
  'sad.png': ['悲伤.png'],
};
for (const [srcName, aliases] of Object.entries(CN_ALIASES)) {
  const src = path.join(OUT_DIR, srcName);
  if (!fs.existsSync(src)) continue;
  for (const alias of aliases) {
    fs.copyFileSync(src, path.join(OUT_DIR, alias));
    console.log(`生成 ${alias} <- ${srcName}`);
  }
}
