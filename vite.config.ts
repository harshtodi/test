/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

// The renderer is a plain web app. It runs in a browser (`npm run dev:web`)
// and inside Electron (`npm run dev`, `npm run package`). `base: './'` keeps
// asset URLs relative so the production bundle works from the app:// scheme.
export default defineConfig({
  base: './',
  plugins: [react()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: true,
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        // keep the two PDF engines and React in their own long-lived chunks
        manualChunks: {
          pdfjs: ['pdfjs-dist/legacy/build/pdf.mjs'],
          pdflib: ['pdf-lib'],
          react: ['react', 'react-dom'],
        },
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30_000,
    passWithNoTests: true,
  },
});
