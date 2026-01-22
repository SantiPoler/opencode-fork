// aiFRAMEWORK Evidence Builder
// Construye LLMResponse desde MessageV2.parts para validacion con policy gate

import { MessageV2 } from "../session/message-v2"
import type { LLMResponse, ToolCallEvidence, AfwkToolOutput } from "./contracts"

/**
 * Construye un LLMResponse a partir de las partes de un mensaje asistente.
 * Extrae texto y evidencia de tool calls para validacion con policyGate.
 *
 * @param parts - Array de partes del mensaje asistente
 * @returns LLMResponse con texto y toolCalls
 */
export function buildLLMResponse(parts: MessageV2.Part[]): LLMResponse {
  // Extraer texto de partes de tipo "text"
  const text = parts
    .filter((p): p is MessageV2.TextPart => p.type === "text")
    .map((p) => p.text)
    .join("\n")
    .trim()

  // Extraer evidencia de tool calls
  const toolCalls: ToolCallEvidence[] = parts
    .filter((p): p is MessageV2.ToolPart => p.type === "tool")
    .map((p) => {
      // Una tool se considera "ejecutada" si tiene status completed o error
      const executed = p.state.status === "completed" || p.state.status === "error"

      // Extraer input segun el status
      const input = getToolInput(p.state)

      // Extraer output de AfwkToolOutput si existe en metadata
      const output = getAfwkOutput(p.state)

      return {
        name: p.tool,
        input,
        executed,
        output,
      }
    })

  return { text, toolCalls }
}

/**
 * Extrae el input de una tool segun su estado.
 */
function getToolInput(state: MessageV2.ToolPart["state"]): Record<string, unknown> {
  switch (state.status) {
    case "pending":
      return {}
    case "running":
      return state.input ?? {}
    case "completed":
      return state.input ?? {}
    case "error":
      return state.input ?? {}
    default:
      return {}
  }
}

/**
 * Extrae AfwkToolOutput del metadata si existe.
 * Las tools afwk_* guardan su output estructurado en metadata.afwk
 */
function getAfwkOutput(state: MessageV2.ToolPart["state"]): AfwkToolOutput | undefined {
  if (state.status !== "completed" && state.status !== "error") {
    return undefined
  }

  const metadata = state.metadata
  if (!metadata || typeof metadata !== "object") {
    return undefined
  }

  const afwk = (metadata as Record<string, unknown>).afwk
  if (!afwk || typeof afwk !== "object") {
    return undefined
  }

  // Validar que tiene la estructura esperada
  const output = afwk as Record<string, unknown>
  if (typeof output.ok !== "boolean" || typeof output.tool_run_id !== "string") {
    return undefined
  }

  return output as unknown as AfwkToolOutput
}

/**
 * Verifica si un mensaje asistente tiene evidencia de tools afwk ejecutadas.
 * Util para debugging y logging.
 */
export function hasAfwkEvidence(parts: MessageV2.Part[]): boolean {
  return parts.some(
    (p) =>
      p.type === "tool" &&
      p.tool.startsWith("afwk_") &&
      (p.state.status === "completed" || p.state.status === "error"),
  )
}

/**
 * Extrae solo las tool calls de afwk que fueron ejecutadas.
 */
export function getExecutedAfwkTools(parts: MessageV2.Part[]): ToolCallEvidence[] {
  const response = buildLLMResponse(parts)
  return (response.toolCalls ?? []).filter((tc) => tc.executed && tc.name.startsWith("afwk_"))
}
