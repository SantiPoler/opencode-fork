# aiFRAMEWORK Plugin - Guía de Implementación Fase 1

**Versión:** 1.0  
**Fecha:** 20 enero 2026  
**Objetivo:** Implementar la tubería de enforcement antes de agregar más tools  
**Duración estimada:** 1-2 semanas  
**Prerequisito:** Documento de arquitectura v2.1.2 aprobado

---

## Tabla de Contenidos

1. [Resumen Ejecutivo](#1-resumen-ejecutivo)
2. [Principio Guía](#2-principio-guía)
3. [Pasos de Implementación](#3-pasos-de-implementación)
4. [Smoke Test (Criterio de Done)](#4-smoke-test-criterio-de-done)
5. [Lo que NO hacer en Fase 1](#5-lo-que-no-hacer-en-fase-1)
6. [Milestone de Éxito](#6-milestone-de-éxito)
7. [Siguiente Fase](#7-siguiente-fase)

---

## 1. Resumen Ejecutivo

**Meta:** Construir un sistema "a prueba de alucinaciones" donde el LLM nunca pueda afirmar cambios sin evidencia de tool ejecutada.

**Enfoque:** Enforcement primero, tools después. Si la tubería de validación no funciona, cada tool nueva multiplica estados inválidos.

**Entregable:** Un sistema donde:
- `read` → siempre ejecuta getter
- `mutation` → siempre ejecuta mutator o pide clarificación
- `conversation` → libre
- Violaciones → hard fail (responde el sistema, no el LLM)

---

## 2. Principio Guía

> **"Si el gate no funciona, más tools = más superficie de bugs"**

Cada paso debe ser:
1. **Testeable** de forma aislada
2. **Verificable** antes de pasar al siguiente
3. **Mínimo** para lograr enforcement real

---

## 3. Pasos de Implementación

### Paso 0: Definir Contratos y Tipos Compartidos

**Tiempo estimado:** 30-60 minutos

**Objetivo:** Crear un módulo central con todos los tipos para evitar spaghetti.

**Archivo:** `src/afwk/contracts.ts`

```typescript
// ─────────────────────────────────────────────────────────
// TIPOS DE INTENCIÓN
// ─────────────────────────────────────────────────────────

export type IntentType = 'mutation' | 'read' | 'conversation';

// ─────────────────────────────────────────────────────────
// TOOL REGISTRY
// ─────────────────────────────────────────────────────────

// IMPORTANTE: Solo registrar tools que EXISTEN e IMPLEMENTADAS
// Agregar nuevas tools al registry cuando se habiliten (Fase 2+)
export const TOOL_REGISTRY = {
  getters: [
    'afwk:getKanbanStatus',
    // 'afwk:getSteeringContext',  // Agregar en Fase 2+
    // 'afwk:validateDevTask',     // Agregar en Fase 3+
  ],
  mutators: [
    'afwk:moveKanbanTask',
    // 'afwk:createDevTask',              // Agregar en Fase 2
    // 'afwk:createAiTask',               // Agregar en Fase 2
    // 'afwk:completeAiTask',             // Agregar en Fase 2
    // 'afwk:updateLatestImplementation', // Agregar en Fase 2+
  ]
} as const;

export type GetterTool = typeof TOOL_REGISTRY.getters[number];
export type MutatorTool = typeof TOOL_REGISTRY.mutators[number];

export function isGetter(toolName: string): toolName is GetterTool {
  return TOOL_REGISTRY.getters.includes(toolName as GetterTool);
}

export function isMutator(toolName: string): toolName is MutatorTool {
  return TOOL_REGISTRY.mutators.includes(toolName as MutatorTool);
}

// ─────────────────────────────────────────────────────────
// CONTRATO DE OUTPUT PARA TOOLS
// ─────────────────────────────────────────────────────────

export interface AfwkToolOutput {
  ok: boolean;
  tool_run_id: string;
  entity_refs?: {
    devTaskId?: string;
    aiTaskId?: string;
  };
  changes: Array<{
    path: string;
    type: 'create' | 'update' | 'move' | 'delete';
    summary: string;
  }>;
  warnings: string[];
  errors: string[];
}

// ─────────────────────────────────────────────────────────
// TIPOS PARA LLM RESPONSE
// ─────────────────────────────────────────────────────────

export interface ToolCall {
  name: string;
  input: Record<string, unknown>;
  output?: AfwkToolOutput;
  executed: boolean;  // true solo si la tool realmente corrió
}

export interface LLMResponse {
  text: string;
  toolCalls?: ToolCall[];
}

// ─────────────────────────────────────────────────────────
// RESULTADO DEL POLICY GATE
// ─────────────────────────────────────────────────────────

export interface GateResult {
  success: boolean;
  response?: LLMResponse;
  systemMessage?: string;
}

// ─────────────────────────────────────────────────────────
// ESTADO PERSISTENTE
// ─────────────────────────────────────────────────────────

export interface PendingAction {
  id: string;
  type: string;
  context: Record<string, unknown>;
  created_at: string;
  status: 'pending' | 'completed' | 'skipped';
}

export interface AuditLogEntry {
  tool_run_id: string;
  timestamp: string;
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

export interface StateJson {
  schema_version: number;
  pending_actions: PendingAction[];
  audit_log: AuditLogEntry[];
  audit_log_max_entries: number;
}

// ─────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────

import { randomUUID } from 'crypto';

export function generateToolRunId(): string {
  return `tr_${randomUUID()}`;
}
```

**Done criteria:**
- [ ] Archivo `contracts.ts` creado
- [ ] Tipos exportados correctamente
- [ ] Sin dependencias circulares

---

### Paso 1: Implementar `classifyIntent()`

**Tiempo estimado:** 1-2 horas

**Objetivo:** Función determinista que clasifica el mensaje del usuario.

**Archivo:** `src/afwk/classifier.ts`

```typescript
import { IntentType } from './contracts';

export function classifyIntent(userMessage: string): IntentType {
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

**Tests requeridos:** `src/afwk/__tests__/classifier.test.ts`

```typescript
import { classifyIntent } from '../classifier';

describe('classifyIntent', () => {
  // MUTATION cases
  test('mutation: mueve devTASK con ID a columna', () => {
    expect(classifyIntent('mueve devTASK-01_login a in_progress')).toBe('mutation');
  });
  
  test('mutation: crea una nueva tarea', () => {
    expect(classifyIntent('crea una nueva tarea para login')).toBe('mutation');
  });
  
  test('mutation: completa devTASK', () => {
    expect(classifyIntent('completa devTASK-02_auth')).toBe('mutation');
  });
  
  test('mutation: inglés con ID', () => {
    expect(classifyIntent('move devTASK-01 to completed')).toBe('mutation');
  });
  
  // READ cases
  test('read: qué hay en todo', () => {
    expect(classifyIntent('qué hay en todo')).toBe('read');
  });
  
  test('read: cuántas tareas tengo', () => {
    expect(classifyIntent('cuántas tareas tengo pendientes')).toBe('read');
  });
  
  test('read: estado del kanban', () => {
    expect(classifyIntent('muéstrame el estado del kanban')).toBe('read');
  });
  
  test('read: inglés status', () => {
    expect(classifyIntent('show me current state')).toBe('read');
  });
  
  // CONVERSATION cases
  test('conversation: afirmación sin comando', () => {
    expect(classifyIntent('el completed tiene 5 tareas')).toBe('conversation');
  });
  
  test('conversation: solicitud de explicación', () => {
    expect(classifyIntent('explícame cómo funciona el kanban')).toBe('conversation');
  });
  
  test('conversation: saludo', () => {
    expect(classifyIntent('hola, cómo estás')).toBe('conversation');
  });
});
```

**Done criteria:**
- [ ] Función `classifyIntent()` implementada
- [ ] 10+ tests pasando
- [ ] No rompe por inputs vacíos o raros

---

### Paso 2: Implementar `policyGate()` + `isClarificationResponse()`

**Tiempo estimado:** 2-3 horas

**Objetivo:** Validar que la respuesta del LLM tenga evidencia apropiada.

**Archivo:** `src/afwk/policy-gate.ts`

```typescript
import { IntentType, LLMResponse, isGetter, isMutator } from './contracts';

/**
 * Detecta si la respuesta es una clarificación legítima (sin tool)
 */
export function isClarificationResponse(text: string): boolean {
  const clarificationSignals = [
    /\b(necesito|falta|cuál|qué|confirma|especifica|desde|hasta)\b/i,
    /\b(which|what|need|missing|confirm|specify|from|to)\b/i,
    /\b(no (puedo|tengo)|can'?t|don'?t have)\b/i,
    /\?\s*$/,  // Pregunta al final
  ];
  
  // Claims de ÉXITO (indicadores de que NO es clarificación)
  const successClaims = [
    /\b(ya (quedó|está listo|se movió|se creó|completado))\b/i,
    /\b(done|completed successfully|moved successfully|created)\b/i,
  ];
  
  const hasSignal = clarificationSignals.some(p => p.test(text));
  const isShort = text.length < 300;
  const noSuccessClaim = !successClaims.some(p => p.test(text));
  
  return hasSignal && isShort && noSuccessClaim;
}

/**
 * Valida que la respuesta tenga evidencia apropiada según la intención
 */
export function policyGate(
  userIntent: IntentType,
  llmResponse: LLMResponse
): 'accept' | 'retry' {
  
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
  
  // MUTATION: requiere mutator ejecutado (ok true o false) O clarificación
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

**Tests requeridos:** `src/afwk/__tests__/policy-gate.test.ts`

```typescript
import { policyGate, isClarificationResponse } from '../policy-gate';
import { LLMResponse } from '../contracts';

describe('isClarificationResponse', () => {
  test('detecta pregunta de clarificación', () => {
    expect(isClarificationResponse('¿Cuál devTASK quieres mover?')).toBe(true);
  });
  
  test('detecta falta de información', () => {
    expect(isClarificationResponse('Necesito saber el destino')).toBe(true);
  });
  
  test('rechaza success claim', () => {
    expect(isClarificationResponse('Ya quedó movida la tarea')).toBe(false);
  });
  
  test('rechaza texto largo', () => {
    const longText = 'a'.repeat(400);
    expect(isClarificationResponse(longText + '?')).toBe(false);
  });
});

describe('policyGate', () => {
  // READ tests
  test('read: acepta con getter ejecutado', () => {
    const response: LLMResponse = {
      text: 'Hay 3 tareas en todo',
      toolCalls: [{
        name: 'afwk:getKanbanStatus',
        input: {},
        output: { ok: true, tool_run_id: 'tr_1', changes: [], warnings: [], errors: [] },
        executed: true
      }]
    };
    expect(policyGate('read', response)).toBe('accept');
  });
  
  test('read: retry sin getter', () => {
    const response: LLMResponse = {
      text: 'Hay 3 tareas en todo',
      toolCalls: []
    };
    expect(policyGate('read', response)).toBe('retry');
  });
  
  // MUTATION tests
  test('mutation: acepta con mutator ok:true', () => {
    const response: LLMResponse = {
      text: 'Tarea movida',
      toolCalls: [{
        name: 'afwk:moveKanbanTask',
        input: { taskId: 'devTASK-01', from: 'todo', to: 'in_progress' },
        output: { ok: true, tool_run_id: 'tr_1', changes: [], warnings: [], errors: [] },
        executed: true
      }]
    };
    expect(policyGate('mutation', response)).toBe('accept');
  });
  
  test('mutation: acepta con mutator ok:false (evidencia)', () => {
    const response: LLMResponse = {
      text: 'No se pudo mover porque falta aiTASK',
      toolCalls: [{
        name: 'afwk:moveKanbanTask',
        input: { taskId: 'devTASK-01', from: 'todo', to: 'in_progress' },
        output: { ok: false, tool_run_id: 'tr_1', changes: [], warnings: [], errors: ['Missing aiTASK'] },
        executed: true
      }]
    };
    expect(policyGate('mutation', response)).toBe('accept');
  });
  
  test('mutation: acepta clarificación sin tool', () => {
    const response: LLMResponse = {
      text: '¿Cuál devTASK quieres mover?',
      toolCalls: []
    };
    expect(policyGate('mutation', response)).toBe('accept');
  });
  
  test('mutation: retry sin tool ni clarificación', () => {
    const response: LLMResponse = {
      text: 'Ya moví la tarea a in_progress',  // Claim sin evidencia
      toolCalls: []
    };
    expect(policyGate('mutation', response)).toBe('retry');
  });
  
  // CONVERSATION tests
  test('conversation: siempre acepta', () => {
    const response: LLMResponse = {
      text: 'El framework funciona así...',
      toolCalls: []
    };
    expect(policyGate('conversation', response)).toBe('accept');
  });
});
```

**Done criteria:**
- [ ] `policyGate()` implementado
- [ ] `isClarificationResponse()` implementado
- [ ] 10+ tests pasando
- [ ] Gate nunca acepta "state claims" sin evidencia

---

### Paso 3: Implementar `executeWithPolicyGate()`

**Tiempo estimado:** 2-3 horas

**Objetivo:** Envolver el llamado al LLM con enforcement real.

**Archivo:** `src/afwk/executor.ts`

```typescript
import { classifyIntent } from './classifier';
import { policyGate } from './policy-gate';
import { IntentType, LLMResponse, GateResult } from './contracts';

const MAX_RETRIES = 2;

/**
 * Mensajes del sistema cuando el enforcement falla
 */
const SYSTEM_MESSAGES: Record<IntentType, string> = {
  mutation: 'No pude ejecutar la operación porque el modelo no usó las herramientas requeridas. Por favor reformula tu solicitud especificando claramente qué tarea quieres modificar (ej: "mueve devTASK-01_login a in_progress").',
  read: 'No pude obtener el estado actual porque el modelo no consultó las herramientas requeridas. Por favor pregunta de nuevo (ej: "muéstrame el estado del kanban").',
  conversation: '' // Nunca llega aquí
};

/**
 * Interface para el cliente LLM (abstracción para testing)
 */
export interface LLMClient {
  generate(
    userMessage: string, 
    options?: { systemSuffix?: string }
  ): Promise<LLMResponse>;
}

/**
 * Ejecuta el LLM con enforcement de Policy Gate
 */
export async function executeWithPolicyGate(
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
    
    const decision = policyGate(intent, lastResponse);
    
    if (decision === 'accept') {
      return { success: true, response: lastResponse };
    }
    
    console.warn(`Policy gate retry ${attempt + 1}/${MAX_RETRIES} for intent: ${intent}`);
  }
  
  // HARD FAIL: No se acepta respuesta sin evidencia
  console.error(`Policy gate enforcement: rejected after ${MAX_RETRIES} retries`);
  
  return { 
    success: false, 
    systemMessage: SYSTEM_MESSAGES[intent]
  };
}
```

**Done criteria:**
- [ ] `executeWithPolicyGate()` implementado
- [ ] Retry con `systemSuffix` funciona
- [ ] Hard fail retorna `systemMessage`, no respuesta del LLM
- [ ] Integrable con el runtime existente

---

### Paso 4: Instrumentar `executed` en ToolCalls

**Tiempo estimado:** 1-2 horas

**Objetivo:** Asegurar que `executed: true` solo se marca cuando la tool realmente corrió.

**Ubicación:** En el runtime de tools (donde se ejecutan las tools)

**Reglas críticas:**

1. **`executed = true`** solo cuando:
   - La tool fue invocada
   - El código de la tool corrió (aunque haya fallado)
   - Hay un `output` (con `ok: true` o `ok: false`)

2. **`executed = false`** cuando:
   - El LLM mencionó la tool pero no la llamó
   - La invocación fue rechazada por el hook de seguridad
   - Hubo error de runtime antes de ejecutar

```typescript
// Ejemplo de cómo marcar executed correctamente

async function executeToolCall(toolCall: { name: string; input: unknown }): Promise<ToolCall> {
  const result: ToolCall = {
    name: toolCall.name,
    input: toolCall.input as Record<string, unknown>,
    executed: false,  // Default: no ejecutado
    output: undefined
  };
  
  try {
    // Verificar que la tool existe
    const tool = getToolByName(toolCall.name);
    if (!tool) {
      return result;  // executed = false
    }
    
    // Ejecutar la tool
    const output = await tool.execute(toolCall.input);
    
    // Marcar como ejecutada CON output
    result.executed = true;
    result.output = output;
    
  } catch (error) {
    // Si hubo error DESPUÉS de empezar ejecución, aún cuenta como ejecutada
    // pero con ok: false
    if (isToolExecutionError(error)) {
      result.executed = true;
      result.output = {
        ok: false,
        tool_run_id: generateToolRunId(),
        changes: [],
        warnings: [],
        errors: [error.message]
      };
    }
    // Si el error fue ANTES (ej: hook bloqueó), executed = false
  }
  
  return result;
}
```

**Done criteria:**
- [ ] `executed` se marca correctamente en el runtime
- [ ] Tools mencionadas pero no llamadas tienen `executed: false`
- [ ] Tools que fallan tienen `executed: true` + `ok: false`
- [ ] No hay falsos positivos de "tool ejecutada"

---

### Paso 5: Implementar `state.json` + `appendToAuditLog()`

**Tiempo estimado:** 1-2 horas

**Objetivo:** Persistir evidencia de ejecuciones en disco.

**Archivo:** `src/afwk/state.ts`

```typescript
import * as fs from 'fs/promises';
import * as path from 'path';
import { StateJson, AuditLogEntry, PendingAction } from './contracts';

const STATE_FILE = '.afwk/state.json';
const DEFAULT_MAX_ENTRIES = 1000;

/**
 * Lee el estado actual o crea uno nuevo
 */
export async function readState(projectRoot: string): Promise<StateJson> {
  const statePath = path.join(projectRoot, STATE_FILE);
  
  try {
    const content = await fs.readFile(statePath, 'utf-8');
    return JSON.parse(content) as StateJson;
  } catch {
    // Crear estado inicial
    return {
      schema_version: 1,
      pending_actions: [],
      audit_log: [],
      audit_log_max_entries: DEFAULT_MAX_ENTRIES
    };
  }
}

/**
 * Escribe el estado a disco
 */
export async function writeState(projectRoot: string, state: StateJson): Promise<void> {
  const statePath = path.join(projectRoot, STATE_FILE);
  
  // Asegurar que el directorio existe
  await fs.mkdir(path.dirname(statePath), { recursive: true });
  
  await fs.writeFile(statePath, JSON.stringify(state, null, 2), 'utf-8');
}

/**
 * Agrega entrada al audit log con rotación FIFO
 */
export async function appendToAuditLog(
  projectRoot: string, 
  entry: AuditLogEntry
): Promise<void> {
  const state = await readState(projectRoot);
  
  state.audit_log.push(entry);
  
  // Rotación FIFO
  while (state.audit_log.length > state.audit_log_max_entries) {
    state.audit_log.shift();
  }
  
  await writeState(projectRoot, state);
}

/**
 * Encola una pending action
 */
export async function enqueuePendingAction(
  projectRoot: string,
  action: PendingAction
): Promise<void> {
  const state = await readState(projectRoot);
  state.pending_actions.push(action);
  await writeState(projectRoot, state);
}

/**
 * Crea entrada de audit log desde output de tool
 */
export function createAuditEntry(
  tool: string,
  input: Record<string, unknown>,
  output: { ok: boolean; tool_run_id: string; changes: any[]; errors: string[]; entity_refs?: any }
): AuditLogEntry {
  return {
    tool_run_id: output.tool_run_id,
    timestamp: new Date().toISOString(),
    tool,
    entity_refs: output.entity_refs,
    input,
    output_ok: output.ok,
    changes: output.changes,
    errors: output.errors
  };
}
```

**Done criteria:**
- [ ] `state.json` se crea con `schema_version: 1`
- [ ] `appendToAuditLog()` persiste correctamente
- [ ] Rotación FIFO funciona
- [ ] Después de 1 tool call hay evidencia en disco

---

### Paso 6: Actualizar Tools Existentes para Cumplir Contrato

**Tiempo estimado:** 2-3 horas

**Objetivo:** Las tools existentes deben retornar `AfwkToolOutput` y registrar en audit log.

**Tools a actualizar:**
1. `afwk:getKanbanStatus` — Debe retornar `AfwkToolOutput` y escribir audit log
2. `afwk:moveKanbanTask` — Debe retornar `AfwkToolOutput` y escribir audit log

**Nota importante:** Aunque `getKanbanStatus` es un getter (read-only), también debe escribir en audit log para trazabilidad y debugging del policy gate.

**Ejemplo para `getKanbanStatus`:**

```typescript
import { AfwkToolOutput, generateToolRunId } from './contracts';
import { appendToAuditLog, createAuditEntry } from './state';

export async function getKanbanStatus(
  projectRoot: string
): Promise<AfwkToolOutput> {
  const runId = generateToolRunId();
  
  try {
    const kanbanState = await readKanbanState(projectRoot);
    
    const output: AfwkToolOutput = {
      ok: true,
      tool_run_id: runId,
      changes: [],  // Read-only, no changes
      warnings: [],
      errors: []
    };
    
    // Registrar en audit log (importante para debugging del gate)
    await appendToAuditLog(
      projectRoot,
      createAuditEntry('afwk:getKanbanStatus', {}, output)
    );
    
    return output;
    
  } catch (error) {
    const output: AfwkToolOutput = {
      ok: false,
      tool_run_id: runId,
      changes: [],
      warnings: [],
      errors: [error instanceof Error ? error.message : 'Unknown error']
    };
    
    await appendToAuditLog(
      projectRoot,
      createAuditEntry('afwk:getKanbanStatus', {}, output)
    );
    
    return output;
  }
}
```

**Ejemplo para `moveKanbanTask`:**

```typescript
import { AfwkToolOutput, generateToolRunId } from './contracts';
import { appendToAuditLog, createAuditEntry } from './state';

interface MoveKanbanTaskInput {
  taskId: string;
  from: 'backlog' | 'todo' | 'in_progress' | 'completed';
  to: 'backlog' | 'todo' | 'in_progress' | 'completed';
}

export async function moveKanbanTask(
  projectRoot: string,
  input: MoveKanbanTaskInput
): Promise<AfwkToolOutput> {
  const runId = generateToolRunId();
  const changes: AfwkToolOutput['changes'] = [];
  const errors: string[] = [];
  
  try {
    // 1. Validar que el devTASK existe
    const taskPath = await findDevTask(projectRoot, input.taskId, input.from);
    if (!taskPath) {
      return createErrorOutput(runId, input.taskId, [
        `devTASK '${input.taskId}' not found in ${input.from}`
      ]);
    }
    
    // 2. Validar reglas de transición (desde rules.yaml o hardcoded)
    const validationErrors = await validateTransition(taskPath, input.from, input.to);
    if (validationErrors.length > 0) {
      return createErrorOutput(runId, input.taskId, validationErrors);
    }
    
    // 3. Mover el directorio
    const newPath = await moveTaskDirectory(projectRoot, taskPath, input.from, input.to);
    changes.push({
      path: newPath,
      type: 'move',
      summary: `Moved from ${input.from} to ${input.to}`
    });
    
    // 4. Actualizar devTASK.json
    await updateTaskStatus(newPath, input.to);
    changes.push({
      path: `${newPath}/devTASK.json`,
      type: 'update',
      summary: `Updated status field to '${input.to}'`
    });
    
    // 5. Construir output exitoso
    const output: AfwkToolOutput = {
      ok: true,
      tool_run_id: runId,
      entity_refs: { devTaskId: input.taskId },
      changes,
      warnings: [],
      errors: []
    };
    
    // 6. Registrar en audit log
    await appendToAuditLog(
      projectRoot, 
      createAuditEntry('afwk:moveKanbanTask', input, output)
    );
    
    return output;
    
  } catch (error) {
    const output: AfwkToolOutput = {
      ok: false,
      tool_run_id: runId,
      entity_refs: { devTaskId: input.taskId },
      changes: [],
      warnings: [],
      errors: [error instanceof Error ? error.message : 'Unknown error']
    };
    
    // Registrar fallo en audit log
    await appendToAuditLog(
      projectRoot,
      createAuditEntry('afwk:moveKanbanTask', input, output)
    );
    
    return output;
  }
}

function createErrorOutput(
  runId: string, 
  taskId: string, 
  errors: string[]
): AfwkToolOutput {
  return {
    ok: false,
    tool_run_id: runId,
    entity_refs: { devTaskId: taskId },
    changes: [],
    warnings: [],
    errors
  };
}
```

**Done criteria:**
- [ ] `getKanbanStatus` retorna `AfwkToolOutput`
- [ ] `getKanbanStatus` escribe en audit log (para trazabilidad del gate)
- [ ] `moveKanbanTask` retorna `AfwkToolOutput`
- [ ] `moveKanbanTask` escribe en audit log
- [ ] `tool_run_id` es único por ejecución
- [ ] `changes[]` incluye paths reales (en mutators)
- [ ] `errors[]` es claro cuando `ok: false`

---

### Paso 7: Refactorizar System Prompt

**Tiempo estimado:** 1 hora

**Objetivo:** System prompt compacto (~500 tokens) que guía al LLM.

**Archivo:** `src/afwk/system-prompt.ts`

```typescript
interface KanbanCounts {
  backlog: number;
  todo: number;
  in_progress: number;
  completed: number;
}

interface ActiveTask {
  id: string;
  status: string;
}

export function generateSystemPrompt(
  projectName: string,
  kanbanCounts: KanbanCounts,
  activeTask?: ActiveTask
): string {
  return `## aiFRAMEWORK Context

**Project:** ${projectName}
**Kanban:** ${kanbanCounts.backlog} backlog | ${kanbanCounts.todo} todo | ${kanbanCounts.in_progress} in_progress | ${kanbanCounts.completed} completed
${activeTask ? `**Active:** ${activeTask.id} (${activeTask.status})` : ''}

## Rules

1. **Never claim state changes without tool execution.** If you say "moved" or "created", there MUST be an executed afwk:* tool call (with \`ok:true\` or \`ok:false\`) in this turn. When \`ok:false\`, explain the error—do not claim success.

2. **For ANY question about kanban/task state, call afwk:getKanbanStatus BEFORE answering.** Do not rely on the snapshot above for detailed queries.

3. **Use the appropriate afwk:* tool for operations.** Do not use bash or edit to modify .afwk/ directly.

4. **If you lack information to complete an operation, ask for clarification.** It's better to ask "which devTASK?" than to guess.

5. **When a tool returns ok:false, explain the error clearly.** Do not claim success.

## Available Tools

### Getters (Read)
- \`afwk:getKanbanStatus\` - Read current kanban state (REQUIRED for state questions)

### Mutators (Write)
- \`afwk:moveKanbanTask\` - Move task between columns (validates rules automatically)`;
}

// NOTA: En Fase 1 solo listamos tools implementadas.
// Agregar al prompt cuando se implementen en Fase 2+:
// - afwk:getSteeringContext
// - afwk:createDevTask
// - afwk:createAiTask
// - afwk:completeAiTask
```

**Done criteria:**
- [ ] Prompt generado dinámicamente
- [ ] ~500 tokens o menos
- [ ] Incluye conteos (no listas)
- [ ] Incluye las 5 reglas
- [ ] Lista tools disponibles

---

### Paso 8: Smoke Test de Enforcement

**Tiempo estimado:** 1-2 horas

**Objetivo:** Validar end-to-end que el enforcement funciona.

**Archivo:** `src/afwk/__tests__/enforcement-smoke.test.ts`

```typescript
import { executeWithPolicyGate, LLMClient } from '../executor';
import { isGetter, isMutator } from '../contracts';

describe('Enforcement Smoke Tests', () => {
  let realLlm: LLMClient;
  let mockLlmNoTools: LLMClient;
  
  beforeAll(() => {
    // Configurar LLM real y mock
    realLlm = createRealLLMClient();
    mockLlmNoTools = {
      generate: async () => ({
        text: 'Ya moví la tarea',  // Claim sin tool
        toolCalls: []
      })
    };
  });
  
  // ─────────────────────────────────────────────────────────
  // Test 1: READ ejecuta getter
  // ─────────────────────────────────────────────────────────
  test('READ: ejecuta getter correctamente', async () => {
    const result = await executeWithPolicyGate('qué hay en todo?', realLlm);
    
    expect(result.success).toBe(true);
    
    // Verificar que realmente ejecutó un getter
    const executedGetter = result.response?.toolCalls?.find(
      tc => tc.executed && isGetter(tc.name)
    );
    expect(executedGetter).toBeDefined();
  });
  
  // ─────────────────────────────────────────────────────────
  // Test 2: MUTATION con ok:true
  // ─────────────────────────────────────────────────────────
  test('MUTATION: ejecuta mutator con ok:true', async () => {
    const result = await executeWithPolicyGate(
      'mueve devTASK-01_login a in_progress',
      realLlm
    );
    
    expect(result.success).toBe(true);
    
    const executedMutator = result.response?.toolCalls?.find(
      tc => tc.executed && isMutator(tc.name) && tc.output?.ok === true
    );
    expect(executedMutator).toBeDefined();
  });
  
  // ─────────────────────────────────────────────────────────
  // Test 3: MUTATION con ok:false (acepta sin retry loop)
  // ─────────────────────────────────────────────────────────
  test('MUTATION: acepta ok:false como evidencia', async () => {
    const result = await executeWithPolicyGate(
      'mueve devTASK-02_no-aitasks a in_progress',  // Fallará validación
      realLlm
    );
    
    expect(result.success).toBe(true);
    
    const failedMutator = result.response?.toolCalls?.find(
      tc => tc.executed && isMutator(tc.name) && tc.output?.ok === false
    );
    expect(failedMutator).toBeDefined();
    expect(failedMutator?.output?.errors.length).toBeGreaterThan(0);
    
    // Verificar que el LLM NO claimó éxito
    const successClaims = /\b(ya (quedó|está listo|se movió)|done|completed|moved)\b/i;
    expect(successClaims.test(result.response?.text || '')).toBe(false);
  });
  
  // ─────────────────────────────────────────────────────────
  // Test 4: CONVERSATION libre
  // ─────────────────────────────────────────────────────────
  test('CONVERSATION: pasa sin tools', async () => {
    const result = await executeWithPolicyGate('explícame el framework', realLlm);
    expect(result.success).toBe(true);
  });
  
  // ─────────────────────────────────────────────────────────
  // Test 5: MUTATION sin tool → hard fail
  // ─────────────────────────────────────────────────────────
  test('MUTATION: hard fail sin tool', async () => {
    const result = await executeWithPolicyGate('mueve algo a todo', mockLlmNoTools);
    
    expect(result.success).toBe(false);
    expect(result.systemMessage).toBeDefined();
    expect(result.systemMessage).toContain('herramientas requeridas');
  });
  
  // ─────────────────────────────────────────────────────────
  // Test 6: READ sin getter → hard fail
  // ─────────────────────────────────────────────────────────
  test('READ: hard fail sin getter', async () => {
    const result = await executeWithPolicyGate('qué hay en todo?', mockLlmNoTools);
    
    expect(result.success).toBe(false);
    expect(result.systemMessage).toBeDefined();
  });
});
```

**Done criteria:**
- [ ] Los 6 tests pasan
- [ ] Smoke test corre en CI
- [ ] Si el smoke test pasa, Fase 1 está completa

---

## 4. Smoke Test (Criterio de Done)

El smoke test es el **criterio oficial** de que Fase 1 está completa.

### Casos Cubiertos

| # | Caso | Expected | Qué valida |
|---|------|----------|------------|
| 1 | Read happy path | success + getter ejecutado | Gate exige getter real |
| 2 | Mutation happy path | success + mutator ok:true | Gate acepta mutator exitoso |
| 3 | Mutation ok:false | success + errors[] + no claim | Gate acepta evidencia de fallo |
| 4 | Conversation | success sin tools | Gate no exige nada |
| 5 | Mutation sin tool | hard fail + systemMessage | Enforcement funciona |
| 6 | Read sin getter | hard fail | Enforcement funciona |

### Ejecución

```bash
npm test -- --testPathPattern=enforcement-smoke
```

---

## 5. Lo que NO Hacer en Fase 1

| ❌ No hacer | Por qué |
|-------------|---------|
| Implementar `createDevTask/createAiTask/completeAiTask` | Primero el enforcement, después las tools |
| Construir motor completo de `rules.yaml` | Hardcodear validaciones es suficiente por ahora |
| UI para `pending_actions` | Puede quedar encolado sin procesador |
| Optimizar performance | Premature optimization |
| Agregar tools al registry antes de implementarlas | El gate no las reconocerá |

---

## 6. Milestone de Éxito

**Fase 1 está completa cuando estas 3 frases se comportan perfectamente:**

1. **"qué hay en todo?"**  
   → `classifyIntent` = read  
   → corre getter  
   → responde con estado real

2. **"mueve devTASK-01_login a in_progress"**  
   → `classifyIntent` = mutation  
   → corre mutator o pide clarificación  
   → NUNCA dice "ya" sin tool

3. **"explícame el framework"**  
   → `classifyIntent` = conversation  
   → no tools  
   → responde normal

---

## 7. Siguiente Fase

Una vez que el smoke test pasa, se puede proceder a **Fase 2: Creación de Contenido**:

1. `afwk:createDevTask`
2. `afwk:createAiTask`
3. `afwk:completeAiTask`
4. Templates (overview.md, aitask-blueprint.md, completion-notes.md)

Cada nueva tool se agrega al `TOOL_REGISTRY` y automáticamente queda protegida por el enforcement.

---

## Checklist Final de Fase 1

- [ ] **Paso 0:** `contracts.ts` con todos los tipos
- [ ] **Paso 1:** `classifyIntent()` + 10 tests
- [ ] **Paso 2:** `policyGate()` + `isClarificationResponse()` + 10 tests
- [ ] **Paso 3:** `executeWithPolicyGate()` integrado
- [ ] **Paso 4:** `executed` instrumentado correctamente
- [ ] **Paso 5:** `state.json` + `appendToAuditLog()`
- [ ] **Paso 6:** Tools existentes actualizadas a contrato
- [ ] **Paso 7:** System prompt compacto
- [ ] **Paso 8:** Smoke test pasando

**Cuando todos los checkboxes estén marcados, Fase 1 está completa.**

---

*Documento generado: 20 enero 2026*  
*Basado en arquitectura v2.1.2 (consenso Claude + ChatGPT)*
