(() => {
  const $ = (id) => document.getElementById(id);
  const COLORS = [
    ["#ffffff", "白"], ["#000000", "黑"], ["#ff0000", "紅"], ["#00ff00", "綠"],
    ["#0000ff", "藍"], ["#ffff00", "黃"], ["#ff00ff", "洋紅"], ["#00ffff", "青"],
  ];
  const ALPHAS = [100, 75, 50, 25];
  const BG_ALPHAS = [0, 25, 50, 75, 100];

  let style = SC.normalizeStyle();
  const groups = {}; // key → [{ value, button }]

  const save = () => chrome.storage.local.set({ style });

  function render() {
    for (const [key, items] of Object.entries(groups)) {
      for (const { value, button } of items) button.setAttribute("aria-pressed", String(style[key] === value));
    }
    $("bottom").value = style.bottom;
    $("bottomValue").textContent = `${style.bottom}px`;
    // 預覽用同一個轉換；離底距離在這個小框裡按比例縮小示意，實際位置看影片
    const line = document.createElement("div");
    line.textContent = "字幕顯示範例";
    line.style.cssText = SC.styleToCss(style).line;
    $("sample").style.bottom = `${Math.round(26 + style.bottom * 0.22)}px`;
    $("sample").replaceChildren(line);
  }

  function choose(key, value) {
    style = SC.normalizeStyle({ ...style, [key]: value });
    render();
    save();
  }

  // 每個選項是一顆 button（aria-pressed 表示目前選取），內容由 decorate 決定
  function build(key, options, decorate) {
    groups[key] = options.map(([value, label]) => {
      const button = document.createElement("button");
      button.type = "button";
      button.setAttribute("aria-label", label);
      decorate(button, value);
      button.addEventListener("click", () => choose(key, value));
      $(key).append(button);
      return { value, button };
    });
  }

  const swatch = (button, value) => {
    button.className = "swatch";
    button.style.background = value;
  };
  const percent = (button, value) => (button.textContent = `${value}%`);

  build("color", COLORS.map(([value, name]) => [value, `字體顏色 ${name}`]), swatch);
  build("textAlpha", ALPHAS.map((value) => [value, `字體透明度 ${value}%`]), percent);
  build("size", SC.SIZES.map((px, index) => [index, `字體大小 ${px}px`]), (button, index) => {
    button.textContent = "Aa";
    button.style.fontSize = `${10 + index * 1.5}px`;
  });
  build("font", Object.entries(SC.FONTS).map(([value, font]) => [value, `字形 ${font.label}`]), (button, value) => {
    button.textContent = SC.FONTS[value].label;
    button.style.fontFamily = SC.FONTS[value].css;
  });
  build("edge", Object.entries(SC.EDGES).map(([value, edge]) => [value, `邊緣 ${edge.label}`]), (button, value) => {
    button.className = "tile";
    button.textContent = "Aa";
    button.style.textShadow = SC.EDGES[value].css;
  });
  build("bg", COLORS.map(([value, name]) => [value, `背景顏色 ${name}`]), swatch);
  build("bgAlpha", BG_ALPHAS.map((value) => [value, `背景透明度 ${value}%`]), percent);

  $("bottom").addEventListener("input", (event) => choose("bottom", event.target.value));
  $("reset").addEventListener("click", () => {
    style = SC.normalizeStyle();
    render();
    save();
  });

  chrome.storage.local.get("style", (stored) => {
    style = SC.normalizeStyle(stored.style);
    render();
  });
  render();
})();
