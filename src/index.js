#!/usr/bin/env node
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..');
dotenv.config({ path: resolve(PROJECT_ROOT, '.env') });
if (!process.env.SAP_STORAGE_STATE) {
  process.env.SAP_STORAGE_STATE = resolve(PROJECT_ROOT, 'storage-state.json');
}

const CREDS_MISSING = !process.env.SAP_USER || !process.env.SAP_PASS;
const CREDS_MISSING_MSG =
  'Credenciales SAP no configuradas. Ejecuta el slash command `/sap-setup` en Claude Code ' +
  'para configurarlas (o rellena `SAP_USER` y `SAP_PASS` en el archivo `.env` del plugin y reinicia).';

import { readFileSync } from 'node:fs';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { SapClient } from './sap-client.js';

const USAGE_PATH = resolve(PROJECT_ROOT, 'USAGE.md');
function loadUsage() {
  try {
    return readFileSync(USAGE_PATH, 'utf8');
  } catch {
    return '# USAGE.md no encontrado en el proyecto.';
  }
}

const sap = new SapClient();

const server = new Server(
  { name: 'claude-sap-notes', version: '0.1.0' },
  { capabilities: { tools: {}, resources: {}, prompts: {} } }
);

// Resources — documentation surfaced in Claude Desktop's "Attach from MCP"
const RESOURCES = [
  {
    uri: 'sap-notes://usage',
    name: 'Cómo usar claude-sap-notes',
    description:
      'Guía rápida: tools disponibles, ejemplos de prompts, mantenimiento y troubleshooting.',
    mimeType: 'text/markdown',
  },
];

server.setRequestHandler(ListResourcesRequestSchema, async () => ({ resources: RESOURCES }));

server.setRequestHandler(ReadResourceRequestSchema, async (req) => {
  if (req.params.uri === 'sap-notes://usage') {
    return {
      contents: [
        {
          uri: 'sap-notes://usage',
          mimeType: 'text/markdown',
          text: loadUsage(),
        },
      ],
    };
  }
  throw new Error(`Unknown resource: ${req.params.uri}`);
});

// Prompts — shown in the slash menu of Claude Desktop
const RESEARCH_PROMPT = `# Investigación profunda en SAP Notes (me.sap.com)

Actúa como consultor SAP senior haciendo una mini-investigación (30-60 min equivalentes si se hiciera a mano). Usa las tools del conector \`claude-sap-notes\` (\`sap_notes_search\`, \`sap_note_get\`, \`sap_session_refresh\`).

## Paso 1 — Evalúa si la pregunta es suficiente

Antes de buscar nada, comprueba que el usuario te ha dado al menos 3 de estos datos. Si faltan, **NO busques todavía**: pide lo que falte en una sola pregunta clara.

- Producto SAP + versión/release (ej. S/4HANA 2023, ECC 6.0 EhP8, HANA 2.0 SPS07, BW/4HANA, SuccessFactors, BTP…).
- Componente o módulo (FI, CO, MM, SD, BASIS, HANA-DB-*, etc.) o transacción/reporte/Fiori app implicada.
- Mensaje de error exacto (código + texto) o síntoma reproducible.
- Contexto: cuándo ocurre, qué se estaba haciendo, qué se ha probado ya, si hay dump (ST22), traza, short text.

Si la pregunta es vaga ("va lento", "no va el informe", "error en HANA"), **devuelve solo las preguntas clarificadoras** y espera respuesta.

## Paso 2 — Plan de búsqueda multi-consulta

Con la info completa, diseña 3-6 variantes de búsqueda antes de lanzarlas. Ejemplos de variantes útiles:

1. Código de error exacto entrecomillado (\`"SQL error -10709"\`).
2. Código + componente (\`-10709 HANA connection\`).
3. Síntoma en inglés (las notas suelen estar en inglés aunque el usuario escriba en español).
4. Transacción/programa + palabra clave del síntoma.
5. Mensaje de dump corto (\`MESSAGE_TYPE_X\`, \`TSV_TNEW_PAGE_ALLOC_FAILED\`, etc.).
6. Nombre de función/CDS/clase que aparezca en la traza.

Lanza las búsquedas con \`sap_notes_search\` (limit 5-10, \`include_content: true\`). Ejecuta varias en paralelo cuando sean independientes.

## Paso 3 — Profundiza en las candidatas

Para cada nota prometedora:

- Llama \`sap_note_get\` para leer el contenido completo.
- Anota: causa raíz, solución aceptada por SAP, SP/patch mínimo que la incluye, correction instructions manuales, workarounds temporales, pre/post-requisitos.
- Sigue la cadena de referencias: \`Reason and Prerequisites\` y \`Related Notes/KBAs\` suelen listar notas hermanas → búscalas también.
- Si la nota menciona KBA/SAP Knowledge Base Article específica, búscala por id.

Detente cuando veas convergencia (las nuevas notas no aportan info nueva) o tras ~6-10 notas leídas.

## Paso 4 — Síntesis para el usuario

Entrega un informe estructurado:

- **Causa raíz** (qué falla y por qué, citando nota(s) fuente).
- **Solución oficial SAP** (nota(s) principal(es) + SP/versión donde se integra + pasos).
- **Workarounds** si existen y la solución definitiva requiere upgrade.
- **Notas relacionadas / KBAs** con links clickables.
- **Acciones recomendadas** priorizadas (primero esto, luego esto, verifica X).
- Cita cada afirmación con el id de la nota entre paréntesis, p.ej. "(nota 2846737)".

## Reglas

- Si \`sap_notes_search\` devuelve 0 resultados, prueba otra variante antes de rendirte.
- Si falla por sesión, llama \`sap_session_refresh\` una vez y reintenta.
- No inventes ids de notas. Si no aparece en los resultados, no existe para este informe.
- URLs siempre como enlaces markdown clickables al dominio \`me.sap.com/notes/<id>\`.
`;

const PROMPTS = [
  {
    name: 'sap-notes-help',
    description: 'Muestra la guía rápida del conector claude-sap-notes.',
  },
  {
    name: 'sap-notes-research',
    description:
      'Investigación profunda en SAP Notes: pide info si la consulta es vaga, luego hace mini-investigación multi-nota buscando todas las soluciones aceptadas por SAP.',
  },
];

server.setRequestHandler(ListPromptsRequestSchema, async () => ({ prompts: PROMPTS }));

server.setRequestHandler(GetPromptRequestSchema, async (req) => {
  if (req.params.name === 'sap-notes-help') {
    return {
      description: 'Guía rápida del conector claude-sap-notes',
      messages: [
        {
          role: 'user',
          content: { type: 'text', text: loadUsage() },
        },
      ],
    };
  }
  if (req.params.name === 'sap-notes-research') {
    return {
      description: 'Investigación profunda en SAP Notes',
      messages: [
        {
          role: 'user',
          content: { type: 'text', text: RESEARCH_PROMPT },
        },
      ],
    };
  }
  throw new Error(`Unknown prompt: ${req.params.name}`);
});

const TOOLS = [
  {
    name: 'sap_note_get',
    description:
      'Descarga el contenido completo de una nota SAP desde me.sap.com. Úsalo cuando el usuario diga "busca en la nota sap 570293", "dame la nota 2846737" o similar.',
    inputSchema: {
      type: 'object',
      properties: {
        note_id: {
          type: 'string',
          description: 'Número de la nota SAP (solo dígitos).',
        },
      },
      required: ['note_id'],
    },
  },
  {
    name: 'sap_notes_search',
    description:
      'Busca notas SAP en me.sap.com por términos/palabras clave. Por defecto incluye contenido resumido de cada nota y URLs clickables. Úsalo cuando el usuario diga "busca en sap notes", "busca en notas de sap" seguido de uno o más términos. Para investigaciones profundas (usuario pide "investiga", "profundo", "todas las soluciones", error complejo), sigue el prompt `sap-notes-research`: si la consulta es vaga (falta producto+versión, código de error exacto, transacción/módulo o qué se probó) pide esos datos ANTES de buscar; con info suficiente lanza 3-6 variantes de búsqueda, llama `sap_note_get` en las candidatas, sigue la cadena de notas referenciadas y sintetiza causa raíz + solución oficial + SP/patch + workarounds + KBAs relacionadas.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Términos de búsqueda.' },
        limit: { type: 'number', description: 'Máx resultados (default 5).', default: 5 },
        include_content: {
          type: 'boolean',
          description:
            'Si true (default), busca + descarga contenido de cada resultado en paralelo para incluir un resumen real. Si false, devuelve sólo id/título/URL de la página de búsqueda.',
          default: true,
        },
        snippet_chars: {
          type: 'number',
          description: 'Caracteres por snippet al enriquecer (default 600).',
          default: 600,
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'sap_session_refresh',
    description:
      'Fuerza un nuevo login en me.sap.com. Usar si los resultados fallan con errores de sesión.',
    inputSchema: { type: 'object', properties: {} },
  },
];

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args = {} } = req.params;
  if (CREDS_MISSING) {
    return {
      isError: true,
      content: [{ type: 'text', text: CREDS_MISSING_MSG }],
    };
  }
  try {
    if (name === 'sap_note_get') {
      const data = await sap.fetchNote(args.note_id);
      const body =
        `# [Nota SAP ${data.id} — ${data.title}](${data.url})\n\n` +
        `🔗 ${data.url}\n\n` +
        (Object.keys(data.meta || {}).length
          ? '## Metadatos\n' +
            Object.entries(data.meta)
              .map(([k, v]) => `- **${k}**: ${v}`)
              .join('\n') +
            '\n\n'
          : '') +
        '## Contenido\n' +
        data.text;
      return { content: [{ type: 'text', text: body }] };
    }

    if (name === 'sap_notes_search') {
      const limit = args.limit ?? 5;
      const includeContent = args.include_content !== false;
      const snippetChars = args.snippet_chars ?? 600;
      const res = includeContent
        ? await sap.searchNotesWithContent(args.query, limit, snippetChars)
        : await sap.searchNotes(args.query, limit);
      if (!res.count) {
        return {
          content: [
            { type: 'text', text: `Sin resultados para "${res.query}" en me.sap.com/notes.` },
          ],
        };
      }
      const blocks = res.results.map((r, i) => {
        // Canonical URL without /E locale suffix for clean links; keep original if present.
        const url = r.url || `https://me.sap.com/notes/${r.id}`;
        const header = `### ${i + 1}. [${r.id} — ${r.title}](${url})`;
        const body = r.snippet ? `\n\n${r.snippet}${r.fullLength && r.fullLength > r.snippet.length ? '…' : ''}` : '';
        const link = `\n\n🔗 ${url}`;
        return header + body + link;
      });
      return {
        content: [
          {
            type: 'text',
            text:
              `Resultados (${res.count}) para **"${res.query}"** en me.sap.com/notes:\n\n` +
              blocks.join('\n\n---\n\n') +
              `\n\nPara leer una nota completa usa \`sap_note_get\` con su id.`,
          },
        ],
      };
    }

    if (name === 'sap_session_refresh') {
      await sap.ensureLoggedIn({ force: true });
      return { content: [{ type: 'text', text: 'Sesión me.sap.com renovada.' }] };
    }

    throw new Error(`Unknown tool: ${name}`);
  } catch (err) {
    return {
      isError: true,
      content: [{ type: 'text', text: `Error: ${err?.message || err}` }],
    };
  }
});

const shutdown = async () => {
  try {
    await sap.close();
  } finally {
    process.exit(0);
  }
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error('[claude-sap-notes] MCP server ready');

// Prelaunch Chromium + reuse storage session in the background so the first
// tool call doesn't pay the cold start. If this fails, tool calls will retry.
if (CREDS_MISSING) {
  console.error('[claude-sap-notes] SAP_USER/SAP_PASS not set. Skipping warmup. Run /sap-setup in Claude Code.');
} else {
  sap
    .ensureLoggedIn()
    .then(() => console.error('[claude-sap-notes] session warm'))
    .catch((err) => console.error('[claude-sap-notes] warmup failed:', err?.message || err));
}
