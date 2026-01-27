# Workflow: Phase 1 - Skill Discovery System

> Generated from PRD: `docs/prd/remote-workflows-phase1.md`
> Version: 1.0.0 | Status: Ready for Implementation

---

## Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    PHASE 1: SKILL DISCOVERY SYSTEM                           │
├─────────────────────────────────────────────────────────────────────────────┤
│  Objetivo: Sistema de discovery dinámico que permite descubrir y cargar     │
│  skills desde múltiples fuentes con inyección de índice al contexto LLM     │
├─────────────────────────────────────────────────────────────────────────────┤
│  Entregables:                                                                │
│  • SkillDiscovery - Escanea fuentes y genera índice                         │
│  • SkillResolver - Resuelve con prioridad LOCAL > USER > CACHED > EMBEDDED  │
│  • SkillValidator - Valida frontmatter con Zod                              │
│  • ContextBuilder - Inyecta índice dinámico en contexto LLM                 │
├─────────────────────────────────────────────────────────────────────────────┤
│  Estimación Total: ~46 horas | 4 Weeks | 15 aiTASKs                         │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Dependency Graph

```
                           ┌──────────────────┐
                           │   aiTASK-01      │
                           │   types.ts       │
                           └────────┬─────────┘
                                    │
              ┌─────────────────────┼─────────────────────┐
              │                     │                     │
              ▼                     ▼                     ▼
    ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐
    │   aiTASK-02      │  │   aiTASK-03      │  │   aiTASK-04      │
    │   constants.ts   │  │   validator.ts   │  │   Tests T1-T3    │
    └────────┬─────────┘  └────────┬─────────┘  └──────────────────┘
             │                     │
             │           ┌─────────┴─────────┐
             │           │                   │
             ▼           ▼                   ▼
    ┌──────────────────────────────────────────────────────────────┐
    │                        aiTASK-05                              │
    │                   discovery.ts (core)                         │
    └─────────────────────────────┬────────────────────────────────┘
                                  │
              ┌───────────────────┼───────────────────┐
              │                   │                   │
              ▼                   ▼                   ▼
    ┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐
    │   aiTASK-06      │ │   aiTASK-07      │ │   aiTASK-08      │
    │   embedded.ts    │ │   resolver.ts    │ │   Tests T5-T7    │
    │   refactor       │ │                  │ │                  │
    └────────┬─────────┘ └────────┬─────────┘ └──────────────────┘
             │                    │
             └────────┬───────────┘
                      │
                      ▼
    ┌──────────────────────────────────────────────────────────────┐
    │                        aiTASK-09                              │
    │                   context.ts (injection)                      │
    └─────────────────────────────┬────────────────────────────────┘
                                  │
              ┌───────────────────┼───────────────────┐
              │                   │                   │
              ▼                   ▼                   ▼
    ┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐
    │   aiTASK-10      │ │   aiTASK-11      │ │   aiTASK-12      │
    │   system-prompt  │ │   skill.ts       │ │   Integration    │
    │   cleanup        │ │   integration    │ │   Tests          │
    └────────┬─────────┘ └────────┬─────────┘ └────────┬─────────┘
             │                    │                    │
             └────────────────────┼────────────────────┘
                                  │
                                  ▼
                      ┌──────────────────────┐
                      │     aiTASK-13        │
                      │     E2E Tests        │
                      └──────────┬───────────┘
                                 │
                 ┌───────────────┼───────────────┐
                 │               │               │
                 ▼               ▼               ▼
       ┌─────────────────┐ ┌─────────────┐ ┌─────────────────┐
       │   aiTASK-14     │ │  aiTASK-15  │ │   aiTASK-XX     │
       │   Documentation │ │  Perf Test  │ │   Bug Fixes     │
       └─────────────────┘ └─────────────┘ └─────────────────┘
```

---

## Week 1: Foundation (aiTASK-01 → aiTASK-04)

### aiTASK-01: Create Type Definitions

| Field | Value |
|-------|-------|
| **ID** | `aiTASK-P1-01` |
| **Title** | Crear interfaces y tipos en `skill/types.ts` |
| **Estimación** | 2h |
| **Dependencias** | Ninguna |
| **Archivos** | `packages/opencode/src/skill/types.ts` (nuevo) |

**Descripción:**
Crear el módulo de tipos que define todas las interfaces del sistema de Skill Discovery.

**Código Esperado:**
```typescript
// packages/opencode/src/skill/types.ts
import { z } from "zod"

/**
 * Source priority for skill resolution
 * Lower index = higher priority
 */
export type SkillSource = 'local' | 'user' | 'cached' | 'embedded'

export const SKILL_SOURCE_PRIORITY: readonly SkillSource[] = [
  'local',
  'user',
  'cached',
  'embedded'
] as const

/**
 * Parsed frontmatter from SKILL.md
 */
export interface SkillFrontmatter {
  name: string
  description: string
  version?: string
  "argument-hint"?: string
  tools?: string[]
  templates?: string[]
  tags?: string[]
  "min_dipolecode"?: string
  author?: string
}

/**
 * Single entry in the skill index
 */
export interface SkillIndexEntry {
  name: string
  description: string
  argumentHint?: string
  tags: string[]
  version?: string
  tools: string[]
  source: SkillSource
  path: string
  warnings: string[]
}

/**
 * Complete skill index with metadata
 */
export interface SkillIndex {
  skills: SkillIndexEntry[]
  generatedAt: string
  sources: {
    local: number
    user: number
    cached: number
    embedded: number
  }
}

/**
 * Loaded skill with full content
 */
export interface LoadedSkill {
  entry: SkillIndexEntry
  content: string
  frontmatter: SkillFrontmatter
}

/**
 * Options for skill discovery
 */
export interface SkillDiscoveryOptions {
  projectDir?: string
  userDir?: string
  cacheDir?: string
  includeEmbedded?: boolean
  validateTools?: boolean
}

/**
 * Result of skill validation
 */
export interface SkillValidationResult {
  valid: boolean
  entry?: SkillIndexEntry
  errors: string[]
  warnings: string[]
}
```

**Criterios de Aceptación:**
- [ ] Archivo `types.ts` creado en `packages/opencode/src/skill/`
- [ ] Todas las interfaces del PRD implementadas
- [ ] JSDoc en cada interfaz pública
- [ ] TypeScript compila sin errores
- [ ] Exportado desde `skill/index.ts`

---

### aiTASK-02: Create Constants Module

| Field | Value |
|-------|-------|
| **ID** | `aiTASK-P1-02` |
| **Title** | Crear constantes y paths en `skill/constants.ts` |
| **Estimación** | 1h |
| **Dependencias** | aiTASK-01 |
| **Archivos** | `packages/opencode/src/skill/constants.ts` (nuevo) |

**Descripción:**
Definir todas las constantes del sistema: paths de discovery, globs, mensajes de error.

**Código Esperado:**
```typescript
// packages/opencode/src/skill/constants.ts
import os from "os"
import path from "path"

/**
 * Glob patterns for discovering SKILL.md files
 */
export const SKILL_GLOB_PATTERN = "**/SKILL.md"
export const SKILL_FILE_NAME = "SKILL.md"

/**
 * Directory names for skill sources
 */
export const SKILL_DIRS = {
  local: ".opencode/skill",
  user: path.join(os.homedir(), ".config", "opencode", "skill"),
  cached: path.join(os.homedir(), ".aifwk", "cache", "skills"),
} as const

/**
 * Error codes for skill operations
 */
export const SKILL_ERROR_CODES = {
  INVALID_FRONTMATTER: "SKILL_INVALID_FRONTMATTER",
  MISSING_NAME: "SKILL_MISSING_NAME",
  MISSING_DESCRIPTION: "SKILL_MISSING_DESCRIPTION",
  TOOL_NOT_FOUND: "SKILL_TOOL_NOT_FOUND",
  LOAD_ERROR: "SKILL_LOAD_ERROR",
  PARSE_ERROR: "SKILL_PARSE_ERROR",
} as const

/**
 * Error message templates
 */
export const SKILL_ERROR_MESSAGES = {
  [SKILL_ERROR_CODES.INVALID_FRONTMATTER]: (path: string, details: string) =>
    `Skill '${path}': Invalid frontmatter - ${details}`,
  [SKILL_ERROR_CODES.MISSING_NAME]: (path: string) =>
    `Skill '${path}': Missing required field 'name'`,
  [SKILL_ERROR_CODES.MISSING_DESCRIPTION]: (path: string) =>
    `Skill '${path}': Missing required field 'description'`,
  [SKILL_ERROR_CODES.TOOL_NOT_FOUND]: (name: string, tool: string) =>
    `Skill '${name}': Tool '${tool}' not available`,
  [SKILL_ERROR_CODES.LOAD_ERROR]: (name: string, error: string) =>
    `Failed to load skill '${name}': ${error}`,
} as const

/**
 * Performance thresholds (from PRD RNF1)
 */
export const SKILL_PERFORMANCE = {
  MAX_DISCOVERY_TIME_MS: 100,
  MAX_INDEX_GENERATION_MS: 50,
  MAX_SKILL_LOAD_MS: 10,
  MAX_INDEX_MEMORY_MB: 1,
  MAX_SKILLS_DEFAULT: 100,
} as const

/**
 * Validation constraints
 */
export const SKILL_VALIDATION = {
  NAME_PATTERN: /^[a-z][a-z0-9-]*$/,
  DESCRIPTION_MIN_LENGTH: 10,
  DESCRIPTION_MAX_LENGTH: 200,
  VERSION_PATTERN: /^\d+\.\d+\.\d+(-[\w.]+)?$/,
} as const
```

**Criterios de Aceptación:**
- [ ] Archivo `constants.ts` creado
- [ ] Paths dinámicos usando `os.homedir()`
- [ ] Patterns de validación del PRD implementados
- [ ] Performance thresholds del PRD definidos
- [ ] Exportado desde `skill/index.ts`

---

### aiTASK-03: Implement Skill Validator

| Field | Value |
|-------|-------|
| **ID** | `aiTASK-P1-03` |
| **Title** | Implementar validación de frontmatter con Zod |
| **Estimación** | 4h |
| **Dependencias** | aiTASK-01, aiTASK-02 |
| **Archivos** | `packages/opencode/src/skill/validator.ts` (nuevo) |

**Descripción:**
Implementar validación de frontmatter usando Zod schema según RF5 del PRD.

**Código Esperado:**
```typescript
// packages/opencode/src/skill/validator.ts
import { z } from "zod"
import { Log } from "../util/log"
import { SKILL_VALIDATION, SKILL_ERROR_CODES, SKILL_ERROR_MESSAGES } from "./constants"
import type { SkillFrontmatter, SkillIndexEntry, SkillSource, SkillValidationResult } from "./types"

const log = Log.create({ service: "skill.validator" })

/**
 * Zod schema for SKILL.md frontmatter validation
 * Based on PRD RF5: Frontmatter Validation
 */
export const SkillFrontmatterSchema = z.object({
  name: z.string()
    .min(1, "Name is required")
    .regex(SKILL_VALIDATION.NAME_PATTERN, "Must be kebab-case (lowercase letters, numbers, hyphens)"),

  description: z.string()
    .min(SKILL_VALIDATION.DESCRIPTION_MIN_LENGTH, `Description must be at least ${SKILL_VALIDATION.DESCRIPTION_MIN_LENGTH} characters`)
    .max(SKILL_VALIDATION.DESCRIPTION_MAX_LENGTH, `Description must be at most ${SKILL_VALIDATION.DESCRIPTION_MAX_LENGTH} characters`),

  version: z.string()
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
 * This should be dynamically loaded from the tools registry
 */
let availableTools: Set<string> | null = null

export function setAvailableTools(tools: string[]): void {
  availableTools = new Set(tools)
}

export function getAvailableTools(): Set<string> {
  if (!availableTools) {
    // Default tools list - should be populated at runtime
    availableTools = new Set([
      "afwk_get_kanban_status",
      "afwk_create_devtask",
      "afwk_update_devtask",
      "afwk_create_aitask",
      "afwk_complete_aitask",
      // Add more as needed
    ])
  }
  return availableTools
}

/**
 * Validate skill frontmatter and generate index entry
 */
export function validateSkillFrontmatter(
  data: unknown,
  path: string,
  source: SkillSource
): SkillValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  // Parse with Zod
  const parseResult = SkillFrontmatterSchema.safeParse(data)

  if (!parseResult.success) {
    for (const issue of parseResult.error.issues) {
      const fieldPath = issue.path.join(".")
      errors.push(`${fieldPath}: ${issue.message}`)
    }

    log.error("invalid skill frontmatter", {
      path,
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
          path,
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
    path,
    warnings,
  }

  log.debug("validated skill", {
    name: entry.name,
    source,
    warnings: warnings.length,
  })

  return {
    valid: true,
    entry,
    errors,
    warnings,
  }
}

/**
 * Validate that a skill name matches expected directory name
 */
export function validateSkillNameMatchesPath(
  name: string,
  skillPath: string
): boolean {
  const dirName = skillPath.split(/[/\\]/).slice(-2, -1)[0]
  return dirName === name
}
```

**Criterios de Aceptación:**
- [ ] Schema Zod implementado según RF5
- [ ] Validación de campos requeridos (name, description)
- [ ] Validación de formato (kebab-case, semver)
- [ ] Tool compatibility check (RF6)
- [ ] Warnings para tools inexistentes (no bloquea)
- [ ] Logging apropiado
- [ ] TypeScript compila sin errores

---

### aiTASK-04: Unit Tests for Foundation

| Field | Value |
|-------|-------|
| **ID** | `aiTASK-P1-04` |
| **Title** | Tests unitarios para types, constants, validator |
| **Estimación** | 3h |
| **Dependencias** | aiTASK-01, aiTASK-02, aiTASK-03 |
| **Archivos** | `packages/opencode/test/skill/validator.test.ts` (nuevo) |

**Descripción:**
Crear suite de tests para el validator y verificar tipos.

**Código Esperado:**
```typescript
// packages/opencode/test/skill/validator.test.ts
import { describe, test, expect, beforeAll } from "bun:test"
import {
  validateSkillFrontmatter,
  setAvailableTools,
  SkillFrontmatterSchema
} from "../../src/skill/validator"
import { SKILL_VALIDATION } from "../../src/skill/constants"

describe("SkillValidator", () => {
  beforeAll(() => {
    setAvailableTools([
      "afwk_get_kanban_status",
      "afwk_create_devtask",
    ])
  })

  describe("SkillFrontmatterSchema", () => {
    test("validates valid frontmatter", () => {
      const valid = {
        name: "my-skill",
        description: "A valid skill description that is long enough",
        version: "1.0.0",
        tools: ["afwk_get_kanban_status"],
        tags: ["test"],
      }

      const result = SkillFrontmatterSchema.safeParse(valid)
      expect(result.success).toBe(true)
    })

    test("rejects missing name", () => {
      const invalid = {
        description: "A valid description",
      }

      const result = SkillFrontmatterSchema.safeParse(invalid)
      expect(result.success).toBe(false)
    })

    test("rejects invalid name format", () => {
      const invalid = {
        name: "MySkill", // Not kebab-case
        description: "A valid description",
      }

      const result = SkillFrontmatterSchema.safeParse(invalid)
      expect(result.success).toBe(false)
    })

    test("rejects short description", () => {
      const invalid = {
        name: "my-skill",
        description: "Short", // Less than 10 chars
      }

      const result = SkillFrontmatterSchema.safeParse(invalid)
      expect(result.success).toBe(false)
    })

    test("rejects invalid semver", () => {
      const invalid = {
        name: "my-skill",
        description: "A valid description long enough",
        version: "1.0", // Not valid semver
      }

      const result = SkillFrontmatterSchema.safeParse(invalid)
      expect(result.success).toBe(false)
    })
  })

  describe("validateSkillFrontmatter", () => {
    test("returns valid entry for valid frontmatter", () => {
      const result = validateSkillFrontmatter(
        {
          name: "test-skill",
          description: "A test skill with valid description",
        },
        "/path/to/test-skill/SKILL.md",
        "local"
      )

      expect(result.valid).toBe(true)
      expect(result.entry?.name).toBe("test-skill")
      expect(result.entry?.source).toBe("local")
      expect(result.errors).toHaveLength(0)
    })

    test("returns errors for invalid frontmatter", () => {
      const result = validateSkillFrontmatter(
        { name: "InvalidName" },
        "/path/to/invalid/SKILL.md",
        "local"
      )

      expect(result.valid).toBe(false)
      expect(result.errors.length).toBeGreaterThan(0)
    })

    test("returns warnings for unavailable tools", () => {
      const result = validateSkillFrontmatter(
        {
          name: "tool-skill",
          description: "A skill that uses unavailable tools",
          tools: ["afwk_nonexistent_tool"],
        },
        "/path/to/tool-skill/SKILL.md",
        "local"
      )

      expect(result.valid).toBe(true)
      expect(result.warnings).toContain(
        expect.stringContaining("afwk_nonexistent_tool")
      )
    })

    test("sets correct source in entry", () => {
      const sources = ["local", "user", "cached", "embedded"] as const

      for (const source of sources) {
        const result = validateSkillFrontmatter(
          {
            name: "source-test",
            description: "Testing source assignment in entry",
          },
          `/path/${source}/SKILL.md`,
          source
        )

        expect(result.entry?.source).toBe(source)
      }
    })
  })
})
```

**Criterios de Aceptación:**
- [ ] Tests para schema Zod (valid/invalid cases)
- [ ] Tests para cada regla de validación
- [ ] Tests para tool compatibility warnings
- [ ] Tests para todos los sources
- [ ] Coverage > 80% para validator.ts
- [ ] Todos los tests pasan

---

## Week 2: Discovery Engine (aiTASK-05 → aiTASK-08)

### aiTASK-05: Implement Skill Discovery Core

| Field | Value |
|-------|-------|
| **ID** | `aiTASK-P1-05` |
| **Title** | Implementar `SkillDiscovery` class |
| **Estimación** | 6h |
| **Dependencias** | aiTASK-03 |
| **Archivos** | `packages/opencode/src/skill/discovery.ts` (nuevo) |

**Descripción:**
Implementar la clase principal de discovery que escanea todas las fuentes según RF1 y RF2.

**Código Esperado:**
```typescript
// packages/opencode/src/skill/discovery.ts
import path from "path"
import os from "os"
import { Log } from "../util/log"
import { Filesystem } from "../util/filesystem"
import { ConfigMarkdown } from "../config/markdown"
import { validateSkillFrontmatter } from "./validator"
import { SKILL_DIRS, SKILL_FILE_NAME, SKILL_PERFORMANCE } from "./constants"
import type {
  SkillIndex,
  SkillIndexEntry,
  SkillSource,
  SkillDiscoveryOptions
} from "./types"

const log = Log.create({ service: "skill.discovery" })

export class SkillDiscovery {
  private options: Required<SkillDiscoveryOptions>

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
   * Priority: LOCAL > USER > CACHED > EMBEDDED
   */
  async discover(): Promise<SkillIndex> {
    const startTime = performance.now()
    const skills: SkillIndexEntry[] = []
    const seen = new Set<string>()
    const sources = { local: 0, user: 0, cached: 0, embedded: 0 }

    // 1. LOCAL - Project directory
    const localDir = path.join(this.options.projectDir, SKILL_DIRS.local)
    const localSkills = await this.scanDirectory(localDir, 'local')
    for (const skill of localSkills) {
      if (!seen.has(skill.name)) {
        skills.push(skill)
        seen.add(skill.name)
        sources.local++
      }
    }

    // 2. USER - User config directory
    const userSkills = await this.scanDirectory(this.options.userDir, 'user')
    for (const skill of userSkills) {
      if (!seen.has(skill.name)) {
        skills.push(skill)
        seen.add(skill.name)
        sources.user++
      } else {
        log.debug("skill already discovered from higher priority source", {
          name: skill.name,
          skipped: 'user',
        })
      }
    }

    // 3. CACHED - Cache directory
    const cachedSkills = await this.scanDirectory(this.options.cacheDir, 'cached')
    for (const skill of cachedSkills) {
      if (!seen.has(skill.name)) {
        skills.push(skill)
        seen.add(skill.name)
        sources.cached++
      } else {
        log.debug("skill already discovered from higher priority source", {
          name: skill.name,
          skipped: 'cached',
        })
      }
    }

    // 4. EMBEDDED - Built into binary
    if (this.options.includeEmbedded) {
      const embeddedSkills = await this.loadEmbeddedSkills()
      for (const skill of embeddedSkills) {
        if (!seen.has(skill.name)) {
          skills.push(skill)
          seen.add(skill.name)
          sources.embedded++
        } else {
          log.debug("skill already discovered from higher priority source", {
            name: skill.name,
            skipped: 'embedded',
          })
        }
      }
    }

    const duration = performance.now() - startTime

    if (duration > SKILL_PERFORMANCE.MAX_DISCOVERY_TIME_MS) {
      log.warn("skill discovery exceeded performance threshold", {
        duration,
        threshold: SKILL_PERFORMANCE.MAX_DISCOVERY_TIME_MS,
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
   * Scan a directory for SKILL.md files
   */
  private async scanDirectory(
    dir: string,
    source: SkillSource
  ): Promise<SkillIndexEntry[]> {
    const skills: SkillIndexEntry[] = []

    // Check if directory exists
    if (!await Filesystem.isDir(dir)) {
      log.debug("skill directory does not exist", { dir, source })
      return skills
    }

    const glob = new Bun.Glob(`*/${SKILL_FILE_NAME}`)

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
        log.warn("failed to parse skill file", { path: filePath })
        return null
      }

      const result = validateSkillFrontmatter(md.data, filePath, source)

      if (!result.valid) {
        log.error("invalid skill frontmatter", {
          path: filePath,
          errors: result.errors,
        })
        return null
      }

      return result.entry!
    } catch (error) {
      log.error("failed to read skill file", { path: filePath, error })
      return null
    }
  }

  /**
   * Load embedded skills from the binary
   * Delegates to the embedded skills module
   */
  private async loadEmbeddedSkills(): Promise<SkillIndexEntry[]> {
    // Import dynamically to avoid circular dependencies
    const { loadEmbeddedSkillsAsEntries } = await import("./embedded")
    return loadEmbeddedSkillsAsEntries()
  }
}

/**
 * Singleton instance for global access
 */
let discoveryInstance: SkillDiscovery | null = null
let cachedIndex: SkillIndex | null = null

export function getDiscovery(options?: SkillDiscoveryOptions): SkillDiscovery {
  if (!discoveryInstance || options) {
    discoveryInstance = new SkillDiscovery(options)
    cachedIndex = null // Invalidate cache when options change
  }
  return discoveryInstance
}

export async function getSkillIndex(refresh = false): Promise<SkillIndex> {
  if (!cachedIndex || refresh) {
    cachedIndex = await getDiscovery().discover()
  }
  return cachedIndex
}

export function invalidateSkillIndex(): void {
  cachedIndex = null
}
```

**Criterios de Aceptación:**
- [ ] Escanea 4 fuentes en orden de prioridad
- [ ] Skip silencioso si directorio no existe
- [ ] Primera coincidencia gana (priority resolution)
- [ ] Logging de debug para fuentes usadas
- [ ] Performance tracking
- [ ] Singleton pattern con cache
- [ ] TypeScript compila sin errores

---

### aiTASK-06: Refactor Embedded Skills Module

| Field | Value |
|-------|-------|
| **ID** | `aiTASK-P1-06` |
| **Title** | Refactorizar `embedded.ts` para integrar con discovery |
| **Estimación** | 2h |
| **Dependencias** | aiTASK-05 |
| **Archivos** | `packages/opencode/src/skill/embedded.ts` (modificar) |

**Descripción:**
Modificar el módulo existente para exponer embedded skills como `SkillIndexEntry[]`.

**Cambios Requeridos:**
```typescript
// Agregar a embedded.ts

import { validateSkillFrontmatter } from "./validator"
import { ConfigMarkdown } from "../config/markdown"
import type { SkillIndexEntry } from "./types"

/**
 * Load embedded skills and return as SkillIndexEntry array
 * For integration with SkillDiscovery
 */
export async function loadEmbeddedSkillsAsEntries(): Promise<SkillIndexEntry[]> {
  const entries: SkillIndexEntry[] = []
  const rawSkills = await loadEmbeddedSkills()

  for (const skill of rawSkills) {
    try {
      const md = ConfigMarkdown.parseContent(skill.content)
      if (!md || !md.data) continue

      const result = validateSkillFrontmatter(md.data, skill.path, 'embedded')
      if (result.valid && result.entry) {
        entries.push(result.entry)
      }
    } catch (error) {
      log.warn("failed to parse embedded skill", { name: skill.name, error })
    }
  }

  return entries
}
```

**Criterios de Aceptación:**
- [ ] Nueva función `loadEmbeddedSkillsAsEntries` exportada
- [ ] Usa el validator para parsear frontmatter
- [ ] Retorna array de `SkillIndexEntry`
- [ ] Mantiene backward compatibility con código existente
- [ ] Tests existentes siguen pasando

---

### aiTASK-07: Implement Skill Resolver

| Field | Value |
|-------|-------|
| **ID** | `aiTASK-P1-07` |
| **Title** | Implementar `SkillResolver` para lookup por nombre |
| **Estimación** | 3h |
| **Dependencias** | aiTASK-05 |
| **Archivos** | `packages/opencode/src/skill/resolver.ts` (nuevo) |

**Descripción:**
Implementar resolver que permite buscar skills por nombre con prioridad según RF3.

**Código Esperado:**
```typescript
// packages/opencode/src/skill/resolver.ts
import { Log } from "../util/log"
import { ConfigMarkdown } from "../config/markdown"
import { getSkillIndex } from "./discovery"
import type { SkillIndexEntry, LoadedSkill, SkillFrontmatter } from "./types"

const log = Log.create({ service: "skill.resolver" })

export class SkillResolver {
  /**
   * Find a skill by name
   * Returns the highest priority version if multiple exist
   */
  async resolve(name: string): Promise<SkillIndexEntry | null> {
    const index = await getSkillIndex()
    const entry = index.skills.find(s => s.name === name)

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
   * Load full skill content by name
   */
  async load(name: string): Promise<LoadedSkill | null> {
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
   */
  async exists(name: string): Promise<boolean> {
    const entry = await this.resolve(name)
    return entry !== null
  }

  /**
   * Get all skills matching a tag
   */
  async findByTag(tag: string): Promise<SkillIndexEntry[]> {
    const index = await getSkillIndex()
    return index.skills.filter(s => s.tags.includes(tag))
  }

  /**
   * Get all skills from a specific source
   */
  async findBySource(source: SkillIndexEntry['source']): Promise<SkillIndexEntry[]> {
    const index = await getSkillIndex()
    return index.skills.filter(s => s.source === source)
  }

  /**
   * Search skills by name or description
   */
  async search(query: string): Promise<SkillIndexEntry[]> {
    const index = await getSkillIndex()
    const lowerQuery = query.toLowerCase()

    return index.skills.filter(s =>
      s.name.toLowerCase().includes(lowerQuery) ||
      s.description.toLowerCase().includes(lowerQuery)
    )
  }
}

// Singleton instance
let resolverInstance: SkillResolver | null = null

export function getResolver(): SkillResolver {
  if (!resolverInstance) {
    resolverInstance = new SkillResolver()
  }
  return resolverInstance
}
```

**Criterios de Aceptación:**
- [ ] Resolve por nombre retorna entrada de mayor prioridad
- [ ] Load carga contenido completo
- [ ] Métodos de búsqueda (tag, source, search)
- [ ] Logging apropiado
- [ ] Singleton pattern
- [ ] TypeScript compila

---

### aiTASK-08: Discovery Integration Tests

| Field | Value |
|-------|-------|
| **ID** | `aiTASK-P1-08` |
| **Title** | Tests de integración para discovery y resolver |
| **Estimación** | 4h |
| **Dependencias** | aiTASK-05, aiTASK-06, aiTASK-07 |
| **Archivos** | `packages/opencode/test/skill/discovery.test.ts` (nuevo) |

**Descripción:**
Tests de integración que verifican el flujo completo de discovery.

**Criterios de Aceptación:**
- [ ] Test: Discovery encuentra skills de múltiples fuentes
- [ ] Test: Priority resolution (local > user > embedded)
- [ ] Test: Resolver.load() carga contenido completo
- [ ] Test: Invalid skills son excluidos con error log
- [ ] Test: Directorio inexistente es skip silencioso
- [ ] Coverage > 80% para discovery.ts y resolver.ts

---

## Week 3: Integration (aiTASK-09 → aiTASK-12)

### aiTASK-09: Implement Context Injection

| Field | Value |
|-------|-------|
| **ID** | `aiTASK-P1-09` |
| **Title** | Implementar inyección de skill index en contexto LLM |
| **Estimación** | 4h |
| **Dependencias** | aiTASK-05, aiTASK-07 |
| **Archivos** | `packages/opencode/src/session/context.ts` (nuevo/modificar) |

**Descripción:**
Crear función que genera markdown table para inyectar en contexto según RF4.

**Código Esperado:**
```typescript
// packages/opencode/src/skill/context.ts
import type { SkillIndex, SkillIndexEntry, LoadedSkill } from "./types"

/**
 * Build markdown section for skill index (RF4)
 */
export function buildSkillIndexSection(index: SkillIndex): string {
  if (index.skills.length === 0) {
    return ""
  }

  const rows = index.skills.map(skill => {
    const invoke = skill.argumentHint
      ? `\`/${skill.name} ${skill.argumentHint}\``
      : `\`/${skill.name}\``
    return `| ${skill.name} | ${skill.description} | ${invoke} |`
  })

  return `
## Available Skills

The following skills are available. Suggest them when the user's request matches their purpose.
To invoke a skill, the user types \`/skill-name\` or you can suggest it.

| Skill | Description | Invocation |
|-------|-------------|------------|
${rows.join("\n")}

When a skill is invoked, you will receive detailed instructions on how to execute it.
`.trim()
}

/**
 * Format loaded skill for context injection (RF7)
 */
export function formatLoadedSkill(skill: LoadedSkill): string {
  const warnings = skill.entry.warnings.length > 0
    ? `\n\n⚠️ Warnings:\n${skill.entry.warnings.map(w => `- ${w}`).join("\n")}`
    : ""

  return `<skill name="${skill.entry.name}" source="${skill.entry.source}">${warnings}

---

${skill.content}

</skill>`
}

/**
 * Build complete context with skill index and optional loaded skill
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
```

**Criterios de Aceptación:**
- [ ] Genera tabla markdown con todos los skills
- [ ] Incluye nombre, descripción, invocación
- [ ] Format para skill cargado incluye warnings
- [ ] Formato legible para LLM
- [ ] Sin markdown artifacts que confundan al LLM

---

### aiTASK-10: Remove Hardcoded Skills from System Prompt

| Field | Value |
|-------|-------|
| **ID** | `aiTASK-P1-10` |
| **Title** | Remover skills hardcodeados de `system-prompt.ts` |
| **Estimación** | 2h |
| **Dependencias** | aiTASK-09 |
| **Archivos** | `packages/opencode/src/afwk/system-prompt.ts` (modificar) |

**Descripción:**
Limpiar el system prompt para que no tenga lista de skills hardcodeada.

**Cambios Requeridos:**
- Remover secciones "## devTASK Creation — MANDATORY" y similares
- Remover lista de skills del prompt estático
- Agregar placeholder para inyección dinámica
- Mantener reglas de aiFRAMEWORK que no son específicas de skills

**Criterios de Aceptación:**
- [ ] No hay lista de skills hardcodeada
- [ ] System prompt sigue teniendo reglas de aiFRAMEWORK
- [ ] Placeholder claro para inyección de skill index
- [ ] Tests existentes actualizados si es necesario

---

### aiTASK-11: Integrate with Skill Loader

| Field | Value |
|-------|-------|
| **ID** | `aiTASK-P1-11` |
| **Title** | Modificar `skill.ts` para usar nuevo resolver |
| **Estimación** | 3h |
| **Dependencias** | aiTASK-07, aiTASK-09 |
| **Archivos** | `packages/opencode/src/skill/skill.ts` (modificar) |

**Descripción:**
Integrar el skill loader existente con el nuevo sistema de discovery.

**Cambios Requeridos:**
- Usar `SkillDiscovery` en lugar de escaneo manual
- Usar `SkillResolver` para lookup
- Mantener API pública existente (`Skill.get()`, `Skill.all()`)
- Lazy initialization del index

**Criterios de Aceptación:**
- [ ] `Skill.get()` usa nuevo resolver
- [ ] `Skill.all()` usa skill index
- [ ] API backward compatible
- [ ] Performance no degradada
- [ ] Tests existentes pasan

---

### aiTASK-12: Integration with Session Processor

| Field | Value |
|-------|-------|
| **ID** | `aiTASK-P1-12` |
| **Title** | Integrar skill context en session processor |
| **Estimación** | 4h |
| **Dependencias** | aiTASK-09, aiTASK-10, aiTASK-11 |
| **Archivos** | `packages/opencode/src/session/processor.ts` (modificar) |

**Descripción:**
Modificar el processor para inyectar skill index en cada request.

**Criterios de Aceptación:**
- [ ] Skill index inyectado en contexto al iniciar sesión
- [ ] Skill cargado inyectado cuando usuario invoca `/skill-name`
- [ ] Warnings visibles en contexto
- [ ] No rompe flujo existente

---

## Week 4: Polish (aiTASK-13 → aiTASK-15)

### aiTASK-13: End-to-End Tests

| Field | Value |
|-------|-------|
| **ID** | `aiTASK-P1-13` |
| **Title** | Tests E2E del flujo completo |
| **Estimación** | 4h |
| **Dependencias** | aiTASK-12 |
| **Archivos** | `packages/opencode/test/skill/e2e.test.ts` (nuevo) |

**Descripción:**
Tests que verifican el flujo completo desde discovery hasta context injection.

**Escenarios a Probar:**
1. Startup con skills locales y embebidos
2. Override de skill embebido con local
3. LLM ve tabla de skills en contexto
4. Invocar skill carga contenido completo
5. Skill con warnings muestra advertencias

**Criterios de Aceptación:**
- [ ] CA1, CA2, CA3, CA4 del PRD verificados
- [ ] Tests pasan en CI
- [ ] No hay flaky tests

---

### aiTASK-14: Documentation

| Field | Value |
|-------|-------|
| **ID** | `aiTASK-P1-14` |
| **Title** | Documentación de Phase 1 |
| **Estimación** | 3h |
| **Dependencias** | aiTASK-13 |
| **Archivos** | `docs/skill-discovery.md` (nuevo) |

**Contenido:**
1. Overview del sistema de skill discovery
2. Cómo crear un skill custom
3. Orden de prioridad de fuentes
4. Formato de SKILL.md con ejemplos
5. Troubleshooting común

**Criterios de Aceptación:**
- [ ] README actualizado
- [ ] Guía de creación de skills
- [ ] Ejemplos de SKILL.md
- [ ] Documentación de API pública

---

### aiTASK-15: Performance Testing

| Field | Value |
|-------|-------|
| **ID** | `aiTASK-P1-15` |
| **Title** | Verificar performance según RNF1 |
| **Estimación** | 2h |
| **Dependencias** | aiTASK-13 |
| **Archivos** | `packages/opencode/test/skill/performance.test.ts` (nuevo) |

**Métricas a Verificar:**
| Métrica | Target |
|---------|--------|
| Discovery time (50 skills) | < 100ms |
| Index generation | < 50ms |
| Skill loading | < 10ms |
| Memory usage (100 skills) | < 1MB |

**Criterios de Aceptación:**
- [ ] Todos los targets RNF1 cumplidos
- [ ] Tests de performance en CI
- [ ] Baseline documentado

---

## Summary

### Entregables por Semana

| Week | aiTASKs | Entregables |
|------|---------|-------------|
| 1 | 01-04 | types.ts, constants.ts, validator.ts, tests |
| 2 | 05-08 | discovery.ts, embedded.ts refactor, resolver.ts, tests |
| 3 | 09-12 | context.ts, system-prompt cleanup, integración |
| 4 | 13-15 | E2E tests, documentación, performance |

### Definition of Done (Phase 1)

- [ ] Todos los aiTASKs completados
- [ ] Tests unitarios > 80% coverage
- [ ] Tests de integración pasando
- [ ] Tests E2E pasando
- [ ] Performance dentro de RNF1
- [ ] Documentación completa
- [ ] Code review aprobado
- [ ] No errores críticos conocidos
- [ ] Backward compatible con skills existentes

### Métricas de Éxito

| Métrica | Target | Método |
|---------|--------|--------|
| Discovery < 100ms | 100% | Performance test |
| Skills soportados | > 50 | Load test |
| Test coverage | > 80% | Coverage report |
| LLM sugiere correctamente | > 80% | Manual testing |

---

## Quick Reference

### Comandos de Desarrollo

```bash
# Run all skill tests
bun test packages/opencode/test/skill/

# Run specific test file
bun test packages/opencode/test/skill/validator.test.ts

# Check types
bun run typecheck

# Build
bun run build
```

### Archivos Clave

```
packages/opencode/src/skill/
├── index.ts         # Exports públicos
├── types.ts         # aiTASK-01
├── constants.ts     # aiTASK-02
├── validator.ts     # aiTASK-03
├── discovery.ts     # aiTASK-05
├── resolver.ts      # aiTASK-07
├── context.ts       # aiTASK-09
├── embedded.ts      # aiTASK-06 (refactor)
└── skill.ts         # aiTASK-11 (modificar)
```

### Dependencias NPM (ya instaladas)

- `zod` - Schema validation
- `gray-matter` - Frontmatter parsing (via ConfigMarkdown)
- `bun:glob` - File pattern matching
