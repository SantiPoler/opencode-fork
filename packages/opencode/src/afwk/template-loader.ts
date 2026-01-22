// aiFRAMEWORK Template Loader
// Loads and interpolates templates for devTASK/aiTASK creation
// Supports custom templates from .afwk/templates/ with bundled fallbacks

import * as fs from "fs/promises"
import * as path from "path"
import { getStateDir } from "./state"

// Template types supported by the framework
export type TemplateType = "overview" | "aitask-blueprint" | "completion-notes"

// Context for template interpolation
export interface TemplateContext {
  devTaskId?: string
  aiTaskId?: string
  title?: string
  description?: string
  objective?: string
  notes?: string
  createdAt?: string
  [key: string]: string | undefined
}

// Bundled default templates (used when .afwk/templates/ doesn't have custom ones)
// Templates support two types of placeholders:
// - {{key}} - Simple substitution from user-provided context
// - <!-- FILL: instruction --> - Marker for agent to fill with generated content
const BUNDLED_TEMPLATES: Record<TemplateType, string> = {
  overview: `# {{title}}

> Created: {{createdAt}}

## Objetivo

{{description}}

## Alcance

<!-- FILL: Lista los componentes, archivos y modulos que seran afectados basandote en la descripcion. Si necesitas mas contexto, busca en el proyecto. Usa formato de lista con bullets. -->

## Criterios de Exito

<!-- FILL: Define 3-5 criterios medibles y verificables de exito. Usa formato de checkboxes. -->

## Consideraciones Tecnicas

<!-- FILL: Identifica posibles riesgos tecnicos, dependencias y decisiones arquitectonicas. Si no tienes suficiente contexto, indica que informacion falta. -->

## Fuera de Alcance

<!-- FILL: Lista explicitamente que NO esta incluido en esta tarea para evitar scope creep. -->
`,

  "aitask-blueprint": `# {{title}}

> aiTASK: {{aiTaskId}} | devTASK: {{devTaskId}} | Created: {{createdAt}}

## Objetivo de esta Iteracion

{{objective}}

## Especificacion de Implementacion

<!-- FILL: Detalla los pasos tecnicos de implementacion. Incluye archivos a crear/modificar. Si necesitas contexto del codigo, buscalo en el proyecto. -->

## Criterios de Validacion

<!-- FILL: Lista 3-5 criterios de validacion especificos para esta iteracion. Usa checkboxes. -->

## Archivos a Modificar

<!-- FILL: Lista los archivos que se modificaran con descripcion del cambio. Busca en el proyecto para identificar archivos relevantes. -->

## Casos de Prueba

<!-- FILL: Define 2-4 casos de prueba. Incluye happy path y edge cases. -->
`,

  "completion-notes": `# Completion Notes: {{aiTaskId}}

> Completed: {{createdAt}}

## Resumen de Implementacion

<!-- FILL: Resume lo que se implemento basandote en las notas y tu conocimiento del trabajo realizado. -->

## Cambios Realizados

<!-- FILL: Lista los archivos que fueron modificados. Si tienes acceso a git diff, usalo. -->

## Lecciones Aprendidas

<!-- FILL: Extrae insights utiles para futuras iteraciones. -->

## Notas Originales

{{notes}}
`,
}

/**
 * Get the templates directory path
 * @param basePath - Optional base path (defaults to trying getStateDir)
 * @returns Path to .afwk/templates/ or null if not available
 */
export function getTemplatesDir(basePath?: string): string | null {
  if (basePath) {
    return path.join(basePath, "templates")
  }
  try {
    return path.join(getStateDir(), "templates")
  } catch {
    return null
  }
}

/**
 * Get the path to a specific template file
 * @param type - Template type
 * @param basePath - Optional base path
 * @returns Full path to the template file or null if not available
 */
export function getTemplatePath(type: TemplateType, basePath?: string): string | null {
  const templatesDir = getTemplatesDir(basePath)
  if (!templatesDir) return null
  return path.join(templatesDir, `${type}.md`)
}

/**
 * Check if custom templates directory exists
 * @param basePath - Optional base path
 * @returns true if .afwk/templates/ exists
 */
export async function hasCustomTemplates(basePath?: string): Promise<boolean> {
  const templatesDir = getTemplatesDir(basePath)
  if (!templatesDir) return false
  try {
    const stat = await fs.stat(templatesDir)
    return stat.isDirectory()
  } catch {
    return false
  }
}

/**
 * Load a raw template string (custom or bundled)
 * @param type - Template type to load
 * @param basePath - Optional base path for custom templates
 * @returns Template string (custom if exists, otherwise bundled)
 */
export async function loadRawTemplate(type: TemplateType, basePath?: string): Promise<string> {
  // Try to load custom template first
  const customPath = getTemplatePath(type, basePath)
  if (customPath) {
    try {
      const customTemplate = await fs.readFile(customPath, "utf-8")
      return customTemplate
    } catch {
      // Fall back to bundled template
    }
  }
  return BUNDLED_TEMPLATES[type]
}

/**
 * Interpolate a template string with context values
 * Replaces {{key}} patterns with values from context
 * Missing keys are left as empty strings
 *
 * @param template - Template string with {{key}} placeholders
 * @param context - Values to interpolate
 * @returns Interpolated template string
 */
export function interpolateTemplate(
  template: string,
  context: TemplateContext
): string {
  // Add default createdAt if not provided
  const fullContext: TemplateContext = {
    createdAt: new Date().toISOString(),
    ...context,
  }

  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    const value = fullContext[key]
    return value !== undefined ? value : ""
  })
}

/**
 * Load and interpolate a template in one step
 * @param type - Template type to load
 * @param context - Values to interpolate
 * @param basePath - Optional base path for custom templates
 * @returns Fully interpolated template string
 */
export async function loadTemplate(
  type: TemplateType,
  context: TemplateContext,
  basePath?: string
): Promise<string> {
  const rawTemplate = await loadRawTemplate(type, basePath)
  return interpolateTemplate(rawTemplate, context)
}

/**
 * Initialize templates directory with bundled defaults
 * Creates .afwk/templates/ and writes all bundled templates
 * Useful for bootstrapping or resetting templates
 * @param basePath - Optional base path (uses getStateDir if not provided)
 * @throws Error if basePath not provided and Instance context not available
 */
export async function initializeTemplates(basePath?: string): Promise<void> {
  const templatesDir = getTemplatesDir(basePath)
  if (!templatesDir) {
    throw new Error("Cannot initialize templates: no base path available")
  }

  // Create templates directory
  await fs.mkdir(templatesDir, { recursive: true })

  // Write all bundled templates
  for (const [type, content] of Object.entries(BUNDLED_TEMPLATES)) {
    const templatePath = path.join(templatesDir, `${type}.md`)
    await fs.writeFile(templatePath, content, "utf-8")
  }
}

/**
 * List all available template types
 * @returns Array of template type names
 */
export function listTemplateTypes(): TemplateType[] {
  return Object.keys(BUNDLED_TEMPLATES) as TemplateType[]
}

/**
 * Get the bundled template content (for reference/reset)
 * @param type - Template type
 * @returns Bundled template string
 */
export function getBundledTemplate(type: TemplateType): string {
  return BUNDLED_TEMPLATES[type]
}
