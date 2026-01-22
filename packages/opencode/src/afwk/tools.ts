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
  userConfirmed: z
    .boolean()
    .optional()
    .default(false)
    .describe("Set to true only after user explicitly confirms they want to create this devTASK"),
})

interface CreateDevTaskMetadata {
  afwk: AfwkToolOutput | StagingToolOutput
  taskId?: string
  proposed?: boolean
}

export const AfwkCreateDevTaskTool = Tool.define<typeof CreateDevTaskParams, CreateDevTaskMetadata>(
  AFWK_TOOL_IDS.createDevTask,
  {
    description:
      "Create a new devTASK in the backlog. IMPORTANT: First call with userConfirmed=false to propose the task, then call again with userConfirmed=true only after user explicitly approves.",
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

      // Si no está confirmado por el usuario, retornar propuesta
      if (!params.userConfirmed) {
        const output: AfwkToolOutput = {
          ok: true,
          tool_run_id: runId,
          changes: [],
          warnings: ["Awaiting user confirmation"],
          errors: [],
        }

        return {
          title: "Proposed DevTask",
          output: `📋 **Proposed devTASK:**

**Title:** ${params.title}
**Description:** ${params.description}

⚠️ This is a proposal. Ask the user if they want to create this devTASK.
If the user confirms, call this tool again with \`userConfirmed: true\`.`,
          metadata: { afwk: output, proposed: true },
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
          status: "backlog",
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

        // Crear overview.md desde template
        const overviewContent = await loadTemplate("overview", {
          title: params.title,
          description: params.description,
          devTaskId: taskId,
        })
        const overviewRelPath = `kanban/backlog/${taskId}/overview.md`
        const overviewPath = path.join(taskDir, "overview.md")

        // Use staging if enabled
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

The file should open in your editor. Review and edit as needed, then click Confirm to save or Cancel to discard.

The overview.md has \`<!-- FILL: ... -->\` sections that need content:
1. **Alcance** - List affected components/files.
2. **Criterios de Exito** - Define 3-5 measurable success criteria.
3. **Consideraciones Tecnicas** - Identify risks and technical decisions.
4. **Fuera de Alcance** - Explicitly list what's NOT included.`,
            metadata: { afwk: output, taskId, staging: output.staging },
          }
        }

        // Direct write (staging disabled)
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

      // Build paths for agent to complete template
      const overviewRelPath = `kanban/backlog/${taskId}/overview.md`
      const metadataRelPath = `kanban/backlog/${taskId}/devTASK.json`

      return {
        title: taskId,
        output: `✅ Created ${taskId} in backlog

📁 Files created:
- kanban/backlog/${taskId}/
- ${metadataRelPath}
- ${overviewRelPath}

📝 **Action Required**: Complete the template sections in overview.md

The overview.md has \`<!-- FILL: ... -->\` sections that need content:
1. **Alcance** - List affected components/files. Search the project if needed.
2. **Criterios de Exito** - Define 3-5 measurable success criteria.
3. **Consideraciones Tecnicas** - Identify risks and technical decisions.
4. **Fuera de Alcance** - Explicitly list what's NOT included.

To complete: Read the file at \`.afwk/${overviewRelPath}\`, generate content for each FILL section based on the conversation context and project analysis, then use \`afwk_update_document\` with the full updated content and show a summary of the created devTASK to the user.`,
        metadata: { afwk: output, taskId, needsCompletion: true, documentPath: overviewRelPath },
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
        // Crear aiTASK.md desde template
        const aiTaskContent = await loadTemplate("aitask-blueprint", {
          title: params.title,
          aiTaskId,
          devTaskId: params.devTaskId,
          objective: params.objective,
        })
        const aiTaskRelPath = `kanban/${devTaskInfo.column}/${params.devTaskId}/${aiTaskId}.md`
        const aiTaskPath = path.join(devTaskInfo.path, `${aiTaskId}.md`)

        // Use staging if enabled
        if (isStagingEnabled()) {
          // Update devTASK.json first (this is metadata, not staged)
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

The file should open in your editor. Review and edit as needed, then click Confirm to save or Cancel to discard.

The blueprint has \`<!-- FILL: ... -->\` sections that need content:
1. **Especificacion de Implementacion** - Detail technical implementation steps.
2. **Criterios de Validacion** - List 3-5 specific validation criteria.
3. **Archivos a Modificar** - List files to be modified with descriptions.
4. **Casos de Prueba** - Define 2-4 test cases.`,
            metadata: { afwk: output, aiTaskId, staging: output.staging },
          }
        }

        // Direct write (staging disabled)
        await fs.writeFile(aiTaskPath, aiTaskContent, "utf-8")
        changes.push({
          path: toRelativePath(aiTaskPath),
          type: "create",
          summary: `Created aiTASK blueprint: ${aiTaskId}`,
        })

        // Actualizar devTASK.json
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

      // Build path for agent to complete template
      const aiTaskRelPath = `kanban/${devTaskInfo.column}/${params.devTaskId}/${aiTaskId}.md`

      return {
        title: aiTaskId,
        output: `✅ Created ${aiTaskId} in ${params.devTaskId}

📁 Files created:
- ${toRelativePath(path.join(devTaskInfo.path, `${aiTaskId}.md`))}

📝 **Action Required**: Complete the template sections in ${aiTaskId}.md

The blueprint has \`<!-- FILL: ... -->\` sections that need content:
1. **Especificacion de Implementacion** - Detail technical implementation steps.
2. **Criterios de Validacion** - List 3-5 specific validation criteria.
3. **Archivos a Modificar** - List files to be modified with descriptions.
4. **Casos de Prueba** - Define 2-4 test cases.

To complete: Read the file at \`.afwk/${aiTaskRelPath}\`, generate content for each FILL section, then use \`afwk_update_document\` with the full updated content.`,
        metadata: { afwk: output, aiTaskId, needsCompletion: true, documentPath: aiTaskRelPath },
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

      try {
        // Crear completion notes desde template
        const completionContent = await loadTemplate("completion-notes", {
          aiTaskId: params.aiTaskId,
          notes: params.notes,
        })
        const completionNotesRelPath = `kanban/${aiTaskInfo.column}/${aiTaskInfo.devTaskId}/${params.aiTaskId}_completion-notes.md`

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

      // Build path for agent to complete template
      const completionNotesRelPath = `kanban/${aiTaskInfo.column}/${aiTaskInfo.devTaskId}/${params.aiTaskId}_completion-notes.md`

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
]
