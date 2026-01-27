import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import z from "zod"

export const TuiEvent = {
  PromptAppend: BusEvent.define("tui.prompt.append", z.object({ text: z.string() })),
  CommandExecute: BusEvent.define(
    "tui.command.execute",
    z.object({
      command: z.union([
        z.enum([
          "session.list",
          "session.new",
          "session.share",
          "session.interrupt",
          "session.compact",
          "session.page.up",
          "session.page.down",
          "session.half.page.up",
          "session.half.page.down",
          "session.first",
          "session.last",
          "prompt.clear",
          "prompt.submit",
          "agent.cycle",
        ]),
        z.string(),
      ]),
    }),
  ),
  ToastShow: BusEvent.define(
    "tui.toast.show",
    z.object({
      title: z.string().optional(),
      message: z.string(),
      variant: z.enum(["info", "success", "warning", "error"]),
      duration: z.number().default(5000).optional().describe("Duration in milliseconds"),
    }),
  ),
  SessionSelect: BusEvent.define(
    "tui.session.select",
    z.object({
      sessionID: z.string().regex(/^ses/).describe("Session ID to navigate to"),
    }),
  ),
  // AFWK Staging Events
  StagingReview: BusEvent.define(
    "tui.staging.review",
    z.object({
      stagingId: z.string().describe("Unique staging ID"),
      stagedPath: z.string().describe("Relative path to staged file within .afwk/"),
      finalPath: z.string().describe("Final destination path within .afwk/"),
      documentType: z
        .enum(["devtask-overview", "aitask-blueprint", "completion-notes", "document-update"])
        .describe("Type of document being staged"),
      expiresAt: z.string().describe("ISO timestamp when staging expires"),
    }),
  ),
  StagingResult: BusEvent.define(
    "tui.staging.result",
    z.object({
      stagingId: z.string().describe("Unique staging ID"),
      result: z.enum(["confirmed", "cancelled", "expired"]).describe("Result of staging operation"),
      finalPath: z.string().optional().describe("Final path if confirmed"),
      error: z.string().optional().describe("Error message if operation failed"),
    }),
  ),
  // AFWK File Open Event - opens a file in the editor without staging
  FileOpen: BusEvent.define(
    "tui.file.open",
    z.object({
      filePath: z.string().describe("Relative path to file within project (e.g., .afwk/kanban/backlog/devTASK-01/overview.md)"),
      reason: z.string().optional().describe("Reason for opening the file (shown in notification)"),
    }),
  ),
}
