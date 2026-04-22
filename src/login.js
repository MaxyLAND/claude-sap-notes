#!/usr/bin/env node
// Ejecuta un login manual para cachear la sesión (storage-state.json).
// Útil para verificar credenciales antes de enganchar el MCP a Claude.
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..');
dotenv.config({ path: resolve(PROJECT_ROOT, '.env') });
if (!process.env.SAP_STORAGE_STATE) {
  process.env.SAP_STORAGE_STATE = resolve(PROJECT_ROOT, 'storage-state.json');
}
import { SapClient } from './sap-client.js';

const sap = new SapClient();
try {
  await sap.ensureLoggedIn({ force: true });
  console.error('OK: sesión guardada.');
} catch (err) {
  console.error('FAIL:', err?.message || err);
  process.exitCode = 1;
} finally {
  await sap.close();
}
