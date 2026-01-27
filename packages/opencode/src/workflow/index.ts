/**
 * Workflow Module
 * Skill synchronization system for dipoleCODE (Phase 3)
 *
 * This module provides:
 * - Configuration management (config.yaml)
 * - Sync lock management (sync.lock)
 * - Remote source synchronization
 * - CLI commands for workflow management
 *
 * @module workflow
 */

// Types
export * from "./types"

// Config management
export {
  // Schema types
  type WorkflowConfigParsed,
  type SourceConfigParsed,
  type WorkflowSettingsParsed,
  type SyncLockParsed,
  type SourceLockEntryParsed,
  type SkillLockEntryParsed,
  type RemoteIndexParsed,
  type RemoteSkillEntryParsed,
  // Schemas
  WorkflowConfigSchema,
  SourceConfigSchema,
  WorkflowSettingsSchema,
  SyncLockSchema,
  RemoteIndexSchema,
  // Validation functions
  validateConfig,
  validateSyncLock,
  validateRemoteIndex,
} from "./config/schema"

export {
  // Loader functions
  loadConfig,
  saveConfig,
  getDefaultConfig,
  addSource,
  removeSource,
  updateSource,
  getSource,
  getEnabledSources,
  hasSources,
  hasEnabledSources,
  updateSettings,
  resetConfig,
  configExists,
} from "./config/loader"

export {
  // Path constants
  WORKFLOW_PATHS,
  OFFICIAL_SOURCE,
  DEFAULT_SETTINGS,
  NETWORK_DEFAULTS,
  CONFIG_VERSION,
  LOCK_VERSION,
  // Utility functions
  getGitHubRawUrl,
  parseTimeoutString,
  formatDuration,
  extractRepoName,
  isValidGitHubUrl,
} from "./config/defaults"

// Sync management
export {
  // Error classes
  SyncError,
  ConfigError,
  NetworkError,
  ValidationError,
  SyncErrorCode,
  // Error factory functions
  errorFromResponse,
  timeoutError,
  networkErrorFromException,
} from "./sync/errors"

export {
  // Lock management
  loadLock,
  saveLock,
  createEmptyLock,
  updateLockAfterSync,
  removeSkillFromLock,
  removeSourceFromLock,
  getInstalledSkill,
  getAllInstalledSkills,
  getSkillsFromSource,
  isSkillInstalled,
  getLastSyncTime,
  getSourceSyncInfo,
  lockExists,
  deleteLock,
  compareVersions,
  skillNeedsUpdate,
} from "./sync/lock"

export {
  // Fetcher
  fetchRemoteIndex,
  fetchRawContent,
  fetchWithRetry,
  getSourceHeaders,
} from "./sync/fetcher"

export {
  // Comparator
  type ComparisonResult,
  type CompatibilityResult,
  checkVersionCompatibility,
  compareWithLock,
  filterByName,
  filterByTag,
  getComparisonSummary,
  hasChanges,
  getSkillsToSync,
} from "./sync/comparator"

export {
  // Downloader
  type DownloadResult,
  type DownloadProgressCallback,
  downloadSkill,
  downloadSkills,
  downloadSkillByName,
  getDownloadStats,
  getSuccessfulDownloads,
  getFailedDownloads,
  ensureCacheDirectory,
  cleanupPartialDownload,
  deleteCachedSkill,
} from "./sync/downloader"

export {
  // Hash utilities
  HASH_PREFIX,
  computeContentHash,
  computeFileHash,
  computeBinaryHash,
  normalizeHash,
  verifyHash,
  extractHashValue,
  isValidHashFormat,
} from "./sync/hash"

export {
  // Auto-sync
  parseIntervalString,
  isSyncNeeded,
  runAutoSync,
  startBackgroundSync,
  stopBackgroundSync,
  isBackgroundSyncRunning,
  getAutoSyncState,
  runStartupSync,
  resetAutoSyncState,
} from "./sync/auto-sync"

export {
  // Offline mode
  isNetworkError,
  shouldUseOfflineMode,
  updateNetworkStatus,
  resetNetworkFailures,
  getCachedSkills,
  invalidateCachedSkillsList,
  getOfflineSkillInfo,
  getAllOfflineSkillInfo,
  isSkillAvailableOffline,
  getOfflineStatus,
  withOfflineFallback,
  getSkillIndexWithOfflineSupport,
  getNetworkStatus,
  setForcedOffline,
  isOffline,
  resetOfflineState,
  formatTimeSinceSync,
  type NetworkStatus,
} from "./sync/offline"

// Template system
export * from "./templates"
