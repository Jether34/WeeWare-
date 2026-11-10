const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const backendEnvPath = path.join(root, 'backend', '.env');
const backendEnv = fs.existsSync(backendEnvPath) ? fs.readFileSync(backendEnvPath, 'utf8') : '';
const configuredMlUrl = process.env.ML_SERVICE_URL || backendEnv.match(/^ML_SERVICE_URL=(.+)\s*$/m)?.[1];
const mlUrl = new URL(configuredMlUrl || 'http://127.0.0.1:8021');
const mlPort = process.env.WEEWARE_ML_PORT || mlUrl.port || '8021';
const windows = process.platform === 'win32';
const python = process.env.WEEWARE_PYTHON || path.join(
  root,
  'ml-service',
  '.venv',
  windows ? 'Scripts' : 'bin',
  windows ? 'python.exe' : 'python',
);

if (!fs.existsSync(python)) {
  console.error(`Python environment not found at ${python}. Run scripts/setup.ps1 first.`);
  process.exit(1);
}

function alreadyHealthy() {
  return new Promise((resolve) => {
    const request = require('http').get(`${mlUrl.origin}/health`, (response) => {
      response.resume();
      resolve(response.statusCode === 200);
    });
    request.setTimeout(1200, () => { request.destroy(); resolve(false); });
    request.on('error', () => resolve(false));
  });
}

alreadyHealthy().then((healthy) => {
  if (healthy) {
    console.log(`[ml] Reusing healthy ML service at ${mlUrl.origin}`);
    return;
  }
  const child = spawn(python, [
    '-m', 'uvicorn', 'app:app',
    '--app-dir', path.join(root, 'ml-service'),
    '--host', '127.0.0.1',
    '--port', mlPort,
    '--reload',
  ], { cwd: root, stdio: 'inherit' });

  child.on('error', (error) => {
    console.error(`Could not start the Python ML service: ${error.message}`);
    process.exitCode = 1;
  });
  child.on('exit', (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    else process.exit(code ?? 1);
  });
}).catch((error) => {
  console.error(`Could not initialize the Python ML service: ${error.message}`);
  process.exitCode = 1;
});
