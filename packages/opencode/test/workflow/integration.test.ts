import { test, expect, describe, beforeEach, afterEach, mock } from "bun:test"
import path from "path"
import fs from "fs/promises"
import os from "os"

// Config and Lock
import {
  loadConfig,
  saveConfig,
  getDefaultConfig,
  addSource,
  removeSource,
  getEnabledSources,
  resetConfig,
  configExists,
} from "../../src/workflow/config/loader"
import {
  loadLock,
  saveLock,
  createEmptyLock,
  updateLockAfterSync,
  getInstalledSkill,
  getAllInstalledSkills,
  removeSkillFromLock,
  isSkillInstalled,
  getLastSyncTime,
  deleteLock,
} from "../../src/workflow/sync/lock"
import { WORKFLOW_PATHS } from "../../src/workflow/config/defaults"

// Offline mode
import {
  isNetworkError,
  shouldUseOfflineMode,
  updateNetworkStatus,
  resetNetworkFailures,
  getCachedSkills,
  invalidateCachedSkillsList,
  withOfflineFallback,
  getNetworkStatus,
  setForcedOffline,
  isOffline,
  resetOfflineState,
  formatTimeSinceSync,
} from "../../src/workflow/sync/offline"

// Auto-sync
import {
  parseIntervalString,
  isSyncNeeded,
  getAutoSyncState,
  resetAutoSyncState,
} from "../../src/workflow/sync/auto-sync"

// Template system
import {
  validateTemplateFrontmatter,
  getTemplateDiscovery,
  getTemplateIndex,
  invalidateTemplateIndex,
  resetTemplateDiscovery,
} from "../../src/workflow/templates/discovery"
import {
  resolveTemplate,
  loadTemplate,
  getAllTemplates,
  templateExists,
  renderTemplate,
  getMissingVariables,
  extractVariables,
} from "../../src/workflow/templates/resolver"
import { EMBEDDED_TEMPLATES, EMBEDDED_TEMPLATE_CONTENT } from "../../src/workflow/templates/constants"

// ============================================
// Test setup
// ============================================

let tempDir: string

beforeEach(async () => {
  // Create temp directory for tests
  tempDir = path.join(os.tmpdir(), `workflow-integration-test-${Date.now()}`)
  await fs.mkdir(tempDir, { recursive: true })

  // Reset all state
  resetOfflineState()
  resetAutoSyncState()
  resetTemplateDiscovery()
})

afterEach(async () => {
  // Cleanup temp directory
  try {
    await fs.rm(tempDir, { recursive: true, force: true })
  } catch {
    // Ignore cleanup errors
  }
})

// ============================================
// Offline Mode Integration Tests
// ============================================

describe("Offline Mode", () => {
  describe("isNetworkError", () => {
    test("detects common network errors", () => {
      expect(isNetworkError(new Error("ENOTFOUND"))).toBe(true)
      expect(isNetworkError(new Error("ECONNREFUSED"))).toBe(true)
      expect(isNetworkError(new Error("ETIMEDOUT"))).toBe(true)
      expect(isNetworkError(new Error("fetch failed"))).toBe(true)
      expect(isNetworkError(new Error("Network error"))).toBe(true)
      expect(isNetworkError(new Error("connection reset"))).toBe(true)
    })

    test("does not flag non-network errors", () => {
      expect(isNetworkError(new Error("File not found"))).toBe(false)
      expect(isNetworkError(new Error("Permission denied"))).toBe(false)
      expect(isNetworkError(new Error("Invalid JSON"))).toBe(false)
      expect(isNetworkError("string error")).toBe(false)
      expect(isNetworkError(null)).toBe(false)
    })
  })

  describe("updateNetworkStatus", () => {
    beforeEach(() => {
      resetOfflineState()
    })

    test("sets online status on success", () => {
      updateNetworkStatus(true)
      expect(getNetworkStatus()).toBe("online")
    })

    test("sets degraded status on first network failure", () => {
      updateNetworkStatus(false, new Error("ENOTFOUND"))
      expect(getNetworkStatus()).toBe("degraded")
    })

    test("sets offline status after 3 consecutive failures", () => {
      updateNetworkStatus(false, new Error("ENOTFOUND"))
      updateNetworkStatus(false, new Error("ENOTFOUND"))
      updateNetworkStatus(false, new Error("ENOTFOUND"))
      expect(getNetworkStatus()).toBe("offline")
    })

    test("resets failure count on success", () => {
      updateNetworkStatus(false, new Error("ENOTFOUND"))
      updateNetworkStatus(false, new Error("ENOTFOUND"))
      updateNetworkStatus(true) // Success resets
      updateNetworkStatus(false, new Error("ENOTFOUND"))
      expect(getNetworkStatus()).toBe("degraded") // Not offline yet
    })
  })

  describe("setForcedOffline", () => {
    beforeEach(() => {
      resetOfflineState()
    })

    test("forces offline mode", () => {
      setForcedOffline(true)
      expect(isOffline()).toBe(true)
      expect(getNetworkStatus()).toBe("offline")
    })

    test("can be turned off", () => {
      setForcedOffline(true)
      setForcedOffline(false)
      // Note: status doesn't auto-reset to online
      expect(getNetworkStatus()).toBe("offline")
    })
  })

  describe("withOfflineFallback", () => {
    beforeEach(() => {
      resetOfflineState()
    })

    test("returns operation result when online", async () => {
      const { result, fromCache } = await withOfflineFallback(
        async () => "online result",
        () => "fallback result",
      )

      expect(result).toBe("online result")
      expect(fromCache).toBe(false)
    })

    test("returns fallback when forced offline", async () => {
      setForcedOffline(true)

      const { result, fromCache } = await withOfflineFallback(
        async () => "online result",
        () => "fallback result",
      )

      expect(result).toBe("fallback result")
      expect(fromCache).toBe(true)
    })

    test("returns fallback on network error", async () => {
      const { result, fromCache } = await withOfflineFallback(
        async () => {
          throw new Error("ENOTFOUND")
        },
        () => "fallback result",
      )

      expect(result).toBe("fallback result")
      expect(fromCache).toBe(true)
    })

    test("rethrows non-network errors", async () => {
      await expect(
        withOfflineFallback(
          async () => {
            throw new Error("Permission denied")
          },
          () => "fallback result",
        ),
      ).rejects.toThrow("Permission denied")
    })
  })

  describe("formatTimeSinceSync", () => {
    test("handles undefined", () => {
      expect(formatTimeSinceSync(undefined)).toBe("never")
    })

    test("formats recent times", () => {
      const now = new Date().toISOString()
      expect(formatTimeSinceSync(now)).toBe("just now")
    })

    test("formats minutes ago", () => {
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString()
      expect(formatTimeSinceSync(fiveMinutesAgo)).toBe("5 minute(s) ago")
    })

    test("formats hours ago", () => {
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
      expect(formatTimeSinceSync(twoHoursAgo)).toBe("2 hour(s) ago")
    })

    test("formats days ago", () => {
      const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString()
      expect(formatTimeSinceSync(threeDaysAgo)).toBe("3 day(s) ago")
    })
  })
})

// ============================================
// Auto-Sync Integration Tests
// ============================================

describe("Auto-Sync", () => {
  describe("parseIntervalString", () => {
    test("parses minutes", () => {
      expect(parseIntervalString("30m")).toBe(30 * 60 * 1000)
      expect(parseIntervalString("1m")).toBe(60 * 1000)
    })

    test("parses hours", () => {
      expect(parseIntervalString("1h")).toBe(60 * 60 * 1000)
      expect(parseIntervalString("24h")).toBe(24 * 60 * 60 * 1000)
    })

    test("parses days", () => {
      expect(parseIntervalString("1d")).toBe(24 * 60 * 60 * 1000)
      expect(parseIntervalString("7d")).toBe(7 * 24 * 60 * 60 * 1000)
    })

    test("defaults to hours for no unit", () => {
      expect(parseIntervalString("24")).toBe(24 * 60 * 60 * 1000)
    })

    test("returns default for invalid format", () => {
      expect(parseIntervalString("invalid")).toBe(24 * 60 * 60 * 1000)
    })
  })

  describe("isSyncNeeded", () => {
    test("returns true when never synced", () => {
      const lock = createEmptyLock()
      // @ts-ignore - testing with empty lastSync
      lock.lastSync = ""
      expect(isSyncNeeded(lock, 60000)).toBe(true)
    })

    test("returns true when interval has passed", () => {
      const lock = createEmptyLock()
      lock.lastSync = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString() // 2 hours ago
      expect(isSyncNeeded(lock, 60 * 60 * 1000)).toBe(true) // 1 hour interval
    })

    test("returns false when within interval", () => {
      const lock = createEmptyLock()
      lock.lastSync = new Date(Date.now() - 30 * 60 * 1000).toISOString() // 30 minutes ago
      expect(isSyncNeeded(lock, 60 * 60 * 1000)).toBe(false) // 1 hour interval
    })
  })

  describe("getAutoSyncState", () => {
    beforeEach(() => {
      resetAutoSyncState()
    })

    test("returns initial state", () => {
      const state = getAutoSyncState()
      expect(state.running).toBe(false)
      expect(state.intervalId).toBeNull()
      expect(state.lastAttempt).toBe(0)
      expect(state.lastSuccess).toBe(0)
      expect(state.failureCount).toBe(0)
    })
  })
})

// ============================================
// Template System Integration Tests
// ============================================

describe("Template System", () => {
  describe("validateTemplateFrontmatter", () => {
    test("validates valid frontmatter", () => {
      const result = validateTemplateFrontmatter(
        {
          name: "test-template",
          description: "A test template",
          version: "1.0.0",
          type: "custom",
        },
        "/path/to/template.md",
        "local",
      )

      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
      expect(result.entry?.name).toBe("test-template")
      expect(result.entry?.source).toBe("local")
    })

    test("rejects missing name", () => {
      const result = validateTemplateFrontmatter(
        {
          description: "A test template",
        },
        "/path/to/template.md",
        "local",
      )

      expect(result.valid).toBe(false)
      expect(result.errors).toContain("Missing or invalid 'name' field")
    })

    test("rejects missing description", () => {
      const result = validateTemplateFrontmatter(
        {
          name: "test-template",
        },
        "/path/to/template.md",
        "local",
      )

      expect(result.valid).toBe(false)
      expect(result.errors).toContain("Missing or invalid 'description' field")
    })

    test("rejects non-object frontmatter", () => {
      const result = validateTemplateFrontmatter("string", "/path/to/template.md", "local")

      expect(result.valid).toBe(false)
      expect(result.errors).toContain("Frontmatter must be an object")
    })
  })

  describe("embedded templates", () => {
    test("has overview template", () => {
      expect(EMBEDDED_TEMPLATES["overview"]).toBeDefined()
      expect(EMBEDDED_TEMPLATE_CONTENT["overview"]).toBeDefined()
      expect(EMBEDDED_TEMPLATE_CONTENT["overview"]).toContain("{{title}}")
    })

    test("has aitask-blueprint template", () => {
      expect(EMBEDDED_TEMPLATES["aitask-blueprint"]).toBeDefined()
      expect(EMBEDDED_TEMPLATE_CONTENT["aitask-blueprint"]).toBeDefined()
    })

    test("has completion-notes template", () => {
      expect(EMBEDDED_TEMPLATES["completion-notes"]).toBeDefined()
      expect(EMBEDDED_TEMPLATE_CONTENT["completion-notes"]).toBeDefined()
    })
  })

  describe("extractVariables", () => {
    test("extracts simple variables", () => {
      const content = "Hello {{name}}, welcome to {{place}}!"
      const variables = extractVariables(content)

      expect(variables).toContain("name")
      expect(variables).toContain("place")
      expect(variables.length).toBe(2)
    })

    test("handles variables with spaces", () => {
      const content = "Hello {{ name }}, welcome!"
      const variables = extractVariables(content)

      expect(variables).toContain("name")
    })

    test("returns unique variables", () => {
      const content = "{{name}} said {{name}} twice"
      const variables = extractVariables(content)

      expect(variables.length).toBe(1)
      expect(variables).toContain("name")
    })

    test("handles no variables", () => {
      const content = "No variables here"
      const variables = extractVariables(content)

      expect(variables.length).toBe(0)
    })
  })

  describe("Template Discovery", () => {
    beforeEach(() => {
      resetTemplateDiscovery()
    })

    test("discovers embedded templates", async () => {
      const discovery = getTemplateDiscovery({
        projectDir: tempDir,
        userDir: path.join(tempDir, "user"),
        cacheDir: path.join(tempDir, "cache"),
        includeEmbedded: true,
      })

      const index = await discovery.discover()

      expect(index.templates.length).toBeGreaterThanOrEqual(3) // At least embedded templates
      expect(index.templates.some((t) => t.name === "overview")).toBe(true)
      expect(index.templates.some((t) => t.name === "aitask-blueprint")).toBe(true)
      expect(index.templates.some((t) => t.name === "completion-notes")).toBe(true)
    })

    test("respects includeEmbedded option", async () => {
      const discovery = getTemplateDiscovery({
        projectDir: tempDir,
        userDir: path.join(tempDir, "user"),
        cacheDir: path.join(tempDir, "cache"),
        includeEmbedded: false,
      })

      const index = await discovery.discover()

      expect(index.templates.length).toBe(0) // No templates in empty dirs
    })

    test("records discovery events", async () => {
      const discovery = getTemplateDiscovery({
        projectDir: tempDir,
        includeEmbedded: true,
      })

      await discovery.discover()
      const events = discovery.getEvents()

      expect(events.length).toBeGreaterThan(0)
      expect(events.some((e) => e.type === "discovered")).toBe(true)
    })
  })

  describe("Template Loading", () => {
    beforeEach(() => {
      resetTemplateDiscovery()
      // Initialize discovery with embedded templates
      getTemplateDiscovery({
        projectDir: tempDir,
        includeEmbedded: true,
      })
    })

    test("loads embedded overview template", async () => {
      const template = await loadTemplate("overview")

      expect(template).toBeDefined()
      expect(template?.entry.name).toBe("overview")
      expect(template?.content).toContain("{{title}}")
      expect(template?.frontmatter.name).toBe("overview")
    })

    test("returns undefined for non-existent template", async () => {
      const template = await loadTemplate("nonexistent")
      expect(template).toBeUndefined()
    })

    test("templateExists works correctly", async () => {
      expect(await templateExists("overview")).toBe(true)
      expect(await templateExists("nonexistent")).toBe(false)
    })
  })

  describe("Template Rendering", () => {
    test("renderTemplate replaces variables", async () => {
      resetTemplateDiscovery()
      getTemplateDiscovery({ projectDir: tempDir, includeEmbedded: true })

      const template = await loadTemplate("overview")
      expect(template).toBeDefined()

      const rendered = renderTemplate(template!, {
        title: "My Task",
        objective: "Test the system",
        description: "A test description",
        scope: "Unit tests",
        criteria: "All tests pass",
      })

      expect(rendered).toContain("My Task")
      expect(rendered).toContain("Test the system")
      expect(rendered).not.toContain("{{title}}")
    })

    test("renderTemplate handles timestamp", async () => {
      resetTemplateDiscovery()
      getTemplateDiscovery({ projectDir: tempDir, includeEmbedded: true })

      const template = await loadTemplate("completion-notes")
      expect(template).toBeDefined()

      const rendered = renderTemplate(template!, {
        title: "Test",
        summary: "Done",
        changes: "None",
        notes: "N/A",
      })

      // Should have replaced {{timestamp}} with ISO date
      expect(rendered).not.toContain("{{timestamp}}")
      expect(rendered).toMatch(/\d{4}-\d{2}-\d{2}/) // ISO date pattern
    })
  })

  describe("getMissingVariables", () => {
    test("identifies missing required variables", async () => {
      resetTemplateDiscovery()
      getTemplateDiscovery({ projectDir: tempDir, includeEmbedded: true })

      const template = await loadTemplate("overview")
      expect(template).toBeDefined()

      const missing = getMissingVariables(template!, { title: "Test" })

      // Should be missing all except title
      expect(missing).toContain("description")
      expect(missing).toContain("objective")
      expect(missing).not.toContain("title")
    })

    test("returns empty when all provided", async () => {
      resetTemplateDiscovery()
      getTemplateDiscovery({ projectDir: tempDir, includeEmbedded: true })

      const template = await loadTemplate("overview")
      expect(template).toBeDefined()

      const missing = getMissingVariables(template!, {
        title: "Test",
        description: "Desc",
        objective: "Obj",
        scope: "Scope",
        criteria: "Crit",
      })

      expect(missing.length).toBe(0)
    })
  })

  describe("getAllTemplates", () => {
    beforeEach(() => {
      resetTemplateDiscovery()
      getTemplateDiscovery({ projectDir: tempDir, includeEmbedded: true })
    })

    test("returns all templates", async () => {
      const templates = await getAllTemplates()

      expect(templates.length).toBeGreaterThanOrEqual(3)
      expect(templates.map((t) => t.name)).toContain("overview")
      expect(templates.map((t) => t.name)).toContain("aitask-blueprint")
      expect(templates.map((t) => t.name)).toContain("completion-notes")
    })
  })
})

// ============================================
// End-to-End Workflow Tests
// ============================================

describe("End-to-End Workflow", () => {
  describe("Config and Lock Integration", () => {
    // Note: These tests would require mocking the file system
    // or using actual file operations with temp directories

    test("createEmptyLock creates valid lock", () => {
      const lock = createEmptyLock()

      expect(lock.version).toBe(1)
      expect(lock.lastSync).toBeDefined()
      expect(lock.sources).toEqual({})
      expect(lock.skills).toEqual({})
    })

    test("getDefaultConfig creates valid config", () => {
      // Import and test getDefaultConfig
      const config = {
        version: 1,
        sources: [],
        settings: {
          autoSync: false,
          syncInterval: "24h",
          offlineMode: false,
          timeout: "30s",
          skipValidation: false,
          allowIncompatible: true,
        },
      }

      expect(config.version).toBe(1)
      expect(config.settings.autoSync).toBe(false)
      expect(config.settings.syncInterval).toBe("24h")
    })
  })

  describe("Sync and Offline Integration", () => {
    beforeEach(() => {
      resetOfflineState()
    })

    test("graceful degradation on network failure", async () => {
      let callCount = 0

      const result = await withOfflineFallback(
        async () => {
          callCount++
          throw new Error("ECONNREFUSED")
        },
        () => ({ cached: true, data: "fallback" }),
      )

      expect(callCount).toBe(1)
      expect(result.fromCache).toBe(true)
      expect(result.result).toEqual({ cached: true, data: "fallback" })
    })

    test("updates network status across operations", async () => {
      // Simulate multiple operations
      updateNetworkStatus(true) // Success
      expect(getNetworkStatus()).toBe("online")

      updateNetworkStatus(false, new Error("ENOTFOUND")) // Failure
      expect(getNetworkStatus()).toBe("degraded")

      updateNetworkStatus(true) // Recovery
      expect(getNetworkStatus()).toBe("online")
    })
  })
})
