# media-stream

Builds a static HTML fragment of your recent **books** (Goodreads), **film**
(Letterboxd), and **TV** (Trakt) activity. A GitHub Action rebuilds it daily and
publishes it via GitHub Pages; a small loader on your [Bear Blog](https://bearblog.dev)
page pulls it in, so the page stays current on its own — no server, no manual
re-pasting.

Three sections, 10 most recent items each, each
section header links to your profile on that service. Every item can show a
cover/poster, a rating, and your review. If any one source is down, the other
two still render.

---

## How it works

- `build.mjs` fetches all three sources, normalizes them into one shape, and
  writes `feed.html` (an HTML fragment with its own inline `<style>`).
- **Goodreads** and **Letterboxd** are read as RSS (no key). **Trakt** is read
  via its free API with your **Client ID** only — no OAuth, which requires the profile
  is public. **TMDB** supplies TV posters (Trakt has none) via a free read token.
- The script runs **inside GitHub Actions**, server-side.
- The Action commits `feed.html` to the repo. **GitHub Pages** serves it at a
  public URL, and a tiny loader on a Bear page fetches that URL at view time.
  Commit → Pages republishes → Bear page reflects it. Hands-off after setup.

### Data per source

| Source     | Read via            | Cover        | Rating              | Review            |
|------------|---------------------|--------------|---------------------|-------------------|
| Goodreads  | RSS                 | from RSS     | user_rating (0–5)   | full review       |
| Letterboxd | RSS                 | from RSS     | memberRating (0–5)  | full review       |
| Trakt      | API (Client ID)     | via TMDB id  | episode rating ÷ 2  | public note text  |

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

Your Trakt **profile must be public** for the key-only read to work
(Settings → Account → make sure "Private" is unchecked). History, notes, and
ratings are all read from your public profile.

### 2. Register a free TMDB read token (for TV posters)

<https://www.themoviedb.org> → account → **Settings → API** → request a key
(Developer; free, usually instant). Copy the **API Read Access Token** (the long
v4 bearer token, *not* the short v3 key).

### 3. Push these files to a public GitHub repo

The repo must be **public** for GitHub Pages to serve `feed.html` for free.

### 4. Add configuration

**Settings → Secrets and variables → Actions.**

Under **Variables**:

| Name             | Value                                                                   |
|------------------|-------------------------------------------------------------------------|
| `GOODREADS_RSS`  | `https://www.goodreads.com/review/list_rss/173090020-marcus?shelf=read` |
| `LETTERBOXD_RSS` | `https://letterboxd.com/wellactuarially/rss`                            |
| `TRAKT_USERNAME` | `wellactuarially`                                                       |

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
section on the repo home). Your feed will be live at:

```
https://<username>.github.io/<repo>/feed.html
```

Confirm it loads in a browser before wiring up Bear. (curl check:
`curl -s -o /dev/null -w "%{http_code}\n" https://<username>.github.io/<repo>/feed.html`
— `200` means live, `404` means still deploying.)

### 7. Add the loader to a Bear page

Create a Bear page (e.g. titled "Lately") and paste this — **not** the feed HTML
itself, just this loader, which fetches the published feed at view time:

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
  } catch (e) {
    mount.innerHTML = "<p style='color:#888;font-style:italic'>Couldn’t load the stream right now.</p>";
  }
})();
</script>
```

`feed.html` carries its own `<style>`, so it self-styles. From here it's
automatic: the Action rebuilds daily, Pages republishes, the Bear page shows the
latest with no action from you.

---

## Writing reviews & ratings

- **Books / film:** rate and review on Goodreads / Letterboxd as usual; they flow
  in via RSS.
- **TV reviews:** add a **public note** to an episode on Trakt (notes can be
  marked public without VIP). Only `privacy: "public"` notes are surfaced; private
  notes stay private. Notes are matched to episodes by Trakt episode id.
- **TV ratings:** rate the **episode** on Trakt (not just the show — the feed
  reads `/ratings/episodes`). Ratings only appear for episodes currently in the
  recent-history window.

---

## Running locally (optional)

```bash
export GOODREADS_RSS="https://www.goodreads.com/review/list_rss/173090020-marcus?shelf=read"
export LETTERBOXD_RSS="https://letterboxd.com/wellactuarially/rss"
export TRAKT_USERNAME="wellactuarially"
export TRAKT_CLIENT_ID="your_client_id"
export TMDB_TOKEN="your_tmdb_read_token"
node build.mjs
# open feed.html
```

`node test-local.mjs` runs the parser/renderer against mock fixtures with no
network — useful when tweaking rendering.

---

## Customizing

- **Items per section:** `perSection` in `build.mjs` (the Trakt history `?limit=`
  is wired to it).
- **Section labels / order:** the `renderSection(...)` calls in `main()`.
- **Schedule:** the `cron` line in `.github/workflows/build.yml`. Cron is **UTC**.
  Current: `0 9 * * *` ≈ 2 AM Pacific (drifts one hour with daylight saving —
  fine for a daily rebuild).
- **Styling:** the `STYLE` constant; colors inherit from your Bear theme
  (`--ms-dim` is the muted gray). Cover size is `.ms-cover { width }`.
- **Star scale:** TV ratings are halved (Trakt 0–10 → 0–5). Adjust in
  `fetchTvRatings`.

---

## How TV data is assembled

`fetchTv` makes a few Trakt calls per build, each into a lookup keyed by episode
Trakt id, then merged onto the history rows:

1. `/users/{user}/history/shows` — the recent episodes themselves.
2. `/users/{user}/notes` — public episode notes → review text (paginated).
3. `/users/{user}/ratings/episodes` — episode ratings → stars (paginated).
4. TMDB `/3/tv/{tmdb_id}` per show — poster image.

Notes and ratings paginate (100/page) so they scale past 100 entries. All Trakt
requests send a `User-Agent` header — without it, Cloudflare (in front of Trakt)
blocks requests from GitHub Actions' datacenter IPs with a 403.

---

## Notes / caveats

- **RSS windows:** Goodreads/Letterboxd RSS carry only recent items
  (Letterboxd ~50). Good for a recent-activity stream; not a full-library mirror.
- **Trakt free tier:** reading your own *public* profile (history, public notes,
  episode ratings) works without VIP and without OAuth. Trakt's RSS/iCal feeds
  and *private* notes are the VIP/OAuth-gated features this deliberately avoids.
- **TMDB ids:** occasionally missing for obscure titles → that item just shows no
  cover (not an error).
- **Graceful failure:** if a source errors, its section shows a quiet "Couldn't
  load right now" and the rest of the page renders normally. TMDB/notes/ratings
  failures degrade silently (no cover / no review / no stars) rather than breaking
  the TV section.
- **GitHub Pages lag:** Pages republishes a minute or two after each commit; the
  very first deploy can take longer.
