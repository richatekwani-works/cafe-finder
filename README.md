# Beanline – Cafe Finder

Find cafes near you. No login. Free tools only.

- **Frontend:** `index.html` (HTML + Tailwind-free CSS + vanilla JS, Leaflet map)
- **Backend:** Vercel serverless functions in `api/`
  - `api/cafes.js` – nearby cafes from OpenStreetMap (Overpass), cached at Vercel's edge
  - `api/geocode.js` – area name to coordinates (Nominatim)
  - `api/rating.js` – star ratings (needs a free Upstash Redis, optional)
- **Your own photos and menus:** `data/extra.json` + `img/`

> Why not Laravel? Vercel doesn't run PHP/Laravel properly, and it has no permanent disk (so no SQLite/MySQL file). Serverless functions + Redis is the Vercel way.

## Folder structure
```
index.html
api/        cafes.js  geocode.js  rating.js
data/       extra.json
img/        drink-1..4.webp  (+ your cafe photos)
package.json  vercel.json  .gitignore
```

## Deploy (GitHub + Vercel)
1. Push this folder to a new GitHub repo.
2. On vercel.com: **Add New → Project → import the repo**. No build settings needed (Framework: Other). Deploy.
3. *(Optional, for shared ratings)* In the Vercel project open **Storage**, add **Upstash Redis** (free plan) and connect it to the project. Vercel adds the environment variables by itself. **Redeploy** once.
   - Without it, ratings still work but are saved only in each visitor's own browser.
4. *(Recommended)* In **Settings → Environment Variables** add `CONTACT_EMAIL` = your email. OpenStreetMap's servers ask apps to identify themselves.

Location (the "near me" button) only works on **https**, which Vercel gives you.

## Run on your laptop
```
npm i -g vercel
vercel dev
```
Open the address it prints. Opening `index.html` by double-click will **not** work, because the `/api` routes need `vercel dev`.

## Add photos and menus for a cafe
1. Open a cafe in the site and copy its **OSM id** (bottom of the About section), e.g. `node/1234567890`.
2. Put the photo in `img/` (e.g. `img/roast-cafe.jpg`).
3. Edit `data/extra.json`:
```json
{
  "node/1234567890": {
    "photos": ["img/roast-cafe.jpg"],
    "menu": [
      { "item": "Caramel Latte", "price": 150 },
      { "item": "Cold Coffee", "price": 120 }
    ]
  }
}
```
4. Commit and push. Vercel redeploys.

## Notes
- Cafe data comes from OpenStreetMap, so a cafe missing there won't show up. You can add it on openstreetmap.org.
- Ratings: one per cafe per IP per day. The IP is kept only inside a temporary Redis key that expires in 24 hours.
- Credit "© OpenStreetMap contributors" stays on the map (required).
- Check the license of the drink photos in `img/` before publishing the site publicly.
