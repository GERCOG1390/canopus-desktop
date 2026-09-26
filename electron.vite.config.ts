import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    resolve: {
      alias: {
        '@i18n': resolve(__dirname, 'src/renderer/src/i18n'),
        '@': resolve(__dirname, 'src/renderer/src')
      }
    },
    // JSX goes through our runtime, which translates text when the UI is in English.
    plugins: [react({ jsxImportSource: '@i18n' })]
  }
})
