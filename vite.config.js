import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: './', // works from any folder or static host
  // In development the app (5173) calls the sync server (8787) through this proxy
  server: { proxy: { '/api': 'http://localhost:8787' } },
  plugins: [
    react(),
    // Generates the offline service worker (replaces the old hand-written sw.js) and the manifest
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      includeAssets: ['icons/*.png'],
      manifest: {
        name: "Iyengar's Masala Stores",
        short_name: 'Khata',
        description: 'Credit book for the shop: bill photos, balances and WhatsApp reminders.',
        start_url: './',
        scope: './',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#f6f5f2',
        theme_color: '#f6f5f2',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,webmanifest,woff2}'],
        navigateFallback: 'index.html',
      },
    }),
  ],
});
