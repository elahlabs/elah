import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@myeditor/timeline': path.resolve(__dirname, '../../packages/timeline/src/index.ts'),
    },
  },
})
