import { test, expect, beforeEach, afterEach } from "bun:test"
import path from "path"
import fs from "fs/promises"
import yaml from "yaml"
import { tmpdir } from "../fixture/fixture"
import {
  WorkflowConfigSchema,
  SyncLockSchema,
  validateConfig,
  validateSyncLock,
  validateRemoteIndex,
  type WorkflowConfigParsed,
} from "../../src/workflow/config/schema"
import {
  getDefaultConfig,
  getEnabledSources,
  hasSources,
  hasEnabledSources,
} from "../../src/workflow/config/loader"
import {
  WORKFLOW_PATHS,
  getGitHubRawUrl,
  parseTimeoutString,
  formatDuration,
  extractRepoName,
  isValidGitHubUrl,
} from "../../src/workflow/config/defaults"

// Schema validation tests
test("WorkflowConfigSchema validates correct config", () => {
  const config = {
    version: 1,
    sources: [
      {
        name: "official",
        url: "https://github.com/aifwk/workflow-catalog",
        branch: "main",
        enabled: true,
        priority: 100,
      },
    ],
    settings: {
      autoSync: false,
      syncInterval: "24h",
      offlineMode: false,
      timeout: "30s",
      skipValidation: false,
      allowIncompatible: true,
    },
  }

  const result = WorkflowConfigSchema.safeParse(config)
  expect(result.success).toBe(true)
})

test("WorkflowConfigSchema rejects HTTP URLs", () => {
  const config = {
    version: 1,
    sources: [
      {
        name: "insecure",
        url: "http://github.com/test/repo",
        branch: "main",
        enabled: true,
        priority: 50,
      },
    ],
    settings: {},
  }

  const result = WorkflowConfigSchema.safeParse(config)
  expect(result.success).toBe(false)
})

test("WorkflowConfigSchema applies defaults", () => {
  const config = {
    sources: [],
  }

  const result = WorkflowConfigSchema.safeParse(config)
  expect(result.success).toBe(true)
  if (result.success) {
    expect(result.data.version).toBe(1)
    expect(result.data.settings.timeout).toBe("30s")
    expect(result.data.settings.offlineMode).toBe(false)
  }
})

test("WorkflowConfigSchema validates source name format", () => {
  const validNames = ["official", "my-source", "source123", "a1"]
  const invalidNames = ["Official", "my_source", "123source", "-invalid", ""]

  for (const name of validNames) {
    const result = WorkflowConfigSchema.safeParse({
      sources: [{ name, url: "https://github.com/test/repo", branch: "main", enabled: true, priority: 50 }],
    })
    expect(result.success).toBe(true)
  }

  for (const name of invalidNames) {
    const result = WorkflowConfigSchema.safeParse({
      sources: [{ name, url: "https://github.com/test/repo", branch: "main", enabled: true, priority: 50 }],
    })
    expect(result.success).toBe(false)
  }
})

test("SyncLockSchema validates correct lock", () => {
  const lock = {
    version: 1,
    lastSync: "2026-01-23T10:00:00Z",
    sources: {
      official: {
        url: "https://github.com/aifwk/workflow-catalog",
        commit: "abc123",
        syncedAt: "2026-01-23T10:00:00Z",
      },
    },
    skills: {
      "sync-dipolework": {
        version: "1.0.0",
        source: "official",
        hash: "sha256:abc123",
        installedAt: "2026-01-23T10:00:00Z",
      },
    },
  }

  const result = SyncLockSchema.safeParse(lock)
  expect(result.success).toBe(true)
})

// Validation helper tests
test("validateConfig returns success for valid config", () => {
  const config = getDefaultConfig()
  const result = validateConfig(config)
  expect(result.success).toBe(true)
  expect(result.data).toBeDefined()
})

test("validateConfig returns error for invalid config", () => {
  const result = validateConfig({ sources: [{ name: "INVALID" }] })
  expect(result.success).toBe(false)
  expect(result.error).toBeDefined()
})

test("validateRemoteIndex validates correct index", () => {
  const index = {
    version: "1.0.0",
    name: "Test Catalog",
    description: "Test skills",
    lastUpdated: "2026-01-23T10:00:00Z",
    skills: [
      {
        name: "test-skill",
        version: "1.0.0",
        description: "A test skill",
        path: "skills/test-skill",
        tags: ["test"],
        hash: "sha256:abc123",
      },
    ],
  }

  const result = validateRemoteIndex(index)
  expect(result.success).toBe(true)
})

// Default config tests
test("getDefaultConfig returns valid config", () => {
  const config = getDefaultConfig()
  const result = validateConfig(config)
  expect(result.success).toBe(true)
})

test("getDefaultConfig includes official source", () => {
  const config = getDefaultConfig()
  expect(config.sources.length).toBe(1)
  expect(config.sources[0].name).toBe("official")
  expect(config.sources[0].url).toContain("github.com")
})

// Helper function tests
test("getEnabledSources filters and sorts by priority", () => {
  const config: WorkflowConfigParsed = {
    version: 1,
    sources: [
      { name: "low", url: "https://github.com/a/b", branch: "main", enabled: true, priority: 10 },
      { name: "high", url: "https://github.com/c/d", branch: "main", enabled: true, priority: 100 },
      { name: "disabled", url: "https://github.com/e/f", branch: "main", enabled: false, priority: 50 },
      { name: "medium", url: "https://github.com/g/h", branch: "main", enabled: true, priority: 50 },
    ],
    settings: {
      autoSync: false,
      syncInterval: "24h",
      offlineMode: false,
      timeout: "30s",
      skipValidation: false,
      allowIncompatible: true,
    },
  }

  const enabled = getEnabledSources(config)
  expect(enabled.length).toBe(3)
  expect(enabled[0].name).toBe("high")
  expect(enabled[1].name).toBe("medium")
  expect(enabled[2].name).toBe("low")
})

test("hasSources returns correct values", () => {
  expect(hasSources({ version: 1, sources: [], settings: {} as any })).toBe(false)
  expect(hasSources(getDefaultConfig())).toBe(true)
})

test("hasEnabledSources returns correct values", () => {
  const configNoEnabled: WorkflowConfigParsed = {
    version: 1,
    sources: [{ name: "disabled", url: "https://github.com/a/b", branch: "main", enabled: false, priority: 50 }],
    settings: {} as any,
  }
  expect(hasEnabledSources(configNoEnabled)).toBe(false)
  expect(hasEnabledSources(getDefaultConfig())).toBe(true)
})

// URL utility tests
test("getGitHubRawUrl generates correct URLs", () => {
  const url = getGitHubRawUrl("https://github.com/owner/repo", "main", "index.json")
  expect(url).toBe("https://raw.githubusercontent.com/owner/repo/main/index.json")
})

test("getGitHubRawUrl handles .git suffix", () => {
  const url = getGitHubRawUrl("https://github.com/owner/repo.git", "main", "index.json")
  expect(url).toBe("https://raw.githubusercontent.com/owner/repo/main/index.json")
})

test("getGitHubRawUrl throws for invalid URLs", () => {
  expect(() => getGitHubRawUrl("https://gitlab.com/owner/repo", "main", "file")).toThrow()
})

test("extractRepoName extracts correctly", () => {
  expect(extractRepoName("https://github.com/owner/repo")).toBe("repo")
  expect(extractRepoName("https://github.com/owner/repo.git")).toBe("repo")
  expect(extractRepoName("invalid")).toBeUndefined()
})

test("isValidGitHubUrl validates correctly", () => {
  expect(isValidGitHubUrl("https://github.com/owner/repo")).toBe(true)
  expect(isValidGitHubUrl("https://github.com/owner/repo.git")).toBe(true)
  expect(isValidGitHubUrl("http://github.com/owner/repo")).toBe(false)
  expect(isValidGitHubUrl("https://gitlab.com/owner/repo")).toBe(false)
})

// Timeout parsing tests
test("parseTimeoutString parses various formats", () => {
  expect(parseTimeoutString("30s")).toBe(30000)
  expect(parseTimeoutString("1m")).toBe(60000)
  expect(parseTimeoutString("500ms")).toBe(500)
  expect(parseTimeoutString("1h")).toBe(3600000)
  expect(parseTimeoutString("30")).toBe(30000) // Default to seconds
  expect(parseTimeoutString("invalid")).toBe(30000) // Default
})

test("formatDuration formats correctly", () => {
  expect(formatDuration(500)).toBe("500ms")
  expect(formatDuration(1500)).toBe("1.5s")
  expect(formatDuration(90000)).toBe("1.5m")
})

// Path constants tests
test("WORKFLOW_PATHS has expected structure", () => {
  expect(WORKFLOW_PATHS.base).toContain(".aifwk")
  expect(WORKFLOW_PATHS.config).toContain("config.yaml")
  expect(WORKFLOW_PATHS.lock).toContain("sync.lock")
  expect(WORKFLOW_PATHS.cache).toContain("skills")
})
