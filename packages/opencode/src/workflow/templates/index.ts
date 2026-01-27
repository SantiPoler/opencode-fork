/**
 * Template Module
 * Re-exports for template system
 *
 * @module workflow/templates
 */

// Types
export * from "./types"

// Constants
export {
  TEMPLATE_FILE_NAME,
  TEMPLATE_FILE_PATTERN,
  TEMPLATE_GLOB_PATTERN,
  TEMPLATE_DIRS,
  EMBEDDED_TEMPLATES,
  TEMPLATE_TYPES,
  TEMPLATE_PERFORMANCE,
  EMBEDDED_TEMPLATE_CONTENT,
} from "./constants"

// Discovery
export {
  TemplateDiscovery,
  validateTemplateFrontmatter,
  getTemplateDiscovery,
  getTemplateIndex,
  invalidateTemplateIndex,
  resetTemplateDiscovery,
} from "./discovery"

// Resolver
export {
  resolveTemplate,
  loadTemplate,
  getAllTemplates,
  getTemplatesByType,
  templateExists,
  renderTemplate,
  getMissingVariables,
  extractVariables,
  refreshTemplateCache,
} from "./resolver"
