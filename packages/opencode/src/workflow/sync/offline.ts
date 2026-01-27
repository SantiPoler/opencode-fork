/**
 * Offline Mode Support
 * Graceful degradation when network is unavailable
 *
 * @module workflow/sync/offline
 */

import { Log } from "../../util/log"
import { loadConfig } from "../config/loader"
import { loadLock } from "./lock"
import { WORKFLOW_PATHS } from "../config/defaults"
import { getSkillIndex, invalidateSkillIndex } from "../../skill/discovery"
import type { SyncLockParsed, WorkflowConfigParsed, SkillLockEntryParsed } from "../config/schema"
import type { SkillIndex, SkillIndexEntry } from "../../skill/types"
import fs from "fs/promises"
import path from "path"

const log = Log.create({ service: "workflow.offline" })

/**
 * Network status
 */
export type NetworkStatus = "online" | "offline" | "degraded" | "unknown"

/**
 * Offline mode state
 */
interface OfflineModeState {
  /** Current network status */
  networkStatus: NetworkStatus
  /** Whether we're in forced offline mode */
  forcedOffline: boolean
  /** Last network check timestamp */
  lastCheck: number
  /** Consecutive failure count */
  consecutiveFailures: number
  /** Cache of available offline skills */
  cachedSkillsList: string[] | null
}

const state: OfflineModeState = {
  networkStatus: "unknown",
  forcedOffline: false,
  lastCheck: 0,
  consecutiveFailures: 0,
  cachedSkillsList: null,
}

/**
 * Check if network error indicates connectivity issues
 *
 * @param error - Error to check
 * @returns true if error suggests network unavailability
 */
export function isNetworkError(error: unknown): boolean {
  if (!(error instanceof Error)) return false

  const message = error.message.toLowerCase()
  const networkIndicators = [
    "network",
    "enotfound",
    "econnrefused",
    "econnreset",
    "etimedout",
    "socket",
    "dns",
    "unable to connect",
    "fetch failed",
    "connection reset",
    "no internet",
  ]

  return networkIndicators.some((indicator) => message.includes(indicator))
}

/**
 * Check if we should operate in offline mode
 *
 * @param config - Optional config override
 * @returns true if offline mode should be used
 */
export async function shouldUseOfflineMode(config?: WorkflowConfigParsed): Promise<boolean> {
  const cfg = config ?? (await loadConfig())

  // Explicit offline mode setting
  if (cfg.settings.offlineMode) {
    state.forcedOffline = true
    return true
  }

  // Too many consecutive failures suggests network issues
  if (state.consecutiveFailures >= 3) {
    log.warn("too many consecutive network failures, entering offline mode")
    return true
  }

  return false
}

/**
 * Update network status after an operation
 *
 * @param success - Whether the network operation succeeded
 * @param error - Error if operation failed
 */
export function updateNetworkStatus(success: boolean, error?: unknown): void {
  state.lastCheck = Date.now()

  if (success) {
    state.networkStatus = "online"
    state.consecutiveFailures = 0
  } else if (isNetworkError(error)) {
    state.consecutiveFailures++

    if (state.consecutiveFailures >= 3) {
      state.networkStatus = "offline"
    } else {
      state.networkStatus = "degraded"
    }

    log.debug("network status updated", {
      status: state.networkStatus,
      failures: state.consecutiveFailures,
    })
  }
}

/**
 * Reset network failure counter
 * Call this after a successful network operation
 */
export function resetNetworkFailures(): void {
  state.consecutiveFailures = 0
  state.networkStatus = "online"
}

/**
 * Get list of cached skills available for offline use
 *
 * @returns Array of cached skill names
 */
export async function getCachedSkills(): Promise<string[]> {
  if (state.cachedSkillsList !== null) {
    return state.cachedSkillsList
  }

  const skills: string[] = []

  try {
    const cacheDir = WORKFLOW_PATHS.cache
    const entries = await fs.readdir(cacheDir, { withFileTypes: true })

    for (const entry of entries) {
      if (entry.isDirectory()) {
        // Check if SKILL.md exists
        const skillFile = path.join(cacheDir, entry.name, "SKILL.md")
        try {
          await fs.access(skillFile)
          skills.push(entry.name)
        } catch {
          // SKILL.md doesn't exist, skip
        }
      }
    }

    state.cachedSkillsList = skills
    log.debug("cached skills enumerated", { count: skills.length })
  } catch (error) {
    // Cache directory may not exist
    log.debug("failed to enumerate cached skills", { error })
    state.cachedSkillsList = []
  }

  return state.cachedSkillsList
}

/**
 * Invalidate cached skills list
 * Call this after sync operations
 */
export function invalidateCachedSkillsList(): void {
  state.cachedSkillsList = null
}

/**
 * Get offline skill information from lock file
 *
 * @param skillName - Skill name
 * @returns Skill lock entry or undefined
 */
export async function getOfflineSkillInfo(skillName: string): Promise<SkillLockEntryParsed | undefined> {
  const lock = await loadLock()
  return lock.skills[skillName]
}

/**
 * Get all offline skill information
 *
 * @returns Record of skill names to lock entries
 */
export async function getAllOfflineSkillInfo(): Promise<Record<string, SkillLockEntryParsed>> {
  const lock = await loadLock()
  return lock.skills
}

/**
 * Check if a skill is available offline
 *
 * @param skillName - Skill name
 * @returns true if skill is cached
 */
export async function isSkillAvailableOffline(skillName: string): Promise<boolean> {
  const cachedSkills = await getCachedSkills()
  return cachedSkills.includes(skillName)
}

/**
 * Get offline status summary
 *
 * @returns Offline status information
 */
export async function getOfflineStatus(): Promise<{
  networkStatus: NetworkStatus
  forcedOffline: boolean
  cachedSkillCount: number
  lastSyncTime: string | undefined
}> {
  const lock = await loadLock()
  const cachedSkills = await getCachedSkills()

  return {
    networkStatus: state.networkStatus,
    forcedOffline: state.forcedOffline,
    cachedSkillCount: cachedSkills.length,
    lastSyncTime: lock.lastSync,
  }
}

/**
 * Wrapper for network operations with offline fallback
 *
 * @param operation - Async network operation
 * @param fallback - Fallback function if operation fails
 * @returns Result from operation or fallback
 */
export async function withOfflineFallback<T>(
  operation: () => Promise<T>,
  fallback: () => Promise<T> | T,
): Promise<{ result: T; fromCache: boolean }> {
  // Check if forced offline
  if (state.forcedOffline || state.networkStatus === "offline") {
    log.debug("using offline fallback (offline mode active)")
    return { result: await fallback(), fromCache: true }
  }

  try {
    const result = await operation()
    updateNetworkStatus(true)
    return { result, fromCache: false }
  } catch (error) {
    updateNetworkStatus(false, error)

    if (isNetworkError(error)) {
      log.warn("network operation failed, using fallback", { error })
      return { result: await fallback(), fromCache: true }
    }

    // Non-network error, rethrow
    throw error
  }
}

/**
 * Get skill index with offline support
 * Returns cached index if network is unavailable
 *
 * @param refresh - Whether to refresh the cache
 * @returns Skill index
 */
export async function getSkillIndexWithOfflineSupport(refresh = false): Promise<{
  index: SkillIndex
  fromCache: boolean
}> {
  const config = await loadConfig()

  // If offline mode is enabled, just return cached index
  if (config.settings.offlineMode || state.networkStatus === "offline") {
    const index = await getSkillIndex(false) // Don't try to refresh
    return { index, fromCache: true }
  }

  // Try to get fresh index
  try {
    const index = await getSkillIndex(refresh)
    return { index, fromCache: false }
  } catch (error) {
    if (isNetworkError(error)) {
      log.warn("network unavailable, using cached skill index")
      const index = await getSkillIndex(false)
      return { index, fromCache: true }
    }
    throw error
  }
}

/**
 * Get current network status
 */
export function getNetworkStatus(): NetworkStatus {
  return state.networkStatus
}

/**
 * Set forced offline mode
 *
 * @param offline - Whether to force offline mode
 */
export function setForcedOffline(offline: boolean): void {
  state.forcedOffline = offline
  if (offline) {
    state.networkStatus = "offline"
  }
}

/**
 * Check if currently in offline mode (forced or detected)
 */
export function isOffline(): boolean {
  return state.forcedOffline || state.networkStatus === "offline"
}

/**
 * Reset offline mode state (mainly for testing)
 */
export function resetOfflineState(): void {
  state.networkStatus = "unknown"
  state.forcedOffline = false
  state.lastCheck = 0
  state.consecutiveFailures = 0
  state.cachedSkillsList = null
}

/**
 * Format time since last sync for display
 *
 * @param lastSync - ISO timestamp of last sync
 * @returns Human-readable duration string
 */
export function formatTimeSinceSync(lastSync: string | undefined): string {
  if (!lastSync) return "never"

  const ms = Date.now() - new Date(lastSync).getTime()
  const minutes = Math.floor(ms / 60000)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  if (days > 0) return `${days} day(s) ago`
  if (hours > 0) return `${hours} hour(s) ago`
  if (minutes > 0) return `${minutes} minute(s) ago`
  return "just now"
}
