/**
 * Auto-Sync System
 * Automatic skill synchronization on startup and background intervals
 *
 * @module workflow/sync/auto-sync
 */

import { Log } from "../../util/log"
import { loadConfig, getEnabledSources } from "../config/loader"
import { loadLock, saveLock, updateLockAfterSync } from "./lock"
import { fetchRemoteIndex, fetchWithRetry } from "./fetcher"
import { compareWithLock, getSkillsToSync, hasChanges } from "./comparator"
import { downloadSkills, getSuccessfulDownloads, getDownloadStats } from "./downloader"
import { parseTimeoutString } from "../config/defaults"
import { Installation } from "../../installation"
import type { SyncLockParsed, WorkflowConfigParsed, SourceConfigParsed } from "../config/schema"
import type { SyncResult, SkillSyncResult } from "../types"

const log = Log.create({ service: "workflow.auto-sync" })

/**
 * Auto-sync state
 */
interface AutoSyncState {
  /** Whether auto-sync is currently running */
  running: boolean
  /** Timer ID for interval sync */
  intervalId: ReturnType<typeof setInterval> | null
  /** Last sync attempt timestamp */
  lastAttempt: number
  /** Last successful sync timestamp */
  lastSuccess: number
  /** Consecutive failure count */
  failureCount: number
}

const state: AutoSyncState = {
  running: false,
  intervalId: null,
  lastAttempt: 0,
  lastSuccess: 0,
  failureCount: 0,
}

/**
 * Parse interval string to milliseconds
 *
 * @param interval - Interval string (e.g., "24h", "30m", "7d")
 * @returns Interval in milliseconds
 */
export function parseIntervalString(interval: string): number {
  const match = interval.match(/^(\d+)(m|h|d)?$/)
  if (!match) return 24 * 60 * 60 * 1000 // Default 24h

  const [, value, unit] = match
  const num = parseInt(value, 10)

  switch (unit) {
    case "m":
      return num * 60 * 1000
    case "h":
      return num * 60 * 60 * 1000
    case "d":
      return num * 24 * 60 * 60 * 1000
    default:
      return num * 60 * 60 * 1000 // Default to hours
  }
}

/**
 * Check if sync is needed based on last sync time and interval
 *
 * @param lock - Current lock file
 * @param interval - Sync interval in milliseconds
 * @returns true if sync is needed
 */
export function isSyncNeeded(lock: SyncLockParsed, interval: number): boolean {
  if (!lock.lastSync) return true

  const lastSync = new Date(lock.lastSync).getTime()
  const now = Date.now()

  return now - lastSync >= interval
}

/**
 * Run auto-sync for a single source (silent, no UI output)
 *
 * @param source - Source to sync
 * @param config - Workflow config
 * @param lock - Current lock state
 * @returns Sync results
 */
async function syncSource(
  source: SourceConfigParsed,
  config: WorkflowConfigParsed,
  lock: SyncLockParsed,
): Promise<{ success: boolean; added: SkillSyncResult[]; updated: SkillSyncResult[]; errors: string[] }> {
  const result = { success: true, added: [] as SkillSyncResult[], updated: [] as SkillSyncResult[], errors: [] as string[] }

  try {
    // Fetch remote index
    const index = await fetchWithRetry(() => fetchRemoteIndex(source, config.settings))

    // Compare with lock
    const comparison = compareWithLock(lock, index.skills, Installation.VERSION, config.settings.allowIncompatible)

    // Get skills to sync
    const toSync = getSkillsToSync(comparison)

    if (toSync.length === 0) {
      log.debug("source up to date", { source: source.name })
      return result
    }

    // Download skills
    const downloads = await downloadSkills(source, toSync, config.settings)
    const stats = getDownloadStats(downloads)
    const successful = getSuccessfulDownloads(downloads)

    // Build sync results
    const syncedSkills: SkillSyncResult[] = []
    const skillHashes: Record<string, string> = {}

    for (const download of successful) {
      const isNew = comparison.toAdd.some((s) => s.name === download.name)
      const localVersion = lock.skills[download.name]?.version

      const syncResult: SkillSyncResult = {
        name: download.name,
        version: download.version,
        source: source.name,
        previousVersion: isNew ? undefined : localVersion,
      }

      syncedSkills.push(syncResult)
      if (download.hash) {
        skillHashes[download.name] = download.hash
      }

      if (isNew) {
        result.added.push(syncResult)
      } else {
        result.updated.push(syncResult)
      }
    }

    // Update lock file
    if (syncedSkills.length > 0) {
      await updateLockAfterSync(source.name, source.url, "HEAD", syncedSkills, skillHashes)
    }

    // Log failures
    for (const download of downloads.filter((d) => !d.success)) {
      result.errors.push(`${download.name}: ${download.error}`)
    }

    if (stats.failed > 0) {
      result.success = false
    }

    log.info("source synced", {
      source: source.name,
      added: result.added.length,
      updated: result.updated.length,
      failed: stats.failed,
    })
  } catch (error) {
    result.success = false
    result.errors.push(error instanceof Error ? error.message : String(error))
    log.error("source sync failed", { source: source.name, error })
  }

  return result
}

/**
 * Run auto-sync for all enabled sources
 *
 * @param force - Force sync even if not needed
 * @returns Combined sync result
 */
export async function runAutoSync(force = false): Promise<SyncResult> {
  const startTime = Date.now()
  const result: SyncResult = {
    success: true,
    added: [],
    updated: [],
    failed: [],
    warnings: [],
    duration: 0,
  }

  if (state.running) {
    log.debug("auto-sync already running, skipping")
    return result
  }

  state.running = true
  state.lastAttempt = Date.now()

  try {
    // Load config
    const config = await loadConfig()

    // Check if auto-sync is enabled (unless forced)
    if (!force && !config.settings.autoSync) {
      log.debug("auto-sync disabled in config")
      return result
    }

    // Check offline mode
    if (config.settings.offlineMode) {
      log.debug("offline mode enabled, skipping auto-sync")
      result.warnings.push("Offline mode enabled - auto-sync skipped")
      return result
    }

    // Load lock and check if sync is needed
    const lock = await loadLock()
    const interval = parseIntervalString(config.settings.syncInterval)

    if (!force && !isSyncNeeded(lock, interval)) {
      log.debug("sync not needed yet", {
        lastSync: lock.lastSync,
        interval: config.settings.syncInterval,
      })
      return result
    }

    // Get enabled sources
    const sources = getEnabledSources(config)

    if (sources.length === 0) {
      log.debug("no enabled sources configured")
      return result
    }

    log.info("starting auto-sync", { sources: sources.length })

    // Sync each source
    let currentLock = lock
    for (const source of sources) {
      const sourceResult = await syncSource(source, config, currentLock)

      result.added.push(...sourceResult.added)
      result.updated.push(...sourceResult.updated)

      for (const error of sourceResult.errors) {
        result.failed.push({
          name: source.name,
          source: source.name,
          error,
        })
      }

      if (!sourceResult.success) {
        result.success = false
      }

      // Reload lock for next source
      currentLock = await loadLock()
    }

    // Update success state
    if (result.success) {
      state.lastSuccess = Date.now()
      state.failureCount = 0
    } else {
      state.failureCount++
    }

    result.duration = Date.now() - startTime

    log.info("auto-sync complete", {
      success: result.success,
      added: result.added.length,
      updated: result.updated.length,
      failed: result.failed.length,
      duration: `${result.duration}ms`,
    })

    return result
  } catch (error) {
    state.failureCount++
    result.success = false
    result.duration = Date.now() - startTime

    log.error("auto-sync failed", { error })

    return result
  } finally {
    state.running = false
  }
}

/**
 * Start background sync interval
 *
 * @param config - Optional config override
 */
export async function startBackgroundSync(config?: WorkflowConfigParsed): Promise<void> {
  // Stop existing interval if any
  stopBackgroundSync()

  const cfg = config ?? (await loadConfig())

  if (!cfg.settings.autoSync) {
    log.debug("auto-sync disabled, not starting background sync")
    return
  }

  const interval = parseIntervalString(cfg.settings.syncInterval)

  log.info("starting background sync", {
    interval: cfg.settings.syncInterval,
    intervalMs: interval,
  })

  // Run initial sync
  await runAutoSync()

  // Set up interval
  state.intervalId = setInterval(async () => {
    try {
      await runAutoSync()
    } catch (error) {
      log.error("background sync iteration failed", { error })
    }
  }, interval)
}

/**
 * Stop background sync interval
 */
export function stopBackgroundSync(): void {
  if (state.intervalId) {
    clearInterval(state.intervalId)
    state.intervalId = null
    log.debug("background sync stopped")
  }
}

/**
 * Check if background sync is running
 */
export function isBackgroundSyncRunning(): boolean {
  return state.intervalId !== null
}

/**
 * Get auto-sync state information
 */
export function getAutoSyncState(): Readonly<AutoSyncState> {
  return { ...state }
}

/**
 * Run startup sync check
 * Called when the application starts to check if sync is needed
 *
 * @returns Sync result if sync was run, null if skipped
 */
export async function runStartupSync(): Promise<SyncResult | null> {
  try {
    const config = await loadConfig()

    // Check if auto-sync is enabled
    if (!config.settings.autoSync) {
      log.debug("auto-sync disabled, skipping startup sync")
      return null
    }

    // Check offline mode
    if (config.settings.offlineMode) {
      log.debug("offline mode enabled, skipping startup sync")
      return null
    }

    // Load lock and check if sync is needed
    const lock = await loadLock()
    const interval = parseIntervalString(config.settings.syncInterval)

    if (!isSyncNeeded(lock, interval)) {
      log.debug("startup sync not needed", {
        lastSync: lock.lastSync,
        interval: config.settings.syncInterval,
      })
      return null
    }

    log.info("running startup sync")
    return await runAutoSync(true)
  } catch (error) {
    log.error("startup sync check failed", { error })
    return null
  }
}

/**
 * Reset auto-sync state (mainly for testing)
 */
export function resetAutoSyncState(): void {
  stopBackgroundSync()
  state.running = false
  state.lastAttempt = 0
  state.lastSuccess = 0
  state.failureCount = 0
}
