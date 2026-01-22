/**
 * AFWK Staging HTTP Endpoints
 * Provides endpoints for confirming and cancelling staged documents
 */

import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import { z } from "zod"

// Lazy import staging functions to avoid circular dependencies
async function getStaging() {
  return import("../afwk/staging")
}

const StagedDocumentListItem = z.object({
  stagingId: z.string(),
  stagedPath: z.string(),
  finalPath: z.string(),
  documentType: z.string(),
  expiresAt: z.string(),
  status: z.string(),
})

const ConfirmResult = z.object({
  ok: z.boolean(),
  stagingId: z.string(),
  finalPath: z.string().optional(),
  userEdited: z.boolean(),
  error: z.string().optional(),
})

const CancelResult = z.object({
  ok: z.boolean(),
  stagingId: z.string(),
  error: z.string().optional(),
})

const StagingIdInput = z.object({
  stagingId: z.string(),
})

export const StagingRoute = new Hono()
  .get(
    "/list",
    describeRoute({
      summary: "List pending staged documents",
      description: "Get all pending staged documents awaiting user review.",
      operationId: "tui.staging.list",
      responses: {
        200: {
          description: "List of pending staged documents",
          content: {
            "application/json": {
              schema: resolver(z.array(StagedDocumentListItem)),
            },
          },
        },
      },
    }),
    async (c) => {
      const { listPendingStaged } = await getStaging()
      const pending = await listPendingStaged()
      return c.json(
        pending.map((d) => ({
          stagingId: d.stagingId,
          stagedPath: d.stagedPath,
          finalPath: d.finalPath,
          documentType: d.documentType,
          expiresAt: d.expiresAt,
          status: d.status,
        }))
      )
    }
  )
  .post(
    "/confirm",
    describeRoute({
      summary: "Confirm staged document",
      description: "Confirm a staged document and write it to the final location.",
      operationId: "tui.staging.confirm",
      responses: {
        200: {
          description: "Staging confirmation result",
          content: {
            "application/json": {
              schema: resolver(ConfirmResult),
            },
          },
        },
      },
    }),
    validator("json", StagingIdInput),
    async (c) => {
      const { stagingId } = c.req.valid("json")
      const { confirmStaging } = await getStaging()
      const result = await confirmStaging(stagingId)
      return c.json(result)
    }
  )
  .post(
    "/cancel",
    describeRoute({
      summary: "Cancel staged document",
      description: "Cancel a staged document and remove staging files.",
      operationId: "tui.staging.cancel",
      responses: {
        200: {
          description: "Staging cancellation result",
          content: {
            "application/json": {
              schema: resolver(CancelResult),
            },
          },
        },
      },
    }),
    validator("json", StagingIdInput),
    async (c) => {
      const { stagingId } = c.req.valid("json")
      const { cancelStaging } = await getStaging()
      const result = await cancelStaging(stagingId)
      return c.json(result)
    }
  )
