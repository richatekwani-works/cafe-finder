// GET /api/geocode?q=Navrangpura
// Converts a user-submitted area name into coordinates using OpenStreetMap Nominatim.

const APP_URL = 'https://cafe-finder-murex.vercel.app';
const UA = process.env.CONTACT_EMAIL
  ? `BeanlineCafeFinder/1.0 (${APP_URL}; contact: ${process.env.CONTACT_EMAIL})`
  : `BeanlineCafeFinder/1.0 (${APP_URL})`;
const TIMEOUT_MS = 8000;

// Best-effort one-request-per-second spacing within a warm function instance.
// Vercel can run multiple instances, so this is not a substitute for a shared
// rate limiter if the app grows beyond a small, low-volume student project.
let lastRequestAt = 0;
async function waitForNominatimSlot() {
  const now = Date.now();
  const wait = Math.max(0, lastRequestAt + 1100 - now);
  lastRequestAt = now + wait;
  if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
}

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const q = String(req.query.q || '').trim().slice(0, 120);
  if (!q) return res.status(400).json({ error: 'Enter an area name' });

  let controller;
  let timer;

  try {
    await waitForNominatimSlot();
    controller = new AbortController();
    timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const params = new URLSearchParams({
      format: 'jsonv2',
      limit: '1',
      countrycodes: 'in',
      q,
    });
    const response = await fetch(
      `https://nominatim.openstreetmap.org/search?${params.toString()}`,
      {
        headers: {
          'User-Agent': UA,
          'Accept-Language': 'en',
        },
        signal: controller.signal,
      }
    );

    if (response.status === 429) {
      res.setHeader('Retry-After', '30');
      res.setHeader('Cache-Control', 'no-store');
      return res.status(503).json({ error: 'The area search service is busy. Try again shortly.' });
    }
    if (!response.ok) {
      console.error(`[Beanline] Nominatim returned HTTP ${response.status}`);
      res.setHeader('Cache-Control', 'no-store');
      return res.status(502).json({ error: 'Area search service is temporarily unavailable' });
    }

    const results = await response.json();
    if (!Array.isArray(results) || results.length === 0) {
      res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');
      return res.status(404).json({ error: 'Area not found' });
    }

    const lat = Number(results[0].lat);
    const lng = Number(results[0].lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      throw new Error('Geocoder returned invalid coordinates');
    }

    res.setHeader('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=604800');
    return res.status(200).json({ lat, lng });
  } catch (error) {
    const timedOut = error.name === 'AbortError';
    console.error(`[Beanline] Geocoding failed: ${timedOut ? 'timeout' : error.message}`);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(502).json({
      error: timedOut
        ? 'Area search timed out. Please try again.'
        : 'Could not search this area. Please try again.',
    });
  } finally {
    if (timer) clearTimeout(timer);
  }
};
