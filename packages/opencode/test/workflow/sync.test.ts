import { test, expect, describe, beforeEach, afterEach, mock } from "bun:test"
import path from "path"
import fs from "fs/promises"
import os from "os"
import {
  // Comparator
  checkVersionCompatibility,
  compareWithLock,
  filterByName,
  filterByTag,
  getComparisonSummary,
  hasChanges,
  getSkillsToSync,
  // Hash
  computeContentHash,
  verifyHash,
  normalizeHash,
  extractHashValue,
  isValidHashFormat,
  HASH_PREFIX,
  // Downloader
  getDownloadStats,
  getSuccessfulDownloads,
  getFailedDownloads,
  type DownloadResult,
} from "../../src/workflow/sync"
import { createEmptyLock, compareVersions } from "../../src/workflow/sync/lock"
import type { SyncLockParsed, RemoteSkillEntryParsed } from "../../src/workflow/config/schema"

// ============================================
// Comparator Tests
// ============================================

describe("checkVersionCompatibility", () => {
  test("returns compatible when no minimum required", () => {
    const result = checkVersionCompatibility("1.0.0")
    expect(result.compatible).toBe(true)
    expect(result.message).toBeUndefined()
  })

  test("returns compatible when version satisfies minimum", () => {
    expect(checkVersionCompatibility("1.0.0", "1.0.0").compatible).toBe(true)
    expect(checkVersionCompatibility("2.0.0", "1.0.0").compatible).toBe(true)
    expect(checkVersionCompatibility("1.5.0", "1.0.0").compatible).toBe(true)
  })

  test("returns incompatible when version below minimum", () => {
    const result = checkVersionCompatibility("1.0.0", "2.0.0")
    expect(result.compatible).toBe(false)
    expect(result.message).toContain("requires dipoleCODE >= 2.0.0")
    expect(result.message).toContain("you have 1.0.0")
  })
})

describe("compareWithLock", () => {
  const createSkill = (
    name: string,
    version: string,
    minDipolecode?: string,
  ): RemoteSkillEntryParsed => ({
    name,
    version,
    description: `Test skill ${name}`,
    path: `skills/${name}`,
    tags: ["test"],
    hash: "sha256:abc123",
    minDipolecode,
  })

  test("identifies new skills (not in lock)", () => {
    const lock = createEmptyLock()
    const remoteSkills = [createSkill("new-skill", "1.0.0")]

    const result = compareWithLock(lock, remoteSkills, "1.0.0", true)

    expect(result.toAdd.length).toBe(1)
    expect(result.toAdd[0].name).toBe("new-skill")
    expect(result.toUpdate.length).toBe(0)
    expect(result.upToDate.length).toBe(0)
  })

  test("identifies updates (remote version newer)", () => {
    const lock: SyncLockParsed = {
      ...createEmptyLock(),
      skills: {
        "existing-skill": {
          version: "1.0.0",
          source: "official",
          hash: "sha256:old",
          installedAt: new Date().toISOString(),
        },
      },
    }
    const remoteSkills = [createSkill("existing-skill", "2.0.0")]

    const result = compareWithLock(lock, remoteSkills, "1.0.0", true)

    expect(result.toAdd.length).toBe(0)
    expect(result.toUpdate.length).toBe(1)
    expect(result.toUpdate[0].remote.version).toBe("2.0.0")
    expect(result.toUpdate[0].local.version).toBe("1.0.0")
    expect(result.upToDate.length).toBe(0)
  })

  test("identifies up-to-date skills (same version)", () => {
    const lock: SyncLockParsed = {
      ...createEmptyLock(),
      skills: {
        "up-to-date-skill": {
          version: "1.0.0",
          source: "official",
          hash: "sha256:current",
          installedAt: new Date().toISOString(),
        },
      },
    }
    const remoteSkills = [createSkill("up-to-date-skill", "1.0.0")]

    const result = compareWithLock(lock, remoteSkills, "1.0.0", true)

    expect(result.toAdd.length).toBe(0)
    expect(result.toUpdate.length).toBe(0)
    expect(result.upToDate.length).toBe(1)
    expect(result.upToDate[0].name).toBe("up-to-date-skill")
  })

  test("adds warning for incompatible skills", () => {
    const lock = createEmptyLock()
    const remoteSkills = [createSkill("new-skill", "1.0.0", "2.0.0")] // requires 2.0.0

    const result = compareWithLock(lock, remoteSkills, "1.0.0", true) // we have 1.0.0

    expect(result.warnings.length).toBe(1)
    expect(result.warnings[0].skill.name).toBe("new-skill")
    expect(result.warnings[0].message).toContain("requires dipoleCODE >= 2.0.0")
    // With allowIncompatible=true, skill should still be added
    expect(result.toAdd.length).toBe(1)
  })

  test("skips incompatible skills when allowIncompatible=false", () => {
    const lock = createEmptyLock()
    const remoteSkills = [createSkill("new-skill", "1.0.0", "2.0.0")]

    const result = compareWithLock(lock, remoteSkills, "1.0.0", false)

    expect(result.warnings.length).toBe(1)
    expect(result.toAdd.length).toBe(0) // Skipped due to incompatibility
  })
})

describe("filterByName", () => {
  const skills: RemoteSkillEntryParsed[] = [
    { name: "skill-a", version: "1.0.0", description: "A", path: "a", tags: [], hash: "x" },
    { name: "skill-b", version: "2.0.0", description: "B", path: "b", tags: [], hash: "y" },
  ]

  test("finds skill by exact name", () => {
    const result = filterByName(skills, "skill-a")
    expect(result).toBeDefined()
    expect(result?.name).toBe("skill-a")
  })

  test("returns undefined for non-existent skill", () => {
    const result = filterByName(skills, "nonexistent")
    expect(result).toBeUndefined()
  })
})

describe("filterByTag", () => {
  const skills: RemoteSkillEntryParsed[] = [
    { name: "skill-a", version: "1.0.0", description: "A", path: "a", tags: ["tag1", "tag2"], hash: "x" },
    { name: "skill-b", version: "2.0.0", description: "B", path: "b", tags: ["tag2", "tag3"], hash: "y" },
    { name: "skill-c", version: "3.0.0", description: "C", path: "c", tags: ["tag3"], hash: "z" },
  ]

  test("filters skills by tag", () => {
    const result = filterByTag(skills, "tag2")
    expect(result.length).toBe(2)
    expect(result.map((s) => s.name)).toEqual(["skill-a", "skill-b"])
  })

  test("returns empty array for non-matching tag", () => {
    const result = filterByTag(skills, "nonexistent")
    expect(result.length).toBe(0)
  })
})

describe("comparison helpers", () => {
  test("getComparisonSummary returns correct counts", () => {
    const result = {
      toAdd: [{ name: "a" }, { name: "b" }] as RemoteSkillEntryParsed[],
      toUpdate: [{ remote: { name: "c" } as RemoteSkillEntryParsed, local: {} as any }],
      upToDate: [{ name: "d" }, { name: "e" }, { name: "f" }] as RemoteSkillEntryParsed[],
      warnings: [{ skill: { name: "g" } as RemoteSkillEntryParsed, message: "warning" }],
    }

    const summary = getComparisonSummary(result)
    expect(summary.totalNew).toBe(2)
    expect(summary.totalUpdates).toBe(1)
    expect(summary.totalUpToDate).toBe(3)
    expect(summary.totalWarnings).toBe(1)
  })

  test("hasChanges detects changes", () => {
    expect(
      hasChanges({
        toAdd: [{ name: "a" }] as RemoteSkillEntryParsed[],
        toUpdate: [],
        upToDate: [],
        warnings: [],
      }),
    ).toBe(true)

    expect(
      hasChanges({
        toAdd: [],
        toUpdate: [{ remote: {} as RemoteSkillEntryParsed, local: {} as any }],
        upToDate: [],
        warnings: [],
      }),
    ).toBe(true)

    expect(
      hasChanges({
        toAdd: [],
        toUpdate: [],
        upToDate: [{ name: "a" }] as RemoteSkillEntryParsed[],
        warnings: [],
      }),
    ).toBe(false)
  })

  test("getSkillsToSync combines adds and updates", () => {
    const result = {
      toAdd: [{ name: "new" }] as RemoteSkillEntryParsed[],
      toUpdate: [{ remote: { name: "update" } as RemoteSkillEntryParsed, local: {} as any }],
      upToDate: [],
      warnings: [],
    }

    const toSync = getSkillsToSync(result)
    expect(toSync.length).toBe(2)
    expect(toSync.map((s) => s.name)).toEqual(["new", "update"])
  })
})

// ============================================
// Hash Tests
// ============================================

describe("computeContentHash", () => {
  test("computes consistent hash for same content", async () => {
    const content = "Hello, World!"
    const hash1 = await computeContentHash(content)
    const hash2 = await computeContentHash(content)

    expect(hash1).toBe(hash2)
    expect(hash1.startsWith(HASH_PREFIX)).toBe(true)
  })

  test("computes different hash for different content", async () => {
    const hash1 = await computeContentHash("content1")
    const hash2 = await computeContentHash("content2")

    expect(hash1).not.toBe(hash2)
  })

  test("produces 64 character hex hash", async () => {
    const hash = await computeContentHash("test")
    const value = extractHashValue(hash)

    expect(value.length).toBe(64)
    expect(/^[a-f0-9]+$/.test(value)).toBe(true)
  })
})

describe("normalizeHash", () => {
  test("adds prefix if missing", () => {
    const result = normalizeHash("abc123")
    expect(result).toBe("sha256:abc123")
  })

  test("keeps prefix if present", () => {
    const result = normalizeHash("sha256:abc123")
    expect(result).toBe("sha256:abc123")
  })
})

describe("extractHashValue", () => {
  test("removes prefix", () => {
    const result = extractHashValue("sha256:abc123")
    expect(result).toBe("abc123")
  })

  test("returns as-is if no prefix", () => {
    const result = extractHashValue("abc123")
    expect(result).toBe("abc123")
  })
})

describe("verifyHash", () => {
  test("returns true for matching hashes", () => {
    expect(verifyHash("sha256:abc", "sha256:abc")).toBe(true)
    expect(verifyHash("abc", "sha256:abc")).toBe(true)
    expect(verifyHash("sha256:abc", "abc")).toBe(true)
  })

  test("returns false for non-matching hashes", () => {
    expect(verifyHash("sha256:abc", "sha256:def")).toBe(false)
    expect(verifyHash("abc", "def")).toBe(false)
  })
})

describe("isValidHashFormat", () => {
  test("validates correct SHA256 format", () => {
    // 64 hex characters
    const validHash = "a".repeat(64)
    expect(isValidHashFormat(validHash)).toBe(true)
    expect(isValidHashFormat(`sha256:${validHash}`)).toBe(true)
  })

  test("rejects invalid formats", () => {
    expect(isValidHashFormat("")).toBe(false)
    expect(isValidHashFormat("tooshort")).toBe(false)
    expect(isValidHashFormat("g".repeat(64))).toBe(false) // 'g' is not hex
    expect(isValidHashFormat("a".repeat(63))).toBe(false) // too short
    expect(isValidHashFormat("a".repeat(65))).toBe(false) // too long
  })
})

// ============================================
// Download Stats Tests
// ============================================

describe("download stats helpers", () => {
  const results: DownloadResult[] = [
    { success: true, name: "skill-1", version: "1.0.0", path: "/path/1" },
    { success: true, name: "skill-2", version: "1.0.0", path: "/path/2" },
    { success: false, name: "skill-3", version: "1.0.0", error: "Network error" },
    { success: false, name: "skill-4", version: "1.0.0", error: "Hash mismatch" },
  ]

  test("getDownloadStats returns correct counts", () => {
    const stats = getDownloadStats(results)

    expect(stats.successful).toBe(2)
    expect(stats.failed).toBe(2)
    expect(stats.total).toBe(4)
    expect(stats.errors.length).toBe(2)
    expect(stats.errors[0]).toContain("skill-3")
    expect(stats.errors[0]).toContain("Network error")
  })

  test("getSuccessfulDownloads filters correctly", () => {
    const successful = getSuccessfulDownloads(results)

    expect(successful.length).toBe(2)
    expect(successful.every((r) => r.success)).toBe(true)
  })

  test("getFailedDownloads filters correctly", () => {
    const failed = getFailedDownloads(results)

    expect(failed.length).toBe(2)
    expect(failed.every((r) => !r.success)).toBe(true)
  })
})
