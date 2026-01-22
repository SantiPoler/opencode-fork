// aiFRAMEWORK State Management
// Persiste evidencia de ejecuciones en disco (.afwk/state.json)

import * as fs from "fs/promises"
import * as path from "path"
import { Instance } from "../project/instance"
import type { StateJson, AuditLogEntry, PendingAction } from "./contracts"
import { AfwkLog } from "./logger"

const STATE_DIR = ".afwk"
const STATE_FILE = "state.json"
const DEFAULT_MAX_ENTRIES = 1000

/**
 * Obtiene la ruta completa al archivo state.json
 * Usa Instance.directory (el directorio del proyecto) en lugar de worktree
 */
export function getStatePath(): string {
  return path.join(Instance.directory, STATE_DIR, STATE_FILE)
}

/**
 * Obtiene la ruta al directorio .afwk
 * Usa Instance.directory (el directorio del proyecto) en lugar de worktree
 */
export function getStateDir(): string {
  return path.join(Instance.directory, STATE_DIR)
}

/**
 * Lee el estado actual desde disco.
 * Si no existe, retorna un estado vacio con valores por defecto.
 */
export async function readState(): Promise<StateJson> {
  const statePath = getStatePath()
  try {
    const content = await fs.readFile(statePath, "utf-8")
    const parsed = JSON.parse(content) as StateJson

    // Validar schema_version
    if (parsed.schema_version !== 1) {
      AfwkLog.warn("[STATE]", `Unknown state schema version: ${parsed.schema_version}, using defaults`)
      return createDefaultState()
    }

    return parsed
  } catch (error) {
    // Si el archivo no existe o hay error de parsing, retornar estado por defecto
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return createDefaultState()
    }
    AfwkLog.warn("[STATE]", "Error reading state.json:", error)
    return createDefaultState()
  }
}

/**
 * Escribe el estado al disco.
 * Crea el directorio .afwk si no existe.
 */
export async function writeState(state: StateJson): Promise<void> {
  const statePath = getStatePath()
  const stateDir = getStateDir()

  await fs.mkdir(stateDir, { recursive: true })
  await fs.writeFile(statePath, JSON.stringify(state, null, 2), "utf-8")
}

/**
 * Agrega una entrada al audit log.
 * Implementa rotacion FIFO cuando se excede el maximo de entradas.
 */
export async function appendToAuditLog(entry: AuditLogEntry): Promise<void> {
  const state = await readState()

  state.audit_log.push(entry)

  // Rotacion FIFO: eliminar entradas antiguas si excede el maximo
  while (state.audit_log.length > state.audit_log_max_entries) {
    state.audit_log.shift()
  }

  await writeState(state)
}

/**
 * Encola una accion pendiente.
 */
export async function enqueuePendingAction(action: PendingAction): Promise<void> {
  const state = await readState()
  state.pending_actions.push(action)
  await writeState(state)
}

/**
 * Obtiene las acciones pendientes.
 */
export async function getPendingActions(): Promise<PendingAction[]> {
  const state = await readState()
  return state.pending_actions.filter((a) => a.status === "pending")
}

/**
 * Actualiza el estado de una accion pendiente.
 */
export async function updatePendingAction(
  actionId: string,
  status: PendingAction["status"],
): Promise<boolean> {
  const state = await readState()
  const action = state.pending_actions.find((a) => a.id === actionId)

  if (!action) {
    return false
  }

  action.status = status
  await writeState(state)
  return true
}

/**
 * Limpia acciones completadas o saltadas del estado.
 */
export async function cleanupPendingActions(): Promise<number> {
  const state = await readState()
  const initialCount = state.pending_actions.length

  state.pending_actions = state.pending_actions.filter((a) => a.status === "pending")

  const removed = initialCount - state.pending_actions.length
  if (removed > 0) {
    await writeState(state)
  }

  return removed
}

/**
 * Obtiene las ultimas N entradas del audit log.
 */
export async function getRecentAuditEntries(count: number = 10): Promise<AuditLogEntry[]> {
  const state = await readState()
  return state.audit_log.slice(-count)
}

/**
 * Verifica si el directorio .afwk existe (indica que el framework esta inicializado).
 */
export async function isInitialized(): Promise<boolean> {
  const directory = Instance.directory
  const stateDir = getStateDir()
  AfwkLog.debug("[STATE]", `Instance.directory: ${directory}`)
  AfwkLog.debug("[STATE]", `Checking isInitialized at: ${stateDir}`)
  try {
    const stats = await fs.stat(stateDir)
    const result = stats.isDirectory()
    AfwkLog.debug("[STATE]", `isInitialized result: ${result}`)
    return result
  } catch (err) {
    AfwkLog.debug("[STATE]", "isInitialized error:", err)
    return false
  }
}

/**
 * Inicializa el directorio .afwk con estado vacio.
 */
export async function initialize(): Promise<void> {
  const state = createDefaultState()
  await writeState(state)
}

// Helper interno
function createDefaultState(): StateJson {
  return {
    schema_version: 1,
    pending_actions: [],
    audit_log: [],
    audit_log_max_entries: DEFAULT_MAX_ENTRIES,
    staged_documents: [],
  }
}
