/**
 * Skill Discovery Constants
 * Paths, patterns, and configuration for skill discovery
 *
 * @module skill/constants
 */

import os from "os"
import path from "path"

/**
 * Glob pattern for discovering SKILL.md files within skill directories
 */
export const SKILL_GLOB_PATTERN = "*/SKILL.md"

/**
 * Expected filename for skill definition
 */
export const SKILL_FILE_NAME = "SKILL.md"

/**
 * Directory paths for skill sources
 */
export const SKILL_DIRS = {
  /** Project-level skills (relative to project root) */
  local: ".opencode/skill",
  /** User-level skills (absolute path) */
  user: path.join(os.homedir(), ".config", "opencode", "skill"),
  /** Cached skills from remote sync (absolute path) */
  cached: path.join(os.homedir(), ".aifwk", "cache", "skills"),
} as const

/**
 * Error codes for skill operations
 */
export const SKILL_ERROR_CODES = {
  /** Frontmatter failed schema validation */
  INVALID_FRONTMATTER: "SKILL_INVALID_FRONTMATTER",
  /** Required field 'name' missing */
  MISSING_NAME: "SKILL_MISSING_NAME",
  /** Required field 'description' missing */
  MISSING_DESCRIPTION: "SKILL_MISSING_DESCRIPTION",
  /** Referenced tool not available in dipoleCODE */
  TOOL_NOT_FOUND: "SKILL_TOOL_NOT_FOUND",
  /** Failed to load skill content */
  LOAD_ERROR: "SKILL_LOAD_ERROR",
  /** Failed to parse SKILL.md */
  PARSE_ERROR: "SKILL_PARSE_ERROR",
} as const

export type SkillErrorCode = (typeof SKILL_ERROR_CODES)[keyof typeof SKILL_ERROR_CODES]

/**
 * Error message templates
 * Functions that generate user-friendly error messages
 */
export const SKILL_ERROR_MESSAGES = {
  [SKILL_ERROR_CODES.INVALID_FRONTMATTER]: (skillPath: string, details: string) =>
    `Skill '${skillPath}': Invalid frontmatter - ${details}`,

  [SKILL_ERROR_CODES.MISSING_NAME]: (skillPath: string) =>
    `Skill '${skillPath}': Missing required field 'name'`,

  [SKILL_ERROR_CODES.MISSING_DESCRIPTION]: (skillPath: string) =>
    `Skill '${skillPath}': Missing required field 'description'`,

  [SKILL_ERROR_CODES.TOOL_NOT_FOUND]: (skillName: string, tool: string) =>
    `Skill '${skillName}': Tool '${tool}' not available`,

  [SKILL_ERROR_CODES.LOAD_ERROR]: (skillName: string, error: string) =>
    `Failed to load skill '${skillName}': ${error}`,

  [SKILL_ERROR_CODES.PARSE_ERROR]: (skillPath: string, error: string) =>
    `Failed to parse skill at '${skillPath}': ${error}`,
} as const

/**
 * Performance thresholds from PRD RNF1
 * Used for monitoring and warnings
 */
export const SKILL_PERFORMANCE = {
  /** Maximum time for discovery phase (ms) */
  MAX_DISCOVERY_TIME_MS: 100,
  /** Maximum time for index generation (ms) */
  MAX_INDEX_GENERATION_MS: 50,
  /** Maximum time to load a single skill (ms) */
  MAX_SKILL_LOAD_MS: 10,
  /** Maximum memory for index with 100 skills (MB) */
  MAX_INDEX_MEMORY_MB: 1,
  /** Default maximum skills before warning */
  MAX_SKILLS_DEFAULT: 100,
} as const

/**
 * Validation constraints from PRD RF5
 */
export const SKILL_VALIDATION = {
  /** Pattern for valid skill names (kebab-case) */
  NAME_PATTERN: /^[a-z][a-z0-9-]*$/,
  /** Minimum description length */
  DESCRIPTION_MIN_LENGTH: 10,
  /** Maximum description length */
  DESCRIPTION_MAX_LENGTH: 200,
  /** Pattern for valid semver versions */
  VERSION_PATTERN: /^\d+\.\d+\.\d+(-[\w.]+)?$/,
} as const

/**
 * Context injection configuration
 */
export const SKILL_CONTEXT = {
  /** Section header for skill index in LLM context */
  INDEX_HEADER: "## Available Skills",
  /** Intro text for skill index section */
  INDEX_INTRO: `The following skills are available. Suggest them when the user's request matches their purpose.
To invoke a skill, the user types \`/skill-name\` or you can suggest it.`,
  /** Footer text for skill index section */
  INDEX_FOOTER: "When a skill is invoked, you will receive detailed instructions on how to execute it.",
} as const
