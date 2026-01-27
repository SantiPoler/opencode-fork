import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import {
  validateSkillFrontmatter,
  validateSkillNameMatchesPath,
  hasRequiredFields,
  setAvailableTools,
  resetAvailableTools,
  SkillFrontmatterSchema,
} from "../../src/skill/validator"
import { SKILL_VALIDATION } from "../../src/skill/constants"
import type { SkillSource } from "../../src/skill/types"

describe("SkillFrontmatterSchema", () => {
  test("validates valid complete frontmatter", () => {
    const valid = {
      name: "my-skill",
      description: "A valid skill description that is long enough",
      version: "1.0.0",
      tools: ["afwk_get_kanban_status"],
      tags: ["test", "example"],
      author: "Test Author",
      "argument-hint": "[taskId]",
    }

    const result = SkillFrontmatterSchema.safeParse(valid)
    expect(result.success).toBe(true)
  })

  test("validates minimal valid frontmatter", () => {
    const minimal = {
      name: "minimal",
      description: "A minimal but valid skill description",
    }

    const result = SkillFrontmatterSchema.safeParse(minimal)
    expect(result.success).toBe(true)
  })

  test("rejects missing name", () => {
    const invalid = {
      description: "A valid description here",
    }

    const result = SkillFrontmatterSchema.safeParse(invalid)
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.includes("name"))).toBe(true)
    }
  })

  test("rejects missing description", () => {
    const invalid = {
      name: "missing-desc",
    }

    const result = SkillFrontmatterSchema.safeParse(invalid)
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.includes("description"))).toBe(true)
    }
  })

  test("rejects invalid name format - uppercase", () => {
    const invalid = {
      name: "MySkill",
      description: "A valid description here",
    }

    const result = SkillFrontmatterSchema.safeParse(invalid)
    expect(result.success).toBe(false)
  })

  test("rejects invalid name format - starting with number", () => {
    const invalid = {
      name: "123-skill",
      description: "A valid description here",
    }

    const result = SkillFrontmatterSchema.safeParse(invalid)
    expect(result.success).toBe(false)
  })

  test("rejects invalid name format - spaces", () => {
    const invalid = {
      name: "my skill",
      description: "A valid description here",
    }

    const result = SkillFrontmatterSchema.safeParse(invalid)
    expect(result.success).toBe(false)
  })

  test("accepts valid kebab-case names", () => {
    const validNames = [
      "skill",
      "my-skill",
      "create-devtask",
      "skill-123",
      "a",
      "ab",
      "a-b-c-d-e",
    ]

    for (const name of validNames) {
      const result = SkillFrontmatterSchema.safeParse({
        name,
        description: "A valid description here",
      })
      expect(result.success).toBe(true)
    }
  })

  test("rejects description that is too short", () => {
    const invalid = {
      name: "my-skill",
      description: "Short", // Less than 10 chars
    }

    const result = SkillFrontmatterSchema.safeParse(invalid)
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0].message).toContain(
        String(SKILL_VALIDATION.DESCRIPTION_MIN_LENGTH)
      )
    }
  })

  test("rejects description that is too long", () => {
    const invalid = {
      name: "my-skill",
      description: "x".repeat(SKILL_VALIDATION.DESCRIPTION_MAX_LENGTH + 1),
    }

    const result = SkillFrontmatterSchema.safeParse(invalid)
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0].message).toContain(
        String(SKILL_VALIDATION.DESCRIPTION_MAX_LENGTH)
      )
    }
  })

  test("rejects invalid semver version", () => {
    const invalidVersions = ["1.0", "v1.0.0", "1", "1.0.0.0", "latest"]

    for (const version of invalidVersions) {
      const result = SkillFrontmatterSchema.safeParse({
        name: "my-skill",
        description: "A valid description here",
        version,
      })
      expect(result.success).toBe(false)
    }
  })

  test("accepts valid semver versions", () => {
    const validVersions = ["1.0.0", "0.1.0", "10.20.30", "1.0.0-alpha", "1.0.0-beta.1"]

    for (const version of validVersions) {
      const result = SkillFrontmatterSchema.safeParse({
        name: "my-skill",
        description: "A valid description here",
        version,
      })
      expect(result.success).toBe(true)
    }
  })

  test("accepts valid tools array", () => {
    const valid = {
      name: "my-skill",
      description: "A valid description here",
      tools: ["tool1", "tool2", "tool3"],
    }

    const result = SkillFrontmatterSchema.safeParse(valid)
    expect(result.success).toBe(true)
  })

  test("accepts valid tags array", () => {
    const valid = {
      name: "my-skill",
      description: "A valid description here",
      tags: ["workflow", "automation", "devops"],
    }

    const result = SkillFrontmatterSchema.safeParse(valid)
    expect(result.success).toBe(true)
  })
})

describe("validateSkillFrontmatter", () => {
  beforeEach(() => {
    setAvailableTools([
      "afwk_get_kanban_status",
      "afwk_create_devtask",
      "afwk_move_kanban_task",
    ])
  })

  afterEach(() => {
    resetAvailableTools()
  })

  test("returns valid entry for valid frontmatter", () => {
    const result = validateSkillFrontmatter(
      {
        name: "test-skill",
        description: "A test skill with valid description",
      },
      "/path/to/test-skill/SKILL.md",
      "local"
    )

    expect(result.valid).toBe(true)
    expect(result.entry).toBeDefined()
    expect(result.entry?.name).toBe("test-skill")
    expect(result.entry?.source).toBe("local")
    expect(result.entry?.path).toBe("/path/to/test-skill/SKILL.md")
    expect(result.errors).toHaveLength(0)
    expect(result.warnings).toHaveLength(0)
  })

  test("returns errors for invalid frontmatter", () => {
    const result = validateSkillFrontmatter(
      { name: "InvalidName" },
      "/path/to/invalid/SKILL.md",
      "local"
    )

    expect(result.valid).toBe(false)
    expect(result.entry).toBeUndefined()
    expect(result.errors.length).toBeGreaterThan(0)
  })

  test("returns warnings for unavailable tools", () => {
    const result = validateSkillFrontmatter(
      {
        name: "tool-skill",
        description: "A skill that uses unavailable tools",
        tools: ["afwk_nonexistent_tool", "afwk_get_kanban_status"],
      },
      "/path/to/tool-skill/SKILL.md",
      "local"
    )

    expect(result.valid).toBe(true)
    expect(result.entry).toBeDefined()
    expect(result.warnings.length).toBe(1)
    expect(result.warnings[0]).toContain("afwk_nonexistent_tool")
    expect(result.entry?.warnings).toEqual(result.warnings)
  })

  test("does not warn for available tools", () => {
    const result = validateSkillFrontmatter(
      {
        name: "valid-tools-skill",
        description: "A skill with all valid tools",
        tools: ["afwk_get_kanban_status", "afwk_create_devtask"],
      },
      "/path/to/skill/SKILL.md",
      "local"
    )

    expect(result.valid).toBe(true)
    expect(result.warnings).toHaveLength(0)
  })

  test("sets correct source in entry for all sources", () => {
    const sources: SkillSource[] = ["local", "user", "cached", "embedded"]

    for (const source of sources) {
      const result = validateSkillFrontmatter(
        {
          name: "source-test",
          description: "Testing source assignment in entry",
        },
        `/path/${source}/source-test/SKILL.md`,
        source
      )

      expect(result.valid).toBe(true)
      expect(result.entry?.source).toBe(source)
    }
  })

  test("preserves optional fields in entry", () => {
    const result = validateSkillFrontmatter(
      {
        name: "full-skill",
        description: "A skill with all optional fields",
        version: "2.1.0",
        "argument-hint": "[taskId]",
        tools: ["afwk_get_kanban_status"],
        tags: ["workflow", "devops"],
        author: "Test Author",
      },
      "/path/to/full-skill/SKILL.md",
      "user"
    )

    expect(result.valid).toBe(true)
    expect(result.entry?.version).toBe("2.1.0")
    expect(result.entry?.argumentHint).toBe("[taskId]")
    expect(result.entry?.tools).toEqual(["afwk_get_kanban_status"])
    expect(result.entry?.tags).toEqual(["workflow", "devops"])
  })

  test("defaults tags and tools to empty arrays", () => {
    const result = validateSkillFrontmatter(
      {
        name: "minimal-skill",
        description: "A minimal skill without tools or tags",
      },
      "/path/to/minimal/SKILL.md",
      "local"
    )

    expect(result.valid).toBe(true)
    expect(result.entry?.tags).toEqual([])
    expect(result.entry?.tools).toEqual([])
  })
})

describe("validateSkillNameMatchesPath", () => {
  test("returns true when name matches directory", () => {
    expect(
      validateSkillNameMatchesPath("my-skill", "/path/to/my-skill/SKILL.md")
    ).toBe(true)
  })

  test("returns false when name does not match directory", () => {
    expect(
      validateSkillNameMatchesPath("my-skill", "/path/to/other-skill/SKILL.md")
    ).toBe(false)
  })

  test("handles Windows paths", () => {
    expect(
      validateSkillNameMatchesPath("my-skill", "C:\\path\\to\\my-skill\\SKILL.md")
    ).toBe(true)

    expect(
      validateSkillNameMatchesPath("my-skill", "C:\\path\\to\\other\\SKILL.md")
    ).toBe(false)
  })

  test("handles case sensitivity", () => {
    // Skill names are kebab-case lowercase, so should match exactly
    expect(
      validateSkillNameMatchesPath("my-skill", "/path/to/My-Skill/SKILL.md")
    ).toBe(false)
  })
})

describe("hasRequiredFields", () => {
  test("returns true for valid data", () => {
    expect(
      hasRequiredFields({
        name: "test",
        description: "A description long enough",
      })
    ).toBe(true)
  })

  test("returns false for null/undefined", () => {
    expect(hasRequiredFields(null)).toBe(false)
    expect(hasRequiredFields(undefined)).toBe(false)
  })

  test("returns false for non-object", () => {
    expect(hasRequiredFields("string")).toBe(false)
    expect(hasRequiredFields(123)).toBe(false)
    expect(hasRequiredFields([])).toBe(false)
  })

  test("returns false for missing name", () => {
    expect(hasRequiredFields({ description: "A description" })).toBe(false)
  })

  test("returns false for empty name", () => {
    expect(hasRequiredFields({ name: "", description: "A description" })).toBe(false)
  })

  test("returns false for missing description", () => {
    expect(hasRequiredFields({ name: "test" })).toBe(false)
  })

  test("returns false for short description", () => {
    expect(hasRequiredFields({ name: "test", description: "Short" })).toBe(false)
  })

  test("returns true for description exactly at minimum length", () => {
    const description = "x".repeat(SKILL_VALIDATION.DESCRIPTION_MIN_LENGTH)
    expect(hasRequiredFields({ name: "test", description })).toBe(true)
  })
})
