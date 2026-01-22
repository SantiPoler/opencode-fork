import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import * as fs from "fs/promises"
import * as path from "path"
import * as os from "os"
import {
  validateTransition,
  getTransitionRequirements,
  isTransitionDefined,
  getTransitionRules,
  loadRules,
  clearRulesCache,
  setBasePath,
} from "../rules-engine"

// Sample rules.yaml content for testing
const TEST_RULES_YAML = `
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
`

describe("rules-engine", () => {
  let tempDir: string

  beforeEach(async () => {
    // Create temp directory for test fixtures
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "afwk-rules-test-"))

    // Create .afwk directory and rules.yaml
    const afwkDir = path.join(tempDir, ".afwk")
    await fs.mkdir(afwkDir, { recursive: true })
    await fs.writeFile(path.join(afwkDir, "rules.yaml"), TEST_RULES_YAML)

    // Set base path for testing (bypasses Instance.directory)
    setBasePath(tempDir)
  })

  afterEach(async () => {
    // Clear base path override
    setBasePath(null)

    // Cleanup temp directory
    try {
      await fs.rm(tempDir, { recursive: true, force: true })
    } catch {
      // Ignore cleanup errors
    }
  })

  describe("loadRules", () => {
    test("loads rules from .afwk/rules.yaml", async () => {
      const rules = await loadRules()

      expect(rules.version).toBe(1)
      expect(rules.transitions).toBeDefined()
      expect(rules.transitions?.backlog_to_todo).toBeDefined()
    })

    test("throws error when rules.yaml not found", async () => {
      // Remove rules.yaml
      await fs.rm(path.join(tempDir, ".afwk", "rules.yaml"))
      clearRulesCache()

      await expect(loadRules()).rejects.toThrow("rules.yaml not found")
    })

    test("throws error for invalid version", async () => {
      // Write rules with invalid version
      await fs.writeFile(
        path.join(tempDir, ".afwk", "rules.yaml"),
        "version: 99\ntransitions: {}"
      )
      clearRulesCache()

      await expect(loadRules()).rejects.toThrow("expected version 1")
    })

    test("caches rules after first load", async () => {
      const rules1 = await loadRules()
      const rules2 = await loadRules()

      expect(rules1).toBe(rules2) // Same reference = cached
    })
  })

  describe("validateTransition", () => {
    describe("backlog → todo", () => {
      test("blocks transition without overview.md", async () => {
        // Create empty task directory
        const taskPath = path.join(tempDir, "devTASK-01_test")
        await fs.mkdir(taskPath, { recursive: true })

        const result = await validateTransition(taskPath, "backlog", "todo")

        expect(result.valid).toBe(false)
        expect(result.violations.length).toBe(1)
        expect(result.violations[0].check).toBe("file_exists")
        expect(result.violations[0].message).toContain("overview.md")
      })

      test("allows transition with overview.md", async () => {
        // Create task directory with overview.md
        const taskPath = path.join(tempDir, "devTASK-01_test")
        await fs.mkdir(taskPath, { recursive: true })
        await fs.writeFile(path.join(taskPath, "overview.md"), "# Test Task")

        const result = await validateTransition(taskPath, "backlog", "todo")

        expect(result.valid).toBe(true)
        expect(result.violations.length).toBe(0)
      })
    })

    describe("todo → in_progress", () => {
      test("blocks transition without aiTASK", async () => {
        // Create task directory without aiTASK files
        const taskPath = path.join(tempDir, "devTASK-01_test")
        await fs.mkdir(taskPath, { recursive: true })
        await fs.writeFile(path.join(taskPath, "overview.md"), "# Test Task")

        const result = await validateTransition(taskPath, "todo", "in_progress")

        expect(result.valid).toBe(false)
        expect(result.violations.length).toBe(1)
        expect(result.violations[0].check).toBe("min_files_match")
        expect(result.violations[0].message).toContain("aiTASK blueprint")
      })

      test("allows transition with at least 1 aiTASK", async () => {
        // Create task directory with aiTASK file
        const taskPath = path.join(tempDir, "devTASK-01_test")
        await fs.mkdir(taskPath, { recursive: true })
        await fs.writeFile(path.join(taskPath, "overview.md"), "# Test Task")
        await fs.writeFile(path.join(taskPath, "aiTASK-01_setup.md"), "# Setup")

        const result = await validateTransition(taskPath, "todo", "in_progress")

        expect(result.valid).toBe(true)
        expect(result.violations.length).toBe(0)
      })

      test("ignores completion notes files when counting aiTASKs", async () => {
        // Create task with only completion notes (no blueprint)
        const taskPath = path.join(tempDir, "devTASK-01_test")
        await fs.mkdir(taskPath, { recursive: true })
        await fs.writeFile(
          path.join(taskPath, "aiTASK-01_setup_completion-notes.md"),
          "# Completion"
        )

        const result = await validateTransition(taskPath, "todo", "in_progress")

        expect(result.valid).toBe(false)
        expect(result.violations[0].details).toContain("Found 0 files")
      })
    })

    describe("in_progress → completed", () => {
      test("blocks transition when aiTASK lacks completion notes", async () => {
        // Create task with aiTASK but no completion notes
        const taskPath = path.join(tempDir, "devTASK-01_test")
        await fs.mkdir(taskPath, { recursive: true })
        await fs.writeFile(path.join(taskPath, "aiTASK-01_setup.md"), "# Setup")

        const result = await validateTransition(taskPath, "in_progress", "completed")

        expect(result.valid).toBe(false)
        expect(result.violations.length).toBe(1)
        expect(result.violations[0].check).toBe("all_aitasks_have_completion_notes")
        expect(result.violations[0].details).toContain("aiTASK-01_setup")
      })

      test("allows transition when all aiTASKs have completion notes", async () => {
        // Create task with aiTASK and its completion notes
        const taskPath = path.join(tempDir, "devTASK-01_test")
        await fs.mkdir(taskPath, { recursive: true })
        await fs.writeFile(path.join(taskPath, "aiTASK-01_setup.md"), "# Setup")
        await fs.writeFile(
          path.join(taskPath, "aiTASK-01_setup_completion-notes.md"),
          "# Done"
        )

        const result = await validateTransition(taskPath, "in_progress", "completed")

        expect(result.valid).toBe(true)
        expect(result.violations.length).toBe(0)
      })

      test("blocks when some aiTASKs missing completion notes", async () => {
        // Create task with 2 aiTASKs, only 1 has completion notes
        const taskPath = path.join(tempDir, "devTASK-01_test")
        await fs.mkdir(taskPath, { recursive: true })
        await fs.writeFile(path.join(taskPath, "aiTASK-01_setup.md"), "# Setup")
        await fs.writeFile(
          path.join(taskPath, "aiTASK-01_setup_completion-notes.md"),
          "# Done"
        )
        await fs.writeFile(path.join(taskPath, "aiTASK-02_impl.md"), "# Impl")
        // Note: aiTASK-02 has no completion notes

        const result = await validateTransition(taskPath, "in_progress", "completed")

        expect(result.valid).toBe(false)
        expect(result.violations[0].details).toContain("aiTASK-02_impl")
        expect(result.violations[0].details).not.toContain("aiTASK-01_setup")
      })

      test("allows transition with no aiTASKs (edge case)", async () => {
        // Create task with no aiTASKs at all
        const taskPath = path.join(tempDir, "devTASK-01_test")
        await fs.mkdir(taskPath, { recursive: true })
        await fs.writeFile(path.join(taskPath, "overview.md"), "# Test")

        const result = await validateTransition(taskPath, "in_progress", "completed")

        // If there are no aiTASKs, there are none missing completion notes
        expect(result.valid).toBe(true)
      })
    })

    describe("undefined transitions", () => {
      test("allows todo → backlog (no rule defined)", async () => {
        const taskPath = path.join(tempDir, "devTASK-01_test")
        await fs.mkdir(taskPath, { recursive: true })

        const result = await validateTransition(taskPath, "todo", "backlog")

        expect(result.valid).toBe(true)
        expect(result.violations.length).toBe(0)
      })

      test("allows in_progress → todo (no rule defined)", async () => {
        const taskPath = path.join(tempDir, "devTASK-01_test")
        await fs.mkdir(taskPath, { recursive: true })

        const result = await validateTransition(taskPath, "in_progress", "todo")

        expect(result.valid).toBe(true)
        expect(result.violations.length).toBe(0)
      })

      test("allows completed → in_progress (no rule defined)", async () => {
        const taskPath = path.join(tempDir, "devTASK-01_test")
        await fs.mkdir(taskPath, { recursive: true })

        const result = await validateTransition(taskPath, "completed", "in_progress")

        expect(result.valid).toBe(true)
      })
    })
  })

  describe("getTransitionRequirements", () => {
    test("returns requirements for backlog → todo", async () => {
      const requirements = await getTransitionRequirements("backlog", "todo")

      expect(requirements.length).toBe(1)
      expect(requirements[0]).toContain("overview.md")
    })

    test("returns requirements for todo → in_progress", async () => {
      const requirements = await getTransitionRequirements("todo", "in_progress")

      expect(requirements.length).toBe(1)
      expect(requirements[0]).toContain("aiTASK")
    })

    test("returns requirements for in_progress → completed", async () => {
      const requirements = await getTransitionRequirements("in_progress", "completed")

      expect(requirements.length).toBe(1)
      expect(requirements[0]).toContain("completion notes")
    })

    test("returns empty array for undefined transitions", async () => {
      const requirements = await getTransitionRequirements("todo", "backlog")

      expect(requirements).toEqual([])
    })
  })

  describe("isTransitionDefined", () => {
    test("returns true for defined transitions", async () => {
      expect(await isTransitionDefined("backlog", "todo")).toBe(true)
      expect(await isTransitionDefined("todo", "in_progress")).toBe(true)
      expect(await isTransitionDefined("in_progress", "completed")).toBe(true)
    })

    test("returns false for undefined transitions", async () => {
      expect(await isTransitionDefined("todo", "backlog")).toBe(false)
      expect(await isTransitionDefined("completed", "backlog")).toBe(false)
      expect(await isTransitionDefined("backlog", "completed")).toBe(false)
    })
  })

  describe("getTransitionRules", () => {
    test("returns all defined rules", async () => {
      const rules = await getTransitionRules()

      expect(rules.length).toBe(3)
      expect(rules.some((r) => r.from === "backlog" && r.to === "todo")).toBe(true)
      expect(rules.some((r) => r.from === "todo" && r.to === "in_progress")).toBe(true)
      expect(rules.some((r) => r.from === "in_progress" && r.to === "completed")).toBe(true)
    })

    test("returns a copy of rules (immutable)", async () => {
      const rules1 = await getTransitionRules()
      const rules2 = await getTransitionRules()

      // Both calls return fresh arrays from the config
      expect(rules1).toEqual(rules2)
    })
  })
})
