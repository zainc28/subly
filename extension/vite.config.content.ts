import { defineConfig } from 'vite';

// Content script build — IIFE so it works as a plain injected script
export default defineConfig({
  define: {
    // Supabase client is NOT used directly in the content script,
    // but Vite still needs these replaced if referenced transitively.
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
  build: {
    outDir: 'dist',
    emptyOutDir: false, // don't wipe files written by popup build
    lib: {
      entry: 'src/content/index.ts',
      formats: ['iife'],
      name: 'SublyContent',
      fileName: () => 'content.js',
    },
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
  },
});
