
const PUBLIC_MIRRORS = [
  {
    name: 'overpass.private.coffee',
    url: 'https://overpass.private.coffee/api/interpreter',
    timeout: 4500
  },
  {
    name: 'maps.mail.ru',
    url: 'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
    timeout: 4500
  },
  {
    name: 'overpass-api.de',
    url: 'https://overpass-api.de/api/interpreter',
    timeout: 4500
  }
];

const APP_URL = 'https://cafe-finder-murex.vercel.app';

const UA = process.env.CONTACT_EMAIL
  ? `BeanlineCafeFinder/1.0 (${APP_URL}; contact: ${process.env.CONTACT_EMAIL})`
  : `BeanlineCafeFinder/1.0 (${APP_URL})`;

function sendError(res, status, error, tried = []) {
  res.setHeader('Cache-Control', 'no-store');

  return res.status(status).json({
    error,
    tried
  });
}


function parseCoordinate(value, min, max) {
  if (
    value === undefined ||
    value === null ||
    value === ''
  ) {
    return null;
  }

  const number = Number(value);

  return Number.isFinite(number) &&
    number >= min &&
    number <= max
    ? number
    : null;
}


function cafeFromElement(element) {
  const tags = element.tags || {};

  const lat = Number(
    element.lat ?? element.center?.lat
  );

  const lng = Number(
    element.lon ?? element.center?.lon
  );

  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lng)
  ) {
    return null;
  }

  return {
    id: `${element.type}/${element.id}`,
    name: tags.name || 'Unnamed cafe',
    lat,
    lng,

    hours: tags.opening_hours || '',

    web:
      tags.website ||
      tags['contact:website'] ||
      '',

    phone:
      tags.phone ||
      tags['contact:phone'] ||
      '',

    addr: [
      tags['addr:housenumber'],
      tags['addr:street'],
      tags['addr:suburb'],
      tags['addr:city'] || tags['addr:town']
    ]
      .filter(Boolean)
      .join(', '),

    wifi:
      tags.internet_access === 'wlan' ||
      tags.internet_access === 'yes',

    outdoor:
      tags.outdoor_seating === 'yes'
  };
}


async function queryProvider(provider, query) {
  const controller = new AbortController();

  const timer = setTimeout(
    () => controller.abort(),
    provider.timeout
  );

  try {
    const headers = {
      'Content-Type':
        'application/x-www-form-urlencoded; charset=UTF-8',

      'Accept': 'application/json',

      'User-Agent': UA
    };

    // Send the Overpass.ch API key privately in a header.
    // Do not put the key in the URL or frontend code.

    if (provider.apiKey) {
      headers['X-API-Key'] = provider.apiKey;
    }

    const response = await fetch(provider.url, {
      method: 'POST',

      headers,

      body: `data=${encodeURIComponent(query)}`,

      signal: controller.signal
    });

    if (!response.ok) {
      const error = new Error(
        `HTTP ${response.status}`
      );

      error.status = response.status;

      throw error;
    }

    const data = await response.json();

    if (data && data.remark) {
      throw new Error(
        `Overpass remark: ${String(data.remark).slice(0, 300)}`
      );
    }

    if (
      !data ||
      !Array.isArray(data.elements)
    ) {
      throw new Error(
        'Invalid JSON response from Overpass'
      );
    }

    return data.elements
      .map(cafeFromElement)
      .filter(Boolean);

  } finally {
    clearTimeout(timer);
  }
}


module.exports = async (req, res) => {

  // Only allow GET requests.

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');

    return sendError(
      res,
      405,
      'Method not allowed'
    );
  }


  // Validate coordinates.

  const lat = parseCoordinate(
    req.query.lat,
    -90,
    90
  );

  const lng = parseCoordinate(
    req.query.lng,
    -180,
    180
  );

  if (lat === null || lng === null) {
    return sendError(
      res,
      400,
      'Valid lat and lng coordinates are required'
    );
  }


  // Validate search radius.

  let radius = 2000;

  if (req.query.r !== undefined) {
    const requestedRadius = Number(req.query.r);

    if (!Number.isInteger(requestedRadius)) {
      return sendError(
        res,
        400,
        'Radius must be a whole number'
      );
    }

    radius = requestedRadius;
  }

  radius = Math.min(
    Math.max(radius, 300),
    5000
  );


  // Read API key from Vercel Environment Variables.

  const apiKey = String(
    process.env.OVERPASS_API_KEY || ''
  ).trim();

  if (!apiKey) {
    return sendError(
      res,
      500,
      'Missing OVERPASS_API_KEY. Configure it in Vercel Environment Variables and redeploy.'
    );
  }


  // Primary provider and fallback providers.

  const providers = [
    {
      name: 'overpass.ch',
      url: 'https://api.overpass.ch/v1/interpreter',
      apiKey,
      timeout: 9000
    },

    ...PUBLIC_MIRRORS
  ];


  // Build Overpass query.

  const searchLat = Number(lat.toFixed(4));
  const searchLng = Number(lng.toFixed(4));

  const query = `[out:json][timeout:12];
    (
      node["amenity"="cafe"](around:${radius},${searchLat},${searchLng});
      way["amenity"="cafe"](around:${radius},${searchLat},${searchLng});
    );
    out center tags;`;


  const tried = [];


  // Try providers one by one.

  for (const provider of providers) {

    try {
      const cafes = await queryProvider(
        provider,
        query
      );

      res.setHeader(
        'Cache-Control',
        'public, s-maxage=600, stale-while-revalidate=1800'
      );

      return res.status(200).json({
        cafes,
        source: provider.name,
        tried
      });

    } catch (error) {

      const reason = error.name === 'AbortError'
        ? `timeout after ${provider.timeout}ms`
        : error.message || 'request failed';

      tried.push(
        `${provider.name} -> ${reason}`
      );

      console.error(
        `[Beanline] Overpass ${provider.name}: ${reason}`
      );


      // Stop if the Overpass.ch API key is invalid.

      if (
        provider.name === 'overpass.ch' &&
        [401, 403].includes(error.status)
      ) {
        return sendError(
          res,
          500,
          'Overpass.ch rejected the API key. Check OVERPASS_API_KEY in Vercel.',
          tried
        );
      }


      // Respect provider rate limits.

      if (error.status === 429) {
        res.setHeader(
          'Retry-After',
          '30'
        );

        return sendError(
          res,
          503,
          'Cafe data provider rate limit reached. Please try again later.',
          tried
        );
      }

      // Other errors move to the next provider.
    }
  }


  // All providers failed.

  return sendError(
    res,
    502,
    'Cafe data providers did not respond. Please try again.',
    tried
  );

};
