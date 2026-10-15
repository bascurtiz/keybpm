import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'
import { readFileSync } from 'fs'

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8')) as { version: string }

export default defineConfig({
  base: process.env.BASE_PATH || '/',
  plugins: [react()],
  define: {
    // Injected at build time — visible in the BETA chip next to the Mix It title
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_DATE__: JSON.stringify(new Date().toISOString()),
  },
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
  optimizeDeps: {
    exclude: ['onnxruntime-web'],
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