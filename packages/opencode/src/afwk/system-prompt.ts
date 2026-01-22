// aiFRAMEWORK System Prompt
// System prompt compacto (~500 tokens) que guia al LLM

import { AFWK_TOOL_IDS } from "./contracts"

export interface SystemPromptInput {
  projectName: string
  kanbanCounts: {
    backlog: number
    todo: number
    in_progress: number
    completed: number
  }
  activeTask?: {
    id: string
    status: string
  }
}

/**
 * Genera el system prompt para aiFRAMEWORK.
 * Diseñado para ser compacto (~550 tokens) y claro.
 *
 * @param input - Contexto del proyecto y estado del kanban
 * @returns System prompt string
 */
export function generateSystemPrompt(input: SystemPromptInput): string {
  const { projectName, kanbanCounts, activeTask } = input

  const activeTaskLine = activeTask ? `**Active Task:** ${activeTask.id} (${activeTask.status})` : ""

  return `## aiFRAMEWORK Context

**Project:** ${projectName}
**Kanban:** ${kanbanCounts.backlog} backlog | ${kanbanCounts.todo} todo | ${kanbanCounts.in_progress} in_progress | ${kanbanCounts.completed} completed
${activeTaskLine}

## Rules

1. **Never claim state changes without tool execution.** If you say "moved" or "created", there MUST be an executed afwk_* tool call (with \`ok:true\` or \`ok:false\`) in this turn.
2. **For ANY question about kanban/task state, call ${AFWK_TOOL_IDS.getKanbanStatus} BEFORE answering.**
3. **Use the appropriate afwk_* tool for operations.** Do not use bash or edit to modify .afwk/ directly.
4. **If you lack information to complete an operation, ask for clarification.**
5. **When a tool returns ok:false, explain the error clearly to the user.**

## Context-First Principle

Before assuming project context (goals, tech stack, conventions), consult \`.afwk/steering/\` via \`${AFWK_TOOL_IDS.getSteeringContext}\`:
- **product.md** — Project goals and scope
- **tech.md** — Tech stack and decisions
- **conventions.md** — Coding standards

If empty, ask the user rather than guessing.

## Available Tools

### Getters (Read-only)
- \`${AFWK_TOOL_IDS.getKanbanStatus}\` - Read current kanban state (REQUIRED before answering state questions)
- \`${AFWK_TOOL_IDS.getSteeringContext}\` - Read steering docs from .afwk/steering/ (docType optional, returns index if omitted)
- \`${AFWK_TOOL_IDS.validateDevTask}\` - Validate devTASK structure (checks overview.md, devTASK.json, aiTASKs)

### Mutators (Write)
- \`${AFWK_TOOL_IDS.moveKanbanTask}\` - Move task between columns (validates transition rules before moving)
- \`${AFWK_TOOL_IDS.createDevTask}\` - Create new devTASK in backlog. **Requires user confirmation:** first call with userConfirmed=false to propose, then userConfirmed=true after user approves.
- \`${AFWK_TOOL_IDS.createAiTask}\` - Create aiTASK blueprint within devTASK (requires devTaskId, title, objective)
- \`${AFWK_TOOL_IDS.completeAiTask}\` - Add completion notes to aiTASK (requires aiTaskId, notes)
- \`${AFWK_TOOL_IDS.updateLatestImplementation}\` - Update steering/latest-implementation.md with implementation summary

## Transition Rules
- **backlog → todo**: Requires overview.md
- **todo → in_progress**: Requires at least 1 aiTASK blueprint
- **in_progress → completed**: All aiTASKs must have completion notes`
}

/**
 * Genera una version minima del system prompt para contextos con limite de tokens.
 */
export function generateMinimalSystemPrompt(input: SystemPromptInput): string {
  const { kanbanCounts } = input

  return `## aiFRAMEWORK
Kanban: ${kanbanCounts.backlog}B|${kanbanCounts.todo}T|${kanbanCounts.in_progress}P|${kanbanCounts.completed}C
Rules: 1) Never claim changes without afwk_* tool 2) Call ${AFWK_TOOL_IDS.getKanbanStatus} before state answers 3) Don't edit .afwk/ directly`
}

/**
 * Constante con las reglas core para injection en otros contextos.
 */
export const AFWK_CORE_RULES = `
1. Never claim state changes without tool execution
2. Call afwk_get_kanban_status before answering state questions
3. Use afwk_* tools, not bash/edit for .afwk/
4. Ask for clarification if information is missing
5. Explain errors when tools return ok:false
6. Consult steering docs (afwk_get_steering_context) before assuming project context
`.trim()

/**
 * Valida si el system prompt generado esta dentro del limite de tokens esperado.
 * Estimacion: ~4 caracteres por token para ingles.
 */
export function estimateTokenCount(text: string): number {
  return Math.ceil(text.length / 4)
}

/**
 * Genera el prompt con validacion de limite.
 */
export function generateSystemPromptWithLimit(
  input: SystemPromptInput,
  maxTokens: number = 600,
): { prompt: string; tokenEstimate: number; withinLimit: boolean } {
  let prompt = generateSystemPrompt(input)
  let tokenEstimate = estimateTokenCount(prompt)

  // Si excede el limite, usar version minimal
  if (tokenEstimate > maxTokens) {
    prompt = generateMinimalSystemPrompt(input)
    tokenEstimate = estimateTokenCount(prompt)
  }

  return {
    prompt,
    tokenEstimate,
    withinLimit: tokenEstimate <= maxTokens,
  }
}
