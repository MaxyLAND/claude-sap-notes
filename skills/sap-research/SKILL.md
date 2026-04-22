---
name: sap-research
description: Investigación profunda en SAP Notes (me.sap.com). Si la pregunta del usuario es vaga, pide datos que faltan antes de buscar. Luego lanza varias variantes de búsqueda, lee notas candidatas, sigue cadena de referencias y sintetiza causa raíz + solución oficial SAP + SP/patch + workarounds + KBAs. Úsalo cuando el usuario pida "investiga en sap notes", "busca a fondo", "todas las soluciones para", o describa un error SAP complejo que necesita mini-investigación (30-60 min equivalentes manuales).
---

# Investigación profunda en SAP Notes (me.sap.com)

Actúa como consultor SAP senior. Usa las tools del conector `claude-sap-notes` (`sap_notes_search`, `sap_note_get`, `sap_session_refresh`).

## Paso 1 — Evalúa si la pregunta es suficiente

Antes de buscar nada, comprueba que el usuario te ha dado al menos 3 de estos datos. Si faltan, **NO busques todavía**: pide lo que falte en una sola pregunta clara.

- Producto SAP + versión/release (ej. S/4HANA 2023, ECC 6.0 EhP8, HANA 2.0 SPS07, BW/4HANA, SuccessFactors, BTP…).
- Componente o módulo (FI, CO, MM, SD, BASIS, HANA-DB-*, etc.) o transacción/reporte/Fiori app implicada.
- Mensaje de error exacto (código + texto) o síntoma reproducible.
- Contexto: cuándo ocurre, qué se estaba haciendo, qué se ha probado ya, si hay dump (ST22), traza, short text.

Si la pregunta es vaga ("va lento", "no va el informe", "error en HANA"), **devuelve solo las preguntas clarificadoras** y espera respuesta.

## Paso 2 — Plan de búsqueda multi-consulta

Con la info completa, diseña 3-6 variantes de búsqueda antes de lanzarlas. Ejemplos útiles:

1. Código de error exacto entrecomillado (`"SQL error -10709"`).
2. Código + componente (`-10709 HANA connection`).
3. Síntoma en inglés (las notas suelen estar en inglés aunque el usuario escriba en español).
4. Transacción/programa + palabra clave del síntoma.
5. Mensaje de dump corto (`MESSAGE_TYPE_X`, `TSV_TNEW_PAGE_ALLOC_FAILED`, etc.).
6. Nombre de función/CDS/clase que aparezca en la traza.

Lanza búsquedas con `sap_notes_search` (limit 5-10, `include_content: true`). Ejecuta varias en paralelo cuando sean independientes.

## Paso 3 — Profundiza en las candidatas

Para cada nota prometedora:

- Llama `sap_note_get` para leer contenido completo.
- Anota: causa raíz, solución aceptada por SAP, SP/patch mínimo que la incluye, correction instructions manuales, workarounds temporales, pre/post-requisitos.
- Sigue cadena de referencias: `Reason and Prerequisites` y `Related Notes/KBAs` suelen listar notas hermanas → búscalas también.
- Si la nota menciona KBA/SAP Knowledge Base Article específica, búscala por id.

Detente cuando veas convergencia (nuevas notas no aportan info nueva) o tras ~6-10 notas leídas.

## Paso 4 — Síntesis para el usuario

Entrega informe estructurado:

- **Causa raíz** (qué falla y por qué, citando nota(s) fuente).
- **Solución oficial SAP** (nota(s) principal(es) + SP/versión donde se integra + pasos).
- **Workarounds** si existen y la solución definitiva requiere upgrade.
- **Notas relacionadas / KBAs** con links clickables.
- **Acciones recomendadas** priorizadas.
- Cita cada afirmación con el id de la nota entre paréntesis, p.ej. "(nota 2846737)".

## Reglas

- Si `sap_notes_search` devuelve 0 resultados, prueba otra variante antes de rendirte.
- Si falla por sesión, llama `sap_session_refresh` una vez y reintenta.
- No inventes ids de notas. Si no aparece en los resultados, no existe para este informe.
- URLs siempre como enlaces markdown clickables al dominio `me.sap.com/notes/<id>`.
