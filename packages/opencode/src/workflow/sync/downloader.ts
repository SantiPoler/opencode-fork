/**
 * Skill Downloader
 * Download SKILL.md files from remote repositories with validation
 *
 * @module workflow/sync/downloader
 */

import path from "path"
import fs from "fs/promises"
import { getGitHubRawUrl, NETWORK_DEFAULTS, WORKFLOW_PATHS, parseTimeoutString } from "../config/defaults"
import { fetchWithRetry, getSourceHeaders } from "./fetcher"
import { computeContentHash, verifyHash } from "./hash"
import { SyncError, SyncErrorCode, errorFromResponse, networkErrorFromException } from "./errors"
import type { SourceConfigParsed, RemoteSkillEntryParsed, RemoteTemplateEntryParsed, WorkflowSettingsParsed } from "../config/schema"

/**
 * Result of downloading a single skill
 */
export interface DownloadResult {
  /** Whether download succeeded */
  success: boolean
  /** Skill name */
  name: string
  /** Skill version */
  version: string
  /** Path where skill was saved (if success) */
  path?: string
  /** Computed hash of downloaded content */
  hash?: string
  /** Error message (if failed) */
  error?: string
}

/**
 * Progress callback for batch downloads
 */
export type DownloadProgressCallback = (completed: number, total: number, current: string) => void

/**
 * Download a single skill SKILL.md from a source
 *
 * @param source - Source configuration
 * @param skill - Remote skill entry from index
 * @param settings - Workflow settings
 * @returns Download result with success status and path/error
 */
export async function downloadSkill(
  source: SourceConfigParsed,
  skill: RemoteSkillEntryParsed,
  settings: WorkflowSettingsParsed,
): Promise<DownloadResult> {
  const skillUrl = getGitHubRawUrl(source.url, source.branch, `${skill.path}/SKILL.md`)
  const timeout = parseTimeoutString(settings.timeout)
  const headers = getSourceHeaders(source)

  try {
    // Download with retry
    const content = await fetchWithRetry(async () => {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), timeout)

      const response = await fetch(skillUrl, {
        headers: {
          ...headers,
          Accept: "text/plain, text/markdown",
        },
        signal: controller.signal,
      })

      clearTimeout(timeoutId)

      if (!response.ok) {
        throw errorFromResponse(response, source.name, skill.name)
      }

      return response.text()
    })

    // Compute hash of downloaded content
    const computedHash = await computeContentHash(content)

    // Verify hash if provided in index
    if (skill.hash && !settings.skipValidation) {
      if (!verifyHash(computedHash, skill.hash)) {
        throw new SyncError(
          "Hash mismatch - content may have been tampered with",
          SyncErrorCode.HASH_MISMATCH,
          source.name,
          skill.name,
        )
      }
    }

    // Write to cache directory (atomic write)
    const skillDir = path.join(WORKFLOW_PATHS.cache, skill.name)
    const skillPath = path.join(skillDir, "SKILL.md")

    await fs.mkdir(skillDir, { recursive: true })

    // Atomic write: temp file → rename
    const tempPath = `${skillPath}.tmp`
    await Bun.write(tempPath, content)
    await fs.rename(tempPath, skillPath)

    return {
      success: true,
      name: skill.name,
      version: skill.version,
      path: skillPath,
      hash: computedHash,
    }
  } catch (error) {
    // Handle known sync errors
    if (error instanceof SyncError) {
      return {
        success: false,
        name: skill.name,
        version: skill.version,
        error: error.getUserMessage(),
      }
    }

    // Handle other errors
    const errorMessage = error instanceof Error ? error.message : String(error)
    return {
      success: false,
      name: skill.name,
      version: skill.version,
      error: errorMessage,
    }
  }
}

/**
 * Download multiple skills in parallel batches
 *
 * @param source - Source configuration
 * @param skills - Array of remote skill entries to download
 * @param settings - Workflow settings
 * @param onProgress - Optional progress callback
 * @returns Array of download results
 */
export async function downloadSkills(
  source: SourceConfigParsed,
  skills: RemoteSkillEntryParsed[],
  settings: WorkflowSettingsParsed,
  onProgress?: DownloadProgressCallback,
): Promise<DownloadResult[]> {
  const results: DownloadResult[] = []
  const concurrent = NETWORK_DEFAULTS.maxConcurrent

  // Process in batches
  for (let i = 0; i < skills.length; i += concurrent) {
    const batch = skills.slice(i, i + concurrent)

    const batchResults = await Promise.all(
      batch.map((skill) => downloadSkill(source, skill, settings)),
    )

    results.push(...batchResults)

    // Report progress
    if (onProgress) {
      const lastSkill = batch[batch.length - 1]
      onProgress(results.length, skills.length, lastSkill?.name || "")
    }
  }

  return results
}

/**
 * Download a single skill by name from any configured source
 * Checks sources in priority order
 *
 * @param skillName - Name of skill to download
 * @param sources - Array of source configurations (should be sorted by priority)
 * @param indices - Map of source name to remote index
 * @param settings - Workflow settings
 * @returns Download result or null if skill not found in any source
 */
export async function downloadSkillByName(
  skillName: string,
  sources: SourceConfigParsed[],
  indices: Map<string, { skills: RemoteSkillEntryParsed[] }>,
  settings: WorkflowSettingsParsed,
): Promise<DownloadResult | null> {
  for (const source of sources) {
    const index = indices.get(source.name)
    if (!index) continue

    const skill = index.skills.find((s) => s.name === skillName)
    if (skill) {
      return downloadSkill(source, skill, settings)
    }
  }

  return null
}

/**
 * Get download statistics from results
 */
export function getDownloadStats(results: DownloadResult[]): {
  successful: number
  failed: number
  total: number
  errors: string[]
} {
  const successful = results.filter((r) => r.success).length
  const failed = results.filter((r) => !r.success).length
  const errors = results.filter((r) => !r.success && r.error).map((r) => `${r.name}: ${r.error}`)

  return {
    successful,
    failed,
    total: results.length,
    errors,
  }
}

/**
 * Extract successful downloads from results
 */
export function getSuccessfulDownloads(results: DownloadResult[]): DownloadResult[] {
  return results.filter((r) => r.success)
}

/**
 * Extract failed downloads from results
 */
export function getFailedDownloads(results: DownloadResult[]): DownloadResult[] {
  return results.filter((r) => !r.success)
}

/**
 * Ensure cache directory exists
 */
export async function ensureCacheDirectory(): Promise<void> {
  await fs.mkdir(WORKFLOW_PATHS.cache, { recursive: true })
}

/**
 * Clean up partial download (temp file)
 */
export async function cleanupPartialDownload(skillName: string): Promise<void> {
  const skillDir = path.join(WORKFLOW_PATHS.cache, skillName)
  const tempPath = path.join(skillDir, "SKILL.md.tmp")

  try {
    await fs.unlink(tempPath)
  } catch {
    // Ignore if file doesn't exist
  }
}

/**
 * Delete a cached skill
 */
export async function deleteCachedSkill(skillName: string): Promise<void> {
  const skillDir = path.join(WORKFLOW_PATHS.cache, skillName)

  try {
    await fs.rm(skillDir, { recursive: true, force: true })
  } catch {
    // Ignore errors
  }
}

// ============================================================================
// Template Download Functions
// ============================================================================

/**
 * Result of downloading a single template
 */
export interface TemplateDownloadResult {
  /** Whether download succeeded */
  success: boolean
  /** Template name */
  name: string
  /** Template version */
  version: string
  /** Path where template was saved (if success) */
  path?: string
  /** Computed hash of downloaded content */
  hash?: string
  /** Error message (if failed) */
  error?: string
}

/**
 * Progress callback for batch template downloads
 */
export type TemplateDownloadProgressCallback = (completed: number, total: number, current: string) => void

/**
 * Download a single template file from a source
 *
 * @param source - Source configuration
 * @param template - Remote template entry from index
 * @param settings - Workflow settings
 * @returns Download result with success status and path/error
 */
export async function downloadTemplate(
  source: SourceConfigParsed,
  template: RemoteTemplateEntryParsed,
  settings: WorkflowSettingsParsed,
): Promise<TemplateDownloadResult> {
  // Template path in repo: templates/name.md or the path specified in index
  const templateFile = template.path.endsWith(".md") ? template.path : `${template.path}.md`
  const templateUrl = getGitHubRawUrl(source.url, source.branch, templateFile)
  const timeout = parseTimeoutString(settings.timeout)
  const headers = getSourceHeaders(source)

  try {
    // Download with retry
    const content = await fetchWithRetry(async () => {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), timeout)

      const response = await fetch(templateUrl, {
        headers: {
          ...headers,
          Accept: "text/plain, text/markdown",
        },
        signal: controller.signal,
      })

      clearTimeout(timeoutId)

      if (!response.ok) {
        throw errorFromResponse(response, source.name, template.name)
      }

      return response.text()
    })

    // Compute hash of downloaded content
    const computedHash = await computeContentHash(content)

    // Verify hash if provided in index
    if (template.hash && !settings.skipValidation) {
      if (!verifyHash(computedHash, template.hash)) {
        throw new SyncError(
          "Hash mismatch - template content may have been tampered with",
          SyncErrorCode.HASH_MISMATCH,
          source.name,
          template.name,
        )
      }
    }

    // Write to template cache directory (atomic write)
    const templateDir = path.join(WORKFLOW_PATHS.templateCache, template.name)
    const templatePath = path.join(templateDir, `${template.name}.md`)

    await fs.mkdir(templateDir, { recursive: true })

    // Atomic write: temp file → rename
    const tempPath = `${templatePath}.tmp`
    await Bun.write(tempPath, content)
    await fs.rename(tempPath, templatePath)

    return {
      success: true,
      name: template.name,
      version: template.version,
      path: templatePath,
      hash: computedHash,
    }
  } catch (error) {
    // Handle known sync errors
    if (error instanceof SyncError) {
      return {
        success: false,
        name: template.name,
        version: template.version,
        error: error.getUserMessage(),
      }
    }

    // Handle other errors
    const errorMessage = error instanceof Error ? error.message : String(error)
    return {
      success: false,
      name: template.name,
      version: template.version,
      error: errorMessage,
    }
  }
}

/**
 * Download multiple templates in parallel batches
 *
 * @param source - Source configuration
 * @param templates - Array of remote template entries to download
 * @param settings - Workflow settings
 * @param onProgress - Optional progress callback
 * @returns Array of download results
 */
export async function downloadTemplates(
  source: SourceConfigParsed,
  templates: RemoteTemplateEntryParsed[],
  settings: WorkflowSettingsParsed,
  onProgress?: TemplateDownloadProgressCallback,
): Promise<TemplateDownloadResult[]> {
  const results: TemplateDownloadResult[] = []
  const concurrent = NETWORK_DEFAULTS.maxConcurrent

  // Process in batches
  for (let i = 0; i < templates.length; i += concurrent) {
    const batch = templates.slice(i, i + concurrent)

    const batchResults = await Promise.all(
      batch.map((template) => downloadTemplate(source, template, settings)),
    )

    results.push(...batchResults)

    // Report progress
    if (onProgress) {
      const lastTemplate = batch[batch.length - 1]
      onProgress(results.length, templates.length, lastTemplate?.name || "")
    }
  }

  return results
}

/**
 * Get template download statistics from results
 */
export function getTemplateDownloadStats(results: TemplateDownloadResult[]): {
  successful: number
  failed: number
  total: number
  errors: string[]
} {
  const successful = results.filter((r) => r.success).length
  const failed = results.filter((r) => !r.success).length
  const errors = results.filter((r) => !r.success && r.error).map((r) => `${r.name}: ${r.error}`)

  return {
    successful,
    failed,
    total: results.length,
    errors,
  }
}

/**
 * Extract successful template downloads from results
 */
export function getSuccessfulTemplateDownloads(results: TemplateDownloadResult[]): TemplateDownloadResult[] {
  return results.filter((r) => r.success)
}

/**
 * Extract failed template downloads from results
 */
export function getFailedTemplateDownloads(results: TemplateDownloadResult[]): TemplateDownloadResult[] {
  return results.filter((r) => !r.success)
}

/**
 * Ensure template cache directory exists
 */
export async function ensureTemplateCacheDirectory(): Promise<void> {
  await fs.mkdir(WORKFLOW_PATHS.templateCache, { recursive: true })
}

/**
 * Delete a cached template
 */
export async function deleteCachedTemplate(templateName: string): Promise<void> {
  const templateDir = path.join(WORKFLOW_PATHS.templateCache, templateName)

  try {
    await fs.rm(templateDir, { recursive: true, force: true })
  } catch {
    // Ignore errors
  }
}
