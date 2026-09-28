const CTX_PREFIX = 'ia_ctx:';

async function getContext(store, user) {
  const key = CTX_PREFIX + (user || 'global');
  try {
    const rows = await store.audit.search({
      kind: 'ia_contexto',
      user,
      limit: 1
    });
    if (rows.items.length) {
      const last = rows.items[0];
      return JSON.parse(last.summary || '{}');
    }
  } catch (e) {}
  return {};
}

async function setContext(store, user, ctx) {
  const key = CTX_PREFIX + (user || 'global');
  try {
    await store.audit.insert({
      kind: 'ia_contexto',
      action: 'update',
      byUser: user,
      summary: JSON.stringify(ctx)
    });
  } catch (e) {
    console.warn('IA context persist failed:', e.message);
  }
}

async function clearContext(store, user) {
  try {
    const rows = await store.audit.search({ kind: 'ia_contexto', user, limit: 100 });
    for (const r of rows.items) {
      await store.audit.remove(r.id);
    }
  } catch (e) {}
}

module.exports = { getContext, setContext, clearContext };