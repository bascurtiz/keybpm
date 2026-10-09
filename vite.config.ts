import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  base: process.env.BASE_PATH || '/',
  plugins: [react()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  server: {
    port: 5173,
    strictPort: true, // must match Discord redirect + APP_ORIGIN
    open: true,
    // Proxy API/auth to wrangler dev (default :8787) when VITE_API_BASE is unset.
    proxy: {
      '/api': { target: 'http://127.0.0.1:8787', changeOrigin: true },
      '/auth': { target: 'http://127.0.0.1:8787', changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    // The dataset chunk is large by design (~20k tracks); app code stays small.
    chunkSizeWarningLimit: 6000,
    rollupOptions: {
      output: {
        manualChunks: id => (id.includes('/data/tracks.json') ? 'tracks' : undefined),
      },
    },
  },
})