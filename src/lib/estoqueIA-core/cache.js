const CACHE_TTL_MS = 30 * 1000;
const cache = new Map();

function makeKey(prefix, params) {
  const sorted = Object.keys(params).sort().map(k => `${k}=${params[k]}`).join('&');
  return `${prefix}:${sorted}:${Date.now() / CACHE_TTL_MS | 0}`;
}

async function getOrFetch(prefix, params, fetcher) {
  const key = makeKey(prefix, params);
  if (cache.has(key)) return cache.get(key);
  const data = await fetcher();
  cache.set(key, data);
  return data;
}

function invalidate(prefix) {
  for (const key of cache.keys()) {
    if (key.startsWith(prefix + ':')) cache.delete(key);
  }
}

function clear() {
  cache.clear();
}

module.exports = { getOrFetch, invalidate, clear, CACHE_TTL_MS };