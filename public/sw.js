self.addEventListener('push', event => {
  let p = {title:'WATCHTOWER update',body:'A monitored source has new information.',url:'/#alerts'};
  try { p = Object.assign(p, event.data.json()); } catch {}
  event.waitUntil(self.registration.showNotification(String(p.title).slice(0,90), {
    body:String(p.body).slice(0,180), icon:'/icon.svg', badge:'/icon.svg',
    tag:String(p.tag || 'watchtower'), data:{url:String(p.url).startsWith('/') ? p.url : '/#alerts'}
  }));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(clients.openWindow(new URL(event.notification.data.url, self.location.origin).href));
});