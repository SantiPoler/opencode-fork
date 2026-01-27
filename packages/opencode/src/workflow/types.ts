/**
 * Workflow Sync Types
 * TypeScript interfaces for the skill synchronization system (Phase 3)
 *
 * @module workflow/types
 */

/**
 * Authentication configuration for private repositories
 */
export interface AuthConfig {
  /** Authentication type */
  type: "github-token" | "bearer"
  /** Environment variable name containing the token */
  env: string
}

/**
 * Configuration for a skill source (repository)
 */
export interface SourceConfig {
  /** Unique name for this source */
  name: string
  /** GitHub repository URL (HTTPS only) */
  url: string
  /** Branch to sync from */
  branch: string
  /** Whether this source is enabled */
  enabled: boolean
  /** Priority for conflict resolution (higher = preferred) */
  priority: number
  /** Optional authentication config for private repos */
  auth?: AuthConfig
}

/**
 * Global workflow settings
 */
export interface WorkflowSettings {
  /** Auto-sync on startup (Phase 4 - not implemented) */
  autoSync: boolean
  /** Interval for auto-sync (Phase 4 - not implemented) */
  syncInterval: string
  /** Use only cached skills, no network requests */
  offlineMode: boolean
  /** Network request timeout (e.g., "30s", "1m") */
  timeout: string
  /** Skip frontmatter validation on downloaded skills */
  skipValidation: boolean
  /** Install skills with version compatibility warnings */
  allowIncompatible: boolean
}

/**
 * Complete workflow configuration (config.yaml)
 */
export interface WorkflowConfig {
  /** Config file format version */
  version: number
  /** Configured skill sources */
  sources: SourceConfig[]
  /** Global settings */
  settings: WorkflowSettings
}

/**
 * Lock entry for a synced source
 */
export interface SourceLockEntry {
  /** Repository URL */
  url: string
  /** Git commit hash at sync time */
  commit: string
  /** ISO timestamp of last sync */
  syncedAt: string
}

/**
 * Lock entry for a synced skill
 */
export interface SkillLockEntry {
  /** Semantic version of installed skill */
  version: string
  /** Source name this skill came from */
  source: string
  /** SHA256 hash of SKILL.md content */
  hash: string
  /** ISO timestamp of installation */
  installedAt: string
}

/**
 * Complete sync lock file (sync.lock)
 */
export interface SyncLock {
  /** Lock file format version */
  version: number
  /** ISO timestamp of last sync operation */
  lastSync: string
  /** Lock entries per source */
  sources: Record<string, SourceLockEntry>
  /** Lock entries per skill */
  skills: Record<string, SkillLockEntry>
}

/**
 * Remote repository index (index.json)
 */
export interface RemoteIndex {
  /** Index format version */
  version: string
  /** Repository display name */
  name: string
  /** Repository description */
  description: string
  /** ISO timestamp of last index update */
  lastUpdated: string
  /** Available skills in this repository */
  skills: RemoteSkillEntry[]
}

/**
 * Single skill entry in remote index
 */
export interface RemoteSkillEntry {
  /** Skill identifier (kebab-case) */
  name: string
  /** Semantic version */
  version: string
  /** Human-readable description */
  description: string
  /** Path to skill directory in repo (e.g., "skills/sync-dipolework") */
  path: string
  /** Minimum dipoleCODE version required */
  minDipolecode?: string
  /** Categorization tags */
  tags: string[]
  /** SHA256 hash of SKILL.md content */
  hash: string
}

/**
 * Result of a sync operation
 */
export interface SyncResult {
  /** Overall success status */
  success: boolean
  /** Skills that were updated */
  updated: SkillSyncResult[]
  /** Skills that were newly added */
  added: SkillSyncResult[]
  /** Skills that failed to sync */
  failed: SkillSyncError[]
  /** Warning messages */
  warnings: string[]
  /** Total duration in milliseconds */
  duration: number
}

/**
 * Successfully synced skill
 */
export interface SkillSyncResult {
  /** Skill name */
  name: string
  /** New version */
  version: string
  /** Source name */
  source: string
  /** Previous version (if update) */
  previousVersion?: string
}

/**
 * Failed skill sync
 */
export interface SkillSyncError {
  /** Skill name */
  name: string
  /** Source name */
  source: string
  /** Error message */
  error: string
}

/**
 * Result of comparing local vs remote skills
 */
export interface ComparisonResult {
  /** Skills that need to be added (new) */
  toAdd: RemoteSkillEntry[]
  /** Skills that need to be updated */
  toUpdate: Array<{ remote: RemoteSkillEntry; local: SkillLockEntry }>
  /** Skills that are up to date */
  upToDate: RemoteSkillEntry[]
  /** Skills with version warnings */
  warnings: Array<{ skill: RemoteSkillEntry; message: string }>
}

/**
 * Download result for a single skill
 */
export interface DownloadResult {
  /** Whether download succeeded */
  success: boolean
  /** Skill name */
  name: string
  /** Skill version */
  version: string
  /** Path where skill was saved */
  path?: string
  /** Computed hash of downloaded content */
  hash?: string
  /** Error message if failed */
  error?: string
}
