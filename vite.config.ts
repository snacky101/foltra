import { type Plugin } from 'vite';
import { configDefaults, defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

// Browser development calls the real CLI/core. This bridge is absent from production builds.
function coreBridge(): Plugin {
  const token = randomBytes(32).toString('hex');
  return {
    name: 'foltra-core-bridge',
    config: () => ({ define: { __DEV_BRIDGE_TOKEN__: JSON.stringify(token) } }),
    configureServer(server) {
      server.middlewares.use('/__foltra', (req, res) => {
        const allowedOrigins = ['http://127.0.0.1:1420', 'http://localhost:1420'];
        if (
          req.method !== 'POST' ||
          req.headers['x-foltra-token'] !== token ||
          !allowedOrigins.includes(req.headers.origin ?? '')
        ) {
          res.writeHead(403).end();
          return;
        }
        let body = '';
        let oversized = false;
        req.on('data', (chunk: Buffer) => {
          body += chunk.toString();
          if (body.length > 18 * 1024 * 1024) {
            oversized = true;
            req.destroy();
          }
        });
        req.on('end', () => {
          if (oversized) return;
          try {
            const request = JSON.parse(body);
            if (typeof request.vault !== 'string' || typeof request.command !== 'string')
              throw new Error('Invalid request');
            const binary = fileURLToPath(new URL('./target/debug/foltra', import.meta.url));
            const process = spawn(binary, ['--vault', request.vault, 'rpc'], {
              stdio: ['pipe', 'pipe', 'pipe'],
            });
            let output = '';
            let errors = '';
            let settled = false;
            const finish = (status: number, data: string) => {
              if (settled) return;
              settled = true;
              res
                .writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
                .end(data);
            };
            process.stdout.on('data', (chunk) => {
              output += chunk;
            });
            process.stderr.on('data', (chunk) => {
              errors += chunk;
            });
            process.on('error', () =>
              finish(
                500,
                JSON.stringify({
                  error: { code: 'core_unavailable', message: 'Run npm run core:build first.' },
                }),
              ),
            );
            process.on('close', (code) => finish(code === 0 ? 200 : 400, code === 0 ? output : errors));
            process.stdin.end(JSON.stringify({ command: request.command, args: request.args ?? {} }));
          } catch {
            res
              .writeHead(400)
              .end(JSON.stringify({ error: { code: 'invalid_request', message: 'Invalid request' } }));
          }
        });
      });
    },
  };
}
export default defineConfig({
  test: { exclude: [...configDefaults.exclude, 'scripts/**/*.test.mjs'] },
  plugins: [react(), coreBridge()],
  server: {
    host: '127.0.0.1',
    port: 1420,
    strictPort: true,
    watch: { ignored: ['**/target/**', '**/dev-vault/**', '**/src-tauri/**'] },
  },
});
