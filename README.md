# Mind4Metal Radio — no-build site

This folder contains a single-file website (`index.html`) that you can host on GitHub Pages (or anywhere). It plays your Icecast stream, shows “Now Playing,” builds a 10-item history, and has a request form (Formspree-ready).

## GitHub Pages deploy
1. Create a **public** repo (e.g., `mind4metal-site`).
2. Upload `index.html` to the root of the repo.
3. Repo **Settings → Pages** → Source: **Deploy from a branch**, Branch: **main / root**.
4. After it publishes, add a **Custom domain**: `www.mind4metal.com`.
5. In your DNS, add a **CNAME**: `www` → `<your-username>.github.io`.
6. Wait for HTTPS to provision.

> If you also want `mind4metal.com` (apex), set a registrar/Cloudflare redirect to `https://www.mind4metal.com/`.

## Important: CORS header on radio subdomain
Your page fetches JSON from `https://radio.mind4metal.com/status-json.xsl`. In Cloudflare (for **radio.mind4metal.com**):
- **Rules → Transform Rules → Modify Response Header**
- Match path: `/status-json.xsl`
- Add header: `Access-Control-Allow-Origin` = `*`

## Edit settings
Open `index.html` and edit the config near the bottom:
```js
const BACKGROUND_URL = "https://radio.mind4metal.com/assets/m4m-bg.jpg";
const STREAM_URL     = "https://radio.mind4metal.com/stream.mp3";
const ICECAST_STATUS_URL = "https://radio.mind4metal.com/status-json.xsl";
const REQUEST_POST_URL   = "https://formspree.io/f/mind4metal";
```
