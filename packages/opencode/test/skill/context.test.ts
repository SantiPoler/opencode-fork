import { describe, test, expect } from "bun:test"
import {
  buildSkillIndexSection,
  formatLoadedSkill,
  buildSkillContext,
  buildMinimalSkillList,
  buildSkillTable,
  filterRelevantSkills,
  getHighlightedSkills,
} from "../../src/skill/context"
import { SKILL_CONTEXT } from "../../src/skill/constants"
import type { SkillIndex, SkillIndexEntry, LoadedSkill } from "../../src/skill/types"

// Helper to create test skill entries
function createSkillEntry(
  name: string,
  options: Partial<SkillIndexEntry> = {}
): SkillIndexEntry {
  return {
    name,
    description: options.description || `A test skill called ${name}`,
    argumentHint: options.argumentHint,
    tags: options.tags || [],
    version: options.version,
    tools: options.tools || [],
    source: options.source || "local",
    path: options.path || `/path/to/${name}/SKILL.md`,
    warnings: options.warnings || [],
  }
}

// Helper to create test skill index
function createSkillIndex(skills: SkillIndexEntry[]): SkillIndex {
  return {
    skills,
    generatedAt: new Date().toISOString(),
    sources: {
      local: skills.filter((s) => s.source === "local").length,
      user: skills.filter((s) => s.source === "user").length,
      cached: skills.filter((s) => s.source === "cached").length,
      embedded: skills.filter((s) => s.source === "embedded").length,
    },
  }
}

describe("buildSkillIndexSection", () => {
  test("returns empty string for empty index", () => {
    const index = createSkillIndex([])
    const result = buildSkillIndexSection(index)
    expect(result).toBe("")
  })

  test("builds section with single skill", () => {
    const index = createSkillIndex([createSkillEntry("test-skill")])
    const result = buildSkillIndexSection(index)

    expect(result).toContain(SKILL_CONTEXT.INDEX_HEADER)
    expect(result).toContain(SKILL_CONTEXT.INDEX_INTRO)
    expect(result).toContain(SKILL_CONTEXT.INDEX_FOOTER)
    expect(result).toContain("test-skill")
    expect(result).toContain("`/test-skill`")
  })

  test("builds section with multiple skills", () => {
    const index = createSkillIndex([
      createSkillEntry("skill-one"),
      createSkillEntry("skill-two"),
      createSkillEntry("skill-three"),
    ])
    const result = buildSkillIndexSection(index)

    expect(result).toContain("skill-one")
    expect(result).toContain("skill-two")
    expect(result).toContain("skill-three")
  })

  test("includes argument hint in invocation", () => {
    const index = createSkillIndex([
      createSkillEntry("create-task", { argumentHint: "[taskId]" }),
    ])
    const result = buildSkillIndexSection(index)

    expect(result).toContain("`/create-task [taskId]`")
  })

  test("builds proper markdown table", () => {
    const index = createSkillIndex([
      createSkillEntry("my-skill", { description: "Does something useful" }),
    ])
    const result = buildSkillIndexSection(index)

    expect(result).toContain("| Skill | Description | Invocation |")
    expect(result).toContain("|-------|-------------|------------|")
    expect(result).toContain("| my-skill | Does something useful |")
  })
})

describe("formatLoadedSkill", () => {
  test("formats skill without warnings", () => {
    const loaded: LoadedSkill = {
      entry: createSkillEntry("test-skill"),
      content: "# Test Skill\n\nInstructions here.",
      frontmatter: {
        name: "test-skill",
        description: "A test skill",
      },
    }
    const result = formatLoadedSkill(loaded)

    expect(result).toContain('<skill name="test-skill" source="local">')
    expect(result).toContain("# Test Skill")
    expect(result).toContain("Instructions here.")
    expect(result).toContain("</skill>")
    expect(result).not.toContain("Warnings")
  })

  test("formats skill with warnings", () => {
    const loaded: LoadedSkill = {
      entry: createSkillEntry("warn-skill", {
        warnings: ["Tool 'missing_tool' not available"],
      }),
      content: "# Warn Skill\n\nContent.",
      frontmatter: {
        name: "warn-skill",
        description: "A skill with warnings",
      },
    }
    const result = formatLoadedSkill(loaded)

    expect(result).toContain("⚠️ Warnings:")
    expect(result).toContain("- Tool 'missing_tool' not available")
  })

  test("includes source in skill tag", () => {
    const loaded: LoadedSkill = {
      entry: createSkillEntry("embedded-skill", { source: "embedded" }),
      content: "Content",
      frontmatter: { name: "embedded-skill", description: "Test" },
    }
    const result = formatLoadedSkill(loaded)

    expect(result).toContain('source="embedded"')
  })
})

describe("buildSkillContext", () => {
  test("builds context with index only", () => {
    const index = createSkillIndex([createSkillEntry("my-skill")])
    const result = buildSkillContext(index)

    expect(result).toContain(SKILL_CONTEXT.INDEX_HEADER)
    expect(result).toContain("my-skill")
    expect(result).not.toContain("<skill")
  })

  test("builds context with index and loaded skill", () => {
    const index = createSkillIndex([createSkillEntry("my-skill")])
    const loaded: LoadedSkill = {
      entry: createSkillEntry("my-skill"),
      content: "# My Skill\n\nFull content.",
      frontmatter: { name: "my-skill", description: "Test" },
    }
    const result = buildSkillContext(index, loaded)

    expect(result).toContain(SKILL_CONTEXT.INDEX_HEADER)
    expect(result).toContain('<skill name="my-skill"')
    expect(result).toContain("Full content.")
  })

  test("handles empty index with no loaded skill", () => {
    const index = createSkillIndex([])
    const result = buildSkillContext(index)

    expect(result).toBe("")
  })
})

describe("buildMinimalSkillList", () => {
  test("returns empty string for empty index", () => {
    const index = createSkillIndex([])
    const result = buildMinimalSkillList(index)
    expect(result).toBe("")
  })

  test("builds compact list", () => {
    const index = createSkillIndex([
      createSkillEntry("skill-a"),
      createSkillEntry("skill-b"),
      createSkillEntry("skill-c"),
    ])
    const result = buildMinimalSkillList(index)

    expect(result).toBe("Skills: /skill-a, /skill-b, /skill-c")
  })
})

describe("buildSkillTable", () => {
  test("returns empty string for empty array", () => {
    const result = buildSkillTable([])
    expect(result).toBe("")
  })

  test("builds table with skills", () => {
    const skills = [
      createSkillEntry("first-skill"),
      createSkillEntry("second-skill", { argumentHint: "[arg]" }),
    ]
    const result = buildSkillTable(skills)

    expect(result).toContain("| Skill | Description | Invocation |")
    expect(result).toContain("first-skill")
    expect(result).toContain("`/second-skill [arg]`")
  })
})

describe("filterRelevantSkills", () => {
  const testSkills = [
    createSkillEntry("create-devtask", {
      description: "Create development tasks",
      tags: ["planning", "task"],
    }),
    createSkillEntry("review-code", {
      description: "Code examination process",
      tags: ["code", "quality"],
    }),
    createSkillEntry("deploy-app", {
      description: "Deploy application to production",
      tags: ["deploy", "infrastructure"],
    }),
  ]

  test("returns all skills for empty query", () => {
    const result = filterRelevantSkills(testSkills, "")
    expect(result).toEqual(testSkills)
  })

  test("returns all skills for short keywords", () => {
    const result = filterRelevantSkills(testSkills, "a b")
    expect(result).toEqual(testSkills)
  })

  test("filters by name", () => {
    const result = filterRelevantSkills(testSkills, "devtask")
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe("create-devtask")
  })

  test("filters by description", () => {
    const result = filterRelevantSkills(testSkills, "production")
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe("deploy-app")
  })

  test("filters by tags", () => {
    const result = filterRelevantSkills(testSkills, "planning")
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe("create-devtask")
  })

  test("is case insensitive", () => {
    const result = filterRelevantSkills(testSkills, "DEPLOY")
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe("deploy-app")
  })

  test("matches multiple keywords", () => {
    const result = filterRelevantSkills(testSkills, "code quality")
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe("review-code")
  })
})

describe("getHighlightedSkills", () => {
  const testSkills = [
    createSkillEntry("skill-a", { description: "Task management" }),
    createSkillEntry("skill-b", { description: "Code generation" }),
  ]

  test("returns all skills when no context", () => {
    const index = createSkillIndex(testSkills)
    const result = getHighlightedSkills(index)

    expect(result).toEqual(testSkills)
  })

  test("returns all skills when context is empty", () => {
    const index = createSkillIndex(testSkills)
    const result = getHighlightedSkills(index, "")

    expect(result).toEqual(testSkills)
  })

  test("returns relevant skills when context matches", () => {
    const index = createSkillIndex(testSkills)
    const result = getHighlightedSkills(index, "generate code")

    expect(result).toHaveLength(1)
    expect(result[0].name).toBe("skill-b")
  })

  test("returns all skills when no matches found", () => {
    const index = createSkillIndex(testSkills)
    const result = getHighlightedSkills(index, "xyz123")

    expect(result).toEqual(testSkills)
  })
})
