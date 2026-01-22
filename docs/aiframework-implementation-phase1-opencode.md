# aiFRAMEWORK Plugin - Guia de Implementacion Fase 1 (OpenCode Fork)

**Version:** 1.0  
**Fecha:** 20 enero 2026  
**Objetivo:** Implementar la tuberia de enforcement antes de agregar mas tools  
**Duracion estimada:** 1-2 semanas  
**Prerequisito:** Documento de arquitectura v2.1.2 aprobado  
**Codebase:** OpenCode fork (`packages/opencode/`)

---

## Tabla de Contenidos

1. [Resumen Ejecutivo](#1-resumen-ejecutivo)
2. [Principio Guia](#2-principio-guia)
3. [Pasos de Implementacion](#3-pasos-de-implementacion)
4. [Smoke Test (Criterio de Done)](#4-smoke-test-criterio-de-done)
5. [Lo que NO hacer en Fase 1](#5-lo-que-no-hacer-en-fase-1)
6. [Milestone de Exito](#6-milestone-de-exito)
7. [Siguiente Fase](#7-siguiente-fase)

---

## 1. Resumen Ejecutivo

**Meta:** Construir un sistema "a prueba de alucinaciones" donde el LLM nunca pueda afirmar cambios sin evidencia de tool ejecutada.

**Enfoque:** Enforcement primero, tools despues. En OpenCode, el enforcement se integra en:
- `packages/opencode/src/session/prompt.ts` (loop principal de turnos)
- `packages/opencode/src/session/processor.ts` (partes de tools ejecutadas)
- `packages/opencode/src/tool/registry.ts` (registro de tools)
- `packages/opencode/src/session/system.ts` (system prompt)

**Entregable:** Un sistema donde:
- `read` → siempre ejecuta getter
- `mutation` → siempre ejecuta mutator o pide clarificacion
- `conversation` → libre
- Violaciones → hard fail (responde el sistema, no el LLM)

---

## 2. Principio Guia

> **"Si el gate no funciona, mas tools = mas superficie de bugs"**

Cada paso debe ser:
1. **Testeable** de forma aislada
2. **Verificable** antes de pasar al siguiente
3. **Minimo** para lograr enforcement real

---

## 3. Pasos de Implementacion

### Paso 0: Definir Contratos y Tipos Compartidos

**Tiempo estimado:** 30-60 minutos

**Objetivo:** Crear un modulo central con todos los tipos para evitar spaghetti.

**Archivo:** `packages/opencode/src/afwk/contracts.ts`

```typescript
// TIPOS DE INTENCION
export type IntentType = "mutation" | "read" | "conversation";

// NOTA OpenCode: los IDs de tool deben ser provider-safe (sin ":")
export const AFWK_TOOL_IDS = {
  getKanbanStatus: "afwk_get_kanban_status",
  moveKanbanTask: "afwk_move_kanban_task",
} as const;

// TOOL REGISTRY (solo tools implementadas en Fase 1)
export const TOOL_REGISTRY = {
  getters: [AFWK_TOOL_IDS.getKanbanStatus],
  mutators: [AFWK_TOOL_IDS.moveKanbanTask],
  // Agregar en Fase 2+:
  // getters: [..., "afwk_get_steering_context", "afwk_validate_devtask"]
  // mutators: [..., "afwk_create_devtask", "afwk_create_aitask", "afwk_complete_aitask"]
} as const;

export type GetterTool = typeof TOOL_REGISTRY.getters[number];
export type MutatorTool = typeof TOOL_REGISTRY.mutators[number];

export function isGetter(toolName: string): toolName is GetterTool {
  return TOOL_REGISTRY.getters.includes(toolName as GetterTool);
}

export function isMutator(toolName: string): toolName is MutatorTool {
  return TOOL_REGISTRY.mutators.includes(toolName as MutatorTool);
}

// CONTRATO DE OUTPUT PARA TOOLS
export interface AfwkToolOutput {
  ok: boolean;
  tool_run_id: string;
  entity_refs?: {
    devTaskId?: string;
    aiTaskId?: string;
  };
  changes: Array<{
    path: string;
    type: "create" | "update" | "move" | "delete";
    summary: string;
  }>;
  warnings: string[];
  errors: string[];
}

// TOOL CALL EVIDENCE (para policy gate)
export interface ToolCallEvidence {
  name: string;
  input: Record<string, unknown>;
  executed: boolean;
  output?: AfwkToolOutput;
}

export interface LLMResponse {
  text: string;
  toolCalls?: ToolCallEvidence[];
}

export interface GateResult {
  success: boolean;
  response?: LLMResponse;
  systemMessage?: string;
}

// ESTADO PERSISTENTE
export interface PendingAction {
  id: string;
  type: string;
  context: Record<string, unknown>;
  created_at: string;
  status: "pending" | "completed" | "skipped";
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
    type: "create" | "update" | "move" | "delete";
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

// HELPERS
import { randomUUID } from "crypto";

export function generateToolRunId(): string {
  return `tr_${randomUUID()}`;
}
```

**Done criteria:**
- [ ] Archivo `contracts.ts` creado
- [ ] Tipos exportados correctamente
- [ ] Tool IDs definidos con nombres provider-safe

---

### Paso 1: Implementar `classifyIntent()`

**Tiempo estimado:** 1-2 horas

**Objetivo:** Funcion determinista que clasifica el mensaje del usuario.

**Archivo:** `packages/opencode/src/afwk/classifier.ts`

```typescript
import { IntentType } from "./contracts";

export function classifyIntent(userMessage: string): IntentType {
  // MUTATION: verbo mutante + ID de entidad o destino explicito
  const mutationPatterns = [
    /\b(devtask-\d{2}|aitask-\d{2})[_\w-]*\b.*\b(a|to|hacia)\s*(backlog|todo|in_progress|completed)\b/i,
    /\b(crea|crear|mueve|mover|completa|completar|actualiza|actualizar|pasa|pasar)\b.{0,50}\b(tarea|task|devtask|aitask)\b.{0,30}\b(a|to|hacia)\s*(backlog|todo|in_progress|completed)\b/i,
    /\b(crea|crear|completa|completar|inicializa)\b.{0,30}\b(devtask|aitask|tarea|task)\b/i,
    /\b(create|move|complete|update|initialize|start|finish)\b.{0,30}\b(devtask-\d{2}|aitask-\d{2})\b/i,
  ];

  // READ: preguntas sobre estado
  const readPatterns = [
    /\b(que hay|cual es el estado|estado del|lista de|cuantos?|muestrame|kanban)\b/i,
    /\b(show me|what'?s|status|list|how many|pending|current state)\b/i,
    /\b(tareas?|tasks?|devtasks?)\s+(en|in|pendientes?|activas?|actuales?)\b/i,
  ];

  if (mutationPatterns.some((p) => p.test(userMessage))) return "mutation";
  if (readPatterns.some((p) => p.test(userMessage))) return "read";
  return "conversation";
}
```

**Tests requeridos:** `packages/opencode/src/afwk/__tests__/classifier.test.ts`

```typescript
import { describe, test, expect } from "bun:test";
import { classifyIntent } from "../classifier";

describe("classifyIntent", () => {
  test("mutation: mueve devTASK con ID a columna", () => {
    expect(classifyIntent("mueve devTASK-01_login a in_progress")).toBe("mutation");
  });

  test("mutation: crea una nueva tarea", () => {
    expect(classifyIntent("crea una nueva tarea para login")).toBe("mutation");
  });

  test("read: que hay en todo", () => {
    expect(classifyIntent("que hay en todo")).toBe("read");
  });

  test("conversation: afirmacion sin comando", () => {
    expect(classifyIntent("el completed tiene 5 tareas")).toBe("conversation");
  });
});
```

**Done criteria:**
- [ ] Funcion `classifyIntent()` implementada
- [ ] Tests pasan con `bun test`
- [ ] No rompe por inputs vacios o raros

---

### Paso 2: Implementar `policyGate()` + `isClarificationResponse()`

**Tiempo estimado:** 2-3 horas

**Objetivo:** Validar que la respuesta del LLM tenga evidencia apropiada.

**Archivo:** `packages/opencode/src/afwk/policy-gate.ts`

```typescript
import { IntentType, LLMResponse, isGetter, isMutator } from "./contracts";

export function isClarificationResponse(text: string): boolean {
  const clarificationSignals = [
    /\b(necesito|falta|cual|que|confirma|especifica|desde|hasta)\b/i,
    /\b(which|what|need|missing|confirm|specify|from|to)\b/i,
    /\b(no (puedo|tengo)|can'?t|don'?t have)\b/i,
    /\?\s*$/,
  ];

  const successClaims = [
    /\b(ya (quedo|esta listo|se movio|se creo|completado))\b/i,
    /\b(done|completed successfully|moved successfully|created)\b/i,
  ];

  const hasSignal = clarificationSignals.some((p) => p.test(text));
  const isShort = text.length < 300;
  const noSuccessClaim = !successClaims.some((p) => p.test(text));

  return hasSignal && isShort && noSuccessClaim;
}

export function policyGate(userIntent: IntentType, llmResponse: LLMResponse): "accept" | "retry" {
  const executedGetter = llmResponse.toolCalls?.find((tc) => tc.executed && isGetter(tc.name));
  const executedMutator = llmResponse.toolCalls?.find((tc) => tc.executed && isMutator(tc.name));

  if (userIntent === "read") {
    if (executedGetter) return "accept";
    return "retry";
  }

  if (userIntent === "mutation") {
    if (executedMutator) return "accept";
    if (isClarificationResponse(llmResponse.text)) return "accept";
    return "retry";
  }

  return "accept";
}
```

**Tests requeridos:** `packages/opencode/src/afwk/__tests__/policy-gate.test.ts`

```typescript
import { describe, test, expect } from "bun:test";
import { policyGate, isClarificationResponse } from "../policy-gate";
import { LLMResponse } from "../contracts";

describe("isClarificationResponse", () => {
  test("detecta pregunta de clarificacion", () => {
    expect(isClarificationResponse("Cual devTASK quieres mover?")).toBe(true);
  });
});

describe("policyGate", () => {
  test("read: acepta con getter ejecutado", () => {
    const response: LLMResponse = {
      text: "Hay 3 tareas en todo",
      toolCalls: [{ name: "afwk_get_kanban_status", input: {}, executed: true }],
    };
    expect(policyGate("read", response)).toBe("accept");
  });
});
```

**Done criteria:**
- [ ] `policyGate()` implementado
- [ ] `isClarificationResponse()` implementado
- [ ] Gate nunca acepta "state claims" sin evidencia

---

### Paso 3: Implementar `executeWithPolicyGate()`

**Tiempo estimado:** 2-3 horas

**Objetivo:** Envolver el llamado al LLM con enforcement real.

**Archivo:** `packages/opencode/src/afwk/executor.ts`

```typescript
import { classifyIntent } from "./classifier";
import { policyGate } from "./policy-gate";
import type { GateResult, IntentType, LLMResponse } from "./contracts";

const MAX_RETRIES = 2;

const SYSTEM_MESSAGES: Record<IntentType, string> = {
  mutation:
    'No pude ejecutar la operacion porque el modelo no uso las herramientas requeridas. Por favor reformula tu solicitud especificando claramente que tarea quieres modificar (ej: "mueve devTASK-01_login a in_progress").',
  read: 'No pude obtener el estado actual porque el modelo no consulto las herramientas requeridas. Por favor pregunta de nuevo (ej: "muestrame el estado del kanban").',
  conversation: "",
};

export async function executeWithPolicyGate(input: {
  userMessage: string;
  runAttempt: (systemSuffix?: string) => Promise<LLMResponse>;
}): Promise<GateResult> {
  const intent = classifyIntent(input.userMessage);
  let lastResponse: LLMResponse | undefined;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    lastResponse = await input.runAttempt(
      attempt > 0
        ? `\n\n[SYSTEM: Previous response lacked required tool execution. For ${intent} intent, you MUST use the appropriate afwk_* tool.]`
        : undefined,
    );

    const decision = policyGate(intent, lastResponse);
    if (decision === "accept") return { success: true, response: lastResponse };
  }

  return {
    success: false,
    systemMessage: SYSTEM_MESSAGES[intent],
  };
}
```

**Integracion en OpenCode:** `packages/opencode/src/session/prompt.ts` (en el loop principal, alrededor de `processor.process`).

**Idea de uso:**
- Construir `LLMResponse` desde `MessageV2.parts` del mensaje asistente actual.
- Si el gate devuelve `retry`, marcar el mensaje asistente como error y reintentar con `systemSuffix`.
- Si falla el maximo de retries, responder con `systemMessage` sintetico (no LLM).

**Done criteria:**
- [ ] `executeWithPolicyGate()` implementado
- [ ] Retry con `systemSuffix` funciona
- [ ] Hard fail retorna `systemMessage`, no respuesta del LLM
- [ ] Integrado en `SessionPrompt.loop`

---

### Paso 4: Instrumentar `executed` en ToolCalls

**Tiempo estimado:** 1-2 horas

**Objetivo:** Asegurar evidencia correcta usando estados de `MessageV2.ToolPart`.

**Archivo:** `packages/opencode/src/afwk/evidence.ts`

```typescript
import { MessageV2 } from "@/session/message-v2";
import type { LLMResponse, ToolCallEvidence, AfwkToolOutput } from "./contracts";

export async function buildLLMResponse(assistantMessageID: string): Promise<LLMResponse> {
  const parts = await MessageV2.parts(assistantMessageID);
  const text = parts
    .filter((p) => p.type === "text")
    .map((p) => p.text)
    .join("\n")
    .trim();

  const toolCalls: ToolCallEvidence[] = parts
    .filter((p) => p.type === "tool")
    .map((p) => {
      const executed = p.state.status === "completed" || p.state.status === "error";
      const output = (p.state.metadata?.afwk as AfwkToolOutput | undefined) ?? undefined;
      return {
        name: p.tool,
        input: p.state.input ?? {},
        executed,
        output,
      };
    });

  return { text, toolCalls };
}
```

**Done criteria:**
- [ ] `executed = true` si `status` es `completed` o `error`
- [ ] `executed = false` si queda `pending` o `running`
- [ ] `output` se obtiene desde `metadata.afwk` cuando existe

---

### Paso 5: Implementar `state.json` + `appendToAuditLog()`

**Tiempo estimado:** 1-2 horas

**Objetivo:** Persistir evidencia de ejecuciones en disco.

**Archivo:** `packages/opencode/src/afwk/state.ts`

```typescript
import * as fs from "fs/promises";
import * as path from "path";
import { Instance } from "@/project/instance";
import { StateJson, AuditLogEntry, PendingAction } from "./contracts";

const STATE_FILE = ".afwk/state.json";
const DEFAULT_MAX_ENTRIES = 1000;

export async function readState(): Promise<StateJson> {
  const statePath = path.join(Instance.worktree, STATE_FILE);
  try {
    const content = await fs.readFile(statePath, "utf-8");
    return JSON.parse(content) as StateJson;
  } catch {
    return {
      schema_version: 1,
      pending_actions: [],
      audit_log: [],
      audit_log_max_entries: DEFAULT_MAX_ENTRIES,
    };
  }
}

export async function writeState(state: StateJson): Promise<void> {
  const statePath = path.join(Instance.worktree, STATE_FILE);
  await fs.mkdir(path.dirname(statePath), { recursive: true });
  await fs.writeFile(statePath, JSON.stringify(state, null, 2), "utf-8");
}

export async function appendToAuditLog(entry: AuditLogEntry): Promise<void> {
  const state = await readState();
  state.audit_log.push(entry);
  while (state.audit_log.length > state.audit_log_max_entries) {
    state.audit_log.shift();
  }
  await writeState(state);
}

export async function enqueuePendingAction(action: PendingAction): Promise<void> {
  const state = await readState();
  state.pending_actions.push(action);
  await writeState(state);
}
```

**Done criteria:**
- [ ] `state.json` se crea con `schema_version: 1`
- [ ] `appendToAuditLog()` persiste correctamente
- [ ] Rotacion FIFO funciona
- [ ] Despues de 1 tool call hay evidencia en disco

---

### Paso 6: Actualizar Tools Existentes para Cumplir Contrato

**Tiempo estimado:** 2-3 horas

**Objetivo:** Las tools `afwk_*` deben retornar `AfwkToolOutput` y registrar en audit log.

**Archivos sugeridos:**
- `packages/opencode/src/tool/afwk.ts` (o `packages/opencode/src/tool/afwk/kanban.ts`)
- `packages/opencode/src/tool/registry.ts` (registrar tools)

**Ejemplo para `afwk_get_kanban_status`:**

```typescript
import { Tool } from "@/tool/tool";
import { generateToolRunId, AfwkToolOutput } from "@/afwk/contracts";
import { appendToAuditLog } from "@/afwk/state";

export const AfwkGetKanbanStatusTool = Tool.define("afwk_get_kanban_status", {
  description: "Read current AFWK kanban status.",
  parameters: z.object({}),
  async execute(_params, _ctx) {
    const runId = generateToolRunId();
    const output: AfwkToolOutput = {
      ok: true,
      tool_run_id: runId,
      changes: [],
      warnings: [],
      errors: [],
    };

    await appendToAuditLog({
      tool_run_id: runId,
      timestamp: new Date().toISOString(),
      tool: "afwk_get_kanban_status",
      input: {},
      output_ok: output.ok,
      changes: output.changes,
      errors: output.errors,
    });

    return {
      title: "afwk_get_kanban_status",
      output: JSON.stringify(output),
      metadata: { afwk: output },
    };
  },
});
```

**Ejemplo para `afwk_move_kanban_task`:**

```typescript
export const AfwkMoveKanbanTaskTool = Tool.define("afwk_move_kanban_task", {
  description: "Move a devTASK between kanban columns.",
  parameters: z.object({
    taskId: z.string(),
    from: z.enum(["backlog", "todo", "in_progress", "completed"]),
    to: z.enum(["backlog", "todo", "in_progress", "completed"]),
  }),
  async execute(params, _ctx) {
    const runId = generateToolRunId();
    const changes: AfwkToolOutput["changes"] = [];

    // mover carpeta, validar reglas minimas, actualizar devTASK.json...

    const output: AfwkToolOutput = {
      ok: true,
      tool_run_id: runId,
      entity_refs: { devTaskId: params.taskId },
      changes,
      warnings: [],
      errors: [],
    };

    await appendToAuditLog({
      tool_run_id: runId,
      timestamp: new Date().toISOString(),
      tool: "afwk_move_kanban_task",
      input: params,
      output_ok: output.ok,
      changes: output.changes,
      errors: output.errors,
      entity_refs: output.entity_refs,
    });

    return {
      title: params.taskId,
      output: JSON.stringify(output),
      metadata: { afwk: output },
    };
  },
});
```

**Registrar tools:** `packages/opencode/src/tool/registry.ts`

```typescript
return [
  // ...
  AfwkGetKanbanStatusTool,
  AfwkMoveKanbanTaskTool,
  // ...
];
```

**Seguridad `.afwk/`:**
- Bloquear modificaciones via `bash`, `edit`, `write`, `patch`, `multiedit`.
- Opcion A: implementar checks directos en cada tool (ej. `edit.ts`, `write.ts`, `bash.ts`).
- Opcion B: crear plugin interno `packages/opencode/src/plugin/afwk.ts` y usar `tool.execute.before` para bloquear rutas `.afwk/`.

**Done criteria:**
- [ ] `afwk_get_kanban_status` retorna `AfwkToolOutput`
- [ ] `afwk_move_kanban_task` retorna `AfwkToolOutput`
- [ ] `metadata.afwk` presente en tool parts
- [ ] Audit log escrito en cada tool call
- [ ] `.afwk/` no se puede modificar via tools nativas

---

### Paso 7: Refactorizar System Prompt

**Tiempo estimado:** 1 hora

**Objetivo:** System prompt compacto (~500 tokens) que guia al LLM.

**Archivo:** `packages/opencode/src/afwk/system-prompt.ts`

```typescript
export function generateSystemPrompt(input: {
  projectName: string;
  kanbanCounts: { backlog: number; todo: number; in_progress: number; completed: number };
  activeTask?: { id: string; status: string };
}): string {
  return `## aiFRAMEWORK Context

**Project:** ${input.projectName}
**Kanban:** ${input.kanbanCounts.backlog} backlog | ${input.kanbanCounts.todo} todo | ${input.kanbanCounts.in_progress} in_progress | ${input.kanbanCounts.completed} completed
${input.activeTask ? `**Active:** ${input.activeTask.id} (${input.activeTask.status})` : ""}

## Rules

1. **Never claim state changes without tool execution.** If you say "moved" or "created", there MUST be an executed afwk_* tool call (with \`ok:true\` or \`ok:false\`) in this turn.
2. **For ANY question about kanban/task state, call afwk_get_kanban_status BEFORE answering.**
3. **Use the appropriate afwk_* tool for operations.** Do not use bash or edit to modify .afwk/ directly.
4. **If you lack information, ask for clarification.**
5. **When a tool returns ok:false, explain the error clearly.**

## Available Tools

### Getters (Read)
- \`afwk_get_kanban_status\` - Read current kanban state (REQUIRED for state questions)

### Mutators (Write)
- \`afwk_move_kanban_task\` - Move task between columns`;
}
```

**Integracion:** agregar al `system` en `packages/opencode/src/session/prompt.ts`:
- `SystemPrompt.environment()` + `SystemPrompt.custom()` + `AfwkSystemPrompt` (solo si `.afwk/` existe)

**Done criteria:**
- [ ] Prompt generado dinamicamente
- [ ] ~500 tokens o menos
- [ ] Incluye conteos (no listas)
- [ ] Incluye reglas y tools disponibles

---

### Paso 8: Smoke Test de Enforcement

**Tiempo estimado:** 1-2 horas

**Objetivo:** Validar end-to-end que el enforcement funciona.

**Archivo:** `packages/opencode/src/afwk/__tests__/enforcement-smoke.test.ts`

```typescript
import { describe, test, expect } from "bun:test";
import { executeWithPolicyGate } from "../executor";

describe("Enforcement Smoke Tests", () => {
  test("READ: ejecuta getter correctamente", async () => {
    const result = await executeWithPolicyGate({
      userMessage: "que hay en todo?",
      runAttempt: async () => ({
        text: "OK",
        toolCalls: [{ name: "afwk_get_kanban_status", input: {}, executed: true }],
      }),
    });
    expect(result.success).toBe(true);
  });
});
```

**Done criteria:**
- [ ] Tests pasan con `bun test`
- [ ] Smoke test valida `read`, `mutation`, `conversation`
- [ ] Hard fail retorna systemMessage

---

## 4. Smoke Test (Criterio de Done)

El smoke test es el **criterio oficial** de que Fase 1 esta completa.

### Casos Cubiertos

| # | Caso | Expected | Que valida |
|---|------|----------|------------|
| 1 | Read happy path | success + getter ejecutado | Gate exige getter real |
| 2 | Mutation happy path | success + mutator ok:true | Gate acepta mutator exitoso |
| 3 | Mutation ok:false | success + errors[] + no claim | Gate acepta evidencia de fallo |
| 4 | Conversation | success sin tools | Gate no exige nada |
| 5 | Mutation sin tool | hard fail + systemMessage | Enforcement funciona |
| 6 | Read sin getter | hard fail | Enforcement funciona |

### Ejecucion

```bash
bun test packages/opencode/src/afwk/__tests__/enforcement-smoke.test.ts
```

---

## 5. Lo que NO Hacer en Fase 1

| No hacer | Por que |
|---------|---------|
| Implementar `createDevTask/createAiTask/completeAiTask` | Primero el enforcement, despues las tools |
| Construir motor completo de `rules.yaml` | Hardcodear validaciones es suficiente por ahora |
| UI para `pending_actions` | Puede quedar encolado sin procesador |
| Optimizar performance | Premature optimization |
| Agregar tools al registry antes de implementarlas | El gate no las reconocera |

---

## 6. Milestone de Exito

**Fase 1 esta completa cuando estas 3 frases se comportan perfectamente:**

1. **"que hay en todo?"**  
   → `classifyIntent` = read  
   → corre getter  
   → responde con estado real

2. **"mueve devTASK-01_login a in_progress"**  
   → `classifyIntent` = mutation  
   → corre mutator o pide clarificacion  
   → NUNCA dice "ya" sin tool

3. **"explicame el framework"**  
   → `classifyIntent` = conversation  
   → no tools  
   → responde normal

---

## 7. Siguiente Fase

Una vez que el smoke test pasa, se puede proceder a **Fase 2: Creacion de Contenido**:

1. `afwk_create_devtask`
2. `afwk_create_aitask`
3. `afwk_complete_aitask`
4. Templates (overview.md, aitask-blueprint.md, completion-notes.md)

Cada nueva tool se agrega al `TOOL_REGISTRY` y automaticamente queda protegida por el enforcement.

---

## Checklist Final de Fase 1

- [ ] **Paso 0:** `contracts.ts` con todos los tipos
- [ ] **Paso 1:** `classifyIntent()` + tests
- [ ] **Paso 2:** `policyGate()` + `isClarificationResponse()` + tests
- [ ] **Paso 3:** `executeWithPolicyGate()` integrado en `SessionPrompt.loop`
- [ ] **Paso 4:** Evidencia de tools usando `MessageV2.ToolPart`
- [ ] **Paso 5:** `state.json` + `appendToAuditLog()`
- [ ] **Paso 6:** Tools `afwk_*` actualizadas a contrato
- [ ] **Paso 7:** System prompt compacto inyectado
- [ ] **Paso 8:** Smoke test pasando

**Cuando todos los checkboxes esten marcados, Fase 1 esta completa.**

---

*Documento generado: 20 enero 2026*  
*Basado en arquitectura v2.1.2 y adaptado al fork de OpenCode*
