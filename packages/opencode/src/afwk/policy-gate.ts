// aiFRAMEWORK Policy Gate
// Valida que la respuesta del LLM tenga evidencia apropiada segun la intencion

import type { IntentType, LLMResponse } from "./contracts"
import { isGetter, isMutator } from "./contracts"
import { AfwkLog } from "./logger"

/**
 * Detecta si el texto del LLM es una respuesta de clarificacion.
 * Una clarificacion es cuando el LLM pide mas informacion en lugar de ejecutar.
 *
 * Criterios:
 * - Tiene senales de pregunta/clarificacion
 * - Es corta (<300 chars)
 * - No hace claims de exito
 */
export function isClarificationResponse(text: string): boolean {
  const normalizedText = (text ?? "").trim()

  if (!normalizedText) {
    return false
  }

  // Senales de clarificacion
  const clarificationSignals = [
    // Espanol
    /\b(necesito|falta|cual|que|confirma|especifica|desde|hasta)\b/i,
    // Ingles
    /\b(which|what|need|missing|confirm|specify|from|to)\b/i,
    // Negaciones que indican falta de informacion
    /\b(no (puedo|tengo)|can'?t|don'?t have)\b/i,
    // Termina con pregunta
    /\?\s*$/,
  ]

  // Claims de exito que indican NO es clarificacion
  const successClaims = [
    // Espanol
    /\b(ya (quedo|esta listo|se movio|se creo|completado))\b/i,
    // Ingles
    /\b(done|completed successfully|moved successfully|created)\b/i,
    // Otros claims de exito
    /\b(listo|ready|finished|ejecutado|executed)\b/i,
  ]

  const hasSignal = clarificationSignals.some((p) => p.test(normalizedText))
  const isShort = normalizedText.length < 300
  const noSuccessClaim = !successClaims.some((p) => p.test(normalizedText))

  return hasSignal && isShort && noSuccessClaim
}

/**
 * Policy Gate: Valida que la respuesta del LLM cumpla con las reglas de evidencia.
 *
 * Reglas:
 * - READ intent: DEBE tener un getter ejecutado
 * - MUTATION intent: DEBE tener un mutator ejecutado O ser una clarificacion
 * - CONVERSATION intent: Siempre acepta (sin requisitos)
 *
 * @returns "accept" si la respuesta cumple, "retry" si no cumple
 */
export function policyGate(userIntent: IntentType, llmResponse: LLMResponse): "accept" | "retry" {
  AfwkLog.debug("[POLICY]",` ========== Policy Gate Evaluation ==========`)
  AfwkLog.debug("[POLICY]",` User Intent: ${userIntent}`)
  AfwkLog.debug("[POLICY]",` LLM Text (first 100 chars): ${(llmResponse.text ?? "").slice(0, 100)}...`)
  AfwkLog.debug("[POLICY]",` Tool Calls Count: ${llmResponse.toolCalls?.length ?? 0}`)

  // Log each tool call
  if (llmResponse.toolCalls && llmResponse.toolCalls.length > 0) {
    for (const tc of llmResponse.toolCalls) {
      AfwkLog.debug("[POLICY]",`   - Tool: ${tc.name}, Executed: ${tc.executed}`)
    }
  }

  // Buscar evidencia de tools ejecutadas
  const executedGetter = llmResponse.toolCalls?.find((tc) => tc.executed && isGetter(tc.name))
  const executedMutator = llmResponse.toolCalls?.find((tc) => tc.executed && isMutator(tc.name))

  AfwkLog.debug("[POLICY]",` Executed Getter: ${executedGetter?.name ?? "none"}`)
  AfwkLog.debug("[POLICY]",` Executed Mutator: ${executedMutator?.name ?? "none"}`)

  // READ: requiere getter ejecutado
  if (userIntent === "read") {
    if (executedGetter) {
      AfwkLog.debug("[POLICY]",` Decision: ACCEPT (read intent + getter executed)`)
      return "accept"
    }
    AfwkLog.debug("[POLICY]",` Decision: RETRY (read intent but no getter executed)`)
    return "retry"
  }

  // MUTATION: requiere mutator ejecutado O clarificacion valida
  if (userIntent === "mutation") {
    if (executedMutator) {
      AfwkLog.debug("[POLICY]",` Decision: ACCEPT (mutation intent + mutator executed)`)
      return "accept"
    }
    const isClarification = isClarificationResponse(llmResponse.text)
    AfwkLog.debug("[POLICY]",` Is Clarification: ${isClarification}`)
    if (isClarification) {
      AfwkLog.debug("[POLICY]",` Decision: ACCEPT (mutation intent + valid clarification)`)
      return "accept"
    }
    AfwkLog.debug("[POLICY]",` Decision: RETRY (mutation intent but no mutator and no clarification)`)
    return "retry"
  }

  // CONVERSATION: siempre acepta
  AfwkLog.debug("[POLICY]",` Decision: ACCEPT (conversation intent - always accept)`)
  return "accept"
}
