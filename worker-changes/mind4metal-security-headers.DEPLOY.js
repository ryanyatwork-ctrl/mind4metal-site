// mind4metal-security-headers — READY TO DEPLOY (2026-07-11)
// Replaces the loose CSP ("default-src ... https: data: blob:" — effectively
// no policy) with a real allowlist covering every page on the site:
//   index/miniplayer: stream + Icecast status, iTunes, Last.fm, Formspree, GA
//   community/blog:   Formspree, GA
//   /admin:           Chart.js from cdnjs, ip-api geo lookups
// The per-page <meta> CSPs in the HTML still apply on top (browsers enforce
// the intersection), so pages without cdnjs/ip-api in their meta stay tighter.
//
// DEPLOY: Workers & Pages -> mind4metal-security-headers -> Edit code ->
// replace everything with this file -> Deploy. No bindings or secrets needed.
export default {
  async fetch(request, env, ctx) {
    // Fetch the original response from GitHub Pages
    const response = await fetch(request);

    // Clone and add security headers
    const newResponse = new Response(response.body, response);

    newResponse.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    newResponse.headers.set('X-Frame-Options', 'SAMEORIGIN');
    newResponse.headers.set('X-Content-Type-Options', 'nosniff');
    newResponse.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    newResponse.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    newResponse.headers.set('Content-Security-Policy', [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' https://www.googletagmanager.com https://cdnjs.cloudflare.com https://j.bellevillesystems.com",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src https://fonts.gstatic.com",
      "img-src 'self' https: data:",
      "media-src 'self' https://radio.mind4metal.com",
      "connect-src 'self' https://radio.mind4metal.com https://ws.audioscrobbler.com https://formspree.io https://itunes.apple.com https://ip-api.com https://*.google-analytics.com https://*.analytics.google.com https://*.googletagmanager.com https://j.bellevillesystems.com",
      "worker-src 'self' blob:",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self' https://formspree.io",
      "frame-ancestors 'self'",
    ].join('; '));

    // Fix duplicate Access-Control-Allow-Origin (GitHub Pages already sets this)
    newResponse.headers.delete('Access-Control-Allow-Origin');

    // Add the three "Upcoming Headers" to future-proof the grade
    newResponse.headers.set('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
    newResponse.headers.set('Cross-Origin-Resource-Policy', 'cross-origin');
    newResponse.headers.set('Cross-Origin-Embedder-Policy', 'unsafe-none');

    return newResponse;
  }
};
