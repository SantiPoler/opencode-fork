# aiFRAMEWORK - Arquitectura Completa

> Sistema "a prueba de alucinaciones" donde el LLM nunca puede afirmar cambios de estado sin evidencia de ejecución de herramientas.

**Estado:** ✅ Implementación completa (207 tests passing)

---

## Principio Core

**El LLM no puede afirmar que hizo algo sin haberlo hecho realmente.**

Si el usuario pregunta "¿qué hay en el kanban?" y el LLM responde sin llamar a `afwk_get_kanban_status`, el sistema detecta la alucinación y fuerza un retry.

---

## Resumen de Componentes

| Componente | Archivo | Responsabilidad |
|------------|---------|-----------------|
| Contracts | `contracts.ts` | Tipos, IDs de tools, registro |
| Classifier | `classifier.ts` | Clasificación de intención |
| Policy Gate | `policy-gate.ts` | Validación de evidencia |
| Evidence | `evidence.ts` | Construcción de evidencia desde parts |
| State | `state.ts` | Persistencia en state.json |
| Tools | `tools.ts` | 8 herramientas del kanban |
| System Prompt | `system-prompt.ts` | Prompt del sistema (~500 tokens) |
| Executor | `executor.ts` | Wrapper con policy gate |
| Integration | `integration.ts` | Helpers para processor.ts |
| Template Loader | `template-loader.ts` | Carga plantillas .md |
| Rules Engine | `rules-engine.ts` | Validación de transiciones desde YAML |
| Security Hooks | `security-hooks.ts` | Bloquea acceso directo a .afwk/ |

---

## Componentes

### 1. `contracts.ts` - Tipos y Registros

**Ubicación:** `packages/opencode/src/afwk/contracts.ts`

**Responsabilidad:** Define todos los tipos compartidos y el registro de herramientas.

**Exports principales:**

| Export | Tipo | Descripción |
|--------|------|-------------|
| `IntentType` | Type | `"mutation" \| "read" \| "conversation"` |
| `AFWK_TOOL_IDS` | Const | IDs de todas las 8 tools |
| `TOOL_REGISTRY` | Const | Registro de getters y mutators |
| `isGetter(name)` | Function | Verifica si un tool name es getter |
| `isMutator(name)` | Function | Verifica si un tool name es mutator |
| `AfwkToolOutput` | Interface | Contrato de output para todas las tools afwk |
| `ToolCallEvidence` | Interface | Evidencia de una tool call para policy gate |
| `LLMResponse` | Interface | Respuesta del LLM con texto y tool calls |
| `StateJson` | Interface | Schema del archivo state.json |
| `generateToolRunId()` | Function | Genera UUID para tool runs (`tr_xxx`) |

**Tool Registry Completo:**
```typescript
AFWK_TOOL_IDS = {
  getKanbanStatus: "afwk_get_kanban_status",
  moveKanbanTask: "afwk_move_kanban_task",
  getSteeringContext: "afwk_get_steering_context",
  validateDevTask: "afwk_validate_devtask",
  createDevTask: "afwk_create_devtask",
  createAiTask: "afwk_create_aitask",
  completeAiTask: "afwk_complete_aitask",
  updateLatestImplementation: "afwk_update_latest_implementation",
}

TOOL_REGISTRY = {
  getters: [
    "afwk_get_kanban_status",
    "afwk_get_steering_context",
    "afwk_validate_devtask",
  ],
  mutators: [
    "afwk_move_kanban_task",
    "afwk_create_devtask",
    "afwk_create_aitask",
    "afwk_complete_aitask",
    "afwk_update_latest_implementation",
  ],
}
```

---

### 2. `classifier.ts` - Clasificador de Intención

**Ubicación:** `packages/opencode/src/afwk/classifier.ts`

**Responsabilidad:** Clasifica el mensaje del usuario en una de tres intenciones usando pattern matching determinista (sin LLM).

**Función principal:**
```typescript
function classifyIntent(userMessage: string): IntentType
```

**Reglas de clasificación:**

| Intent | Patrones | Ejemplo |
|--------|----------|---------|
| `mutation` | Verbos mutantes + ID de tarea + destino | "mueve devTASK-01 a todo" |
| `read` | Preguntas sobre estado | "que hay en el kanban?" |
| `conversation` | Todo lo demás | "hola como estas" |

**Orden de evaluación:** mutation (más específico) → read → conversation (fallback)

**Patrones mutation:**
- `devtask-XX` o `aitask-XX` seguido de destino (`a backlog/todo/in_progress/completed`)
- Verbos: `crea`, `mueve`, `completa`, `actualiza`, `pasa`, `create`, `move`, `complete`

**Patrones read:**
- `que hay`, `cual es el estado`, `muestrame`, `kanban`
- `cuantas tareas`, `how many`, `status`, `list`

---

### 3. `policy-gate.ts` - Validador de Evidencia

**Ubicación:** `packages/opencode/src/afwk/policy-gate.ts`

**Responsabilidad:** Valida que la respuesta del LLM tenga evidencia apropiada según la intención clasificada.

**Función principal:**
```typescript
function policyGate(userIntent: IntentType, llmResponse: LLMResponse): "accept" | "retry"
```

**Reglas de validación:**

| Intent | Requisito | Resultado si no cumple |
|--------|-----------|------------------------|
| `read` | Getter ejecutado | `retry` |
| `mutation` | Mutator ejecutado **O** clarificación válida | `retry` |
| `conversation` | Ninguno | `accept` (siempre) |

**Clarificación válida (para mutation):**
- Texto corto (<300 chars)
- Contiene señales de pregunta (`necesito`, `cual`, `confirma`, `?`)
- NO contiene claims de éxito (`ya quedo`, `completado`, `done`)

---

### 4. `evidence.ts` - Constructor de Evidencia

**Ubicación:** `packages/opencode/src/afwk/evidence.ts`

**Responsabilidad:** Construye `LLMResponse` a partir de `MessageV2.Part[]` para validación con policy gate.

**Función principal:**
```typescript
function buildLLMResponse(parts: MessageV2.Part[]): LLMResponse
```

**Lógica:**
1. Extrae texto de partes tipo `"text"`
2. Extrae tool calls de partes tipo `"tool"`
3. Una tool se considera `executed: true` si `state.status === "completed"` o `"error"`

**Funciones auxiliares:**
- `hasAfwkEvidence(parts)` - Verifica si hay tools afwk ejecutadas
- `getExecutedAfwkTools(parts)` - Extrae solo tools afwk ejecutadas

---

### 5. `state.ts` - Gestión de Estado

**Ubicación:** `packages/opencode/src/afwk/state.ts`

**Responsabilidad:** Persiste evidencia de ejecuciones en disco (`.afwk/state.json`).

**Funciones principales:**

| Función | Descripción |
|---------|-------------|
| `getStateDir()` | Retorna `{project}/.afwk` |
| `getStatePath()` | Retorna `{project}/.afwk/state.json` |
| `isInitialized()` | Verifica si `.afwk` existe |
| `readState()` | Lee state.json o retorna default |
| `writeState(state)` | Escribe state.json |
| `appendToAuditLog(entry)` | Agrega entrada al audit log con rotación FIFO |
| `getPendingActions()` | Obtiene acciones pendientes |

**Schema de state.json:**
```typescript
{
  schema_version: 1,
  pending_actions: PendingAction[],
  audit_log: AuditLogEntry[],
  audit_log_max_entries: 1000
}
```

---

### 6. `tools.ts` - Herramientas del Kanban (8 tools)

**Ubicación:** `packages/opencode/src/afwk/tools.ts`

**Responsabilidad:** Implementa las herramientas que interactúan con el kanban board.

#### Getters (3 tools)

##### `afwk_get_kanban_status`

**Propósito:** Lee el estado actual del kanban.

**Parámetros:** Ninguno

**Output:**
```
## Kanban Status

**Backlog** (0): empty
**Todo** (1): devTASK-01_login
**In Progress** (0): empty
**Completed** (0): empty
```

##### `afwk_get_steering_context`

**Propósito:** Lee el contexto de steering docs de una tarea.

**Parámetros:**
```typescript
{
  taskId: string  // ej: "devTASK-01_login"
}
```

**Output:** Contenido de `overview.md`, `requirements.md`, `design.md` concatenados.

##### `afwk_validate_devtask`

**Propósito:** Valida precondiciones de una devTASK antes de transición.

**Parámetros:**
```typescript
{
  taskId: string,
  targetColumn: KanbanColumn
}
```

**Output:** Lista de archivos requeridos faltantes o confirmación de validación.

#### Mutators (5 tools)

##### `afwk_move_kanban_task`

**Propósito:** Mueve una tarea entre columnas del kanban.

**Parámetros:**
```typescript
{
  taskId: string,
  from: KanbanColumn,
  to: KanbanColumn
}
```

**Validaciones:**
1. `.afwk` debe estar inicializado
2. `from` ≠ `to`
3. La tarea debe existir en la columna origen
4. Transición debe ser válida según `rules.yaml`
5. Archivos requeridos deben existir

##### `afwk_create_devtask`

**Propósito:** Crea una nueva devTASK en backlog.

**Parámetros:**
```typescript
{
  title: string,      // Título descriptivo
  description: string // Descripción de la tarea
}
```

**Acciones:**
1. Genera ID secuencial (`devTASK-XX_slug`)
2. Crea directorio en `kanban/backlog/`
3. Genera `overview.md` desde template
4. Registra en audit log

##### `afwk_create_aitask`

**Propósito:** Crea una aiTASK dentro de una devTASK.

**Parámetros:**
```typescript
{
  parentTaskId: string, // devTASK padre
  title: string,
  description: string
}
```

**Acciones:**
1. Genera ID secuencial dentro del padre
2. Crea `aitasks/aiTASK-XX_slug/`
3. Genera archivos desde templates

##### `afwk_complete_aitask`

**Propósito:** Marca una aiTASK como completada.

**Parámetros:**
```typescript
{
  parentTaskId: string,
  aiTaskId: string,
  summary: string  // Resumen de lo completado
}
```

**Acciones:**
1. Actualiza estado de la aiTASK
2. Registra en audit log
3. Genera postcondiciones

##### `afwk_update_latest_implementation`

**Propósito:** Actualiza `steering/latest-implementation.md` con resumen de implementación.

**Parámetros:**
```typescript
{
  taskId: string,
  implementationSummary: string
}
```

**Acciones:**
1. Escribe/sobrescribe `latest-implementation.md`
2. Registra en audit log

---

### 7. `system-prompt.ts` - Prompt del Sistema

**Ubicación:** `packages/opencode/src/afwk/system-prompt.ts`

**Responsabilidad:** Genera el system prompt que guía al LLM (~500 tokens).

**Función principal:**
```typescript
function generateSystemPrompt(input: SystemPromptInput): string
```

**Input:**
```typescript
{
  projectName: string,
  kanbanCounts: { backlog, todo, in_progress, completed },
  activeTask?: { id, status }
}
```

**Reglas inyectadas al LLM:**
1. Nunca afirmar cambios sin tool execution
2. Llamar `afwk_get_kanban_status` ANTES de responder preguntas de estado
3. Usar tools afwk, no bash/edit para modificar `.afwk/`
4. Pedir clarificación si falta información
5. Explicar errores cuando tools retornan `ok:false`

**Tools documentadas en prompt:**
- `afwk_get_kanban_status` - Get current kanban board state
- `afwk_move_kanban_task` - Move task between columns
- `afwk_get_steering_context` - Get steering docs for a task
- `afwk_validate_devtask` - Validate task preconditions
- `afwk_create_devtask` - Create new devTASK in backlog
- `afwk_create_aitask` - Create aiTASK within devTASK
- `afwk_complete_aitask` - Mark aiTASK as completed
- `afwk_update_latest_implementation` - Update steering/latest-implementation.md

---

### 8. `executor.ts` - Ejecutor con Policy Gate

**Ubicación:** `packages/opencode/src/afwk/executor.ts`

**Responsabilidad:** Envuelve el llamado al LLM con enforcement (usado en tests, la integración real está en processor.ts).

**Función principal:**
```typescript
async function executeWithPolicyGate(input: {
  userMessage: string,
  runAttempt: (systemSuffix?) => Promise<LLMResponse>
}): Promise<GateResult>
```

**Flujo:**
1. Clasifica intención
2. Si `conversation` → ejecuta sin validación
3. Si `read`/`mutation` → ejecuta y valida con policy gate
4. Si falla → retry con suffix hasta MAX_RETRIES (2)
5. Si agota retries → retorna `systemMessage` de error

---

### 9. `integration.ts` - Integración con OpenCode

**Ubicación:** `packages/opencode/src/afwk/integration.ts`

**Responsabilidad:** Funciones helper para integrar el enforcement pipeline en el processor de OpenCode.

**Funciones principales:**

| Función | Descripción |
|---------|-------------|
| `validateResponse(userText, parts)` | Valida respuesta completa, retorna `ValidationResult` |
| `generateRetrySystemSuffix(intent)` | Genera suffix para system prompt en retries |
| `extractUserText(parts)` | Extrae texto del usuario de message parts |
| `isEnforcementEnabled()` | Verifica si afwk está inicializado |

**ValidationResult:**
```typescript
{
  enabled: boolean,    // Si afwk está inicializado
  intent: IntentType,  // Intención clasificada
  valid: boolean,      // Si pasó validación
  reason?: string,     // Razón si falló
  llmResponse?: LLMResponse
}
```

---

### 10. `template-loader.ts` - Cargador de Templates

**Ubicación:** `packages/opencode/src/afwk/template-loader.ts`

**Responsabilidad:** Carga y procesa templates .md para creación de contenido.

**Funciones principales:**

| Función | Descripción |
|---------|-------------|
| `loadTemplate(name)` | Carga template desde `.afwk/templates/` |
| `processTemplate(content, vars)` | Reemplaza variables `{{var}}` |
| `getTemplatesDir()` | Retorna path a templates |

**Templates soportados:**
- `devtask-overview.md` - Para crear devTASK overview
- `aitask-spec.md` - Para crear aiTASK specification

---

### 11. `rules-engine.ts` - Motor de Reglas YAML

**Ubicación:** `packages/opencode/src/afwk/rules-engine.ts`

**Responsabilidad:** Carga y valida reglas de transición desde `.afwk/rules.yaml`.

**Funciones principales:**

| Función | Descripción |
|---------|-------------|
| `loadRules()` | Carga rules.yaml (throws si no existe) |
| `clearRulesCache()` | Limpia caché para recargar |
| `validateTransition(from, to)` | Valida si transición está permitida |
| `getTransitionRequirements(from, to)` | Obtiene archivos requeridos |
| `isTransitionDefined(from, to)` | Verifica si transición existe |
| `getTransitionRules()` | Obtiene todas las reglas |

**Schema de rules.yaml:**
```yaml
version: 1

transitions:
  backlog_to_todo:
    from: backlog
    to: todo
    requires:
      - overview.md
      - requirements.md
    severity: error

  todo_to_in_progress:
    from: todo
    to: in_progress
    requires:
      - design.md
    severity: warning

validations:
  file_exists:
    pattern: "*.md"
    message: "Required file missing"

naming:
  devtask: "devTASK-{id}_{slug}"
  aitask: "aiTASK-{id}_{slug}"
```

**Comportamiento:**
- **Sin defaults:** Si no existe rules.yaml, throws error con mensaje claro
- **Caché:** Rules se cachean por path para eficiencia
- **Async:** Todas las funciones son async

---

### 12. `security-hooks.ts` - Hooks de Seguridad

**Ubicación:** `packages/opencode/src/afwk/security-hooks.ts`

**Responsabilidad:** Bloquea acceso directo a `.afwk/` via tools nativas (bash, edit, write).

**Plugin:** `AfwkSecurityPlugin`

**Hook:** `tool.execute.before`

**Lógica de seguridad:**

```
┌─────────────────────────────────────────────────────────────┐
│                 Security Hook Flow                           │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Tool execution request                                      │
│         │                                                    │
│         ▼                                                    │
│  Is afwk_* tool? ──YES──► ALLOW (official interface)        │
│         │                                                    │
│         NO                                                   │
│         │                                                    │
│         ▼                                                    │
│  Is bash/Bash?                                              │
│         │                                                    │
│    ┌────┴────┐                                              │
│    │ YES     │ NO                                           │
│    ▼         ▼                                              │
│  Contains   Is edit/write?                                  │
│  .afwk?         │                                           │
│    │       ┌────┴────┐                                      │
│    │       │ YES     │ NO                                   │
│    │       ▼         ▼                                      │
│    │     Path has   ALLOW                                   │
│    │     .afwk?                                             │
│    │       │                                                │
│    ▼       ▼                                                │
│  Read-only? ──YES──► ALLOW (cat, ls, grep, etc.)           │
│    │                                                        │
│    NO                                                       │
│    │                                                        │
│    ▼                                                        │
│  BLOCK with AfwkSecurityError                               │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

**Comandos bloqueados:**
- `rm -rf .afwk/`
- `mv file.txt .afwk/`
- `cp file.txt .afwk/`
- `echo "x" > .afwk/file.json`
- `cat foo > .afwk/bar` (redirect)
- `echo test | tee .afwk/file` (pipe)
- `edit .afwk/rules.yaml`
- `write .afwk/state.json`

**Comandos permitidos:**
- `cat .afwk/state.json` (read-only)
- `ls .afwk/` (read-only)
- `grep pattern .afwk/` (read-only)
- `head/tail .afwk/file` (read-only)
- `afwk_*` tools (interface oficial)

**Funciones exportadas:**
```typescript
// Plugin para registrar en INTERNAL_PLUGINS
AfwkSecurityPlugin(input: PluginInput): Promise<Hooks>

// Error específico
class AfwkSecurityError extends Error {
  tool: string
  operation: string
}

// Helpers para testing
isDestructiveAfwkCommand(command: string): boolean
isAfwkPath(filePath: string): boolean
```

---

### 13. Integración en `processor.ts`

**Ubicación:** `packages/opencode/src/session/processor.ts`

**Responsabilidad:** Punto de integración real donde el enforcement se ejecuta en cada turno del LLM.

**Variables de módulo:**
```typescript
const AFWK_MAX_RETRIES = 2
const afwkTurnParts = new Map<string, MessageV2.Part[]>()
```

**Flujo de validación:**

```
┌─────────────────────────────────────────────────────────────┐
│                    AFWK Validation Flow                      │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  1. LLM Stream completa                                      │
│         │                                                    │
│         ▼                                                    │
│  2. Acumular parts del step actual en afwkTurnParts         │
│         │                                                    │
│         ▼                                                    │
│  3. ¿finishReason === "tool-calls"?                         │
│         │                                                    │
│    ┌────┴────┐                                               │
│    │ YES     │ NO                                            │
│    ▼         ▼                                               │
│  return    4. Validar con evidencia agregada                │
│ "continue"    │                                              │
│               ▼                                              │
│         5. ¿validation.valid?                                │
│               │                                              │
│          ┌────┴────┐                                         │
│          │ YES     │ NO                                      │
│          ▼         ▼                                         │
│      Limpiar    6. ¿retryCount < MAX?                       │
│      cache         │                                         │
│      return   ┌────┴────┐                                    │
│    "continue" │ YES     │ NO                                 │
│               ▼         ▼                                    │
│           Agregar    Agregar                                 │
│           indicador  warning                                 │
│           "⟳"        "⚠️"                                    │
│           continue   return "stop"                           │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

**Características clave:**
- **Evidencia agregada:** Acumula parts de todos los steps del turno
- **Validación en step final:** Solo valida cuando `finish ≠ "tool-calls"`
- **Indicador visual de retry:** Muestra "⟳ *Reintentando con herramienta requerida...*"
- **Hard fail con warning:** Muestra "⚠️ **aiFRAMEWORK**: {reason}"

---

### 14. Integración en `system.ts`

**Ubicación:** `packages/opencode/src/session/system.ts`

**Función:** `SystemPrompt.afwk()`

**Responsabilidad:** Inyecta el system prompt de aiFRAMEWORK si está inicializado.

**Flujo:**
1. Verifica `isAfwkInitialized()`
2. Lee conteos del kanban desde `.afwk/kanban/{column}/`
3. Genera prompt con `generateSystemPrompt()`
4. Retorna como parte del system prompt del LLM

---

### 15. Integración en `plugin/index.ts`

**Ubicación:** `packages/opencode/src/plugin/index.ts`

**Responsabilidad:** Registra `AfwkSecurityPlugin` como plugin interno.

```typescript
const INTERNAL_PLUGINS: PluginInstance[] = [
  CodexAuthPlugin,
  AfwkSecurityPlugin,  // Security hooks for .afwk/
]
```

---

## Estructura de Archivos `.afwk/`

```
.afwk/
├── state.json                    # Estado persistente (audit log, pending actions)
├── rules.yaml                    # Reglas de transición declarativas
├── templates/                    # Templates para creación de contenido
│   ├── devtask-overview.md
│   └── aitask-spec.md
├── steering/                     # Documentos de steering globales
│   └── latest-implementation.md
└── kanban/
    ├── backlog/
    │   └── devTASK-01_feature/
    │       ├── overview.md
    │       ├── requirements.md
    │       ├── design.md
    │       └── aitasks/
    │           └── aiTASK-01_subtask/
    ├── todo/
    ├── in_progress/
    └── completed/
```

---

## Flujo Completo de una Interacción

### Ejemplo: "que hay en el kanban?"

```
1. Usuario envía: "que hay en el kanban?"

2. System prompt incluye reglas de aiFRAMEWORK

3. LLM responde SIN llamar herramienta:
   "No hay tareas pendientes..."
   finish: "stop"

4. Processor acumula parts, detecta step final

5. validateResponse():
   - classifyIntent() → "read"
   - buildLLMResponse() → { text: "...", toolCalls: [] }
   - policyGate("read", response) → "retry" (no getter)

6. Retry 1:
   - Agrega "⟳ *Reintentando...*"
   - Agrega suffix al system prompt
   - LLM re-ejecuta, AHORA llama afwk_get_kanban_status
   - finish: "tool-calls"

7. Processor acumula parts (ahora incluye tool)
   return "continue"

8. LLM continúa con texto final:
   "El kanban tiene 1 tarea in in_progress..."
   finish: "stop"

9. validateResponse() con evidencia agregada:
   - toolCalls: [{ name: "afwk_get_kanban_status", executed: true }]
   - policyGate("read", response) → "accept"

10. Validation PASSED, respuesta mostrada al usuario
```

### Ejemplo: "mueve devTASK-01 a in_progress"

```
1. Usuario envía: "mueve devTASK-01 a in_progress"

2. classifyIntent() → "mutation"

3. LLM intenta llamar afwk_move_kanban_task

4. Security hook verifica: es afwk_* tool → ALLOW

5. Tool ejecuta:
   - loadRules() → Carga rules.yaml
   - getTransitionRequirements("todo", "in_progress") → ["design.md"]
   - Verifica que design.md existe
   - Si falta → retorna error con archivos requeridos
   - Si existe → mueve directorio, registra audit log

6. policyGate("mutation", response) → "accept" (mutator ejecutado)

7. Respuesta mostrada al usuario
```

### Ejemplo: Intento de bypass via bash

```
1. Usuario o LLM intenta: bash "rm -rf .afwk/"

2. Security hook intercepta tool.execute.before

3. isDestructiveAfwkCommand("rm -rf .afwk/") → true

4. Throws AfwkSecurityError:
   "Cannot modify .afwk/ via bash. Use afwk_* tools instead."

5. Tool call bloqueada, error mostrado
```

---

## Tests

**Ubicación:** `packages/opencode/src/afwk/__tests__/`

| Archivo | Tests | Descripción |
|---------|-------|-------------|
| `classifier.test.ts` | 20 | Patrones de clasificación |
| `policy-gate.test.ts` | 15 | Reglas de validación |
| `evidence.test.ts` | 12 | Construcción de evidencia |
| `executor.test.ts` | 10 | Flujo de retry |
| `system-prompt.test.ts` | 8 | Generación de prompts |
| `enforcement-smoke.test.ts` | 15 | Integración end-to-end |
| `tools.test.ts` | 45 | Tests de las 8 herramientas |
| `rules-engine.test.ts` | 35 | Motor de reglas YAML |
| `security-hooks.test.ts` | 40 | Hooks de seguridad |
| `state.test.ts` | 7 | Gestión de estado |

**Total:** 207 tests, 0 failures

---

## Configuración

El framework se activa automáticamente si existe el directorio `.afwk/` en el proyecto.

### Inicialización manual:
```bash
mkdir -p .afwk/kanban/{backlog,todo,in_progress,completed}
mkdir -p .afwk/templates
mkdir -p .afwk/steering
```

### rules.yaml requerido:
```yaml
version: 1

transitions:
  backlog_to_todo:
    from: backlog
    to: todo
    requires:
      - overview.md
    severity: error

  todo_to_in_progress:
    from: todo
    to: in_progress
    requires:
      - requirements.md
      - design.md
    severity: error

  in_progress_to_completed:
    from: in_progress
    to: completed
    requires: []
    severity: warning

validations:
  file_exists:
    pattern: "*.md"
    message: "Required steering document missing"

naming:
  devtask: "devTASK-{id}_{slug}"
  aitask: "aiTASK-{id}_{slug}"
```

---

## Extensiones Futuras (Post-MVP)

Items diferidos para futuras versiones:

- `afwk_dry_run` - Simular operación sin ejecutar
- `afwk_init_project` - Crear estructura .afwk/ completa
- `afwk_generate_daily_summary` - DDPN (Daily Development Progress Notes)
- Procesamiento UI de `pending_actions`
- Motor de reglas sofisticado (AND/OR, severidad, i18n)
- Semantic correctness (verificar coherencia texto-resultado)

---

## Checklist de Validación

### Clasificador de Intención
- [x] Clasifica mutation correctamente
- [x] Clasifica read correctamente
- [x] Fallback a conversation

### Policy Gate
- [x] Acepta mutation con tool ejecutada
- [x] Acepta mutation con clarificación
- [x] Rechaza mutation sin tool
- [x] Acepta read con getter
- [x] Rechaza read sin getter
- [x] Siempre acepta conversation

### Tools
- [x] Todas las tools retornan AfwkToolOutput
- [x] tool_run_id es único
- [x] changes[] incluye archivos modificados (paths relativos)
- [x] errors[] tiene mensajes claros
- [x] Audit log en todas las operaciones (incluso early returns)

### State
- [x] state.json tiene schema_version: 1
- [x] Audit log persiste
- [x] Audit log rota (FIFO 1000 entries)
- [x] pending_actions se encolan

### System Prompt
- [x] < 500 tokens
- [x] Incluye conteos kanban
- [x] Incluye reglas
- [x] Lista todas las 8 tools

### Rules Engine
- [x] Carga rules.yaml
- [x] Throws error si no existe (sin defaults)
- [x] Valida transiciones
- [x] Retorna archivos requeridos

### Security Hooks
- [x] Bloquea `rm -rf .afwk/`
- [x] Bloquea `echo "x" > .afwk/file`
- [x] Bloquea `edit .afwk/rules.yaml`
- [x] Bloquea redirects a .afwk
- [x] Bloquea pipes a .afwk (tee)
- [x] No bloquea lectura (cat, ls, grep)
- [x] No bloquea afwk_* tools
