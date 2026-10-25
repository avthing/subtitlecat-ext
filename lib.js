// 純函式：background 與 content 共用，也可在 node 下測試。
const SC = {
  // 從網址路徑最後一段抽番號：/videos/mikr-112/ → MIKR-112；/dm12/cn/mikr-112-uncensored-leak → MIKR-112
  codeFromPath(pathname) {
    const segments = pathname.split("/").filter(Boolean).reverse();
    for (const segment of segments) {
      const match = /^([a-z]{2,8})-(\d{2,5})(?![0-9])/i.exec(segment);
      if (match) return `${match[1].toUpperCase()}-${match[2]}`;
    }
    return null;
  },

  // 搜尋頁連結：<a href="subs/1636/xxx.html">標題</a>；只留標題含該番號的
  parseSearch(html, code) {
    const [prefix, number] = code.split("-");
    const title = new RegExp(`(?<![A-Z0-9])${prefix}[-_ ]?${number}(?![0-9])`, "i");
    const found = [];
    const link = /<a href="(subs\/\d+\/[^"]+\.html)">([^<]*)<\/a>/g;
    for (let m; (m = link.exec(html)); ) {
      if (title.test(m[2]) && !found.some((row) => row.href === m[1])) found.push({ href: m[1], title: m[2] });
    }
    return found;
  },

  // 詳情頁的中文 SRT 連結；繁體排前面
  parseDetail(html) {
    const files = {};
    const link = /href="(\/subs\/\d+\/[^"]+-zh-(TW|CN)\.srt)"/g;
    for (let m; (m = link.exec(html)); ) files[m[2]] ??= m[1];
    return [
      ...(files.TW ? [{ lang: "zh-TW", label: "繁中", path: files.TW }] : []),
      ...(files.CN ? [{ lang: "zh-CN", label: "简中", path: files.CN }] : []),
    ];
  },

  srtToVtt(srt) {
    const body = srt
      .replace(/^﻿/, "")
      .replace(/\r\n?/g, "\n")
      .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, "$1.$2");
    return "WEBVTT\n\n" + body.trim() + "\n";
  },

  // SRT/VTT 文字 → [{ start, end, text }]（秒）。不用 <track>：播放器會接管或換掉 <video>，自己算最穩。
  parseCues(text) {
    const seconds = (stamp) => {
      const [h, m, s] = stamp.replace(",", ".").split(":");
      return +h * 3600 + +m * 60 + +s;
    };
    const cues = [];
    for (const block of text.replace(/\r\n?/g, "\n").split(/\n{2,}/)) {
      const lines = block.split("\n");
      const at = lines.findIndex((line) => line.includes("-->"));
      const time = at < 0 ? null : /(\d+:\d{2}:\d{2}[.,]\d{3})\s*-->\s*(\d+:\d{2}:\d{2}[.,]\d{3})/.exec(lines[at]);
      if (!time) continue;
      cues.push({
        start: seconds(time[1]),
        end: seconds(time[2]),
        text: lines.slice(at + 1).join("\n").replace(/<[^>]+>/g, "").trim(),
      });
    }
    return cues;
  },

  // 字幕樣式：popup 預覽與 content 的 overlay 共用同一份轉換，預覽才會和實際一致。預設值 = 原本的外觀。
  DEFAULT_STYLE: { color: "#ffffff", textAlpha: 100, size: 2, font: "default", edge: "shadow", bg: "#000000", bgAlpha: 0, bottom: 70 },
  SIZES: [14, 18, 22, 28, 34, 40],
  FONTS: {
    default: { label: "預設", css: "sans-serif" },
    jhenghei: { label: "正黑體", css: '"Microsoft JhengHei","PingFang TC","Noto Sans TC",sans-serif' },
    ming: { label: "明體", css: '"PMingLiU","MingLiU","Songti TC","Noto Serif TC",serif' },
    kai: { label: "標楷體", css: '"DFKai-SB","BiauKai","Kaiti TC",serif' },
  },
  EDGES: {
    none: { label: "無", css: "none" },
    shadow: { label: "陰影", css: "0 0 4px #000,0 0 4px #000,0 0 4px #000" },
    outline: { label: "外框", css: "-2px 0 #000,2px 0 #000,0 -2px #000,0 2px #000,-1.5px -1.5px #000,1.5px -1.5px #000,-1.5px 1.5px #000,1.5px 1.5px #000" },
    heavy: { label: "濃陰影", css: "0 2px 6px #000,0 0 8px #000,0 0 8px #000,0 0 12px #000" },
  },

  // 任何來源的設定都先過這裡：缺值補預設、未知值回預設、數字夾限。
  normalizeStyle(raw) {
    const d = SC.DEFAULT_STYLE;
    const s = raw && typeof raw === "object" ? raw : {};
    const hex = (v, fallback) => (typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : fallback);
    const num = (v, min, max, fallback) => (Number.isFinite(+v) && v !== null && v !== "" ? Math.min(max, Math.max(min, Math.round(+v))) : fallback);
    return {
      color: hex(s.color, d.color),
      textAlpha: num(s.textAlpha, 0, 100, d.textAlpha),
      size: num(s.size, 0, SC.SIZES.length - 1, d.size),
      font: Object.hasOwn(SC.FONTS, s.font) ? s.font : d.font,
      edge: Object.hasOwn(SC.EDGES, s.edge) ? s.edge : d.edge,
      bg: hex(s.bg, d.bg),
      bgAlpha: num(s.bgAlpha, 0, 100, d.bgAlpha),
      bottom: num(s.bottom, 0, 300, d.bottom),
    };
  },

  // → { box: 容器的 cssText, line: 每一行字幕的 cssText }
  styleToCss(raw) {
    const s = SC.normalizeStyle(raw);
    const rgba = (hex, alpha) => {
      const n = parseInt(hex.slice(1), 16);
      return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${alpha / 100})`;
    };
    return {
      box: `position:absolute;left:5%;right:5%;bottom:${s.bottom}px;z-index:2147483646;text-align:center;pointer-events:none;`,
      line:
        `display:table;margin:2px auto 0;padding:0 .3em;border-radius:4px;font:600 ${SC.SIZES[s.size]}px/1.4 ${SC.FONTS[s.font].css};` +
        `color:${rgba(s.color, s.textAlpha)};background:${rgba(s.bg, s.bgAlpha)};text-shadow:${SC.EDGES[s.edge].css}`,
    };
  },
};

if (typeof module !== "undefined") module.exports = SC;
