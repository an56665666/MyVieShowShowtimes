const cheerio = require("cheerio");
const { chromium } = require("playwright-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");

chromium.use(StealthPlugin());

const IS_CI = !!process.env.CI;

const BASE = "https://www.vscinemas.com.tw";
const SHOWTIMES_URL = `${BASE}/ShowTimes/`;
const POST_URL = `${BASE}/ShowTimes/ShowTimes/GetShowTimes`;

const CONTEXT_OPTIONS = {
  locale: "zh-TW",
  userAgent:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  viewport: { width: 1280, height: 800 },
};

let browserPromise = null;

/** 共用 Chromium（stealth），避免每次請求都冷啟動 */
function getBrowser() {
  if (!browserPromise) {
    const launchArgs = ["--disable-blink-features=AutomationControlled"];
    if (IS_CI) {
      launchArgs.push("--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage");
    }
    browserPromise = chromium.launch({ headless: true, args: launchArgs });
  }
  return browserPromise;
}

/**
 * 從威秀場次頁 HTML 解析影城選單（繁中／英文對照）
 */
function parseCinemaOptions(html) {
  const $ = cheerio.load(html);
  const tw = new Map();
  $("#CinemaNameTWInfoF option").each((_, el) => {
    const code = $(el).attr("value")?.trim();
    if (!code) return;
    tw.set(code, $(el).text().replace(/\s+/g, " ").trim());
  });
  const en = new Map();
  $("#CinemaNameENInfoF option").each((_, el) => {
    const code = $(el).attr("value")?.trim();
    if (!code) return;
    en.set(code, $(el).text().replace(/\s+/g, " ").trim());
  });
  return [...tw.entries()].map(([code, nameTW]) => ({
    code,
    nameTW,
    nameEN: en.get(code) ?? "",
  }));
}

/**
 * 解析 GetShowTimes 回傳的 HTML 片段
 */
function parseShowtimesFragment(html) {
  const $ = cheerio.load(html);
  const movies = [];

  $("div.col-xs-12").each((_, el) => {
    const $block = $(el);
    if ($block.parent().is("div.SessionTimeInfo")) return;
    const twTitle = $block.children("strong.LangTW.MovieName").first().text().replace(/\s+/g, " ").trim();
    if (!twTitle) return;

    const enTitle = $block.children("strong.LangEN.MovieName").first().text().replace(/\s+/g, " ").trim();
    const $scheduleRoot = $block.children("div.col-xs-12").first();
    if (!$scheduleRoot.length) return;

    const days = [];
    let dateTW = "";
    let dateEN = "";

    $scheduleRoot.children().each((__, node) => {
      const $n = $(node);
      if ($n.is("strong.LangTW.RealShowDate")) {
        dateTW = $n.text().replace(/\s+/g, " ").trim();
        return;
      }
      if ($n.is("strong.LangEN.RealShowDate")) {
        dateEN = $n.text().replace(/\s+/g, " ").trim();
        return;
      }
      if ($n.hasClass("SessionTimeInfo")) {
        const times = [];
        $n.find("div.col-xs-0").each((___, t) => {
          const raw = $(t).html() || "";
          raw
            .split(/<br\s*\/?>/i)
            .map((s) => cheerio.load(`<x>${s}</x>`)("x").text().replace(/\s+/g, " ").trim())
            .filter(Boolean)
            .forEach((x) => times.push(x));
        });
        if (dateTW && times.length) {
          days.push({ dateTW, dateEN, times: [...new Set(times)] });
        }
      }
    });

    movies.push({
      titleTW: twTitle,
      titleEN: enTitle,
      days,
    });
  });

  return movies;
}

/**
 * 威秀有時用全形括號（），需轉成半形才能辨識格式前綴
 */
function normalizeListingTitle(title) {
  return String(title || "")
    .normalize("NFKC")
    .replace(/\uFF08/g, "(")
    .replace(/\uFF09/g, ")")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * 去掉威秀片名最前面的 (4DX)(數位) 等格式前綴，供同片合併
 */
function stripFormatPrefix(title) {
  let t = normalizeListingTitle(title);
  let guard = 0;
  while (guard++ < 4 && /^\([^)]+\)\s*/.test(t)) {
    t = t.replace(/^\([^)]+\)\s*/, "").trim();
  }
  return t;
}

/**
 * 取出第一組括號內的格式說明（若無則空字串）
 */
function extractLeadingParenContent(title) {
  const t = normalizeListingTitle(title);
  const m = /^\(([^)]*)\)\s*/.exec(t);
  if (!m) return "";
  return m[1].replace(/\s+/g, " ").trim();
}

/**
 * 將同一部電影（不同廳別／4DX／數位等）合併為一筆，variants 為各格式場次
 */
function groupShowtimeMovies(movies) {
  const map = new Map();

  for (const m of movies) {
    const key = normalizeListingTitle(stripFormatPrefix(m.titleTW));
    if (!map.has(key)) {
      map.set(key, {
        titleTW: key,
        titleEN: normalizeListingTitle(stripFormatPrefix(m.titleEN)),
        variants: [],
      });
    }
    const g = map.get(key);
    const enCanon = normalizeListingTitle(stripFormatPrefix(m.titleEN));
    if (!g.titleEN && enCanon) {
      g.titleEN = enCanon;
    }
    g.variants.push({
      formatTW: extractLeadingParenContent(m.titleTW),
      formatEN: extractLeadingParenContent(m.titleEN),
      days: m.days,
    });
  }

  for (const g of map.values()) {
    g.variants.sort((a, b) => {
      const aw = a.formatTW || a.formatEN || "";
      const bw = b.formatTW || b.formatEN || "";
      return aw.localeCompare(bw, "zh-Hant");
    });
  }

  function totalSessions(g) {
    let n = 0;
    for (const v of g.variants) {
      for (const d of v.days) {
        n += d.times.length;
      }
    }
    return n;
  }

  return [...map.values()].sort((a, b) => totalSessions(b) - totalSessions(a));
}

/**
 * 造訪首頁取得 Cookie 後 POST 場次；威秀 CDN 會擋純 curl，需瀏覽器指紋
 */
async function fetchPageHtml(url) {
  const browser = await getBrowser();
  const ctx = await browser.newContext(CONTEXT_OPTIONS);
  try {
    const page = await ctx.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90000 });
    await page.waitForTimeout(2000);
    const html = await page.content();
    if (/Access Denied/i.test(await page.title())) {
      const err = new Error("Upstream blocked request (Access Denied)");
      err.code = "UPSTREAM_BLOCKED";
      throw err;
    }
    return html;
  } finally {
    await ctx.close();
  }
}

async function fetchShowtimesHtml(cinemaCode) {
  const browser = await getBrowser();
  const ctx = await browser.newContext(CONTEXT_OPTIONS);
  try {
    const page = await ctx.newPage();
    await page.goto(SHOWTIMES_URL, { waitUntil: "domcontentloaded", timeout: 90000 });
    await page.waitForTimeout(2000);
    if (/Access Denied/i.test(await page.title())) {
      const err = new Error("Upstream blocked request (Access Denied)");
      err.code = "UPSTREAM_BLOCKED";
      throw err;
    }
    const resp = await page.request.post(POST_URL, {
      form: { CinemaCode: cinemaCode },
      timeout: 60000,
    });
    if (!resp.ok()) {
      const err = new Error(`GetShowTimes HTTP ${resp.status()}`);
      err.code = "HTTP_ERROR";
      err.status = resp.status();
      throw err;
    }
    return resp.text();
  } finally {
    await ctx.close();
  }
}

module.exports = {
  getBrowser,
  parseCinemaOptions,
  parseShowtimesFragment,
  normalizeListingTitle,
  stripFormatPrefix,
  groupShowtimeMovies,
  fetchPageHtml,
  fetchShowtimesHtml,
  SHOWTIMES_URL,
};
