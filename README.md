# Beanline – Cafe Finder

A small cafe finder built with a static HTML/CSS/JavaScript frontend and Vercel serverless API routes. It uses OpenStreetMap data and does not require a login.

## Project structure

```text
index.html          Main website (vanilla JavaScript + Leaflet)
api/
  cafes.js          Nearby cafe search through Overpass API
  geocode.js        User-submitted area search through Nominatim
  rating.js         Optional shared ratings through Upstash Redis
data/
  extra.json        Your manually added cafe photos and menu items
img/                Image assets (if you add local cafe photos)
package.json
vercel.json
```

## Deploy to Vercel

1. Upload this complete folder to a GitHub repository.
2. In Vercel, choose **Add New → Project**, import the repository, and keep the project root pointed at this folder.
3. Use **Framework Preset: Other**. No build command or output directory is required; Vercel serves `index.html` and the `/api` functions.
4. In **Settings → Environment Variables**, add `CONTACT_EMAIL` with an email address you can be contacted at. The API uses an identifying User-Agent when contacting OpenStreetMap services.
5. Deploy (or redeploy after adding the environment variable).

The `near me` feature requires HTTPS and browser location permission. Vercel provides HTTPS on the deployed domain.

## Run locally

Install Node.js 18 or later, then run:

```bash
npm install --global vercel
vercel dev
```

Open the local URL printed by Vercel. Do not open `index.html` by double-clicking it: the `/api` routes only work through the local Vercel development server.

## Cafe data and reliability

- Cafe locations are queried from public Overpass API instances. The API tries more than one global instance, applies a short timeout to each request, and caches successful responses at Vercel's edge.
- Public Overpass servers are community services and can be busy. The app should cache and rate-limit requests; it should not be treated as a high-traffic production data service. See the [OpenStreetMap Overpass API server list and usage notes](https://wiki.openstreetmap.org/wiki/Overpass_API#Public_Overpass_API_instances).
- Area-name search uses the public Nominatim geocoder only after a person submits the search form. The function identifies the app, applies best-effort request spacing, and enables caching. Nominatim has a strict maximum of one request per second per application and does not allow autocomplete. For a larger public app, use a commercial geocoder or operate your own service. Read the [Nominatim Usage Policy](https://operations.osmfoundation.org/policies/nominatim/).
- If a public provider returns an error, the website now reports the API failure instead of issuing extra direct requests from the visitor's browser.
- Map tiles are provided by OpenStreetMap's standard tile service. Keep the visible map attribution.
- Data from OpenStreetMap is available under the Open Database License (ODbL); review its attribution/share-alike requirements before redistributing substantial extracts.

## Optional shared ratings

Ratings work in each visitor's own browser by default. To share ratings between visitors:

1. Create an Upstash Redis database.
2. Add its REST URL and token to the Vercel project as `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`.
3. Redeploy the project.

The older `KV_REST_API_URL` and `KV_REST_API_TOKEN` variable names are also accepted. The backend limits a cafe rating to one per IP per day. IP addresses are hashed before being used in the temporary Redis lock key.

## Add photos and menus for a cafe

1. Open a cafe on the website and copy its OSM ID from the **About** section, for example `node/1234567890`.
2. Add the image under `img/`, for example `img/roast-cafe.jpg`.
3. Edit `data/extra.json` using the OSM ID as the key:

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

4. Commit and push your changes. Vercel will redeploy the website.

The `Has photos` filter only includes cafes with photos you have added to `data/extra.json`; OpenStreetMap does not provide a general cafe-photo collection.

## Troubleshooting

- **“Couldn’t load cafes”**: open Vercel → your project → **Logs**, then inspect the `/api/cafes` invocation. The log lists which Overpass instance failed and why. HTTP 429/406 responses are intentionally not retried immediately; wait before trying again.
- **Area cannot be found**: try a more specific area name with the city, such as `Navrangpura, Ahmedabad`.
- **Location does not work**: use the deployed HTTPS site and allow location in the browser, or search for an area manually.
- **Shared ratings are missing**: add the Upstash environment variables above. Local-only ratings do not need Redis.

## Credits and image licensing

- Map data © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright).
- Check the license or permission for every photo you add before publishing the website.
