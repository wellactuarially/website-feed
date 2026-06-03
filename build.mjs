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
  letterboxdRss: process.env.LETTERBOXD_RSS
    || "https://letterboxd.com/wellactuarially/rss",
  traktClientId: process.env.TRAKT_CLIENT_ID || "",
  traktUsername: process.env.TRAKT_USERNAME || "wellactuarially",
  perSection: 10,
};

const PROFILE_LINKS = {
  books: "https://www.goodreads.com/review/list/173090020-marcus?shelf=read",
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
    const review = stripTags(tag(it, "user_review"));
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
  });
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
      const review = stripTags(rawDesc);
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

async function fetchTv() {
  if (!CONFIG.traktClientId) {
    throw new Error("TRAKT_CLIENT_ID not set");
  }
  const url =
    `https://api.trakt.tv/users/${CONFIG.traktUsername}/history/shows`
    + `?limit=${CONFIG.perSection}`;
  const res = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      "trakt-api-version": "2",
      "trakt-api-key": CONFIG.traktClientId,
      // Cloudflare (in front of Trakt) tends to block requests with no/odd
      // User-Agent from datacenter IPs. Identify ourselves like a normal client.
      "User-Agent": "media-stream/1.0 (https://github.com/wellactuarially/website-feed)",
    },
  });
  if (!res.ok) {
    const body = (await res.text()).slice(0, 300);
    throw new Error(`Trakt HTTP ${res.status} :: ${body}`);
  }
  const rows = await res.json();
  return rows.map((row) => {
    const show = row.show || {};
    const ep = row.episode || {};
    const showTitle = show.title || "Unknown show";
    let title = showTitle;
    if (ep && ep.season != null && ep.number != null) {
      const code = `S${String(ep.season).padStart(2, "0")}E${String(ep.number).padStart(2, "0")}`;
      title = `${showTitle} \u2014 ${code}`;
    }
    const slug = show.ids && show.ids.slug ? show.ids.slug : null;
    return {
      type: "tv",
      title,
      creator: ep.title || "",
      rating: null, // history rows don't carry your rating; kept for shape parity
      note: "",
      date: row.watched_at ? new Date(row.watched_at) : null,
      link: slug ? `https://trakt.tv/shows/${slug}` : PROFILE_LINKS.tv,
    };
  });
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
  const note = it.note ? `<div class="ms-note">${escapeHtml(it.note)}</div>` : "";
  return `      <li class="ms-item">
        <a class="ms-title" href="${escapeHtml(it.link)}">${escapeHtml(it.title)}</a>
        ${meta ? `<span class="ms-meta">${escapeHtml(meta)}</span>` : ""}
        ${date ? `<span class="ms-date">${escapeHtml(date)}</span>` : ""}
        ${note}
      </li>`;
}

function renderSection(label, profileUrl, list, error) {
  let body;
  if (error) {
    body = `      <li class="ms-error">Couldn\u2019t load right now.</li>`;
  } else if (!list || list.length === 0) {
    body = `      <li class="ms-empty">Nothing recent.</li>`;
  } else {
    body = list.slice(0, CONFIG.perSection).map(renderItem).join("\n");
  }
  return `  <section class="ms-section">
    <h2 class="ms-heading"><a href="${escapeHtml(profileUrl)}">${escapeHtml(label)}</a></h2>
    <ul class="ms-list">
${body}
    </ul>
  </section>`;
}

const STYLE = `<style>
.ms-stream{--ms-fg:inherit;--ms-dim:#888;font-size:.95rem;line-height:1.4}
.ms-section{margin:0 0 2rem}
.ms-heading{font-size:1.1rem;margin:0 0 .5rem;border-bottom:1px solid currentColor;padding-bottom:.25rem}
.ms-heading a{text-decoration:none}
.ms-list{list-style:none;margin:0;padding:0}
.ms-item{margin:0 0 .75rem}
.ms-title{font-weight:600;text-decoration:none}
.ms-title:hover{text-decoration:underline}
.ms-meta{margin-left:.5rem;color:var(--ms-dim)}
.ms-date{display:block;font-size:.8rem;color:var(--ms-dim)}
.ms-note{font-size:.85rem;color:var(--ms-dim);margin-top:.15rem}
.ms-error,.ms-empty{color:var(--ms-dim);font-style:italic}
.ms-updated{font-size:.75rem;color:var(--ms-dim);margin-top:1rem}
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
  const [books, film, tv] = await Promise.all([
    safe(fetchBooks),
    safe(fetchFilm),
    safe(fetchTv),
  ]);

  console.log(`  books: ${books.data ? books.data.length : "FAIL"}`);
  console.log(`  film:  ${film.data ? film.data.length : "FAIL"}`);
  console.log(`  tv:    ${tv.data ? tv.data.length : "FAIL"}`);

  const html = `${STYLE}
<div class="ms-stream">
${renderSection("Reading", PROFILE_LINKS.books, books.data, books.error)}
${renderSection("Watching \u2014 Film", PROFILE_LINKS.film, film.data, film.error)}
${renderSection("Watching \u2014 TV", PROFILE_LINKS.tv, tv.data, tv.error)}
  <div class="ms-updated">Updated ${new Date().toLocaleString("en-US", { timeZone: "America/Los_Angeles" })} PT</div>
</div>`;

  await writeFile("feed.html", html, "utf8");
  console.log("Wrote feed.html");
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
