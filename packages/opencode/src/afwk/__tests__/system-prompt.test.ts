import { describe, test, expect } from "bun:test"
import {
  generateSystemPrompt,
  generateMinimalSystemPrompt,
  estimateTokenCount,
  generateSystemPromptWithLimit,
  AFWK_CORE_RULES,
} from "../system-prompt"
import { AFWK_TOOL_IDS } from "../contracts"

const sampleInput = {
  projectName: "my-project",
  kanbanCounts: {
    backlog: 5,
    todo: 3,
    in_progress: 2,
    completed: 10,
  },
}

describe("generateSystemPrompt", () => {
  test("incluye nombre del proyecto", () => {
    const prompt = generateSystemPrompt(sampleInput)

    expect(prompt).toContain("my-project")
  })

  test("incluye conteos del kanban", () => {
    const prompt = generateSystemPrompt(sampleInput)

    expect(prompt).toContain("5 backlog")
    expect(prompt).toContain("3 todo")
    expect(prompt).toContain("2 in_progress")
    expect(prompt).toContain("10 completed")
  })

  test("incluye tool IDs", () => {
    const prompt = generateSystemPrompt(sampleInput)

    expect(prompt).toContain(AFWK_TOOL_IDS.getKanbanStatus)
    expect(prompt).toContain(AFWK_TOOL_IDS.moveKanbanTask)
  })

  test("incluye reglas de enforcement", () => {
    const prompt = generateSystemPrompt(sampleInput)

    expect(prompt).toContain("Never claim state changes without tool execution")
    expect(prompt).toContain("BEFORE answering")
  })

  test("incluye active task si se proporciona", () => {
    const inputWithActive = {
      ...sampleInput,
      activeTask: { id: "devTASK-01", status: "in_progress" },
    }

    const prompt = generateSystemPrompt(inputWithActive)

    expect(prompt).toContain("devTASK-01")
    expect(prompt).toContain("in_progress")
  })

  test("no incluye active task si no se proporciona", () => {
    const prompt = generateSystemPrompt(sampleInput)

    expect(prompt).not.toContain("Active Task")
  })
})

describe("generateMinimalSystemPrompt", () => {
  test("es mas corto que el prompt completo", () => {
    const full = generateSystemPrompt(sampleInput)
    const minimal = generateMinimalSystemPrompt(sampleInput)

    expect(minimal.length).toBeLessThan(full.length)
  })

  test("incluye conteos abreviados", () => {
    const prompt = generateMinimalSystemPrompt(sampleInput)

    expect(prompt).toContain("5B") // backlog
    expect(prompt).toContain("3T") // todo
    expect(prompt).toContain("2P") // in_progress
    expect(prompt).toContain("10C") // completed
  })

  test("incluye reglas core", () => {
    const prompt = generateMinimalSystemPrompt(sampleInput)

    expect(prompt).toContain("afwk_*")
  })
})

describe("estimateTokenCount", () => {
  test("estima ~4 caracteres por token", () => {
    const text = "a".repeat(400) // 400 caracteres

    const estimate = estimateTokenCount(text)

    expect(estimate).toBe(100) // 400 / 4 = 100
  })

  test("redondea hacia arriba", () => {
    const text = "a".repeat(401) // 401 caracteres

    const estimate = estimateTokenCount(text)

    expect(estimate).toBe(101) // ceil(401 / 4) = 101
  })
})

describe("generateSystemPromptWithLimit", () => {
  test("usa prompt completo si cabe en el limite", () => {
    const result = generateSystemPromptWithLimit(sampleInput, 2000)

    expect(result.withinLimit).toBe(true)
    expect(result.prompt).toContain("## Rules")
  })

  test("usa prompt minimal si excede el limite", () => {
    const result = generateSystemPromptWithLimit(sampleInput, 50) // muy pequeño

    expect(result.prompt).not.toContain("## Rules")
    expect(result.prompt).toContain("aiFRAMEWORK")
  })

  test("retorna estimacion de tokens", () => {
    const result = generateSystemPromptWithLimit(sampleInput)

    expect(result.tokenEstimate).toBeGreaterThan(0)
    expect(typeof result.tokenEstimate).toBe("number")
  })
})

describe("AFWK_CORE_RULES", () => {
  test("contiene las 6 reglas core", () => {
    expect(AFWK_CORE_RULES).toContain("Never claim state changes")
    expect(AFWK_CORE_RULES).toContain("afwk_get_kanban_status")
    expect(AFWK_CORE_RULES).toContain("afwk_*")
    expect(AFWK_CORE_RULES).toContain("clarification")
    expect(AFWK_CORE_RULES).toContain("ok:false")
    expect(AFWK_CORE_RULES).toContain("steering docs")
  })

  test("no tiene lineas vacias al inicio o final", () => {
    expect(AFWK_CORE_RULES.startsWith("1.")).toBe(true)
    expect(AFWK_CORE_RULES.endsWith("project context")).toBe(true)
  })
})

describe("prompt token budget", () => {
  test("prompt completo esta bajo 600 tokens", () => {
    const prompt = generateSystemPrompt(sampleInput)
    const tokens = estimateTokenCount(prompt)

    // Deberia estar bajo 600 tokens (incluye Context-First Principle)
    expect(tokens).toBeGreaterThan(100)
    expect(tokens).toBeLessThan(600)
  })

  test("prompt minimal esta bajo 200 tokens", () => {
    const prompt = generateMinimalSystemPrompt(sampleInput)
    const tokens = estimateTokenCount(prompt)

    expect(tokens).toBeLessThan(200)
  })
})
