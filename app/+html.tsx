/**
 * Custom HTML shell for Expo Router web builds.
 *
 * This file is the single source of truth for the global <head> tags.
 * It injects global meta tags, Open Graph defaults, Twitter Card tags,
 * manifest link, and performance hints.
 *
 * Per-page title, description, canonical, noindex and JSON-LD are set by
 * PageHead in each route, so they are not repeated here.
 */
import { ScrollViewStyleReset } from 'expo-router/html';
import { type PropsWithChildren } from 'react';
import { SEO } from '../src/config/seo';

/** Origin of the API gateway, derived at build time. Null when unset or invalid. */
function apiOrigin(): string | null {
  try {
    return new URL(process.env.EXPO_PUBLIC_API_BASE_URL ?? '').origin;
  } catch {
    return null;
  }
}

export default function Root({ children }: PropsWithChildren) {
  const origin = apiOrigin();

  return (
    <html lang="en-GB">
      <head>
        <meta charSet="utf-8" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, viewport-fit=cover"
        />

        {/* ── Primary Meta Tags ────────────────────────── */}
        <meta name="author" content={SEO.siteName} />
        {/* Indexing is the default; PageHead adds noindex on private routes. */}
        <meta name="googlebot" content="max-video-preview:-1, max-image-preview:large, max-snippet:-1" />

        {/* ── Open Graph / Facebook ────────────────────── */}
        <meta property="og:type" content="website" />
        <meta property="og:image" content={`${SEO.siteUrl}${SEO.ogImage}`} />
        {/* public/og-image.png is 512x512; a 1200x630 image should replace it (owner asset), then restore 1200/630 and summary_large_image. */}
        <meta property="og:image:width" content="512" />
        <meta property="og:image:height" content="512" />
        <meta property="og:image:alt" content="SafeNight walking safety navigation app" />
        <meta property="og:site_name" content={SEO.siteName} />
        <meta property="og:locale" content={SEO.locale} />

        {/* ── Twitter Card ─────────────────────────────── */}
        {/* summary, not summary_large_image, because og-image.png is 512x512. Switch back once a 1200x630 image ships. */}
        <meta name="twitter:card" content="summary" />
        <meta name="twitter:image" content={`${SEO.siteUrl}${SEO.ogImage}`} />
        <meta name="twitter:image:alt" content="SafeNight walking safety navigation app" />

        {/* ── Theme & PWA ──────────────────────────────── */}
        <meta name="theme-color" content={SEO.themeColor} />
        <meta name="msapplication-TileColor" content={SEO.themeColor} />
        <meta name="application-name" content={SEO.siteName} />
        <meta name="apple-mobile-web-app-title" content={SEO.siteName} />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="format-detection" content="telephone=no" />

        {/* ── Favicons ─────────────────────────────────── */}
        <link rel="icon" href="/favicon.ico" sizes="any" />
        <link rel="icon" type="image/png" href="/favicon.png" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />

        {/* ── Web App Manifest ─────────────────────────── */}
        <link rel="manifest" href="/manifest.json" />

        {/* ── Performance Hints ────────────────────────── */}
        {origin ? <link rel="dns-prefetch" href={origin} /> : null}
        {origin ? <link rel="preconnect" href={origin} crossOrigin="anonymous" /> : null}
        <link rel="dns-prefetch" href="https://unpkg.com" />
        <link rel="preconnect" href="https://unpkg.com" />
        <link rel="dns-prefetch" href="https://a.tile.openstreetmap.org" />
        <link rel="preconnect" href="https://a.tile.openstreetmap.org" />

        {/* Expo Router scroll-reset styles */}
        <ScrollViewStyleReset />

        {/* ── Global Styles ────────────────────────────── */}
        <style
          dangerouslySetInnerHTML={{
            __html: `
              :root {
                --font-sans: system-ui, -apple-system, "SF Pro Text", "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
                --ink: #101828;
                --ink-muted: #475467;
                --glass-fill: rgba(255, 255, 255, 0.74);
                --glass-border: rgba(255, 255, 255, 0.7);
                --glass-shadow: 0 12px 40px rgba(15, 23, 42, 0.14);
                --glass-blur: blur(28px) saturate(180%);
                --accent: #1570ef;
              }
              html, body { height: 100%; margin: 0; padding: 0; }
              html, body, #root, input, textarea, button {
                font-family: var(--font-sans);
                color: var(--ink);
              }
              body {
                overflow: hidden;
                background: linear-gradient(160deg, #f4f1ff 0%, #e6f0ff 45%, #fdf1e7 100%);
                -webkit-font-smoothing: antialiased;
                -moz-osx-font-smoothing: grayscale;
              }
              #root { display: flex; flex: 1; height: 100%; }
              [role="button"], [role="link"], button, a { cursor: pointer; }
              :focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
              @media (prefers-reduced-motion: reduce) {
                *, *::before, *::after { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }
              }
            `,
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
