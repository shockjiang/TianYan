// Path prefix the app is served under: '' for the plain dev server, '/service/tianyan'
// behind srv-hub (vite --base). Absolute '/api' and '/favicon.svg' would escape the prefix.
export const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');
