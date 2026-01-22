import { describe, test, expect } from "bun:test"
import {
  interpolateTemplate,
  loadRawTemplate,
  loadTemplate,
  getBundledTemplate,
  listTemplateTypes,
  getTemplatesDir,
  hasCustomTemplates,
} from "../template-loader"

describe("template-loader", () => {
  describe("interpolateTemplate", () => {
    test("replaces single placeholder", () => {
      const template = "Hello {{name}}!"
      const result = interpolateTemplate(template, { name: "World" })
      expect(result).toBe("Hello World!")
    })

    test("replaces multiple placeholders", () => {
      const template = "{{greeting}} {{name}}!"
      const result = interpolateTemplate(template, {
        greeting: "Hello",
        name: "World",
      })
      expect(result).toBe("Hello World!")
    })

    test("replaces same placeholder multiple times", () => {
      const template = "{{name}} and {{name}} again"
      const result = interpolateTemplate(template, { name: "Test" })
      expect(result).toBe("Test and Test again")
    })

    test("handles missing keys with empty string", () => {
      const template = "Hello {{name}}!"
      const result = interpolateTemplate(template, {})
      expect(result).toBe("Hello !")
    })

    test("handles undefined values with empty string", () => {
      const template = "Title: {{title}}"
      const result = interpolateTemplate(template, { title: undefined })
      expect(result).toBe("Title: ")
    })

    test("preserves non-placeholder text", () => {
      const template = "No placeholders here"
      const result = interpolateTemplate(template, { name: "Test" })
      expect(result).toBe("No placeholders here")
    })

    test("adds default createdAt if not provided", () => {
      const template = "Created: {{createdAt}}"
      const result = interpolateTemplate(template, {})
      // Should have ISO date format
      expect(result).toMatch(/Created: \d{4}-\d{2}-\d{2}T/)
    })

    test("uses provided createdAt over default", () => {
      const template = "Created: {{createdAt}}"
      const result = interpolateTemplate(template, {
        createdAt: "2026-01-01T00:00:00Z",
      })
      expect(result).toBe("Created: 2026-01-01T00:00:00Z")
    })

    test("handles complex template with multiple types", () => {
      const template = `# {{title}}
> devTASK: {{devTaskId}} | Created: {{createdAt}}

## Description
{{description}}`

      const result = interpolateTemplate(template, {
        title: "Login Feature",
        devTaskId: "devTASK-01_login",
        description: "Implement user authentication",
        createdAt: "2026-01-21T10:00:00Z",
      })

      expect(result).toContain("# Login Feature")
      expect(result).toContain("devTASK: devTASK-01_login")
      expect(result).toContain("Created: 2026-01-21T10:00:00Z")
      expect(result).toContain("Implement user authentication")
    })
  })

  describe("getBundledTemplate", () => {
    test("returns overview template", () => {
      const template = getBundledTemplate("overview")
      expect(template).toContain("{{title}}")
      expect(template).toContain("{{description}}")
      expect(template).toContain("## Objetivo")
      expect(template).toContain("## Criterios de Exito")
    })

    test("returns aitask-blueprint template", () => {
      const template = getBundledTemplate("aitask-blueprint")
      expect(template).toContain("{{title}}")
      expect(template).toContain("{{aiTaskId}}")
      expect(template).toContain("{{devTaskId}}")
      expect(template).toContain("{{objective}}")
      expect(template).toContain("## Objetivo de esta Iteracion")
    })

    test("returns completion-notes template", () => {
      const template = getBundledTemplate("completion-notes")
      expect(template).toContain("{{aiTaskId}}")
      expect(template).toContain("{{notes}}")
      expect(template).toContain("## Resumen de Implementacion")
    })
  })

  describe("listTemplateTypes", () => {
    test("returns all template types", () => {
      const types = listTemplateTypes()
      expect(types).toContain("overview")
      expect(types).toContain("aitask-blueprint")
      expect(types).toContain("completion-notes")
      expect(types.length).toBe(3)
    })
  })

  describe("loadRawTemplate", () => {
    test("returns bundled template when no custom exists (no basePath)", async () => {
      // Without basePath and without Instance context, should return bundled
      const template = await loadRawTemplate("overview")
      const bundled = getBundledTemplate("overview")
      expect(template).toBe(bundled)
    })

    test("returns bundled template for aitask-blueprint", async () => {
      const template = await loadRawTemplate("aitask-blueprint")
      const bundled = getBundledTemplate("aitask-blueprint")
      expect(template).toBe(bundled)
    })

    test("returns bundled template for completion-notes", async () => {
      const template = await loadRawTemplate("completion-notes")
      const bundled = getBundledTemplate("completion-notes")
      expect(template).toBe(bundled)
    })
  })

  describe("loadTemplate (integration)", () => {
    test("loads and interpolates overview template", async () => {
      const result = await loadTemplate("overview", {
        title: "Test Feature",
        description: "A test description",
        createdAt: "2026-01-21T12:00:00Z",
      })

      expect(result).toContain("# Test Feature")
      expect(result).toContain("A test description")
      expect(result).toContain("Created: 2026-01-21T12:00:00Z")
    })

    test("loads and interpolates aitask-blueprint template", async () => {
      const result = await loadTemplate("aitask-blueprint", {
        title: "Setup Database",
        aiTaskId: "aiTASK-01_setup-db",
        devTaskId: "devTASK-01_login",
        objective: "Configure PostgreSQL connection",
        createdAt: "2026-01-21T12:00:00Z",
      })

      expect(result).toContain("# Setup Database")
      expect(result).toContain("aiTASK: aiTASK-01_setup-db")
      expect(result).toContain("devTASK: devTASK-01_login")
      expect(result).toContain("Configure PostgreSQL connection")
    })

    test("loads and interpolates completion-notes template", async () => {
      const result = await loadTemplate("completion-notes", {
        aiTaskId: "aiTASK-01_setup-db",
        notes: "Successfully configured database connection",
        createdAt: "2026-01-21T15:00:00Z",
      })

      expect(result).toContain("Completion Notes: aiTASK-01_setup-db")
      expect(result).toContain("Successfully configured database connection")
      expect(result).toContain("Completed: 2026-01-21T15:00:00Z")
    })
  })

  describe("hasCustomTemplates", () => {
    test("returns false when no basePath and no Instance context", async () => {
      // Without basePath and Instance context, returns false
      const result = await hasCustomTemplates()
      expect(result).toBe(false)
    })

    test("returns false for non-existent basePath", async () => {
      const result = await hasCustomTemplates("/non/existent/path")
      expect(result).toBe(false)
    })
  })

  describe("getTemplatesDir", () => {
    test("returns null when no basePath and no Instance context", () => {
      // Without basePath and Instance context, returns null
      const dir = getTemplatesDir()
      expect(dir).toBe(null)
    })

    test("returns path with templates when basePath provided", () => {
      const dir = getTemplatesDir("/some/base/path")
      // Cross-platform: path.join may use different separators
      expect(dir).toMatch(/templates$/)
      expect(dir).toContain("some")
      expect(dir).toContain("base")
      expect(dir).toContain("path")
    })
  })
})
