const CACHE = 'te-v19';
const CORE = ['/', '/manifest.json', '/icons/icon.svg', '/icons/icon-192.png', '/icons/icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for(const c of list){ if(c.url.includes(self.location.origin) && 'focus' in c) return c.focus(); }
      if(clients.openWindow) return clients.openWindow('/');
    })
  );
});
self.addEventListener('push', e => {
  let data = {};
  try{ data = e.data ? e.data.json() : {}; }catch{ data = { title: e.data ? e.data.text() : 'SISUMEPE' }; }
  const title = data.title || 'SISUMEPE Juazeiro';
  const opts = { body: data.body || 'Nova mensagem no chat da equipe', icon: '/icons/icon-192.png', badge: '/icons/icon-192.png', tag: data.tag || 'sisumepe-chat', vibrate: [200,100,200], data: data.url || '/' };
  e.waitUntil(self.registration.showNotification(title, opts));
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const u = new URL(e.request.url);
  // API e uploads: sempre rede (dados em tempo real, sem cache)
  if (u.pathname.startsWith('/api/') || u.pathname.startsWith('/uploads/')) return;
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request)
        .then(r => { const c = r.clone(); caches.open(CACHE).then(cc => cc.put('/', c)); return r; })
        .catch(() => caches.match('/'))
    );
    return;
  }
  e.respondWith(
    caches.match(e.request).then(hit =>
      hit || fetch(e.request).then(r => {
        const c = r.clone();
        caches.open(CACHE).then(cc => cc.put(e.request, c));
        return r;
      }).catch(() => caches.match('/'))
    )
  );
});
