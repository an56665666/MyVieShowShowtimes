const cinemaEl = document.querySelector("#cinema");
const dateEl = document.querySelector("#dateFilter");
const movieEl = document.querySelector("#movieFilter");
const refreshEl = document.querySelector("#refresh");
const statusEl = document.querySelector("#status");
const resultsEl = document.querySelector("#results");
const loaderEl = document.querySelector("#loader");

let allMovies = [];
let lastMeta = {};

function setStatus(text, isError = false) {
  statusEl.textContent = text;
  statusEl.classList.toggle("error", isError);
}

function showLoader(msg) {
  loaderEl.querySelector(".loader-text").textContent = msg || "Loading…";
  loaderEl.hidden = false;
  statusEl.textContent = "";
  resultsEl.innerHTML = "";
}

function hideLoader() {
  loaderEl.hidden = true;
}

function countSessions(movie) {
  let n = 0;
  for (const v of movie.variants || []) {
    for (const d of v.days || []) {
      n += d.times?.length || 0;
    }
  }
  return n;
}

function dateSortKey(dateTW) {
  const m = /(\d{2})月(\d{2})日/.exec(dateTW || "");
  return m ? `${m[1]}-${m[2]}` : dateTW || "";
}

function collectDates(movies) {
  const seen = new Set();
  const dates = [];
  for (const m of movies) {
    for (const v of m.variants || []) {
      for (const d of v.days || []) {
        if (!seen.has(d.dateTW)) {
          seen.add(d.dateTW);
          dates.push({ tw: d.dateTW, en: d.dateEN });
        }
      }
    }
  }
  dates.sort((a, b) => dateSortKey(a.tw).localeCompare(dateSortKey(b.tw)));
  return dates;
}

function filterByDate(movies, dateTW) {
  if (!dateTW) return movies;
  const out = [];
  for (const m of movies) {
    const variants = [];
    for (const v of m.variants || []) {
      const days = (v.days || []).filter((d) => d.dateTW === dateTW);
      if (days.length) variants.push({ ...v, days });
    }
    if (variants.length) {
      out.push({ ...m, variants });
    }
  }
  return out;
}

async function loadCinemas() {
  showLoader("Loading cinemas…");
  try {
    const res = await fetch("/api/cinemas");
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || data.detail || "Failed to load cinemas");
    cinemaEl.innerHTML = '<option value="">Choose a cinema</option>';
    for (const c of data.cinemas) {
      const opt = document.createElement("option");
      opt.value = c.code;
      opt.textContent = c.nameTW;
      cinemaEl.appendChild(opt);
    }
    hideLoader();
    setStatus("Select a cinema to load showtimes.");
  } catch (e) {
    hideLoader();
    setStatus(e.message || String(e), true);
    cinemaEl.innerHTML = '<option value="">Failed to load</option>';
  }
}

function renderVariantDays(days) {
  return days
    .map(
      (d) => `
      <div class="day-block">
        <div class="day-label">
          <span class="day-tw">${esc(d.dateTW)}</span>
          <span class="day-sep" aria-hidden="true">·</span>
          <span class="day-en">${esc(d.dateEN)}</span>
        </div>
        <div class="times">${d.times.map((t) => `<span class="time-pill">${esc(t)}</span>`).join("")}</div>
      </div>`
    )
    .join("");
}

function chipHtml(v) {
  const tw = (v.formatTW || "").trim();
  const en = (v.formatEN || "").trim();
  if (!tw && !en) {
    return `<span class="chip chip-muted">Standard</span>`;
  }
  const parts = [];
  if (tw) parts.push(`<span class="chip chip-tw">${esc(tw)}</span>`);
  if (en) parts.push(`<span class="chip chip-en">${esc(en)}</span>`);
  return parts.join("");
}

function coalesce(movies) {
  return (movies || []).map((m) => {
    if (Array.isArray(m.variants) && m.variants.length > 0) return m;
    if (m.days && Array.isArray(m.days)) {
      return { titleTW: m.titleTW, titleEN: m.titleEN, variants: [{ formatTW: "", formatEN: "", days: m.days }] };
    }
    return { ...m, variants: [] };
  });
}

function sortByPopularity(movies) {
  return [...movies].sort((a, b) => countSessions(b) - countSessions(a));
}

function populateDateDropdown(movies) {
  const prev = dateEl.value;
  const dates = collectDates(movies);
  dateEl.innerHTML = '<option value="">All dates</option>';
  for (const d of dates) {
    const opt = document.createElement("option");
    opt.value = d.tw;
    opt.textContent = `${d.tw}  ${d.en}`;
    dateEl.appendChild(opt);
  }
  if (prev && [...dateEl.options].some((o) => o.value === prev)) {
    dateEl.value = prev;
  }
}

function populateMovieDropdown(movies) {
  const prev = movieEl.value;
  movieEl.innerHTML = '<option value="">All movies</option>';
  for (const m of movies) {
    const sessions = countSessions(m);
    const opt = document.createElement("option");
    opt.value = m.titleTW;
    opt.textContent = `${m.titleTW}  (${sessions})`;
    movieEl.appendChild(opt);
  }
  if (prev && [...movieEl.options].some((o) => o.value === prev)) {
    movieEl.value = prev;
  }
}

function renderMovies(movies, meta = {}) {
  const { fetchedAt, cached } = meta;
  if (!movies.length) {
    resultsEl.innerHTML = `<div class="empty">No showtimes found.</div>`;
    setStatus(fetchedAt ? `Updated ${fetchedAt}${cached ? " (cached)" : ""}` : "");
    return;
  }

  const variantTotal = movies.reduce((n, m) => n + (m.variants?.length || 0), 0);

  const parts = [];
  for (const m of movies) {
    const sessions = countSessions(m);
    const variants = m.variants || [];
    const variantsHtml = variants
      .map(
        (v) => `
      <section class="variant">
        <div class="variant-chips" role="group" aria-label="Format">${chipHtml(v)}</div>
        <div class="variant-schedule">${renderVariantDays(v.days || [])}</div>
      </section>`
      )
      .join("");

    parts.push(`
      <article class="card">
        <div class="card-head">
          <h2 class="card-title">${esc(m.titleTW)}</h2>
          <span class="session-badge">${sessions} sessions</span>
        </div>
        <p class="sub">${esc(m.titleEN)}</p>
        <div class="variants">${variantsHtml}</div>
      </article>
    `);
  }
  resultsEl.innerHTML = parts.join("");

  const filters = [];
  if (dateEl.value) filters.push(dateEl.value);
  if (movieEl.value) filters.push(movieEl.value);
  setStatus(
    `${movies.length} film(s), ${variantTotal} format(s)` +
      (fetchedAt ? ` · ${fetchedAt}` : "") +
      (cached ? " (cached)" : "") +
      (filters.length ? ` · ${filters.join(" / ")}` : "")
  );
}

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function applyFilter() {
  let movies = allMovies;

  const selectedDate = dateEl.value;
  if (selectedDate) {
    movies = filterByDate(movies, selectedDate);
    movies = sortByPopularity(movies);
  }

  const selectedMovie = movieEl.value;
  if (selectedMovie) {
    movies = movies.filter((m) => m.titleTW === selectedMovie);
  }

  populateMovieDropdown(selectedDate ? movies : allMovies);
  renderMovies(movies, lastMeta);
}

async function loadShowtimes(options = {}) {
  const { bypassCache = false } = options;
  const code = cinemaEl.value;
  if (!code) {
    setStatus("Choose a cinema first.");
    resultsEl.innerHTML = "";
    allMovies = [];
    populateDateDropdown([]);
    populateMovieDropdown([]);
    return;
  }
  refreshEl.disabled = true;
  showLoader("Loading showtimes…");
  try {
    const qs = new URLSearchParams({ cinema: code });
    if (bypassCache) qs.set("nocache", "1");
    const res = await fetch(`/api/showtimes?${qs}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || data.detail || "Failed to load showtimes");
    }
    allMovies = sortByPopularity(coalesce(data.movies));
    lastMeta = { fetchedAt: data.fetchedAt, cached: data.cached };
    populateDateDropdown(allMovies);
    populateMovieDropdown(allMovies);
    hideLoader();
    applyFilter();
  } catch (e) {
    hideLoader();
    setStatus(e.message || String(e), true);
    resultsEl.innerHTML = "";
  } finally {
    refreshEl.disabled = false;
  }
}

cinemaEl.addEventListener("change", () => {
  dateEl.value = "";
  movieEl.value = "";
  loadShowtimes();
});

dateEl.addEventListener("change", () => {
  applyFilter();
});

movieEl.addEventListener("change", () => {
  applyFilter();
});

refreshEl.addEventListener("click", () => loadShowtimes({ bypassCache: true }));

loadCinemas();
