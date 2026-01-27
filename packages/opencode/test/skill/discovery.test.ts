import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import path from "path"
import fs from "fs/promises"
import {
  SkillDiscovery,
  getDiscovery,
  getSkillIndex,
  invalidateSkillIndex,
  resetDiscovery,
} from "../../src/skill/discovery"
import {
  SkillResolver,
  getResolver,
  resetResolver,
  resolveSkill,
  loadSkill,
  searchSkills,
} from "../../src/skill/resolver"
import { resetAvailableTools, setAvailableTools } from "../../src/skill/validator"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"

// Helper to create a valid SKILL.md file
async function createSkillFile(
  dir: string,
  name: string,
  options: {
    description?: string
    version?: string
    tools?: string[]
    tags?: string[]
    content?: string
  } = {}
) {
  const skillDir = path.join(dir, name)
  await fs.mkdir(skillDir, { recursive: true })

  const frontmatter = [
    "---",
    `name: ${name}`,
    `description: ${options.description || `A test skill called ${name} for testing purposes`}`,
  ]

  if (options.version) {
    frontmatter.push(`version: ${options.version}`)
  }

  if (options.tools && options.tools.length > 0) {
    frontmatter.push("tools:")
    for (const tool of options.tools) {
      frontmatter.push(`  - ${tool}`)
    }
  }

  if (options.tags && options.tags.length > 0) {
    frontmatter.push("tags:")
    for (const tag of options.tags) {
      frontmatter.push(`  - ${tag}`)
    }
  }

  frontmatter.push("---")
  frontmatter.push("")
  frontmatter.push(options.content || `# ${name}\n\nSkill instructions here.`)

  await Bun.write(path.join(skillDir, "SKILL.md"), frontmatter.join("\n"))
}

describe("SkillDiscovery", () => {
  beforeEach(() => {
    resetDiscovery()
    resetResolver()
    setAvailableTools(["afwk_get_kanban_status", "afwk_create_devtask"])
  })

  afterEach(() => {
    resetAvailableTools()
  })

  test("discovers skills from local .opencode/skill directory", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        const skillDir = path.join(dir, ".opencode", "skill")
        await createSkillFile(skillDir, "local-skill")
      },
    })

    const discovery = new SkillDiscovery({
      projectDir: tmp.path,
      userDir: path.join(tmp.path, ".empty-user"),
      cacheDir: path.join(tmp.path, ".empty-cache"),
      includeEmbedded: false,
    })

    const index = await discovery.discover()

    expect(index.skills.length).toBe(1)
    expect(index.skills[0].name).toBe("local-skill")
    expect(index.skills[0].source).toBe("local")
    expect(index.sources.local).toBe(1)
  })

  test("discovers multiple skills from same directory", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        const skillDir = path.join(dir, ".opencode", "skill")
        await createSkillFile(skillDir, "skill-one")
        await createSkillFile(skillDir, "skill-two")
        await createSkillFile(skillDir, "skill-three")
      },
    })

    const discovery = new SkillDiscovery({
      projectDir: tmp.path,
      userDir: path.join(tmp.path, ".empty-user"),
      cacheDir: path.join(tmp.path, ".empty-cache"),
      includeEmbedded: false,
    })

    const index = await discovery.discover()

    expect(index.skills.length).toBe(3)
    expect(index.skills.map((s) => s.name).sort()).toEqual([
      "skill-one",
      "skill-three",
      "skill-two",
    ])
  })

  test("local skills override user skills with same name", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        // Create local skill
        const localDir = path.join(dir, ".opencode", "skill")
        await createSkillFile(localDir, "shared-skill", {
          description: "Local version of shared skill for testing",
        })

        // Create user skill with same name
        const userDir = path.join(dir, "user-config", "skill")
        await createSkillFile(userDir, "shared-skill", {
          description: "User version of shared skill for testing",
        })
      },
    })

    const discovery = new SkillDiscovery({
      projectDir: tmp.path,
      userDir: path.join(tmp.path, "user-config", "skill"),
      cacheDir: path.join(tmp.path, ".empty-cache"),
      includeEmbedded: false,
    })

    const index = await discovery.discover()

    expect(index.skills.length).toBe(1)
    expect(index.skills[0].name).toBe("shared-skill")
    expect(index.skills[0].source).toBe("local")
    expect(index.skills[0].description).toBe("Local version of shared skill for testing")
  })

  test("user skills are discovered when no local override", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        // Create only user skill
        const userDir = path.join(dir, "user-config", "skill")
        await createSkillFile(userDir, "user-only-skill")
      },
    })

    const discovery = new SkillDiscovery({
      projectDir: tmp.path,
      userDir: path.join(tmp.path, "user-config", "skill"),
      cacheDir: path.join(tmp.path, ".empty-cache"),
      includeEmbedded: false,
    })

    const index = await discovery.discover()

    expect(index.skills.length).toBe(1)
    expect(index.skills[0].name).toBe("user-only-skill")
    expect(index.skills[0].source).toBe("user")
  })

  test("skips directories that do not exist", async () => {
    await using tmp = await tmpdir({ git: true })

    const discovery = new SkillDiscovery({
      projectDir: tmp.path,
      userDir: path.join(tmp.path, "nonexistent-user"),
      cacheDir: path.join(tmp.path, "nonexistent-cache"),
      includeEmbedded: false,
    })

    const index = await discovery.discover()

    expect(index.skills.length).toBe(0)
    expect(index.sources).toEqual({ local: 0, user: 0, cached: 0, embedded: 0 })
  })

  test("skips skills with invalid frontmatter", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        const skillDir = path.join(dir, ".opencode", "skill", "invalid-skill")
        await fs.mkdir(skillDir, { recursive: true })
        // Missing required fields
        await Bun.write(
          path.join(skillDir, "SKILL.md"),
          `---
name: InvalidName
---

# Invalid Skill
`
        )
      },
    })

    const discovery = new SkillDiscovery({
      projectDir: tmp.path,
      userDir: path.join(tmp.path, ".empty-user"),
      cacheDir: path.join(tmp.path, ".empty-cache"),
      includeEmbedded: false,
    })

    const index = await discovery.discover()

    expect(index.skills.length).toBe(0)

    const events = discovery.getEvents()
    expect(events.some((e) => e.type === "error")).toBe(true)
  })

  test("adds warnings for unavailable tools", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        const skillDir = path.join(dir, ".opencode", "skill")
        await createSkillFile(skillDir, "tool-skill", {
          tools: ["afwk_get_kanban_status", "nonexistent_tool"],
        })
      },
    })

    const discovery = new SkillDiscovery({
      projectDir: tmp.path,
      userDir: path.join(tmp.path, ".empty-user"),
      cacheDir: path.join(tmp.path, ".empty-cache"),
      includeEmbedded: false,
    })

    const index = await discovery.discover()

    expect(index.skills.length).toBe(1)
    expect(index.skills[0].warnings.length).toBe(1)
    expect(index.skills[0].warnings[0]).toContain("nonexistent_tool")
  })

  test("generates correct timestamps", async () => {
    await using tmp = await tmpdir({ git: true })

    const discovery = new SkillDiscovery({
      projectDir: tmp.path,
      userDir: path.join(tmp.path, ".empty-user"),
      cacheDir: path.join(tmp.path, ".empty-cache"),
      includeEmbedded: false,
    })

    const beforeTime = new Date().toISOString()
    const index = await discovery.discover()
    const afterTime = new Date().toISOString()

    expect(index.generatedAt >= beforeTime).toBe(true)
    expect(index.generatedAt <= afterTime).toBe(true)
  })

  test("records discovery events", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        const skillDir = path.join(dir, ".opencode", "skill")
        await createSkillFile(skillDir, "event-skill")
      },
    })

    const discovery = new SkillDiscovery({
      projectDir: tmp.path,
      userDir: path.join(tmp.path, ".empty-user"),
      cacheDir: path.join(tmp.path, ".empty-cache"),
      includeEmbedded: false,
    })

    await discovery.discover()
    const events = discovery.getEvents()

    expect(events.length).toBeGreaterThan(0)
    expect(events.some((e) => e.type === "discovered" && e.name === "event-skill")).toBe(
      true
    )
  })
})

describe("SkillResolver", () => {
  beforeEach(() => {
    resetDiscovery()
    resetResolver()
    setAvailableTools(["afwk_get_kanban_status", "afwk_create_devtask"])
  })

  afterEach(() => {
    resetAvailableTools()
  })

  test("resolves skill by name", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        const skillDir = path.join(dir, ".opencode", "skill")
        await createSkillFile(skillDir, "resolve-test")
      },
    })

    // Configure discovery
    getDiscovery({
      projectDir: tmp.path,
      includeEmbedded: false,
    })

    const resolver = new SkillResolver()
    const entry = await resolver.resolve("resolve-test")

    expect(entry).not.toBeNull()
    expect(entry?.name).toBe("resolve-test")
  })

  test("returns null for nonexistent skill", async () => {
    await using tmp = await tmpdir({ git: true })

    getDiscovery({
      projectDir: tmp.path,
      includeEmbedded: false,
    })

    const resolver = new SkillResolver()
    const entry = await resolver.resolve("nonexistent")

    expect(entry).toBeNull()
  })

  test("loads full skill content", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        const skillDir = path.join(dir, ".opencode", "skill")
        await createSkillFile(skillDir, "load-test", {
          content: "# Load Test\n\nThis is the full content.",
        })
      },
    })

    getDiscovery({
      projectDir: tmp.path,
      includeEmbedded: false,
    })

    const resolver = new SkillResolver()
    const loaded = await resolver.load("load-test")

    expect(loaded).not.toBeNull()
    expect(loaded?.content).toContain("This is the full content")
    expect(loaded?.frontmatter.name).toBe("load-test")
    expect(loaded?.entry.source).toBe("local")
  })

  test("checks skill existence", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        const skillDir = path.join(dir, ".opencode", "skill")
        await createSkillFile(skillDir, "exists-test")
      },
    })

    getDiscovery({
      projectDir: tmp.path,
      includeEmbedded: false,
    })

    const resolver = new SkillResolver()

    expect(await resolver.exists("exists-test")).toBe(true)
    expect(await resolver.exists("nonexistent")).toBe(false)
  })

  test("finds skills by tag", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        const skillDir = path.join(dir, ".opencode", "skill")
        await createSkillFile(skillDir, "tagged-one", { tags: ["workflow", "automation"] })
        await createSkillFile(skillDir, "tagged-two", { tags: ["workflow"] })
        await createSkillFile(skillDir, "untagged", { tags: [] })
      },
    })

    getDiscovery({
      projectDir: tmp.path,
      userDir: path.join(tmp.path, ".empty-user"),
      cacheDir: path.join(tmp.path, ".empty-cache"),
      includeEmbedded: false,
    })

    const resolver = new SkillResolver()
    const workflowSkills = await resolver.findByTag("workflow")
    const automationSkills = await resolver.findByTag("automation")

    expect(workflowSkills.length).toBe(2)
    expect(automationSkills.length).toBe(1)
    expect(automationSkills[0].name).toBe("tagged-one")
  })

  test("finds skills by source", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        const localDir = path.join(dir, ".opencode", "skill")
        const userDir = path.join(dir, "user-config", "skill")
        await createSkillFile(localDir, "local-source")
        await createSkillFile(userDir, "user-source")
      },
    })

    getDiscovery({
      projectDir: tmp.path,
      userDir: path.join(tmp.path, "user-config", "skill"),
      cacheDir: path.join(tmp.path, ".empty-cache"),
      includeEmbedded: false,
    })

    const resolver = new SkillResolver()
    const localSkills = await resolver.findBySource("local")
    const userSkills = await resolver.findBySource("user")

    expect(localSkills.length).toBe(1)
    expect(localSkills[0].name).toBe("local-source")
    expect(userSkills.length).toBe(1)
    expect(userSkills[0].name).toBe("user-source")
  })

  test("searches skills by name and description", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        const skillDir = path.join(dir, ".opencode", "skill")
        await createSkillFile(skillDir, "create-task", {
          description: "Skill for creating development tasks",
        })
        await createSkillFile(skillDir, "review-code", {
          description: "Skill for code review workflows",
        })
        await createSkillFile(skillDir, "deploy-app", {
          description: "Skill for deployment automation",
        })
      },
    })

    getDiscovery({
      projectDir: tmp.path,
      userDir: path.join(tmp.path, ".empty-user"),
      cacheDir: path.join(tmp.path, ".empty-cache"),
      includeEmbedded: false,
    })

    const resolver = new SkillResolver()

    // Search by name
    const taskSkills = await resolver.search("task")
    expect(taskSkills.length).toBe(1)
    expect(taskSkills[0].name).toBe("create-task")

    // Search by description
    const workflowSkills = await resolver.search("workflow")
    expect(workflowSkills.length).toBe(1)
    expect(workflowSkills[0].name).toBe("review-code")

    // Case insensitive
    const deploySkills = await resolver.search("DEPLOY")
    expect(deploySkills.length).toBe(1)
  })

  test("returns all skills", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        const skillDir = path.join(dir, ".opencode", "skill")
        await createSkillFile(skillDir, "all-one")
        await createSkillFile(skillDir, "all-two")
      },
    })

    getDiscovery({
      projectDir: tmp.path,
      userDir: path.join(tmp.path, ".empty-user"),
      cacheDir: path.join(tmp.path, ".empty-cache"),
      includeEmbedded: false,
    })

    const resolver = new SkillResolver()
    const all = await resolver.all()

    expect(all.length).toBe(2)
  })

  test("returns correct stats", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        const skillDir = path.join(dir, ".opencode", "skill")
        await createSkillFile(skillDir, "stats-one")
        await createSkillFile(skillDir, "stats-two", {
          tools: ["nonexistent_tool"],
        })
      },
    })

    getDiscovery({
      projectDir: tmp.path,
      userDir: path.join(tmp.path, ".empty-user"),
      cacheDir: path.join(tmp.path, ".empty-cache"),
      includeEmbedded: false,
    })

    const resolver = new SkillResolver()
    const stats = await resolver.stats()

    expect(stats.total).toBe(2)
    expect(stats.bySource.local).toBe(2)
    expect(stats.withWarnings).toBe(1)
  })
})

describe("Convenience functions", () => {
  beforeEach(() => {
    resetDiscovery()
    resetResolver()
    setAvailableTools(["afwk_get_kanban_status"])
  })

  afterEach(() => {
    resetAvailableTools()
  })

  test("resolveSkill convenience function works", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        const skillDir = path.join(dir, ".opencode", "skill")
        await createSkillFile(skillDir, "convenience-skill")
      },
    })

    getDiscovery({
      projectDir: tmp.path,
      includeEmbedded: false,
    })

    const entry = await resolveSkill("convenience-skill")
    expect(entry?.name).toBe("convenience-skill")
  })

  test("loadSkill convenience function works", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        const skillDir = path.join(dir, ".opencode", "skill")
        await createSkillFile(skillDir, "load-convenience")
      },
    })

    getDiscovery({
      projectDir: tmp.path,
      includeEmbedded: false,
    })

    const loaded = await loadSkill("load-convenience")
    expect(loaded?.entry.name).toBe("load-convenience")
  })

  test("searchSkills convenience function works", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        const skillDir = path.join(dir, ".opencode", "skill")
        await createSkillFile(skillDir, "search-convenience")
      },
    })

    getDiscovery({
      projectDir: tmp.path,
      includeEmbedded: false,
    })

    const results = await searchSkills("search")
    expect(results.length).toBe(1)
  })
})

describe("Caching", () => {
  beforeEach(() => {
    resetDiscovery()
    resetResolver()
    setAvailableTools(["afwk_get_kanban_status"])
  })

  afterEach(() => {
    resetAvailableTools()
  })

  test("getSkillIndex caches results", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        const skillDir = path.join(dir, ".opencode", "skill")
        await createSkillFile(skillDir, "cache-test")
      },
    })

    getDiscovery({
      projectDir: tmp.path,
      includeEmbedded: false,
    })

    const index1 = await getSkillIndex()
    const index2 = await getSkillIndex()

    // Should return same object (cached)
    expect(index1).toBe(index2)
  })

  test("invalidateSkillIndex clears cache", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        const skillDir = path.join(dir, ".opencode", "skill")
        await createSkillFile(skillDir, "invalidate-test")
      },
    })

    getDiscovery({
      projectDir: tmp.path,
      includeEmbedded: false,
    })

    const index1 = await getSkillIndex()
    invalidateSkillIndex()
    const index2 = await getSkillIndex()

    // Should be different objects after invalidation
    expect(index1).not.toBe(index2)
    // But same content
    expect(index1.skills[0].name).toBe(index2.skills[0].name)
  })

  test("getSkillIndex refresh parameter forces refresh", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        const skillDir = path.join(dir, ".opencode", "skill")
        await createSkillFile(skillDir, "refresh-test")
      },
    })

    getDiscovery({
      projectDir: tmp.path,
      includeEmbedded: false,
    })

    const index1 = await getSkillIndex()
    const index2 = await getSkillIndex(true) // Force refresh

    // Should be different objects
    expect(index1).not.toBe(index2)
  })
})
