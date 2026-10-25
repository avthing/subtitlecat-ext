importScripts("lib.js");

const SITE = "https://www.subtitlecat.com";
const GAP_MS = 1000; // 對 subtitlecat 每次請求至少間隔 1 秒
const MISS_TTL_MS = 60 * 60 * 1000; // 查無結果記 1 小時，避免重新整理就重打
const MAX_CANDIDATES = 4;

let chain = Promise.resolve();
function queued(task) {
  const run = chain.then(task);
  chain = run.catch(() => {}).then(() => new Promise((resolve) => setTimeout(resolve, GAP_MS)));
  return run;
}

function get(url) {
  return queued(async () => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`subtitlecat 回應 HTTP ${response.status}`);
    return response.text();
  });
}

async function lookup(code) {
  const key = "sc:" + code;
  const cached = (await chrome.storage.local.get(key))[key];
  if (cached && (cached.tracks?.length || Date.now() - cached.at < MISS_TTL_MS)) return cached;

  const search = SC.parseSearch(await get(`${SITE}/index.php?search=${encodeURIComponent(code)}`), code);
  let result = { at: Date.now(), tracks: [] };
  for (const candidate of search.slice(0, MAX_CANDIDATES)) {
    const files = SC.parseDetail(await get(`${SITE}/${candidate.href}`));
    if (!files.length) continue;
    const tracks = [];
    for (const file of files) {
      tracks.push({ lang: file.lang, label: file.label, vtt: SC.srtToVtt(await get(SITE + file.path)) });
    }
    result = { at: Date.now(), title: candidate.title, source: `${SITE}/${candidate.href}`, tracks };
    break;
  }
  await chrome.storage.local.set({ [key]: result });
  return result;
}

chrome.runtime.onMessage.addListener((message, _sender, respond) => {
  if (message?.type !== "lookup" || !/^[A-Z]{2,8}-\d{2,5}$/.test(message.code)) return false;
  lookup(message.code).then(
    (data) => respond({ ok: true, ...data }),
    (error) => respond({ ok: false, error: String(error.message || error) }),
  );
  return true; // 非同步回應
});

// 初次安裝時開啟教學頁
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") {
    chrome.tabs.create({ url: chrome.runtime.getURL("docs/index.html") });
  }
});
