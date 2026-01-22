// aiFRAMEWORK Contracts - Tipos compartidos para enforcement pipeline
// Fase 1: Enforcement primero, tools despues

import { randomUUID } from "crypto"

// TIPOS DE INTENCION
export type IntentType = "mutation" | "read" | "conversation"

// NOTA OpenCode: los IDs de tool deben ser provider-safe (sin ":")
export const AFWK_TOOL_IDS = {
  // Phase 1 - Getters
  getKanbanStatus: "afwk_get_kanban_status",
  // Phase 2 - Getters
  getSteeringContext: "afwk_get_steering_context",
  validateDevTask: "afwk_validate_devtask",
  // Phase 1 - Mutators
  moveKanbanTask: "afwk_move_kanban_task",
  // Phase 2 - Mutators
  createDevTask: "afwk_create_devtask",
  createAiTask: "afwk_create_aitask",
  completeAiTask: "afwk_complete_aitask",
  updateLatestImplementation: "afwk_update_latest_implementation",
  // Agent-driven content generation
  updateDocument: "afwk_update_document",
} as const

// TOOL REGISTRY - Categorizes tools for policy gate validation
export const TOOL_REGISTRY = {
  getters: [
    AFWK_TOOL_IDS.getKanbanStatus,
    AFWK_TOOL_IDS.getSteeringContext,
    AFWK_TOOL_IDS.validateDevTask,
  ],
  mutators: [
    AFWK_TOOL_IDS.moveKanbanTask,
    AFWK_TOOL_IDS.createDevTask,
    AFWK_TOOL_IDS.createAiTask,
    AFWK_TOOL_IDS.completeAiTask,
    AFWK_TOOL_IDS.updateLatestImplementation,
    AFWK_TOOL_IDS.updateDocument,
  ],
} as const

export type GetterTool = (typeof TOOL_REGISTRY.getters)[number]
export type MutatorTool = (typeof TOOL_REGISTRY.mutators)[number]

export function isGetter(toolName: string): toolName is GetterTool {
  return TOOL_REGISTRY.getters.includes(toolName as GetterTool)
}

export function isMutator(toolName: string): toolName is MutatorTool {
  return TOOL_REGISTRY.mutators.includes(toolName as MutatorTool)
}

// CONTRATO DE OUTPUT PARA TOOLS
export interface AfwkToolOutput {
  ok: boolean
  tool_run_id: string
  entity_refs?: {
    devTaskId?: string
    aiTaskId?: string
  }
  changes: Array<{
    path: string
    type: "create" | "update" | "move" | "delete"
    summary: string
  }>
  warnings: string[]
  errors: string[]
}

// TOOL CALL EVIDENCE (para policy gate)
export interface ToolCallEvidence {
  name: string
  input: Record<string, unknown>
  executed: boolean
  output?: AfwkToolOutput
}

export interface LLMResponse {
  text: string
  toolCalls?: ToolCallEvidence[]
}

export interface GateResult {
  success: boolean
  response?: LLMResponse
  systemMessage?: string
}

// ESTADO PERSISTENTE
export interface PendingAction {
  id: string
  type: string
  context: Record<string, unknown>
  created_at: string
  status: "pending" | "completed" | "skipped"
}

export interface AuditLogEntry {
  tool_run_id: string
  timestamp: string
  tool: string
  entity_refs?: { devTaskId?: string; aiTaskId?: string }
  input: Record<string, unknown>
  output_ok: boolean
  changes: Array<{
    path: string
    type: "create" | "update" | "move" | "delete"
    summary: string
  }>
  errors: string[]
}

export interface StateJson {
  schema_version: number
  pending_actions: PendingAction[]
  audit_log: AuditLogEntry[]
  audit_log_max_entries: number
  staged_documents: StagedDocument[]
}

// ===== STAGING SYSTEM TYPES =====

export type StagedDocumentType =
  | "devtask-overview"
  | "aitask-blueprint"
  | "completion-notes"
  | "document-update"

export type StagedDocumentStatus = "pending" | "confirmed" | "cancelled" | "expired"

export interface StagedDocument {
  stagingId: string // "stg_{uuid}"
  toolRunId: string
  toolName: string
  createdAt: string
  expiresAt: string // 24h TTL
  stagedPath: string // relative path: .staging/{stagingId}/filename.md
  finalPath: string // relative path: kanban/backlog/devTASK-01/overview.md
  documentType: StagedDocumentType
  originalContent: string
  contentHash: string // SHA256
  entityRefs?: { devTaskId?: string; aiTaskId?: string }
  status: StagedDocumentStatus
  resolvedAt?: string
  resolvedBy?: "user" | "timeout" | "system"
}

export interface StagingToolOutput extends AfwkToolOutput {
  staging?: {
    stagingId: string
    awaitingReview: boolean
    stagedPath: string
    finalPath: string
    expiresAt: string
  }
}

export function generateStagingId(): string {
  return `stg_${randomUUID()}`
}

// HELPERS
export function generateToolRunId(): string {
  return `tr_${randomUUID()}`
}
