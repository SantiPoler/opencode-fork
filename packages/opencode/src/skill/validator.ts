/**
 * Skill Validator
 * Validates SKILL.md frontmatter using Zod schema (PRD RF5)
 * Checks tool compatibility (PRD RF6)
 *
 * @module skill/validator
 */

import { z } from "zod"
import { Log } from "../util/log"
import {
  SKILL_VALIDATION,
  SKILL_ERROR_CODES,
  SKILL_ERROR_MESSAGES,
} from "./constants"
import type {
  SkillFrontmatter,
  SkillIndexEntry,
  SkillSource,
  SkillValidationResult,
} from "./types"

const log = Log.create({ service: "skill.validator" })

/**
 * Zod schema for SKILL.md frontmatter validation
 * Based on PRD RF5: Frontmatter Validation
 */
export const SkillFrontmatterSchema = z.object({
  name: z
    .string()
    .min(1, "Name is required")
    .regex(
      SKILL_VALIDATION.NAME_PATTERN,
      "Must be kebab-case (lowercase letters, numbers, hyphens, starting with a letter)"
    ),

  description: z
    .string()
    .min(
      SKILL_VALIDATION.DESCRIPTION_MIN_LENGTH,
      `Description must be at least ${SKILL_VALIDATION.DESCRIPTION_MIN_LENGTH} characters`
    )
    .max(
      SKILL_VALIDATION.DESCRIPTION_MAX_LENGTH,
      `Description must be at most ${SKILL_VALIDATION.DESCRIPTION_MAX_LENGTH} characters`
    ),

  version: z
    .string()
    .regex(SKILL_VALIDATION.VERSION_PATTERN, "Must be valid semver (e.g., 1.0.0)")
    .optional(),

  "argument-hint": z.string().optional(),

  tools: z.array(z.string()).optional(),

  templates: z.array(z.string()).optional(),

  tags: z.array(z.string()).optional(),

  "min_dipolecode": z.string().optional(),

  author: z.string().optional(),
})

/**
 * Available tools in dipoleCODE for compatibility checking
 * Dynamically populated from tool registry at runtime
 */
let availableTools: Set<string> | null = null

/**
 * Set the list of available tools for validation
 * Should be called during initialization with tools from AFWK_TOOL_IDS
 */
export function setAvailableTools(tools: string[]): void {
  availableTools = new Set(tools)
  log.debug("available tools set", { count: tools.length })
}

/**
 * Get the set of available tools
 * Lazy-initializes with default AFWK tools if not set
 */
export function getAvailableTools(): Set<string> {
  if (!availableTools) {
    // Default tools from AFWK - should be populated at runtime
    // This is a fallback for testing and early initialization
    availableTools = new Set([
      "afwk_get_kanban_status",
      "afwk_get_steering_context",
      "afwk_validate_devtask",
      "afwk_move_kanban_task",
      "afwk_create_devtask",
      "afwk_create_aitask",
      "afwk_complete_aitask",
      "afwk_update_latest_implementation",
      "afwk_update_document",
    ])
    log.debug("using default available tools", { count: availableTools.size })
  }
  return availableTools
}

/**
 * Reset available tools (mainly for testing)
 */
export function resetAvailableTools(): void {
  availableTools = null
}

/**
 * Validate skill frontmatter and generate index entry
 *
 * @param data - Raw frontmatter data from SKILL.md
 * @param skillPath - Absolute path to the SKILL.md file
 * @param source - Source where skill was discovered
 * @returns Validation result with entry or errors
 */
export function validateSkillFrontmatter(
  data: unknown,
  skillPath: string,
  source: SkillSource
): SkillValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  // Parse with Zod schema
  const parseResult = SkillFrontmatterSchema.safeParse(data)

  if (!parseResult.success) {
    for (const issue of parseResult.error.issues) {
      const fieldPath = issue.path.join(".")
      errors.push(`${fieldPath || "root"}: ${issue.message}`)
    }

    log.error("invalid skill frontmatter", {
      path: skillPath,
      errors,
    })

    return {
      valid: false,
      errors,
      warnings,
    }
  }

  const frontmatter = parseResult.data as SkillFrontmatter

  // Check tool compatibility (RF6)
  if (frontmatter.tools && frontmatter.tools.length > 0) {
    const available = getAvailableTools()
    for (const tool of frontmatter.tools) {
      if (!available.has(tool)) {
        const warning = SKILL_ERROR_MESSAGES[SKILL_ERROR_CODES.TOOL_NOT_FOUND](
          frontmatter.name,
          tool
        )
        warnings.push(warning)
        log.warn("skill references unavailable tool", {
          skill: frontmatter.name,
          tool,
          path: skillPath,
        })
      }
    }
  }

  // Build index entry
  const entry: SkillIndexEntry = {
    name: frontmatter.name,
    description: frontmatter.description,
    argumentHint: frontmatter["argument-hint"],
    tags: frontmatter.tags || [],
    version: frontmatter.version,
    tools: frontmatter.tools || [],
    source,
    path: skillPath,
    warnings,
  }

  log.debug("validated skill", {
    name: entry.name,
    source,
    warningCount: warnings.length,
  })

  return {
    valid: true,
    entry,
    errors,
    warnings,
  }
}

/**
 * Validate that a skill name matches its directory name
 * This is a soft check - mismatch generates warning, not error
 *
 * @param name - Skill name from frontmatter
 * @param skillPath - Path to SKILL.md
 * @returns true if names match
 */
export function validateSkillNameMatchesPath(
  name: string,
  skillPath: string
): boolean {
  // Extract directory name (parent of SKILL.md)
  // Handle both Unix and Windows paths
  const segments = skillPath.split(/[/\\]/)
  const skillMdIndex = segments.findIndex(
    (s) => s.toLowerCase() === "skill.md"
  )

  if (skillMdIndex <= 0) {
    return true // Can't determine, assume OK
  }

  const dirName = segments[skillMdIndex - 1]
  const matches = dirName === name

  if (!matches) {
    log.warn("skill name does not match directory", {
      name,
      directory: dirName,
      path: skillPath,
    })
  }

  return matches
}

/**
 * Quick validation check for required fields only
 * Used for fast filtering before full validation
 *
 * @param data - Raw frontmatter data
 * @returns true if has name and description
 */
export function hasRequiredFields(data: unknown): boolean {
  if (!data || typeof data !== "object") {
    return false
  }

  const obj = data as Record<string, unknown>
  return (
    typeof obj.name === "string" &&
    obj.name.length > 0 &&
    typeof obj.description === "string" &&
    obj.description.length >= SKILL_VALIDATION.DESCRIPTION_MIN_LENGTH
  )
}
