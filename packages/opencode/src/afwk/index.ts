// aiFRAMEWORK - Enforcement Pipeline
// Sistema "a prueba de alucinaciones" donde el LLM nunca puede afirmar cambios sin evidencia

// Core contracts and types
export * from "./contracts"

// Enforcement pipeline
export * from "./classifier"
export * from "./policy-gate"
export * from "./executor"
export * from "./evidence"

// State and persistence
export * from "./state"

// Staging system for document review
export * from "./staging"

// Logger for file-based debugging
export { AfwkLog } from "./logger"

// System prompt generation
export * from "./system-prompt"

// Template loader for content creation
export * from "./template-loader"

// Transition validation rules engine
export * from "./rules-engine"

// Security hooks - blocks direct access to .afwk/
export {
  AfwkSecurityPlugin,
  AfwkSecurityError,
  isDestructiveAfwkCommand,
  isAfwkPath,
} from "./security-hooks"

// Integration helpers
export * from "./integration"

// Tools - all 9 tools for kanban management
export {
  AfwkTools,
  // Phase 1 tools
  AfwkGetKanbanStatusTool,
  AfwkMoveKanbanTaskTool,
  // Phase 2 tools - Content creation
  AfwkCreateDevTaskTool,
  AfwkCreateAiTaskTool,
  AfwkCompleteAiTaskTool,
  // Phase 2 tools - Additional getters
  AfwkGetSteeringContextTool,
  AfwkValidateDevTaskTool,
  // Phase 2 tools - Steering update
  AfwkUpdateLatestImplementationTool,
  // Agent-driven content generation
  AfwkUpdateDocumentTool,
} from "./tools"
