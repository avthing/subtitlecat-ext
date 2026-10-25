(() => {
  const code = SC.codeFromPath(location.pathname);
  if (!code) return;

  const log = (...args) => console.log("[subtitlecat-ext]", ...args);

  const badge = document.createElement("div");
  badge.style.cssText =
    "position:fixed;left:12px;bottom:12px;z-index:2147483647;padding:6px 10px;border-radius:6px;" +
    "background:rgba(0,0,0,.75);color:#fff;font:13px/1.4 sans-serif;cursor:pointer;user-select:none";
  document.documentElement.append(badge);
  let note = "";
  let state = "搜尋字幕中…";
  const say = (text) => {
    state = text;
    badge.textContent = `[${code}] ${state}${note}`;
  };
  say(state);

  // 全螢幕時只有全螢幕元素內的節點看得到，徽章要跟著搬進去
  document.addEventListener("fullscreenchange", () => (document.fullscreenElement || document.body).append(badge));

  const tracks = []; // { label, cues }
  let current = -1; // -1 = 關閉

  // Plyr 這類播放器自己接管字幕渲染，不畫動態加入的原生軌道（實測 activeCues 有值但畫面無字）。
  // Jable 頁面上另有預覽小影片與廣告 <video>，掛在特定元素上的做法會被換掉。
  // 所以字幕自己解析成陣列，每 250ms 找一次主影片、依它的 currentTime 畫 overlay。
  const overlay = document.createElement("div");

  // 樣式由 popup 寫進 storage（key: style），這裡讀取並在變動時即時套用到現有字幕行
  let css = SC.styleToCss();
  function applyStyle(style) {
    css = SC.styleToCss(style);
    overlay.style.cssText = css.box;
    for (const row of overlay.children) row.style.cssText = css.line;
  }
  applyStyle();
  chrome.storage.local.get("style", (stored) => applyStyle(stored.style));
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.style) applyStyle(changes.style.newValue);
  });

  // 主片的判別依據是時長：預覽小影片與廣告都只有幾十秒，主片是整部。
  // 位置與尺寸都不可靠（廣告 <video> 與主片同尺寸，也可能是同一個容器的子元素）。
  function pickVideo() {
    const video = [...document.querySelectorAll("video")]
      .filter((el) => Number.isFinite(el.duration) && el.duration > 60)
      .sort((a, b) => b.duration - a.duration)[0];
    return video ? { video, via: "duration" } : null;
  }

  let mounted = null;
  let shown = "";
  let lastMissLog = 0;
  function mount(video, via) {
    const host = video.closest(".plyr") || video.parentElement;
    if (getComputedStyle(host).position === "static") host.style.position = "relative";
    host.append(overlay);
    mounted = video;
    note = ` · 影片 ${video.clientWidth}×${video.clientHeight} 時長${Math.round(video.duration / 60)}分`;
    say(state);
    log("掛到影片", {
      via,
      size: `${video.clientWidth}x${video.clientHeight}`,
      minutes: Math.round(video.duration / 60),
      host: host.className.slice(0, 40),
      all: [...document.querySelectorAll("video")].map((el) => `${el.clientWidth}x${el.clientHeight}/${Math.round(el.duration) || 0}s`),
    });
  }

  function tick() {
    if (current < 0) {
      if (overlay.textContent) overlay.replaceChildren();
      return;
    }
    const picked = pickVideo();
    if (!picked) {
      if (Date.now() - lastMissLog > 10000) {
        lastMissLog = Date.now();
        log("還沒找到主影片，影片數", document.querySelectorAll("video").length);
      }
      return;
    }
    if (picked.video !== mounted || !overlay.isConnected) mount(picked.video, picked.via);
    const time = picked.video.currentTime;
    const text = tracks[current].cues
      .filter((cue) => time >= cue.start && time < cue.end)
      .map((cue) => cue.text)
      .join("\n");
    if (text === shown) return;
    shown = text;
    overlay.replaceChildren(
      ...text
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          const row = document.createElement("div");
          row.textContent = line;
          row.style.cssText = css.line;
          return row;
        }),
    );
    if (text) log("字幕", time.toFixed(1), text.slice(0, 40));
  }

  function select(index) {
    current = index;
    shown = "";
    say(current < 0 ? "字幕關閉（點此或按 C 切換）" : `${tracks[current].label} 顯示中（點此或按 C 切換）`);
    tick();
  }
  function cycle() {
    if (tracks.length) select(current + 1 >= tracks.length ? -1 : current + 1);
  }
  badge.addEventListener("click", cycle);
  document.addEventListener("keydown", (event) => {
    if (event.key.toLowerCase() === "c" && !/input|textarea/i.test(event.target.tagName || "")) cycle();
  });

  chrome.runtime.sendMessage({ type: "lookup", code }, (reply) => {
    if (chrome.runtime.lastError || !reply?.ok) {
      const reason = chrome.runtime.lastError?.message || reply?.error || "未知錯誤";
      log("查詢失敗", reason);
      say("查詢失敗：" + reason);
      return;
    }
    if (!reply.tracks.length) {
      log("subtitlecat 沒有中文字幕");
      say("subtitlecat 沒有中文字幕");
      return;
    }
    for (const item of reply.tracks) tracks.push({ label: item.label, cues: SC.parseCues(item.vtt) });
    log("字幕已取得", tracks.map((row) => `${row.label}:${row.cues.length}則`).join(" "), reply.source);
    select(0);
    setInterval(tick, 250);
  });
})();
