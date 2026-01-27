/**
 * Version Comparator
 * Compare local vs remote skill versions for sync decisions
 *
 * @module workflow/sync/comparator
 */

import type { SyncLockParsed, SkillLockEntryParsed, RemoteSkillEntryParsed } from "../config/schema"
import { compareVersions } from "./lock"

/**
 * Result of comparing local lock with remote index
 */
export interface ComparisonResult {
  /** Skills that need to be added (new) */
  toAdd: RemoteSkillEntryParsed[]
  /** Skills that need to be updated (newer version available) */
  toUpdate: Array<{ remote: RemoteSkillEntryParsed; local: SkillLockEntryParsed }>
  /** Skills that are already up to date */
  upToDate: RemoteSkillEntryParsed[]
  /** Skills with version compatibility warnings */
  warnings: Array<{ skill: RemoteSkillEntryParsed; message: string }>
}

/**
 * Version compatibility check result
 */
export interface CompatibilityResult {
  compatible: boolean
  message?: string
}

/**
 * Check if current dipoleCODE version satisfies minimum requirement
 *
 * @param currentVersion - Current dipoleCODE version (e.g., "1.2.0")
 * @param minRequired - Minimum required version from skill (e.g., "1.0.0")
 * @returns Compatibility result with message if incompatible
 */
export function checkVersionCompatibility(
  currentVersion: string,
  minRequired?: string,
): CompatibilityResult {
  if (!minRequired) {
    return { compatible: true }
  }

  const comparison = compareVersions(currentVersion, minRequired)
  if (comparison >= 0) {
    return { compatible: true }
  }

  return {
    compatible: false,
    message: `requires dipoleCODE >= ${minRequired} (you have ${currentVersion})`,
  }
}

/**
 * Compare local lock with remote index to determine sync actions
 *
 * @param lock - Current sync lock state
 * @param remoteSkills - Skills from remote index
 * @param currentDipolecodeVersion - Current dipoleCODE version for compatibility check
 * @param allowIncompatible - Whether to include incompatible skills (with warning)
 * @returns Comparison result with categorized skills
 */
export function compareWithLock(
  lock: SyncLockParsed,
  remoteSkills: RemoteSkillEntryParsed[],
  currentDipolecodeVersion: string,
  allowIncompatible: boolean,
): ComparisonResult {
  const result: ComparisonResult = {
    toAdd: [],
    toUpdate: [],
    upToDate: [],
    warnings: [],
  }

  for (const remote of remoteSkills) {
    // Check version compatibility
    const compat = checkVersionCompatibility(currentDipolecodeVersion, remote.minDipolecode)

    if (!compat.compatible) {
      result.warnings.push({
        skill: remote,
        message: compat.message!,
      })

      if (!allowIncompatible) {
        continue // Skip incompatible skills
      }
    }

    const local = lock.skills[remote.name]

    if (!local) {
      // New skill - not in lock
      result.toAdd.push(remote)
    } else if (compareVersions(remote.version, local.version) > 0) {
      // Update available - remote version is newer
      result.toUpdate.push({ remote, local })
    } else {
      // Up to date - same version or local is newer (shouldn't happen normally)
      result.upToDate.push(remote)
    }
  }

  return result
}

/**
 * Filter skills by name pattern
 *
 * @param skills - Array of skills to filter
 * @param name - Exact skill name to find
 * @returns Matching skill or undefined
 */
export function filterByName(
  skills: RemoteSkillEntryParsed[],
  name: string,
): RemoteSkillEntryParsed | undefined {
  return skills.find((s) => s.name === name)
}

/**
 * Filter skills by tag
 *
 * @param skills - Array of skills to filter
 * @param tag - Tag to filter by
 * @returns Skills with matching tag
 */
export function filterByTag(skills: RemoteSkillEntryParsed[], tag: string): RemoteSkillEntryParsed[] {
  return skills.filter((s) => s.tags.includes(tag))
}

/**
 * Get summary stats from comparison result
 */
export function getComparisonSummary(result: ComparisonResult): {
  totalNew: number
  totalUpdates: number
  totalUpToDate: number
  totalWarnings: number
} {
  return {
    totalNew: result.toAdd.length,
    totalUpdates: result.toUpdate.length,
    totalUpToDate: result.upToDate.length,
    totalWarnings: result.warnings.length,
  }
}

/**
 * Check if any changes are needed based on comparison
 */
export function hasChanges(result: ComparisonResult): boolean {
  return result.toAdd.length > 0 || result.toUpdate.length > 0
}

/**
 * Get all skills that need to be synced (new + updates)
 */
export function getSkillsToSync(result: ComparisonResult): RemoteSkillEntryParsed[] {
  return [...result.toAdd, ...result.toUpdate.map((u) => u.remote)]
}
