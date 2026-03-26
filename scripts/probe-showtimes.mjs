import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";

chromium.use(StealthPlugin());

const url = "https://www.vscinemas.com.tw/ShowTimes/";

const browser = await chromium.launch({
  headless: true,
  args: ["--disable-blink-features=AutomationControlled"],
});
const ctx = await browser.newContext({
  locale: "zh-TW",
  userAgent:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  viewport: { width: 1280, height: 800 },
});
const page = await ctx.newPage();
await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90000 });
await page.waitForTimeout(8000);
const title = await page.title();
const html = await page.content();
await browser.close();
console.log("TITLE:", title);
console.log(html.slice(0, 30000));
