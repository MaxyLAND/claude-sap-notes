#!/usr/bin/env node
// Test rápido fuera de MCP. Uso:
//   node src/cli-test.js note 570293
//   node src/cli-test.js search "HANA memory leak"
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

const [, , cmd, ...rest] = process.argv;
const sap = new SapClient();
try {
  if (cmd === 'note') {
    const res = await sap.fetchNote(rest[0]);
    console.log(JSON.stringify(res, null, 2));
  } else if (cmd === 'search') {
    const res = await sap.searchNotes(rest.join(' '), 10);
    console.log(JSON.stringify(res, null, 2));
  } else {
    console.error('Uso: cli-test.js note <id>  |  search <query>');
    process.exitCode = 2;
  }
} catch (err) {
  console.error('ERROR:', err?.message || err);
  process.exitCode = 1;
} finally {
  await sap.close();
}
