// Registra o service worker do PWA (public/sw.js). Só no build de produção:
// no `npm run dev` ele atrapalharia o recarregamento automático do Vite.
export function registerServiceWorker() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch((err) => {
      console.warn('Service worker não registrado:', err);
    });
  });
}
