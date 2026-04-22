---
description: Configura credenciales SAP Universal ID para el conector claude-sap-notes (.env + login).
---

# Setup del conector claude-sap-notes

Guía al usuario paso a paso para dejar el plugin `claude-sap-notes` operativo. El MCP server ya está instalado vía marketplace, pero necesita `.env` con credenciales y una sesión cacheada.

## Pasos a seguir (ejecútalos tú, no los copies al usuario)

1. **Localiza el plugin root**. Está en una subruta de `~/.claude/plugins/` o `%USERPROFILE%\.claude\plugins\`. Usa Glob para encontrar `**/claude-sap-notes/.claude-plugin/plugin.json` dentro de `~/.claude/plugins/`. El directorio padre de `.claude-plugin` es `PLUGIN_ROOT`.

2. **Pide credenciales al usuario** con el tool `AskUserQuestion` (o pregúntale en texto si no está disponible). Necesitas:
   - `SAP_USER`: email Universal ID (ej. `nombre.apellido@empresa.com`).
   - `SAP_PASS`: contraseña. **No la muestres en plano después**, trátala como secreto.

3. **Escribe `.env`** en `PLUGIN_ROOT/.env` con el tool `Write`:

   ```
   SAP_USER=<valor>
   SAP_PASS=<valor>
   ```

   Si `.env` ya existe, úsalo con `Edit` para preservar otras variables.

4. **Instala dependencias** si no están: ejecuta `npm install` con `Bash` desde `PLUGIN_ROOT`. Salta este paso si `node_modules/` ya existe.

5. **Cachea la sesión**: ejecuta `npm run login` desde `PLUGIN_ROOT`. Esto abre Chromium headless, loguea en me.sap.com y guarda `storage-state.json`. Si falla, muestra el stderr al usuario y sugiere re-ejecutar con `SAP_HEADFUL=1 npm run login` para depurar.

6. **Pide al usuario reiniciar Claude Code** para que el MCP server recargue `.env` y arranque con creds.

7. Informa al usuario que ya puede usar frases como "busca en sap notes memory leak hana" o disparar `/sap-notes-research` para investigaciones profundas.

## Reglas

- No inventes la ruta del plugin: búscala con Glob.
- No muestres `SAP_PASS` en texto después de recibirla.
- Si el usuario ya tiene `.env` con valores, pregunta si quiere sobrescribir antes de tocar nada.
- Si `npm run login` falla por red/proxy corporativo, documenta el error pero no reintentes en loop.
