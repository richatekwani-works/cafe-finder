
// GET /api/reverse-geocode?lat=23.03&lng=72.58
// Returns a nearby mapped address (not necessarily the exact cafe address).

const NOMINATIM = 'https://nominatim.openstreetmap.org/reverse';
const APP_URL = 'https://cafe-finder-murex.vercel.app';

const EMAIL = String(process.env.CONTACT_EMAIL || '').trim();
const USER_AGENT = `BeanlineCafeFinder/1.0 (+${APP_URL}${EMAIL ? `; ${EMAIL}` : ''})`;

const TIMEOUT = 8000;
const RATE_INTERVAL = 1200;
const CACHE_TTL = 30 * 24 * 60 * 60;
const PREFIX = 'beanline:reverse-geocode:';

const REDIS_URL = String(
  process.env.UPSTASH_REDIS_REST_URL ||
  process.env.KV_REST_API_URL || ''
).replace(/\/+$/, '');

const REDIS_TOKEN = String(
  process.env.UPSTASH_REDIS_REST_TOKEN ||
  process.env.KV_REST_API_TOKEN || ''
);

const HAS_REDIS = Boolean(REDIS_URL && REDIS_TOKEN);

const STATE = globalThis.__beanlineReverseGeo ||
  (globalThis.__beanlineReverseGeo = { lastRequestAt: 0 });

function send(res, status, data, cache = 0) {
  res.setHeader(
    'Cache-Control',
    cache
      ? `public, s-maxage=${cache}, stale-while-revalidate=86400`
      : 'no-store'
  );

  return res.status(status).json(data);
}

function getCoordinate(value, min, max) {
  if (value === undefined || value === null || value === '') return null;

  const n = Number(value);

  return Number.isFinite(n) && n >= min && n <= max
    ? Number(n.toFixed(5))
    : null;
}

function formatAddress(a = {}) {
  const street = [a.house_number, a.road]
    .filter(Boolean)
    .join(' ');

  const locality =
    a.neighbourhood ||
    a.quarter ||
    a.suburb ||
    a.residential ||
    a.village ||
    '';

  const city =
    a.city ||
    a.town ||
    a.municipality ||
    a.county ||
    '';

  return [...new Set([
    street,
    locality,
    city,
    a.state,
    a.postcode
  ].map(v => String(v || '').trim()).filter(Boolean))].join(', ');
}

async function redis(command) {
  const response = await fetch(`${REDIS_URL}/pipeline`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${REDIS_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify([command])
  });

  if (!response.ok) throw new Error('Redis request failed');

  const data = await response.json();

  if (!data[0] || data[0].error) {
    throw new Error('Redis command failed');
  }

  return data[0].result;
}

async function getCached(key) {
  if (!HAS_REDIS) return null;

  const value = await redis(['GET', key]);

  return value ? JSON.parse(value) : null;
}

async function saveCache(key, value, ttl = CACHE_TTL) {
  if (!HAS_REDIS) return;

  await redis([
    'SET',
    key,
    JSON.stringify(value),
    'EX',
    String(ttl)
  ]);
}

async function allowRequest() {
  if (HAS_REDIS) {
    const result = await redis([
      'SET',
      `${PREFIX}rate-limit`,
      '1',
      'NX',
      'PX',
      String(RATE_INTERVAL)
    ]);

    return result === 'OK';
  }

  // Per-instance fallback for a small demo.
  const now = Date.now();

  if (now - STATE.lastRequestAt < RATE_INTERVAL) {
    return false;
  }

  STATE.lastRequestAt = now;

  return true;
}

module.exports = async (req, res) => {

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return send(res, 405, { error: 'Method not allowed' });
  }

  const lat = getCoordinate(req.query.lat, -90, 90);
  const lng = getCoordinate(req.query.lng, -180, 180);

  if (lat === null || lng === null) {
    return send(res, 400, {
      error: 'Valid latitude and longitude are required'
    });
  }

  const key = `${PREFIX}${lat},${lng}`;

  // Check cache first.
  try {
    const cached = await getCached(key);

    if (cached) {
      return send(res, 200, cached, CACHE_TTL);
    }
  } catch (error) {
    console.error('Address cache error:', error.message);

    return send(res, 503, {
      error: 'Address service temporarily unavailable'
    });
  }

  // Respect Nominatim's request limit.
  try {
    if (!(await allowRequest())) {
      res.setHeader('Retry-After', '2');

      return send(res, 429, {
        error: 'Please wait before requesting another address'
      });
    }
  } catch (error) {
    console.error('Rate limit error:', error.message);

    return send(res, 503, {
      error: 'Address service temporarily unavailable'
    });
  }

  const url = new URL(NOMINATIM);

  url.search = new URLSearchParams({
    format: 'jsonv2',
    lat: String(lat),
    lon: String(lng),
    addressdetails: '1',
    zoom: '18',
    'accept-language': 'en'
  }).toString();

  const controller = new AbortController();

  const timer = setTimeout(
    () => controller.abort(),
    TIMEOUT
  );

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'application/json'
      },
      signal: controller.signal
    });

    if (response.status === 429) {
      res.setHeader('Retry-After', '10');

      return send(res, 503, {
        error: 'Address service is busy. Try again later.'
      });
    }

    if (!response.ok) {
      return send(res, 502, {
        error: 'Unable to find nearby address'
      });
    }

    const data = await response.json();

    const address = data?.address || {};

    const readableAddress =
      formatAddress(address) ||
      data?.display_name ||
      '';

    if (!readableAddress) {
      const result = {
        found: false,
        approximate: true,
        error: 'No nearby mapped address found',
        lat,
        lng,
        attribution: '© OpenStreetMap contributors'
      };

      try {
        await saveCache(key, result, 21600);
      } catch (error) {
        console.error('Cache save failed:', error.message);
      }

      return send(res, 404, result, 21600);
    }

    const result = {
      found: true,
      address: readableAddress,
      approximate: true,
      lat,
      lng,
      attribution: '© OpenStreetMap contributors'
    };

    try {
      await saveCache(key, result);
    } catch (error) {
      console.error('Cache save failed:', error.message);
    }

    return send(res, 200, result, CACHE_TTL);

  } catch (error) {
    console.error('Reverse geocoding error:', error.message);

    return send(res, 502, {
      error: error.name === 'AbortError'
        ? 'Address lookup timed out'
        : 'Address lookup failed'
    });

  } finally {
    clearTimeout(timer);
  }
};
