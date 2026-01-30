import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'
import { nodePolyfills } from 'vite-plugin-node-polyfills'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    nodePolyfills({
      protocolImports: true,
    }),
  ],
  define: {
    global: 'globalThis',
  },
  resolve: {
    alias: {
      fs: 'null',
      path: 'null',
    },
  },
  build: {
    rollupOptions: {
      external: ['fs', 'path', 'fs/promises'],
    },
    minify: 'esbuild',
  },
  esbuild: {
    // Preserve console statements for debugging
    drop: [],
  },
})
