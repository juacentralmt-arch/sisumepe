const metrics = {
  queries: 0,
  byIntent: {},
  avgLatency: 0,
  totalLatency: 0,
  errors: 0,
  lastReset: new Date().toISOString()
};

function recordQuery(intent, latencyMs, error = false) {
  metrics.queries++;
  metrics.byIntent[intent] = (metrics.byIntent[intent] || 0) + 1;
  metrics.totalLatency += latencyMs;
  metrics.avgLatency = metrics.totalLatency / metrics.queries;
  if (error) metrics.errors++;
}

function getMetrics() {
  return {
    ...metrics,
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  };
}

function resetMetrics() {
  metrics.queries = 0;
  metrics.byIntent = {};
  metrics.avgLatency = 0;
  metrics.totalLatency = 0;
  metrics.errors = 0;
  metrics.lastReset = new Date().toISOString();
}

module.exports = { recordQuery, getMetrics, resetMetrics };
