/**
 * Workflow Configuration Defaults
 * Constants, paths, and default values for the workflow system
 *
 * @module workflow/config/defaults
 */

import os from "os"
import path from "path"
import type { SourceConfig, WorkflowSettings } from "../types"

/**
 * File paths for workflow system
 */
export const WORKFLOW_PATHS = {
  /** Base directory for aiFRAMEWORK data */
  base: path.join(os.homedir(), ".aifwk"),
  /** Config file location */
  config: path.join(os.homedir(), ".aifwk", "config.yaml"),
  /** Lock file location */
  lock: path.join(os.homedir(), ".aifwk", "sync.lock"),
  /** Cache directory for synced skills */
  cache: path.join(os.homedir(), ".aifwk", "cache", "skills"),
  /** Cache directory for synced templates */
  templateCache: path.join(os.homedir(), ".aifwk", "cache", "templates"),
} as const

/**
 * Official repository configuration
 */
export const OFFICIAL_SOURCE: SourceConfig = {
  name: "official",
  url: "https://github.com/aifwk/workflow-catalog",
  branch: "main",
  enabled: true,
  priority: 100,
}

/**
 * Default workflow settings
 */
export const DEFAULT_SETTINGS: WorkflowSettings = {
  autoSync: false,
  syncInterval: "24h",
  offlineMode: false,
  timeout: "30s",
  skipValidation: false,
  allowIncompatible: true,
}

/**
 * Network configuration defaults
 */
export const NETWORK_DEFAULTS = {
  /** Default timeout for HTTP requests (ms) */
  timeoutMs: 30000,
  /** Maximum concurrent downloads */
  maxConcurrent: 5,
  /** Number of retries for failed requests */
  maxRetries: 3,
  /** Initial backoff delay (ms) */
  backoffInitial: 1000,
  /** Maximum backoff delay (ms) */
  backoffMax: 10000,
} as const

/**
 * Config file format version
 */
export const CONFIG_VERSION = 1

/**
 * Lock file format version
 */
export const LOCK_VERSION = 1

/**
 * Convert GitHub repo URL to raw content URL
 *
 * @param repoUrl - GitHub repository URL (e.g., "https://github.com/owner/repo")
 * @param branch - Branch name
 * @param filePath - Path to file within repo
 * @returns Raw content URL for fetching file
 */
export function getGitHubRawUrl(repoUrl: string, branch: string, filePath: string): string {
  // Convert https://github.com/owner/repo to raw content URL
  const match = repoUrl.match(/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/)
  if (!match) {
    throw new Error(`Invalid GitHub URL: ${repoUrl}`)
  }
  const [, owner, repo] = match
  return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${filePath}`
}

/**
 * Parse timeout string to milliseconds
 *
 * @param timeout - Timeout string (e.g., "30s", "1m", "500ms")
 * @returns Timeout in milliseconds
 */
export function parseTimeoutString(timeout: string): number {
  const match = timeout.match(/^(\d+)(ms|s|m|h)?$/)
  if (!match) return NETWORK_DEFAULTS.timeoutMs

  const [, value, unit] = match
  const num = parseInt(value, 10)

  switch (unit) {
    case "ms":
      return num
    case "s":
      return num * 1000
    case "m":
      return num * 60 * 1000
    case "h":
      return num * 60 * 60 * 1000
    default:
      return num * 1000 // Default to seconds
  }
}

/**
 * Format milliseconds as human-readable duration
 *
 * @param ms - Duration in milliseconds
 * @returns Formatted duration string
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  return `${(ms / 60000).toFixed(1)}m`
}

/**
 * Extract repository name from GitHub URL
 * Converts to kebab-case (lowercase) for use as source name
 *
 * @param url - GitHub repository URL
 * @returns Repository name in kebab-case or undefined if invalid
 */
export function extractRepoName(url: string): string | undefined {
  const match = url.match(/github\.com\/[^/]+\/([^/]+?)(?:\.git)?$/)
  if (!match) return undefined
  // Convert to lowercase kebab-case for valid source name
  return match[1].toLowerCase()
}

/**
 * Validate that a URL is HTTPS GitHub URL
 *
 * @param url - URL to validate
 * @returns true if valid HTTPS GitHub URL
 */
export function isValidGitHubUrl(url: string): boolean {
  if (!url.startsWith("https://")) return false
  return /^https:\/\/github\.com\/[^/]+\/[^/]+/.test(url)
}
