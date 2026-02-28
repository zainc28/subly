import { defineConfig } from 'vite';

// Background service worker build — IIFE (no ES module syntax in output)
export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    lib: {
      entry: 'src/background/index.ts',
      formats: ['iife'],
      name: 'SublyBackground',
      fileName: () => 'background.js',
    },
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
  },
});
