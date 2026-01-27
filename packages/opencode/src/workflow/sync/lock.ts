/**
 * Workflow Sync Lock Manager
 * Manage sync.lock file for tracking synchronization state
 *
 * @module workflow/sync/lock
 */

import fs from "fs/promises"
import path from "path"
import yaml from "yaml"
import { SyncLockSchema, type SyncLockParsed, type SkillLockEntryParsed, type TemplateLockEntryParsed } from "../config/schema"
import { WORKFLOW_PATHS, LOCK_VERSION } from "../config/defaults"
import { SyncError, SyncErrorCode } from "./errors"
import type { SkillSyncResult } from "../types"

/**
 * Create an empty lock file structure
 */
export function createEmptyLock(): SyncLockParsed {
  return {
    version: LOCK_VERSION,
    lastSync: new Date().toISOString(),
    sources: {},
    skills: {},
    templates: {},
  }
}

/**
 * Ensure the lock file directory exists
 */
async function ensureLockDir(): Promise<void> {
  const dir = path.dirname(WORKFLOW_PATHS.lock)
  await fs.mkdir(dir, { recursive: true })
}

/**
 * Load lock file from disk
 * Creates empty lock if file doesn't exist
 * Recreates lock if file is corrupted
 *
 * @returns Lock file data
 */
export async function loadLock(): Promise<SyncLockParsed> {
  const file = Bun.file(WORKFLOW_PATHS.lock)

  if (!(await file.exists())) {
    return createEmptyLock()
  }

  let content: string
  try {
    content = await file.text()
  } catch {
    // Can't read file, recreate
    console.warn("Could not read sync.lock, recreating...")
    return createEmptyLock()
  }

  let parsed: unknown
  try {
    parsed = yaml.parse(content)
  } catch {
    // Corrupted YAML, recreate
    console.warn("Corrupted sync.lock (invalid YAML), recreating...")
    return createEmptyLock()
  }

  const result = SyncLockSchema.safeParse(parsed)
  if (!result.success) {
    // Schema validation failed, recreate
    console.warn("Corrupted sync.lock (schema mismatch), recreating...")
    return createEmptyLock()
  }

  return result.data
}

/**
 * Save lock file to disk (atomic write)
 *
 * @param lock - Lock data to save
 */
export async function saveLock(lock: SyncLockParsed): Promise<void> {
  await ensureLockDir()

  const header = `# ~/.aifwk/sync.lock
# DO NOT EDIT MANUALLY
# This file tracks the state of synced skills
# Regenerated automatically by: opencode workflow sync

`

  const content =
    header +
    yaml.stringify(lock, {
      lineWidth: 0,
      defaultKeyType: "PLAIN",
    })

  // Atomic write
  const tempPath = `${WORKFLOW_PATHS.lock}.tmp`

  try {
    await Bun.write(tempPath, content)
    await fs.rename(tempPath, WORKFLOW_PATHS.lock)
  } catch (error) {
    // Clean up temp file
    try {
      await fs.unlink(tempPath)
    } catch {
      // Ignore cleanup errors
    }
    throw new SyncError(
      `Failed to save sync.lock: ${error instanceof Error ? error.message : String(error)}`,
      SyncErrorCode.WRITE_FAILED,
    )
  }
}

/**
 * Update lock file after successful sync
 *
 * @param sourceName - Name of the source that was synced
 * @param sourceUrl - URL of the source
 * @param commit - Git commit hash (or "HEAD" if unknown)
 * @param syncedSkills - Skills that were synced
 * @param skillHashes - Map of skill name to computed hash
 */
export async function updateLockAfterSync(
  sourceName: string,
  sourceUrl: string,
  commit: string,
  syncedSkills: SkillSyncResult[],
  skillHashes: Record<string, string> = {},
): Promise<void> {
  const lock = await loadLock()
  const now = new Date().toISOString()

  // Update last sync time
  lock.lastSync = now

  // Update source entry
  lock.sources[sourceName] = {
    url: sourceUrl,
    commit,
    syncedAt: now,
  }

  // Update skill entries
  for (const skill of syncedSkills) {
    lock.skills[skill.name] = {
      version: skill.version,
      source: sourceName,
      hash: skillHashes[skill.name] || "",
      installedAt: now,
    }
  }

  await saveLock(lock)
}

/**
 * Remove a skill from the lock file
 *
 * @param skillName - Name of the skill to remove
 */
export async function removeSkillFromLock(skillName: string): Promise<void> {
  const lock = await loadLock()

  if (lock.skills[skillName]) {
    delete lock.skills[skillName]
    await saveLock(lock)
  }
}

/**
 * Remove all skills from a source from the lock file
 *
 * @param sourceName - Name of the source
 */
export async function removeSourceFromLock(sourceName: string): Promise<void> {
  const lock = await loadLock()

  // Remove source entry
  if (lock.sources[sourceName]) {
    delete lock.sources[sourceName]
  }

  // Remove all skills from this source
  for (const [skillName, entry] of Object.entries(lock.skills)) {
    if (entry.source === sourceName) {
      delete lock.skills[skillName]
    }
  }

  await saveLock(lock)
}

/**
 * Get installed skill info from lock
 *
 * @param name - Skill name
 * @returns Skill lock entry or undefined if not found
 */
export async function getInstalledSkill(name: string): Promise<SkillLockEntryParsed | undefined> {
  const lock = await loadLock()
  return lock.skills[name]
}

/**
 * Get all installed skills from lock
 *
 * @returns Record of skill names to lock entries
 */
export async function getAllInstalledSkills(): Promise<Record<string, SkillLockEntryParsed>> {
  const lock = await loadLock()
  return lock.skills
}

/**
 * Get skills installed from a specific source
 *
 * @param sourceName - Source name
 * @returns Array of skill names from this source
 */
export async function getSkillsFromSource(sourceName: string): Promise<string[]> {
  const lock = await loadLock()
  return Object.entries(lock.skills)
    .filter(([, entry]) => entry.source === sourceName)
    .map(([name]) => name)
}

/**
 * Check if a skill is installed
 *
 * @param name - Skill name
 * @returns true if skill is in lock file
 */
export async function isSkillInstalled(name: string): Promise<boolean> {
  const lock = await loadLock()
  return name in lock.skills
}

/**
 * Get the timestamp of last sync
 *
 * @returns ISO timestamp or undefined if never synced
 */
export async function getLastSyncTime(): Promise<string | undefined> {
  const lock = await loadLock()
  return lock.lastSync
}

/**
 * Get source sync info
 *
 * @param sourceName - Source name
 * @returns Source lock entry or undefined
 */
export async function getSourceSyncInfo(
  sourceName: string,
): Promise<{ url: string; commit: string; syncedAt: string } | undefined> {
  const lock = await loadLock()
  return lock.sources[sourceName]
}

/**
 * Check if lock file exists
 */
export async function lockExists(): Promise<boolean> {
  const file = Bun.file(WORKFLOW_PATHS.lock)
  return file.exists()
}

/**
 * Delete lock file (for reset operations)
 */
export async function deleteLock(): Promise<void> {
  try {
    await fs.unlink(WORKFLOW_PATHS.lock)
  } catch {
    // Ignore if file doesn't exist
  }
}

/**
 * Compare versions to determine if update is needed
 * Simple semver comparison: major.minor.patch
 *
 * @param a - First version
 * @param b - Second version
 * @returns positive if a > b, negative if a < b, 0 if equal
 */
export function compareVersions(a: string, b: string): number {
  const parseVersion = (v: string) => {
    const [version, prerelease] = v.split("-")
    const parts = version.split(".").map(Number)
    return { parts, prerelease }
  }

  const va = parseVersion(a)
  const vb = parseVersion(b)

  // Compare major.minor.patch
  for (let i = 0; i < 3; i++) {
    const diff = (va.parts[i] || 0) - (vb.parts[i] || 0)
    if (diff !== 0) return diff
  }

  // Handle prerelease (no prerelease > with prerelease)
  if (!va.prerelease && vb.prerelease) return 1
  if (va.prerelease && !vb.prerelease) return -1
  if (va.prerelease && vb.prerelease) {
    return va.prerelease.localeCompare(vb.prerelease)
  }

  return 0
}

/**
 * Check if a skill needs update based on version comparison
 *
 * @param lock - Current lock data
 * @param name - Skill name
 * @param remoteVersion - Version available remotely
 * @returns true if remote version is newer
 */
export function skillNeedsUpdate(lock: SyncLockParsed, name: string, remoteVersion: string): boolean {
  const installed = lock.skills[name]
  if (!installed) return true // New skill needs "update" (install)

  return compareVersions(remoteVersion, installed.version) > 0
}

// ============================================================================
// Template Lock Functions
// ============================================================================

/**
 * Synced template result for lock update
 */
export interface TemplateSyncResult {
  name: string
  version: string
  source: string
  previousVersion?: string
}

/**
 * Update lock file after successful template sync
 *
 * @param sourceName - Name of the source that was synced
 * @param syncedTemplates - Templates that were synced
 * @param templateHashes - Map of template name to computed hash
 */
export async function updateLockAfterTemplateSync(
  sourceName: string,
  syncedTemplates: TemplateSyncResult[],
  templateHashes: Record<string, string> = {},
): Promise<void> {
  const lock = await loadLock()
  const now = new Date().toISOString()

  // Ensure templates object exists (for backwards compatibility)
  if (!lock.templates) {
    lock.templates = {}
  }

  // Update template entries
  for (const template of syncedTemplates) {
    lock.templates[template.name] = {
      version: template.version,
      source: sourceName,
      hash: templateHashes[template.name] || "",
      installedAt: now,
    }
  }

  await saveLock(lock)
}

/**
 * Remove a template from the lock file
 *
 * @param templateName - Name of the template to remove
 */
export async function removeTemplateFromLock(templateName: string): Promise<void> {
  const lock = await loadLock()

  if (lock.templates && lock.templates[templateName]) {
    delete lock.templates[templateName]
    await saveLock(lock)
  }
}

/**
 * Get installed template info from lock
 *
 * @param name - Template name
 * @returns Template lock entry or undefined if not found
 */
export async function getInstalledTemplate(name: string): Promise<TemplateLockEntryParsed | undefined> {
  const lock = await loadLock()
  return lock.templates?.[name]
}

/**
 * Get all installed templates from lock
 *
 * @returns Record of template names to lock entries
 */
export async function getAllInstalledTemplates(): Promise<Record<string, TemplateLockEntryParsed>> {
  const lock = await loadLock()
  return lock.templates || {}
}

/**
 * Get templates installed from a specific source
 *
 * @param sourceName - Source name
 * @returns Array of template names from this source
 */
export async function getTemplatesFromSource(sourceName: string): Promise<string[]> {
  const lock = await loadLock()
  if (!lock.templates) return []

  return Object.entries(lock.templates)
    .filter(([, entry]) => entry.source === sourceName)
    .map(([name]) => name)
}

/**
 * Check if a template is installed
 *
 * @param name - Template name
 * @returns true if template is in lock file
 */
export async function isTemplateInstalled(name: string): Promise<boolean> {
  const lock = await loadLock()
  return !!(lock.templates && name in lock.templates)
}

/**
 * Check if a template needs update based on version comparison
 *
 * @param lock - Current lock data
 * @param name - Template name
 * @param remoteVersion - Version available remotely
 * @returns true if remote version is newer
 */
export function templateNeedsUpdate(lock: SyncLockParsed, name: string, remoteVersion: string): boolean {
  if (!lock.templates) return true
  const installed = lock.templates[name]
  if (!installed) return true // New template needs "update" (install)

  return compareVersions(remoteVersion, installed.version) > 0
}
