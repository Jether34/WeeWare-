import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';

// Keep the browser on one stable development URL while honoring the API port
// already configured in backend/.env (the API and ML service stay internal).
const backendEnvPath = path.resolve('../backend/.env');
const backendEnv = fs.existsSync(backendEnvPath) ? fs.readFileSync(backendEnvPath, 'utf8') : '';
const apiPort = process.env.WEEWARE_API_PORT || backendEnv.match(/^PORT=(\d+)\s*$/m)?.[1] || '5021';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5180,
    strictPort: true,
    // Permit temporary public tunnel hostnames when sharing this dev server.
    allowedHosts: ['.trycloudflare.com', '.loca.lt', '.ngrok-free.app', '.ngrok.app', '.ngrok.io'],
    proxy: {
      '/api': `http://127.0.0.1:${apiPort}`,
      '/uploads': `http://127.0.0.1:${apiPort}`,
      '/socket.io': { target: `http://127.0.0.1:${apiPort}`, ws: true },
    },
  },
});

