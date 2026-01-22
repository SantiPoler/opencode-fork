// aiFRAMEWORK Rules Engine
// Validates kanban transitions based on declarative rules from .afwk/rules.yaml
// Specification: docs/aiframework-plugin-architecture-v2.1.2.md Section 10

import * as fs from "fs/promises"
import * as path from "path"
import YAML from "yaml"
import { Instance } from "../project/instance"

// Kanban columns
const KANBAN_COLUMNS = ["backlog", "todo", "in_progress", "completed"] as const
type KanbanColumn = (typeof KANBAN_COLUMNS)[number]

// ============================================================================
// Rules.yaml Schema Types (Section 10 of architecture doc)
// ============================================================================

type RuleCheckType =
  | "file_exists"
  | "min_files_match"
  | "all_aitasks_have_completion_notes"
  | "section_exists"

interface RuleCheck {
  type: RuleCheckType
  path?: string
  pattern?: string
  min?: number
  section?: string
  error: string
}

interface TransitionConfig {
  checks: RuleCheck[]
}

interface ValidationConfig {
  file?: string
  file_pattern?: string
  exclude?: string
  required_sections?: string[]
}

interface NamingConfig {
  pattern: string
  example?: string
}

/**
 * Schema for .afwk/rules.yaml
 * Matches specification in Section 10 of architecture doc
 */
export interface RulesYaml {
  version: number
  transitions?: {
    backlog_to_todo?: TransitionConfig
    todo_to_in_progress?: TransitionConfig
    in_progress_to_completed?: TransitionConfig
    [key: string]: TransitionConfig | undefined
  }
  validations?: {
    overview?: ValidationConfig
    aitask_blueprint?: ValidationConfig
    [key: string]: ValidationConfig | undefined
  }
  naming?: {
    devtask_folder?: NamingConfig
    aitask_file?: NamingConfig
    [key: string]: NamingConfig | undefined
  }
}

// Internal transition rule format
interface TransitionRule {
  from: KanbanColumn
  to: KanbanColumn
  checks: RuleCheck[]
}

export interface RuleViolation {
  check: RuleCheckType
  message: string
  details?: string
}

export interface RuleResult {
  valid: boolean
  violations: RuleViolation[]
}

// ============================================================================
// Rules Loading
// ============================================================================

let cachedRules: RulesYaml | null = null
let cachedRulesPath: string | null = null

// Optional base path override for testing
let basePathOverride: string | null = null

/**
 * Set base path for rules loading (for testing)
 */
export function setBasePath(basePath: string | null): void {
  basePathOverride = basePath
  clearRulesCache()
}

/**
 * Get the base directory for .afwk
 */
function getBaseDirectory(): string {
  return basePathOverride ?? Instance.directory
}

/**
 * Get the path to rules.yaml
 */
function getRulesPath(): string {
  return path.join(getBaseDirectory(), ".afwk", "rules.yaml")
}

/**
 * Load rules from .afwk/rules.yaml
 * Throws error if file not found or invalid
 */
export async function loadRules(): Promise<RulesYaml> {
  const rulesPath = getRulesPath()

  // Check cache
  if (cachedRules && cachedRulesPath === rulesPath) {
    return cachedRules
  }

  try {
    const content = await fs.readFile(rulesPath, "utf-8")
    const parsed = YAML.parse(content) as RulesYaml

    // Validate version
    if (!parsed.version || parsed.version !== 1) {
      throw new Error(`Invalid rules.yaml: expected version 1, got ${parsed.version}`)
    }

    // Cache the result
    cachedRules = parsed
    cachedRulesPath = rulesPath

    return parsed
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(
        `rules.yaml not found at ${rulesPath}. ` +
          `Create .afwk/rules.yaml with transition rules. ` +
          `See docs/aiframework-plugin-architecture-v2.1.2.md Section 10 for schema.`
      )
    }
    throw error
  }
}

/**
 * Clear the rules cache (useful for testing or after file changes)
 */
export function clearRulesCache(): void {
  cachedRules = null
  cachedRulesPath = null
}

/**
 * Convert rules.yaml transitions to internal TransitionRule format
 */
function getTransitionRulesFromConfig(rules: RulesYaml): TransitionRule[] {
  const result: TransitionRule[] = []

  if (!rules.transitions) {
    return result
  }

  // Map transition keys to from/to pairs
  const transitionMap: Record<string, { from: KanbanColumn; to: KanbanColumn }> = {
    backlog_to_todo: { from: "backlog", to: "todo" },
    todo_to_in_progress: { from: "todo", to: "in_progress" },
    in_progress_to_completed: { from: "in_progress", to: "completed" },
  }

  for (const [key, config] of Object.entries(rules.transitions)) {
    if (!config) continue

    const mapping = transitionMap[key]
    if (mapping && config.checks) {
      result.push({
        from: mapping.from,
        to: mapping.to,
        checks: config.checks,
      })
    }
  }

  return result
}

// ============================================================================
// Check Implementations
// ============================================================================

/**
 * Check if a file exists in the task directory
 */
async function checkFileExists(taskPath: string, filePath: string): Promise<boolean> {
  try {
    await fs.stat(path.join(taskPath, filePath))
    return true
  } catch {
    return false
  }
}

/**
 * Count files matching a glob-like pattern
 * Supports simple patterns like "aiTASK-*.md"
 */
async function countMatchingFiles(taskPath: string, pattern: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(taskPath)
    // Convert glob pattern to regex
    const regexPattern = pattern.replace(/\./g, "\\.").replace(/\*/g, ".*")
    const regex = new RegExp(`^${regexPattern}$`, "i")

    // Filter out completion notes files
    return entries.filter((entry) => {
      if (entry.includes("_completion-notes")) return false
      return regex.test(entry)
    })
  } catch {
    return []
  }
}

/**
 * Check if all aiTASKs have completion notes
 */
async function checkAllAiTasksHaveCompletionNotes(taskPath: string): Promise<{
  valid: boolean
  missingNotes: string[]
}> {
  try {
    const entries = await fs.readdir(taskPath)

    // Find all aiTASK files (excluding completion notes)
    const aiTaskFiles = entries.filter((entry) => {
      return entry.match(/^aiTASK-\d{2}.*\.md$/i) && !entry.includes("_completion-notes")
    })

    // Check each aiTASK has completion notes
    const missingNotes: string[] = []
    for (const aiTaskFile of aiTaskFiles) {
      // Extract aiTASK ID from filename (e.g., "aiTASK-01_setup-db.md" -> "aiTASK-01_setup-db")
      const aiTaskId = aiTaskFile.replace(/\.md$/, "")
      const completionNotesFile = `${aiTaskId}_completion-notes.md`

      if (!entries.includes(completionNotesFile)) {
        missingNotes.push(aiTaskId)
      }
    }

    return {
      valid: missingNotes.length === 0,
      missingNotes,
    }
  } catch {
    return { valid: false, missingNotes: [] }
  }
}

/**
 * Check if a section exists in a file
 */
async function checkSectionExists(
  taskPath: string,
  filePath: string,
  section: string
): Promise<boolean> {
  try {
    const fullPath = path.join(taskPath, filePath)
    const content = await fs.readFile(fullPath, "utf-8")
    return content.includes(section)
  } catch {
    return false
  }
}

/**
 * Execute a single rule check
 */
async function executeCheck(taskPath: string, check: RuleCheck): Promise<RuleViolation | null> {
  switch (check.type) {
    case "file_exists": {
      if (!check.path) {
        return { check: check.type, message: "Invalid check: missing path" }
      }
      const exists = await checkFileExists(taskPath, check.path)
      if (!exists) {
        return { check: check.type, message: check.error, details: `Missing file: ${check.path}` }
      }
      return null
    }

    case "min_files_match": {
      if (!check.pattern || check.min === undefined) {
        return { check: check.type, message: "Invalid check: missing pattern or min" }
      }
      const matchingFiles = await countMatchingFiles(taskPath, check.pattern)
      if (matchingFiles.length < check.min) {
        return {
          check: check.type,
          message: check.error,
          details: `Found ${matchingFiles.length} files matching "${check.pattern}", need at least ${check.min}`,
        }
      }
      return null
    }

    case "all_aitasks_have_completion_notes": {
      const result = await checkAllAiTasksHaveCompletionNotes(taskPath)
      if (!result.valid) {
        return {
          check: check.type,
          message: check.error,
          details:
            result.missingNotes.length > 0
              ? `Missing completion notes for: ${result.missingNotes.join(", ")}`
              : "Could not verify aiTASK completion notes",
        }
      }
      return null
    }

    case "section_exists": {
      if (!check.path || !check.section) {
        return { check: check.type, message: "Invalid check: missing path or section" }
      }
      const exists = await checkSectionExists(taskPath, check.path, check.section)
      if (!exists) {
        return {
          check: check.type,
          message: check.error,
          details: `Section "${check.section}" not found in ${check.path}`,
        }
      }
      return null
    }

    default:
      return { check: check.type, message: `Unknown check type: ${check.type}` }
  }
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Validate a kanban transition
 * @param taskPath - Full path to the devTASK directory
 * @param from - Source column
 * @param to - Target column
 * @returns RuleResult with validation status and any violations
 * @throws Error if rules.yaml is not found
 */
export async function validateTransition(
  taskPath: string,
  from: string,
  to: string
): Promise<RuleResult> {
  const violations: RuleViolation[] = []

  // Load rules from .afwk/rules.yaml (throws if not found)
  const rules = await loadRules()
  const transitionRules = getTransitionRulesFromConfig(rules)

  // Find applicable rule
  const rule = transitionRules.find((r) => r.from === from && r.to === to)

  // If no rule defined for this transition, allow it
  if (!rule) {
    return { valid: true, violations: [] }
  }

  // Execute all checks
  for (const check of rule.checks) {
    const violation = await executeCheck(taskPath, check)
    if (violation) {
      violations.push(violation)
    }
  }

  return {
    valid: violations.length === 0,
    violations,
  }
}

/**
 * Get human-readable description of transition requirements
 * @throws Error if rules.yaml is not found
 */
export async function getTransitionRequirements(from: string, to: string): Promise<string[]> {
  const rules = await loadRules()
  const transitionRules = getTransitionRulesFromConfig(rules)
  const rule = transitionRules.find((r) => r.from === from && r.to === to)

  if (!rule) {
    return []
  }

  return rule.checks.map((check) => {
    switch (check.type) {
      case "file_exists":
        return `File "${check.path}" must exist`
      case "min_files_match":
        return `At least ${check.min} file(s) matching "${check.pattern}" required`
      case "all_aitasks_have_completion_notes":
        return "All aiTASKs must have completion notes"
      case "section_exists":
        return `Section "${check.section}" must exist in "${check.path}"`
      default:
        return `Unknown requirement: ${check.type}`
    }
  })
}

/**
 * Check if a transition is allowed (has a rule defined)
 * Note: Transitions without explicit rules are allowed by default
 * @throws Error if rules.yaml is not found
 */
export async function isTransitionDefined(from: string, to: string): Promise<boolean> {
  const rules = await loadRules()
  const transitionRules = getTransitionRulesFromConfig(rules)
  return transitionRules.some((r) => r.from === from && r.to === to)
}

/**
 * Get all defined transition rules
 * @throws Error if rules.yaml is not found
 */
export async function getTransitionRules(): Promise<TransitionRule[]> {
  const rules = await loadRules()
  return getTransitionRulesFromConfig(rules)
}

/**
 * Validate a file against validation rules
 * @throws Error if rules.yaml is not found
 */
export async function validateFile(
  taskPath: string,
  validationType: string
): Promise<RuleViolation[]> {
  const rules = await loadRules()
  const violations: RuleViolation[] = []

  if (!rules.validations) {
    return violations
  }

  const validation = rules.validations[validationType]
  if (!validation) {
    return violations
  }

  // Check required sections
  if (validation.required_sections && validation.file) {
    for (const section of validation.required_sections) {
      const exists = await checkSectionExists(taskPath, validation.file, section)
      if (!exists) {
        violations.push({
          check: "section_exists",
          message: `Missing required section: ${section}`,
          details: `Section "${section}" not found in ${validation.file}`,
        })
      }
    }
  }

  return violations
}

/**
 * Validate naming convention
 * @throws Error if rules.yaml is not found
 */
export async function validateNaming(name: string, namingType: string): Promise<boolean> {
  const rules = await loadRules()

  if (!rules.naming) {
    return true // No naming rules = valid
  }

  const naming = rules.naming[namingType]
  if (!naming || !naming.pattern) {
    return true // No specific rule = valid
  }

  const regex = new RegExp(naming.pattern)
  return regex.test(name)
}
