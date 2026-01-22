import { describe, test, expect } from "bun:test"
import { policyGate, isClarificationResponse } from "../policy-gate"
import type { LLMResponse } from "../contracts"

describe("isClarificationResponse", () => {
  describe("detects clarification", () => {
    test("pregunta en espanol", () => {
      expect(isClarificationResponse("Cual devTASK quieres mover?")).toBe(true)
    })

    test("pregunta en ingles", () => {
      expect(isClarificationResponse("Which task do you want to move?")).toBe(true)
    })

    test("falta informacion", () => {
      expect(isClarificationResponse("Necesito saber el destino de la tarea")).toBe(true)
    })

    test("no puedo sin mas info", () => {
      expect(isClarificationResponse("No puedo mover la tarea sin el destino")).toBe(true)
    })

    test("termina con pregunta", () => {
      expect(isClarificationResponse("Desde cual columna?")).toBe(true)
    })
  })

  describe("rejects non-clarification", () => {
    test("success claim en espanol", () => {
      expect(isClarificationResponse("Ya quedo movida la tarea")).toBe(false)
    })

    test("success claim en ingles", () => {
      expect(isClarificationResponse("Task moved successfully")).toBe(false)
    })

    test("completed claim", () => {
      expect(isClarificationResponse("Done! The task is now in progress")).toBe(false)
    })

    test("texto largo con pregunta", () => {
      const longText = "a".repeat(350) + "?"
      expect(isClarificationResponse(longText)).toBe(false)
    })

    test("empty string", () => {
      expect(isClarificationResponse("")).toBe(false)
    })

    test("statement sin pregunta", () => {
      expect(isClarificationResponse("El sistema esta funcionando correctamente")).toBe(false)
    })
  })
})

describe("policyGate", () => {
  describe("read intent", () => {
    test("acepta con getter ejecutado", () => {
      const response: LLMResponse = {
        text: "Hay 3 tareas en todo",
        toolCalls: [{ name: "afwk_get_kanban_status", input: {}, executed: true }],
      }
      expect(policyGate("read", response)).toBe("accept")
    })

    test("rechaza sin getter", () => {
      const response: LLMResponse = {
        text: "Hay 3 tareas en todo",
        toolCalls: [],
      }
      expect(policyGate("read", response)).toBe("retry")
    })

    test("rechaza con getter no ejecutado", () => {
      const response: LLMResponse = {
        text: "Hay 3 tareas en todo",
        toolCalls: [{ name: "afwk_get_kanban_status", input: {}, executed: false }],
      }
      expect(policyGate("read", response)).toBe("retry")
    })

    test("rechaza con mutator en lugar de getter", () => {
      const response: LLMResponse = {
        text: "Hay 3 tareas",
        toolCalls: [{ name: "afwk_move_kanban_task", input: {}, executed: true }],
      }
      expect(policyGate("read", response)).toBe("retry")
    })
  })

  describe("mutation intent", () => {
    test("acepta con mutator ejecutado", () => {
      const response: LLMResponse = {
        text: "Tarea movida a in_progress",
        toolCalls: [
          {
            name: "afwk_move_kanban_task",
            input: { taskId: "devTASK-01", from: "todo", to: "in_progress" },
            executed: true,
          },
        ],
      }
      expect(policyGate("mutation", response)).toBe("accept")
    })

    test("acepta clarificacion sin tool", () => {
      const response: LLMResponse = {
        text: "Cual devTASK quieres mover?",
        toolCalls: [],
      }
      expect(policyGate("mutation", response)).toBe("accept")
    })

    test("rechaza afirmacion sin tool ni clarificacion", () => {
      const response: LLMResponse = {
        text: "La tarea ya esta en in_progress",
        toolCalls: [],
      }
      expect(policyGate("mutation", response)).toBe("retry")
    })

    test("rechaza mutator no ejecutado", () => {
      const response: LLMResponse = {
        text: "Moviendo tarea...",
        toolCalls: [
          {
            name: "afwk_move_kanban_task",
            input: {},
            executed: false,
          },
        ],
      }
      expect(policyGate("mutation", response)).toBe("retry")
    })

    test("acepta con mutator ok:false (error reportado)", () => {
      const response: LLMResponse = {
        text: "No se pudo mover: la tarea no existe",
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
              errors: ["Task not found: devTASK-99"],
            },
          },
        ],
      }
      expect(policyGate("mutation", response)).toBe("accept")
    })
  })

  describe("conversation intent", () => {
    test("acepta sin tools", () => {
      const response: LLMResponse = {
        text: "El framework te ayuda a organizar tareas",
        toolCalls: [],
      }
      expect(policyGate("conversation", response)).toBe("accept")
    })

    test("acepta con tools (no requerido)", () => {
      const response: LLMResponse = {
        text: "Aqui esta la info",
        toolCalls: [{ name: "afwk_get_kanban_status", input: {}, executed: true }],
      }
      expect(policyGate("conversation", response)).toBe("accept")
    })

    test("acepta mensaje vacio", () => {
      const response: LLMResponse = {
        text: "",
      }
      expect(policyGate("conversation", response)).toBe("accept")
    })
  })

  describe("edge cases", () => {
    test("toolCalls undefined para read", () => {
      const response: LLMResponse = {
        text: "Estado del kanban",
      }
      expect(policyGate("read", response)).toBe("retry")
    })

    test("toolCalls undefined para mutation con clarificacion", () => {
      const response: LLMResponse = {
        text: "Necesito saber cual tarea?",
      }
      expect(policyGate("mutation", response)).toBe("accept")
    })

    test("multiple tools con al menos un getter ejecutado", () => {
      const response: LLMResponse = {
        text: "Aqui esta el estado",
        toolCalls: [
          { name: "other_tool", input: {}, executed: true },
          { name: "afwk_get_kanban_status", input: {}, executed: true },
        ],
      }
      expect(policyGate("read", response)).toBe("accept")
    })
  })
})
