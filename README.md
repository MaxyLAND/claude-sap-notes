# claude-sap-notes-mcp

Conector MCP (Model Context Protocol) para Claude Desktop / Claude Code / Cowork que se
autentica de forma headless en `me.sap.com` con Universal ID (sin MFA) y expone las
notas SAP como herramientas que Claude puede llamar automáticamente cuando dices cosas
como:

- "busca en sap notes memory leak hana"
- "busca en notas de sap el error ORA-01555"
- "dame la nota sap 570293"
- "resume la nota 2846737"

El servidor corre **en local**, las credenciales quedan en un `.env` local, la sesión
se persiste en `storage-state.json` para no re-logearte en cada llamada, y Playwright
se lanza en modo headless — no se abre ningún navegador visible salvo que lo fuerces
con `SAP_HEADFUL=1` para debug.

## Estructura

```
claude-sap-notes/
├── package.json
├── .env.example
├── src/
│   ├── index.js       # servidor MCP (stdio)
│   ├── sap-client.js  # login + scraping de me.sap.com con Playwright
│   ├── login.js       # CLI para forzar un login y cachear sesión
│   └── cli-test.js    # prueba rápida fuera de Claude
```

## Herramientas MCP expuestas

| Tool                 | Qué hace                                                     |
| -------------------- | ------------------------------------------------------------ |
| `sap_note_get`       | Descarga el texto completo de una nota por id (ej. 570293).  |
| `sap_notes_search`   | Busca notas por términos y devuelve lista de ids + títulos.  |
| `sap_session_refresh`| Fuerza re-login si la sesión caducó.                         |

## Instalación

Requisitos: Node 18+, conexión a me.sap.com desde la máquina.

```powershell
cd C:\xampp\htdocs\www\claude-sap-notes
npm install
# postinstall descarga Chromium (~150 MB) para Playwright
```

Copia `.env.example` a `.env` y pon tu correo/contraseña SAP Universal ID:

```
SAP_USER=nombre.apellido@claude.com
SAP_PASS=********
```

Verifica login (cachea cookies en `storage-state.json`):

```powershell
npm run login
```

Smoke test sin Claude:

```powershell
node src/cli-test.js note 570293
node src/cli-test.js search "hana memory leak"
```

## Configuración en Claude Desktop (Windows)

Edita `%APPDATA%\Claude\claude_desktop_config.json` y añade dentro de `mcpServers`:

```json
{
  "mcpServers": {
    "claude-sap-notes": {
      "command": "node",
      "args": ["C:\\xampp\\htdocs\\www\\claude-sap-notes\\src\\index.js"],
      "env": {
        "SAP_USER": "nombre.apellido@claude.com",
        "SAP_PASS": "********"
      }
    }
  }
}
```

Reinicia Claude Desktop. Deberías ver las tres tools en el icono de herramientas.

> Alternativa: deja las credenciales en el `.env` y omite el bloque `env` — `dotenv`
> las carga desde el cwd del proceso. Si usas el `env` del config JSON, Claude Desktop
> tiene prioridad sobre `.env`.

## Configuración en Claude Code (CLI)

```powershell
claude mcp add claude-sap-notes -- node "C:\xampp\htdocs\www\claude-sap-notes\src\index.js"
```

Luego dentro de Claude Code: `/mcp` para confirmar que aparece conectado.

## Cómo lo usa Claude

Las descripciones de las tools ya están en español y disparan con frases típicas:

- **"busca en la nota sap 570293"** → Claude llama `sap_note_get({ note_id: "570293" })`
- **"busca en sap notes oom hana"** → Claude llama `sap_notes_search({ query: "oom hana" })`

No hace falta que escribas "usa la tool X"; el routing es automático por las
descripciones del `ListTools`.

## Notas sobre la autenticación

- El script arranca Chromium headless, navega a `https://me.sap.com/`, sigue el
  redirect al IdP de SAP (`accounts.sap.com`), rellena email → continuar → password →
  enviar, y espera volver a `me.sap.com`.
- La sesión se guarda como `storage-state.json` (cookies + localStorage) y se reutiliza
  entre llamadas mientras sea válida. Si caduca o SAP invalida la cookie, el cliente
  detecta el redirect al IdP y hace re-login transparente.
- No hay soporte para MFA / TOTP intencionadamente. Si algún día activáis 2FA en la
  cuenta hay que ampliar `_loginOnce` para pedir el código.
- Los selectores del form de login (`j_username`, `j_password`) son los que usa SAP
  CustomerLogin desde hace años, pero SAP los cambia sin avisar. Si el login falla,
  lanza con `SAP_HEADFUL=1 npm run login` para ver qué ha cambiado y ajusta
  `src/sap-client.js`.

## Notas sobre el scraping

- `me.sap.com` es una SPA. El cliente navega a `https://me.sap.com/notes/<id>` y
  extrae el DOM tras `networkidle`. No hay API pública estable para notas SAP, así que
  esto es scraping "best-effort".
- Para búsqueda se usa `me.sap.com/search?q=<query>&tab=notes`. Si SAP cambia las
  rutas, ajusta el array `searchUrls` en `searchNotes()`.

## Seguridad

- El `.env` y `storage-state.json` están en `.gitignore`. **No los subas a git.**
- `storage-state.json` contiene cookies de sesión con acceso a me.sap.com — trátalo
  como una credencial.
- Si compartís esta máquina, considera cifrar el directorio o meter las credenciales
  en el Windows Credential Manager y leerlas desde ahí en lugar de `.env`.

## Problemas comunes

| Síntoma | Causa probable | Solución |
|---|---|---|
| `Missing SAP_USER / SAP_PASS` | `.env` no cargado | Arranca el proceso con cwd en el directorio del proyecto, o pon `env` en el config de Claude. |
| `Login did not land on me.sap.com` | Selectores cambiados o MFA activo | `SAP_HEADFUL=1 npm run login` para ver el navegador y ajusta selectores. |
| Notas devuelven texto muy corto | SPA aún no ha hidratado | Sube `SAP_NAV_TIMEOUT` (default 45000 ms). |
| `Target closed` / timeouts | Red corporativa bloqueando Chromium | Usa proxy via `HTTPS_PROXY` env var, o lista blanca `me.sap.com`/`accounts.sap.com`. |

## Licencia

Uso interno claude.
