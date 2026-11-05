// GET /api/cafes?lat=..&lng=..&r=..  -> { cafes: [...] }
// Asks OpenStreetMap (Overpass) for cafes around a point. Vercel's edge caches the answer.
const MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];
const UA = `BeanlineCafeFinder/1.0 (${process.env.CONTACT_EMAIL || 'student project'})`;

module.exports = async (req, res) => {
  const lat = parseFloat(req.query.lat);
  const lng = parseFloat(req.query.lng);
  let r = parseInt(req.query.r, 10) || 2000;
  if (!(lat >= -90 && lat <= 90) || !(lng >= -180 && lng <= 180)) {
    return res.status(400).json({ error: 'bad coordinates' });
  }
  r = Math.min(Math.max(r, 300), 5000);

  const la = lat.toFixed(3), lo = lng.toFixed(3); // rounding = better cache hits
  const q = `[out:json][timeout:20];(node["amenity"="cafe"](around:${r},${la},${lo});way["amenity"="cafe"](around:${r},${la},${lo}););out center tags;`;

  let data = null;
  for (const url of MIRRORS) {
    try {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 22000);
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA },
        body: 'data=' + encodeURIComponent(q),
        signal: ctl.signal,
      });
      clearTimeout(timer);
      if (resp.ok) { data = await resp.json(); break; }
    } catch (e) { /* try next mirror */ }
  }
  if (!data) return res.status(502).json({ error: 'map data server is busy' });

  const cafes = (data.elements || []).map((e) => {
    const t = e.tags || {};
    return {
      id: e.type + '/' + e.id,
      name: t.name || 'Unnamed cafe',
      lat: e.lat ?? (e.center && e.center.lat),
      lng: e.lon ?? (e.center && e.center.lon),
      hours: t.opening_hours || '',
      web: t.website || t['contact:website'] || '',
      phone: t.phone || t['contact:phone'] || '',
      addr: [t['addr:housenumber'], t['addr:street'], t['addr:suburb'], t['addr:city']].filter(Boolean).join(', '),
      wifi: t.internet_access === 'wlan' || t.internet_access === 'yes',
      outdoor: t.outdoor_seating === 'yes',
    };
  }).filter((c) => c.lat && c.lng);

  res.setHeader('Cache-Control', 'public, s-maxage=600, stale-while-revalidate=1800');
  res.status(200).json({ cafes });
};
