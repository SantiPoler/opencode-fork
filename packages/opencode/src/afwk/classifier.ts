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

  // READ: preguntas sobre estado del KANBAN (debe incluir terminos de kanban/tareas)
  const readPatterns = [
    // Patron: "kanban" explicito (siempre es read)
    /\bkanban\b/i,
    // Patron: preguntas sobre estado + termino de kanban/tareas
    /\b(cual es el estado|estado del?|what'?s the status)\b.{0,30}\b(kanban|tareas?|tasks?|devtask|aitask|tablero|board)\b/i,
    // Patron: "que hay" + termino de kanban/columna
    /\b(que hay|what'?s)\b.{0,20}\b(en el kanban|en backlog|en todo|en in_progress|en completed|in backlog|in todo)\b/i,
    // Patron: cuantas/cuantos + tareas/devtasks
    /\b(cuantas?|cuantos?|how many)\s*.{0,10}\b(tareas?|tasks?|devtasks?|aitasks?)\b/i,
    // Patron: lista/muestrame + tareas/kanban
    /\b(lista de|muestrame|show me|list)\b.{0,20}\b(tareas?|tasks?|devtasks?|kanban)\b/i,
    // Patron: consultas de tareas + estado
    /\b(tareas?|tasks?|devtasks?)\s+(pendientes?|activas?|actuales?|en progreso|pending|active|current)\b/i,
    // Patron: consultas directas sobre columnas del kanban
    /\b(que|what).{0,10}(hay en|is in).{0,10}(backlog|todo|in_progress|completed)\b/i,
    // Patron: status/current state + kanban terms
    /\b(status|current state|estado actual)\b.{0,20}\b(kanban|tareas?|tasks?|devtask|board)\b/i,
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
