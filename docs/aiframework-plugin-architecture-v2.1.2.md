# aiFRAMEWORK Plugin - Arquitectura de Implementación v2.1.2

**Versión:** 2.1.2 (Precisión de Redacción)  
**Fecha:** 20 enero 2026  
**Autores:** Santiago Robles (con validación cruzada Claude + ChatGPT)  
**Status:** ✅ Aprobado para implementación

---

## Tabla de Contenidos

1. [Resumen Ejecutivo](#1-resumen-ejecutivo)
2. [Diagrama de Arquitectura](#2-diagrama-de-arquitectura)
3. [Clasificador de Intención](#3-clasificador-de-intención)
4. [Tool Registry](#4-tool-registry)
5. [Contrato de Output para Tools](#5-contrato-de-output-para-tools)
6. [Policy Gate](#6-policy-gate)
7. [Estado Persistente (state.json)](#7-estado-persistente-statejson)
8. [System Prompt](#8-system-prompt)
9. [Postcondiciones](#9-postcondiciones)
10. [Rules.yaml](#10-rulesyaml)
11. [Hooks de Seguridad](#11-hooks-de-seguridad)
12. [Orden de Implementación](#12-orden-de-implementación)
13. [Checklist de Validación](#13-checklist-de-validación)
14. [Decisiones de Diseño](#14-decisiones-de-diseño)
15. [Changelog](#15-changelog)

---

## 1. Resumen Ejecutivo

### Problema

Un LLM con acceso a tools puede:
- Afirmar cambios sin ejecutar tools (alucinación)
- Usar tools nativas (bash, edit) para modificar `.afwk/` directamente
- Responder con información stale sin consultar el estado actual
- Ignorar validaciones del framework

### Solución

Arquitectura de **enforcement real** con 4 capas:

| Capa | Función |
|------|---------|
| **Clasificador de Intención** | Determina si el mensaje requiere tool (mutation/read/conversation) |
| **System Prompt** | Contexto compacto + reglas de comportamiento |
| **Policy Gate** | Valida que la respuesta tenga evidencia (tool ejecutada o clarificación) |
| **Hooks** | Bloquea acceso directo a `.afwk/` vía tools nativas |

### Principios Clave

1. **No afirmes cambios sin tool ejecutada:** El LLM nunca debe declarar mutaciones sin una tool ejecutada (con output `ok:true` u `ok:false`)
2. **Read requiere getter:** Preguntas sobre estado siempre pasan por el getter apropiado (`getKanbanStatus` para kanban, `getSteeringContext` para steering, `validateDevTask` para validación)
3. **Tools atómicas:** Cada tool hace una operación completa con validaciones integradas
4. **Evidencia siempre:** `ok:false` también es evidencia válida (evita loops)
5. **Estado persistente:** Audit log y pending actions en `state.json`

---

## 2. Diagrama de Arquitectura

```
┌─────────────────────────────────────────────────────────────────┐
│                         USUARIO                                 │
│                            │                                    │
│                            ▼                                    │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │         CLASIFICADOR DE INTENCIÓN (determinista)        │   │
│  │                                                         │   │
│  │  mutation: verbo mutante + ID/entidad + destino         │   │
│  │  read: pregunta sobre estado → getter OBLIGATORIO       │   │
│  │  conversation: todo lo demás                            │   │
│  └─────────────────────────────────────────────────────────┘   │
│                            │                                    │
│                            ▼                                    │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │         SYSTEM PROMPT (COMPACTO ~500 tokens)            │   │
│  │                                                         │   │
│  │  • Snapshot kanban (counts only)                        │   │
│  │  • Reglas de comportamiento                             │   │
│  │  • Lista de tools disponibles                           │   │
│  └─────────────────────────────────────────────────────────┘   │
│                            │                                    │
│                            ▼                                    │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                        LLM                              │   │
│  └─────────────────────────────────────────────────────────┘   │
│                            │                                    │
│                            ▼                                    │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │              POLICY GATE (state-aware)                  │   │
│  │                                                         │   │
│  │  mutation: accept con tool ejecutada o clarificación    │   │
│  │  read: accept solo con getter ejecutado                 │   │
│  │  conversation: accept libre                             │   │
│  └─────────────────────────────────────────────────────────┘   │
│                            │                                    │
│            ┌───────────────┴───────────────┐                   │
│            ▼                               ▼                   │
│  ┌──────────────────────┐     ┌──────────────────────┐        │
│  │    TOOLS afwk:*      │     │   TOOLS NATIVAS      │        │
│  │                      │     │   (bash, edit)       │        │
│  │  Input: Zod schema   │     │         │            │        │
│  │  Output: contrato v1 │     │         ▼            │        │
│  │                      │     │   ┌───────────┐      │        │
│  │  Getters:            │     │   │   HOOK    │      │        │
│  │  • getKanbanStatus   │     │   │ (bloquea  │      │        │
│  │  • getSteeringContext│     │   │  .afwk/)  │      │        │
│  │                      │     │   └───────────┘      │        │
│  │  Mutators:           │     └──────────────────────┘        │
│  │  • moveKanbanTask    │                                      │
│  │  • createDevTask     │                                      │
│  │  • createAiTask      │                                      │
│  │  • completeAiTask    │                                      │
│  └──────────────────────┘                                      │
│            │                                                    │
│            ▼                                                    │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                      .afwk/                              │   │
│  │  ├── rules.yaml      (checks declarativos)              │   │
│  │  ├── state.json      (pending_actions + audit_log)      │   │
│  │  ├── templates/      (plantillas de archivos)           │   │
│  │  ├── steering/       (docs de gobernanza)               │   │
│  │  └── kanban/         (estado de tareas)                 │   │
│  │       ├── backlog/                                       │   │
│  │       ├── todo/                                          │   │
│  │       ├── in_progress/                                   │   │
│  │       └── completed/                                     │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

---

## 3. Clasificador de Intención

### Propósito

Determinar **antes** de enviar al LLM si el mensaje del usuario requiere una tool. Esto permite:
- Reducir retries del Policy Gate
- Dar contexto específico al LLM
- Validar la respuesta apropiadamente

### Tipos de Intención

| Tipo | Descripción | Requisito |
|------|-------------|-----------|
| `mutation` | Usuario quiere modificar estado | Tool mutadora ejecutada o clarificación |
| `read` | Usuario pregunta sobre estado | Tool getter ejecutada (ver mapeo abajo) |
| `conversation` | Todo lo demás | Libre |

### Mapeo Read → Getter Específico

| Tipo de pregunta | Getter requerido | Ejemplos |
|------------------|------------------|----------|
| Estado del kanban | `afwk:getKanbanStatus` | "qué hay en todo", "cuántas tareas tengo", "estado del kanban" |
| Contenido de steering docs | `afwk:getSteeringContext` | "cuál es la arquitectura", "muéstrame el tech.md" |
| Validación de estructura | `afwk:validateDevTask` | "está bien estructurado el devTASK-01", "valida la tarea" |

**Nota:** El clasificador de intención detecta `read`, pero el LLM decide qué getter usar según el contexto. El Policy Gate valida que se haya ejecutado **algún** getter registrado.

### Implementación

```typescript
type IntentType = 'mutation' | 'read' | 'conversation';

function classifyIntent(userMessage: string): IntentType {
  // MUTATION: verbo mutante + ID de entidad o destino explícito
  const mutationPatterns = [
    // Patrón con ID explícito: "mueve devTASK-01 a in_progress"
    /\b(devtask-\d{2}|aitask-\d{2})[_\w-]*\b.*\b(a|to|hacia)\s*(backlog|todo|in_progress|completed)\b/i,
    
    // Verbo mutante + "tarea/task" + hasta 50 chars + destino
    /\b(crea|crear|mueve|mover|completa|completar|actualiza|actualizar|pasa|pasar)\b.{0,50}\b(tarea|task|devtask|aitask)\b.{0,30}\b(a|to|hacia)\s*(backlog|todo|in_progress|completed)\b/i,
    
    // Verbo mutante + entidad directa (sin destino, para create/complete)
    /\b(crea|crear|completa|completar|inicializa)\b.{0,30}\b(devtask|aitask|tarea|task)\b/i,
    
    // Inglés con ID
    /\b(create|move|complete|update|initialize|start|finish)\b.{0,30}\b(devtask-\d{2}|aitask-\d{2})\b/i,
  ];
  
  // READ: preguntas sobre estado
  const readPatterns = [
    /\b(qué hay|cuál es el estado|estado del|lista de|cuántos?|muéstrame|kanban)\b/i,
    /\b(show me|what'?s|status|list|how many|pending|current state)\b/i,
    /\b(tareas?|tasks?|devtasks?)\s+(en|in|pendientes?|activas?|actuales?)\b/i,
  ];
  
  if (mutationPatterns.some(p => p.test(userMessage))) return 'mutation';
  if (readPatterns.some(p => p.test(userMessage))) return 'read';
  return 'conversation';
}
```

### Ejemplos de Clasificación

| Input | Intent | Razón |
|-------|--------|-------|
| "mueve devTASK-01_login a in_progress" | `mutation` | Verbo + ID + destino |
| "crea una nueva tarea para login" | `mutation` | Verbo crear + entidad |
| "qué hay en todo" | `read` | Pregunta sobre estado |
| "cuántas tareas tengo pendientes" | `read` | Pregunta cuantitativa |
| "el completed tiene 5 tareas" | `conversation` | Afirmación, no comando |
| "explícame cómo funciona el kanban" | `conversation` | Solicitud de explicación |

---

## 4. Tool Registry

### Propósito

Mapa estático que clasifica tools como **getters** (lectura) o **mutators** (escritura). El Policy Gate usa esto para validar que la respuesta tenga el tipo correcto de evidencia.

### Implementación

```typescript
const TOOL_REGISTRY = {
  getters: [
    'afwk:getKanbanStatus',
    'afwk:getSteeringContext',
    'afwk:validateDevTask',  // read-only validation
  ],
  mutators: [
    'afwk:moveKanbanTask',
    'afwk:createDevTask',
    'afwk:createAiTask',
    'afwk:completeAiTask',
    'afwk:updateLatestImplementation',
  ]
} as const;

// NOTA: Las tools deferred (initProject, generateDailySummary) 
// NO están en el registry hasta que se implementen.
// Agregarlas aquí cuando se habiliten para que el Policy Gate las reconozca.

type GetterTool = typeof TOOL_REGISTRY.getters[number];
type MutatorTool = typeof TOOL_REGISTRY.mutators[number];

function isGetter(toolName: string): toolName is GetterTool {
  return TOOL_REGISTRY.getters.includes(toolName as GetterTool);
}

function isMutator(toolName: string): toolName is MutatorTool {
  return TOOL_REGISTRY.mutators.includes(toolName as MutatorTool);
}
```

### Tools por Implementar

#### Getters (Lectura)

| Tool | Descripción | Prioridad |
|------|-------------|-----------|
| `afwk:getKanbanStatus` | Estado actual del kanban con conteos y lista de tareas | ✅ Implementado |
| `afwk:getSteeringContext` | Contenido de steering docs para contexto | Media |
| `afwk:validateDevTask` | Validar estructura de un devTASK (read-only) | Media |

#### Mutators (Escritura)

| Tool | Descripción | Prioridad | En Registry |
|------|-------------|-----------|-------------|
| `afwk:moveKanbanTask` | Mover devTASK entre columnas con validaciones | ✅ Implementado | ✅ Sí |
| `afwk:createDevTask` | Crear nuevo devTASK en backlog | Alta | ✅ Sí |
| `afwk:createAiTask` | Crear aiTASK blueprint desde template | Alta | ✅ Sí |
| `afwk:completeAiTask` | Agregar completion notes a un aiTASK | Alta | ✅ Sí |
| `afwk:updateLatestImplementation` | Actualizar steering/latest-implementation.md | Media | ✅ Sí |
| `afwk:initProject` | Crear estructura .afwk/ en proyecto nuevo | Deferred | ⏸️ No (agregar al implementar) |
| `afwk:generateDailySummary` | Generar resumen DDPN del día | Deferred | ⏸️ No (agregar al implementar) |

**Importante:** Las tools marcadas como "Deferred" no están en `TOOL_REGISTRY` hasta que se implementen. El Policy Gate no las reconocerá hasta entonces.

---

## 5. Contrato de Output para Tools

### Propósito

Todas las tools `afwk:*` deben retornar un schema estandarizado. Esto permite:
- Auditoría consistente
- Validación en Policy Gate
- Debugging sin ambigüedad
- Trazabilidad con `tool_run_id`

### Schema

```typescript
interface AfwkToolOutput {
  /** Indica si la operación fue exitosa */
  ok: boolean;
  
  /** UUID único para esta ejecución (para trazabilidad) */
  tool_run_id: string;
  
  /** Referencias a entidades afectadas */
  entity_refs?: {
    devTaskId?: string;
    aiTaskId?: string;
  };
  
  /** Lista de cambios realizados */
  changes: Array<{
    /** Ruta relativa al archivo/carpeta afectado */
    path: string;
    /** Tipo de operación */
    type: 'create' | 'update' | 'move' | 'delete';
    /** Descripción legible del cambio */
    summary: string;
  }>;
  
  /** Advertencias (no bloquean, pero informan) */
  warnings: string[];
  
  /** Errores (si ok:false, explican qué falló) */
  errors: string[];
}
```

### Ejemplo: moveKanbanTask

```typescript
// Input
{
  taskId: "devTASK-01_login",
  from: "todo",
  to: "in_progress"
}

// Output exitoso
{
  ok: true,
  tool_run_id: "tr_a1b2c3d4-5678-90ab-cdef",
  entity_refs: { 
    devTaskId: "devTASK-01_login" 
  },
  changes: [
    { 
      path: "kanban/in_progress/devTASK-01_login", 
      type: "move", 
      summary: "Moved from todo to in_progress" 
    },
    { 
      path: "kanban/in_progress/devTASK-01_login/devTASK.json", 
      type: "update", 
      summary: "Updated status field to 'in_progress'" 
    }
  ],
  warnings: [],
  errors: []
}

// Output con error
{
  ok: false,
  tool_run_id: "tr_b2c3d4e5-6789-01ab-cdef",
  entity_refs: { 
    devTaskId: "devTASK-01_login" 
  },
  changes: [],
  warnings: [],
  errors: [
    "Cannot move to in_progress: devTASK requires at least 1 aiTASK blueprint"
  ]
}
```

### Generación de tool_run_id

```typescript
import { randomUUID } from 'crypto';

function generateToolRunId(): string {
  return `tr_${randomUUID()}`;
}
```

---

## 6. Policy Gate

### Propósito

Validar que la respuesta del LLM tenga **evidencia apropiada** según la intención del usuario. Si no la tiene, forzar retry o rechazar.

### Reglas

| Intent | Condición de Accept | Condición de Retry |
|--------|--------------------|--------------------|
| `mutation` | Tool mutadora ejecutada (ok:true o ok:false) **O** clarificación robusta | Sin tool y sin clarificación |
| `read` | Tool getter ejecutada | Sin getter |
| `conversation` | Siempre | Nunca |

**Nota importante:** `ok:false` también es evidencia válida. El LLM debe explicar el error, pero no entra en loop de retry.

### Detector de Clarificación

```typescript
function isClarificationResponse(text: string): boolean {
  const clarificationSignals = [
    /\b(necesito|falta|cuál|qué|confirma|especifica|desde|hasta)\b/i,
    /\b(which|what|need|missing|confirm|specify|from|to)\b/i,
    /\b(no (puedo|tengo)|can'?t|don'?t have)\b/i,
    /\?\s*$/,  // Pregunta al final (complementario)
  ];
  
  // Claims de ÉXITO (no de intención o error)
  const successClaims = [
    /\b(ya (quedó|está listo|se movió|se creó|completado))\b/i,
    /\b(done|completed successfully|moved successfully|created)\b/i,
  ];
  
  const hasSignal = clarificationSignals.some(p => p.test(text));
  const isShort = text.length < 300;
  const noSuccessClaim = !successClaims.some(p => p.test(text));
  
  return hasSignal && isShort && noSuccessClaim;
}
```

### Implementación Completa

```typescript
interface ToolCall {
  name: string;
  output?: AfwkToolOutput;
  executed: boolean;  // true si la tool corrió (aunque haya fallado)
}

interface LLMResponse {
  text: string;
  toolCalls?: ToolCall[];
}

async function policyGate(
  userIntent: IntentType,
  llmResponse: LLMResponse
): Promise<'accept' | 'retry'> {
  
  // Buscar tools ejecutadas por tipo
  const executedGetter = llmResponse.toolCalls?.find(
    tc => tc.executed && isGetter(tc.name)
  );
  
  const executedMutator = llmResponse.toolCalls?.find(
    tc => tc.executed && isMutator(tc.name)
  );
  
  // READ: requiere getter ejecutado
  if (userIntent === 'read') {
    if (executedGetter) return 'accept';
    return 'retry';
  }
  
  // MUTATION: requiere mutator ejecutado O clarificación robusta
  if (userIntent === 'mutation') {
    // Tool ejecutada = evidencia (aunque ok:false)
    if (executedMutator) return 'accept';
    // Clarificación robusta sin tool
    if (isClarificationResponse(llmResponse.text)) return 'accept';
    return 'retry';
  }
  
  // CONVERSATION: libre
  return 'accept';
}
```

### Manejo de Retry

```typescript
const MAX_RETRIES = 2;

interface GateResult {
  success: boolean;
  response?: LLMResponse;
  systemMessage?: string;
}

async function executeWithPolicyGate(
  userMessage: string,
  llm: LLMClient
): Promise<GateResult> {
  const intent = classifyIntent(userMessage);
  let lastResponse: LLMResponse | undefined;
  
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    lastResponse = await llm.generate(userMessage, {
      // En retry, agregar hint al prompt
      systemSuffix: attempt > 0 
        ? `\n\n[SYSTEM: Previous response lacked required tool execution. For ${intent} intent, you MUST use the appropriate afwk:* tool.]`
        : undefined
    });
    
    const decision = await policyGate(intent, lastResponse);
    
    if (decision === 'accept') {
      return { success: true, response: lastResponse };
    }
    
    console.warn(`Policy gate retry ${attempt + 1}/${MAX_RETRIES} for intent: ${intent}`);
  }
  
  // HARD FAIL: No se acepta respuesta sin evidencia
  // El sistema responde, NO el LLM
  console.error(`Policy gate enforcement: rejected after ${MAX_RETRIES} retries`);
  
  const systemMessages: Record<IntentType, string> = {
    mutation: 'No pude ejecutar la operación porque el modelo no usó las herramientas requeridas. Por favor reformula tu solicitud especificando claramente qué tarea quieres modificar (ej: "mueve devTASK-01_login a in_progress").',
    read: 'No pude obtener el estado actual porque el modelo no consultó las herramientas requeridas. Por favor pregunta de nuevo (ej: "muéstrame el estado del kanban").',
    conversation: '' // Never reaches here
  };
  
  return { 
    success: false, 
    systemMessage: systemMessages[intent]
  };
}
```

---

## 7. Estado Persistente (state.json)

### Propósito

Persistir:
- **pending_actions:** Acciones encoladas que requieren intervención posterior
- **audit_log:** Historial de ejecuciones de tools para debugging y trazabilidad

### Schema

```typescript
interface PendingAction {
  id: string;
  type: string;
  context: Record<string, unknown>;
  created_at: string;  // ISO 8601
  status: 'pending' | 'completed' | 'skipped';
}

interface AuditLogEntry {
  tool_run_id: string;
  timestamp: string;  // ISO 8601
  tool: string;
  entity_refs?: { devTaskId?: string; aiTaskId?: string };
  input: Record<string, unknown>;
  output_ok: boolean;
  changes: Array<{
    path: string;
    type: 'create' | 'update' | 'move' | 'delete';
    summary: string;
  }>;
  errors: string[];
}

interface StateJson {
  schema_version: number;
  pending_actions: PendingAction[];
  audit_log: AuditLogEntry[];
  audit_log_max_entries: number;
}
```

### Ejemplo

```json
{
  "schema_version": 1,
  "pending_actions": [
    {
      "id": "pa_001",
      "type": "update_latest_implementation",
      "context": { 
        "devTaskId": "devTASK-01_login",
        "triggered_by_tool_run": "tr_a1b2c3d4-5678-90ab-cdef"
      },
      "created_at": "2026-01-20T10:00:00Z",
      "status": "pending"
    }
  ],
  "audit_log": [
    {
      "tool_run_id": "tr_a1b2c3d4-5678-90ab-cdef",
      "timestamp": "2026-01-20T10:05:00Z",
      "tool": "afwk:moveKanbanTask",
      "entity_refs": { "devTaskId": "devTASK-01_login" },
      "input": { 
        "taskId": "devTASK-01_login", 
        "from": "todo", 
        "to": "in_progress" 
      },
      "output_ok": true,
      "changes": [
        { 
          "path": "kanban/in_progress/devTASK-01_login", 
          "type": "move", 
          "summary": "Moved from todo to in_progress" 
        },
        { 
          "path": "kanban/in_progress/devTASK-01_login/devTASK.json", 
          "type": "update", 
          "summary": "Updated status field" 
        }
      ],
      "errors": []
    }
  ],
  "audit_log_max_entries": 1000
}
```

### Rotación de Audit Log

```typescript
function appendToAuditLog(state: StateJson, entry: AuditLogEntry): void {
  state.audit_log.push(entry);
  
  // FIFO rotation
  while (state.audit_log.length > state.audit_log_max_entries) {
    state.audit_log.shift();
  }
}
```

### Sanitización

No guardar en `input` ni `context`:
- Tokens de API
- Contraseñas
- Rutas absolutas del sistema
- Información personal sensible

---

## 8. System Prompt

### Principios

1. **Compacto:** ~500 tokens máximo
2. **Snapshot, no detalle:** Solo conteos, no listas completas
3. **Reglas claras:** Comportamiento esperado del LLM
4. **Tools listadas:** Para que el LLM sepa qué tiene disponible

### Template

```markdown
## aiFRAMEWORK Context

**Project:** {{project_name}}
**Kanban:** {{backlog_count}} backlog | {{todo_count}} todo | {{in_progress_count}} in_progress | {{completed_count}} completed
{{#if active_task}}
**Active:** {{active_task.id}} ({{active_task.status}})
{{/if}}

## Rules

1. **Never claim state changes without tool execution.** If you say "moved" or "created", there MUST be an afwk:* tool call with `ok:true` in this turn.

2. **For ANY question about kanban/task state, call afwk:getKanbanStatus BEFORE answering.** Do not rely on the snapshot above for detailed queries.

3. **Use the appropriate afwk:* tool for operations.** Do not use bash or edit to modify .afwk/ directly.

4. **If you lack information to complete an operation, ask for clarification.** It's better to ask "which devTASK?" than to guess.

5. **When a tool returns ok:false, explain the error clearly.** Do not claim success.

## Available Tools

### Getters (Read)
- `afwk:getKanbanStatus` - Read current kanban state (REQUIRED for state questions)
- `afwk:getSteeringContext` - Read steering docs for project context

### Mutators (Write)
- `afwk:moveKanbanTask` - Move task between columns (validates rules automatically)
- `afwk:createDevTask` - Create new devTASK in backlog
- `afwk:createAiTask` - Create aiTASK blueprint from template
- `afwk:completeAiTask` - Add completion notes to aiTASK
```

### Generación Dinámica

```typescript
function generateSystemPrompt(projectState: ProjectState): string {
  const kanbanCounts = projectState.kanban.getCounts();
  const activeTask = projectState.kanban.getActiveTask();
  
  return `## aiFRAMEWORK Context

**Project:** ${projectState.name}
**Kanban:** ${kanbanCounts.backlog} backlog | ${kanbanCounts.todo} todo | ${kanbanCounts.in_progress} in_progress | ${kanbanCounts.completed} completed
${activeTask ? `**Active:** ${activeTask.id} (${activeTask.status})` : ''}

## Rules
...
`;
}
```

---

## 9. Postcondiciones

### Tipos

| Tipo | Comportamiento | Cuándo usar |
|------|----------------|-------------|
| **Automática** | Se ejecuta dentro de la tool, sin intervención | Operaciones determinísticas y seguras |
| **Enqueued** | Se registra en `pending_actions` | Requiere criterio humano o es opcional |

### Ejemplos

#### Automáticas

- Actualizar `devTASK.json` después de mover tarea
- Crear archivo `completion-notes.md` desde template al completar aiTASK
- Actualizar timestamp de `last_modified`

#### Enqueued

- Actualizar `latest-implementation.md` (requiere narrativa)
- Generar resumen DDPN (requiere revisión)
- Notificar a dipole.work (integración externa)

### Implementación

```typescript
async function completeAiTask(params: CompleteAiTaskParams): Promise<AfwkToolOutput> {
  const runId = generateToolRunId();
  const changes: Change[] = [];
  
  // ... lógica principal ...
  
  // POSTCONDICIÓN AUTOMÁTICA: crear completion-notes
  const notesPath = await createCompletionNotesFile(
    params.aiTaskId, 
    params.notes
  );
  changes.push({
    path: notesPath,
    type: 'create',
    summary: 'Created completion notes from template'
  });
  
  // POSTCONDICIÓN ENQUEUED: sugerir actualizar latest-implementation
  await enqueuePendingAction({
    id: `pa_${randomUUID()}`,
    type: 'update_latest_implementation',
    context: { 
      devTaskId: params.devTaskId,
      triggered_by_tool_run: runId
    },
    created_at: new Date().toISOString(),
    status: 'pending'
  });
  
  return { 
    ok: true, 
    tool_run_id: runId,
    entity_refs: { aiTaskId: params.aiTaskId },
    changes,
    warnings: ['Pending action queued: update_latest_implementation'],
    errors: []
  };
}
```

---

## 10. Rules.yaml

### Propósito

Definir validaciones de forma declarativa y versionable, sin modificar código.

### Schema

```yaml
# .afwk/rules.yaml

version: 1

transitions:
  backlog_to_todo:
    checks:
      - type: file_exists
        path: overview.md
        error: "devTASK requires overview.md to move to todo"
  
  todo_to_in_progress:
    checks:
      - type: min_files_match
        pattern: "aiTASK-*.md"
        min: 1
        error: "devTASK requires at least 1 aiTASK blueprint to start"
  
  in_progress_to_completed:
    checks:
      - type: all_aitasks_have_completion_notes
        error: "All aiTASKs must have completion notes to mark devTASK as completed"

validations:
  overview:
    file: overview.md
    required_sections:
      - "## Objetivo"
      - "## Alcance"
      - "## Criterios de Éxito"
    
  aitask_blueprint:
    file_pattern: "aiTASK-*.md"
    exclude: "*_completion-notes.md"
    required_sections:
      - "## Objetivo de esta Iteración"
      - "## Especificación de Implementación"
      - "## Criterios de Validación"

naming:
  devtask_folder:
    pattern: "^devTASK-\\d{2}_[a-z0-9-]+$"
    example: "devTASK-01_login-implementation"
    
  aitask_file:
    pattern: "^aiTASK-\\d{2}_[a-z0-9-]+\\.md$"
    example: "aiTASK-01_setup-database.md"
```

### Motor de Reglas

```typescript
interface CheckResult {
  passed: boolean;
  error?: string;
}

async function validateTransition(
  devTaskPath: string,
  from: KanbanColumn,
  to: KanbanColumn,
  rules: RulesYaml
): Promise<CheckResult[]> {
  const transitionKey = `${from}_to_${to}`;
  const transition = rules.transitions[transitionKey];
  
  if (!transition) {
    return [{ passed: true }]; // No rules for this transition
  }
  
  const results: CheckResult[] = [];
  
  for (const check of transition.checks) {
    const result = await executeCheck(check, devTaskPath);
    results.push(result);
  }
  
  return results;
}
```

---

## 11. Hooks de Seguridad

### Propósito

Bloquear acceso directo a `.afwk/` vía tools nativas (bash, edit, write). Las modificaciones **solo** deben pasar por `afwk:*` tools.

### Implementación

```typescript
// Hook: tool.execute.before
function beforeToolExecute(toolName: string, args: unknown): void | never {
  if (toolName === 'bash') {
    const command = (args as { command: string }).command;
    if (isDestructiveAfwkCommand(command)) {
      throw new Error(
        'Cannot modify .afwk/ via bash. Use afwk:* tools instead.'
      );
    }
  }
  
  if (toolName === 'edit' || toolName === 'write') {
    const path = (args as { path: string }).path;
    if (path.includes('.afwk/')) {
      throw new Error(
        'Cannot modify .afwk/ directly. Use afwk:* tools instead.'
      );
    }
  }
}

function isDestructiveAfwkCommand(command: string): boolean {
  const destructivePatterns = [
    /\brm\b.*\.afwk/,
    /\bmv\b.*\.afwk/,
    /\bcp\b.*\.afwk/,
    />\s*.*\.afwk/,  // redirect to .afwk
    /\becho\b.*>\s*.*\.afwk/,
  ];
  
  return destructivePatterns.some(p => p.test(command));
}
```

### Lo que NO bloquean los Hooks

Los hooks **no** validan lógica de negocio. Eso es responsabilidad de las tools y rules.yaml:

- ❌ Hooks no validan si un devTASK puede moverse a in_progress
- ❌ Hooks no validan estructura de archivos
- ❌ Hooks no validan naming conventions

---

## 12. Orden de Implementación

### Fase 1: Enforcement (Prioridad Máxima)

| # | Componente | Descripción |
|---|------------|-------------|
| 1 | Clasificador de Intención | Función `classifyIntent()` |
| 2 | Policy Gate | Función `policyGate()` con `isClarificationResponse()` |
| 3 | Tool Registry | Mapa estático de getters/mutators |
| 4 | state.json | Crear archivo con schema v1 |
| 5 | System Prompt | Refactorizar a versión compacta |

### Fase 2: Tools Core

| # | Componente | Descripción |
|---|------------|-------------|
| 6 | Contrato de Output | Implementar `AfwkToolOutput` en tools existentes |
| 7 | `afwk:getKanbanStatus` | Agregar `tool_run_id` y contrato |
| 8 | `afwk:moveKanbanTask` | Agregar contrato completo |
| 9 | Audit Log | Persistir ejecuciones en state.json |

### Fase 3: Creación de Contenido

| # | Componente | Descripción |
|---|------------|-------------|
| 10 | `afwk:createDevTask` | Con validaciones y contrato |
| 11 | `afwk:createAiTask` | Con template y contrato |
| 12 | `afwk:completeAiTask` | Con postcondiciones (auto + enqueued) |
| 13 | Templates | overview.md, aitask-blueprint.md, completion-notes.md |

### Fase 4: Validaciones Avanzadas

| # | Componente | Descripción |
|---|------------|-------------|
| 14 | Motor de rules.yaml | Ejecutar checks de transiciones |
| 15 | `afwk:validateDevTask` | Validar estructura completa |
| 16 | Check `file_has_sections` | Validar secciones requeridas |

### Deferred (Post-MVP)

- `afwk:dryRun` - Simular operación sin ejecutar
- `afwk:initProject` - Crear estructura .afwk/ completa
- `afwk:generateDailySummary` - DDPN
- Procesamiento de `pending_actions` (UI o prompt)
- Versionado formal de rules.yaml con migraciones
- Motor de reglas sofisticado (AND/OR, severidad, i18n)

---

## 13. Checklist de Validación

Antes de considerar la arquitectura "implementada", verificar:

### Clasificador de Intención

- [ ] `classifyIntent("mueve devTASK-01_login a in_progress")` → `mutation`
- [ ] `classifyIntent("crea una tarea para el login")` → `mutation`
- [ ] `classifyIntent("qué hay en todo")` → `read`
- [ ] `classifyIntent("cuántas tareas tengo")` → `read`
- [ ] `classifyIntent("el completed tiene 5 tareas")` → `conversation`
- [ ] `classifyIntent("explícame el framework")` → `conversation`

### Policy Gate

- [ ] Acepta mutation con tool ejecutada (`ok:true`)
- [ ] Acepta mutation con tool ejecutada (`ok:false`) - no hace retry
- [ ] Acepta mutation con clarificación: "¿cuál devTASK quieres mover?"
- [ ] Rechaza (retry) mutation sin tool y sin clarificación
- [ ] Acepta read con getter ejecutado
- [ ] Rechaza (retry) read sin getter
- [ ] Siempre acepta conversation

### Tools

- [ ] Todas las tools retornan `AfwkToolOutput`
- [ ] `tool_run_id` es único por ejecución
- [ ] `changes[]` incluye todos los archivos modificados
- [ ] `errors[]` tiene mensajes claros cuando `ok:false`

### State

- [ ] `state.json` tiene `schema_version: 1`
- [ ] Audit log persiste después de cada tool execution
- [ ] Audit log rota correctamente al exceder `max_entries`
- [ ] `pending_actions` se encolan correctamente

### System Prompt

- [ ] Menos de 500 tokens
- [ ] Incluye conteos de kanban (no listas)
- [ ] Incluye las 5 reglas de comportamiento
- [ ] Lista todas las tools disponibles

### Hooks

- [ ] Bloquea `rm -rf .afwk/`
- [ ] Bloquea `echo "x" > .afwk/file.json`
- [ ] Bloquea `edit .afwk/rules.yaml`
- [ ] No bloquea lectura de `.afwk/` vía bash (`cat`, `ls`)

---

## 14. Decisiones de Diseño

### ¿Por qué validaciones en rules.yaml y no en código?

- **Versionable:** Se puede trackear cambios en Git
- **Configurable:** Cada proyecto puede ajustar reglas sin modificar el plugin
- **Legible:** YAML es más fácil de leer que código TypeScript

### ¿Por qué hooks solo para bloqueos de seguridad?

- Los hooks son para **seguridad** (prevenir acciones no permitidas)
- Las **validaciones de negocio** van en las tools (retornan error informativo)
- Separación clara de responsabilidades

### ¿Por qué tools en lugar de dejar que el LLM use bash/edit?

- **Control:** Las tools tienen validaciones integradas
- **Consistencia:** Siempre se aplican las mismas reglas
- **Atomicidad:** Una tool hace todo lo necesario (mover + actualizar JSON + audit)
- **Trazabilidad:** Cada ejecución tiene `tool_run_id`

### ¿Por qué el Policy Gate acepta ok:false?

- `ok:false` es **evidencia** de que la tool se ejecutó
- El LLM debe explicar el error al usuario
- Sin esta regla, el sistema entraría en loops de retry infinitos
- El usuario puede decidir qué hacer con el error

### ¿Por qué separar getters y mutators?

- **Semántica clara:** Read vs Write
- **Validación específica:** Read requiere getter, mutation requiere mutator
- **Auditoría:** Distinguir operaciones de consulta vs modificación

### ¿Por qué no usar ML para clasificación de intención?

- **Determinismo:** Heurísticas producen resultados predecibles
- **Debuggability:** Fácil de entender por qué se clasificó de cierta manera
- **Performance:** Sin latencia de modelo adicional
- **MVP:** Suficiente para el scope actual, se puede sofisticar después

---

## 15. Changelog

### v2.1.2 (20 enero 2026) - Precisión de Redacción

- Principio #1: clarificado que `ok:false` también es evidencia válida (no solo `ok:true`)
- Principio #2: clarificado que read usa el getter apropiado según tipo (no solo `getKanbanStatus`)

### v2.1.1 (20 enero 2026) - Correcciones Post-Consenso

- **[CRÍTICO]** Policy Gate: retry agotado ahora es hard fail, no "accept with warning"
- Mapeo explícito Read → Getter específico (kanban, steering, validation)
- Tool Registry: nota explícita de que tools deferred no están registradas
- Tabla de tools: columna "En Registry" para clarificar estado

### v2.1 (20 enero 2026) - Consenso Final

- Clasificador de intención: patrones basados en IDs reales (no solo keywords)
- Tool Registry: mapa estático de getters vs mutators
- Policy Gate: `ok:false` es evidencia válida (evita loops)
- Policy Gate: read exige getter específico, no cualquier afwk:*
- Clarificación: detector robusto (no solo `?`)
- Audit log: guarda `changes[]` completo + `errors[]`
- state.json: agregado `schema_version`

### v2.0 (20 enero 2026) - Arquitectura Consensuada

- Agregado clasificador de intención
- Agregado Policy Gate
- Agregado contrato de output con `tool_run_id`
- System prompt compacto (~500 tokens)
- Postcondiciones: automáticas vs enqueued
- state.json para audit log y pending_actions

### v1.0 (enero 2026) - Arquitectura Inicial

- System prompt con contexto
- Tools básicas: getKanbanStatus, moveKanbanTask
- Hooks de bloqueo .afwk/
- Rules.yaml para transiciones

---

*Documento generado con validación cruzada Claude + ChatGPT*  
*Última actualización: 20 enero 2026*
