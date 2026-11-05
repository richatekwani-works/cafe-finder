// GET  /api/rating?ids=node/1,way/2 -> { "node/1": { sum, count } }
// POST /api/rating { id, stars }   -> { sum, count }
// Shared ratings are optional. Without Upstash Redis, the frontend uses localStorage.

const crypto = require('node:crypto');

const REDIS_URL = (
  process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || ''
).replace(/\/+$/, '');
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || '';
const ID_PATTERN = /^(node|way)\/\d{1,12}$/;
const REDIS_TIMEOUT_MS = 6000;

async function redis(commands) {
  if (!REDIS_URL || !REDIS_TOKEN) {
    throw new Error('Ratings storage is not configured');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REDIS_TIMEOUT_MS);
  try {
    const response = await fetch(`${REDIS_URL}/pipeline`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${REDIS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(commands),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Redis returned HTTP ${response.status}`);
    const result = await response.json();
    if (!Array.isArray(result)) throw new Error('Invalid Redis response');
    return result;
  } finally {
    clearTimeout(timer);
  }
}

function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') return JSON.parse(req.body);
  return {};
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!REDIS_URL || !REDIS_TOKEN) {
    return res.status(501).json({ error: 'Shared ratings are not configured' });
  }

  try {
    if (req.method === 'GET') {
      const ids = String(req.query.ids || '')
        .split(',')
        .filter(id => ID_PATTERN.test(id))
        .slice(0, 60);

      if (!ids.length) return res.status(200).json({});

      const fields = ids.flatMap(id => [`${id}:s`, `${id}:c`]);
      const [result] = await redis([['HMGET', 'ratings', ...fields]]);
      const values = result?.result || [];
      const output = {};

      ids.forEach((id, index) => {
        const sum = Number(values[index * 2]) || 0;
        const count = Number(values[index * 2 + 1]) || 0;
        if (count > 0) output[id] = { sum, count };
      });

      return res.status(200).json(output);
    }

    const body = readBody(req);
    const id = String(body.id || '');
    const stars = Number(body.stars);

    if (!ID_PATTERN.test(id) || !Number.isInteger(stars) || stars < 1 || stars > 5) {
      return res.status(400).json({ error: 'Cafe id or star rating is invalid' });
    }

    const forwarded = req.headers['x-forwarded-for'];
    const remoteAddress = req.socket?.remoteAddress || 'unknown';
    const ip = String(Array.isArray(forwarded) ? forwarded[0] : forwarded || remoteAddress)
      .split(',')[0]
      .trim();
    const ipKey = crypto.createHash('sha256').update(ip).digest('hex').slice(0, 32);
    const lockKey = `rl:${ipKey}:${id}`;

    const [lock] = await redis([['SET', lockKey, '1', 'EX', '86400', 'NX']]);
    if (lock?.result !== 'OK') {
      const [current] = await redis([['HMGET', 'ratings', `${id}:s`, `${id}:c`]]);
      const values = current?.result || [];
      return res.status(429).json({
        error: 'You have already rated this cafe today',
        sum: Number(values[0]) || 0,
        count: Number(values[1]) || 0,
      });
    }

    const result = await redis([
      ['HINCRBY', 'ratings', `${id}:s`, stars],
      ['HINCRBY', 'ratings', `${id}:c`, 1],
    ]);

    return res.status(200).json({
      sum: Number(result[0]?.result) || 0,
      count: Number(result[1]?.result) || 0,
    });
  } catch (error) {
    console.error(`[Beanline] Ratings API failed: ${error.message}`);
    return res.status(500).json({ error: 'Ratings service is temporarily unavailable' });
  }
};
