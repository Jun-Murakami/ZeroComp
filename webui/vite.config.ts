import { defineConfig } from 'vite'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, resolve as resolvePath } from 'path'

// 現在のモジュールURLから __dirname 相当を構築（ESM では __dirname が存在しないため）
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// ルートの VERSION を安全に読む（存在しない場合はフォールバック）
let fullVersion = '0.0.0'
try {
  fullVersion = readFileSync(resolvePath(__dirname, '../VERSION'), 'utf-8').trim()
} catch {
  console.warn('VERSION file not found, using default version')
}

// package.json のバージョンを取得
const packageJson = JSON.parse(readFileSync(resolvePath(__dirname, 'package.json'), 'utf-8'))

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    babel({
      // React Compiler は @vitejs/plugin-react v6 では reactCompilerPreset() 経由で有効化する。
      // これにより JSX/React コンポーネントの変換時にコンパイラ最適化が適用される。
      presets: [reactCompilerPreset()],
    }),
  ],
  define: {
    'import.meta.env.PACKAGE_VERSION': JSON.stringify(packageJson.version),
    'import.meta.env.VITE_APP_VERSION_FULL': JSON.stringify(fullVersion),
    'import.meta.env.VITE_BUILD_DATE': JSON.stringify(new Date().toISOString().split('T')[0]),
  },
  server: {
    port: 5173,
    host: '127.0.0.1',
    cors: true,
    headers: {
      'Access-Control-Allow-Origin': '*',
    },
  },
  build: {
    outDir: '../plugin/ui/public',
    emptyOutDir: true,
    rollupOptions: {
      onwarn(warning, warn) {
        // JUCEライブラリのeval警告を抑制
        if (warning.code === 'EVAL' && warning.id?.includes('juce-framework-frontend-mirror')) {
          return
        }
        warn(warning)
      },
    },
  },
})
