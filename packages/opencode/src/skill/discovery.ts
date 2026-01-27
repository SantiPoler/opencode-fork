/**
 * Skill Discovery Engine
 * Scans multiple sources and generates skill index (PRD RF1, RF2)
 *
 * Priority order: LOCAL > USER > CACHED > EMBEDDED
 *
 * @module skill/discovery
 */

import path from "path"
import { Log } from "../util/log"
import { Filesystem } from "../util/filesystem"
import { ConfigMarkdown } from "../config/markdown"
import { validateSkillFrontmatter } from "./validator"
import {
  SKILL_DIRS,
  SKILL_FILE_NAME,
  SKILL_GLOB_PATTERN,
  SKILL_PERFORMANCE,
} from "./constants"
import type {
  SkillIndex,
  SkillIndexEntry,
  SkillSource,
  SkillDiscoveryOptions,
  SkillDiscoveryEvent,
} from "./types"

const log = Log.create({ service: "skill.discovery" })

/**
 * SkillDiscovery class
 * Scans configured directories for SKILL.md files and builds an index
 */
export class SkillDiscovery {
  private options: Required<SkillDiscoveryOptions>
  private events: SkillDiscoveryEvent[] = []

  constructor(options: SkillDiscoveryOptions = {}) {
    this.options = {
      projectDir: options.projectDir ?? process.cwd(),
      userDir: options.userDir ?? SKILL_DIRS.user,
      cacheDir: options.cacheDir ?? SKILL_DIRS.cached,
      includeEmbedded: options.includeEmbedded ?? true,
      validateTools: options.validateTools ?? true,
    }
  }

  /**
   * Discover all skills from configured sources
   * Priority: LOCAL > USER > CACHED > EMBEDDED (RF3)
   *
   * @returns SkillIndex with all discovered skills
   */
  async discover(): Promise<SkillIndex> {
    const startTime = performance.now()
    const skills: SkillIndexEntry[] = []
    const seen = new Set<string>()
    const sources = { local: 0, user: 0, cached: 0, embedded: 0 }

    this.events = [] // Reset events for this discovery run

    // 1. LOCAL - Project directory (highest priority)
    const localDir = path.join(this.options.projectDir, SKILL_DIRS.local)
    const localSkills = await this.scanDirectory(localDir, "local")
    for (const skill of localSkills) {
      if (!seen.has(skill.name)) {
        skills.push(skill)
        seen.add(skill.name)
        sources.local++
        this.recordEvent({
          type: "discovered",
          name: skill.name,
          source: "local",
          path: skill.path,
        })
      }
    }

    // 2. USER - User config directory
    const userSkills = await this.scanDirectory(this.options.userDir, "user")
    for (const skill of userSkills) {
      if (!seen.has(skill.name)) {
        skills.push(skill)
        seen.add(skill.name)
        sources.user++
        this.recordEvent({
          type: "discovered",
          name: skill.name,
          source: "user",
          path: skill.path,
        })
      } else {
        this.recordEvent({
          type: "override",
          name: skill.name,
          source: "user",
          path: skill.path,
          overriddenBy: this.findSourceForSkill(skills, skill.name),
        })
        log.debug("skill already discovered from higher priority source", {
          name: skill.name,
          skipped: "user",
        })
      }
    }

    // 3. CACHED - Cache directory
    const cachedSkills = await this.scanDirectory(this.options.cacheDir, "cached")
    for (const skill of cachedSkills) {
      if (!seen.has(skill.name)) {
        skills.push(skill)
        seen.add(skill.name)
        sources.cached++
        this.recordEvent({
          type: "discovered",
          name: skill.name,
          source: "cached",
          path: skill.path,
        })
      } else {
        this.recordEvent({
          type: "override",
          name: skill.name,
          source: "cached",
          path: skill.path,
          overriddenBy: this.findSourceForSkill(skills, skill.name),
        })
        log.debug("skill already discovered from higher priority source", {
          name: skill.name,
          skipped: "cached",
        })
      }
    }

    // 4. EMBEDDED - Built into binary (lowest priority)
    if (this.options.includeEmbedded) {
      const embeddedSkills = await this.loadEmbeddedSkills()
      for (const skill of embeddedSkills) {
        if (!seen.has(skill.name)) {
          skills.push(skill)
          seen.add(skill.name)
          sources.embedded++
          this.recordEvent({
            type: "discovered",
            name: skill.name,
            source: "embedded",
            path: skill.path,
          })
        } else {
          this.recordEvent({
            type: "override",
            name: skill.name,
            source: "embedded",
            path: skill.path,
            overriddenBy: this.findSourceForSkill(skills, skill.name),
          })
          log.debug("skill already discovered from higher priority source", {
            name: skill.name,
            skipped: "embedded",
          })
        }
      }
    }

    const duration = performance.now() - startTime

    // Performance warning (RNF1)
    if (duration > SKILL_PERFORMANCE.MAX_DISCOVERY_TIME_MS) {
      log.warn("skill discovery exceeded performance threshold", {
        duration: `${duration.toFixed(2)}ms`,
        threshold: `${SKILL_PERFORMANCE.MAX_DISCOVERY_TIME_MS}ms`,
        skillCount: skills.length,
      })
    }

    log.info("skill discovery complete", {
      total: skills.length,
      sources,
      duration: `${duration.toFixed(2)}ms`,
    })

    return {
      skills,
      generatedAt: new Date().toISOString(),
      sources,
    }
  }

  /**
   * Get discovery events for debugging
   */
  getEvents(): SkillDiscoveryEvent[] {
    return [...this.events]
  }

  /**
   * Scan a directory for SKILL.md files
   */
  private async scanDirectory(
    dir: string,
    source: SkillSource
  ): Promise<SkillIndexEntry[]> {
    const skills: SkillIndexEntry[] = []

    // Check if directory exists (RNF2: skip silently if not)
    if (!(await Filesystem.isDir(dir))) {
      log.debug("skill directory does not exist", { dir, source })
      return skills
    }

    const glob = new Bun.Glob(SKILL_GLOB_PATTERN)

    try {
      const matches = await Array.fromAsync(
        glob.scan({
          cwd: dir,
          absolute: true,
          onlyFiles: true,
          followSymlinks: true,
        })
      )

      for (const match of matches) {
        const entry = await this.parseSkillFile(match, source)
        if (entry) {
          skills.push(entry)
        }
      }
    } catch (error) {
      log.error("failed to scan skill directory", { dir, source, error })
      this.recordEvent({
        type: "error",
        source,
        path: dir,
        reason: error instanceof Error ? error.message : String(error),
      })
    }

    log.debug("scanned directory", { dir, source, found: skills.length })
    return skills
  }

  /**
   * Parse a single SKILL.md file
   */
  private async parseSkillFile(
    filePath: string,
    source: SkillSource
  ): Promise<SkillIndexEntry | null> {
    try {
      const md = await ConfigMarkdown.parse(filePath)
      if (!md || !md.data) {
        log.warn("failed to parse skill file - no frontmatter", { path: filePath })
        this.recordEvent({
          type: "skipped",
          source,
          path: filePath,
          reason: "No frontmatter found",
        })
        return null
      }

      const result = validateSkillFrontmatter(md.data, filePath, source)

      if (!result.valid) {
        log.error("invalid skill frontmatter", {
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
      log.error("failed to read skill file", { path: filePath, error })
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
   * Load embedded skills from the binary
   * Delegates to the embedded skills module
   */
  private async loadEmbeddedSkills(): Promise<SkillIndexEntry[]> {
    try {
      // Import dynamically to avoid circular dependencies
      const { loadEmbeddedSkillsAsEntries } = await import("./embedded")
      return loadEmbeddedSkillsAsEntries()
    } catch (error) {
      log.debug("failed to load embedded skills", { error })
      return []
    }
  }

  /**
   * Find which source a skill came from
   */
  private findSourceForSkill(
    skills: SkillIndexEntry[],
    name: string
  ): SkillSource | undefined {
    const skill = skills.find((s) => s.name === name)
    return skill?.source
  }

  /**
   * Record a discovery event
   */
  private recordEvent(event: SkillDiscoveryEvent): void {
    this.events.push(event)
  }
}

// ============================================================================
// Singleton management and caching
// ============================================================================

let discoveryInstance: SkillDiscovery | null = null
let cachedIndex: SkillIndex | null = null
let cacheTimestamp: number = 0

/**
 * Get or create the SkillDiscovery instance
 *
 * @param options - Optional configuration (resets instance if provided)
 * @returns SkillDiscovery instance
 */
export function getDiscovery(options?: SkillDiscoveryOptions): SkillDiscovery {
  if (!discoveryInstance || options) {
    discoveryInstance = new SkillDiscovery(options)
    cachedIndex = null // Invalidate cache when instance changes
  }
  return discoveryInstance
}

/**
 * Get the skill index (cached)
 *
 * @param refresh - Force refresh the cache
 * @returns SkillIndex with all discovered skills
 */
export async function getSkillIndex(refresh = false): Promise<SkillIndex> {
  if (!cachedIndex || refresh) {
    cachedIndex = await getDiscovery().discover()
    cacheTimestamp = Date.now()
  }
  return cachedIndex
}

/**
 * Invalidate the cached skill index
 * Call this when skills may have changed
 */
export function invalidateSkillIndex(): void {
  cachedIndex = null
  cacheTimestamp = 0
  log.debug("skill index cache invalidated")
}

/**
 * Get cache age in milliseconds
 */
export function getSkillIndexCacheAge(): number {
  if (!cacheTimestamp) return Infinity
  return Date.now() - cacheTimestamp
}

/**
 * Reset the discovery system (mainly for testing)
 */
export function resetDiscovery(): void {
  discoveryInstance = null
  cachedIndex = null
  cacheTimestamp = 0
}
