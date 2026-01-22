// aiFRAMEWORK Staging System
// Implements document staging with editor preview for user confirmation

import * as fs from "fs/promises"
import * as path from "path"
import { createHash } from "crypto"
import { Instance } from "../project/instance"
import { Bus } from "../bus"
import { TuiEvent } from "../cli/cmd/tui/event"
import {
  generateStagingId,
  type StagedDocument,
  type StagedDocumentType,
  type StagedDocumentStatus,
} from "./contracts"
import { readState, writeState } from "./state"

const STAGING_DIR = ".staging"
const STAGING_TTL_MS = 24 * 60 * 60 * 1000 // 24 hours

// ===== Helper Functions =====

/**
 * Get the .afwk directory path
 */
function getAfwkDir(): string {
  return path.join(Instance.directory, ".afwk")
}

/**
 * Get the staging directory path
 */
export function getStagingDir(): string {
  return path.join(getAfwkDir(), STAGING_DIR)
}

/**
 * Compute SHA256 hash of content
 */
function computeHash(content: string): string {
  return createHash("sha256").update(content, "utf-8").digest("hex")
}

/**
 * Ensure staging directory exists
 */
async function ensureStagingDir(): Promise<void> {
  const stagingDir = getStagingDir()
  await fs.mkdir(stagingDir, { recursive: true })
}

// ===== Core Staging Functions =====

export interface StageDocumentInput {
  toolRunId: string
  toolName: string
  content: string
  finalPath: string // relative to .afwk/, e.g., "kanban/backlog/devTASK-01/overview.md"
  documentType: StagedDocumentType
  entityRefs?: { devTaskId?: string; aiTaskId?: string }
}

export interface StageDocumentResult {
  stagingId: string
  stagedPath: string
  finalPath: string
  expiresAt: string
  fullStagedPath: string // absolute path for editor
}

/**
 * Stage a document for user review.
 * 1. Creates staging directory if needed
 * 2. Writes content to .afwk/.staging/{stagingId}/{filename}
 * 3. Records in state.json
 * 4. Publishes TuiEvent.StagingReview
 */
export async function stageDocument(input: StageDocumentInput): Promise<StageDocumentResult> {
  const stagingId = generateStagingId()
  const now = new Date()
  const expiresAt = new Date(now.getTime() + STAGING_TTL_MS)

  // Extract filename from finalPath
  const filename = path.basename(input.finalPath)

  // Build staging path (relative to .afwk/)
  const stagedRelPath = path.join(STAGING_DIR, stagingId, filename).replace(/\\/g, "/")

  // Create staging directory for this document
  const stagingDocDir = path.join(getStagingDir(), stagingId)
  await fs.mkdir(stagingDocDir, { recursive: true })

  // Write content to staging location
  const fullStagedPath = path.join(stagingDocDir, filename)
  await fs.writeFile(fullStagedPath, input.content, "utf-8")

  // Create staged document record
  const stagedDoc: StagedDocument = {
    stagingId,
    toolRunId: input.toolRunId,
    toolName: input.toolName,
    createdAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    stagedPath: stagedRelPath,
    finalPath: input.finalPath,
    documentType: input.documentType,
    originalContent: input.content,
    contentHash: computeHash(input.content),
    entityRefs: input.entityRefs,
    status: "pending",
  }

  // Save to state
  const state = await readState()
  if (!state.staged_documents) {
    state.staged_documents = []
  }
  state.staged_documents.push(stagedDoc)
  await writeState(state)

  // Publish event for VSCode/TUI
  Bus.publish(TuiEvent.StagingReview, {
    stagingId,
    stagedPath: stagedRelPath,
    finalPath: input.finalPath,
    documentType: input.documentType,
    expiresAt: expiresAt.toISOString(),
  })

  return {
    stagingId,
    stagedPath: stagedRelPath,
    finalPath: input.finalPath,
    expiresAt: expiresAt.toISOString(),
    fullStagedPath,
  }
}

export interface ConfirmStagingResult {
  ok: boolean
  stagingId: string
  finalPath?: string
  userEdited: boolean
  error?: string
}

/**
 * Confirm a staged document.
 * 1. Read (possibly edited) content from staging location
 * 2. Write to final location
 * 3. Update state record
 * 4. Clean up staging files
 * 5. Publish result event
 */
export async function confirmStaging(stagingId: string): Promise<ConfirmStagingResult> {
  const state = await readState()
  const stagedDoc = state.staged_documents?.find((d) => d.stagingId === stagingId)

  if (!stagedDoc) {
    return {
      ok: false,
      stagingId,
      userEdited: false,
      error: `Staged document not found: ${stagingId}`,
    }
  }

  if (stagedDoc.status !== "pending") {
    return {
      ok: false,
      stagingId,
      userEdited: false,
      error: `Staged document is not pending: ${stagedDoc.status}`,
    }
  }

  try {
    // Read content from staging location (user may have edited it)
    const stagedFullPath = path.join(getAfwkDir(), stagedDoc.stagedPath)
    const currentContent = await fs.readFile(stagedFullPath, "utf-8")

    // Check if user edited the content
    const currentHash = computeHash(currentContent)
    const userEdited = currentHash !== stagedDoc.contentHash

    // Ensure final directory exists
    const finalFullPath = path.join(getAfwkDir(), stagedDoc.finalPath)
    await fs.mkdir(path.dirname(finalFullPath), { recursive: true })

    // Write to final location
    await fs.writeFile(finalFullPath, currentContent, "utf-8")

    // Update state
    stagedDoc.status = "confirmed"
    stagedDoc.resolvedAt = new Date().toISOString()
    stagedDoc.resolvedBy = "user"
    await writeState(state)

    // Clean up staging files
    await cleanupStagingFiles(stagingId)

    // Publish result event
    Bus.publish(TuiEvent.StagingResult, {
      stagingId,
      result: "confirmed",
      finalPath: stagedDoc.finalPath,
    })

    return {
      ok: true,
      stagingId,
      finalPath: stagedDoc.finalPath,
      userEdited,
    }
  } catch (err) {
    return {
      ok: false,
      stagingId,
      userEdited: false,
      error: `Failed to confirm staging: ${err}`,
    }
  }
}

export interface CancelStagingResult {
  ok: boolean
  stagingId: string
  error?: string
}

/**
 * Cancel a staged document.
 * 1. Update state record
 * 2. Clean up staging files
 * 3. Publish result event
 */
export async function cancelStaging(stagingId: string): Promise<CancelStagingResult> {
  const state = await readState()
  const stagedDoc = state.staged_documents?.find((d) => d.stagingId === stagingId)

  if (!stagedDoc) {
    return {
      ok: false,
      stagingId,
      error: `Staged document not found: ${stagingId}`,
    }
  }

  if (stagedDoc.status !== "pending") {
    return {
      ok: false,
      stagingId,
      error: `Staged document is not pending: ${stagedDoc.status}`,
    }
  }

  try {
    // Update state
    stagedDoc.status = "cancelled"
    stagedDoc.resolvedAt = new Date().toISOString()
    stagedDoc.resolvedBy = "user"
    await writeState(state)

    // Clean up staging files
    await cleanupStagingFiles(stagingId)

    // Publish result event
    Bus.publish(TuiEvent.StagingResult, {
      stagingId,
      result: "cancelled",
    })

    return {
      ok: true,
      stagingId,
    }
  } catch (err) {
    return {
      ok: false,
      stagingId,
      error: `Failed to cancel staging: ${err}`,
    }
  }
}

/**
 * Clean up staging files for a specific stagingId
 */
async function cleanupStagingFiles(stagingId: string): Promise<void> {
  const stagingDocDir = path.join(getStagingDir(), stagingId)
  try {
    await fs.rm(stagingDocDir, { recursive: true, force: true })
  } catch {
    // Ignore errors during cleanup
  }
}

/**
 * List all pending staged documents
 */
export async function listPendingStaged(): Promise<StagedDocument[]> {
  const state = await readState()
  return (state.staged_documents || []).filter((d) => d.status === "pending")
}

/**
 * Get a specific staged document by ID
 */
export async function getStagedDocument(stagingId: string): Promise<StagedDocument | undefined> {
  const state = await readState()
  return state.staged_documents?.find((d) => d.stagingId === stagingId)
}

/**
 * Clean up expired staging documents.
 * Should be called on startup and periodically.
 */
export async function cleanupExpiredStaging(): Promise<number> {
  const state = await readState()
  if (!state.staged_documents) {
    return 0
  }

  const now = new Date()
  let cleanedCount = 0

  for (const stagedDoc of state.staged_documents) {
    if (stagedDoc.status !== "pending") continue

    const expiresAt = new Date(stagedDoc.expiresAt)
    if (now > expiresAt) {
      // Mark as expired
      stagedDoc.status = "expired"
      stagedDoc.resolvedAt = now.toISOString()
      stagedDoc.resolvedBy = "timeout"

      // Clean up files
      await cleanupStagingFiles(stagedDoc.stagingId)

      // Publish result event
      Bus.publish(TuiEvent.StagingResult, {
        stagingId: stagedDoc.stagingId,
        result: "expired",
      })

      cleanedCount++
    }
  }

  if (cleanedCount > 0) {
    await writeState(state)
  }

  return cleanedCount
}

/**
 * Remove resolved staged documents from state (keeps state.json clean).
 * Removes confirmed, cancelled, and expired documents older than 7 days.
 */
export async function pruneResolvedStaging(): Promise<number> {
  const state = await readState()
  if (!state.staged_documents) {
    return 0
  }

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
  const initialCount = state.staged_documents.length

  state.staged_documents = state.staged_documents.filter((doc) => {
    if (doc.status === "pending") return true
    if (!doc.resolvedAt) return true
    const resolvedAt = new Date(doc.resolvedAt)
    return resolvedAt > sevenDaysAgo
  })

  const removed = initialCount - state.staged_documents.length
  if (removed > 0) {
    await writeState(state)
  }

  return removed
}

/**
 * Check if staging is enabled (default: true)
 */
export function isStagingEnabled(): boolean {
  // Could be extended to read from config
  return true
}
