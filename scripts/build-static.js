const fs = require("fs");
const path = require("path");
const {
  parseCinemaOptions,
  parseShowtimesFragment,
  groupShowtimeMovies,
  fetchPageHtml,
  fetchShowtimesHtml,
  getBrowser,
  SHOWTIMES_URL,
} = require("../server/scrape");

const CONCURRENCY = process.env.CI ? 2 : 3;
const OUT_DIR = path.join(__dirname, "..", "dist");

async function runBatch(items, concurrency, fn) {
  const results = [];
  let idx = 0;
  async function worker() {
    while (idx < items.length) {
      const i = idx++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return results;
}

async function main() {
  console.log("Fetching cinema list…");
  const pageHtml = await fetchPageHtml(SHOWTIMES_URL);
  const cinemas = parseCinemaOptions(pageHtml);
  console.log(`Found ${cinemas.length} cinemas.`);

  const allData = {};
  const total = cinemas.length;

  await runBatch(cinemas, CONCURRENCY, async (cinema, i) => {
    const label = `[${i + 1}/${total}] ${cinema.code} ${cinema.nameTW}`;
    try {
      console.log(`${label} - fetching…`);
      const html = await fetchShowtimesHtml(cinema.code);
      const rows = parseShowtimesFragment(html);
      const movies = groupShowtimeMovies(rows);
      allData[cinema.code] = movies;
      console.log(`${label} - ${movies.length} films`);
    } catch (e) {
      console.error(`${label} - FAILED: ${e.message}`);
      allData[cinema.code] = [];
    }
  });

  const browser = await getBrowser();
  await browser.close();

  const payload = {
    generatedAt: new Date().toISOString(),
    cinemas,
    showtimes: allData,
  };

  const cssText = fs.readFileSync(path.join(__dirname, "..", "public", "styles.css"), "utf8");
  const jsonBlob = JSON.stringify(payload);

  const html = buildHtml(cssText, jsonBlob, payload.generatedAt);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const outPath = path.join(OUT_DIR, "index.html");
  fs.writeFileSync(outPath, html, "utf8");
  console.log(`\nDone! ${outPath} (${(Buffer.byteLength(html) / 1024).toFixed(0)} KB)`);
}

function buildHtml(css, json, generatedAt) {
  return `<!DOCTYPE html>
<html lang="zh-TW">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#f5f0e8">
<title>威秀場次查詢</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;700&display=swap" rel="stylesheet">
<style>${css}</style>
</head>
<body>

<header class="top">
  <div class="top-inner">
    <h1>威秀場次查詢</h1>
    <p class="tagline">資料更新時間：${escHtml(generatedAt)}</p>
  </div>
</header>

<main class="wrap">
  <section class="panel controls">
    <label class="field">
      <span class="label">影城</span>
      <select id="cinema" aria-label="影城">
        <option value="">請選擇影城</option>
      </select>
    </label>
    <label class="field">
      <span class="label">日期</span>
      <select id="dateFilter" aria-label="日期">
        <option value="">所有日期</option>
      </select>
    </label>
    <label class="field grow">
      <span class="label">電影</span>
      <select id="movieFilter" aria-label="電影">
        <option value="">所有電影</option>
      </select>
    </label>
  </section>

  <p id="status" class="status" role="status">請選擇影城以查詢場次。</p>
  <section id="results" class="results" aria-live="polite"></section>
</main>

<footer class="foot">
  <p>資料來源：<a href="https://www.vscinemas.com.tw/ShowTimes/" target="_blank" rel="noopener noreferrer">威秀影城</a>，僅供個人查詢使用。</p>
</footer>

<script>
const DATA = ${json};
</script>
<script>
${staticAppJs()}
</script>
</body>
</html>`;
}

function escHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function staticAppJs() {
  return `
const cinemaEl = document.querySelector("#cinema");
const dateEl = document.querySelector("#dateFilter");
const movieEl = document.querySelector("#movieFilter");
const statusEl = document.querySelector("#status");
const resultsEl = document.querySelector("#results");

let allMovies = [];

for (const c of DATA.cinemas) {
  const o = document.createElement("option");
  o.value = c.code;
  o.textContent = c.nameTW;
  cinemaEl.appendChild(o);
}

function esc(s){return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");}

function countSessions(m){
  let n=0;
  for(const v of m.variants||[])for(const d of v.days||[])n+=d.times?.length||0;
  return n;
}
function sortPop(arr){return[...arr].sort((a,b)=>countSessions(b)-countSessions(a));}

function dateSortKey(tw){const m=/(\\d{2})\\u6708(\\d{2})\\u65e5/.exec(tw||"");return m?m[1]+"-"+m[2]:tw||"";}

function collectDates(movies){
  const seen=new Set(),out=[];
  for(const m of movies)for(const v of m.variants||[])for(const d of v.days||[]){
    if(!seen.has(d.dateTW)){seen.add(d.dateTW);out.push({tw:d.dateTW,en:d.dateEN});}
  }
  out.sort((a,b)=>dateSortKey(a.tw).localeCompare(dateSortKey(b.tw)));
  return out;
}

function filterByDate(movies,dateTW){
  if(!dateTW)return movies;
  const out=[];
  for(const m of movies){
    const vars=[];
    for(const v of m.variants||[]){const days=(v.days||[]).filter(d=>d.dateTW===dateTW);if(days.length)vars.push({...v,days});}
    if(vars.length)out.push({...m,variants:vars});
  }
  return out;
}

function populateDates(movies){
  const prev=dateEl.value,dates=collectDates(movies);
  dateEl.innerHTML='<option value="">\\u6240\\u6709\\u65e5\\u671f</option>';
  for(const d of dates){const o=document.createElement("option");o.value=d.tw;o.textContent=d.tw+"  "+d.en;dateEl.appendChild(o);}
  if(prev&&[...dateEl.options].some(o=>o.value===prev))dateEl.value=prev;
}

function populateMovies(movies){
  const prev=movieEl.value;
  movieEl.innerHTML='<option value="">\\u6240\\u6709\\u96fb\\u5f71</option>';
  for(const m of movies){const o=document.createElement("option");o.value=m.titleTW;o.textContent=m.titleTW+"  ("+countSessions(m)+")";movieEl.appendChild(o);}
  if(prev&&[...movieEl.options].some(o=>o.value===prev))movieEl.value=prev;
}

function chipHtml(v){
  const tw=(v.formatTW||"").trim(),en=(v.formatEN||"").trim();
  if(!tw&&!en)return'<span class="chip chip-muted">\\u4e00\\u822c</span>';
  let h="";if(tw)h+='<span class="chip chip-tw">'+esc(tw)+"</span>";
  if(en)h+='<span class="chip chip-en">'+esc(en)+"</span>";return h;
}

function renderDays(days){
  return days.map(d=>'<div class="day-block"><div class="day-label"><span class="day-tw">'+esc(d.dateTW)+'</span><span class="day-sep" aria-hidden="true">\\u00b7</span><span class="day-en">'+esc(d.dateEN)+'</span></div><div class="times">'+d.times.map(t=>'<span class="time-pill">'+esc(t)+"</span>").join("")+"</div></div>").join("");
}

function render(movies){
  if(!movies.length){resultsEl.innerHTML='<div class="empty">\\u67e5\\u7121\\u5834\\u6b21\\u3002</div>';return;}
  const parts=[];
  for(const m of movies){
    const s=countSessions(m);
    const vh=(m.variants||[]).map(v=>'<section class="variant"><div class="variant-chips" role="group" aria-label="Format">'+chipHtml(v)+'</div><div class="variant-schedule">'+renderDays(v.days||[])+"</div></section>").join("");
    parts.push('<article class="card"><div class="card-head"><h2 class="card-title">'+esc(m.titleTW)+'</h2><span class="session-badge">'+s+' \\u5834</span></div><p class="sub">'+esc(m.titleEN)+'</p><div class="variants">'+vh+"</div></article>");
  }
  resultsEl.innerHTML=parts.join("");
}

function apply(){
  let movies=allMovies;
  const sd=dateEl.value;if(sd){movies=filterByDate(movies,sd);movies=sortPop(movies);}
  const sm=movieEl.value;if(sm)movies=movies.filter(m=>m.titleTW===sm);
  populateMovies(sd?movies:allMovies);
  render(movies);
  const f=[];if(sd)f.push(sd);if(sm)f.push(sm);
  statusEl.textContent=movies.length+" \\u90e8\\u96fb\\u5f71"+(f.length?" \\u00b7 "+f.join(" / "):"");
}

cinemaEl.addEventListener("change",()=>{
  const code=cinemaEl.value;
  if(!code){allMovies=[];populateDates([]);populateMovies([]);resultsEl.innerHTML="";statusEl.textContent="\\u8acb\\u9078\\u64c7\\u5f71\\u57ce\\u3002";return;}
  allMovies=sortPop(DATA.showtimes[code]||[]);
  populateDates(allMovies);populateMovies(allMovies);apply();
});
dateEl.addEventListener("change",()=>apply());
movieEl.addEventListener("change",()=>apply());
`;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
