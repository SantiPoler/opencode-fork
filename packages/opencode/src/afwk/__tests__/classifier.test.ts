import { describe, test, expect } from "bun:test"
import { classifyIntent } from "../classifier"

describe("classifyIntent", () => {
  describe("mutation intents", () => {
    test("mueve devTASK con ID a columna", () => {
      expect(classifyIntent("mueve devTASK-01_login a in_progress")).toBe("mutation")
    })

    test("mueve devTASK con ID a columna (ingles)", () => {
      expect(classifyIntent("move devTASK-01 to completed")).toBe("mutation")
    })

    test("crea una nueva tarea", () => {
      expect(classifyIntent("crea una nueva tarea para login")).toBe("mutation")
    })

    test("crea devtask", () => {
      expect(classifyIntent("crea devtask para autenticacion")).toBe("mutation")
    })

    test("completa tarea con ID", () => {
      expect(classifyIntent("completa devTASK-02")).toBe("mutation")
    })

    test("pasa tarea a columna", () => {
      expect(classifyIntent("pasa la tarea devtask-01 a todo")).toBe("mutation")
    })

    test("create task (ingles)", () => {
      expect(classifyIntent("create devtask-01 for authentication")).toBe("mutation")
    })

    test("update task (ingles)", () => {
      expect(classifyIntent("update devtask-03 status")).toBe("mutation")
    })

    test("inicializa aitask", () => {
      expect(classifyIntent("inicializa aitask para el modulo de pago")).toBe("mutation")
    })
  })

  describe("read intents", () => {
    test("que hay en todo", () => {
      expect(classifyIntent("que hay en todo")).toBe("read")
    })

    test("que hay en backlog", () => {
      expect(classifyIntent("que hay en backlog")).toBe("read")
    })

    test("muestrame el kanban", () => {
      expect(classifyIntent("muestrame el kanban")).toBe("read")
    })

    test("cual es el estado del proyecto", () => {
      expect(classifyIntent("cual es el estado del proyecto")).toBe("read")
    })

    test("cuantas tareas hay", () => {
      expect(classifyIntent("cuantas tareas hay")).toBe("read")
    })

    test("lista de tareas pendientes", () => {
      expect(classifyIntent("lista de tareas pendientes")).toBe("read")
    })

    test("show me the status (ingles)", () => {
      expect(classifyIntent("show me the status")).toBe("read")
    })

    test("what's in todo (ingles)", () => {
      expect(classifyIntent("what's in todo")).toBe("read")
    })

    test("how many pending tasks (ingles)", () => {
      expect(classifyIntent("how many pending tasks")).toBe("read")
    })

    test("tareas en in_progress", () => {
      expect(classifyIntent("tareas en in_progress")).toBe("read")
    })
  })

  describe("conversation intents", () => {
    test("afirmacion sin comando", () => {
      expect(classifyIntent("el completed tiene 5 tareas")).toBe("conversation")
    })

    test("explicacion general", () => {
      expect(classifyIntent("explicame el framework")).toBe("conversation")
    })

    test("saludo", () => {
      expect(classifyIntent("hola")).toBe("conversation")
    })

    test("pregunta general", () => {
      expect(classifyIntent("como funciona esto")).toBe("conversation")
    })

    test("comentario sobre codigo", () => {
      expect(classifyIntent("el codigo esta bien estructurado")).toBe("conversation")
    })

    test("mensaje vacio", () => {
      expect(classifyIntent("")).toBe("conversation")
    })

    test("solo espacios", () => {
      expect(classifyIntent("   ")).toBe("conversation")
    })
  })

  describe("edge cases", () => {
    test("null-like input", () => {
      // @ts-expect-error - testing null handling
      expect(classifyIntent(null)).toBe("conversation")
    })

    test("undefined-like input", () => {
      // @ts-expect-error - testing undefined handling
      expect(classifyIntent(undefined)).toBe("conversation")
    })

    test("mixed case", () => {
      expect(classifyIntent("MUEVE DevTask-01 A TODO")).toBe("mutation")
    })

    test("extra whitespace", () => {
      expect(classifyIntent("  que hay en todo  ")).toBe("read")
    })
  })
})
