// GET  /api/rating?ids=node/1,way/2  -> { "node/1": {sum,count} }
// POST /api/rating {id, stars}       -> { sum, count }   (1 rating per cafe per IP per day)
// Storage: Upstash Redis (free, add it from the Vercel Storage / Marketplace tab).
// Without it, this returns 501 and the site falls back to browser-only ratings.
const URL_ = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
const ID = /^(node|way)\/\d{1,12}$/;

async function redis(cmds) {
  const r = await fetch(URL_ + '/pipeline', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmds),
  });
  if (!r.ok) throw new Error('redis');
  return r.json();
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!URL_ || !TOKEN) return res.status(501).json({ error: 'ratings storage not configured' });
  try {
    if (req.method === 'GET') {
      const ids = String(req.query.ids || '').split(',').filter((i) => ID.test(i)).slice(0, 60);
      if (!ids.length) return res.status(200).json({});
      const fields = ids.flatMap((i) => [i + ':s', i + ':c']);
      const [out] = await redis([['HMGET', 'ratings', ...fields]]);
      const arr = out.result || [];
      const o = {};
      ids.forEach((id, k) => {
        const count = +arr[2 * k + 1] || 0;
        if (count) o[id] = { sum: +arr[2 * k] || 0, count };
      });
      return res.status(200).json(o);
    }
    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
      const id = String(body.id || '');
      const stars = Number(body.stars);
      if (!ID.test(id) || !Number.isInteger(stars) || stars < 1 || stars > 5) {
        return res.status(400).json({ error: 'bad input' });
      }
      const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
      const [lock] = await redis([['SET', `rl:${ip}:${id}`, '1', 'EX', '86400', 'NX']]);
      if (lock.result !== 'OK') {
        const [cur] = await redis([['HMGET', 'ratings', id + ':s', id + ':c']]);
        const a = cur.result || [];
        return res.status(429).json({ error: 'already rated', sum: +a[0] || 0, count: +a[1] || 0 });
      }
      const out = await redis([['HINCRBY', 'ratings', id + ':s', stars], ['HINCRBY', 'ratings', id + ':c', 1]]);
      return res.status(200).json({ sum: out[0].result, count: out[1].result });
    }
    res.status(405).json({ error: 'method not allowed' });
  } catch (e) {
    res.status(500).json({ error: 'server error' });
  }
};
