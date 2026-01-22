/**
 * aiFRAMEWORK Enforcement Smoke Tests
 *
 * Este archivo es el CRITERIO OFICIAL de que Fase 1 esta completa.
 *
 * Casos cubiertos:
 * | # | Caso                  | Expected                      | Que valida                    |
 * |---|-----------------------|-------------------------------|-------------------------------|
 * | 1 | Read happy path       | success + getter ejecutado    | Gate exige getter real        |
 * | 2 | Mutation happy path   | success + mutator ok:true     | Gate acepta mutator exitoso   |
 * | 3 | Mutation ok:false     | success + errors[] + no claim | Gate acepta evidencia de fallo|
 * | 4 | Conversation          | success sin tools             | Gate no exige nada            |
 * | 5 | Mutation sin tool     | hard fail + systemMessage     | Enforcement funciona          |
 * | 6 | Read sin getter       | hard fail                     | Enforcement funciona          |
 */

import { describe, test, expect, mock } from "bun:test"
import { executeWithPolicyGate, SYSTEM_MESSAGES } from "../executor"
import { classifyIntent } from "../classifier"
import { policyGate } from "../policy-gate"
import { buildLLMResponse } from "../evidence"
import { AFWK_TOOL_IDS, type LLMResponse, type AfwkToolOutput } from "../contracts"
import type { MessageV2 } from "../../session/message-v2"

// ============================================================================
// HELPERS
// ============================================================================

function createMockResponse(config: {
  text: string
  tools?: Array<{
    name: string
    input?: Record<string, unknown>
    executed: boolean
    output?: AfwkToolOutput
  }>
}): LLMResponse {
  return {
    text: config.text,
    toolCalls: config.tools?.map((t) => ({
      name: t.name,
      input: t.input ?? {},
      executed: t.executed,
      output: t.output,
    })),
  }
}

function createAfwkOutput(ok: boolean, errors: string[] = []): AfwkToolOutput {
  return {
    ok,
    tool_run_id: `tr_test_${Date.now()}`,
    changes: ok ? [{ path: ".afwk/kanban/todo/task", type: "move", summary: "Moved task" }] : [],
    warnings: [],
    errors,
  }
}

// ============================================================================
// SMOKE TESTS - Criterio de Done para Fase 1
// ============================================================================

describe("Enforcement Smoke Tests", () => {
  describe("Caso 1: READ happy path", () => {
    test("ejecuta getter correctamente y acepta respuesta", async () => {
      const userMessage = "que hay en todo?"

      // Verificar clasificacion
      expect(classifyIntent(userMessage)).toBe("read")

      // Simular respuesta con getter ejecutado
      const response = createMockResponse({
        text: "Hay 3 tareas en todo: devTASK-01, devTASK-02, devTASK-03",
        tools: [
          {
            name: AFWK_TOOL_IDS.getKanbanStatus,
            executed: true,
            output: createAfwkOutput(true),
          },
        ],
      })

      // Verificar que policy gate acepta
      expect(policyGate("read", response)).toBe("accept")

      // Verificar flujo completo con executeWithPolicyGate
      const result = await executeWithPolicyGate({
        userMessage,
        runAttempt: mock(async () => response),
      })

      expect(result.success).toBe(true)
      expect(result.response?.text).toContain("3 tareas")
      expect(result.response?.toolCalls?.[0].executed).toBe(true)
    })

    test("show me the status (ingles)", async () => {
      const userMessage = "show me the kanban status"

      expect(classifyIntent(userMessage)).toBe("read")

      const response = createMockResponse({
        text: "Current status: 2 in backlog, 3 in todo",
        tools: [{ name: AFWK_TOOL_IDS.getKanbanStatus, executed: true }],
      })

      const result = await executeWithPolicyGate({
        userMessage,
        runAttempt: mock(async () => response),
      })

      expect(result.success).toBe(true)
    })
  })

  describe("Caso 2: MUTATION happy path", () => {
    test("ejecuta mutator con ok:true", async () => {
      const userMessage = "mueve devTASK-01_login a in_progress"

      // Verificar clasificacion
      expect(classifyIntent(userMessage)).toBe("mutation")

      // Simular respuesta con mutator ejecutado exitosamente
      const response = createMockResponse({
        text: "devTASK-01_login movido a in_progress",
        tools: [
          {
            name: AFWK_TOOL_IDS.moveKanbanTask,
            input: { taskId: "devTASK-01_login", from: "todo", to: "in_progress" },
            executed: true,
            output: createAfwkOutput(true),
          },
        ],
      })

      // Verificar que policy gate acepta
      expect(policyGate("mutation", response)).toBe("accept")

      // Verificar flujo completo
      const result = await executeWithPolicyGate({
        userMessage,
        runAttempt: mock(async () => response),
      })

      expect(result.success).toBe(true)
      expect(result.response?.toolCalls?.[0].output?.ok).toBe(true)
    })

    test("move devTASK to completed (ingles)", async () => {
      const userMessage = "move devTASK-02 to completed"

      expect(classifyIntent(userMessage)).toBe("mutation")

      const response = createMockResponse({
        text: "Task moved successfully",
        tools: [
          {
            name: AFWK_TOOL_IDS.moveKanbanTask,
            executed: true,
            output: createAfwkOutput(true),
          },
        ],
      })

      const result = await executeWithPolicyGate({
        userMessage,
        runAttempt: mock(async () => response),
      })

      expect(result.success).toBe(true)
    })
  })

  describe("Caso 3: MUTATION ok:false (error reportado)", () => {
    test("acepta mutator con ok:false y errors[]", async () => {
      const userMessage = "mueve devTASK-99 a todo"

      expect(classifyIntent(userMessage)).toBe("mutation")

      // Simular respuesta con mutator que fallo
      const response = createMockResponse({
        text: "No se pudo mover la tarea: devTASK-99 no existe",
        tools: [
          {
            name: AFWK_TOOL_IDS.moveKanbanTask,
            input: { taskId: "devTASK-99", from: "backlog", to: "todo" },
            executed: true,
            output: createAfwkOutput(false, ["Task not found: devTASK-99"]),
          },
        ],
      })

      // Policy gate DEBE aceptar porque hay evidencia (aunque sea de error)
      expect(policyGate("mutation", response)).toBe("accept")

      const result = await executeWithPolicyGate({
        userMessage,
        runAttempt: mock(async () => response),
      })

      expect(result.success).toBe(true)
      expect(result.response?.toolCalls?.[0].output?.ok).toBe(false)
      expect(result.response?.toolCalls?.[0].output?.errors).toContain("Task not found: devTASK-99")
    })
  })

  describe("Caso 4: CONVERSATION (sin requisitos)", () => {
    test("acepta respuesta sin tools", async () => {
      const userMessage = "explicame el framework"

      // Verificar clasificacion
      expect(classifyIntent(userMessage)).toBe("conversation")

      // Simular respuesta conversacional sin tools
      const response = createMockResponse({
        text: "El aiFRAMEWORK es un sistema para gestionar tareas de desarrollo...",
      })

      // Policy gate debe aceptar (conversation no requiere tools)
      expect(policyGate("conversation", response)).toBe("accept")

      const result = await executeWithPolicyGate({
        userMessage,
        runAttempt: mock(async () => response),
      })

      expect(result.success).toBe(true)
      expect(result.response?.toolCalls).toBeUndefined()
    })

    test("hola (saludo)", async () => {
      const userMessage = "hola"

      expect(classifyIntent(userMessage)).toBe("conversation")

      const result = await executeWithPolicyGate({
        userMessage,
        runAttempt: mock(async () => ({ text: "Hola! En que puedo ayudarte?" })),
      })

      expect(result.success).toBe(true)
    })

    test("el completed tiene 5 tareas (afirmacion sin comando)", async () => {
      const userMessage = "el completed tiene 5 tareas"

      expect(classifyIntent(userMessage)).toBe("conversation")

      const result = await executeWithPolicyGate({
        userMessage,
        runAttempt: mock(async () => ({ text: "Entendido." })),
      })

      expect(result.success).toBe(true)
    })
  })

  describe("Caso 5: MUTATION sin tool (hard fail)", () => {
    test("rechaza afirmacion de cambio sin evidencia de tool", async () => {
      const userMessage = "mueve devTASK-01 a in_progress"

      expect(classifyIntent(userMessage)).toBe("mutation")

      // Simular respuesta que AFIRMA haber movido pero sin tool
      const badResponse = createMockResponse({
        text: "Ya quedo movida la tarea devTASK-01 a in_progress",
        tools: [], // NO hay tools ejecutadas!
      })

      // Policy gate DEBE rechazar
      expect(policyGate("mutation", badResponse)).toBe("retry")

      // executeWithPolicyGate debe fallar despues de retries
      const runAttempt = mock(async () => badResponse)

      const result = await executeWithPolicyGate({
        userMessage,
        runAttempt,
      })

      expect(result.success).toBe(false)
      expect(result.systemMessage).toBe(SYSTEM_MESSAGES.mutation)
      // Debe haber intentado multiples veces
      expect(runAttempt.mock.calls.length).toBeGreaterThan(1)
    })

    test("rechaza claim de exito sin tool ejecutada", async () => {
      const userMessage = "crea una nueva tarea para login"

      expect(classifyIntent(userMessage)).toBe("mutation")

      // LLM dice que creo pero no uso tool
      const badResponse = createMockResponse({
        text: "Listo! Ya cree la tarea devTASK-05_login en backlog",
      })

      const result = await executeWithPolicyGate({
        userMessage,
        runAttempt: mock(async () => badResponse),
      })

      expect(result.success).toBe(false)
      expect(result.systemMessage).toContain("herramientas requeridas")
    })
  })

  describe("Caso 6: READ sin getter (hard fail)", () => {
    test("rechaza respuesta de estado sin getter ejecutado", async () => {
      const userMessage = "que hay en todo?"

      expect(classifyIntent(userMessage)).toBe("read")

      // Simular respuesta que AFIRMA estado sin consultar
      const badResponse = createMockResponse({
        text: "Hay 3 tareas en todo",
        tools: [], // NO consulto el getter!
      })

      // Policy gate DEBE rechazar
      expect(policyGate("read", badResponse)).toBe("retry")

      const runAttempt = mock(async () => badResponse)

      const result = await executeWithPolicyGate({
        userMessage,
        runAttempt,
      })

      expect(result.success).toBe(false)
      expect(result.systemMessage).toBe(SYSTEM_MESSAGES.read)
      expect(runAttempt.mock.calls.length).toBeGreaterThan(1)
    })

    test("rechaza respuesta con getter no ejecutado (pending)", async () => {
      const userMessage = "muestrame el kanban"

      expect(classifyIntent(userMessage)).toBe("read")

      // Getter presente pero no ejecutado
      const badResponse = createMockResponse({
        text: "Consultando el estado...",
        tools: [{ name: AFWK_TOOL_IDS.getKanbanStatus, executed: false }],
      })

      expect(policyGate("read", badResponse)).toBe("retry")

      const result = await executeWithPolicyGate({
        userMessage,
        runAttempt: mock(async () => badResponse),
      })

      expect(result.success).toBe(false)
    })
  })

  describe("Casos adicionales de clarificacion", () => {
    test("acepta clarificacion valida para mutation", async () => {
      const userMessage = "mueve la tarea a todo"

      expect(classifyIntent(userMessage)).toBe("mutation")

      // LLM pide clarificacion en lugar de ejecutar
      const clarificationResponse = createMockResponse({
        text: "Cual devTASK quieres mover a todo?",
      })

      // Policy gate DEBE aceptar clarificacion
      expect(policyGate("mutation", clarificationResponse)).toBe("accept")

      const result = await executeWithPolicyGate({
        userMessage,
        runAttempt: mock(async () => clarificationResponse),
      })

      expect(result.success).toBe(true)
      expect(result.response?.text).toContain("Cual")
    })

    test("rechaza clarificacion que es realmente un claim", async () => {
      const userMessage = "mueve devTASK-01 a completed"

      // Esto parece pregunta pero tiene claim de exito
      const fakeClariResponse = createMockResponse({
        text: "Ya esta listo! Quieres que mueva otra?",
      })

      // Debe rechazar porque "Ya esta listo" es un success claim
      expect(policyGate("mutation", fakeClariResponse)).toBe("retry")
    })
  })
})

// ============================================================================
// INTEGRATION: buildLLMResponse con MessageV2.Part
// ============================================================================

describe("Evidence Integration", () => {
  test("buildLLMResponse extrae correctamente de MessageV2.Part", () => {
    // Simular parts como vendrian de MessageV2
    const parts: MessageV2.Part[] = [
      {
        id: "p1",
        messageID: "m1",
        sessionID: "s1",
        type: "text",
        text: "Aqui esta el estado del kanban",
      },
      {
        id: "p2",
        messageID: "m1",
        sessionID: "s1",
        type: "tool",
        callID: "c1",
        tool: AFWK_TOOL_IDS.getKanbanStatus,
        state: {
          status: "completed",
          input: {},
          output: "Kanban status...",
          title: "Kanban Status",
          metadata: {
            afwk: createAfwkOutput(true),
          },
          time: { start: Date.now(), end: Date.now() },
        },
      },
    ]

    const llmResponse = buildLLMResponse(parts)

    expect(llmResponse.text).toBe("Aqui esta el estado del kanban")
    expect(llmResponse.toolCalls).toHaveLength(1)
    expect(llmResponse.toolCalls![0].name).toBe(AFWK_TOOL_IDS.getKanbanStatus)
    expect(llmResponse.toolCalls![0].executed).toBe(true)
    expect(llmResponse.toolCalls![0].output?.ok).toBe(true)

    // Verificar que pasa policy gate
    expect(policyGate("read", llmResponse)).toBe("accept")
  })
})

// ============================================================================
// MILESTONE DE EXITO - Las 3 frases clave
// ============================================================================

describe("Milestone de Exito - 3 frases clave", () => {
  test('1. "que hay en todo?" → read → getter → responde estado real', async () => {
    const userMessage = "que hay en todo?"

    // Clasificacion correcta
    expect(classifyIntent(userMessage)).toBe("read")

    // Con getter ejecutado → acepta
    const goodResponse = createMockResponse({
      text: "En todo hay: devTASK-01, devTASK-02",
      tools: [{ name: AFWK_TOOL_IDS.getKanbanStatus, executed: true }],
    })
    expect(policyGate("read", goodResponse)).toBe("accept")

    // Sin getter → rechaza
    const badResponse = createMockResponse({ text: "En todo hay 2 tareas" })
    expect(policyGate("read", badResponse)).toBe("retry")
  })

  test('2. "mueve devTASK-01_login a in_progress" → mutation → mutator o clarificacion → NUNCA dice "ya" sin tool', async () => {
    const userMessage = "mueve devTASK-01_login a in_progress"

    // Clasificacion correcta
    expect(classifyIntent(userMessage)).toBe("mutation")

    // Con mutator ejecutado → acepta
    const goodResponse = createMockResponse({
      text: "Movido correctamente",
      tools: [{ name: AFWK_TOOL_IDS.moveKanbanTask, executed: true }],
    })
    expect(policyGate("mutation", goodResponse)).toBe("accept")

    // Con clarificacion → acepta
    const clarifyResponse = createMockResponse({ text: "Desde cual columna?" })
    expect(policyGate("mutation", clarifyResponse)).toBe("accept")

    // Con claim sin tool → RECHAZA
    const badResponse = createMockResponse({ text: "Ya quedo movida la tarea" })
    expect(policyGate("mutation", badResponse)).toBe("retry")
  })

  test('3. "explicame el framework" → conversation → no tools → responde normal', async () => {
    const userMessage = "explicame el framework"

    // Clasificacion correcta
    expect(classifyIntent(userMessage)).toBe("conversation")

    // Sin tools → acepta (conversation no requiere nada)
    const response = createMockResponse({
      text: "El framework es un sistema de gestion de tareas...",
    })
    expect(policyGate("conversation", response)).toBe("accept")

    // Incluso con tools → acepta (no hay requisito)
    const responseWithTools = createMockResponse({
      text: "El framework...",
      tools: [{ name: "random_tool", executed: true }],
    })
    expect(policyGate("conversation", responseWithTools)).toBe("accept")
  })
})
