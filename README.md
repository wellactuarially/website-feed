# media-stream

Builds a static HTML fragment of your recent **books** (Goodreads), **film**
(Letterboxd), and **TV** (Trakt) activity, which you paste into a
[Bear Blog](https://bearblog.dev) page. A GitHub Action rebuilds it daily, so
the page stays current with no server and no live dependencies.

Three sections, 10 most recent items each, each section header links to your
profile on that service. If any one source is down, the other two still render.

---

## How it works

- `build.mjs` fetches all three sources, normalizes them into one shape, and
  writes `feed.html`.
- Goodreads and Letterboxd are read as RSS. Trakt is read via its free API
  (your **Client ID** only — no OAuth, because your profile is public).
- The script runs **inside GitHub Actions**, server-side, so there is no CORS
  problem and your Trakt key is never exposed on the public page.
- The Action commits `feed.html` back to the repo. You copy its contents into a
  Bear page (or set up auto-push later).

---

## One-time setup

### 1. Register a free Trakt API app

Go to <https://trakt.tv/oauth/applications> → **New Application**.

- **Name:** anything (e.g. `feed`)
- **Redirect uri:** `urn:ietf:wg:oauth:2.0:oob`
  (required by the form; you won't use it, but it must be non-empty)
- **Javascript (CORS) origins:** leave blank
- **Permissions:** leave `/checkin` and `/scrobble` **unchecked**
  (you're only reading, not writing)

Save, then copy the **Client ID** from the app page. (Ignore the Client Secret —
that's only for OAuth, which you're not using.)

Your Trakt profile must be **public** for the key-only read to work:
Settings → Privacy → make sure your profile/history is public.

### 2. Create the GitHub repo

Push these files to a new repo (public or private — both work; private keeps
everything maximally tucked away).

### 3. Add the configuration

In the repo: **Settings → Secrets and variables → Actions**.

Under **Variables** (the "Variables" tab — these aren't sensitive), add:

| Name             | Value                                                                 |
|------------------|-----------------------------------------------------------------------|
| `GOODREADS_RSS`  | `https://www.goodreads.com/review/list_rss/173090020-marcus?shelf=read` |
| `LETTERBOXD_RSS` | `https://letterboxd.com/wellactuarially/rss`                          |
| `TRAKT_USERNAME` | `wellactuarially`                                                     |

Under **Secrets**, add:

| Name              | Value                          |
|-------------------|--------------------------------|
| `TRAKT_CLIENT_ID` | your Trakt app Client ID       |

(The Client ID isn't strictly a high-value secret, but storing it as a secret
rather than a variable is good hygiene and keeps it out of logs.)

### 4. Run it once

**Actions** tab → **Build media stream** → **Run workflow**. After it finishes,
`feed.html` will appear/update in the repo. Open it and copy the entire contents.

### 5. Paste into Bear

Create or edit a Bear page and paste the `feed.html` contents directly into the
body. Bear renders raw HTML, so the `<style>` block and markup come through.
(If you'd rather keep styling in Bear's site-wide CSS, you can delete the
`<style>` block from the paste and move those rules into your Bear theme CSS —
the class names all start with `ms-`.)

From then on, the Action refreshes `feed.html` daily. You re-paste when you want
the page updated — or see "Auto-updating Bear" below.

---

## Running locally (optional)

```bash
export GOODREADS_RSS="https://www.goodreads.com/review/list_rss/173090020-marcus?shelf=read"
export LETTERBOXD_RSS="https://letterboxd.com/wellactuarially/rss"
export TRAKT_USERNAME="wellactuarially"
export TRAKT_CLIENT_ID="your_client_id"
node build.mjs
# open feed.html
```

`node test-local.mjs` runs the parser/renderer against mock fixtures with no
network — useful if you tweak the rendering.

---

## Customizing

- **Items per section:** change `perSection` in `build.mjs` (also adjust the
  Trakt `?limit=` — it's wired to the same value).
- **Section labels / order:** edit the three `renderSection(...)` calls in
  `main()`.
- **Schedule:** edit the `cron` line in `.github/workflows/build.yml`.
  Current: `0 13 * * *` = 6 AM Pacific.
- **Styling:** all in the `STYLE` constant; colors inherit from your Bear theme
  by default (`--ms-dim` controls the muted gray).
- **Posters:** intentionally omitted to avoid a second API key (Trakt history
  has no images; posters need TMDB). Ask if you want to add TMDB later.

---

## Auto-updating Bear (later, optional)

This setup uses copy-paste, which always works. If you want the page to update
without you re-pasting, Bear's paid tier may expose options worth exploring
(custom domain + an `<iframe>`/`fetch` pointing at the committed `feed.html`
raw URL, or Bear's API if available on your plan). Start with paste; automate
once it's proven useful.

---

## Notes / caveats

- **RSS windows:** Goodreads and Letterboxd RSS only carry recent items
  (Letterboxd ~50). Fine for a "recent activity" stream; not a full-library
  mirror.
- **Trakt free tier:** reading your own public history works without VIP. The
  VIP paywall covers RSS/iCal feeds and write/scrobble features — none of which
  this uses.
- **Graceful failure:** if a source errors, its section shows a quiet
  "Couldn't load right now" and the rest of the page renders normally.
