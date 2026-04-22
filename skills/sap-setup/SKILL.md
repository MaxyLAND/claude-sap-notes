---
name: sap-setup
description: Configura el conector claude-sap-notes — pide credenciales SAP Universal ID, escribe `.env` en el plugin root, instala dependencias npm y cachea la sesión de me.sap.com. Úsalo cuando el usuario diga "configura sap notes", "sap setup", "configura el conector sap", "no funciona el conector sap" o similar.
---

# Setup del conector claude-sap-notes

Deja el plugin `claude-sap-notes` operativo. El MCP server ya está instalado vía marketplace, pero necesita `.env` con credenciales y una sesión cacheada.

## Pasos que debes ejecutar (no los copies al usuario — hazlos tú)

1. **Localiza el plugin root**. Busca con `Glob` el patrón `**/claude-sap-notes/.claude-plugin/plugin.json` dentro de `~/.claude/plugins/` (o `%USERPROFILE%\.claude\plugins\` en Windows). El directorio padre de `.claude-plugin/` es `PLUGIN_ROOT`.

2. **Pide credenciales al usuario** usando `AskUserQuestion` (si está disponible) o en texto plano si no. Necesitas:
   - `SAP_USER`: email Universal ID (ej. `nombre.apellido@empresa.com`).
   - `SAP_PASS`: contraseña. Trátala como secreto, no la muestres después.

3. **Escribe `.env`** en `PLUGIN_ROOT/.env` con `Write`:

   ```
   SAP_USER=<valor>
   SAP_PASS=<valor>
   ```

   Si ya existe, usa `Edit` para preservar otras variables.

4. **Instala dependencias** si falta `node_modules/`: `npm install` con `Bash` desde `PLUGIN_ROOT`. Salta si ya existe.

5. **Cachea la sesión**: `npm run login` desde `PLUGIN_ROOT`. Abre Chromium headless, loguea en me.sap.com, guarda `storage-state.json`. Si falla, muestra stderr y sugiere `SAP_HEADFUL=1 npm run login` para depurar.

6. **Pide al usuario reiniciar Claude Code / Cowork** para que MCP recargue `.env`.

7. Informa al usuario: ya puede decir "busca en sap notes memory leak hana" o disparar la skill `sap-research` para investigación profunda.

## Reglas

- No inventes la ruta del plugin. Búscala con `Glob`.
- No muestres `SAP_PASS` en texto tras recibirla.
- Si `.env` ya tiene valores, pregunta antes de sobrescribir.
- Si `npm run login` falla por red/proxy corporativo, muestra error y para — no reintentes en loop.
