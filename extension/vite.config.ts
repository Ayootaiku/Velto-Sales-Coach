import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

const root = path.resolve(__dirname);

export default defineConfig({
  root,
  base: './',
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '..'),
    },
  },
  css: {
    postcss: {
      plugins: [
        require('tailwindcss')({
          config: path.resolve(__dirname, '..', 'tailwind.config.ts'),
        }),
        require('autoprefixer')(),
      ],
    },
  },
  build: {
    outDir: path.resolve(__dirname, 'dist'),
    emptyOutDir: true,
    sourcemap: false,
    minify: 'esbuild',
    rollupOptions: {
      input: {
        sidepanel: path.resolve(__dirname, 'sidepanel.html'),
        popup: path.resolve(__dirname, 'popup.html'),
        options: path.resolve(__dirname, 'options.html'),
        background: path.resolve(__dirname, 'src/background.ts'),
        content: path.resolve(__dirname, 'src/content.tsx'),
      },
      output: {
        entryFileNames: (chunk) => {
          if (chunk.name === 'background' || chunk.name === 'content') {
            return '[name].js';
          }
          return 'assets/[name]-[hash].js';
        },
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
    'process.env': '{}',
    'import.meta.env.VITE_RAILWAY_WSS': JSON.stringify('wss://velto-sales-coach-production.up.railway.app'),
  },
});
