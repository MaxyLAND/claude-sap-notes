# claude-sap-notes — guía rápida de uso

Conector MCP para Claude Desktop / Claude Code que accede a `me.sap.com`
con Universal ID (sin MFA) y expone las notas SAP como herramientas.

## Tools expuestas

| Tool | Qué hace | Ejemplo de prompt |
|------|----------|-------------------|
| `sap_notes_search` | Busca notas por términos → lista con id, título, URL clickable y resumen real del contenido (fetch paralelo). Parámetros: `limit` (default 5), `include_content` (default true), `snippet_chars` (default 600). | "busca en sap notes hana memory leak" |
| `sap_note_get` | Descarga contenido completo de una nota (texto, metadatos, refs) | "dame la nota sap 570293" |
| `sap_session_refresh` | Fuerza re-login si la sesión caducó | "refresca la sesión de sap notes" |

Claude enruta solo por la descripción de las tools. Frases típicas que funcionan:

- `busca en sap notes <términos>`
- `busca en notas de sap <términos>`
- `busca la nota sap <id>` / `dame la nota <id>` / `busca la nota <id>`
- `resume la nota sap <id>`
- Si falla por sesión: `refresca la sesión de sap notes`

## Prompts (slash menu de Claude Desktop)

| Prompt | Qué hace |
|--------|----------|
| `/sap-notes-help` | Inserta esta guía en la conversación. |
| `/sap-notes-research` | Activa modo investigación profunda: Claude primero pide info si la pregunta es vaga (producto+versión, código de error exacto, módulo/transacción, qué se probó), luego lanza 3-6 variantes de búsqueda, lee las notas candidatas, sigue la cadena de referencias y sintetiza causa raíz + solución oficial SAP + SP/patch + workarounds + KBAs relacionadas. Equivalente a 30-60 min de búsqueda manual. |

Tip: para investigaciones complejas, dispara `/sap-notes-research` **antes** de describir el problema — Claude pedirá los datos que falten antes de gastar tiempo en búsquedas mal enfocadas.

## Flujo interno

1. Arranque del MCP: lanza Chromium headless y reutiliza
   `storage-state.json` (cookies me.sap.com). Primera sesión requiere login.
2. Cada tool call usa una nueva `page` sobre el mismo `BrowserContext`.
3. Si el redirect manda a `accounts.sap.com` → re-login automático con
   `SAP_USER` / `SAP_PASS` del `.env`.
4. Welcome popup de SAP for Me se cierra automáticamente.

## Mantenimiento

- Sesión típica caduca ~8h → re-login transparente.
- Si cambia el DOM de me.sap.com y algo deja de funcionar:

  ```
  set SAP_HEADFUL=1 && node src/cli-test.js note 570293
  set SAP_HEADFUL=1 && node src/cli-test.js search "hana memory leak"
  ```

  Navegador visible para depurar. Debug dumps a
  `login-debug.{png,html}` y `search-debug.{png,html}` si algo falla.

- Logs MCP en Claude Desktop:
  `%APPDATA%\Claude\logs\mcp-server-claude-sap-notes.log`

## Variables de entorno (.env)

| Var | Obligatorio | Default |
|-----|-------------|---------|
| `SAP_USER` | sí | — |
| `SAP_PASS` | sí | — |
| `SAP_STORAGE_STATE` | no | `<proyecto>/storage-state.json` |
| `SAP_HEADFUL` | no | `0` (ponlo a `1` para navegador visible) |
| `SAP_NAV_TIMEOUT` | no | `45000` ms |

## Archivos clave

- `src/index.js` — servidor MCP (stdio), tools + prompts + resources.
- `src/sap-client.js` — Playwright: login, navegación, scraping.
- `src/login.js` — CLI para forzar login manual y cachear cookies.
- `src/cli-test.js` — smoke test sin Claude (`note <id>` / `search <query>`).

## Seguridad

- `.env` y `storage-state.json` **no** se suben a git (`.gitignore`).
- `storage-state.json` contiene cookies de sesión válidas → tratarlo como credencial.
- Sin MFA intencionadamente. Si la empresa lo activa, ampliar `_loginOnce`.
