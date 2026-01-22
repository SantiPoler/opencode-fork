// aiFRAMEWORK Integration
// Funciones helper para integrar el enforcement pipeline en OpenCode

import { MessageV2 } from "../session/message-v2"
import { buildLLMResponse } from "./evidence"
import { classifyIntent } from "./classifier"
import { policyGate } from "./policy-gate"
import { isInitialized } from "./state"
import type { IntentType, LLMResponse, GateResult } from "./contracts"
import { AfwkLog } from "./logger"

/**
 * Resultado de la validación de una respuesta del LLM.
 */
export interface ValidationResult {
  /** Si el enforcement está habilitado (afwk inicializado) */
  enabled: boolean
  /** La intención clasificada del mensaje del usuario */
  intent: IntentType
  /** Si la respuesta pasó la validación */
  valid: boolean
  /** Razón si la validación falló */
  reason?: string
  /** La respuesta LLM construida desde las partes */
  llmResponse?: LLMResponse
}

/**
 * Valida una respuesta del LLM contra las reglas de enforcement.
 *
 * Esta función puede ser usada para:
 * 1. Validar respuestas después de que el LLM responde
 * 2. Logging y debugging del enforcement
 * 3. Implementar retry logic custom
 *
 * @param userMessage - El mensaje original del usuario
 * @param assistantParts - Las partes de la respuesta del asistente
 * @returns Resultado de la validación
 */
export async function validateResponse(
  userMessage: string,
  assistantParts: MessageV2.Part[],
): Promise<ValidationResult> {
  AfwkLog.debug("[INTEGRATION]",` ========== Validate Response ==========`)
  AfwkLog.debug("[INTEGRATION]",` User Message: "${userMessage.slice(0, 80)}..."`)
  AfwkLog.debug("[INTEGRATION]",` Assistant Parts Count: ${assistantParts.length}`)

  // Verificar si afwk está inicializado
  const enabled = await isInitialized()
  AfwkLog.debug("[INTEGRATION]",` AFWK Enabled: ${enabled}`)

  if (!enabled) {
    AfwkLog.debug("[INTEGRATION]",` Result: SKIP (afwk not initialized)`)
    return {
      enabled: false,
      intent: "conversation",
      valid: true,
      reason: "aiFRAMEWORK not initialized, enforcement disabled",
    }
  }

  // Clasificar intención
  const intent = classifyIntent(userMessage)

  // Construir LLMResponse desde las partes
  const llmResponse = buildLLMResponse(assistantParts)

  // Validar con policy gate
  const decision = policyGate(intent, llmResponse)

  AfwkLog.debug("[INTEGRATION]",` Final Decision: ${decision}`)

  if (decision === "accept") {
    AfwkLog.debug("[INTEGRATION]",` Result: VALID`)
    return {
      enabled: true,
      intent,
      valid: true,
      llmResponse,
    }
  }

  // Generar razón de rechazo
  let reason: string
  if (intent === "read") {
    reason = "Read intent requires executed getter tool (afwk_get_kanban_status)"
  } else if (intent === "mutation") {
    reason = "Mutation intent requires executed mutator tool or valid clarification"
  } else {
    reason = "Unknown validation failure"
  }

  AfwkLog.debug("[INTEGRATION]",` Result: INVALID - ${reason}`)

  return {
    enabled: true,
    intent,
    valid: false,
    reason,
    llmResponse,
  }
}

/**
 * Genera el suffix de sistema para reintentos.
 * Se agrega al system prompt cuando una respuesta anterior no pasó la validación.
 */
export function generateRetrySystemSuffix(intent: IntentType): string {
  return `\n\n[SYSTEM: Previous response lacked required tool execution. For ${intent} intent, you MUST use the appropriate afwk_* tool.]`
}

/**
 * Genera el mensaje de sistema para cuando se agotan los reintentos.
 */
export function generateFailureMessage(intent: IntentType): string {
  if (intent === "mutation") {
    return 'No pude ejecutar la operacion porque el modelo no uso las herramientas requeridas. Por favor reformula tu solicitud especificando claramente que tarea quieres modificar (ej: "mueve devTASK-01_login a in_progress").'
  }
  if (intent === "read") {
    return 'No pude obtener el estado actual porque el modelo no consulto las herramientas requeridas. Por favor pregunta de nuevo (ej: "muestrame el estado del kanban").'
  }
  return ""
}

/**
 * Hook que puede ser registrado para logging de enforcement.
 * Útil para debugging y monitoreo.
 */
export interface EnforcementEvent {
  type: "validation_passed" | "validation_failed" | "retry_triggered" | "hard_fail"
  sessionID: string
  userMessage: string
  intent: IntentType
  llmResponse?: LLMResponse
  reason?: string
  attempt?: number
}

type EnforcementListener = (event: EnforcementEvent) => void

const listeners: EnforcementListener[] = []

export function onEnforcementEvent(listener: EnforcementListener): () => void {
  listeners.push(listener)
  return () => {
    const idx = listeners.indexOf(listener)
    if (idx >= 0) listeners.splice(idx, 1)
  }
}

export function emitEnforcementEvent(event: EnforcementEvent): void {
  for (const listener of listeners) {
    try {
      listener(event)
    } catch (err) {
      AfwkLog.error("[INTEGRATION]", "Error in enforcement listener:", err)
    }
  }
}

/**
 * Verifica si el enforcement está habilitado.
 */
export async function isEnforcementEnabled(): Promise<boolean> {
  return isInitialized()
}

/**
 * Extrae el texto del usuario de un array de partes de mensaje.
 */
export function extractUserText(parts: MessageV2.Part[]): string {
  return parts
    .filter((p): p is MessageV2.TextPart => p.type === "text" && !p.synthetic)
    .map((p) => p.text)
    .join("\n")
    .trim()
}
