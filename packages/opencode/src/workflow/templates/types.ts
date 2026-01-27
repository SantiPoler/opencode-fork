/**
 * Template System Types
 * TypeScript interfaces for the template synchronization system
 *
 * @module workflow/templates/types
 */

/**
 * Template source priority (same as skills)
 */
export type TemplateSource = "local" | "user" | "cached" | "embedded"

/**
 * Template frontmatter metadata
 */
export interface TemplateFrontmatter {
  /** Template name (kebab-case) */
  name: string
  /** Human-readable description */
  description: string
  /** Semantic version */
  version?: string
  /** Template type/category */
  type?: "devtask" | "aitask" | "completion" | "overview" | "blueprint" | "custom"
  /** Variables used in this template */
  variables?: string[]
  /** Author or team */
  author?: string
  /** Tags for categorization */
  tags?: string[]
}

/**
 * Template index entry
 */
export interface TemplateIndexEntry {
  /** Template name */
  name: string
  /** Human-readable description */
  description: string
  /** Template source */
  source: TemplateSource
  /** File path */
  path: string
  /** Version if available */
  version?: string
  /** Template type */
  type?: string
  /** Template variables */
  variables?: string[]
}

/**
 * Template index
 */
export interface TemplateIndex {
  /** All discovered templates */
  templates: TemplateIndexEntry[]
  /** Generation timestamp */
  generatedAt: string
  /** Count by source */
  sources: Record<TemplateSource, number>
}

/**
 * Remote template entry (index.json)
 */
export interface RemoteTemplateEntry {
  /** Template name */
  name: string
  /** Semantic version */
  version: string
  /** Human-readable description */
  description: string
  /** Path to template in repo */
  path: string
  /** Template type */
  type?: string
  /** SHA256 hash of content */
  hash: string
}

/**
 * Template lock entry
 */
export interface TemplateLockEntry {
  /** Installed version */
  version: string
  /** Source name */
  source: string
  /** Content hash */
  hash: string
  /** Installation timestamp */
  installedAt: string
}

/**
 * Template discovery event
 */
export interface TemplateDiscoveryEvent {
  /** Event type */
  type: "discovered" | "override" | "skipped" | "error"
  /** Template name if available */
  name?: string
  /** Template source */
  source: TemplateSource
  /** File path */
  path: string
  /** Override source if applicable */
  overriddenBy?: TemplateSource
  /** Error reason if applicable */
  reason?: string
}

/**
 * Template discovery options
 */
export interface TemplateDiscoveryOptions {
  /** Project directory for local templates */
  projectDir?: string
  /** User templates directory */
  userDir?: string
  /** Cache directory for synced templates */
  cacheDir?: string
  /** Whether to include embedded templates */
  includeEmbedded?: boolean
}

/**
 * Template validation result
 */
export interface TemplateValidationResult {
  /** Whether validation passed */
  valid: boolean
  /** Validation errors */
  errors: string[]
  /** Validated entry if successful */
  entry?: TemplateIndexEntry
}

/**
 * Loaded template with content
 */
export interface LoadedTemplate {
  /** Template metadata */
  entry: TemplateIndexEntry
  /** Raw markdown content */
  content: string
  /** Parsed frontmatter */
  frontmatter: TemplateFrontmatter
}

/**
 * Template sync result
 */
export interface TemplateSyncResult {
  /** Template name */
  name: string
  /** Synced version */
  version: string
  /** Source name */
  source: string
  /** Previous version if update */
  previousVersion?: string
}

/**
 * Template download result
 */
export interface TemplateDownloadResult {
  /** Whether download succeeded */
  success: boolean
  /** Template name */
  name: string
  /** Template version */
  version: string
  /** Saved path */
  path?: string
  /** Computed hash */
  hash?: string
  /** Error message if failed */
  error?: string
}
