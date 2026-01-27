/**
 * Skill Context Builder
 * Generates markdown sections for skill index injection into LLM context (PRD RF4)
 *
 * @module skill/context
 */

import { Log } from "../util/log"
import { SKILL_CONTEXT } from "./constants"
import type { SkillIndex, SkillIndexEntry, LoadedSkill } from "./types"

const log = Log.create({ service: "skill.context" })

/**
 * Build markdown section for skill index (RF4)
 * This is injected into the LLM context to make skills discoverable
 *
 * @param index - SkillIndex with all discovered skills
 * @returns Markdown string with skill table, or empty string if no skills
 */
export function buildSkillIndexSection(index: SkillIndex): string {
  if (index.skills.length === 0) {
    log.debug("no skills to include in context")
    return ""
  }

  const rows = index.skills.map((skill) => {
    const invoke = skill.argumentHint
      ? `\`/${skill.name} ${skill.argumentHint}\``
      : `\`/${skill.name}\``
    return `| ${skill.name} | ${skill.description} | ${invoke} |`
  })

  const section = `${SKILL_CONTEXT.INDEX_HEADER}

${SKILL_CONTEXT.INDEX_INTRO}

| Skill | Description | Invocation |
|-------|-------------|------------|
${rows.join("\n")}

${SKILL_CONTEXT.INDEX_FOOTER}`

  log.debug("built skill index section", { skillCount: index.skills.length })

  return section
}

/**
 * Format loaded skill for context injection (RF7)
 * Includes warnings if present
 *
 * @param skill - LoadedSkill with full content
 * @returns Formatted markdown string for LLM context
 */
export function formatLoadedSkill(skill: LoadedSkill): string {
  const warnings =
    skill.entry.warnings.length > 0
      ? `\n\n⚠️ Warnings:\n${skill.entry.warnings.map((w) => `- ${w}`).join("\n")}`
      : ""

  return `<skill name="${skill.entry.name}" source="${skill.entry.source}">${warnings}

---

${skill.content}

</skill>`
}

/**
 * Build complete skill context for LLM
 * Combines skill index with optionally loaded skill
 *
 * @param index - SkillIndex with all discovered skills
 * @param loadedSkill - Optional loaded skill to include
 * @returns Combined markdown string
 */
export function buildSkillContext(
  index: SkillIndex,
  loadedSkill?: LoadedSkill
): string {
  let context = ""

  // Add skill index
  const indexSection = buildSkillIndexSection(index)
  if (indexSection) {
    context += indexSection
  }

  // Add loaded skill if present
  if (loadedSkill) {
    context += "\n\n" + formatLoadedSkill(loadedSkill)
  }

  return context
}

/**
 * Build minimal skill list for constrained contexts
 * Used when token budget is limited
 *
 * @param index - SkillIndex with all discovered skills
 * @returns Compact markdown string
 */
export function buildMinimalSkillList(index: SkillIndex): string {
  if (index.skills.length === 0) {
    return ""
  }

  const skillList = index.skills.map((s) => `/${s.name}`).join(", ")

  return `Skills: ${skillList}`
}

/**
 * Build skill section for a specific list of skills
 * Useful when only showing relevant skills
 *
 * @param skills - Array of SkillIndexEntry to include
 * @returns Markdown table string
 */
export function buildSkillTable(skills: SkillIndexEntry[]): string {
  if (skills.length === 0) {
    return ""
  }

  const rows = skills.map((skill) => {
    const invoke = skill.argumentHint
      ? `\`/${skill.name} ${skill.argumentHint}\``
      : `\`/${skill.name}\``
    return `| ${skill.name} | ${skill.description} | ${invoke} |`
  })

  return `| Skill | Description | Invocation |
|-------|-------------|------------|
${rows.join("\n")}`
}

/**
 * Filter skills by relevance to a query
 * Basic keyword matching for now
 *
 * @param skills - Array of skills to filter
 * @param query - Search query
 * @returns Filtered array of skills
 */
export function filterRelevantSkills(
  skills: SkillIndexEntry[],
  query: string
): SkillIndexEntry[] {
  const lowerQuery = query.toLowerCase()
  const keywords = lowerQuery.split(/\s+/).filter((k) => k.length > 2)

  if (keywords.length === 0) {
    return skills
  }

  return skills.filter((skill) => {
    const searchText =
      `${skill.name} ${skill.description} ${skill.tags.join(" ")}`.toLowerCase()
    return keywords.some((keyword) => searchText.includes(keyword))
  })
}

/**
 * Get skills that should be highlighted based on context
 * Returns skills most likely to be useful
 *
 * @param index - Full skill index
 * @param context - Current conversation context
 * @returns Array of highlighted skills
 */
export function getHighlightedSkills(
  index: SkillIndex,
  context?: string
): SkillIndexEntry[] {
  if (!context) {
    // Return all skills if no context
    return index.skills
  }

  // Filter by relevance
  const relevant = filterRelevantSkills(index.skills, context)

  // If we have relevant skills, return them
  if (relevant.length > 0) {
    return relevant
  }

  // Otherwise return all
  return index.skills
}
