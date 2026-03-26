import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { writeFileSync } from "fs";

chromium.use(StealthPlugin());

const base = "https://www.vscinemas.com.tw";

const browser = await chromium.launch({
  headless: true,
  args: ["--disable-blink-features=AutomationControlled"],
});
const ctx = await browser.newContext({
  locale: "zh-TW",
  userAgent:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
});
const page = await ctx.newPage();
await page.goto(`${base}/ShowTimes/`, {
  waitUntil: "domcontentloaded",
  timeout: 90000,
});
await page.waitForTimeout(2000);

const resp = await page.request.post(`${base}/ShowTimes/ShowTimes/GetShowTimes`, {
  form: { CinemaCode: "TP" },
  timeout: 60000,
});
const html = await resp.text();
writeFileSync(new URL("./sample-getshowtimes.html", import.meta.url), html, "utf8");
console.log("status", resp.status(), "len", html.length);
console.log(html.slice(0, 12000));
await browser.close();
