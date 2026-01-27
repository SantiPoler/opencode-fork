/**
 * Template Resolver
 * Load and resolve templates by name with priority handling
 *
 * @module workflow/templates/resolver
 */

import { Log } from "../../util/log"
import { ConfigMarkdown } from "../../config/markdown"
import { getTemplateIndex, invalidateTemplateIndex } from "./discovery"
import { EMBEDDED_TEMPLATE_CONTENT } from "./constants"
import type {
  TemplateIndexEntry,
  LoadedTemplate,
  TemplateFrontmatter,
} from "./types"

const log = Log.create({ service: "workflow.template.resolver" })

/**
 * Resolve a template by name
 * Returns the first match following priority order
 *
 * @param name - Template name
 * @param refresh - Whether to refresh the template index
 * @returns Template entry or undefined if not found
 */
export async function resolveTemplate(name: string, refresh = false): Promise<TemplateIndexEntry | undefined> {
  const index = await getTemplateIndex(refresh)
  return index.templates.find((t) => t.name === name)
}

/**
 * Load a template with its content
 *
 * @param name - Template name
 * @returns Loaded template or undefined if not found
 */
export async function loadTemplate(name: string): Promise<LoadedTemplate | undefined> {
  const entry = await resolveTemplate(name)
  if (!entry) {
    log.debug("template not found", { name })
    return undefined
  }

  try {
    // Handle embedded templates
    if (entry.source === "embedded") {
      const content = EMBEDDED_TEMPLATE_CONTENT[name]
      if (!content) {
        log.error("embedded template content not found", { name })
        return undefined
      }

      // Parse the embedded content
      const lines = content.split("\n")
      const frontmatterEnd = lines.findIndex((l, i) => i > 0 && l === "---")

      let frontmatter: TemplateFrontmatter = {
        name: entry.name,
        description: entry.description,
        version: entry.version,
        type: entry.type as TemplateFrontmatter["type"],
        variables: entry.variables,
      }

      return {
        entry,
        content,
        frontmatter,
      }
    }

    // Load from file
    const md = await ConfigMarkdown.parse(entry.path)
    if (!md) {
      log.error("failed to parse template file", { path: entry.path })
      return undefined
    }

    const frontmatter: TemplateFrontmatter = {
      name: (md.data as any)?.name || entry.name,
      description: (md.data as any)?.description || entry.description,
      version: (md.data as any)?.version || entry.version,
      type: (md.data as any)?.type || entry.type,
      variables: (md.data as any)?.variables || entry.variables,
      author: (md.data as any)?.author,
      tags: (md.data as any)?.tags,
    }

    return {
      entry,
      content: md.content,
      frontmatter,
    }
  } catch (error) {
    log.error("failed to load template", { name, error })
    return undefined
  }
}

/**
 * Get all available templates
 *
 * @param refresh - Whether to refresh the index
 * @returns Array of template entries
 */
export async function getAllTemplates(refresh = false): Promise<TemplateIndexEntry[]> {
  const index = await getTemplateIndex(refresh)
  return index.templates
}

/**
 * Get templates by type
 *
 * @param type - Template type to filter by
 * @returns Array of matching template entries
 */
export async function getTemplatesByType(type: string): Promise<TemplateIndexEntry[]> {
  const index = await getTemplateIndex()
  return index.templates.filter((t) => t.type === type)
}

/**
 * Check if a template exists
 *
 * @param name - Template name
 * @returns true if template exists
 */
export async function templateExists(name: string): Promise<boolean> {
  const template = await resolveTemplate(name)
  return template !== undefined
}

/**
 * Render a template with variables
 *
 * @param template - Loaded template
 * @param variables - Variable values to substitute
 * @returns Rendered content
 */
export function renderTemplate(template: LoadedTemplate, variables: Record<string, string>): string {
  let content = template.content

  // Replace all {{variable}} patterns
  for (const [key, value] of Object.entries(variables)) {
    const pattern = new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, "g")
    content = content.replace(pattern, value)
  }

  // Add timestamp if used
  content = content.replace(/\{\{\s*timestamp\s*\}\}/g, new Date().toISOString())

  return content
}

/**
 * Get missing variables in a template
 *
 * @param template - Loaded template
 * @param provided - Variables that will be provided
 * @returns Array of missing variable names
 */
export function getMissingVariables(template: LoadedTemplate, provided: Record<string, string>): string[] {
  const required = template.frontmatter.variables || []
  return required.filter((v) => !(v in provided) && v !== "timestamp")
}

/**
 * Extract all variable placeholders from template content
 *
 * @param content - Template content
 * @returns Array of variable names
 */
export function extractVariables(content: string): string[] {
  const pattern = /\{\{\s*(\w+)\s*\}\}/g
  const variables = new Set<string>()
  let match

  while ((match = pattern.exec(content)) !== null) {
    variables.add(match[1])
  }

  return Array.from(variables)
}

/**
 * Refresh the template cache
 */
export async function refreshTemplateCache(): Promise<void> {
  invalidateTemplateIndex()
  await getTemplateIndex(true)
  log.info("template cache refreshed")
}
