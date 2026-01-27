/**
 * Template System Constants
 * Paths, patterns, and default values for template management
 *
 * @module workflow/templates/constants
 */

import os from "os"
import path from "path"
import { WORKFLOW_PATHS } from "../config/defaults"

/**
 * Template file patterns
 */
export const TEMPLATE_FILE_NAME = "TEMPLATE.md"
export const TEMPLATE_FILE_PATTERN = "*.md"
export const TEMPLATE_GLOB_PATTERN = `*/${TEMPLATE_FILE_PATTERN}`

/**
 * Template directories
 */
export const TEMPLATE_DIRS = {
  /** Local project templates */
  local: ".afwk/templates",
  /** User-level templates */
  user: path.join(os.homedir(), ".config", "opencode", "templates"),
  /** Cached templates from remote sync */
  cached: path.join(WORKFLOW_PATHS.base, "cache", "templates"),
} as const

/**
 * Embedded template definitions
 */
export const EMBEDDED_TEMPLATES = {
  "overview": {
    name: "overview",
    description: "Template for devTASK overview documents",
    type: "devtask",
    variables: ["title", "description", "objective", "scope", "criteria"],
  },
  "aitask-blueprint": {
    name: "aitask-blueprint",
    description: "Template for aiTASK blueprint documents",
    type: "aitask",
    variables: ["title", "context", "requirements", "constraints"],
  },
  "completion-notes": {
    name: "completion-notes",
    description: "Template for aiTASK completion notes",
    type: "completion",
    variables: ["title", "summary", "changes", "notes"],
  },
} as const

/**
 * Template types
 */
export const TEMPLATE_TYPES = ["devtask", "aitask", "completion", "overview", "blueprint", "custom"] as const

/**
 * Performance thresholds
 */
export const TEMPLATE_PERFORMANCE = {
  /** Maximum discovery time in ms */
  MAX_DISCOVERY_TIME_MS: 500,
  /** Maximum cache age in ms (1 hour) */
  MAX_CACHE_AGE_MS: 60 * 60 * 1000,
} as const

/**
 * Embedded template content (compiled into binary)
 */
export const EMBEDDED_TEMPLATE_CONTENT: Record<string, string> = {
  "overview": `---
name: overview
description: Template for devTASK overview documents
type: devtask
version: 1.0.0
variables:
  - title
  - description
  - objective
  - scope
  - criteria
---

# {{title}}

## Objetivo
{{objective}}

## Descripción
{{description}}

## Alcance
{{scope}}

## Criterios de Éxito
{{criteria}}
`,

  "aitask-blueprint": `---
name: aitask-blueprint
description: Template for aiTASK blueprint documents
type: aitask
version: 1.0.0
variables:
  - title
  - context
  - requirements
  - constraints
---

# {{title}} - Blueprint

## Contexto
{{context}}

## Requerimientos
{{requirements}}

## Restricciones
{{constraints}}

## Notas de Implementación
<!-- Generado por el LLM durante la ejecución -->
`,

  "completion-notes": `---
name: completion-notes
description: Template for aiTASK completion notes
type: completion
version: 1.0.0
variables:
  - title
  - summary
  - changes
  - notes
---

# {{title}} - Completion Notes

## Resumen
{{summary}}

## Cambios Realizados
{{changes}}

## Notas Adicionales
{{notes}}

## Timestamp
Completado: {{timestamp}}
`,
}
