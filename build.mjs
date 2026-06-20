// build.mjs
// Fetches your Goodreads (books), Letterboxd (film), and Trakt (TV) activity,
// normalizes each into a common shape, and writes a static HTML fragment
// (feed.html) you can paste into a Bear Blog page.
//
// Runs in Node 18+ (global fetch, no dependencies needed for fetching).
// XML parsing is done with a tiny dependency-free regex parser tuned to the
// exact feed shapes — not a general XML library, on purpose, to keep this
// zero-install and easy to maintain.
//
// Configuration comes from environment variables (set as GitHub Actions
// secrets / vars — see README):
//   GOODREADS_RSS    full Goodreads "read" shelf RSS URL
//   LETTERBOXD_RSS   full Letterboxd RSS URL
//   TRAKT_CLIENT_ID  Trakt application Client ID
//   TRAKT_USERNAME   your Trakt username (public profile)

import { writeFile } from "node:fs/promises";

// ---- config -----------------------------------------------------------------

const CONFIG = {
  goodreadsRss: process.env.GOODREADS_RSS
    || "https://www.goodreads.com/review/list_rss/173090020-marcus?shelf=read",
  goodreadsReadingRss: process.env.GOODREADS_READING_RSS
    || "https://www.goodreads.com/review/list_rss/173090020-marcus?shelf=currently-reading",
  letterboxdRss: process.env.LETTERBOXD_RSS
    || "https://letterboxd.com/wellactuarially/rss",
  traktClientId: process.env.TRAKT_CLIENT_ID || "",
  traktUsername: process.env.TRAKT_USERNAME || "wellactuarially",
  tmdbToken: process.env.TMDB_TOKEN || "",
  perSection: 10,
  tvSection: 25,
};

const PROFILE_LINKS = {
  books: "https://www.goodreads.com/review/list/173090020-marcus?shelf=read",
  reading: "https://www.goodreads.com/review/list/173090020-marcus?shelf=currently-reading",
  film: "https://letterboxd.com/wellactuarially/films/",
  tv: `https://trakt.tv/users/${CONFIG.traktUsername}/history/episodes`,
};

// ---- tiny helpers -----------------------------------------------------------

// Decode the handful of XML/HTML entities that actually show up in these feeds.
function decodeEntities(s) {
  if (!s) return "";
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .trim();
}

// Strip HTML tags (used for review/notes snippets where we just want text).
function stripTags(s) {
  return decodeEntities((s || "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

// Like stripTags, but preserves paragraph/line breaks as newlines.
// Used for review/note text where structure matters.
function stripTagsKeepBreaks(s) {
  if (!s) return "";
  let t = s
    .replace(/<\s*br\s*\/?>/gi, "\n")       // <br> → newline
    .replace(/<\/\s*p\s*>/gi, "\n\n")        // </p> → blank line
    .replace(/<[^>]+>/g, "");                // drop all other tags
  t = decodeEntities(t);
  // Collapse runs of spaces/tabs, but keep newlines. Trim trailing space per line.
  t = t.replace(/[ \t]+/g, " ")
       .replace(/ *\n */g, "\n")             // tidy space around newlines
       .replace(/\n{3,}/g, "\n\n")           // cap blank runs at one
       .trim();
  return t;
}

// Wrap Trakt inline [spoiler]...[/spoiler] in click-to-reveal spans.
// Input must already be HTML-escaped; the [spoiler] markers are literal text
// from Trakt (not HTML), so they pass through escapeHtml untouched.
function wrapSpoilers(escaped) {
  return escaped.replace(
    /\[spoiler\]([\s\S]*?)\[\/spoiler\]/gi,
    '<span class="ms-spoiler">$1</span>'
  );
}

// Pull the inner text of the FIRST <tag>...</tag> inside a chunk.
function tag(chunk, name) {
  const m = chunk.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i"));
  return m ? decodeEntities(m[1]) : "";
}

// Split a feed into <item>...</item> blocks.
function items(xml) {
  return [...xml.matchAll(/<item\b[\s\S]*?<\/item>/gi)].map((m) => m[0]);
}

function truncate(s, n) {
  if (!s) return "";
  return s.length > n ? s.slice(0, n - 1).trimEnd() + "\u2026" : s;
}

async function getText(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": "media-stream/1.0 (+github actions)" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

// ---- fetchers (each returns an array of normalized items, or throws) --------

// Normalized item shape:
//   { type, title, creator, rating, note, date, link }
//   date is a JS Date (used for sorting / display); rating is a number|null.

async function fetchBooks() {
  const xml = await getText(CONFIG.goodreadsRss);
  return items(xml).map((it) => {
    const title = tag(it, "title");
    const author = tag(it, "author_name");
    const r = parseInt(tag(it, "user_rating"), 10);
    const review = stripTagsKeepBreaks(tag(it, "user_review"));
    const desc = tag(it, "description");
    const coverMatch = desc.match(/<img[^>]+src="([^"]+)"/i);
    const image = coverMatch ? coverMatch[1] : null;
    const dateStr = tag(it, "user_read_at") || tag(it, "pubDate");
    return {
      type: "books",
      title,
      creator: author,
      rating: Number.isFinite(r) && r > 0 ? r : null,
      note: review || "",
      date: dateStr ? new Date(dateStr) : null,
      link: tag(it, "link"),
      image,
    };
  }).sort((a, b) => (b.date?.getTime() || 0) - (a.date?.getTime() || 0));
}

async function fetchReading() {
  const xml = await getText(CONFIG.goodreadsReadingRss);
  return items(xml).map((it) => {
    const title = tag(it, "title");
    const author = tag(it, "author_name");
    const desc = tag(it, "description");
    const coverMatch = desc.match(/<img[^>]+src="([^"]+)"/i);
    const image = coverMatch ? coverMatch[1] : null;
    const dateStr = tag(it, "pubDate");
    return {
      type: "reading",
      title,
      creator: author,
      rating: null,
      note: "",
      date: dateStr ? new Date(dateStr) : null,
      link: tag(it, "link"),
      image,
    };
  }).sort((a, b) => (b.date?.getTime() || 0) - (a.date?.getTime() || 0));
}

async function fetchFilm() {
  const xml = await getText(CONFIG.letterboxdRss);
  // Letterboxd mixes diary entries and lists in one feed. Diary entries carry
  // letterboxd:filmTitle / filmYear / memberRating. Lists don't, so we skip
  // anything without a film title.
  return items(xml)
    .map((it) => {
      const filmTitle = tag(it, "letterboxd:filmTitle");
      if (!filmTitle) return null; // it's a list, not a watched film
      const year = tag(it, "letterboxd:filmYear");
      const rRaw = tag(it, "letterboxd:memberRating");
      const r = rRaw ? parseFloat(rRaw) : null;
      const rewatch = tag(it, "letterboxd:rewatch") === "Yes";
      const rawDesc = tag(it, "description");
      const imgMatch = rawDesc.match(/<img[^>]+src="([^"]+)"/i);
      const image = imgMatch ? imgMatch[1] : null;
      let review = stripTagsKeepBreaks(rawDesc);
      // Strip Letterboxd's spoiler-flag prefix line (we don't want that verbiage).
      review = review.replace(/^This review may contain spoilers\.[ \t\r\n]*/i, "");
      // Convention: a paragraph starting with "Spoilers:" marks the spoiler
      // section. Keep the "Spoilers:" label visible; wrap everything after it in
      // [spoiler] tags so it blurs (revealable). Strict: marker must start a line.
      const sm = review.match(/(^|\n)(spoilers:)/i);
      if (sm) {
        const idx = sm.index + sm[1].length;
        const after = review.slice(idx + sm[2].length);
        if (after.trim()) {
          review = review.slice(0, idx) + sm[2] + "[spoiler]" + after + "[/spoiler]";
        }
      }
      // watchedDate is the diary date; fall back to pubDate.
      const dateStr = tag(it, "letterboxd:watchedDate") || tag(it, "pubDate");
      return {
        type: "film",
        title: year ? `${filmTitle} (${year})` : filmTitle,
        creator: rewatch ? "rewatch" : "",
        rating: Number.isFinite(r) ? r : null,
        // The description repeats the poster + "Watched on ..." text; only keep
        // it if there's an actual review beyond the boilerplate.
        note: /Watched on/i.test(review) ? "" : review,
        date: dateStr ? new Date(dateStr) : null,
        link: tag(it, "link"),
        image,
      };
    })
    .filter(Boolean);
}
async function tmdbPoster(tmdbId) {
  if (!CONFIG.tmdbToken || !tmdbId) return null;
  try {
    const res = await fetch(`https://api.themoviedb.org/3/tv/${tmdbId}`, {
      headers: {
        Authorization: `Bearer ${CONFIG.tmdbToken}`,
        Accept: "application/json",
      },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.poster_path
      ? `https://image.tmdb.org/t/p/w92${data.poster_path}`
      : null;
  } catch {
    return null;
  }
}

async function fetchTvComments() {
  if (!CONFIG.traktClientId) return {};
  const map = {};
  const headers = {
    "Content-Type": "application/json",
    "trakt-api-version": "2",
    "trakt-api-key": CONFIG.traktClientId,
    "User-Agent": "media-stream/1.0 (https://github.com/wellactuarially/website-feed)",
  };
  try {
    for (let page = 1; page <= 20; page++) {
      const res = await fetch(
        `https://api.trakt.tv/users/${CONFIG.traktUsername}/comments?limit=100&page=${page}`,
        { headers }
      );
      if (!res.ok) break;
      const rows = await res.json();
      if (!rows.length) break;
      for (const row of rows) {
        if (
          row.type === "episode" &&
          row.episode && row.episode.ids && row.episode.ids.trakt != null &&
          row.comment
        ) {
          map[row.episode.ids.trakt] = {
            text: row.comment.comment || "",
            wholeSpoiler: row.comment.spoiler === true,
          };
        }
      }
      if (rows.length < 100) break;
    }
  } catch { /* fall through with whatever we have */ }
  return map;
}

async function fetchTvRatings() {
  if (!CONFIG.traktClientId) return {};
  const map = {};
  const headers = {
    "Content-Type": "application/json",
    "trakt-api-version": "2",
    "trakt-api-key": CONFIG.traktClientId,
    "User-Agent": "media-stream/1.0 (https://github.com/wellactuarially/website-feed)",
  };
  try {
    for (let page = 1; page <= 20; page++) {
      const res = await fetch(
        `https://api.trakt.tv/users/${CONFIG.traktUsername}/ratings/episodes?limit=100&page=${page}`,
        { headers }
      );
      if (!res.ok) break;
      const rows = await res.json();
      if (!rows.length) break;
      for (const row of rows) {
        const id = row.episode && row.episode.ids && row.episode.ids.trakt;
        if (id != null && row.rating != null) {
          map[id] = row.rating / 2;   // Trakt 0–10 → 0–5 star scale
        }
      }
      if (rows.length < 100) break;
    }
  } catch { /* fall through */ }
  return map;
}

async function fetchTv() {
  if (!CONFIG.traktClientId) {
    throw new Error("TRAKT_CLIENT_ID not set");
  }
  const url =
    `https://api.trakt.tv/users/${CONFIG.traktUsername}/history/shows`
    + `?limit=${CONFIG.tvSection}`;
  const res = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      "trakt-api-version": "2",
      "trakt-api-key": CONFIG.traktClientId,
      "User-Agent": "media-stream/1.0 (https://github.com/wellactuarially/website-feed)",
    },
  });
  if (!res.ok) {
    const body = (await res.text()).slice(0, 300);
    throw new Error(`Trakt HTTP ${res.status} :: ${body}`);
  }
  const rows = await res.json();
  const commentsMap = await fetchTvComments();
  const ratingsMap = await fetchTvRatings();
  return Promise.all(rows.map(async (row) => {
    const show = row.show || {};
    const ep = row.episode || {};
    const showTitle = show.title || "Unknown show";
    let title = showTitle;
    if (ep && ep.season != null && ep.number != null) {
      const code = `S${String(ep.season).padStart(2, "0")}E${String(ep.number).padStart(2, "0")}`;
      title = `${showTitle} \u2014 ${code}`;
    }
    const slug = show.ids && show.ids.slug ? show.ids.slug : null;
    const image = await tmdbPoster(show.ids && show.ids.tmdb);
    const epId = ep.ids && ep.ids.trakt;
    const c = epId != null ? commentsMap[epId] : null;
    const note = c ? c.text : "";
    const rating = epId != null ? (ratingsMap[epId] ?? null) : null;
    return {
      type: "tv",
      title,
      creator: ep.title || "",
      rating,
      note,
      date: row.watched_at ? new Date(row.watched_at) : null,
      link: slug ? `https://trakt.tv/shows/${slug}` : PROFILE_LINKS.tv,
      image,
    };
  }));
}

// ---- rendering --------------------------------------------------------------

function fmtDate(d) {
  if (!d || isNaN(d)) return "";
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

function stars(n, outOf) {
  if (n == null) return "";
  // Books: 0-5 ints. Film: 0-5 in half steps. Render filled + half.
  const full = Math.floor(n);
  const half = n - full >= 0.5;
  return "\u2605".repeat(full) + (half ? "\u00bd" : "");
}

function escapeHtml(s) {
  return (s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderItem(it) {
  const rate = stars(it.rating);
  const meta = [it.creator, rate].filter(Boolean).join(" \u00b7 ");
  const date = fmtDate(it.date);
  let noteInner = wrapSpoilers(escapeHtml(it.note || ""));
  if (it.noteSpoiler && it.note) {
    noteInner = `<span class="ms-spoiler">${noteInner}</span>`;
  }
  const note = it.note ? `<div class="ms-note">${wrapSpoilers(escapeHtml(it.note))}</div>` : "";
  const cover = it.image
    ? `<img class="ms-cover" src="${escapeHtml(it.image)}" alt="" loading="lazy" />`
    : "";
  return `      <li class="ms-item">
        ${cover}
        <div class="ms-item-body">
          <a class="ms-title" href="${escapeHtml(it.link)}">${escapeHtml(it.title)}</a>
          ${meta ? `<span class="ms-meta">${escapeHtml(meta)}</span>` : ""}
          ${date ? `<span class="ms-date">${escapeHtml(date)}</span>` : ""}
          ${note}
        </div>
      </li>`;
}

function renderSection(label, profileUrl, list, error, tabId, limit = CONFIG.perSection) {
  let body;
  if (error) {
    body = `      <li class="ms-error">Couldn\u2019t load right now.</li>`;
  } else if (!list || list.length === 0) {
    body = `      <li class="ms-empty">Nothing recent.</li>`;
  } else {
    body = list.slice(0, limit).map(renderItem).join("\n");
  }
  const spoilerNote = (tabId === "film" || tabId === "tv")
    ? `    <p class="ms-spoiler-warn">Heads up: blurred text hides spoilers — tap to reveal at your own risk.</p>\n`
    : "";
  return `  <section class="ms-section" data-tab="${tabId}">
    <h2 class="ms-heading"><a href="${escapeHtml(profileUrl)}">${escapeHtml(label)}</a></h2>
${spoilerNote}    <ul class="ms-list">
${body}
    </ul>
  </section>`;
}

const STYLE = `<style>
.ms-stream{--ms-fg:inherit;--ms-dim:#e4e4e7;font-size:.95rem;line-height:1.4}
.ms-section{margin:0 0 2rem}
.ms-heading{font-size:1.1rem;margin:0 0 .5rem;border-bottom:1px solid currentColor;padding-bottom:.25rem}
.ms-heading a{text-decoration:none}
.ms-list{list-style:none;margin:0;padding:0}
.ms-item{margin:0 0 1rem;display:flex;gap:.6rem;align-items:flex-start}
.ms-cover{width:46px;height:auto;border-radius:3px;flex:0 0 auto}
.ms-item-body{flex:1;min-width:0}
.ms-title{font-weight:600;text-decoration:none}
.ms-title:hover{text-decoration:underline}
.ms-meta{margin-left:.5rem;color:var(--ms-dim)}
.ms-date{display:block;font-size:.8rem;color:var(--ms-dim)}
.ms-note{font-size:.85rem;color:var(--ms-dim);margin-top:.15rem;white-space:pre-wrap}
.ms-error,.ms-empty{color:var(--ms-dim);font-style:italic}
.ms-updated{font-size:.75rem;color:var(--ms-dim);margin-top:1rem}
.ms-tabs{display:flex;gap:.5rem;margin:0 0 1.5rem;border-bottom:1px solid currentColor;padding-top:.5rem}
.ms-tab{background:none;border:none;padding:.4rem .8rem;cursor:pointer;font:inherit;color:inherit;opacity:.55;border-bottom:2px solid transparent;margin-bottom:-1px}
.ms-tab.is-active{opacity:1;border-bottom-color:currentColor;font-weight:600}
.ms-section[data-tab]{display:none}
.ms-section.is-active{display:block}
.ms-spoiler{filter:blur(5px);cursor:pointer;border-radius:2px;transition:filter .15s;background:rgba(128,128,128,.15)}
.ms-spoiler.revealed{filter:none}
.ms-spoiler-warn{font-size:.78rem;color:var(--ms-dim);font-style:italic;margin:0 0 .6rem;opacity:.8}
</style>`;

async function safe(fn) {
  try {
    return { data: await fn(), error: null };
  } catch (e) {
    console.error(`  source failed: ${e.message}`);
    return { data: null, error: e };
  }
}

async function main() {
  console.log("Fetching sources...");
  const [books, reading, film, tv] = await Promise.all([
    safe(fetchBooks),
    safe(fetchReading),
    safe(fetchFilm),
    safe(fetchTv),
  ]);

  console.log(`  books: ${books.data ? books.data.length : "FAIL"}`);
  console.log(`  film:  ${film.data ? film.data.length : "FAIL"}`);
  console.log(`  tv:    ${tv.data ? tv.data.length : "FAIL"}`);

  const html = `${STYLE}
<div class="ms-stream">
  <div class="ms-tabs">
    <button class="ms-tab" data-target="books">Books</button>
    <button class="ms-tab" data-target="reading">Reading Now</button>
    <button class="ms-tab" data-target="film">Films</button>
    <button class="ms-tab" data-target="tv">Television</button>
  </div>
${renderSection("Read", PROFILE_LINKS.books, books.data, books.error, "books")}
${renderSection("Currently Reading", PROFILE_LINKS.reading, reading.data, reading.error, "reading")}
${renderSection("Films", PROFILE_LINKS.film, film.data, film.error, "film")}
${renderSection("TV", PROFILE_LINKS.tv, tv.data, tv.error, "tv", CONFIG.tvSection)}
  <div class="ms-updated">Updated ${new Date().toLocaleDateString("en-US", { timeZone: "America/Los_Angeles" })}</div>
</div>`;

  await writeFile("feed.html", html, "utf8");
  console.log("Wrote feed.html");
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
