import { defineConfig } from 'vite'

// base './' → relative asset URLs, so the build works at any GitHub Pages path
export default defineConfig({
  base: './',
  server: {
    host: true,
  },
})
