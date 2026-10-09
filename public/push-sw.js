/* AzuuCine — notifications push (chargé dans le service worker généré par Workbox via importScripts).
 * Affiche la notification reçue, et au clic ouvre (ou ramène au premier plan) l'app sur le bon écran. */
/* eslint-env serviceworker */

// Écrans que le serveur peut demander d'ouvrir (tout le reste ouvre l'accueil)
var OPEN_RE = /^(notifications|item:[A-Za-z0-9_-]{1,64}|u:[a-z0-9_]{3,20})$/

function clip(v, max) {
  if (typeof v !== 'string') return ''
  v = v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim()
  return v.length > max ? v.slice(0, max - 1) + '…' : v
}

/** Adresse à ouvrir : uniquement « /?open=<écran> » sur ce site. */
function safeUrl(raw) {
  try {
    var u = new URL(typeof raw === 'string' ? raw : '/', self.location.origin)
    var open = u.searchParams.get('open') || ''
    if (u.origin === self.location.origin && u.pathname === '/' && OPEN_RE.test(open)) return '/?open=' + encodeURIComponent(open)
  } catch (e) {
    /* adresse invalide */
  }
  return '/'
}

self.addEventListener('push', function (event) {
  var data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch (e) {
    data = {}
  }
  var title = clip(data.title, 120) || 'AzuuCine'
  var options = {
    body: clip(data.body, 300),
    tag: clip(data.tag, 64) || undefined,
    icon: '/icons/icon-192.png',
    data: { url: safeUrl(data.url) },
  }
  event.waitUntil(
    Promise.all([
      self.registration.showNotification(title, options),
      // App ouverte : on lui signale qu'il y a du nouveau (compteur de la cloche)
      self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
        list.forEach(function (c) {
          c.postMessage({ type: 'azuu:push' })
        })
      }),
    ]),
  )
})

self.addEventListener('notificationclick', function (event) {
  event.notification.close()
  var url = safeUrl(event.notification.data && event.notification.data.url)
  var open = new URL(url, self.location.origin).searchParams.get('open') || ''
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
      // Une fenêtre de l'app est déjà ouverte : on la ramène et on lui dit quoi afficher
      for (var i = 0; i < list.length; i++) {
        var c = list[i]
        var cu = new URL(c.url)
        // (les pages légales, /privacy et /legal, ne sont pas l'app)
        if (cu.origin === self.location.origin && cu.pathname === '/' && 'focus' in c) {
          c.postMessage({ type: 'azuu:open', open: open })
          return c.focus()
        }
      }
      return self.clients.openWindow ? self.clients.openWindow(url) : undefined
    }),
  )
})
