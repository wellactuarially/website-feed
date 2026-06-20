# media-stream

A little widget that shows what I've been reading and watching. It pulls recent
**books** and **currently-reading** from Goodreads, **film** from Letterboxd, and
**TV** from Trakt, and renders the lot as a single HTML fragment. A GitHub Action
rebuilds it every night, GitHub Pages hosts the result, and a snippet on my
[Bear Blog](https://bearblog.dev) page loads it in. Once it's set up there's
nothing to maintain.

There are four tabs: **Books** (finished), **Reading Now**, **Films**, and
**Television**. Each section heading links out to the matching profile, and each
item can carry a cover, a rating, a review, and a date. If one source falls over
the rest of the page still loads.

---

## How it works

- `build.mjs` grabs each source, flattens them into one common shape, and writes
  `feed.html` (markup plus an inline `<style>`).
- Goodreads and Letterboxd come in as RSS, no key needed. Trakt uses its free API
  with just a Client ID — no OAuth, since the profile is public. TMDB fills in the
  TV posters that Trakt history doesn't include, using a free read token.
- Everything runs server-side in GitHub Actions, which sidesteps CORS and keeps
  the keys off the public page.
- The Action commits `feed.html`, Pages serves it, and the Bear loader fetches
  that URL when someone views the page. Commit, Pages republishes, the page
  updates. No babysitting.
- The tabs and the spoiler reveal are handled by JS in the Bear loader rather than
  inside `feed.html`. The loader injects the fragment with `innerHTML`, and
  scripts injected that way never run — so anything interactive has to live in the
  loader, which is a real `<script>` and does run.

### Data per source

| Source            | Read via         | Cover       | Rating             | Review                    |
|-------------------|------------------|-------------|--------------------|---------------------------|
| Goodreads (read)  | RSS              | from RSS    | user_rating (0–5)  | full review               |
| Goodreads (now)   | RSS              | from RSS    | —                  | —                         |
| Letterboxd        | RSS              | from RSS    | memberRating (0–5) | full review + spoiler tail|
| Trakt             | API (Client ID)  | via TMDB id | episode rating ÷ 2 | public episode comment    |

Trakt rates 0–10; it's halved to match the 0–5 star scale used by the others.

---

## One-time setup

### 1. Register a free Trakt API app

<https://trakt.tv/oauth/applications> → **New Application**.

- **Name:** anything (e.g. `feed`)
- **Redirect uri:** `urn:ietf:wg:oauth:2.0:oob` (required by the form; unused, but
  must be non-empty)
- **Javascript (CORS) origins:** leave blank
- **Permissions:** leave `/checkin` and `/scrobble` **unchecked** (read-only)

Save, copy the **Client ID** (ignore the Client Secret — that's only for OAuth).

The Trakt **profile must be public** for the key-only read to work
(Settings → Account → "Private" unchecked). History, comments, and ratings are
all read from the public profile.

### 2. Register a free TMDB read token (for TV posters)

<https://www.themoviedb.org> → account → **Settings → API** → request a key
(Developer; free, usually instant). Copy the **API Read Access Token** (the long
v4 bearer token, *not* the short v3 key).

### 3. Push these files to a public GitHub repo

The repo must be **public** for GitHub Pages to serve `feed.html` for free.

### 4. Add configuration

**Settings → Secrets and variables → Actions.**

Under **Variables**:

| Name                   | Value                                                                                |
|------------------------|--------------------------------------------------------------------------------------|
| `GOODREADS_RSS`        | `https://www.goodreads.com/review/list_rss/173090020-marcus?shelf=read`              |
| `GOODREADS_READING_RSS`| `https://www.goodreads.com/review/list_rss/173090020-marcus?shelf=currently-reading` |
| `LETTERBOXD_RSS`       | `https://letterboxd.com/wellactuarially/rss`                                         |
| `TRAKT_USERNAME`       | `wellactuarially`                                                                    |

Under **Secrets**:

| Name              | Value                          |
|-------------------|--------------------------------|
| `TRAKT_CLIENT_ID` | your Trakt app Client ID       |
| `TMDB_TOKEN`      | your TMDB API Read Access Token|

### 5. Run it once

**Actions** tab → **Build media stream** → **Run workflow**. It fetches all
sources and commits `feed.html`. (The workflow file must live at exactly
`.github/workflows/build.yml` on the default branch, or it won't appear in the
Actions tab.)

### 6. Enable GitHub Pages

**Settings → Pages** → Source: **Deploy from a branch** → Branch: `main`,
folder `/ (root)`. It auto-saves (no Save button). Wait for the first deploy
(watch the "pages build and deployment" run in Actions, or the Environments
section on the repo home). The feed will be live at:

```
https://<username>.github.io/<repo>/feed.html
```

Confirm it loads in a browser before wiring up Bear. (Status check, in
**Command Prompt** — real curl, not PowerShell's alias:
`curl -s -o NUL -w "%{http_code}\n" https://<username>.github.io/<repo>/feed.html`
— `200` means live, `404` means still deploying.)

### 7. Add the loader to a Bear page

Create a Bear page (e.g. titled "Lately") and paste this loader — **not** the
feed HTML itself. It fetches the published feed at view time, then wires up the
tabs and the spoiler reveal:

```html
<div id="media-stream-mount">Loading…</div>
<script>
(async () => {
  const mount = document.getElementById("media-stream-mount");
  const url = "https://<username>.github.io/<repo>/feed.html";
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    mount.innerHTML = await res.text();

    // --- tab switching ---
    const tabs = mount.querySelectorAll(".ms-tab");
    const sections = mount.querySelectorAll(".ms-section[data-tab]");
    function show(target) {
      tabs.forEach(t => t.classList.toggle("is-active", t.dataset.target === target));
      sections.forEach(s => s.classList.toggle("is-active", s.dataset.tab === target));
    }
    if (tabs.length) show(tabs[0].dataset.target);
    tabs.forEach(t => t.addEventListener("click", () => show(t.dataset.target)));

    // --- spoiler reveal: tap a blurred span to show it ---
    mount.addEventListener("click", function (e) {
      const sp = e.target.closest(".ms-spoiler");
      if (sp) sp.classList.toggle("revealed");
    });

  } catch (e) {
    mount.innerHTML = "<p style='color:#888;font-style:italic'>Couldn’t load the stream right now.</p>";
  }
})();
</script>
```

`feed.html` brings its own `<style>`, so it looks right on its own. After this
the whole thing runs itself: the Action rebuilds nightly, Pages republishes, the
Bear page picks up the change.

> The tabs aren't sticky; they scroll with the page. I tried a sticky version but
> it kept colliding with the site's own sticky header, so I gave up on it.

---

## Writing reviews & ratings

- **Books / film:** rate and review on Goodreads / Letterboxd as usual; they flow
  in via RSS.
- **TV reviews:** post a **public comment** on an episode on Trakt (free, no VIP).
  Comments carry both the review text *and* a `user_rating`, so they're the single
  source for TV review text. Matched to episodes by Trakt episode id.
- **TV ratings:** the star comes from `/ratings/episodes`. Rate the **episode**
  (not just the show). Ratings only appear for episodes in the recent-history
  window.

### Spoilers

How spoilers get hidden depends on the source, because each one exposes them
differently.

On **Trakt**, wrap the spoiler bit in `[spoiler]...[/spoiler]` inside the comment.
That part renders blurred and reveals on tap; the rest of the comment reads
normally.

On **Letterboxd** there are no inline tags, so I use a convention instead: start a
paragraph with `Spoilers:` (any capitalization, but it has to begin a line).
Everything from there to the end of the review gets blurred, while the `Spoilers:`
label itself stays put as a heads-up. The intro before it is always safe to read.
Letterboxd also prepends its own "This review may contain spoilers." line when you
flag a review; that line just gets stripped, so lean on the `Spoilers:` convention
rather than the flag.

**Goodreads** strips spoiler-tagged text out of the RSS before I ever see it
(you get a literal `[spoilers removed]` instead), so there's nothing to do on the
book side.

Both the Films and Television sections carry a small note under the heading
reminding readers that blurred text is a spoiler.

---

## Running locally (optional)

```bat
set GOODREADS_RSS=https://www.goodreads.com/review/list_rss/173090020-marcus?shelf=read
set GOODREADS_READING_RSS=https://www.goodreads.com/review/list_rss/173090020-marcus?shelf=currently-reading
set LETTERBOXD_RSS=https://letterboxd.com/wellactuarially/rss
set TRAKT_USERNAME=wellactuarially
set TRAKT_CLIENT_ID=your_client_id
set TMDB_TOKEN=your_tmdb_read_token
node build.mjs
:: open feed.html
```

(That's Command Prompt syntax; on macOS/Linux use `export` instead of `set`.)

---

## Customizing

- **Items per section:** `perSection` in `build.mjs` (books/film/reading); TV uses
  its own `tvSection` (currently 25), wired to the Trakt history `?limit=`.
- **Section labels / order:** the tab buttons in `main()` and the `renderSection(...)`
  calls. Tab order follows the button order; section visibility is driven by the
  loader's `show()`.
- **Schedule:** the `cron` line in `.github/workflows/build.yml`. Cron is **UTC**.
  Current: `0 9 * * *` ≈ 2 AM Pacific (drifts one hour with daylight saving —
  fine for a daily rebuild).
- **Styling:** the `STYLE` constant; colors inherit from the Bear theme.
  `--ms-dim` drives the secondary text colour (currently `#e4e4e7`). Cover size is
  `.ms-cover { width }`. Spoiler blur is `.ms-spoiler { filter: blur() }`.
- **Star scale:** TV ratings are halved (Trakt 0–10 → 0–5). Adjust in
  `fetchTvRatings`.

---

## How TV data is assembled

`fetchTv` hits Trakt a few times per build. Each call becomes a lookup keyed by
episode Trakt id, then everything gets stitched onto the history rows:

1. `/users/{user}/history/shows` — the recent episodes themselves.
2. `/users/{user}/comments` — public episode comments, used as review text (paginated).
3. `/users/{user}/ratings/episodes` — episode ratings, used for stars (paginated).
4. TMDB `/3/tv/{tmdb_id}` per show — the poster.

Comments and ratings page through 100 at a time so they keep working past 100
entries. Every Trakt request carries a `User-Agent` header. This matters more than
it looks: without it, the Cloudflare layer in front of Trakt blocks GitHub
Actions' datacenter IPs with a 403, even though the exact same request from a home
connection sails through. That one cost me an evening.

Comments flagged as whole spoilers still show up in full; the blurring is driven
entirely by the inline `[spoiler]` tags, so only the tagged portion is hidden.

---

## Notes / caveats

- **RSS windows:** Goodreads/Letterboxd RSS carry only recent items
  (Letterboxd ~50). Good for a recent-activity stream; not a full-library mirror.
- **Trakt free tier:** reading the *public* profile (history, public comments,
  episode ratings) works without VIP and without OAuth. Trakt's RSS/iCal feeds
  are the VIP-gated features this deliberately avoids. (Public **comments** have no
  per-account quantity cap; personal **notes** do — comments are used here.)
- **TMDB ids:** occasionally missing for obscure titles → that item just shows no
  cover (not an error).
- **Graceful failure:** if a source errors, its section shows a quiet "Couldn't
  load right now" and the rest of the page renders normally. TMDB/comments/ratings
  failures degrade silently (no cover / no review / no stars) rather than breaking
  the TV section.
- **GitHub Pages lag:** Pages republishes a minute or two after each commit; the
  very first deploy can take longer.

---

## Backlog

- Parallelize the Trakt comments + ratings calls (`Promise.all`), and maybe cache
  the lookup maps between runs if builds ever start to drag. (There's an issue
  open for this.)
