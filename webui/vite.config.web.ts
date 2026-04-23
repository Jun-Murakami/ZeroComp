import { defineConfig, type Plugin } from 'vite';
import react, { reactCompilerPreset } from '@vitejs/plugin-react';
import babel from '@rolldown/plugin-babel';
import {
  readFileSync,
  createReadStream,
  statSync,
  cpSync,
  existsSync,
  renameSync,
  unlinkSync,
} from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve as resolvePath } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let fullVersion = '0.0.0';
try {
  fullVersion = readFileSync(resolvePath(__dirname, '../VERSION'), 'utf-8').trim();
} catch {
  console.warn('VERSION file not found, using default version');
}

const packageJson = JSON.parse(
  readFileSync(resolvePath(__dirname, 'package.json'), 'utf-8')
);

/**
 * public/ (共有) と public-web/ (Web専用) の両方を配信する Vite プラグイン。
 *
 * - Dev: public-web/ を追加の静的ファイルディレクトリとして配信
 * - Build: public-web/ の内容を dist/ にコピー
 *
 * プラグイン用ビルド (vite.config.ts) は public/ だけを使い、
 * WASM・worklet・サンプル音源はプラグインバイナリに含まれない。
 */
function mergePublicWeb(): Plugin {
  const webPublicDir = resolvePath(__dirname, 'public-web');
  return {
    name: 'merge-public-web',

    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        if (req.url === '/' || req.url === '/index.html') {
          req.url = '/index.web.html';
        }
        next();
      });
      server.middlewares.use((req, res, next) => {
        if (!req.url) return next();

        const urlPath = req.url.split('?')[0];
        const filePath = resolvePath(webPublicDir, '.' + urlPath);

        if (existsSync(filePath) && !filePath.includes('..')) {
          const stat = statSync(filePath);
          if (stat.isFile()) {
            const ext = filePath.split('.').pop()?.toLowerCase() || '';
            const mimeTypes: Record<string, string> = {
              js: 'application/javascript',
              wasm: 'application/wasm',
              mp3: 'audio/mpeg',
              wav: 'audio/wav',
              json: 'application/json',
              html: 'text/html',
            };
            res.setHeader('Content-Type', mimeTypes[ext] || 'application/octet-stream');
            res.setHeader('Content-Length', stat.size);
            res.setHeader('Access-Control-Allow-Origin', '*');
            createReadStream(filePath).pipe(res);
            return;
          }
        }
        next();
      });
    },

    closeBundle() {
      const outDir = resolvePath(__dirname, 'dist');
      if (existsSync(webPublicDir)) {
        cpSync(webPublicDir, outDir, { recursive: true, force: true });
      }
      const webHtml = resolvePath(outDir, 'index.web.html');
      const indexHtml = resolvePath(outDir, 'index.html');
      if (existsSync(webHtml)) {
        if (existsSync(indexHtml)) unlinkSync(indexHtml);
        renameSync(webHtml, indexHtml);
      }
    },
  };
}

/**
 * Web (SPA) ビルド用 Vite 設定（ZeroComp）。
 *
 * 主な違い:
 * 1. juce-framework-frontend-mirror → bridge/web/juce-shim.ts にエイリアス
 * 2. bridge/juce → bridge/web/web-juce.ts にエイリアス
 * 3. 出力先: dist/
 * 4. VITE_RUNTIME=web 環境変数
 * 5. public-web/ から WASM / worklet / サンプル音源を配信
 */
export default defineConfig({
  plugins: [
    react(),
    babel({
      presets: [reactCompilerPreset()],
    }),
    mergePublicWeb(),
  ],
  define: {
    'import.meta.env.PACKAGE_VERSION': JSON.stringify(packageJson.version),
    'import.meta.env.VITE_APP_VERSION_FULL': JSON.stringify(fullVersion),
    'import.meta.env.VITE_BUILD_DATE': JSON.stringify(
      new Date().toISOString().split('T')[0]
    ),
    'import.meta.env.VITE_RUNTIME': JSON.stringify('web'),
  },
  resolve: {
    alias: [
      { find: 'juce-framework-frontend-mirror',
        replacement: resolvePath(__dirname, 'src/bridge/web/juce-shim.ts') },
      { find: /(.*)\/bridge\/juce$/,
        replacement: resolvePath(__dirname, 'src/bridge/web/web-juce.ts') },
    ],
  },
  server: {
    port: 5174,
    host: '127.0.0.1',
    cors: true,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: resolvePath(__dirname, 'index.web.html'),
    },
  },
});
