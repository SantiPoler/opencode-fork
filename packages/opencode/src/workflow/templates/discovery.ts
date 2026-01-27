/**
 * Template Discovery Engine
 * Scans multiple sources and generates template index
 *
 * Priority order: LOCAL > USER > CACHED > EMBEDDED
 *
 * @module workflow/templates/discovery
 */

import path from "path"
import { Log } from "../../util/log"
import { Filesystem } from "../../util/filesystem"
import { ConfigMarkdown } from "../../config/markdown"
import {
  TEMPLATE_DIRS,
  TEMPLATE_GLOB_PATTERN,
  TEMPLATE_PERFORMANCE,
  EMBEDDED_TEMPLATES,
  EMBEDDED_TEMPLATE_CONTENT,
} from "./constants"
import type {
  TemplateIndex,
  TemplateIndexEntry,
  TemplateSource,
  TemplateDiscoveryOptions,
  TemplateDiscoveryEvent,
  TemplateValidationResult,
  TemplateFrontmatter,
} from "./types"

const log = Log.create({ service: "workflow.template.discovery" })

/**
 * Validate template frontmatter
 *
 * @param data - Parsed frontmatter data
 * @param filePath - Source file path
 * @param source - Template source
 * @returns Validation result
 */
export function validateTemplateFrontmatter(
  data: unknown,
  filePath: string,
  source: TemplateSource,
): TemplateValidationResult {
  const errors: string[] = []

  if (!data || typeof data !== "object") {
    return { valid: false, errors: ["Frontmatter must be an object"] }
  }

  const fm = data as Record<string, unknown>

  // Required: name
  if (!fm.name || typeof fm.name !== "string") {
    errors.push("Missing or invalid 'name' field")
  }

  // Required: description
  if (!fm.description || typeof fm.description !== "string") {
    errors.push("Missing or invalid 'description' field")
  }

  if (errors.length > 0) {
    return { valid: false, errors }
  }

  const entry: TemplateIndexEntry = {
    name: fm.name as string,
    description: fm.description as string,
    source,
    path: filePath,
    version: typeof fm.version === "string" ? fm.version : undefined,
    type: typeof fm.type === "string" ? fm.type : undefined,
    variables: Array.isArray(fm.variables) ? (fm.variables as string[]) : undefined,
  }

  return { valid: true, errors: [], entry }
}

/**
 * TemplateDiscovery class
 * Scans configured directories for template files and builds an index
 */
export class TemplateDiscovery {
  private options: Required<TemplateDiscoveryOptions>
  private events: TemplateDiscoveryEvent[] = []

  constructor(options: TemplateDiscoveryOptions = {}) {
    this.options = {
      projectDir: options.projectDir ?? process.cwd(),
      userDir: options.userDir ?? TEMPLATE_DIRS.user,
      cacheDir: options.cacheDir ?? TEMPLATE_DIRS.cached,
      includeEmbedded: options.includeEmbedded ?? true,
    }
  }

  /**
   * Discover all templates from configured sources
   * Priority: LOCAL > USER > CACHED > EMBEDDED
   *
   * @returns TemplateIndex with all discovered templates
   */
  async discover(): Promise<TemplateIndex> {
    const startTime = performance.now()
    const templates: TemplateIndexEntry[] = []
    const seen = new Set<string>()
    const sources: Record<TemplateSource, number> = { local: 0, user: 0, cached: 0, embedded: 0 }

    this.events = []

    // 1. LOCAL - Project directory (highest priority)
    const localDir = path.join(this.options.projectDir, TEMPLATE_DIRS.local)
    const localTemplates = await this.scanDirectory(localDir, "local")
    for (const template of localTemplates) {
      if (!seen.has(template.name)) {
        templates.push(template)
        seen.add(template.name)
        sources.local++
        this.recordEvent({
          type: "discovered",
          name: template.name,
          source: "local",
          path: template.path,
        })
      }
    }

    // 2. USER - User config directory
    const userTemplates = await this.scanDirectory(this.options.userDir, "user")
    for (const template of userTemplates) {
      if (!seen.has(template.name)) {
        templates.push(template)
        seen.add(template.name)
        sources.user++
        this.recordEvent({
          type: "discovered",
          name: template.name,
          source: "user",
          path: template.path,
        })
      } else {
        this.recordEvent({
          type: "override",
          name: template.name,
          source: "user",
          path: template.path,
          overriddenBy: this.findSourceForTemplate(templates, template.name),
        })
      }
    }

    // 3. CACHED - Cache directory
    const cachedTemplates = await this.scanDirectory(this.options.cacheDir, "cached")
    for (const template of cachedTemplates) {
      if (!seen.has(template.name)) {
        templates.push(template)
        seen.add(template.name)
        sources.cached++
        this.recordEvent({
          type: "discovered",
          name: template.name,
          source: "cached",
          path: template.path,
        })
      } else {
        this.recordEvent({
          type: "override",
          name: template.name,
          source: "cached",
          path: template.path,
          overriddenBy: this.findSourceForTemplate(templates, template.name),
        })
      }
    }

    // 4. EMBEDDED - Built into binary (lowest priority)
    if (this.options.includeEmbedded) {
      const embeddedTemplates = this.loadEmbeddedTemplates()
      for (const template of embeddedTemplates) {
        if (!seen.has(template.name)) {
          templates.push(template)
          seen.add(template.name)
          sources.embedded++
          this.recordEvent({
            type: "discovered",
            name: template.name,
            source: "embedded",
            path: template.path,
          })
        } else {
          this.recordEvent({
            type: "override",
            name: template.name,
            source: "embedded",
            path: template.path,
            overriddenBy: this.findSourceForTemplate(templates, template.name),
          })
        }
      }
    }

    const duration = performance.now() - startTime

    if (duration > TEMPLATE_PERFORMANCE.MAX_DISCOVERY_TIME_MS) {
      log.warn("template discovery exceeded performance threshold", {
        duration: `${duration.toFixed(2)}ms`,
        threshold: `${TEMPLATE_PERFORMANCE.MAX_DISCOVERY_TIME_MS}ms`,
      })
    }

    log.info("template discovery complete", {
      total: templates.length,
      sources,
      duration: `${duration.toFixed(2)}ms`,
    })

    return {
      templates,
      generatedAt: new Date().toISOString(),
      sources,
    }
  }

  /**
   * Get discovery events
   */
  getEvents(): TemplateDiscoveryEvent[] {
    return [...this.events]
  }

  /**
   * Scan a directory for template files
   */
  private async scanDirectory(dir: string, source: TemplateSource): Promise<TemplateIndexEntry[]> {
    const templates: TemplateIndexEntry[] = []

    if (!(await Filesystem.isDir(dir))) {
      log.debug("template directory does not exist", { dir, source })
      return templates
    }

    const glob = new Bun.Glob(TEMPLATE_GLOB_PATTERN)

    try {
      const matches = await Array.fromAsync(
        glob.scan({
          cwd: dir,
          absolute: true,
          onlyFiles: true,
          followSymlinks: true,
        }),
      )

      for (const match of matches) {
        const entry = await this.parseTemplateFile(match, source)
        if (entry) {
          templates.push(entry)
        }
      }
    } catch (error) {
      log.error("failed to scan template directory", { dir, source, error })
      this.recordEvent({
        type: "error",
        source,
        path: dir,
        reason: error instanceof Error ? error.message : String(error),
      })
    }

    return templates
  }

  /**
   * Parse a single template file
   */
  private async parseTemplateFile(filePath: string, source: TemplateSource): Promise<TemplateIndexEntry | null> {
    try {
      const md = await ConfigMarkdown.parse(filePath)
      if (!md || !md.data) {
        log.warn("failed to parse template file - no frontmatter", { path: filePath })
        this.recordEvent({
          type: "skipped",
          source,
          path: filePath,
          reason: "No frontmatter found",
        })
        return null
      }

      const result = validateTemplateFrontmatter(md.data, filePath, source)

      if (!result.valid) {
        log.error("invalid template frontmatter", {
          path: filePath,
          errors: result.errors,
        })
        this.recordEvent({
          type: "error",
          source,
          path: filePath,
          reason: result.errors.join("; "),
        })
        return null
      }

      return result.entry!
    } catch (error) {
      log.error("failed to read template file", { path: filePath, error })
      this.recordEvent({
        type: "error",
        source,
        path: filePath,
        reason: error instanceof Error ? error.message : String(error),
      })
      return null
    }
  }

  /**
   * Load embedded templates
   */
  private loadEmbeddedTemplates(): TemplateIndexEntry[] {
    return Object.entries(EMBEDDED_TEMPLATES).map(([name, meta]) => ({
      name,
      description: meta.description,
      source: "embedded" as TemplateSource,
      path: `embedded://${name}`,
      version: "1.0.0",
      type: meta.type,
      variables: [...meta.variables] as string[],
    }))
  }

  /**
   * Find which source a template came from
   */
  private findSourceForTemplate(templates: TemplateIndexEntry[], name: string): TemplateSource | undefined {
    const template = templates.find((t) => t.name === name)
    return template?.source
  }

  /**
   * Record a discovery event
   */
  private recordEvent(event: TemplateDiscoveryEvent): void {
    this.events.push(event)
  }
}

// ============================================================================
// Singleton management and caching
// ============================================================================

let discoveryInstance: TemplateDiscovery | null = null
let cachedIndex: TemplateIndex | null = null
let cacheTimestamp: number = 0

/**
 * Get or create the TemplateDiscovery instance
 */
export function getTemplateDiscovery(options?: TemplateDiscoveryOptions): TemplateDiscovery {
  if (!discoveryInstance || options) {
    discoveryInstance = new TemplateDiscovery(options)
    cachedIndex = null
  }
  return discoveryInstance
}

/**
 * Get the template index (cached)
 */
export async function getTemplateIndex(refresh = false): Promise<TemplateIndex> {
  if (!cachedIndex || refresh) {
    cachedIndex = await getTemplateDiscovery().discover()
    cacheTimestamp = Date.now()
  }
  return cachedIndex
}

/**
 * Invalidate the cached template index
 */
export function invalidateTemplateIndex(): void {
  cachedIndex = null
  cacheTimestamp = 0
  log.debug("template index cache invalidated")
}

/**
 * Reset the discovery system (for testing)
 */
export function resetTemplateDiscovery(): void {
  discoveryInstance = null
  cachedIndex = null
  cacheTimestamp = 0
}
