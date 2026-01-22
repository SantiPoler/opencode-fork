// aiFRAMEWORK Executor
// Envuelve el llamado al LLM con enforcement real

import { classifyIntent } from "./classifier"
import { policyGate } from "./policy-gate"
import type { GateResult, IntentType, LLMResponse } from "./contracts"

const MAX_RETRIES = 2

const SYSTEM_MESSAGES: Record<IntentType, string> = {
  mutation:
    'No pude ejecutar la operacion porque el modelo no uso las herramientas requeridas. Por favor reformula tu solicitud especificando claramente que tarea quieres modificar (ej: "mueve devTASK-01_login a in_progress").',
  read: 'No pude obtener el estado actual porque el modelo no consulto las herramientas requeridas. Por favor pregunta de nuevo (ej: "muestrame el estado del kanban").',
  conversation: "",
}

const RETRY_SUFFIX_TEMPLATE = (intent: IntentType) =>
  `\n\n[SYSTEM: Previous response lacked required tool execution. For ${intent} intent, you MUST use the appropriate afwk_* tool.]`

export interface ExecuteWithPolicyGateInput {
  /** El mensaje original del usuario */
  userMessage: string
  /**
   * Funcion que ejecuta un intento de llamada al LLM.
   * @param systemSuffix - Sufijo opcional a agregar al system prompt para retries
   * @returns La respuesta del LLM con evidencia de tools
   */
  runAttempt: (systemSuffix?: string) => Promise<LLMResponse>
}

/**
 * Ejecuta el llamado al LLM con enforcement de policy gate.
 *
 * Flujo:
 * 1. Clasifica la intencion del mensaje del usuario
 * 2. Ejecuta el LLM
 * 3. Valida la respuesta con policyGate
 * 4. Si no pasa, reintenta con systemSuffix hasta MAX_RETRIES
 * 5. Si falla todos los intentos, retorna systemMessage (no respuesta del LLM)
 *
 * @returns GateResult con success=true y response, o success=false y systemMessage
 */
export async function executeWithPolicyGate(input: ExecuteWithPolicyGateInput): Promise<GateResult> {
  const intent = classifyIntent(input.userMessage)

  // Conversation intent: no requiere enforcement
  if (intent === "conversation") {
    const response = await input.runAttempt()
    return { success: true, response }
  }

  let lastResponse: LLMResponse | undefined

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const systemSuffix = attempt > 0 ? RETRY_SUFFIX_TEMPLATE(intent) : undefined

    lastResponse = await input.runAttempt(systemSuffix)

    const decision = policyGate(intent, lastResponse)

    if (decision === "accept") {
      return { success: true, response: lastResponse }
    }

    // Si estamos en el ultimo intento, no seguir
    if (attempt === MAX_RETRIES) {
      break
    }
  }

  // Todos los intentos fallaron: retornar mensaje del sistema
  return {
    success: false,
    systemMessage: SYSTEM_MESSAGES[intent],
  }
}

/**
 * Obtiene la intencion clasificada para un mensaje.
 * Util para logging y debugging.
 */
export function getIntentForMessage(userMessage: string): IntentType {
  return classifyIntent(userMessage)
}

/**
 * Constantes exportadas para uso externo (ej: logging)
 */
export { MAX_RETRIES, SYSTEM_MESSAGES }
