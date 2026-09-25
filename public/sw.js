const CACHE_NAME = 'codemind-ai-v1';

const APP_SHELL = [
  '/',
  '/manifest.json',
  '/logo.png'
];

self.addEventListener('install', function(event){
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(function(cache){
        return cache.addAll(APP_SHELL);
      })
      .then(function(){
        return self.skipWaiting();
      })
  );
});

self.addEventListener('activate', function(event){
  event.waitUntil(
    caches.keys().then(function(keys){
      return Promise.all(
        keys
          .filter(function(key){ return key !== CACHE_NAME; })
          .map(function(key){ return caches.delete(key); })
      );
    }).then(function(){
      return self.clients.claim();
    })
  );
});

self.addEventListener('fetch', function(event){
  const request = event.request;
  if(request.method !== 'GET') return;

  const url = new URL(request.url);
  if(url.origin !== self.location.origin) return;
  if(url.pathname.startsWith('/api/')) return;

  event.respondWith(
    fetch(request)
      .then(function(response){
        if(response && response.ok){
          const copy = response.clone();
          caches.open(CACHE_NAME).then(function(cache){
            cache.put(request, copy);
          });
        }
        return response;
      })
      .catch(function(){
        return caches.match(request).then(function(cached){
          return cached || caches.match('/');
        });
      })
  );
});