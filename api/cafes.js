// GET /api/cafes?lat=23.03&lng=72.58&r=2000
// Returns { cafes, source, tried }. Cafe data is queried from public Overpass instances.

const MIRRORS = [
  'https://overpass.private.coffee/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass-api.de/api/interpreter',
];

const APP_URL = 'https://cafe-finder-murex.vercel.app';
const UA = process.env.CONTACT_EMAIL
  ? `BeanlineCafeFinder/1.0 (${APP_URL}; contact: ${process.env.CONTACT_EMAIL})`
  : `BeanlineCafeFinder/1.0 (${APP_URL})`;
const REQUEST_TIMEOUT_MS = 8000;

function sendError(res, status, error, tried = []) {
  res.setHeader('Cache-Control', 'no-store');
  return res.status(status).json({ error, tried });
}

function parseCoordinate(value, min, max) {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max
    ? number
    : null;
}

function cafeFromElement(element) {
  const tags = element.tags || {};
  const lat = Number(element.lat ?? element.center?.lat);
  const lng = Number(element.lon ?? element.center?.lon);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  return {
    id: `${element.type}/${element.id}`,
    name: tags.name || 'Unnamed cafe',
    lat,
    lng,
    hours: tags.opening_hours || '',
    web: tags.website || tags['contact:website'] || '',
    phone: tags.phone || tags['contact:phone'] || '',
    addr: [
      tags['addr:housenumber'],
      tags['addr:street'],
      tags['addr:suburb'],
      tags['addr:city'] || tags['addr:town'],
    ].filter(Boolean).join(', '),
    wifi: tags.internet_access === 'wlan' || tags.internet_access === 'yes',
    outdoor: tags.outdoor_seating === 'yes',
  };
}

async function queryMirror(url, query) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        Accept: 'application/json',
        'User-Agent': UA,
      },
      body: `data=${encodeURIComponent(query)}`,
      signal: controller.signal,
    });

    if (!response.ok) {
      const error = new Error(`HTTP ${response.status}`);
      error.status = response.status;
      throw error;
    }

    const data = await response.json();
    if (!data || !Array.isArray(data.elements)) {
      throw new Error('Invalid JSON response from Overpass');
    }

    return data.elements.map(cafeFromElement).filter(Boolean);
  } finally {
    // Keep the timer active until the response body has also been read.
    clearTimeout(timer);
  }
}

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return sendError(res, 405, 'Method not allowed');
  }

  const lat = parseCoordinate(req.query.lat, -90, 90);
  const lng = parseCoordinate(req.query.lng, -180, 180);

  if (lat === null || lng === null) {
    return sendError(res, 400, 'Valid lat and lng coordinates are required');
  }

  let radius = 2000;
  if (req.query.r !== undefined) {
    const requestedRadius = Number(req.query.r);
    if (!Number.isInteger(requestedRadius)) {
      return sendError(res, 400, 'Radius must be a whole number');
    }
    radius = requestedRadius;
  }
  radius = Math.min(Math.max(radius, 300), 5000);

  // A little rounding improves cache reuse without moving the search centre too far.
  const searchLat = Number(lat.toFixed(4));
  const searchLng = Number(lng.toFixed(4));
  const query = `[out:json][timeout:15];
    (
      node["amenity"="cafe"](around:${radius},${searchLat},${searchLng});
      way["amenity"="cafe"](around:${radius},${searchLat},${searchLng});
    );
    out center tags;`;

  const tried = [];

  for (const endpoint of MIRRORS) {
    try {
      const cafes = await queryMirror(endpoint, query);
      res.setHeader(
        'Cache-Control',
        'public, s-maxage=600, stale-while-revalidate=1800'
      );
      return res.status(200).json({
        cafes,
        source: new URL(endpoint).host,
        tried,
      });
    } catch (error) {
      const host = new URL(endpoint).host;
      const reason = error.name === 'AbortError'
        ? 'timeout'
        : error.message || 'request failed';
      tried.push(`${host} -> ${reason}`);
      console.error(`[Beanline] Overpass ${host}: ${reason}`);

      // The Overpass community asks clients receiving 429/406 to pause before
      // sending another request. Do not immediately retry another public server.
      if (error.status === 429 || error.status === 406) {
        res.setHeader('Retry-After', '30');
        return sendError(res, 503, 'Cafe data provider asked us to slow down. Try again in 30 seconds.', tried);
      }
    }
  }

  return sendError(res, 502, 'Cafe data providers did not respond. Please try again.', tried);
};
