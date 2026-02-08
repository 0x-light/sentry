import path from "path"
import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import fs from "fs"

const DEV_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="theme-color" content="#0a0a0a">
  <meta name="description" content="signal without the noise">
  <title>sentry</title>
  <link rel="icon" type="image/svg+xml" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><rect fill='%23ffffff' width='100' height='100' rx='16'/><rect x='40' y='25' width='20' height='50' fill='%230a0a0a'/></svg>">
</head>
<body>
  <div id="root"></div>
  <script type="module" src="/src/main.tsx"></script>
</body>
</html>
`

function copyToRoot() {
  return {
    name: 'copy-to-root',
    config() {
      // Runs before Vite reads index.html. If a previous build overwrote it
      // with production asset references, restore the dev entry point.
      const indexPath = path.resolve(__dirname, 'index.html')
      const content = fs.readFileSync(indexPath, 'utf8')
      if (!content.includes('src/main.tsx')) {
        fs.writeFileSync(indexPath, DEV_HTML)
        console.log('  ✓ Restored dev index.html for build')
      }
    },
    closeBundle() {
      // Copy built files from dist/ up to repo root so sentry.is/ serves v2
      const distDir = path.resolve(__dirname, 'dist')
      const repoRoot = path.resolve(__dirname, '..')
      if (!fs.existsSync(distDir)) return

      // Copy assets folder to repo root
      const assetsDir = path.join(distDir, 'assets')
      const targetAssets = path.join(repoRoot, 'assets')
      if (fs.existsSync(targetAssets)) fs.rmSync(targetAssets, { recursive: true })
      fs.cpSync(assetsDir, targetAssets, { recursive: true })

      // Copy production index.html to repo root
      fs.copyFileSync(
        path.join(distDir, 'index.html'),
        path.join(repoRoot, 'index.html')
      )

      console.log('  ✓ Copied build to repo root for static serving')
    }
  }
}

export default defineConfig({
  plugins: [react(), copyToRoot()],
  base: "/",
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
})
