// Embedded Skills Loader
// This module imports bundled skills that are compiled into the binary
// Skills are loaded using Bun's file embedding feature

import { Log } from "../util/log"
import { ConfigMarkdown } from "../config/markdown"
import { validateSkillFrontmatter } from "./validator"
import type { SkillIndexEntry } from "./types"

const log = Log.create({ service: "skill.embedded" })

// Import bundled skills with type: "file" to embed them in the binary
// Each skill SKILL.md is imported and will be available via Bun.embeddedFiles at runtime
// Path: from packages/opencode/src/skill/ to repo root .opencode/skill/
// @ts-ignore - Dynamic import with type attribute
import createDevtaskSkill from "../../../../.opencode/skill/create-devtask/SKILL.md" with { type: "file" }
// @ts-ignore - Dynamic import with type attribute
import createAitaskSkill from "../../../../.opencode/skill/create-aitask/SKILL.md" with { type: "file" }
// @ts-ignore - Dynamic import with type attribute
import completeAitaskSkill from "../../../../.opencode/skill/complete-aitask/SKILL.md" with { type: "file" }

// Registry of embedded skill paths
// Add new skills here as they are created
const EMBEDDED_SKILL_PATHS: Record<string, string> = {
  "create-devtask": createDevtaskSkill,
  "create-aitask": createAitaskSkill,
  "complete-aitask": completeAitaskSkill,
}

export interface EmbeddedSkillInfo {
  name: string
  path: string
  content: string
}

/**
 * Load all embedded skills from the binary
 * Returns parsed skill info for each bundled skill
 */
export async function loadEmbeddedSkills(): Promise<EmbeddedSkillInfo[]> {
  const skills: EmbeddedSkillInfo[] = []

  for (const [name, filePath] of Object.entries(EMBEDDED_SKILL_PATHS)) {
    try {
      // Use Bun.file to read the embedded file content
      const content = await Bun.file(filePath).text()
      skills.push({
        name,
        path: filePath,
        content,
      })
      log.debug("loaded embedded skill", { name, path: filePath })
    } catch (error) {
      log.warn("failed to load embedded skill", { name, path: filePath, error })
    }
  }

  return skills
}

/**
 * Check if embedded skills are available
 * This will be true when running from a compiled binary
 */
export function hasEmbeddedSkills(): boolean {
  // Check if any of the embedded paths start with $bunfs (compiled binary)
  // or B:/~BUN (Windows compiled binary)
  for (const filePath of Object.values(EMBEDDED_SKILL_PATHS)) {
    if (filePath.startsWith("$bunfs") || filePath.startsWith("B:/~BUN") || filePath.startsWith("/$bunfs")) {
      return true
    }
  }
  return false
}

/**
 * Get the list of embedded skill names
 */
export function getEmbeddedSkillNames(): string[] {
  return Object.keys(EMBEDDED_SKILL_PATHS)
}

/**
 * Load embedded skills and return as SkillIndexEntry array
 * For integration with SkillDiscovery system
 *
 * @returns Array of SkillIndexEntry for all valid embedded skills
 */
export async function loadEmbeddedSkillsAsEntries(): Promise<SkillIndexEntry[]> {
  const entries: SkillIndexEntry[] = []
  const rawSkills = await loadEmbeddedSkills()

  for (const skill of rawSkills) {
    try {
      const md = ConfigMarkdown.parseContent(skill.content)
      if (!md || !md.data) {
        log.warn("failed to parse embedded skill frontmatter", { name: skill.name })
        continue
      }

      const result = validateSkillFrontmatter(md.data, skill.path, "embedded")
      if (result.valid && result.entry) {
        entries.push(result.entry)
        log.debug("loaded embedded skill as entry", { name: result.entry.name })
      } else {
        log.warn("embedded skill validation failed", {
          name: skill.name,
          errors: result.errors,
        })
      }
    } catch (error) {
      log.warn("failed to process embedded skill", { name: skill.name, error })
    }
  }

  return entries
}
