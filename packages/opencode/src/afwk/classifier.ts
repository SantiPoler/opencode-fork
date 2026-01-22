// aiFRAMEWORK Intent Classifier
// Funcion determinista que clasifica el mensaje del usuario

import type { IntentType } from "./contracts"
import { AfwkLog } from "./logger"

/**
 * Clasifica la intencion del mensaje del usuario.
 *
 * - "mutation": El usuario quiere modificar estado (mover, crear, completar tareas)
 * - "read": El usuario quiere consultar estado (que hay, cuantos, estado de)
 * - "conversation": Conversacion general sin intencion de cambio de estado
 */
export function classifyIntent(userMessage: string): IntentType {
  // Normalizar: trim y manejar undefined/null
  const message = (userMessage ?? "").trim()

  AfwkLog.debug("[CLASSIFIER]",` ========== Intent Classification ==========`)
  AfwkLog.debug("[CLASSIFIER]",` User Message: "${message.slice(0, 100)}${message.length > 100 ? '...' : ''}"`)

  if (!message) {
    AfwkLog.debug("[CLASSIFIER]",` Result: conversation (empty message)`)
    return "conversation"
  }

  // MUTATION: verbo mutante + ID de entidad o destino explicito
  const mutationPatterns = [
    // Patron: devTASK-XX o aiTASK-XX seguido de destino
    /\b(devtask-\d{2}|aitask-\d{2})[_\w-]*\b.*\b(a|to|hacia)\s*(backlog|todo|in_progress|completed)\b/i,
    // Patron: verbo mutante + tarea + destino
    /\b(crea|crear|mueve|mover|completa|completar|actualiza|actualizar|pasa|pasar)\b.{0,50}\b(tarea|task|devtask|aitask)\b.{0,30}\b(a|to|hacia)\s*(backlog|todo|in_progress|completed)\b/i,
    // Patron: verbo mutante + tipo de tarea
    /\b(crea|crear|completa|completar|inicializa)\b.{0,30}\b(devtask|aitask|tarea|task)\b/i,
    // Patron: verbos en ingles con ID
    /\b(create|move|complete|update|initialize|start|finish)\b.{0,30}\b(devtask-\d{2}|aitask-\d{2})\b/i,
    // Patron: mover/pasar con ID explicito
    /\b(mueve|mover|pasa|pasar|move)\b.{0,30}\b(devtask|aitask|tarea)[-_]?\d{2}/i,
  ]

  // READ: preguntas sobre estado
  const readPatterns = [
    // Patron: preguntas sobre estado en espanol
    /\b(que hay|cual es el estado|estado del|lista de|muestrame|kanban)\b/i,
    // Patron: cuantas/cuantos + tareas
    /\b(cuantas?|cuantos?)\s*(tareas?|tasks?|hay)\b/i,
    // Patron: preguntas sobre estado en ingles
    /\b(show me|what'?s|status|list|how many|pending|current state)\b/i,
    // Patron: consultas de tareas
    /\b(tareas?|tasks?|devtasks?)\s+(en|in|pendientes?|activas?|actuales?)\b/i,
    // Patron: consultas directas sobre columnas
    /\b(que|what).{0,20}(backlog|todo|in_progress|completed)\b/i,
  ]

  // Evaluar patrones en orden: mutation primero (mas especifico)
  for (let i = 0; i < mutationPatterns.length; i++) {
    if (mutationPatterns[i].test(message)) {
      AfwkLog.debug("[CLASSIFIER]",` Matched mutation pattern #${i + 1}`)
      AfwkLog.debug("[CLASSIFIER]",` Result: mutation`)
      return "mutation"
    }
  }

  for (let i = 0; i < readPatterns.length; i++) {
    if (readPatterns[i].test(message)) {
      AfwkLog.debug("[CLASSIFIER]",` Matched read pattern #${i + 1}`)
      AfwkLog.debug("[CLASSIFIER]",` Result: read`)
      return "read"
    }
  }

  AfwkLog.debug("[CLASSIFIER]",` No patterns matched`)
  AfwkLog.debug("[CLASSIFIER]",` Result: conversation`)
  return "conversation"
}
