/**
 * Workflow Configuration Schemas
 * Zod schemas for validating config.yaml and sync.lock files
 *
 * @module workflow/config/schema
 */

import { z } from "zod"

/**
 * URL validation - only HTTPS allowed for security
 */
const httpsUrlSchema = z
  .string()
  .url("Must be a valid URL")
  .refine((url) => url.startsWith("https://"), {
    message: "Only HTTPS URLs are allowed for security",
  })

/**
 * Source name validation - kebab-case
 */
const sourceNameSchema = z
  .string()
  .min(1, "Source name is required")
  .max(50, "Source name must be 50 characters or less")
  .regex(/^[a-z][a-z0-9-]*$/, "Source name must be kebab-case (lowercase letters, numbers, hyphens)")

/**
 * Timeout string validation
 */
const timeoutSchema = z
  .string()
  .regex(/^\d+(ms|s|m|h)?$/, "Invalid timeout format. Use: 30s, 1m, 500ms, etc.")
  .default("30s")

/**
 * Interval string validation
 */
const intervalSchema = z
  .string()
  .regex(/^\d+(m|h|d)?$/, "Invalid interval format. Use: 30m, 1h, 24h, 7d, etc.")
  .default("24h")

/**
 * Auth config schema
 */
export const AuthConfigSchema = z.object({
  type: z.enum(["github-token", "bearer"]),
  env: z.string().min(1, "Environment variable name is required"),
})

/**
 * Source config schema
 */
export const SourceConfigSchema = z.object({
  name: sourceNameSchema,
  url: httpsUrlSchema,
  branch: z.string().min(1).default("main"),
  enabled: z.boolean().default(true),
  priority: z.number().int().min(0).max(1000).default(50),
  auth: AuthConfigSchema.optional(),
})

/**
 * Default workflow settings
 */
const defaultSettings = {
  autoSync: false,
  syncInterval: "24h",
  offlineMode: false,
  timeout: "30s",
  skipValidation: false,
  allowIncompatible: true,
}

/**
 * Workflow settings schema
 */
export const WorkflowSettingsSchema = z.object({
  autoSync: z.boolean().default(false),
  syncInterval: intervalSchema,
  offlineMode: z.boolean().default(false),
  timeout: timeoutSchema,
  skipValidation: z.boolean().default(false),
  allowIncompatible: z.boolean().default(true),
})

/**
 * Complete config.yaml schema
 */
export const WorkflowConfigSchema = z.object({
  version: z.number().int().positive().default(1),
  sources: z.array(SourceConfigSchema).default([]),
  settings: WorkflowSettingsSchema.default(defaultSettings),
})

/**
 * Source lock entry schema
 */
export const SourceLockEntrySchema = z.object({
  url: z.string(),
  commit: z.string(),
  syncedAt: z.string(),
})

/**
 * Skill lock entry schema
 */
export const SkillLockEntrySchema = z.object({
  version: z.string(),
  source: z.string(),
  hash: z.string(),
  installedAt: z.string(),
})

/**
 * Template lock entry schema
 */
export const TemplateLockEntrySchema = z.object({
  version: z.string(),
  source: z.string(),
  hash: z.string(),
  installedAt: z.string(),
})

/**
 * Complete sync.lock schema
 */
export const SyncLockSchema = z.object({
  version: z.number().int().positive().default(1),
  lastSync: z.string(),
  sources: z.record(z.string(), SourceLockEntrySchema).default({}),
  skills: z.record(z.string(), SkillLockEntrySchema).default({}),
  templates: z.record(z.string(), TemplateLockEntrySchema).default({}),
})

/**
 * Remote skill entry schema (index.json)
 */
export const RemoteSkillEntrySchema = z.object({
  name: z.string().min(1),
  version: z.string().min(1),
  description: z.string().min(1),
  path: z.string().min(1),
  minDipolecode: z.string().optional(),
  tags: z.array(z.string()).default([]),
  hash: z.string(),
})

/**
 * Remote template entry schema (index.json)
 */
export const RemoteTemplateEntrySchema = z.object({
  name: z.string().min(1),
  version: z.string().min(1),
  description: z.string().min(1),
  path: z.string().min(1),
  type: z.string().optional(),
  hash: z.string(),
})

/**
 * Remote index schema (index.json)
 */
export const RemoteIndexSchema = z.object({
  version: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  lastUpdated: z.string(),
  skills: z.array(RemoteSkillEntrySchema),
  templates: z.array(RemoteTemplateEntrySchema).default([]),
})

// Type exports inferred from schemas
export type WorkflowConfigParsed = z.infer<typeof WorkflowConfigSchema>
export type SourceConfigParsed = z.infer<typeof SourceConfigSchema>
export type WorkflowSettingsParsed = z.infer<typeof WorkflowSettingsSchema>
export type SyncLockParsed = z.infer<typeof SyncLockSchema>
export type SourceLockEntryParsed = z.infer<typeof SourceLockEntrySchema>
export type SkillLockEntryParsed = z.infer<typeof SkillLockEntrySchema>
export type TemplateLockEntryParsed = z.infer<typeof TemplateLockEntrySchema>
export type RemoteIndexParsed = z.infer<typeof RemoteIndexSchema>
export type RemoteSkillEntryParsed = z.infer<typeof RemoteSkillEntrySchema>
export type RemoteTemplateEntryParsed = z.infer<typeof RemoteTemplateEntrySchema>

/**
 * Extract error messages from Zod error
 */
function formatZodError(error: z.ZodError): string {
  // Zod 4 uses .issues instead of .errors
  const issues = error.issues ?? (error as any).errors ?? []
  if (issues.length === 0) {
    return "Validation failed"
  }
  return issues.map((e: any) => `${e.path?.join(".") || ""}: ${e.message}`).join("; ")
}

/**
 * Validate config object and return typed result
 */
export function validateConfig(data: unknown): {
  success: boolean
  data?: WorkflowConfigParsed
  error?: string
} {
  const result = WorkflowConfigSchema.safeParse(data)
  if (result.success) {
    return { success: true, data: result.data }
  }
  return {
    success: false,
    error: formatZodError(result.error),
  }
}

/**
 * Validate sync lock object and return typed result
 */
export function validateSyncLock(data: unknown): {
  success: boolean
  data?: SyncLockParsed
  error?: string
} {
  const result = SyncLockSchema.safeParse(data)
  if (result.success) {
    return { success: true, data: result.data }
  }
  return {
    success: false,
    error: formatZodError(result.error),
  }
}

/**
 * Validate remote index object and return typed result
 */
export function validateRemoteIndex(data: unknown): {
  success: boolean
  data?: RemoteIndexParsed
  error?: string
} {
  const result = RemoteIndexSchema.safeParse(data)
  if (result.success) {
    return { success: true, data: result.data }
  }
  return {
    success: false,
    error: formatZodError(result.error),
  }
}
