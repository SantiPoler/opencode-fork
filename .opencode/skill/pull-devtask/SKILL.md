---
name: pull-devtask
description: Pull a devTASK from dipole.work to local workspace. Use when user wants to work on an existing devTASK from the remote system.
argument-hint: Optional devTASK identifier to pull directly (e.g., '123-Workspace-devTASK')
version: 1.0.0
author: NTEC
license: MIT
tags:
  - workflow
  - task-management
  - sync
tools:
  - afwk_get_config
  - afwk_set_config
  - afwk_fetch_remote_devtasks
  - afwk_pull_devtask
---

# Pull devTASK from dipole.work

You are guiding the user through pulling an existing devTASK from dipole.work to their local workspace. Follow this systematic approach.

## Core Principles

- **Configuration First**: Always check API configuration before attempting to fetch
- **User Credentials**: Ask user for API URL and key if not configured - never guess
- **Selection Flow**: Show available devTASKs and let user choose
- **Complete Document**: After pulling, help user complete the overview.md using remote data

---

## Phase 1: Configuration Check

**Goal**: Ensure dipole.work API is configured

**Actions**:
1. Call `afwk_get_config` to check if API is configured
2. If NOT configured:
   - Ask user: "Para conectar con dipole.work necesito configurar la API. Por favor proporciona:
     - **API URL**: (ej: https://dipole.work o https://localhost:7xxx)
     - **API Key**: Tu clave de API"
   - Wait for user to provide both values
   - Call `afwk_set_config` with the provided values
   - Confirm: "✅ Configuración guardada."
3. If configured, proceed to Phase 2

**IMPORTANT**: Never proceed without valid configuration.

---

## Phase 2: List Remote devTASKs

**Goal**: Show available devTASKs from dipole.work

**Actions**:
1. If `$ARGUMENTS` contains an identifier:
   - Skip listing and go directly to Phase 3 with that identifier
2. Otherwise:
   - Call `afwk_fetch_remote_devtasks` to get the list
   - Present the list to user in a clear format
   - Ask: "¿Cuál devTASK quieres traer a local? Indica el número o el identifier."

---

## Phase 3: Pull Selected devTASK

**Goal**: Download and create local structure

**Actions**:
1. Call `afwk_pull_devtask` with the selected identifier
2. The tool will:
   - Create the folder structure in `.afwk/kanban/backlog/`
   - Save the remote JSON data in `devTASK.json`
   - Create a template `overview.md`
   - Open the file in the editor
3. Inform user: "✅ devTASK descargado. Ahora te ayudaré a completar el documento."

---

## Phase 4: Complete Overview Document

**Goal**: Help user fill in the overview.md using remote data

**Actions**:
1. Read the created `devTASK.json` to understand the remote data:
   - Look at `remoteData.itemInfo` for basic info
   - Look at `remoteData.normalizedFields` for structured fields
   - Look at `remoteData.activityLogs` for history
2. Based on the remote data, propose content for overview.md sections:

   ```
   Based on the data from dipole.work, here's what I propose:

   ## Objetivo
   [Generated from remote data]

   ## Alcance
   [Problem, Expected Outcome, Proposed Route from remote data]

   ## Criterios de Exito
   [Extracted from remote data or proposed based on context]

   ## Consideraciones Tecnicas
   [Any technical notes from remote data]

   ¿Te parece bien? Puedo ajustar antes de guardar.
   ```

3. After user confirms, use `afwk_update_document` to save the completed overview.md

---

## Special Cases

### When identifier is provided directly
```
User: "/pull-devtask 123-Workspace-devTASK"
```
- Skip Phase 2 (listing)
- Go directly to Phase 3 with the provided identifier

### When API returns error
- If 401/403: "API key inválida. Verifica tu API key con afwk_set_config"
- If 404: "devTASK no encontrado en dipole.work. Verifica el identifier."
- If connection error: "No se puede conectar a dipole.work. Verifica la URL y tu conexión."

### When devTASK already exists locally
- Tool will return error if same identifier already pulled
- Ask user: "Ya existe un devTASK local con datos de este identifier. ¿Quieres que lo ubique?"

### When remote data is minimal
- If remote data has few fields, acknowledge it
- "Los datos de dipole.work son limitados. Te ayudaré a completar el documento con lo que tenemos y tus indicaciones."

---

## Language

- Communicate with user in their preferred language (Spanish or English)
- The overview.md uses Spanish headers per convention

---

## Example Flow

```
User: "/pull-devtask"

LLM: [Calls afwk_get_config]
     "Verificando configuración de dipole.work..."

     [If not configured]
     "Para conectar con dipole.work necesito:
      - API URL: (ej: https://dipole.work)
      - API Key: Tu clave de API

      Por favor proporciona estos datos."

User: "URL: https://localhost:7123, Key: abc123"

LLM: [Calls afwk_set_config]
     "✅ Configuración guardada. Obteniendo lista de devTASKs..."

     [Calls afwk_fetch_remote_devtasks]
     "## devTASKs disponibles en dipole.work

     | # | Identifier | Title | Status |
     |---|------------|-------|--------|
     | 1 | 123-WS-devTASK | Fix bug X | Active |
     | 2 | 456-WS-devTASK | Implement Y | In Progress |

     ¿Cuál quieres traer a local?"

User: "El 1"

LLM: [Calls afwk_pull_devtask with "123-WS-devTASK"]
     "✅ Descargado → devTASK-05_fix-bug-x

     Ahora voy a revisar los datos de dipole.work para ayudarte a completar el documento..."

     [Reads devTASK.json]
     "Basándome en los datos, propongo:

     ## Objetivo
     Resolver el bug X reportado en el módulo de autenticación...

     ## Alcance
     - **Problem**: El usuario no puede iniciar sesión cuando...
     - **Expected Outcome**: Login funciona correctamente...
     - **Proposed Route**: Investigar el flow de autenticación...

     ¿Te parece bien?"

User: "Sí, guarda eso"

LLM: [Calls afwk_update_document]
     "✅ overview.md actualizado. El devTASK está listo para trabajar."
```
