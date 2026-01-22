import { describe, test, expect } from "bun:test"
import { buildLLMResponse, hasAfwkEvidence, getExecutedAfwkTools } from "../evidence"
import type { MessageV2 } from "../../session/message-v2"

// Helper para crear partes de prueba
function createTextPart(text: string): MessageV2.TextPart {
  return {
    id: "part_1",
    messageID: "msg_1",
    sessionID: "sess_1",
    type: "text",
    text,
  }
}

function createToolPart(
  tool: string,
  status: "pending" | "running" | "completed" | "error",
  input: Record<string, unknown> = {},
  metadata?: Record<string, unknown>,
): MessageV2.ToolPart {
  const base = {
    id: "part_2",
    messageID: "msg_1",
    sessionID: "sess_1",
    type: "tool" as const,
    callID: "call_1",
    tool,
  }

  if (status === "pending") {
    return { ...base, state: { status: "pending", input: {}, raw: "" } }
  }

  if (status === "running") {
    return { ...base, state: { status: "running", input, time: { start: Date.now() } } }
  }

  if (status === "completed") {
    return {
      ...base,
      state: {
        status: "completed",
        input,
        output: "success",
        title: "Tool Result",
        metadata: metadata ?? {},
        time: { start: Date.now(), end: Date.now() },
      },
    }
  }

  // error
  return {
    ...base,
    state: {
      status: "error",
      input,
      error: "Something went wrong",
      metadata,
      time: { start: Date.now(), end: Date.now() },
    },
  }
}

describe("buildLLMResponse", () => {
  test("extrae texto de partes de texto", () => {
    const parts: MessageV2.Part[] = [createTextPart("Hello"), createTextPart("World")]

    const response = buildLLMResponse(parts)

    expect(response.text).toBe("Hello\nWorld")
  })

  test("extrae tool calls con executed=true para completed", () => {
    const parts: MessageV2.Part[] = [
      createTextPart("Result"),
      createToolPart("afwk_get_kanban_status", "completed", {}),
    ]

    const response = buildLLMResponse(parts)

    expect(response.toolCalls).toHaveLength(1)
    expect(response.toolCalls![0].name).toBe("afwk_get_kanban_status")
    expect(response.toolCalls![0].executed).toBe(true)
  })

  test("extrae tool calls con executed=true para error", () => {
    const parts: MessageV2.Part[] = [createToolPart("afwk_move_kanban_task", "error", { taskId: "devTASK-01" })]

    const response = buildLLMResponse(parts)

    expect(response.toolCalls).toHaveLength(1)
    expect(response.toolCalls![0].executed).toBe(true)
    expect(response.toolCalls![0].input).toEqual({ taskId: "devTASK-01" })
  })

  test("extrae tool calls con executed=false para pending", () => {
    const parts: MessageV2.Part[] = [createToolPart("afwk_get_kanban_status", "pending")]

    const response = buildLLMResponse(parts)

    expect(response.toolCalls).toHaveLength(1)
    expect(response.toolCalls![0].executed).toBe(false)
  })

  test("extrae tool calls con executed=false para running", () => {
    const parts: MessageV2.Part[] = [createToolPart("afwk_get_kanban_status", "running")]

    const response = buildLLMResponse(parts)

    expect(response.toolCalls).toHaveLength(1)
    expect(response.toolCalls![0].executed).toBe(false)
  })

  test("extrae AfwkToolOutput de metadata.afwk", () => {
    const afwkOutput = {
      ok: true,
      tool_run_id: "tr_123",
      changes: [],
      warnings: [],
      errors: [],
    }

    const parts: MessageV2.Part[] = [createToolPart("afwk_get_kanban_status", "completed", {}, { afwk: afwkOutput })]

    const response = buildLLMResponse(parts)

    expect(response.toolCalls![0].output).toEqual(afwkOutput)
  })

  test("maneja partes vacias", () => {
    const response = buildLLMResponse([])

    expect(response.text).toBe("")
    expect(response.toolCalls).toEqual([])
  })

  test("combina multiples tools", () => {
    const parts: MessageV2.Part[] = [
      createToolPart("afwk_get_kanban_status", "completed"),
      createToolPart("afwk_move_kanban_task", "completed", { taskId: "devTASK-01" }),
    ]

    const response = buildLLMResponse(parts)

    expect(response.toolCalls).toHaveLength(2)
    expect(response.toolCalls![0].name).toBe("afwk_get_kanban_status")
    expect(response.toolCalls![1].name).toBe("afwk_move_kanban_task")
  })
})

describe("hasAfwkEvidence", () => {
  test("retorna true si hay afwk tool ejecutada", () => {
    const parts: MessageV2.Part[] = [createToolPart("afwk_get_kanban_status", "completed")]

    expect(hasAfwkEvidence(parts)).toBe(true)
  })

  test("retorna false si no hay afwk tools", () => {
    const parts: MessageV2.Part[] = [createToolPart("bash", "completed")]

    expect(hasAfwkEvidence(parts)).toBe(false)
  })

  test("retorna false si afwk tool no esta ejecutada", () => {
    const parts: MessageV2.Part[] = [createToolPart("afwk_get_kanban_status", "running")]

    expect(hasAfwkEvidence(parts)).toBe(false)
  })

  test("retorna true para afwk tool con error (tambien es evidencia)", () => {
    const parts: MessageV2.Part[] = [createToolPart("afwk_move_kanban_task", "error")]

    expect(hasAfwkEvidence(parts)).toBe(true)
  })
})

describe("getExecutedAfwkTools", () => {
  test("retorna solo afwk tools ejecutadas", () => {
    const parts: MessageV2.Part[] = [
      createToolPart("bash", "completed"),
      createToolPart("afwk_get_kanban_status", "completed"),
      createToolPart("afwk_move_kanban_task", "running"),
    ]

    const executed = getExecutedAfwkTools(parts)

    expect(executed).toHaveLength(1)
    expect(executed[0].name).toBe("afwk_get_kanban_status")
  })

  test("retorna array vacio si no hay afwk tools ejecutadas", () => {
    const parts: MessageV2.Part[] = [createToolPart("bash", "completed")]

    const executed = getExecutedAfwkTools(parts)

    expect(executed).toEqual([])
  })
})
