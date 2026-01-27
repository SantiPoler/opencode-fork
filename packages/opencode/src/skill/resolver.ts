/**
 * Skill Resolver
 * Provides lookup and loading capabilities for discovered skills (PRD RF3, RF7)
 *
 * @module skill/resolver
 */

import { Log } from "../util/log"
import { ConfigMarkdown } from "../config/markdown"
import { getSkillIndex } from "./discovery"
import { SKILL_PERFORMANCE } from "./constants"
import type {
  SkillIndexEntry,
  SkillIndex,
  LoadedSkill,
  SkillFrontmatter,
  SkillSource,
} from "./types"

const log = Log.create({ service: "skill.resolver" })

/**
 * SkillResolver class
 * Provides methods to find and load skills from the index
 */
export class SkillResolver {
  /**
   * Find a skill by name
   * Returns the highest priority version (first match wins)
   *
   * @param name - Skill name to find
   * @returns SkillIndexEntry or null if not found
   */
  async resolve(name: string): Promise<SkillIndexEntry | null> {
    const index = await getSkillIndex()
    const entry = index.skills.find((s) => s.name === name)

    if (!entry) {
      log.debug("skill not found", { name })
      return null
    }

    log.debug("resolved skill", {
      name,
      source: entry.source,
      path: entry.path,
    })

    return entry
  }

  /**
   * Load full skill content by name (RF7)
   *
   * @param name - Skill name to load
   * @returns LoadedSkill with full content or null if not found
   */
  async load(name: string): Promise<LoadedSkill | null> {
    const startTime = performance.now()

    const entry = await this.resolve(name)
    if (!entry) {
      return null
    }

    try {
      const content = await Bun.file(entry.path).text()
      const md = ConfigMarkdown.parseContent(content)

      if (!md) {
        log.error("failed to parse loaded skill", { name, path: entry.path })
        return null
      }

      const duration = performance.now() - startTime

      // Performance warning (RNF1)
      if (duration > SKILL_PERFORMANCE.MAX_SKILL_LOAD_MS) {
        log.warn("skill load exceeded performance threshold", {
          name,
          duration: `${duration.toFixed(2)}ms`,
          threshold: `${SKILL_PERFORMANCE.MAX_SKILL_LOAD_MS}ms`,
        })
      }

      log.debug("loaded skill content", {
        name,
        source: entry.source,
        contentLength: content.length,
        duration: `${duration.toFixed(2)}ms`,
      })

      return {
        entry,
        content,
        frontmatter: md.data as SkillFrontmatter,
      }
    } catch (error) {
      log.error("failed to load skill content", { name, path: entry.path, error })
      return null
    }
  }

  /**
   * Check if a skill exists
   *
   * @param name - Skill name to check
   * @returns true if skill exists in index
   */
  async exists(name: string): Promise<boolean> {
    const entry = await this.resolve(name)
    return entry !== null
  }

  /**
   * Get all skills matching a tag
   *
   * @param tag - Tag to filter by
   * @returns Array of matching SkillIndexEntry
   */
  async findByTag(tag: string): Promise<SkillIndexEntry[]> {
    const index = await getSkillIndex()
    const matches = index.skills.filter((s) => s.tags.includes(tag))

    log.debug("found skills by tag", { tag, count: matches.length })
    return matches
  }

  /**
   * Get all skills from a specific source
   *
   * @param source - Source to filter by
   * @returns Array of matching SkillIndexEntry
   */
  async findBySource(source: SkillSource): Promise<SkillIndexEntry[]> {
    const index = await getSkillIndex()
    const matches = index.skills.filter((s) => s.source === source)

    log.debug("found skills by source", { source, count: matches.length })
    return matches
  }

  /**
   * Search skills by name or description
   *
   * @param query - Search query (case-insensitive)
   * @returns Array of matching SkillIndexEntry
   */
  async search(query: string): Promise<SkillIndexEntry[]> {
    const index = await getSkillIndex()
    const lowerQuery = query.toLowerCase()

    const matches = index.skills.filter(
      (s) =>
        s.name.toLowerCase().includes(lowerQuery) ||
        s.description.toLowerCase().includes(lowerQuery)
    )

    log.debug("searched skills", { query, count: matches.length })
    return matches
  }

  /**
   * Get all skills
   *
   * @returns Array of all SkillIndexEntry
   */
  async all(): Promise<SkillIndexEntry[]> {
    const index = await getSkillIndex()
    return index.skills
  }

  /**
   * Get skill index statistics
   *
   * @returns Index statistics
   */
  async stats(): Promise<{
    total: number
    bySource: Record<SkillSource, number>
    withWarnings: number
    generatedAt: string
  }> {
    const index = await getSkillIndex()

    return {
      total: index.skills.length,
      bySource: index.sources,
      withWarnings: index.skills.filter((s) => s.warnings.length > 0).length,
      generatedAt: index.generatedAt,
    }
  }
}

// ============================================================================
// Singleton instance
// ============================================================================

let resolverInstance: SkillResolver | null = null

/**
 * Get the singleton SkillResolver instance
 *
 * @returns SkillResolver instance
 */
export function getResolver(): SkillResolver {
  if (!resolverInstance) {
    resolverInstance = new SkillResolver()
  }
  return resolverInstance
}

/**
 * Reset the resolver (mainly for testing)
 */
export function resetResolver(): void {
  resolverInstance = null
}

// ============================================================================
// Convenience functions
// ============================================================================

/**
 * Resolve a skill by name (convenience function)
 */
export async function resolveSkill(name: string): Promise<SkillIndexEntry | null> {
  return getResolver().resolve(name)
}

/**
 * Load a skill by name (convenience function)
 */
export async function loadSkill(name: string): Promise<LoadedSkill | null> {
  return getResolver().load(name)
}

/**
 * Check if a skill exists (convenience function)
 */
export async function skillExists(name: string): Promise<boolean> {
  return getResolver().exists(name)
}

/**
 * Get all skills (convenience function)
 */
export async function getAllSkills(): Promise<SkillIndexEntry[]> {
  return getResolver().all()
}

/**
 * Search skills (convenience function)
 */
export async function searchSkills(query: string): Promise<SkillIndexEntry[]> {
  return getResolver().search(query)
}
