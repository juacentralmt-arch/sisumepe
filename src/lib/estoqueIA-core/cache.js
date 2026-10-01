const CACHE_TTL_MS = 30 * 1000;
const cache = new Map();
let invalidationCallbacks = [];

// TTL por prefixo (em ms)
const TTL_POR_PREFIXO = {
  'estoque': 60 * 1000,       // 1 min - estoque muda menos
  'estoqueMov': 120 * 1000,   // 2 min - movimentações mudam menos
  'usuarios': 300 * 1000,     // 5 min - usuários mudam muito pouco
  'seriais': 180 * 1000       // 3 min - seriais mudam pouco
};

function getTTL(prefix) {
  return TTL_POR_PREFIXO[prefix] || CACHE_TTL_MS;
}

function makeKey(prefix, params) {
  const sorted = Object.keys(params).sort().map(k => `${k}=${params[k]}`).join('&');
  const ttl = getTTL(prefix);
  return `${prefix}:${sorted}:${Date.now() / ttl | 0}`;
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

function invalidateAll() {
  cache.clear();
  invalidationCallbacks.forEach(cb => cb());
}

function onInvalidate(callback) {
  invalidationCallbacks.push(callback);
  return () => {
    invalidationCallbacks = invalidationCallbacks.filter(cb => cb !== callback);
  };
}

function clear() {
  cache.clear();
}

module.exports = { getOrFetch, invalidate, invalidateAll, onInvalidate, clear, CACHE_TTL_MS, TTL_POR_PREFIXO };