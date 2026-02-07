import path from "path"
import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import fs from "fs"

function copyToRoot() {
  return {
    name: 'copy-to-root',
    closeBundle() {
      // Copy built files from dist/ up to v2/ root so sentry.is/v2/ works
      const distDir = path.resolve(__dirname, 'dist')
      const rootDir = __dirname
      if (!fs.existsSync(distDir)) return

      // Copy index.html
      fs.copyFileSync(
        path.join(distDir, 'index.html'),
        path.join(rootDir, 'index.html')
      )

      // Copy assets folder
      const assetsDir = path.join(distDir, 'assets')
      const targetAssets = path.join(rootDir, 'assets')
      if (fs.existsSync(targetAssets)) fs.rmSync(targetAssets, { recursive: true })
      fs.cpSync(assetsDir, targetAssets, { recursive: true })

      console.log('  ✓ Copied build to v2/ root for static serving')
    }
  }
}

export default defineConfig({
  plugins: [react(), copyToRoot()],
  base: "/v2/",
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
})
