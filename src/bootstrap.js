#!/usr/bin/env node
// Entrypoint que corre antes de arrancar el MCP server.
// Garantiza que node_modules + Chromium + .env estén listos.
// Si falta algo no bloqueante, sigue; si falta .env, arranca igual pero el MCP
// devolverá error claro al primer call pidiendo ejecutar /sap-setup.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..');
const NODE_MODULES = resolve(PROJECT_ROOT, 'node_modules');
const PKG_LOCK = resolve(PROJECT_ROOT, 'package-lock.json');
const ENV_FILE = resolve(PROJECT_ROOT, '.env');
const ENV_EXAMPLE = resolve(PROJECT_ROOT, '.env.example');
const BOOTSTRAP_MARKER = resolve(PROJECT_ROOT, '.bootstrap-done');

function log(msg) {
  console.error(`[claude-sap-notes:bootstrap] ${msg}`);
}

// 1. npm install si falta node_modules
if (!existsSync(NODE_MODULES)) {
  log('node_modules missing → running npm install (first-run only, ~1-2 min)...');
  const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const res = spawnSync(npmCmd, ['install', '--no-audit', '--no-fund'], {
    cwd: PROJECT_ROOT,
    stdio: 'inherit',
    shell: false,
  });
  if (res.status !== 0) {
    log(`npm install failed with exit ${res.status}. Run manually in ${PROJECT_ROOT}`);
    process.exit(res.status || 1);
  }
  try {
    writeFileSync(BOOTSTRAP_MARKER, new Date().toISOString());
  } catch {}
  log('npm install done.');
}

// 2. .env: si falta, crea plantilla vacía; MCP avisará en primer call
if (!existsSync(ENV_FILE)) {
  log('.env missing → creating empty template from .env.example');
  try {
    const template = existsSync(ENV_EXAMPLE)
      ? readFileSync(ENV_EXAMPLE, 'utf8')
      : 'SAP_USER=\nSAP_PASS=\n';
    writeFileSync(ENV_FILE, template);
    log('Empty .env created. Run /sap-setup in Claude Code to fill credentials.');
  } catch (err) {
    log(`Could not create .env: ${err.message}`);
  }
}

// 3. Delegar al MCP server real
await import('./index.js');
