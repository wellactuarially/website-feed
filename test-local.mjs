// test-local.mjs — exercises the parse + render logic with mock data,
// no network needed. Imports nothing from build.mjs; instead it monkeypatches
// global.fetch so build.mjs runs end-to-end against fixtures.

import { readFile } from "node:fs/promises";

const GOODREADS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>Marcus's read shelf</title>
<item>
  <title>Gödel, Escher, Bach: An Eternal Golden Braid</title>
  <author_name>Douglas R. Hofstadter</author_name>
  <user_rating>5</user_rating>
  <user_read_at>Mon, 12 May 2026 00:00:00 +0000</user_read_at>
  <user_review><![CDATA[A <b>strange loop</b> of a book. Loved it.]]></user_review>
  <link>https://www.goodreads.com/review/show/111</link>
  <pubDate>Mon, 12 May 2026 08:00:00 +0000</pubDate>
</item>
<item>
  <title>Probability Theory: The Logic of Science</title>
  <author_name>E.T. Jaynes</author_name>
  <user_rating>4</user_rating>
  <user_read_at>Wed, 02 Apr 2026 00:00:00 +0000</user_read_at>
  <user_review></user_review>
  <link>https://www.goodreads.com/review/show/112</link>
  <pubDate>Wed, 02 Apr 2026 08:00:00 +0000</pubDate>
</item>
</channel></rss>`;

const LETTERBOXD = `<?xml version="1.0" encoding="UTF-8"?>
<rss xmlns:letterboxd="https://letterboxd.com" xmlns:tmdb="https://themoviedb.org">
<channel><title>wellactuarially's films</title>
<item>
  <title>Frankenstein, 2025 - ★★★½</title>
  <letterboxd:filmTitle>Frankenstein</letterboxd:filmTitle>
  <letterboxd:filmYear>2025</letterboxd:filmYear>
  <letterboxd:memberRating>3.5</letterboxd:memberRating>
  <letterboxd:rewatch>No</letterboxd:rewatch>
  <letterboxd:watchedDate>2026-05-20</letterboxd:watchedDate>
  <description><![CDATA[<p><img src="https://a.ltrbxd.com/poster.jpg"/></p><p>Visually stunning, narratively uneven.</p>]]></description>
  <link>https://letterboxd.com/wellactuarially/film/frankenstein-2025/</link>
  <pubDate>Tue, 20 May 2026 12:00:00 +0000</pubDate>
</item>
<item>
  <title>The Mastermind, 2025 - ★★</title>
  <letterboxd:filmTitle>The Mastermind</letterboxd:filmTitle>
  <letterboxd:filmYear>2025</letterboxd:filmYear>
  <letterboxd:memberRating>2.0</letterboxd:memberRating>
  <letterboxd:rewatch>No</letterboxd:rewatch>
  <letterboxd:watchedDate>2026-05-18</letterboxd:watchedDate>
  <description><![CDATA[<p><img src="https://a.ltrbxd.com/p2.jpg"/></p><p>Watched on Sunday May 18, 2026.</p>]]></description>
  <link>https://letterboxd.com/wellactuarially/film/the-mastermind/</link>
  <pubDate>Sun, 18 May 2026 12:00:00 +0000</pubDate>
</item>
<item>
  <title>My favourite films of 2025</title>
  <description><![CDATA[A list with no film title element.]]></description>
  <link>https://letterboxd.com/wellactuarially/list/fav-2025/</link>
  <pubDate>Sat, 01 Feb 2026 12:00:00 +0000</pubDate>
</item>
</channel></rss>`;

const TRAKT = JSON.stringify([
  {
    id: 1, watched_at: "2026-05-22T03:10:00.000Z", action: "watch", type: "episode",
    episode: { season: 2, number: 4, title: "The Substitute", ids: { trakt: 1 } },
    show: { title: "Severance", year: 2022, ids: { slug: "severance" } },
  },
  {
    id: 2, watched_at: "2026-05-21T02:00:00.000Z", action: "watch", type: "episode",
    episode: { season: 1, number: 8, title: "Strange Case", ids: { trakt: 2 } },
    show: { title: "The Penguin", year: 2024, ids: { slug: "the-penguin" } },
  },
]);

global.fetch = async (url, opts) => {
  const u = String(url);
  if (u.includes("goodreads.com")) {
    return { ok: true, status: 200, text: async () => GOODREADS };
  }
  if (u.includes("letterboxd.com")) {
    return { ok: true, status: 200, text: async () => LETTERBOXD };
  }
  if (u.includes("api.trakt.tv")) {
    // sanity-check the headers we send
    const h = opts && opts.headers ? opts.headers : {};
    if (h["trakt-api-key"] !== "TESTKEY") throw new Error("missing/wrong trakt-api-key header");
    if (h["trakt-api-version"] !== "2") throw new Error("missing trakt-api-version header");
    return { ok: true, status: 200, json: async () => JSON.parse(TRAKT) };
  }
  throw new Error("unexpected url " + u);
};

process.env.TRAKT_CLIENT_ID = "TESTKEY";
process.env.TRAKT_USERNAME = "wellactuarially";

await import("./build.mjs");

// build.mjs's main() is async; poll briefly for the output file.
async function waitForFile(path, ms = 5000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try { return await readFile(path, "utf8"); } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("feed.html never appeared");
}

const out = await waitForFile("./feed.html");
console.log("\n===== FEED.HTML =====\n");
console.log(out);

// crude assertions
const checks = [
  ["books title present", out.includes("Gödel, Escher, Bach")],
  ["book stars rendered", out.includes("★★★★★")],
  ["book review kept", out.includes("strange loop")],
  ["film year folded in", out.includes("Frankenstein (2025)")],
  ["film half star", out.includes("★★★½")],
  ["film boilerplate review suppressed", !out.includes("Watched on Sunday")],
  ["letterboxd list excluded", !out.includes("My favourite films of 2025")],
  ["tv episode code", out.includes("Severance — S02E04")],
  ["tv episode title", out.includes("The Substitute")],
  ["tv deep link", out.includes("https://trakt.tv/shows/severance")],
  ["updated stamp", out.includes("Updated")],
];
console.log("\n===== CHECKS =====");
let pass = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (ok) pass++;
}
console.log(`\n${pass}/${checks.length} passed`);
process.exit(pass === checks.length ? 0 : 1);
