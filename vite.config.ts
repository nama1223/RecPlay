import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,svg,ico}'],
        skipWaiting: true,
        clientsClaim: true,
      },
      includeAssets: ['NamaRecPlay192.png', 'NamaRecPlay512.png', 'NamaRecPlay1024.png'],
      manifest: {
        name: 'RecPlay',
        short_name: 'RecPlay',
        description: '録音共有・練習プレーヤー',
        theme_color: '#1e1253',
        background_color: '#1e1253',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '.',
        scope: '.',
        icons: [
          {
            src: 'NamaRecPlay192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: 'NamaRecPlay512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: 'NamaRecPlay1024.png',
            sizes: '1024x1024',
            type: 'image/png',
            purpose: 'any',
          },
        ],
      },
    }),
  ],
  base: process.env.VITE_BASE_PATH ?? '/',
})
