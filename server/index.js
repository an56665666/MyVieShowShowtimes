const path = require("path");
const express = require("express");
const {
  parseCinemaOptions,
  parseShowtimesFragment,
  groupShowtimeMovies,
  fetchPageHtml,
  fetchShowtimesHtml,
  SHOWTIMES_URL,
} = require("./scrape");

const app = express();
const PORT = Number(process.env.PORT) || 3847;

// 簡易記憶體快取，降低對威秀伺服器壓力
const CINEMA_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const SHOWTIME_CACHE_TTL_MS = 3 * 60 * 1000;
/** 快取結構或合片邏輯變更時遞增，舊資料會自動作廢 */
const SHOWTIMES_SCHEMA_VERSION = 3;

const cache = {
  cinemas: { at: 0, data: null },
  showtimes: new Map(),
};

function getCachedShowtimes(key) {
  const hit = cache.showtimes.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > SHOWTIME_CACHE_TTL_MS) {
    cache.showtimes.delete(key);
    return null;
  }
  if (hit.data.schemaVersion !== SHOWTIMES_SCHEMA_VERSION) {
    cache.showtimes.delete(key);
    return null;
  }
  return hit.data;
}

function setCachedShowtimes(key, data) {
  cache.showtimes.set(key, { at: Date.now(), data });
}

app.use(express.static(path.join(__dirname, "..", "public")));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/cinemas", async (_req, res) => {
  try {
    const now = Date.now();
    if (cache.cinemas.data && now - cache.cinemas.at < CINEMA_CACHE_TTL_MS) {
      return res.json({ source: SHOWTIMES_URL, cinemas: cache.cinemas.data, cached: true });
    }
    const html = await fetchPageHtml(SHOWTIMES_URL);
    const cinemas = parseCinemaOptions(html);
    cache.cinemas = { at: now, data: cinemas };
    res.json({ source: SHOWTIMES_URL, cinemas, cached: false });
  } catch (e) {
    const status = e.code === "UPSTREAM_BLOCKED" ? 503 : 500;
    res.status(status).json({
      error: e.code === "UPSTREAM_BLOCKED" ? "Service temporarily unavailable" : "Failed to load cinemas",
      detail: String(e.message),
    });
  }
});

app.get("/api/showtimes", async (req, res) => {
  const cinema = String(req.query.cinema || "").trim();
  const nocache = req.query.nocache === "1" || req.query.nocache === "true";

  if (!cinema) {
    return res.status(400).json({ error: "Missing query parameter: cinema" });
  }

  const cacheKey = cinema;
  try {
    if (nocache) {
      cache.showtimes.delete(cacheKey);
    }
    const hit = getCachedShowtimes(cacheKey);
    const fromCache = Boolean(hit);
    let payload = hit;
    if (!payload) {
      const html = await fetchShowtimesHtml(cinema);
      const rows = parseShowtimesFragment(html);
      payload = {
        cinema,
        fetchedAt: new Date().toISOString(),
        moviesFlat: rows,
        schemaVersion: SHOWTIMES_SCHEMA_VERSION,
      };
      setCachedShowtimes(cacheKey, payload);
    }

    const rows = payload.moviesFlat ?? payload.movies ?? [];
    const movies = groupShowtimeMovies(rows);

    res.json({
      cinema: payload.cinema,
      fetchedAt: payload.fetchedAt,
      movies,
      cached: fromCache,
    });
  } catch (e) {
    const status = e.code === "UPSTREAM_BLOCKED" ? 503 : 500;
    res.status(status).json({
      error: e.code === "UPSTREAM_BLOCKED" ? "Service temporarily unavailable" : "Failed to load showtimes",
      detail: String(e.message),
    });
  }
});

const server = app.listen(PORT, () => {
  console.log(`MyWeiShow server http://127.0.0.1:${PORT}`);
});
server.on("error", (e) => {
  console.error("Server error:", e.message);
  process.exit(1);
});
