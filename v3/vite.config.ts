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
    buildStart() {
      // If index.html has been overwritten by a previous build, restore the dev version
      const indexPath = path.resolve(__dirname, 'index.html')
      const content = fs.readFileSync(indexPath, 'utf8')
      if (!content.includes('src/main.tsx')) {
        fs.writeFileSync(indexPath, DEV_HTML)
        console.log('  ✓ Restored dev index.html')
      }
    },
    closeBundle() {
      // Copy built files from dist/ up to v3/ root so sentry.is/v3/ works
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

      console.log('  ✓ Copied build to v3/ root for static serving')
    }
  }
}

export default defineConfig({
  plugins: [react(), copyToRoot()],
  base: "/v3/",
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
})
