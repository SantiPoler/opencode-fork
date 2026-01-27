/**
 * Workflow Configuration Loader
 * Load, validate, and save config.yaml files
 *
 * @module workflow/config/loader
 */

import fs from "fs/promises"
import path from "path"
import yaml from "yaml"
import { WorkflowConfigSchema, type WorkflowConfigParsed, type SourceConfigParsed } from "./schema"
import { WORKFLOW_PATHS, OFFICIAL_SOURCE, DEFAULT_SETTINGS, CONFIG_VERSION } from "./defaults"
import { ConfigError, SyncErrorCode } from "../sync/errors"

/**
 * Get the default configuration for new installations
 */
export function getDefaultConfig(): WorkflowConfigParsed {
  return {
    version: CONFIG_VERSION,
    sources: [OFFICIAL_SOURCE],
    settings: DEFAULT_SETTINGS,
  }
}

/**
 * Ensure the config directory exists
 */
async function ensureConfigDir(): Promise<void> {
  const dir = path.dirname(WORKFLOW_PATHS.config)
  await fs.mkdir(dir, { recursive: true })
}

/**
 * Load and validate configuration from disk
 * Creates default config if file doesn't exist
 *
 * @returns Validated configuration object
 * @throws ConfigError if file exists but is invalid
 */
export async function loadConfig(): Promise<WorkflowConfigParsed> {
  const file = Bun.file(WORKFLOW_PATHS.config)

  if (!(await file.exists())) {
    // Create default config
    const defaultConfig = getDefaultConfig()
    await saveConfig(defaultConfig)
    return defaultConfig
  }

  let content: string
  try {
    content = await file.text()
  } catch (error) {
    throw new ConfigError(
      `Failed to read config.yaml: ${error instanceof Error ? error.message : String(error)}`,
      SyncErrorCode.CONFIG_INVALID,
    )
  }

  let parsed: unknown
  try {
    parsed = yaml.parse(content)
  } catch (error) {
    throw new ConfigError(
      `Failed to parse config.yaml: ${error instanceof Error ? error.message : String(error)}`,
      SyncErrorCode.CONFIG_INVALID,
    )
  }

  // Validate with Zod
  const result = WorkflowConfigSchema.safeParse(parsed)
  if (!result.success) {
    // Zod 4 uses .issues instead of .errors
    const issues = result.error.issues ?? []
    const errorMsg = issues.map((e) => `${e.path?.join(".") || ""}: ${e.message}`).join("; ")
    throw new ConfigError(`Invalid config.yaml: ${errorMsg}`, SyncErrorCode.CONFIG_INVALID)
  }

  return result.data
}

/**
 * Save configuration to disk (atomic write)
 *
 * @param config - Configuration to save
 */
export async function saveConfig(config: WorkflowConfigParsed): Promise<void> {
  await ensureConfigDir()

  const header = `# ~/.aifwk/config.yaml
# Workflow skill synchronization configuration
# Documentation: https://github.com/aifwk/dipolecode/docs/workflow

`

  const content =
    header +
    yaml.stringify(config, {
      lineWidth: 0, // No line wrapping
      defaultKeyType: "PLAIN",
    })

  // Atomic write: write to temp file, then rename
  const tempPath = `${WORKFLOW_PATHS.config}.tmp`

  try {
    await Bun.write(tempPath, content)
    await fs.rename(tempPath, WORKFLOW_PATHS.config)
  } catch (error) {
    // Clean up temp file if it exists
    try {
      await fs.unlink(tempPath)
    } catch {
      // Ignore cleanup errors
    }
    throw new ConfigError(
      `Failed to save config.yaml: ${error instanceof Error ? error.message : String(error)}`,
      SyncErrorCode.WRITE_FAILED,
    )
  }
}

/**
 * Add a new source to configuration
 *
 * @param source - Source configuration to add
 * @throws ConfigError if source name already exists
 */
export async function addSource(source: SourceConfigParsed): Promise<void> {
  const config = await loadConfig()

  // Check for duplicate name
  if (config.sources.some((s) => s.name === source.name)) {
    throw new ConfigError(`Source '${source.name}' already exists`, SyncErrorCode.SOURCE_EXISTS, source.name)
  }

  config.sources.push(source)
  await saveConfig(config)
}

/**
 * Remove a source from configuration
 *
 * @param name - Source name to remove
 * @throws ConfigError if source not found
 */
export async function removeSource(name: string): Promise<void> {
  const config = await loadConfig()

  const index = config.sources.findIndex((s) => s.name === name)
  if (index === -1) {
    throw new ConfigError(`Source '${name}' not found`, SyncErrorCode.SOURCE_NOT_FOUND, name)
  }

  config.sources.splice(index, 1)
  await saveConfig(config)
}

/**
 * Update a source in configuration
 *
 * @param name - Source name to update
 * @param updates - Partial source config with updates
 * @throws ConfigError if source not found
 */
export async function updateSource(name: string, updates: Partial<SourceConfigParsed>): Promise<void> {
  const config = await loadConfig()

  const source = config.sources.find((s) => s.name === name)
  if (!source) {
    throw new ConfigError(`Source '${name}' not found`, SyncErrorCode.SOURCE_NOT_FOUND, name)
  }

  Object.assign(source, updates)
  await saveConfig(config)
}

/**
 * Get a specific source by name
 *
 * @param name - Source name
 * @returns Source config or undefined if not found
 */
export async function getSource(name: string): Promise<SourceConfigParsed | undefined> {
  const config = await loadConfig()
  return config.sources.find((s) => s.name === name)
}

/**
 * Get enabled sources sorted by priority (descending)
 * Higher priority sources are checked first for skill resolution
 *
 * @param config - Configuration object
 * @returns Array of enabled sources sorted by priority
 */
export function getEnabledSources(config: WorkflowConfigParsed): SourceConfigParsed[] {
  return config.sources.filter((s) => s.enabled).sort((a, b) => b.priority - a.priority)
}

/**
 * Check if any sources are configured
 *
 * @param config - Configuration object
 * @returns true if at least one source is configured
 */
export function hasSources(config: WorkflowConfigParsed): boolean {
  return config.sources.length > 0
}

/**
 * Check if any sources are enabled
 *
 * @param config - Configuration object
 * @returns true if at least one enabled source exists
 */
export function hasEnabledSources(config: WorkflowConfigParsed): boolean {
  return config.sources.some((s) => s.enabled)
}

/**
 * Update workflow settings
 *
 * @param updates - Partial settings to update
 */
export async function updateSettings(updates: Partial<WorkflowConfigParsed["settings"]>): Promise<void> {
  const config = await loadConfig()
  Object.assign(config.settings, updates)
  await saveConfig(config)
}

/**
 * Reset configuration to defaults
 * This will remove all custom sources and settings
 */
export async function resetConfig(): Promise<void> {
  await saveConfig(getDefaultConfig())
}

/**
 * Check if config file exists
 */
export async function configExists(): Promise<boolean> {
  const file = Bun.file(WORKFLOW_PATHS.config)
  return file.exists()
}
