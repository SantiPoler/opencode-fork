import { describe, test, expect, mock } from "bun:test"
import { executeWithPolicyGate, getIntentForMessage, MAX_RETRIES, SYSTEM_MESSAGES } from "../executor"
import type { LLMResponse } from "../contracts"

describe("executeWithPolicyGate", () => {
  describe("read intent", () => {
    test("acepta con getter ejecutado en primer intento", async () => {
      const runAttempt = mock(async () => ({
        text: "Hay 3 tareas en todo",
        toolCalls: [{ name: "afwk_get_kanban_status", input: {}, executed: true }],
      }))

      const result = await executeWithPolicyGate({
        userMessage: "que hay en todo?",
        runAttempt,
      })

      expect(result.success).toBe(true)
      expect(result.response?.text).toBe("Hay 3 tareas en todo")
      expect(runAttempt).toHaveBeenCalledTimes(1)
      expect(runAttempt).toHaveBeenCalledWith(undefined)
    })

    test("reintenta y acepta en segundo intento", async () => {
      let attemptCount = 0
      const runAttempt = mock(async (systemSuffix?: string): Promise<LLMResponse> => {
        attemptCount++
        if (attemptCount === 1) {
          // Primer intento: sin tool
          return { text: "Hay tareas", toolCalls: [] }
        }
        // Segundo intento: con tool
        return {
          text: "Hay 3 tareas en todo",
          toolCalls: [{ name: "afwk_get_kanban_status", input: {}, executed: true }],
        }
      })

      const result = await executeWithPolicyGate({
        userMessage: "que hay en todo?",
        runAttempt,
      })

      expect(result.success).toBe(true)
      expect(runAttempt).toHaveBeenCalledTimes(2)
      // Segundo llamado debe tener systemSuffix
      expect(runAttempt.mock.calls[1][0]).toContain("[SYSTEM:")
    })

    test("falla despues de MAX_RETRIES intentos", async () => {
      const runAttempt = mock(async (): Promise<LLMResponse> => ({
        text: "Hay tareas pero no use tool",
        toolCalls: [],
      }))

      const result = await executeWithPolicyGate({
        userMessage: "que hay en todo?",
        runAttempt,
      })

      expect(result.success).toBe(false)
      expect(result.systemMessage).toBe(SYSTEM_MESSAGES.read)
      expect(runAttempt).toHaveBeenCalledTimes(MAX_RETRIES + 1)
    })
  })

  describe("mutation intent", () => {
    test("acepta con mutator ejecutado", async () => {
      const runAttempt = mock(async (): Promise<LLMResponse> => ({
        text: "Tarea movida",
        toolCalls: [
          {
            name: "afwk_move_kanban_task",
            input: { taskId: "devTASK-01", to: "in_progress" },
            executed: true,
          },
        ],
      }))

      const result = await executeWithPolicyGate({
        userMessage: "mueve devTASK-01 a in_progress",
        runAttempt,
      })

      expect(result.success).toBe(true)
      expect(runAttempt).toHaveBeenCalledTimes(1)
    })

    test("acepta clarificacion sin tool", async () => {
      const runAttempt = mock(async (): Promise<LLMResponse> => ({
        text: "Cual devTASK quieres mover?",
        toolCalls: [],
      }))

      const result = await executeWithPolicyGate({
        userMessage: "mueve la tarea a todo",
        runAttempt,
      })

      expect(result.success).toBe(true)
      expect(result.response?.text).toBe("Cual devTASK quieres mover?")
    })

    test("falla con afirmacion sin tool", async () => {
      const runAttempt = mock(async (): Promise<LLMResponse> => ({
        text: "Ya quedo movida la tarea a in_progress",
        toolCalls: [],
      }))

      const result = await executeWithPolicyGate({
        userMessage: "mueve devTASK-01 a in_progress",
        runAttempt,
      })

      expect(result.success).toBe(false)
      expect(result.systemMessage).toBe(SYSTEM_MESSAGES.mutation)
    })

    test("acepta mutator con ok:false (error reportado)", async () => {
      const runAttempt = mock(async (): Promise<LLMResponse> => ({
        text: "No se encontro la tarea",
        toolCalls: [
          {
            name: "afwk_move_kanban_task",
            input: { taskId: "devTASK-99" },
            executed: true,
            output: {
              ok: false,
              tool_run_id: "tr_123",
              changes: [],
              warnings: [],
              errors: ["Task not found"],
            },
          },
        ],
      }))

      const result = await executeWithPolicyGate({
        userMessage: "mueve devTASK-99 a todo",
        runAttempt,
      })

      expect(result.success).toBe(true)
    })
  })

  describe("conversation intent", () => {
    test("acepta sin tools y sin retries", async () => {
      const runAttempt = mock(async (): Promise<LLMResponse> => ({
        text: "El framework te ayuda a organizar tareas de desarrollo",
        toolCalls: [],
      }))

      const result = await executeWithPolicyGate({
        userMessage: "explicame el framework",
        runAttempt,
      })

      expect(result.success).toBe(true)
      expect(result.response?.text).toContain("framework")
      expect(runAttempt).toHaveBeenCalledTimes(1)
    })

    test("no hace retries para conversation", async () => {
      const runAttempt = mock(async (): Promise<LLMResponse> => ({
        text: "Hola!",
      }))

      const result = await executeWithPolicyGate({
        userMessage: "hola",
        runAttempt,
      })

      expect(result.success).toBe(true)
      // Solo 1 llamada, sin retries
      expect(runAttempt).toHaveBeenCalledTimes(1)
    })
  })

  describe("retry behavior", () => {
    test("systemSuffix contiene intent type", async () => {
      let capturedSuffix: string | undefined
      const runAttempt = mock(async (systemSuffix?: string): Promise<LLMResponse> => {
        if (systemSuffix) capturedSuffix = systemSuffix
        return { text: "sin tool", toolCalls: [] }
      })

      await executeWithPolicyGate({
        userMessage: "que hay en todo?",
        runAttempt,
      })

      expect(capturedSuffix).toContain("read")
      expect(capturedSuffix).toContain("afwk_*")
    })

    test("hace exactamente MAX_RETRIES + 1 intentos", async () => {
      const runAttempt = mock(async (): Promise<LLMResponse> => ({
        text: "sin tool",
        toolCalls: [],
      }))

      await executeWithPolicyGate({
        userMessage: "que hay en todo?",
        runAttempt,
      })

      expect(runAttempt).toHaveBeenCalledTimes(MAX_RETRIES + 1)
    })
  })
})

describe("getIntentForMessage", () => {
  test("retorna intent correcto", () => {
    expect(getIntentForMessage("que hay en todo?")).toBe("read")
    expect(getIntentForMessage("mueve devTASK-01 a completed")).toBe("mutation")
    expect(getIntentForMessage("hola")).toBe("conversation")
  })
})

describe("exported constants", () => {
  test("MAX_RETRIES es numero positivo", () => {
    expect(MAX_RETRIES).toBeGreaterThan(0)
  })

  test("SYSTEM_MESSAGES tiene mensajes para cada intent", () => {
    expect(SYSTEM_MESSAGES.read).toBeTruthy()
    expect(SYSTEM_MESSAGES.mutation).toBeTruthy()
    expect(SYSTEM_MESSAGES.conversation).toBe("")
  })
})
