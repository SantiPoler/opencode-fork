// aiFRAMEWORK Tools
// Tools para interactuar con el kanban board de tareas

import z from "zod"
import * as fs from "fs/promises"
import * as path from "path"
import { Tool } from "../tool/tool"
import { Instance } from "../project/instance"
import { generateToolRunId, type AfwkToolOutput, type StagingToolOutput, AFWK_TOOL_IDS } from "./contracts"
import { appendToAuditLog, isInitialized, enqueuePendingAction } from "./state"
import { loadTemplate } from "./template-loader"
import { validateTransition, getTransitionRequirements } from "./rules-engine"
import { stageDocument, isStagingEnabled } from "./staging"
import { Bus } from "../bus"
import { TuiEvent } from "../cli/cmd/tui/event"

// Columnas validas del kanban
const KANBAN_COLUMNS = ["backlog", "todo", "in_progress", "completed"] as const
type KanbanColumn = (typeof KANBAN_COLUMNS)[number]

const KanbanColumnSchema = z.enum(KANBAN_COLUMNS)

/**
 * Obtiene la ruta al directorio .afwk
 * Usa Instance.directory (el directorio del proyecto) en lugar de worktree
 */
function getAfwkDir(): string {
  return path.join(Instance.directory, ".afwk")
}

/**
 * Convierte una ruta absoluta a relativa respecto a .afwk/
 * Segun doc: "Ruta relativa al archivo/carpeta afectado"
 * No guardar rutas absolutas del sistema en audit log
 */
function toRelativePath(absolutePath: string): string {
  const afwkDir = getAfwkDir()
  if (absolutePath.startsWith(afwkDir)) {
    // Remove .afwk/ prefix and normalize separators
    let relative = absolutePath.slice(afwkDir.length)
    // Remove leading path separator
    if (relative.startsWith(path.sep) || relative.startsWith("/")) {
      relative = relative.slice(1)
    }
    // Normalize to forward slashes for consistency
    return relative.replace(/\\/g, "/")
  }
  // If not under .afwk, return just the basename
  return path.basename(absolutePath)
}

/**
 * Obtiene la ruta al directorio de una columna del kanban
 */
function getColumnDir(column: KanbanColumn): string {
  return path.join(getAfwkDir(), "kanban", column)
}

/**
 * Lista las tareas en una columna del kanban
 */
async function listTasksInColumn(column: KanbanColumn): Promise<string[]> {
  const columnDir = getColumnDir(column)
  try {
    const entries = await fs.readdir(columnDir, { withFileTypes: true })
    return entries
      .filter((e) => e.isDirectory() && e.name.match(/^(devTASK|aiTASK)-\d{2}/i))
      .map((e) => e.name)
      .sort()
  } catch {
    return []
  }
}

/**
 * Verifica si una tarea existe en una columna
 */
async function taskExistsInColumn(taskId: string, column: KanbanColumn): Promise<boolean> {
  const taskDir = path.join(getColumnDir(column), taskId)
  try {
    const stats = await fs.stat(taskDir)
    return stats.isDirectory()
  } catch {
    return false
  }
}

/**
 * Encuentra en que columna esta una tarea
 */
async function findTaskColumn(taskId: string): Promise<KanbanColumn | null> {
  for (const column of KANBAN_COLUMNS) {
    if (await taskExistsInColumn(taskId, column)) {
      return column
    }
  }
  return null
}

// ============================================================================
// TOOL: afwk_get_kanban_status
// ============================================================================

interface KanbanStatusMetadata {
  afwk: AfwkToolOutput
  counts: Record<KanbanColumn, number>
}

export const AfwkGetKanbanStatusTool = Tool.define<z.ZodObject<{}>, KanbanStatusMetadata>(
  AFWK_TOOL_IDS.getKanbanStatus,
  {
    description:
      "Read current AFWK kanban status. Returns the count and list of tasks in each column (backlog, todo, in_progress, completed). Use this tool BEFORE answering any question about task state.",
    parameters: z.object({}),
    async execute(_params, _ctx) {
      const runId = generateToolRunId()
      const errors: string[] = []
      const warnings: string[] = []

      // Verificar si .afwk esta inicializado
      const initialized = await isInitialized()
      if (!initialized) {
        const output: AfwkToolOutput = {
          ok: false,
          tool_run_id: runId,
          changes: [],
          warnings: [],
          errors: ["aiFRAMEWORK not initialized. Run initialization first."],
        }

        await appendToAuditLog({
          tool_run_id: runId,
          timestamp: new Date().toISOString(),
          tool: AFWK_TOOL_IDS.getKanbanStatus,
          input: {},
          output_ok: false,
          changes: [],
          errors: output.errors,
        })

        return {
          title: "Kanban Status",
          output: JSON.stringify({ error: "Not initialized", counts: {} }),
          metadata: { afwk: output, counts: { backlog: 0, todo: 0, in_progress: 0, completed: 0 } },
        }
      }

      // Obtener tareas de cada columna
      const kanban: Record<KanbanColumn, string[]> = {
        backlog: [],
        todo: [],
        in_progress: [],
        completed: [],
      }

      const counts: Record<KanbanColumn, number> = {
        backlog: 0,
        todo: 0,
        in_progress: 0,
        completed: 0,
      }

      for (const column of KANBAN_COLUMNS) {
        try {
          kanban[column] = await listTasksInColumn(column)
          counts[column] = kanban[column].length
        } catch (err) {
          warnings.push(`Could not read ${column}: ${err}`)
        }
      }

      const output: AfwkToolOutput = {
        ok: true,
        tool_run_id: runId,
        changes: [],
        warnings,
        errors,
      }

      // Registrar en audit log
      await appendToAuditLog({
        tool_run_id: runId,
        timestamp: new Date().toISOString(),
        tool: AFWK_TOOL_IDS.getKanbanStatus,
        input: {},
        output_ok: output.ok,
        changes: output.changes,
        errors: output.errors,
      })

      // Formatear output legible
      const lines = [
        "## Kanban Status",
        "",
        `**Backlog** (${counts.backlog}): ${kanban.backlog.join(", ") || "empty"}`,
        `**Todo** (${counts.todo}): ${kanban.todo.join(", ") || "empty"}`,
        `**In Progress** (${counts.in_progress}): ${kanban.in_progress.join(", ") || "empty"}`,
        `**Completed** (${counts.completed}): ${kanban.completed.join(", ") || "empty"}`,
      ]

      return {
        title: "Kanban Status",
        output: lines.join("\n"),
        metadata: { afwk: output, counts },
      }
    },
  },
)

// ============================================================================
// TOOL: afwk_move_kanban_task
// ============================================================================

const MoveTaskParams = z.object({
  taskId: z.string().describe("The task ID to move (e.g., devTASK-01_login, aiTASK-02)"),
  from: KanbanColumnSchema.describe("Current column of the task"),
  to: KanbanColumnSchema.describe("Target column to move the task to"),
})

interface MoveTaskMetadata {
  afwk: AfwkToolOutput
}

export const AfwkMoveKanbanTaskTool = Tool.define<typeof MoveTaskParams, MoveTaskMetadata>(
  AFWK_TOOL_IDS.moveKanbanTask,
  {
    description:
      "Move a devTASK or aiTASK between kanban columns. Validates that the task exists in the source column before moving.",
    parameters: MoveTaskParams,
    async execute(params, _ctx) {
      const runId = generateToolRunId()
      const errors: string[] = []
      const warnings: string[] = []
      const changes: AfwkToolOutput["changes"] = []

      // Verificar si .afwk esta inicializado
      const initialized = await isInitialized()
      if (!initialized) {
        const output: AfwkToolOutput = {
          ok: false,
          tool_run_id: runId,
          entity_refs: { devTaskId: params.taskId },
          changes: [],
          warnings: [],
          errors: ["aiFRAMEWORK not initialized. Run initialization first."],
        }

        await appendToAuditLog({
          tool_run_id: runId,
          timestamp: new Date().toISOString(),
          tool: AFWK_TOOL_IDS.moveKanbanTask,
          input: params,
          output_ok: false,
          changes: [],
          errors: output.errors,
          entity_refs: output.entity_refs,
        })

        return {
          title: params.taskId,
          output: JSON.stringify({ error: "Not initialized", taskId: params.taskId }),
          metadata: { afwk: output },
        }
      }

      // Validar que from y to son diferentes
      if (params.from === params.to) {
        errors.push(`Task is already in ${params.to}`)

        const output: AfwkToolOutput = {
          ok: false,
          tool_run_id: runId,
          entity_refs: { devTaskId: params.taskId },
          changes: [],
          warnings,
          errors,
        }

        await appendToAuditLog({
          tool_run_id: runId,
          timestamp: new Date().toISOString(),
          tool: AFWK_TOOL_IDS.moveKanbanTask,
          input: params,
          output_ok: false,
          changes: [],
          errors,
          entity_refs: output.entity_refs,
        })

        return {
          title: params.taskId,
          output: `Error: ${errors.join(", ")}`,
          metadata: { afwk: output },
        }
      }

      // Verificar que la tarea existe en la columna origen
      const existsInFrom = await taskExistsInColumn(params.taskId, params.from)
      if (!existsInFrom) {
        // Buscar en que columna esta realmente
        const actualColumn = await findTaskColumn(params.taskId)
        if (actualColumn) {
          errors.push(`Task ${params.taskId} is not in ${params.from}, it's in ${actualColumn}`)
        } else {
          errors.push(`Task ${params.taskId} not found in any column`)
        }

        const output: AfwkToolOutput = {
          ok: false,
          tool_run_id: runId,
          entity_refs: { devTaskId: params.taskId },
          changes: [],
          warnings,
          errors,
        }

        await appendToAuditLog({
          tool_run_id: runId,
          timestamp: new Date().toISOString(),
          tool: AFWK_TOOL_IDS.moveKanbanTask,
          input: params,
          output_ok: false,
          changes: [],
          errors,
          entity_refs: output.entity_refs,
        })

        return {
          title: params.taskId,
          output: `Error: ${errors.join(", ")}`,
          metadata: { afwk: output },
        }
      }

      // Validar transicion usando rules engine
      const fromPath = path.join(getColumnDir(params.from), params.taskId)
      const transitionResult = await validateTransition(fromPath, params.from, params.to)

      if (!transitionResult.valid) {
        // Add violations as errors
        for (const violation of transitionResult.violations) {
          errors.push(violation.message)
          if (violation.details) {
            warnings.push(violation.details)
          }
        }

        // Add requirements hint
        const requirements = await getTransitionRequirements(params.from, params.to)
        if (requirements.length > 0) {
          warnings.push(`Requirements for ${params.from} → ${params.to}: ${requirements.join("; ")}`)
        }

        const output: AfwkToolOutput = {
          ok: false,
          tool_run_id: runId,
          entity_refs: { devTaskId: params.taskId },
          changes: [],
          warnings,
          errors,
        }

        await appendToAuditLog({
          tool_run_id: runId,
          timestamp: new Date().toISOString(),
          tool: AFWK_TOOL_IDS.moveKanbanTask,
          input: params,
          output_ok: false,
          changes: [],
          errors,
          entity_refs: output.entity_refs,
        })

        return {
          title: params.taskId,
          output: `Transition blocked: ${errors.join("; ")}`,
          metadata: { afwk: output },
        }
      }

      // Mover la tarea
      const toPath = path.join(getColumnDir(params.to), params.taskId)

      try {
        // Asegurar que el directorio destino existe
        await fs.mkdir(getColumnDir(params.to), { recursive: true })

        // Mover el directorio
        await fs.rename(fromPath, toPath)

        changes.push({
          path: toRelativePath(toPath),
          type: "move",
          summary: `Moved ${params.taskId} from ${params.from} to ${params.to}`,
        })
      } catch (err) {
        errors.push(`Failed to move task: ${err}`)

        const output: AfwkToolOutput = {
          ok: false,
          tool_run_id: runId,
          entity_refs: { devTaskId: params.taskId },
          changes: [],
          warnings,
          errors,
        }

        await appendToAuditLog({
          tool_run_id: runId,
          timestamp: new Date().toISOString(),
          tool: AFWK_TOOL_IDS.moveKanbanTask,
          input: params,
          output_ok: false,
          changes: [],
          errors,
          entity_refs: output.entity_refs,
        })

        return {
          title: params.taskId,
          output: `Error: ${errors.join(", ")}`,
          metadata: { afwk: output },
        }
      }

      const output: AfwkToolOutput = {
        ok: true,
        tool_run_id: runId,
        entity_refs: { devTaskId: params.taskId },
        changes,
        warnings,
        errors,
      }

      await appendToAuditLog({
        tool_run_id: runId,
        timestamp: new Date().toISOString(),
        tool: AFWK_TOOL_IDS.moveKanbanTask,
        input: params,
        output_ok: true,
        changes,
        errors,
        entity_refs: output.entity_refs,
      })

      return {
        title: params.taskId,
        output: `Successfully moved ${params.taskId} from ${params.from} to ${params.to}`,
        metadata: { afwk: output },
      }
    },
  },
)

// ============================================================================
// Helper functions for content creation
// ============================================================================

/**
 * Genera un slug a partir de un titulo
 * Convierte a kebab-case, max 30 caracteres
 */
function generateSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 30)
    .replace(/-$/, "")
}

/**
 * Obtiene el siguiente ID para un devTASK
 * Escanea el backlog para encontrar el maximo XX y retorna XX+1
 */
async function getNextDevTaskId(): Promise<string> {
  const tasks: string[] = []
  for (const column of KANBAN_COLUMNS) {
    const columnTasks = await listTasksInColumn(column)
    tasks.push(...columnTasks.filter((t) => t.toLowerCase().startsWith("devtask-")))
  }

  let maxId = 0
  for (const task of tasks) {
    const match = task.match(/^devTASK-(\d{2})/i)
    if (match) {
      const id = parseInt(match[1], 10)
      if (id > maxId) maxId = id
    }
  }

  return String(maxId + 1).padStart(2, "0")
}

/**
 * Obtiene el siguiente ID para un aiTASK dentro de un devTASK
 */
async function getNextAiTaskId(devTaskPath: string): Promise<string> {
  try {
    const entries = await fs.readdir(devTaskPath)
    let maxId = 0
    for (const entry of entries) {
      const match = entry.match(/^aiTASK-(\d{2})/i)
      if (match) {
        const id = parseInt(match[1], 10)
        if (id > maxId) maxId = id
      }
    }
    return String(maxId + 1).padStart(2, "0")
  } catch {
    return "01"
  }
}

/**
 * Encuentra la ruta completa de un devTASK buscando en todas las columnas
 */
async function findDevTaskPath(taskId: string): Promise<{ column: KanbanColumn; path: string } | null> {
  for (const column of KANBAN_COLUMNS) {
    const taskPath = path.join(getColumnDir(column), taskId)
    try {
      const stats = await fs.stat(taskPath)
      if (stats.isDirectory()) {
        return { column, path: taskPath }
      }
    } catch {
      continue
    }
  }
  return null
}

/**
 * Encuentra un aiTASK buscando en todos los devTASKs
 */
async function findAiTaskPath(
  aiTaskId: string
): Promise<{ devTaskId: string; column: KanbanColumn; devTaskPath: string; aiTaskPath: string } | null> {
  for (const column of KANBAN_COLUMNS) {
    const columnDir = getColumnDir(column)
    try {
      const devTasks = await fs.readdir(columnDir, { withFileTypes: true })
      for (const devTask of devTasks) {
        if (!devTask.isDirectory() || !devTask.name.toLowerCase().startsWith("devtask-")) continue
        const devTaskPath = path.join(columnDir, devTask.name)
        const aiTaskPath = path.join(devTaskPath, `${aiTaskId}.md`)
        try {
          await fs.stat(aiTaskPath)
          return { devTaskId: devTask.name, column, devTaskPath, aiTaskPath }
        } catch {
          continue
        }
      }
    } catch {
      continue
    }
  }
  return null
}

// ============================================================================
// TOOL: afwk_create_devtask
// ============================================================================

const CreateDevTaskParams = z.object({
  title: z.string().min(3).describe("Title for the devTASK (e.g., 'Login Implementation')"),
  description: z.string().min(10).describe("Description of what this task accomplishes"),
  estimatedTimeHr: z
    .number()
    .positive()
    .optional()
    .describe("REQUIRED: Estimated time in hours to complete this task. Always provide this value."),
  scope: z
    .string()
    .optional()
    .describe("REQUIRED: Full scope including problem description, expected outcome, and proposed route. Always provide this value."),
  steps: z
    .array(z.string())
    .optional()
    .describe("REQUIRED: Preliminary implementation steps as an array of strings. Always provide at least 2-3 steps."),
  content: z
    .string()
    .optional()
    .describe(
      "Full markdown content for overview.md. If provided, uses this content directly instead of template. " +
        "Should follow the structure from .afwk/templates/overview.md (Objetivo, Alcance, Criterios de Exito, etc.)"
    ),
})

interface CreateDevTaskMetadata {
  afwk: AfwkToolOutput | StagingToolOutput
  taskId?: string
}

export const AfwkCreateDevTaskTool = Tool.define<typeof CreateDevTaskParams, CreateDevTaskMetadata>(
  AFWK_TOOL_IDS.createDevTask,
  {
    description:
      "Create a new devTASK in the backlog. IMPORTANT: Always provide estimatedTimeHr, scope, and steps - these are required for proper task tracking. The scope should include problem description, expected outcome, and proposed route.",
    parameters: CreateDevTaskParams,
    async execute(params, _ctx) {
      const runId = generateToolRunId()
      const errors: string[] = []
      const warnings: string[] = []
      const changes: AfwkToolOutput["changes"] = []

      // Verificar inicializacion
      const initialized = await isInitialized()
      if (!initialized) {
        const output: AfwkToolOutput = {
          ok: false,
          tool_run_id: runId,
          changes: [],
          warnings: [],
          errors: ["aiFRAMEWORK not initialized. Run initialization first."],
        }

        await appendToAuditLog({
          tool_run_id: runId,
          timestamp: new Date().toISOString(),
          tool: AFWK_TOOL_IDS.createDevTask,
          input: params,
          output_ok: false,
          changes: [],
          errors: output.errors,
        })

        return {
          title: "Create DevTask",
          output: JSON.stringify({ error: "Not initialized" }),
          metadata: { afwk: output },
        }
      }

      // Generar ID y slug
      const taskNum = await getNextDevTaskId()
      const slug = generateSlug(params.title)
      const taskId = `devTASK-${taskNum}_${slug}`
      const taskDir = path.join(getColumnDir("backlog"), taskId)

      try {
        // Crear directorio de la tarea
        await fs.mkdir(taskDir, { recursive: true })
        changes.push({
          path: toRelativePath(taskDir),
          type: "create",
          summary: `Created devTASK folder: ${taskId}`,
        })

        // Crear devTASK.json con metadata
        const metadata = {
          id: taskId,
          title: params.title,
          description: params.description,
          estimatedTimeHr: params.estimatedTimeHr ?? null,
          scope: params.scope ?? null,
          steps: params.steps ?? [],
          status: "backlog",
          source: "local", // Placeholder until dipole.work API is ready
          remoteIdentifier: null, // Will be populated when synced with dipole.work
          created_at: new Date().toISOString(),
          aitasks: [],
        }
        const metadataPath = path.join(taskDir, "devTASK.json")
        await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2), "utf-8")
        changes.push({
          path: toRelativePath(metadataPath),
          type: "create",
          summary: "Created devTASK.json metadata",
        })

        // Crear overview.md - usar content si se proporciona, sino template
        const overviewContent = params.content
          ? params.content
          : await loadTemplate("overview", {
              title: params.title,
              description: params.description,
              devTaskId: taskId,
            })
        const overviewRelPath = `kanban/backlog/${taskId}/overview.md`
        const overviewPath = path.join(taskDir, "overview.md")
        const hasContent = !!params.content

        // When content is provided: write directly and open in editor (no staging)
        // When template: use staging for user to fill placeholders
        if (hasContent) {
          // Direct write with provided content
          await fs.writeFile(overviewPath, overviewContent, "utf-8")
          changes.push({
            path: toRelativePath(overviewPath),
            type: "create",
            summary: "Created overview.md with provided content",
          })

          const output: AfwkToolOutput = {
            ok: true,
            tool_run_id: runId,
            entity_refs: { devTaskId: taskId },
            changes,
            warnings,
            errors,
          }

          await appendToAuditLog({
            tool_run_id: runId,
            timestamp: new Date().toISOString(),
            tool: AFWK_TOOL_IDS.createDevTask,
            input: params,
            output_ok: true,
            changes,
            errors,
            entity_refs: output.entity_refs,
          })

          // Emit event to open file in editor
          Bus.publish(TuiEvent.FileOpen, {
            filePath: `.afwk/${overviewRelPath}`,
            reason: `devTASK ${taskId} created`,
          })

          return {
            title: taskId,
            output: `✅ Created ${taskId} in backlog

📁 Files created:
- .afwk/kanban/backlog/${taskId}/
- .afwk/kanban/backlog/${taskId}/devTASK.json
- .afwk/kanban/backlog/${taskId}/overview.md

📝 The document has been opened in dipoleSTUDIO for your review.
You can edit it directly if needed.`,
            metadata: { afwk: output, taskId },
          }
        }

        // Template mode: use staging if enabled
        if (isStagingEnabled()) {
          const stagingResult = await stageDocument({
            toolRunId: runId,
            toolName: AFWK_TOOL_IDS.createDevTask,
            content: overviewContent,
            finalPath: overviewRelPath,
            documentType: "devtask-overview",
            entityRefs: { devTaskId: taskId },
          })

          const output: StagingToolOutput = {
            ok: true,
            tool_run_id: runId,
            entity_refs: { devTaskId: taskId },
            changes,
            warnings: ["Document staged for review - awaiting user confirmation"],
            errors,
            staging: {
              stagingId: stagingResult.stagingId,
              awaitingReview: true,
              stagedPath: stagingResult.stagedPath,
              finalPath: stagingResult.finalPath,
              expiresAt: stagingResult.expiresAt,
            },
          }

          await appendToAuditLog({
            tool_run_id: runId,
            timestamp: new Date().toISOString(),
            tool: AFWK_TOOL_IDS.createDevTask,
            input: params,
            output_ok: true,
            changes,
            errors,
            entity_refs: output.entity_refs,
          })

          return {
            title: taskId,
            output: `✅ Created ${taskId} structure in backlog

📁 Files created:
- kanban/backlog/${taskId}/
- kanban/backlog/${taskId}/devTASK.json

📝 **Awaiting Review**: overview.md has been staged for your review.
- Staged at: .afwk/${stagingResult.stagedPath}
- Final location: .afwk/${overviewRelPath}

⚠️ **Template mode**: The overview.md has \`<!-- FILL: ... -->\` sections that need content.
Complete the sections or use the \`content\` parameter to provide complete content.`,
            metadata: { afwk: output, taskId, staging: output.staging },
          }
        }

        // Direct write with template (staging disabled)
        await fs.writeFile(overviewPath, overviewContent, "utf-8")
        changes.push({
          path: toRelativePath(overviewPath),
          type: "create",
          summary: "Created overview.md from template",
        })
      } catch (err) {
        errors.push(`Failed to create devTASK: ${err}`)
        const output: AfwkToolOutput = {
          ok: false,
          tool_run_id: runId,
          entity_refs: { devTaskId: taskId },
          changes,
          warnings,
          errors,
        }

        await appendToAuditLog({
          tool_run_id: runId,
          timestamp: new Date().toISOString(),
          tool: AFWK_TOOL_IDS.createDevTask,
          input: params,
          output_ok: false,
          changes,
          errors,
          entity_refs: output.entity_refs,
        })

        return {
          title: taskId,
          output: `Error: ${errors.join(", ")}`,
          metadata: { afwk: output, taskId },
        }
      }

      const output: AfwkToolOutput = {
        ok: true,
        tool_run_id: runId,
        entity_refs: { devTaskId: taskId },
        changes,
        warnings,
        errors,
      }

      await appendToAuditLog({
        tool_run_id: runId,
        timestamp: new Date().toISOString(),
        tool: AFWK_TOOL_IDS.createDevTask,
        input: params,
        output_ok: true,
        changes,
        errors,
        entity_refs: output.entity_refs,
      })

      // Build paths for output message
      const overviewRelPath = `kanban/backlog/${taskId}/overview.md`
      const metadataRelPath = `kanban/backlog/${taskId}/devTASK.json`

      // Check if we used template (content not provided)
      const usedTemplateNoStaging = !params.content

      const outputMessageNoStaging = usedTemplateNoStaging
        ? `✅ Created ${taskId} in backlog

📁 Files created:
- kanban/backlog/${taskId}/
- ${metadataRelPath}
- ${overviewRelPath}

📝 **Action Required**: Complete the template sections in overview.md

The overview.md has \`<!-- FILL: ... -->\` sections that need content.
To complete: Read the file at \`.afwk/${overviewRelPath}\`, generate content for each FILL section, then use \`afwk_update_document\` with the full updated content.`
        : `✅ Created ${taskId} in backlog

📁 Files created:
- kanban/backlog/${taskId}/
- ${metadataRelPath}
- ${overviewRelPath}

The devTASK has been created with your provided content.`

      return {
        title: taskId,
        output: outputMessageNoStaging,
        metadata: {
          afwk: output,
          taskId,
          needsCompletion: usedTemplateNoStaging,
          documentPath: overviewRelPath,
        },
      }
    },
  },
)

// ============================================================================
// TOOL: afwk_create_aitask
// ============================================================================

const CreateAiTaskParams = z.object({
  devTaskId: z.string().describe("Parent devTASK ID (e.g., 'devTASK-01_login')"),
  title: z.string().min(3).describe("Title for this aiTASK iteration"),
  objective: z.string().min(10).describe("Objective for this specific iteration"),
  content: z
    .string()
    .optional()
    .describe(
      "Full markdown content for the aiTASK blueprint. If provided, uses this content directly instead of template. " +
        "Should follow the structure from .afwk/templates/aitask-blueprint.md"
    ),
})

interface CreateAiTaskMetadata {
  afwk: AfwkToolOutput | StagingToolOutput
  aiTaskId?: string
}

export const AfwkCreateAiTaskTool = Tool.define<typeof CreateAiTaskParams, CreateAiTaskMetadata>(
  AFWK_TOOL_IDS.createAiTask,
  {
    description:
      "Create a new aiTASK blueprint within a devTASK. Creates the aiTASK markdown file from template.",
    parameters: CreateAiTaskParams,
    async execute(params, _ctx) {
      const runId = generateToolRunId()
      const errors: string[] = []
      const warnings: string[] = []
      const changes: AfwkToolOutput["changes"] = []

      // Verificar inicializacion
      const initialized = await isInitialized()
      if (!initialized) {
        const output: AfwkToolOutput = {
          ok: false,
          tool_run_id: runId,
          changes: [],
          warnings: [],
          errors: ["aiFRAMEWORK not initialized. Run initialization first."],
        }

        await appendToAuditLog({
          tool_run_id: runId,
          timestamp: new Date().toISOString(),
          tool: AFWK_TOOL_IDS.createAiTask,
          input: params,
          output_ok: false,
          changes: [],
          errors: output.errors,
        })

        return {
          title: "Create AiTask",
          output: JSON.stringify({ error: "Not initialized" }),
          metadata: { afwk: output },
        }
      }

      // Encontrar el devTASK
      const devTaskInfo = await findDevTaskPath(params.devTaskId)
      if (!devTaskInfo) {
        errors.push(`devTASK ${params.devTaskId} not found in any column`)
        const output: AfwkToolOutput = {
          ok: false,
          tool_run_id: runId,
          entity_refs: { devTaskId: params.devTaskId },
          changes: [],
          warnings,
          errors,
        }

        await appendToAuditLog({
          tool_run_id: runId,
          timestamp: new Date().toISOString(),
          tool: AFWK_TOOL_IDS.createAiTask,
          input: params,
          output_ok: false,
          changes: [],
          errors,
          entity_refs: output.entity_refs,
        })

        return {
          title: "Create AiTask",
          output: `Error: ${errors.join(", ")}`,
          metadata: { afwk: output },
        }
      }

      // Generar ID y slug
      const taskNum = await getNextAiTaskId(devTaskInfo.path)
      const slug = generateSlug(params.title)
      const aiTaskId = `aiTASK-${taskNum}_${slug}`

      try {
        // Crear aiTASK.md - usar content si se proporciona, sino template
        const aiTaskContent = params.content
          ? params.content
          : await loadTemplate("aitask-blueprint", {
              title: params.title,
              aiTaskId,
              devTaskId: params.devTaskId,
              objective: params.objective,
            })
        const aiTaskRelPath = `kanban/${devTaskInfo.column}/${params.devTaskId}/${aiTaskId}.md`
        const aiTaskPath = path.join(devTaskInfo.path, `${aiTaskId}.md`)
        const hasContent = !!params.content

        // Helper to update devTASK.json metadata
        const updateDevTaskMetadata = async () => {
          const metadataPath = path.join(devTaskInfo.path, "devTASK.json")
          try {
            const metadataContent = await fs.readFile(metadataPath, "utf-8")
            const metadata = JSON.parse(metadataContent)
            if (!Array.isArray(metadata.aitasks)) {
              metadata.aitasks = []
            }
            metadata.aitasks.push(aiTaskId)
            await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2), "utf-8")
            changes.push({
              path: toRelativePath(metadataPath),
              type: "update",
              summary: `Added ${aiTaskId} to devTASK.json`,
            })
          } catch {
            warnings.push("Could not update devTASK.json (file may not exist)")
          }
        }

        // When content is provided: write directly and open in editor (no staging)
        if (hasContent) {
          // Direct write with provided content
          await fs.writeFile(aiTaskPath, aiTaskContent, "utf-8")
          changes.push({
            path: toRelativePath(aiTaskPath),
            type: "create",
            summary: `Created aiTASK blueprint: ${aiTaskId}`,
          })

          // Update devTASK.json
          await updateDevTaskMetadata()

          const output: AfwkToolOutput = {
            ok: true,
            tool_run_id: runId,
            entity_refs: { devTaskId: params.devTaskId, aiTaskId },
            changes,
            warnings,
            errors,
          }

          await appendToAuditLog({
            tool_run_id: runId,
            timestamp: new Date().toISOString(),
            tool: AFWK_TOOL_IDS.createAiTask,
            input: params,
            output_ok: true,
            changes,
            errors,
            entity_refs: output.entity_refs,
          })

          // Emit event to open file in editor
          Bus.publish(TuiEvent.FileOpen, {
            filePath: `.afwk/${aiTaskRelPath}`,
            reason: `aiTASK ${aiTaskId} created`,
          })

          return {
            title: aiTaskId,
            output: `✅ Created ${aiTaskId} in ${params.devTaskId}

📁 Files created:
- .afwk/${aiTaskRelPath}

📝 The blueprint has been opened in dipoleSTUDIO for your review.
You can edit it directly if needed.`,
            metadata: { afwk: output, aiTaskId },
          }
        }

        // Template mode: use staging if enabled
        if (isStagingEnabled()) {
          // Update devTASK.json first (this is metadata, not staged)
          await updateDevTaskMetadata()

          const stagingResult = await stageDocument({
            toolRunId: runId,
            toolName: AFWK_TOOL_IDS.createAiTask,
            content: aiTaskContent,
            finalPath: aiTaskRelPath,
            documentType: "aitask-blueprint",
            entityRefs: { devTaskId: params.devTaskId, aiTaskId },
          })

          const output: StagingToolOutput = {
            ok: true,
            tool_run_id: runId,
            entity_refs: { devTaskId: params.devTaskId, aiTaskId },
            changes,
            warnings: ["Document staged for review - awaiting user confirmation"],
            errors,
            staging: {
              stagingId: stagingResult.stagingId,
              awaitingReview: true,
              stagedPath: stagingResult.stagedPath,
              finalPath: stagingResult.finalPath,
              expiresAt: stagingResult.expiresAt,
            },
          }

          await appendToAuditLog({
            tool_run_id: runId,
            timestamp: new Date().toISOString(),
            tool: AFWK_TOOL_IDS.createAiTask,
            input: params,
            output_ok: true,
            changes,
            errors,
            entity_refs: output.entity_refs,
          })

          return {
            title: aiTaskId,
            output: `✅ Created ${aiTaskId} in ${params.devTaskId}

📝 **Awaiting Review**: ${aiTaskId}.md has been staged for your review.
- Staged at: .afwk/${stagingResult.stagedPath}
- Final location: .afwk/${aiTaskRelPath}

⚠️ **Template mode**: The blueprint has \`<!-- FILL: ... -->\` sections that need content.
Complete the sections or use the \`content\` parameter to provide complete content.`,
            metadata: { afwk: output, aiTaskId, staging: output.staging },
          }
        }

        // Direct write with template (staging disabled)
        await fs.writeFile(aiTaskPath, aiTaskContent, "utf-8")
        changes.push({
          path: toRelativePath(aiTaskPath),
          type: "create",
          summary: `Created aiTASK blueprint: ${aiTaskId}`,
        })

        // Actualizar devTASK.json
        await updateDevTaskMetadata()
      } catch (err) {
        errors.push(`Failed to create aiTASK: ${err}`)
        const output: AfwkToolOutput = {
          ok: false,
          tool_run_id: runId,
          entity_refs: { devTaskId: params.devTaskId, aiTaskId },
          changes,
          warnings,
          errors,
        }

        await appendToAuditLog({
          tool_run_id: runId,
          timestamp: new Date().toISOString(),
          tool: AFWK_TOOL_IDS.createAiTask,
          input: params,
          output_ok: false,
          changes,
          errors,
          entity_refs: output.entity_refs,
        })

        return {
          title: aiTaskId,
          output: `Error: ${errors.join(", ")}`,
          metadata: { afwk: output, aiTaskId },
        }
      }

      const output: AfwkToolOutput = {
        ok: true,
        tool_run_id: runId,
        entity_refs: { devTaskId: params.devTaskId, aiTaskId },
        changes,
        warnings,
        errors,
      }

      await appendToAuditLog({
        tool_run_id: runId,
        timestamp: new Date().toISOString(),
        tool: AFWK_TOOL_IDS.createAiTask,
        input: params,
        output_ok: true,
        changes,
        errors,
        entity_refs: output.entity_refs,
      })

      // Build path for output message
      const aiTaskRelPathFinal = `kanban/${devTaskInfo.column}/${params.devTaskId}/${aiTaskId}.md`

      // Check if we used template (content not provided)
      const usedTemplate = !params.content

      const outputMessage = usedTemplate
        ? `✅ Created ${aiTaskId} in ${params.devTaskId}

📁 Files created:
- .afwk/${aiTaskRelPathFinal}

📝 **Action Required**: Complete the template sections in ${aiTaskId}.md

The blueprint has \`<!-- FILL: ... -->\` sections that need content.
To complete: Read the file, generate content for each FILL section, then use \`afwk_update_document\`.`
        : `✅ Created ${aiTaskId} in ${params.devTaskId}

📁 Files created:
- .afwk/${aiTaskRelPathFinal}

The aiTASK blueprint has been created with your provided content.`

      return {
        title: aiTaskId,
        output: outputMessage,
        metadata: { afwk: output, aiTaskId, needsCompletion: usedTemplate, documentPath: aiTaskRelPathFinal },
      }
    },
  },
)

// ============================================================================
// TOOL: afwk_complete_aitask
// ============================================================================

const CompleteAiTaskParams = z.object({
  aiTaskId: z.string().describe("The aiTASK ID to complete (e.g., 'aiTASK-01_setup-db')"),
  notes: z.string().min(10).describe("Completion notes describing what was accomplished"),
  content: z
    .string()
    .optional()
    .describe(
      "Full markdown content for completion-notes.md. If provided, uses this content directly instead of template. Use complete-aitask skill to generate this content.",
    ),
})

interface CompleteAiTaskMetadata {
  afwk: AfwkToolOutput | StagingToolOutput
}

export const AfwkCompleteAiTaskTool = Tool.define<typeof CompleteAiTaskParams, CompleteAiTaskMetadata>(
  AFWK_TOOL_IDS.completeAiTask,
  {
    description:
      "Add completion notes to an aiTASK. Creates the completion notes markdown file from template and queues an action to update latest-implementation.md.",
    parameters: CompleteAiTaskParams,
    async execute(params, _ctx) {
      const runId = generateToolRunId()
      const errors: string[] = []
      const warnings: string[] = []
      const changes: AfwkToolOutput["changes"] = []

      // Verificar inicializacion
      const initialized = await isInitialized()
      if (!initialized) {
        const output: AfwkToolOutput = {
          ok: false,
          tool_run_id: runId,
          changes: [],
          warnings: [],
          errors: ["aiFRAMEWORK not initialized. Run initialization first."],
        }

        await appendToAuditLog({
          tool_run_id: runId,
          timestamp: new Date().toISOString(),
          tool: AFWK_TOOL_IDS.completeAiTask,
          input: params,
          output_ok: false,
          changes: [],
          errors: output.errors,
        })

        return {
          title: "Complete AiTask",
          output: JSON.stringify({ error: "Not initialized" }),
          metadata: { afwk: output },
        }
      }

      // Encontrar el aiTASK
      const aiTaskInfo = await findAiTaskPath(params.aiTaskId)
      if (!aiTaskInfo) {
        errors.push(`aiTASK ${params.aiTaskId} not found`)
        const output: AfwkToolOutput = {
          ok: false,
          tool_run_id: runId,
          entity_refs: { aiTaskId: params.aiTaskId },
          changes: [],
          warnings,
          errors,
        }

        await appendToAuditLog({
          tool_run_id: runId,
          timestamp: new Date().toISOString(),
          tool: AFWK_TOOL_IDS.completeAiTask,
          input: params,
          output_ok: false,
          changes: [],
          errors,
          entity_refs: output.entity_refs,
        })

        return {
          title: "Complete AiTask",
          output: `Error: ${errors.join(", ")}`,
          metadata: { afwk: output },
        }
      }

      // Verificar que no tiene completion notes ya
      const completionNotesPath = path.join(aiTaskInfo.devTaskPath, `${params.aiTaskId}_completion-notes.md`)
      try {
        await fs.stat(completionNotesPath)
        errors.push(`aiTASK ${params.aiTaskId} already has completion notes`)
        const output: AfwkToolOutput = {
          ok: false,
          tool_run_id: runId,
          entity_refs: { devTaskId: aiTaskInfo.devTaskId, aiTaskId: params.aiTaskId },
          changes: [],
          warnings,
          errors,
        }

        await appendToAuditLog({
          tool_run_id: runId,
          timestamp: new Date().toISOString(),
          tool: AFWK_TOOL_IDS.completeAiTask,
          input: params,
          output_ok: false,
          changes: [],
          errors,
          entity_refs: output.entity_refs,
        })

        return {
          title: params.aiTaskId,
          output: `Error: ${errors.join(", ")}`,
          metadata: { afwk: output },
        }
      } catch {
        // File doesn't exist - good, we can create it
      }

      const completionNotesRelPath = `kanban/${aiTaskInfo.column}/${aiTaskInfo.devTaskId}/${params.aiTaskId}_completion-notes.md`
      const completionContent = params.content?.trim()
      const hasContent = completionContent && completionContent.length > 0

      // If content is provided, write directly and open in editor (no staging)
      if (hasContent) {
        try {
          await fs.writeFile(completionNotesPath, completionContent, "utf-8")
          changes.push({
            path: toRelativePath(completionNotesPath),
            type: "create",
            summary: `Created completion notes for ${params.aiTaskId}`,
          })

          // Encolar pending action para update_latest_implementation
          await enqueuePendingAction({
            id: `pa_${runId}`,
            type: "update_latest_implementation",
            context: {
              devTaskId: aiTaskInfo.devTaskId,
              aiTaskId: params.aiTaskId,
              triggered_by_tool_run: runId,
            },
            created_at: new Date().toISOString(),
            status: "pending",
          })

          await appendToAuditLog({
            tool_run_id: runId,
            timestamp: new Date().toISOString(),
            tool: AFWK_TOOL_IDS.completeAiTask,
            input: { ...params, content: "[content provided]" },
            output_ok: true,
            changes,
            errors,
            entity_refs: { devTaskId: aiTaskInfo.devTaskId, aiTaskId: params.aiTaskId },
          })

          // Emit FileOpen event to open in editor
          Bus.publish(TuiEvent.FileOpen, {
            filePath: `.afwk/${completionNotesRelPath}`,
            reason: `Completion notes for ${params.aiTaskId} created`,
          })

          const output: AfwkToolOutput = {
            ok: true,
            tool_run_id: runId,
            entity_refs: { devTaskId: aiTaskInfo.devTaskId, aiTaskId: params.aiTaskId },
            changes,
            warnings: ["Pending action queued: update_latest_implementation"],
            errors,
          }

          return {
            title: params.aiTaskId,
            output: `✅ Completed ${params.aiTaskId}

📁 Completion notes created and opened in dipoleSTUDIO.
📄 Location: .afwk/${completionNotesRelPath}

You can edit the file directly if adjustments are needed.

⚠️ Pending action: Run afwk_update_latest_implementation to update steering docs.`,
            metadata: { afwk: output },
          }
        } catch (err) {
          errors.push(`Failed to write completion notes: ${err}`)
          const output: AfwkToolOutput = {
            ok: false,
            tool_run_id: runId,
            entity_refs: { devTaskId: aiTaskInfo.devTaskId, aiTaskId: params.aiTaskId },
            changes,
            warnings,
            errors,
          }
          return {
            title: params.aiTaskId,
            output: `Error: ${errors.join(", ")}`,
            metadata: { afwk: output },
          }
        }
      }

      try {
        // Crear completion notes desde template (legacy flow)
        const completionContent = await loadTemplate("completion-notes", {
          aiTaskId: params.aiTaskId,
          notes: params.notes,
        })

        // Use staging if enabled
        if (isStagingEnabled()) {
          const stagingResult = await stageDocument({
            toolRunId: runId,
            toolName: AFWK_TOOL_IDS.completeAiTask,
            content: completionContent,
            finalPath: completionNotesRelPath,
            documentType: "completion-notes",
            entityRefs: { devTaskId: aiTaskInfo.devTaskId, aiTaskId: params.aiTaskId },
          })

          // Encolar pending action para update_latest_implementation
          await enqueuePendingAction({
            id: `pa_${runId}`,
            type: "update_latest_implementation",
            context: {
              devTaskId: aiTaskInfo.devTaskId,
              aiTaskId: params.aiTaskId,
              triggered_by_tool_run: runId,
            },
            created_at: new Date().toISOString(),
            status: "pending",
          })

          const output: StagingToolOutput = {
            ok: true,
            tool_run_id: runId,
            entity_refs: { devTaskId: aiTaskInfo.devTaskId, aiTaskId: params.aiTaskId },
            changes,
            warnings: [
              "Document staged for review - awaiting user confirmation",
              "Pending action queued: update_latest_implementation",
            ],
            errors,
            staging: {
              stagingId: stagingResult.stagingId,
              awaitingReview: true,
              stagedPath: stagingResult.stagedPath,
              finalPath: stagingResult.finalPath,
              expiresAt: stagingResult.expiresAt,
            },
          }

          await appendToAuditLog({
            tool_run_id: runId,
            timestamp: new Date().toISOString(),
            tool: AFWK_TOOL_IDS.completeAiTask,
            input: params,
            output_ok: true,
            changes,
            errors,
            entity_refs: output.entity_refs,
          })

          return {
            title: params.aiTaskId,
            output: `✅ Completing ${params.aiTaskId}

📝 **Awaiting Review**: Completion notes have been staged for your review.
- Staged at: .afwk/${stagingResult.stagedPath}
- Final location: .afwk/${completionNotesRelPath}

The file should open in your editor. Review and edit as needed, then click Confirm to save or Cancel to discard.

The completion notes have \`<!-- FILL: ... -->\` sections that need content:
1. **Resumen de Implementacion** - Summarize what was implemented.
2. **Cambios Realizados** - List files that were modified.
3. **Lecciones Aprendidas** - Extract useful insights.

⚠️ Pending action queued: update_latest_implementation (run afwk_update_latest_implementation when ready)`,
            metadata: { afwk: output, staging: output.staging },
          }
        }

        // Direct write (staging disabled)
        await fs.writeFile(completionNotesPath, completionContent, "utf-8")
        changes.push({
          path: toRelativePath(completionNotesPath),
          type: "create",
          summary: `Created completion notes for ${params.aiTaskId}`,
        })

        // Encolar pending action para update_latest_implementation
        await enqueuePendingAction({
          id: `pa_${runId}`,
          type: "update_latest_implementation",
          context: {
            devTaskId: aiTaskInfo.devTaskId,
            aiTaskId: params.aiTaskId,
            triggered_by_tool_run: runId,
          },
          created_at: new Date().toISOString(),
          status: "pending",
        })
        warnings.push("Pending action queued: update_latest_implementation")
      } catch (err) {
        errors.push(`Failed to complete aiTASK: ${err}`)
        const output: AfwkToolOutput = {
          ok: false,
          tool_run_id: runId,
          entity_refs: { devTaskId: aiTaskInfo.devTaskId, aiTaskId: params.aiTaskId },
          changes,
          warnings,
          errors,
        }

        await appendToAuditLog({
          tool_run_id: runId,
          timestamp: new Date().toISOString(),
          tool: AFWK_TOOL_IDS.completeAiTask,
          input: params,
          output_ok: false,
          changes,
          errors,
          entity_refs: output.entity_refs,
        })

        return {
          title: params.aiTaskId,
          output: `Error: ${errors.join(", ")}`,
          metadata: { afwk: output },
        }
      }

      const output: AfwkToolOutput = {
        ok: true,
        tool_run_id: runId,
        entity_refs: { devTaskId: aiTaskInfo.devTaskId, aiTaskId: params.aiTaskId },
        changes,
        warnings,
        errors,
      }

      await appendToAuditLog({
        tool_run_id: runId,
        timestamp: new Date().toISOString(),
        tool: AFWK_TOOL_IDS.completeAiTask,
        input: params,
        output_ok: true,
        changes,
        errors,
        entity_refs: output.entity_refs,
      })

      return {
        title: params.aiTaskId,
        output: `✅ Completed ${params.aiTaskId}

📁 Files created:
- ${toRelativePath(completionNotesPath)}

📝 **Action Required**: Complete the template sections in completion notes.

The completion notes have \`<!-- FILL: ... -->\` sections that need content:
1. **Resumen de Implementacion** - Summarize what was implemented.
2. **Cambios Realizados** - List files that were modified.
3. **Lecciones Aprendidas** - Extract useful insights.

To complete: Read the file at \`.afwk/${completionNotesRelPath}\`, generate content for each FILL section based on the notes provided and your knowledge of the work, then use \`afwk_update_document\` with the full updated content.

⚠️ Pending action queued: update_latest_implementation (run afwk_update_latest_implementation when ready)`,
        metadata: { afwk: output, needsCompletion: true, documentPath: completionNotesRelPath },
      }
    },
  },
)

// ============================================================================
// TOOL: afwk_get_steering_context
// ============================================================================

const GetSteeringContextParams = z.object({
  docType: z
    .string()
    .optional()
    .describe("Specific steering doc to retrieve (e.g., 'tech.md', 'roles.md'). If omitted, returns index of available docs."),
})

interface GetSteeringContextMetadata {
  afwk: AfwkToolOutput
  docType?: string
  availableDocs?: string[]
}

/**
 * Get the steering directory path
 */
function getSteeringDir(): string {
  return path.join(getAfwkDir(), "steering")
}

export const AfwkGetSteeringContextTool = Tool.define<typeof GetSteeringContextParams, GetSteeringContextMetadata>(
  AFWK_TOOL_IDS.getSteeringContext,
  {
    description:
      "Read steering documentation from .afwk/steering/. Without docType returns an index of available docs. With docType returns the content of that specific document.",
    parameters: GetSteeringContextParams,
    async execute(params, _ctx) {
      const runId = generateToolRunId()
      const errors: string[] = []
      const warnings: string[] = []

      // Verificar inicializacion
      const initialized = await isInitialized()
      if (!initialized) {
        const output: AfwkToolOutput = {
          ok: false,
          tool_run_id: runId,
          changes: [],
          warnings: [],
          errors: ["aiFRAMEWORK not initialized. Run initialization first."],
        }

        await appendToAuditLog({
          tool_run_id: runId,
          timestamp: new Date().toISOString(),
          tool: AFWK_TOOL_IDS.getSteeringContext,
          input: params,
          output_ok: false,
          changes: [],
          errors: output.errors,
        })

        return {
          title: "Steering Context",
          output: JSON.stringify({ error: "Not initialized" }),
          metadata: { afwk: output },
        }
      }

      const steeringDir = getSteeringDir()

      // Si no se especifica docType, retornar indice
      if (!params.docType) {
        try {
          const entries = await fs.readdir(steeringDir, { withFileTypes: true })
          const docs = entries.filter((e) => e.isFile() && e.name.endsWith(".md")).map((e) => e.name)

          const output: AfwkToolOutput = {
            ok: true,
            tool_run_id: runId,
            changes: [],
            warnings,
            errors,
          }

          await appendToAuditLog({
            tool_run_id: runId,
            timestamp: new Date().toISOString(),
            tool: AFWK_TOOL_IDS.getSteeringContext,
            input: params,
            output_ok: true,
            changes: [],
            errors,
          })

          const lines = [
            "## Steering Documents",
            "",
            `**Available docs** (${docs.length}):`,
            ...docs.map((d) => `- ${d}`),
            "",
            "Use `docType` parameter to retrieve specific document content.",
          ]

          return {
            title: "Steering Index",
            output: lines.join("\n"),
            metadata: { afwk: output, availableDocs: docs },
          }
        } catch (err) {
          errors.push(`Could not read steering directory: ${err}`)
          const output: AfwkToolOutput = {
            ok: false,
            tool_run_id: runId,
            changes: [],
            warnings,
            errors,
          }

          await appendToAuditLog({
            tool_run_id: runId,
            timestamp: new Date().toISOString(),
            tool: AFWK_TOOL_IDS.getSteeringContext,
            input: params,
            output_ok: false,
            changes: [],
            errors,
          })

          return {
            title: "Steering Context",
            output: `Error: ${errors.join(", ")}`,
            metadata: { afwk: output },
          }
        }
      }

      // Leer documento especifico
      const docPath = path.join(steeringDir, params.docType)
      try {
        const content = await fs.readFile(docPath, "utf-8")

        const output: AfwkToolOutput = {
          ok: true,
          tool_run_id: runId,
          changes: [],
          warnings,
          errors,
        }

        await appendToAuditLog({
          tool_run_id: runId,
          timestamp: new Date().toISOString(),
          tool: AFWK_TOOL_IDS.getSteeringContext,
          input: params,
          output_ok: true,
          changes: [],
          errors,
        })

        return {
          title: params.docType,
          output: content,
          metadata: { afwk: output, docType: params.docType },
        }
      } catch (err) {
        errors.push(`Could not read ${params.docType}: ${err}`)
        const output: AfwkToolOutput = {
          ok: false,
          tool_run_id: runId,
          changes: [],
          warnings,
          errors,
        }

        await appendToAuditLog({
          tool_run_id: runId,
          timestamp: new Date().toISOString(),
          tool: AFWK_TOOL_IDS.getSteeringContext,
          input: params,
          output_ok: false,
          changes: [],
          errors,
        })

        return {
          title: "Steering Context",
          output: `Error: ${errors.join(", ")}`,
          metadata: { afwk: output, docType: params.docType },
        }
      }
    },
  },
)

// ============================================================================
// TOOL: afwk_validate_devtask
// ============================================================================

const ValidateDevTaskParams = z.object({
  taskId: z.string().describe("The devTASK ID to validate (e.g., 'devTASK-01_login')"),
})

interface ValidationIssue {
  type: "error" | "warning"
  path: string
  message: string
}

interface ValidateDevTaskMetadata {
  afwk: AfwkToolOutput
  valid: boolean
  issues: ValidationIssue[]
}

export const AfwkValidateDevTaskTool = Tool.define<typeof ValidateDevTaskParams, ValidateDevTaskMetadata>(
  AFWK_TOOL_IDS.validateDevTask,
  {
    description:
      "Validate the structure and required files of a devTASK. Checks for overview.md, devTASK.json, and validates aiTASK files have required sections.",
    parameters: ValidateDevTaskParams,
    async execute(params, _ctx) {
      const runId = generateToolRunId()
      const errors: string[] = []
      const warnings: string[] = []
      const issues: ValidationIssue[] = []

      // Verificar inicializacion
      const initialized = await isInitialized()
      if (!initialized) {
        const output: AfwkToolOutput = {
          ok: false,
          tool_run_id: runId,
          changes: [],
          warnings: [],
          errors: ["aiFRAMEWORK not initialized. Run initialization first."],
        }

        await appendToAuditLog({
          tool_run_id: runId,
          timestamp: new Date().toISOString(),
          tool: AFWK_TOOL_IDS.validateDevTask,
          input: params,
          output_ok: false,
          changes: [],
          errors: output.errors,
        })

        return {
          title: "Validate DevTask",
          output: JSON.stringify({ error: "Not initialized" }),
          metadata: { afwk: output, valid: false, issues: [] },
        }
      }

      // Encontrar el devTASK
      const devTaskInfo = await findDevTaskPath(params.taskId)
      if (!devTaskInfo) {
        errors.push(`devTASK ${params.taskId} not found in any column`)
        const output: AfwkToolOutput = {
          ok: false,
          tool_run_id: runId,
          entity_refs: { devTaskId: params.taskId },
          changes: [],
          warnings,
          errors,
        }

        await appendToAuditLog({
          tool_run_id: runId,
          timestamp: new Date().toISOString(),
          tool: AFWK_TOOL_IDS.validateDevTask,
          input: params,
          output_ok: false,
          changes: [],
          errors,
          entity_refs: output.entity_refs,
        })

        return {
          title: params.taskId,
          output: `Error: ${errors.join(", ")}`,
          metadata: { afwk: output, valid: false, issues: [] },
        }
      }

      const taskPath = devTaskInfo.path

      // Check 1: overview.md exists
      const overviewPath = path.join(taskPath, "overview.md")
      try {
        await fs.stat(overviewPath)
        // Check for required sections in overview.md
        const overviewContent = await fs.readFile(overviewPath, "utf-8")
        const requiredSections = ["## Objetivo", "## Criterios de Exito"]
        for (const section of requiredSections) {
          if (!overviewContent.includes(section)) {
            issues.push({
              type: "warning",
              path: "overview.md",
              message: `Missing section: ${section}`,
            })
          }
        }
      } catch {
        issues.push({
          type: "error",
          path: "overview.md",
          message: "Required file overview.md not found",
        })
      }

      // Check 2: devTASK.json exists and is valid
      const metadataPath = path.join(taskPath, "devTASK.json")
      let metadata: { id?: string; title?: string; aitasks?: string[] } | null = null
      try {
        const metadataContent = await fs.readFile(metadataPath, "utf-8")
        metadata = JSON.parse(metadataContent)
        if (!metadata?.id) {
          issues.push({
            type: "warning",
            path: "devTASK.json",
            message: "Missing 'id' field in metadata",
          })
        }
        if (!metadata?.title) {
          issues.push({
            type: "warning",
            path: "devTASK.json",
            message: "Missing 'title' field in metadata",
          })
        }
      } catch (err) {
        if (String(err).includes("ENOENT")) {
          issues.push({
            type: "error",
            path: "devTASK.json",
            message: "Required file devTASK.json not found",
          })
        } else {
          issues.push({
            type: "error",
            path: "devTASK.json",
            message: `Invalid JSON in devTASK.json: ${err}`,
          })
        }
      }

      // Check 3: Validate aiTASKs
      try {
        const entries = await fs.readdir(taskPath)
        const aiTaskFiles = entries.filter((e) => e.match(/^aiTASK-\d{2}.*\.md$/i) && !e.includes("_completion-notes"))

        for (const aiTaskFile of aiTaskFiles) {
          const aiTaskPath = path.join(taskPath, aiTaskFile)
          try {
            const aiTaskContent = await fs.readFile(aiTaskPath, "utf-8")
            const requiredAiTaskSections = ["## Objetivo de esta Iteracion", "## Criterios de Validacion"]
            for (const section of requiredAiTaskSections) {
              if (!aiTaskContent.includes(section)) {
                issues.push({
                  type: "warning",
                  path: aiTaskFile,
                  message: `Missing section: ${section}`,
                })
              }
            }
          } catch (err) {
            issues.push({
              type: "warning",
              path: aiTaskFile,
              message: `Could not read aiTASK file: ${err}`,
            })
          }
        }

        // Check if registered aiTASKs in metadata exist
        if (metadata?.aitasks && Array.isArray(metadata.aitasks)) {
          for (const registeredAiTask of metadata.aitasks) {
            const expectedFile = `${registeredAiTask}.md`
            if (!entries.includes(expectedFile)) {
              issues.push({
                type: "error",
                path: "devTASK.json",
                message: `Registered aiTASK '${registeredAiTask}' file not found`,
              })
            }
          }
        }
      } catch {
        // Directory read error already handled by other checks
      }

      // Determine validity
      const hasErrors = issues.some((i) => i.type === "error")
      const valid = !hasErrors

      const output: AfwkToolOutput = {
        ok: true,
        tool_run_id: runId,
        entity_refs: { devTaskId: params.taskId },
        changes: [],
        warnings: issues.filter((i) => i.type === "warning").map((i) => `${i.path}: ${i.message}`),
        errors: issues.filter((i) => i.type === "error").map((i) => `${i.path}: ${i.message}`),
      }

      await appendToAuditLog({
        tool_run_id: runId,
        timestamp: new Date().toISOString(),
        tool: AFWK_TOOL_IDS.validateDevTask,
        input: params,
        output_ok: true,
        changes: [],
        errors: output.errors,
        entity_refs: output.entity_refs,
      })

      // Format output
      const lines = [
        `## Validation Report: ${params.taskId}`,
        "",
        `**Location**: ${devTaskInfo.column}`,
        `**Status**: ${valid ? "✅ VALID" : "❌ INVALID"}`,
        "",
      ]

      if (issues.length === 0) {
        lines.push("No issues found.")
      } else {
        const errorIssues = issues.filter((i) => i.type === "error")
        const warningIssues = issues.filter((i) => i.type === "warning")

        if (errorIssues.length > 0) {
          lines.push(`**Errors** (${errorIssues.length}):`)
          errorIssues.forEach((i) => lines.push(`- ❌ ${i.path}: ${i.message}`))
          lines.push("")
        }

        if (warningIssues.length > 0) {
          lines.push(`**Warnings** (${warningIssues.length}):`)
          warningIssues.forEach((i) => lines.push(`- ⚠️ ${i.path}: ${i.message}`))
        }
      }

      return {
        title: params.taskId,
        output: lines.join("\n"),
        metadata: { afwk: output, valid, issues },
      }
    },
  },
)

// ============================================================================
// TOOL: afwk_update_latest_implementation
// ============================================================================

const UpdateLatestImplementationParams = z.object({
  devTaskId: z.string().describe("The devTASK ID this implementation relates to"),
  summary: z.string().min(20).describe("Summary of what was implemented"),
  filesChanged: z.array(z.string()).optional().describe("List of files that were changed"),
})

interface UpdateLatestImplementationMetadata {
  afwk: AfwkToolOutput
}

export const AfwkUpdateLatestImplementationTool = Tool.define<
  typeof UpdateLatestImplementationParams,
  UpdateLatestImplementationMetadata
>(AFWK_TOOL_IDS.updateLatestImplementation, {
  description:
    "Update the steering/latest-implementation.md file with a summary of the latest implementation. Use this after completing significant work on a devTASK.",
  parameters: UpdateLatestImplementationParams,
  async execute(params, _ctx) {
    const runId = generateToolRunId()
    const errors: string[] = []
    const warnings: string[] = []
    const changes: AfwkToolOutput["changes"] = []

    // Verificar inicializacion
    const initialized = await isInitialized()
    if (!initialized) {
      const output: AfwkToolOutput = {
        ok: false,
        tool_run_id: runId,
        entity_refs: { devTaskId: params.devTaskId },
        changes: [],
        warnings: [],
        errors: ["aiFRAMEWORK not initialized. Run initialization first."],
      }

      await appendToAuditLog({
        tool_run_id: runId,
        timestamp: new Date().toISOString(),
        tool: AFWK_TOOL_IDS.updateLatestImplementation,
        input: params,
        output_ok: false,
        changes: [],
        errors: output.errors,
        entity_refs: output.entity_refs,
      })

      return {
        title: "Update Latest Implementation",
        output: JSON.stringify({ error: "Not initialized" }),
        metadata: { afwk: output },
      }
    }

    const steeringDir = path.join(getAfwkDir(), "steering")
    const latestImplPath = path.join(steeringDir, "latest-implementation.md")
    const relativePath = "steering/latest-implementation.md"

    try {
      // Asegurar que el directorio steering existe
      await fs.mkdir(steeringDir, { recursive: true })

      // Generar contenido del archivo
      const timestamp = new Date().toISOString()
      const filesSection =
        params.filesChanged && params.filesChanged.length > 0
          ? `\n## Files Changed\n\n${params.filesChanged.map((f) => `- \`${f}\``).join("\n")}\n`
          : ""

      const content = `# Latest Implementation

> Last updated: ${timestamp}
> Related to: ${params.devTaskId}

## Summary

${params.summary}
${filesSection}
---

*This file is auto-generated by aiFRAMEWORK*
`

      // Verificar si el archivo ya existe
      let fileExists = false
      try {
        await fs.stat(latestImplPath)
        fileExists = true
      } catch {
        fileExists = false
      }

      await fs.writeFile(latestImplPath, content, "utf-8")
      changes.push({
        path: relativePath,
        type: fileExists ? "update" : "create",
        summary: `${fileExists ? "Updated" : "Created"} latest-implementation.md for ${params.devTaskId}`,
      })

      // Marcar pending action como completada si existe
      const state = await import("./state").then((m) => m.readState())
      const pendingAction = state.pending_actions.find(
        (a) => a.type === "update_latest_implementation" && a.context.devTaskId === params.devTaskId && a.status === "pending",
      )
      if (pendingAction) {
        await import("./state").then((m) => m.updatePendingAction(pendingAction.id, "completed"))
        warnings.push(`Completed pending action: ${pendingAction.id}`)
      }
    } catch (err) {
      errors.push(`Failed to update latest-implementation.md: ${err}`)
      const output: AfwkToolOutput = {
        ok: false,
        tool_run_id: runId,
        entity_refs: { devTaskId: params.devTaskId },
        changes,
        warnings,
        errors,
      }

      await appendToAuditLog({
        tool_run_id: runId,
        timestamp: new Date().toISOString(),
        tool: AFWK_TOOL_IDS.updateLatestImplementation,
        input: params,
        output_ok: false,
        changes,
        errors,
        entity_refs: output.entity_refs,
      })

      return {
        title: "Update Latest Implementation",
        output: `Error: ${errors.join(", ")}`,
        metadata: { afwk: output },
      }
    }

    const output: AfwkToolOutput = {
      ok: true,
      tool_run_id: runId,
      entity_refs: { devTaskId: params.devTaskId },
      changes,
      warnings,
      errors,
    }

    await appendToAuditLog({
      tool_run_id: runId,
      timestamp: new Date().toISOString(),
      tool: AFWK_TOOL_IDS.updateLatestImplementation,
      input: params,
      output_ok: true,
      changes,
      errors,
      entity_refs: output.entity_refs,
    })

    return {
      title: params.devTaskId,
      output: `Successfully updated steering/latest-implementation.md for ${params.devTaskId}`,
      metadata: { afwk: output },
    }
  },
})

// ============================================================================
// TOOL: afwk_update_document
// ============================================================================

const UpdateDocumentParams = z.object({
  documentPath: z
    .string()
    .describe("Relative path to document within .afwk/ (e.g., 'kanban/backlog/devTASK-01_login/overview.md')"),
  content: z.string().min(10).describe("Full updated document content"),
})

interface UpdateDocumentMetadata {
  afwk: AfwkToolOutput | StagingToolOutput
}

export const AfwkUpdateDocumentTool = Tool.define<typeof UpdateDocumentParams, UpdateDocumentMetadata>(
  AFWK_TOOL_IDS.updateDocument,
  {
    description:
      "Update a document within .afwk/kanban/. Use this to write agent-generated content to task documents. Only allows updating existing .md files inside kanban/ directory.",
    parameters: UpdateDocumentParams,
    async execute(params, _ctx) {
      const runId = generateToolRunId()
      const errors: string[] = []
      const warnings: string[] = []
      const changes: AfwkToolOutput["changes"] = []

      // Verificar inicializacion
      const initialized = await isInitialized()
      if (!initialized) {
        const output: AfwkToolOutput = {
          ok: false,
          tool_run_id: runId,
          changes: [],
          warnings: [],
          errors: ["aiFRAMEWORK not initialized. Run initialization first."],
        }

        await appendToAuditLog({
          tool_run_id: runId,
          timestamp: new Date().toISOString(),
          tool: AFWK_TOOL_IDS.updateDocument,
          input: { documentPath: params.documentPath },
          output_ok: false,
          changes: [],
          errors: output.errors,
        })

        return {
          title: "Update Document",
          output: JSON.stringify({ error: "Not initialized" }),
          metadata: { afwk: output },
        }
      }

      // Normalizar path (convertir backslashes a forward slashes)
      const normalizedPath = params.documentPath.replace(/\\/g, "/")

      // Security validations
      // 1. Must be a .md file
      if (!normalizedPath.endsWith(".md")) {
        errors.push("Only .md files can be updated")
        const output: AfwkToolOutput = {
          ok: false,
          tool_run_id: runId,
          changes: [],
          warnings,
          errors,
        }

        await appendToAuditLog({
          tool_run_id: runId,
          timestamp: new Date().toISOString(),
          tool: AFWK_TOOL_IDS.updateDocument,
          input: { documentPath: params.documentPath },
          output_ok: false,
          changes: [],
          errors,
        })

        return {
          title: "Update Document",
          output: `Security Error: ${errors.join(", ")}`,
          metadata: { afwk: output },
        }
      }

      // 2. Must be inside kanban/ (not steering/, audit-log/, or other protected areas)
      if (!normalizedPath.startsWith("kanban/")) {
        errors.push("Only documents inside kanban/ can be updated. steering/ and other directories are protected.")
        const output: AfwkToolOutput = {
          ok: false,
          tool_run_id: runId,
          changes: [],
          warnings,
          errors,
        }

        await appendToAuditLog({
          tool_run_id: runId,
          timestamp: new Date().toISOString(),
          tool: AFWK_TOOL_IDS.updateDocument,
          input: { documentPath: params.documentPath },
          output_ok: false,
          changes: [],
          errors,
        })

        return {
          title: "Update Document",
          output: `Security Error: ${errors.join(", ")}`,
          metadata: { afwk: output },
        }
      }

      // 3. No path traversal allowed
      if (normalizedPath.includes("..")) {
        errors.push("Path traversal not allowed")
        const output: AfwkToolOutput = {
          ok: false,
          tool_run_id: runId,
          changes: [],
          warnings,
          errors,
        }

        await appendToAuditLog({
          tool_run_id: runId,
          timestamp: new Date().toISOString(),
          tool: AFWK_TOOL_IDS.updateDocument,
          input: { documentPath: params.documentPath },
          output_ok: false,
          changes: [],
          errors,
        })

        return {
          title: "Update Document",
          output: `Security Error: ${errors.join(", ")}`,
          metadata: { afwk: output },
        }
      }

      // Build full path
      const fullPath = path.join(getAfwkDir(), normalizedPath)

      // 4. Verify file already exists (we don't create new files with this tool)
      try {
        const stats = await fs.stat(fullPath)
        if (!stats.isFile()) {
          errors.push("Path does not point to a file")
          const output: AfwkToolOutput = {
            ok: false,
            tool_run_id: runId,
            changes: [],
            warnings,
            errors,
          }

          await appendToAuditLog({
            tool_run_id: runId,
            timestamp: new Date().toISOString(),
            tool: AFWK_TOOL_IDS.updateDocument,
            input: { documentPath: params.documentPath },
            output_ok: false,
            changes: [],
            errors,
          })

          return {
            title: "Update Document",
            output: `Error: ${errors.join(", ")}`,
            metadata: { afwk: output },
          }
        }
      } catch {
        errors.push(`File does not exist: ${normalizedPath}. This tool only updates existing files.`)
        const output: AfwkToolOutput = {
          ok: false,
          tool_run_id: runId,
          changes: [],
          warnings,
          errors,
        }

        await appendToAuditLog({
          tool_run_id: runId,
          timestamp: new Date().toISOString(),
          tool: AFWK_TOOL_IDS.updateDocument,
          input: { documentPath: params.documentPath },
          output_ok: false,
          changes: [],
          errors,
        })

        return {
          title: "Update Document",
          output: `Error: ${errors.join(", ")}`,
          metadata: { afwk: output },
        }
      }

      // Use staging if enabled
      if (isStagingEnabled()) {
        const stagingResult = await stageDocument({
          toolRunId: runId,
          toolName: AFWK_TOOL_IDS.updateDocument,
          content: params.content,
          finalPath: normalizedPath,
          documentType: "document-update",
        })

        const output: StagingToolOutput = {
          ok: true,
          tool_run_id: runId,
          changes,
          warnings: ["Document staged for review - awaiting user confirmation"],
          errors,
          staging: {
            stagingId: stagingResult.stagingId,
            awaitingReview: true,
            stagedPath: stagingResult.stagedPath,
            finalPath: stagingResult.finalPath,
            expiresAt: stagingResult.expiresAt,
          },
        }

        await appendToAuditLog({
          tool_run_id: runId,
          timestamp: new Date().toISOString(),
          tool: AFWK_TOOL_IDS.updateDocument,
          input: { documentPath: params.documentPath },
          output_ok: true,
          changes,
          errors,
        })

        return {
          title: path.basename(normalizedPath),
          output: `📝 **Awaiting Review**: ${path.basename(normalizedPath)} has been staged for your review.
- Staged at: .afwk/${stagingResult.stagedPath}
- Final location: .afwk/${normalizedPath}

The file should open in your editor. Review and edit as needed, then click Confirm to save or Cancel to discard.`,
          metadata: { afwk: output, staging: output.staging },
        }
      }

      // Write the content (staging disabled)
      try {
        await fs.writeFile(fullPath, params.content, "utf-8")
        changes.push({
          path: normalizedPath,
          type: "update",
          summary: `Updated document: ${path.basename(normalizedPath)}`,
        })
      } catch (err) {
        errors.push(`Failed to write file: ${err}`)
        const output: AfwkToolOutput = {
          ok: false,
          tool_run_id: runId,
          changes,
          warnings,
          errors,
        }

        await appendToAuditLog({
          tool_run_id: runId,
          timestamp: new Date().toISOString(),
          tool: AFWK_TOOL_IDS.updateDocument,
          input: { documentPath: params.documentPath },
          output_ok: false,
          changes,
          errors,
        })

        return {
          title: "Update Document",
          output: `Error: ${errors.join(", ")}`,
          metadata: { afwk: output },
        }
      }

      const output: AfwkToolOutput = {
        ok: true,
        tool_run_id: runId,
        changes,
        warnings,
        errors,
      }

      await appendToAuditLog({
        tool_run_id: runId,
        timestamp: new Date().toISOString(),
        tool: AFWK_TOOL_IDS.updateDocument,
        input: { documentPath: params.documentPath },
        output_ok: true,
        changes,
        errors,
      })

      return {
        title: path.basename(normalizedPath),
        output: `Successfully updated ${normalizedPath}`,
        metadata: { afwk: output },
      }
    },
  },
)

// ============================================================================
// PRIMITIVE FILESYSTEM TOOLS (restricted to .afwk)
// ============================================================================

/**
 * Validates and resolves a path within .afwk directory
 * Returns null if path is invalid or escapes .afwk
 */
function validateAfwkPath(relativePath: string): { valid: true; fullPath: string; normalizedPath: string } | { valid: false; error: string } {
  // Normalize path separators
  const normalized = relativePath.replace(/\\/g, "/")

  // Check for path traversal
  if (normalized.includes("..")) {
    return { valid: false, error: "Path traversal (..) not allowed" }
  }

  // Check for absolute paths
  if (path.isAbsolute(relativePath)) {
    return { valid: false, error: "Absolute paths not allowed. Use paths relative to .afwk/" }
  }

  // Build full path
  const fullPath = path.join(getAfwkDir(), normalized)

  // Verify the resolved path is still under .afwk
  const afwkDir = getAfwkDir()
  if (!fullPath.startsWith(afwkDir)) {
    return { valid: false, error: "Path escapes .afwk directory" }
  }

  return { valid: true, fullPath, normalizedPath: normalized }
}

// ============================================================================
// TOOL: afwk_file_exists
// ============================================================================

const FileExistsParams = z.object({
  path: z.string().describe("Relative path to file within .afwk/ (e.g., 'kanban/backlog/devTASK-01/overview.md')"),
})

interface FileExistsMetadata {
  afwk: AfwkToolOutput
  exists: boolean
  path: string
}

export const AfwkFileExistsTool = Tool.define<typeof FileExistsParams, FileExistsMetadata>(
  AFWK_TOOL_IDS.fileExists,
  {
    description:
      "Check if a file exists at a specific path within .afwk/. Returns true if file exists, false otherwise. Does not check folders.",
    parameters: FileExistsParams,
    async execute(params, _ctx) {
      const runId = generateToolRunId()
      const errors: string[] = []

      // Validate path
      const pathResult = validateAfwkPath(params.path)
      if (!pathResult.valid) {
        const output: AfwkToolOutput = {
          ok: false,
          tool_run_id: runId,
          changes: [],
          warnings: [],
          errors: [pathResult.error],
        }

        await appendToAuditLog({
          tool_run_id: runId,
          timestamp: new Date().toISOString(),
          tool: AFWK_TOOL_IDS.fileExists,
          input: params,
          output_ok: false,
          changes: [],
          errors: output.errors,
        })

        return {
          title: "File Exists",
          output: `Error: ${pathResult.error}`,
          metadata: { afwk: output, exists: false, path: params.path },
        }
      }

      // Check if file exists
      let exists = false
      try {
        const stats = await fs.stat(pathResult.fullPath)
        exists = stats.isFile()
      } catch {
        exists = false
      }

      const output: AfwkToolOutput = {
        ok: true,
        tool_run_id: runId,
        changes: [],
        warnings: [],
        errors,
      }

      await appendToAuditLog({
        tool_run_id: runId,
        timestamp: new Date().toISOString(),
        tool: AFWK_TOOL_IDS.fileExists,
        input: params,
        output_ok: true,
        changes: [],
        errors,
      })

      return {
        title: path.basename(params.path),
        output: exists ? `✅ File exists: ${pathResult.normalizedPath}` : `❌ File does not exist: ${pathResult.normalizedPath}`,
        metadata: { afwk: output, exists, path: pathResult.normalizedPath },
      }
    },
  },
)

// ============================================================================
// TOOL: afwk_folder_exists
// ============================================================================

const FolderExistsParams = z.object({
  path: z.string().describe("Relative path to folder within .afwk/ (e.g., 'kanban/backlog/devTASK-01')"),
})

interface FolderExistsMetadata {
  afwk: AfwkToolOutput
  exists: boolean
  path: string
}

export const AfwkFolderExistsTool = Tool.define<typeof FolderExistsParams, FolderExistsMetadata>(
  AFWK_TOOL_IDS.folderExists,
  {
    description:
      "Check if a folder exists at a specific path within .afwk/. Returns true if folder exists, false otherwise. Does not check files.",
    parameters: FolderExistsParams,
    async execute(params, _ctx) {
      const runId = generateToolRunId()
      const errors: string[] = []

      // Validate path
      const pathResult = validateAfwkPath(params.path)
      if (!pathResult.valid) {
        const output: AfwkToolOutput = {
          ok: false,
          tool_run_id: runId,
          changes: [],
          warnings: [],
          errors: [pathResult.error],
        }

        await appendToAuditLog({
          tool_run_id: runId,
          timestamp: new Date().toISOString(),
          tool: AFWK_TOOL_IDS.folderExists,
          input: params,
          output_ok: false,
          changes: [],
          errors: output.errors,
        })

        return {
          title: "Folder Exists",
          output: `Error: ${pathResult.error}`,
          metadata: { afwk: output, exists: false, path: params.path },
        }
      }

      // Check if folder exists
      let exists = false
      try {
        const stats = await fs.stat(pathResult.fullPath)
        exists = stats.isDirectory()
      } catch {
        exists = false
      }

      const output: AfwkToolOutput = {
        ok: true,
        tool_run_id: runId,
        changes: [],
        warnings: [],
        errors,
      }

      await appendToAuditLog({
        tool_run_id: runId,
        timestamp: new Date().toISOString(),
        tool: AFWK_TOOL_IDS.folderExists,
        input: params,
        output_ok: true,
        changes: [],
        errors,
      })

      return {
        title: path.basename(params.path) || params.path,
        output: exists ? `✅ Folder exists: ${pathResult.normalizedPath}` : `❌ Folder does not exist: ${pathResult.normalizedPath}`,
        metadata: { afwk: output, exists, path: pathResult.normalizedPath },
      }
    },
  },
)

// ============================================================================
// TOOL: afwk_create_file
// ============================================================================

const CreateFileParams = z.object({
  path: z.string().describe("Relative path for new file within .afwk/ (e.g., 'schemas/devtask.schema.json')"),
  content: z.string().describe("Content to write to the file"),
  overwrite: z.boolean().optional().default(false).describe("If true, overwrite existing file. Default is false."),
})

interface CreateFileMetadata {
  afwk: AfwkToolOutput
  created: boolean
  path: string
}

export const AfwkCreateFileTool = Tool.define<typeof CreateFileParams, CreateFileMetadata>(
  AFWK_TOOL_IDS.createFile,
  {
    description:
      "Create a new file at a specific path within .afwk/. Creates parent directories if they don't exist. By default, fails if file already exists (use overwrite=true to replace).",
    parameters: CreateFileParams,
    async execute(params, _ctx) {
      const runId = generateToolRunId()
      const errors: string[] = []
      const warnings: string[] = []
      const changes: AfwkToolOutput["changes"] = []

      // Validate path
      const pathResult = validateAfwkPath(params.path)
      if (!pathResult.valid) {
        const output: AfwkToolOutput = {
          ok: false,
          tool_run_id: runId,
          changes: [],
          warnings: [],
          errors: [pathResult.error],
        }

        await appendToAuditLog({
          tool_run_id: runId,
          timestamp: new Date().toISOString(),
          tool: AFWK_TOOL_IDS.createFile,
          input: { path: params.path, overwrite: params.overwrite },
          output_ok: false,
          changes: [],
          errors: output.errors,
        })

        return {
          title: "Create File",
          output: `Error: ${pathResult.error}`,
          metadata: { afwk: output, created: false, path: params.path },
        }
      }

      // Check if file already exists
      let fileExists = false
      try {
        const stats = await fs.stat(pathResult.fullPath)
        fileExists = stats.isFile()
      } catch {
        fileExists = false
      }

      if (fileExists && !params.overwrite) {
        errors.push(`File already exists: ${pathResult.normalizedPath}. Use overwrite=true to replace.`)
        const output: AfwkToolOutput = {
          ok: false,
          tool_run_id: runId,
          changes: [],
          warnings,
          errors,
        }

        await appendToAuditLog({
          tool_run_id: runId,
          timestamp: new Date().toISOString(),
          tool: AFWK_TOOL_IDS.createFile,
          input: { path: params.path, overwrite: params.overwrite },
          output_ok: false,
          changes: [],
          errors,
        })

        return {
          title: "Create File",
          output: `Error: ${errors.join(", ")}`,
          metadata: { afwk: output, created: false, path: pathResult.normalizedPath },
        }
      }

      // Create parent directories and write file
      try {
        const parentDir = path.dirname(pathResult.fullPath)
        await fs.mkdir(parentDir, { recursive: true })

        await fs.writeFile(pathResult.fullPath, params.content, "utf-8")

        changes.push({
          path: pathResult.normalizedPath,
          type: fileExists ? "update" : "create",
          summary: fileExists ? `Overwrote file: ${path.basename(params.path)}` : `Created file: ${path.basename(params.path)}`,
        })
      } catch (err) {
        errors.push(`Failed to create file: ${err}`)
        const output: AfwkToolOutput = {
          ok: false,
          tool_run_id: runId,
          changes,
          warnings,
          errors,
        }

        await appendToAuditLog({
          tool_run_id: runId,
          timestamp: new Date().toISOString(),
          tool: AFWK_TOOL_IDS.createFile,
          input: { path: params.path, overwrite: params.overwrite },
          output_ok: false,
          changes,
          errors,
        })

        return {
          title: "Create File",
          output: `Error: ${errors.join(", ")}`,
          metadata: { afwk: output, created: false, path: pathResult.normalizedPath },
        }
      }

      const output: AfwkToolOutput = {
        ok: true,
        tool_run_id: runId,
        changes,
        warnings,
        errors,
      }

      await appendToAuditLog({
        tool_run_id: runId,
        timestamp: new Date().toISOString(),
        tool: AFWK_TOOL_IDS.createFile,
        input: { path: params.path, overwrite: params.overwrite },
        output_ok: true,
        changes,
        errors,
      })

      return {
        title: path.basename(params.path),
        output: fileExists
          ? `✅ Overwrote file: ${pathResult.normalizedPath}`
          : `✅ Created file: ${pathResult.normalizedPath}`,
        metadata: { afwk: output, created: true, path: pathResult.normalizedPath },
      }
    },
  },
)

// ============================================================================
// CONFIGURATION TOOLS
// ============================================================================

/**
 * Configuration file path within .afwk
 */
function getConfigPath(): string {
  return path.join(getAfwkDir(), "config.json")
}

/**
 * Configuration schema
 */
interface AfwkConfig {
  dipoleApiUrl?: string
  dipoleApiKey?: string
  allowInsecureTls?: boolean // For localhost development with self-signed certs
}

/**
 * Fetch with optional insecure TLS (for localhost development)
 */
async function fetchWithConfig(url: string, options: RequestInit, config: AfwkConfig): Promise<Response> {
  // For localhost with HTTPS, we may need to allow self-signed certs
  const isLocalhost = url.includes("localhost") || url.includes("127.0.0.1")
  const isHttps = url.startsWith("https://")

  if (isLocalhost && isHttps && config.allowInsecureTls !== false) {
    // Bun supports tls option in fetch for self-signed certs
    return fetch(url, {
      ...options,
      // @ts-ignore - Bun-specific option
      tls: { rejectUnauthorized: false },
    })
  }

  return fetch(url, options)
}

/**
 * Read configuration from .afwk/config.json
 */
async function readConfig(): Promise<AfwkConfig> {
  try {
    const content = await fs.readFile(getConfigPath(), "utf-8")
    return JSON.parse(content) as AfwkConfig
  } catch {
    return {}
  }
}

/**
 * Write configuration to .afwk/config.json
 */
async function writeConfig(config: AfwkConfig): Promise<void> {
  await fs.mkdir(getAfwkDir(), { recursive: true })
  await fs.writeFile(getConfigPath(), JSON.stringify(config, null, 2), "utf-8")
}

// ============================================================================
// TOOL: afwk_get_config
// ============================================================================

const GetConfigParams = z.object({
  key: z
    .string()
    .optional()
    .describe("Specific config key to retrieve (e.g., 'dipoleApiUrl'). If omitted, returns all config."),
})

interface GetConfigMetadata {
  afwk: AfwkToolOutput
  config: AfwkConfig
  hasApiConfig: boolean
}

export const AfwkGetConfigTool = Tool.define<typeof GetConfigParams, GetConfigMetadata>(
  AFWK_TOOL_IDS.getConfig,
  {
    description:
      "Read aiFRAMEWORK configuration from .afwk/config.json. Use this to check if dipole.work API is configured.",
    parameters: GetConfigParams,
    async execute(params, _ctx) {
      const runId = generateToolRunId()
      const config = await readConfig()

      const hasApiConfig = !!(config.dipoleApiUrl && config.dipoleApiKey)

      const output: AfwkToolOutput = {
        ok: true,
        tool_run_id: runId,
        changes: [],
        warnings: hasApiConfig ? [] : ["dipole.work API not configured. Use afwk_set_config to configure."],
        errors: [],
      }

      await appendToAuditLog({
        tool_run_id: runId,
        timestamp: new Date().toISOString(),
        tool: AFWK_TOOL_IDS.getConfig,
        input: params,
        output_ok: true,
        changes: [],
        errors: [],
      })

      // If specific key requested
      if (params.key) {
        const value = config[params.key as keyof AfwkConfig]
        return {
          title: params.key,
          output: value ? `${params.key}: ${params.key.includes("Key") ? "***configured***" : value}` : `${params.key}: not set`,
          metadata: { afwk: output, config, hasApiConfig },
        }
      }

      // Return all config (mask API key)
      const displayConfig = {
        dipoleApiUrl: config.dipoleApiUrl || "not set",
        dipoleApiKey: config.dipoleApiKey ? "***configured***" : "not set",
      }

      return {
        title: "Config",
        output: `## aiFRAMEWORK Configuration\n\n${JSON.stringify(displayConfig, null, 2)}\n\n${hasApiConfig ? "✅ dipole.work API configured" : "⚠️ dipole.work API not configured"}`,
        metadata: { afwk: output, config, hasApiConfig },
      }
    },
  },
)

// ============================================================================
// TOOL: afwk_set_config
// ============================================================================

const SetConfigParams = z.object({
  dipoleApiUrl: z
    .string()
    .optional()
    .describe("Base URL for dipole.work API (e.g., 'https://dipole.work' or 'https://localhost:7xxx')"),
  dipoleApiKey: z
    .string()
    .optional()
    .describe("API key for dipole.work authentication"),
})

interface SetConfigMetadata {
  afwk: AfwkToolOutput
}

export const AfwkSetConfigTool = Tool.define<typeof SetConfigParams, SetConfigMetadata>(
  AFWK_TOOL_IDS.setConfig,
  {
    description:
      "Configure aiFRAMEWORK settings. Use this to set dipole.work API URL and API key for remote sync.",
    parameters: SetConfigParams,
    async execute(params, _ctx) {
      const runId = generateToolRunId()
      const changes: AfwkToolOutput["changes"] = []

      // Read existing config
      const config = await readConfig()

      // Update only provided fields
      if (params.dipoleApiUrl !== undefined) {
        config.dipoleApiUrl = params.dipoleApiUrl
      }
      if (params.dipoleApiKey !== undefined) {
        config.dipoleApiKey = params.dipoleApiKey
      }

      // Write config
      await writeConfig(config)
      changes.push({
        path: "config.json",
        type: "update",
        summary: "Updated aiFRAMEWORK configuration",
      })

      const output: AfwkToolOutput = {
        ok: true,
        tool_run_id: runId,
        changes,
        warnings: [],
        errors: [],
      }

      await appendToAuditLog({
        tool_run_id: runId,
        timestamp: new Date().toISOString(),
        tool: AFWK_TOOL_IDS.setConfig,
        input: { dipoleApiUrl: params.dipoleApiUrl, dipoleApiKey: params.dipoleApiKey ? "***" : undefined },
        output_ok: true,
        changes,
        errors: [],
      })

      return {
        title: "Config Updated",
        output: `✅ Configuration saved to .afwk/config.json`,
        metadata: { afwk: output },
      }
    },
  },
)

// ============================================================================
// TOOL: afwk_fetch_remote_devtasks
// ============================================================================

const FetchRemoteDevtasksParams = z.object({})

interface RemoteDevtaskItem {
  id: number
  identifier: string
  title: string
  status: string
}

interface FetchRemoteDevtasksMetadata {
  afwk: AfwkToolOutput
  items: RemoteDevtaskItem[]
  count: number
}

export const AfwkFetchRemoteDevtasksTool = Tool.define<typeof FetchRemoteDevtasksParams, FetchRemoteDevtasksMetadata>(
  AFWK_TOOL_IDS.fetchRemoteDevtasks,
  {
    description:
      "Fetch list of available devTASKs from dipole.work API. Requires API to be configured first (use afwk_get_config to check, afwk_set_config to configure).",
    parameters: FetchRemoteDevtasksParams,
    async execute(_params, _ctx) {
      const runId = generateToolRunId()
      const errors: string[] = []

      // Check config
      const config = await readConfig()
      if (!config.dipoleApiUrl || !config.dipoleApiKey) {
        const output: AfwkToolOutput = {
          ok: false,
          tool_run_id: runId,
          changes: [],
          warnings: [],
          errors: ["dipole.work API not configured. Ask user for API URL and API key, then use afwk_set_config."],
        }

        await appendToAuditLog({
          tool_run_id: runId,
          timestamp: new Date().toISOString(),
          tool: AFWK_TOOL_IDS.fetchRemoteDevtasks,
          input: {},
          output_ok: false,
          changes: [],
          errors: output.errors,
        })

        return {
          title: "Fetch Remote",
          output: `❌ API not configured. Ask the user for:\n- dipole.work API URL\n- API Key\n\nThen use afwk_set_config to save the configuration.`,
          metadata: { afwk: output, items: [], count: 0 },
        }
      }

      // Fetch from API
      try {
        const url = `${config.dipoleApiUrl.replace(/\/$/, "")}/api/devtasks`
        const response = await fetchWithConfig(url, {
          method: "GET",
          headers: {
            "X-Api-Key": config.dipoleApiKey,
            "Accept": "application/json",
          },
        }, config)

        if (!response.ok) {
          throw new Error(`API returned ${response.status}: ${response.statusText}`)
        }

        const data = await response.json() as { items: RemoteDevtaskItem[]; count: number }

        const output: AfwkToolOutput = {
          ok: true,
          tool_run_id: runId,
          changes: [],
          warnings: [],
          errors: [],
        }

        await appendToAuditLog({
          tool_run_id: runId,
          timestamp: new Date().toISOString(),
          tool: AFWK_TOOL_IDS.fetchRemoteDevtasks,
          input: {},
          output_ok: true,
          changes: [],
          errors: [],
        })

        // Format output
        const lines = [
          `## devTASKs in dipole.work (${data.count})`,
          "",
        ]

        if (data.items.length === 0) {
          lines.push("No devTASKs found.")
        } else {
          lines.push("| # | Identifier | Title | Status |")
          lines.push("|---|------------|-------|--------|")
          data.items.forEach((item, idx) => {
            lines.push(`| ${idx + 1} | ${item.identifier} | ${item.title} | ${item.status} |`)
          })
          lines.push("")
          lines.push("Use `afwk_pull_devtask` with the identifier to download a devTASK.")
        }

        return {
          title: `${data.count} devTASKs`,
          output: lines.join("\n"),
          metadata: { afwk: output, items: data.items, count: data.count },
        }
      } catch (err) {
        errors.push(`Failed to fetch from dipole.work: ${err}`)

        const output: AfwkToolOutput = {
          ok: false,
          tool_run_id: runId,
          changes: [],
          warnings: [],
          errors,
        }

        await appendToAuditLog({
          tool_run_id: runId,
          timestamp: new Date().toISOString(),
          tool: AFWK_TOOL_IDS.fetchRemoteDevtasks,
          input: {},
          output_ok: false,
          changes: [],
          errors,
        })

        return {
          title: "Fetch Failed",
          output: `❌ ${errors.join(", ")}`,
          metadata: { afwk: output, items: [], count: 0 },
        }
      }
    },
  },
)

// ============================================================================
// TOOL: afwk_pull_devtask
// ============================================================================

const PullDevtaskParams = z.object({
  identifier: z.string().describe("The devTASK identifier from dipole.work (e.g., '123-Workspace-devTASK')"),
})

interface PullDevtaskMetadata {
  afwk: AfwkToolOutput
  taskId?: string
  localPath?: string
}

export const AfwkPullDevtaskTool = Tool.define<typeof PullDevtaskParams, PullDevtaskMetadata>(
  AFWK_TOOL_IDS.pullDevtask,
  {
    description:
      "Download a devTASK from dipole.work and create local structure in backlog. Creates devTASK folder with JSON metadata and empty overview.md template for the LLM to help complete.",
    parameters: PullDevtaskParams,
    async execute(params, _ctx) {
      const runId = generateToolRunId()
      const errors: string[] = []
      const warnings: string[] = []
      const changes: AfwkToolOutput["changes"] = []

      // Check config
      const config = await readConfig()
      if (!config.dipoleApiUrl || !config.dipoleApiKey) {
        const output: AfwkToolOutput = {
          ok: false,
          tool_run_id: runId,
          changes: [],
          warnings: [],
          errors: ["dipole.work API not configured."],
        }

        await appendToAuditLog({
          tool_run_id: runId,
          timestamp: new Date().toISOString(),
          tool: AFWK_TOOL_IDS.pullDevtask,
          input: params,
          output_ok: false,
          changes: [],
          errors: output.errors,
        })

        return {
          title: "Pull DevTask",
          output: `❌ API not configured.`,
          metadata: { afwk: output },
        }
      }

      // Fetch devTASK details from API
      let remoteData: Record<string, unknown>
      try {
        const url = `${config.dipoleApiUrl.replace(/\/$/, "")}/api/devtasks/${encodeURIComponent(params.identifier)}`
        const response = await fetchWithConfig(url, {
          method: "GET",
          headers: {
            "X-Api-Key": config.dipoleApiKey,
            "Accept": "application/json",
          },
        }, config)

        if (!response.ok) {
          throw new Error(`API returned ${response.status}: ${response.statusText}`)
        }

        remoteData = await response.json() as Record<string, unknown>
      } catch (err) {
        errors.push(`Failed to fetch devTASK: ${err}`)

        const output: AfwkToolOutput = {
          ok: false,
          tool_run_id: runId,
          changes: [],
          warnings: [],
          errors,
        }

        await appendToAuditLog({
          tool_run_id: runId,
          timestamp: new Date().toISOString(),
          tool: AFWK_TOOL_IDS.pullDevtask,
          input: params,
          output_ok: false,
          changes: [],
          errors,
        })

        return {
          title: "Pull Failed",
          output: `❌ ${errors.join(", ")}`,
          metadata: { afwk: output },
        }
      }

      // Extract title from remote data
      const itemInfo = remoteData.itemInfo as Record<string, unknown> | undefined
      const normalizedFields = remoteData.normalizedFields as Record<string, unknown> | undefined
      const title = (itemInfo?.title as string) || (normalizedFields?.title as string) || params.identifier

      // Generate local ID and slug
      const taskNum = await getNextDevTaskId()
      const slug = generateSlug(title)
      const taskId = `devTASK-${taskNum}_${slug}`
      const taskDir = path.join(getColumnDir("backlog"), taskId)

      // Check if already exists locally
      try {
        await fs.stat(taskDir)
        errors.push(`Local devTASK with same name already exists: ${taskId}`)

        const output: AfwkToolOutput = {
          ok: false,
          tool_run_id: runId,
          changes: [],
          warnings: [],
          errors,
        }

        await appendToAuditLog({
          tool_run_id: runId,
          timestamp: new Date().toISOString(),
          tool: AFWK_TOOL_IDS.pullDevtask,
          input: params,
          output_ok: false,
          changes: [],
          errors,
        })

        return {
          title: "Already Exists",
          output: `❌ ${errors.join(", ")}`,
          metadata: { afwk: output },
        }
      } catch {
        // Good - directory doesn't exist
      }

      try {
        // Create directory
        await fs.mkdir(taskDir, { recursive: true })
        changes.push({
          path: toRelativePath(taskDir),
          type: "create",
          summary: `Created devTASK folder: ${taskId}`,
        })

        // Create devTASK.json with remote data + local fields
        const metadata = {
          id: taskId,
          title,
          description: (normalizedFields?.description as string) || "",
          estimatedTimeHr: null,
          scope: null,
          steps: [],
          status: "backlog",
          source: "dipole.work",
          remoteIdentifier: params.identifier,
          remoteData, // Store full remote data for reference
          created_at: new Date().toISOString(),
          pulled_at: new Date().toISOString(),
          aitasks: [],
        }

        const metadataPath = path.join(taskDir, "devTASK.json")
        await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2), "utf-8")
        changes.push({
          path: toRelativePath(metadataPath),
          type: "create",
          summary: "Created devTASK.json with remote data",
        })

        // Create overview.md template
        const overviewContent = `# ${title}

> Pulled from dipole.work: ${params.identifier}
> Pulled at: ${new Date().toISOString()}

## Objetivo

<!-- LLM: Use the remote data in devTASK.json to fill this section -->

## Alcance

<!-- LLM: Use the remote data fields to describe the scope -->

## Criterios de Exito

- [ ] <!-- LLM: Define success criteria based on remote data -->

## Consideraciones Tecnicas

<!-- LLM: Extract technical considerations from remote data -->

## Fuera de Alcance

<!-- LLM: Define what's out of scope -->

---

*This devTASK was pulled from dipole.work. Use the create-devtask skill or manually edit to complete the document.*
`

        const overviewPath = path.join(taskDir, "overview.md")
        await fs.writeFile(overviewPath, overviewContent, "utf-8")
        changes.push({
          path: toRelativePath(overviewPath),
          type: "create",
          summary: "Created overview.md template",
        })

        const output: AfwkToolOutput = {
          ok: true,
          tool_run_id: runId,
          entity_refs: { devTaskId: taskId },
          changes,
          warnings,
          errors,
        }

        await appendToAuditLog({
          tool_run_id: runId,
          timestamp: new Date().toISOString(),
          tool: AFWK_TOOL_IDS.pullDevtask,
          input: params,
          output_ok: true,
          changes,
          errors,
          entity_refs: output.entity_refs,
        })

        // Open overview in editor
        Bus.publish(TuiEvent.FileOpen, {
          filePath: `.afwk/kanban/backlog/${taskId}/overview.md`,
          reason: `Pulled devTASK ${taskId} from dipole.work`,
        })

        return {
          title: taskId,
          output: `✅ Pulled ${params.identifier} → ${taskId}

📁 Created:
- .afwk/kanban/backlog/${taskId}/
- .afwk/kanban/backlog/${taskId}/devTASK.json (contains remote data)
- .afwk/kanban/backlog/${taskId}/overview.md (template)

📝 The overview.md has been opened in dipoleSTUDIO.

**Next**: Read the devTASK.json to understand the remote data, then help the user complete the overview.md document.`,
          metadata: { afwk: output, taskId, localPath: `kanban/backlog/${taskId}` },
        }
      } catch (err) {
        errors.push(`Failed to create local structure: ${err}`)

        const output: AfwkToolOutput = {
          ok: false,
          tool_run_id: runId,
          changes,
          warnings,
          errors,
        }

        await appendToAuditLog({
          tool_run_id: runId,
          timestamp: new Date().toISOString(),
          tool: AFWK_TOOL_IDS.pullDevtask,
          input: params,
          output_ok: false,
          changes,
          errors,
        })

        return {
          title: "Pull Failed",
          output: `❌ ${errors.join(", ")}`,
          metadata: { afwk: output },
        }
      }
    },
  },
)

// Export para registro en el ToolRegistry
export const AfwkTools = [
  AfwkGetKanbanStatusTool,
  AfwkMoveKanbanTaskTool,
  AfwkCreateDevTaskTool,
  AfwkCreateAiTaskTool,
  AfwkCompleteAiTaskTool,
  AfwkGetSteeringContextTool,
  AfwkValidateDevTaskTool,
  AfwkUpdateLatestImplementationTool,
  AfwkUpdateDocumentTool,
  AfwkFileExistsTool,
  AfwkFolderExistsTool,
  AfwkCreateFileTool,
  AfwkGetConfigTool,
  AfwkSetConfigTool,
  AfwkFetchRemoteDevtasksTool,
  AfwkPullDevtaskTool,
]
