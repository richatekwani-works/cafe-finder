// GET /api/geocode?q=Navrangpura  -> { lat, lng }
// Turns an area name into coordinates using OpenStreetMap Nominatim.
const UA = `BeanlineCafeFinder/1.0 (${process.env.CONTACT_EMAIL || 'student project'})`;

module.exports = async (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 120);
  if (!q) return res.status(400).json({ error: 'missing q' });
  try {
    const resp = await fetch(
      'https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=in&q=' + encodeURIComponent(q),
      { headers: { 'User-Agent': UA, 'Accept-Language': 'en' } }
    );
    if (!resp.ok) return res.status(502).json({ error: 'geocoder busy' });
    const j = await resp.json();
    if (!j.length) return res.status(404).json({ error: 'not found' });
    res.setHeader('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=604800');
    res.status(200).json({ lat: +j[0].lat, lng: +j[0].lon });
  } catch (e) {
    res.status(502).json({ error: 'geocoder error' });
  }
};
