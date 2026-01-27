/**
 * Skill Discovery Types
 * Core interfaces for the skill discovery system (Phase 1)
 *
 * @module skill/types
 */

import { z } from "zod"

/**
 * Source priority for skill resolution
 * Order determines priority: earlier sources win over later ones
 */
export type SkillSource = "local" | "user" | "cached" | "embedded"

/**
 * Priority order for skill sources
 * Index 0 = highest priority
 */
export const SKILL_SOURCE_PRIORITY: readonly SkillSource[] = [
  "local",
  "user",
  "cached",
  "embedded",
] as const

/**
 * Parsed frontmatter from SKILL.md files
 * Follows the schema defined in PRD RF5
 */
export interface SkillFrontmatter {
  /** Skill identifier (kebab-case, required) */
  name: string
  /** Human-readable description (10-200 chars, required) */
  description: string
  /** Semantic version (optional) */
  version?: string
  /** Hint for argument usage shown in invocation */
  "argument-hint"?: string
  /** Tools used by this skill */
  tools?: string[]
  /** Template files used by this skill */
  templates?: string[]
  /** Categorization tags */
  tags?: string[]
  /** Minimum dipoleCODE version required */
  "min_dipolecode"?: string
  /** Skill author */
  author?: string
}

/**
 * Single entry in the skill index
 * Contains parsed metadata and discovery information
 */
export interface SkillIndexEntry {
  /** Skill identifier */
  name: string
  /** Human-readable description */
  description: string
  /** Hint for argument usage */
  argumentHint?: string
  /** Categorization tags */
  tags: string[]
  /** Semantic version */
  version?: string
  /** Tools used by this skill */
  tools: string[]
  /** Source where skill was discovered */
  source: SkillSource
  /** Absolute path to SKILL.md file */
  path: string
  /** Validation warnings (e.g., unavailable tools) */
  warnings: string[]
}

/**
 * Complete skill index with metadata
 * Generated during startup and cached in memory
 */
export interface SkillIndex {
  /** All discovered skills */
  skills: SkillIndexEntry[]
  /** ISO timestamp of index generation */
  generatedAt: string
  /** Count of skills per source */
  sources: {
    local: number
    user: number
    cached: number
    embedded: number
  }
}

/**
 * Loaded skill with full content
 * Created when a skill is invoked
 */
export interface LoadedSkill {
  /** Index entry with metadata */
  entry: SkillIndexEntry
  /** Full markdown content of SKILL.md */
  content: string
  /** Parsed frontmatter */
  frontmatter: SkillFrontmatter
}

/**
 * Options for skill discovery configuration
 */
export interface SkillDiscoveryOptions {
  /** Project directory to scan for local skills */
  projectDir?: string
  /** User config directory for user skills */
  userDir?: string
  /** Cache directory for cached skills */
  cacheDir?: string
  /** Whether to include embedded skills (default: true) */
  includeEmbedded?: boolean
  /** Whether to validate tool availability (default: true) */
  validateTools?: boolean
}

/**
 * Result of skill validation
 */
export interface SkillValidationResult {
  /** Whether validation passed */
  valid: boolean
  /** Generated index entry (if valid) */
  entry?: SkillIndexEntry
  /** Validation errors (skill excluded from index) */
  errors: string[]
  /** Validation warnings (skill included but flagged) */
  warnings: string[]
}

/**
 * Skill discovery event for logging/debugging
 */
export interface SkillDiscoveryEvent {
  /** Event type */
  type: "discovered" | "skipped" | "error" | "override"
  /** Skill name (if available) */
  name?: string
  /** Source being scanned */
  source: SkillSource
  /** Path to skill file */
  path: string
  /** Reason for skip/error */
  reason?: string
  /** Overridden by which source */
  overriddenBy?: SkillSource
}
