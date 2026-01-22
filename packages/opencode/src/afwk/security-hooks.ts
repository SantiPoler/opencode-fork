// aiFRAMEWORK Security Hooks
// Blocks direct access to .afwk/ directory via native tools (bash, edit, write)
// Specification: docs/aiframework-plugin-architecture-v2.1.2.md Section 11

import type { Hooks, PluginInput } from "@opencode-ai/plugin"
import { Log } from "../util/log"

const log = Log.create({ service: "afwk.security" })

// ============================================================================
// Pattern Detection
// ============================================================================

/**
 * Read-only commands that are safe to use on .afwk/
 * These commands cannot modify files/directories
 */
const READONLY_COMMANDS = new Set([
  "cat",
  "head",
  "tail",
  "less",
  "more",
  "ls",
  "dir", // Windows
  "find",
  "grep",
  "rg", // ripgrep
  "wc",
  "stat",
  "file",
  "diff",
  "type", // Windows
  "tree",
  "pwd",
  "echo", // echo alone without redirect is safe
])

/**
 * Check if a command contains .afwk path reference
 */
function containsAfwkPath(command: string): boolean {
  // Normalize and check for .afwk directory reference
  const normalized = command.toLowerCase()
  return (
    normalized.includes(".afwk/") ||
    normalized.includes(".afwk\\") ||
    normalized.includes(".afwk ") ||
    normalized.endsWith(".afwk") ||
    // Match .afwk followed by a non-alphanumeric (like quote or end)
    /\.afwk[^a-z0-9_-]/i.test(command) ||
    /\.afwk$/i.test(command)
  )
}

/**
 * Extract the first command from a bash command line
 * Handles pipes, semicolons, and &&
 */
function extractFirstCommand(command: string): string {
  // Remove leading whitespace and get first word
  const trimmed = command.trim()
  // Get the first word (command name)
  const match = trimmed.match(/^(\S+)/)
  return match ? match[1].toLowerCase() : ""
}

/**
 * Check if a bash command is read-only
 * A command is NOT read-only if:
 * - It's not a known read-only command
 * - It has a redirect (>) that writes to .afwk
 * - It has a pipe (|) where a subsequent command writes to .afwk
 */
function isReadOnlyCommand(command: string): boolean {
  const firstCmd = extractFirstCommand(command)

  // Check if it's a known read-only command
  if (!READONLY_COMMANDS.has(firstCmd)) {
    return false
  }

  // Even read-only commands become write operations with redirects to .afwk
  // Check for redirect operations that target .afwk
  const redirectMatch = command.match(/>\s*([^\s|;]+)/)
  if (redirectMatch) {
    const redirectTarget = redirectMatch[1]
    if (containsAfwkInPath(redirectTarget)) {
      return false // Redirect to .afwk makes it destructive
    }
  }

  // Check for pipes where a write command targets .afwk
  if (command.includes("|")) {
    // After the pipe, check if any command writes to .afwk
    const afterPipe = command.split("|").slice(1).join("|")
    // Check for tee command writing to .afwk
    if (/\btee\b/.test(afterPipe) && containsAfwkInPath(afterPipe)) {
      return false
    }
  }

  return true
}

/**
 * Check if a string contains .afwk path reference
 * Simpler version for checking specific path fragments
 */
function containsAfwkInPath(str: string): boolean {
  const lower = str.toLowerCase()
  return lower.includes(".afwk")
}

// ============================================================================
// Security Check Functions
// ============================================================================

/**
 * Check if a bash command is destructive to .afwk/
 * Returns true if the command could modify .afwk/ contents
 *
 * Strategy:
 * 1. If command doesn't reference .afwk at all, it's safe
 * 2. If command is a known read-only command, it's safe
 * 3. Otherwise, block it (conservative approach)
 */
export function isDestructiveAfwkCommand(command: string): boolean {
  // If command doesn't reference .afwk, it's not destructive to .afwk
  if (!containsAfwkPath(command)) {
    return false
  }

  // If it's a read-only command, allow it
  if (isReadOnlyCommand(command)) {
    return false
  }

  // Any other command that references .afwk is potentially destructive
  return true
}

/**
 * Check if a file path targets the .afwk/ directory
 * Handles both Unix and Windows path separators
 */
export function isAfwkPath(filePath: string | undefined | null): boolean {
  if (!filePath) return false

  // Normalize path for comparison
  const normalized = filePath.replace(/\\/g, "/").toLowerCase()

  // Check for .afwk in path
  return (
    normalized.includes("/.afwk/") ||
    normalized.includes("/.afwk") ||
    normalized.endsWith(".afwk") ||
    normalized.startsWith(".afwk/") ||
    normalized === ".afwk"
  )
}

/**
 * Extract file path from tool arguments
 * Different tools use different argument names
 */
function extractFilePath(
  args: Record<string, unknown> | undefined | null
): string | undefined {
  if (!args) return undefined

  // Common path argument names
  return (
    (args.path as string) ||
    (args.file_path as string) ||
    (args.filePath as string) ||
    (args.file as string) ||
    (args.target as string)
  )
}

// ============================================================================
// Security Error
// ============================================================================

export class AfwkSecurityError extends Error {
  constructor(
    message: string,
    public readonly tool: string,
    public readonly operation: string
  ) {
    super(message)
    this.name = "AfwkSecurityError"
  }
}

// ============================================================================
// Plugin Export
// ============================================================================

/**
 * aiFRAMEWORK Security Plugin
 *
 * Blocks direct modification of .afwk/ directory via native tools.
 * All modifications to .afwk/ should go through afwk_* tools instead.
 *
 * Blocked:
 * - bash: rm, mv, cp, redirects, etc. targeting .afwk/
 * - edit: any path containing .afwk/
 * - write: any path containing .afwk/
 *
 * Allowed:
 * - bash: cat, ls, head, tail, etc. (read-only operations)
 * - read: any path (read-only)
 * - afwk_*: all operations (these are the official tools)
 */
export async function AfwkSecurityPlugin(_input: PluginInput): Promise<Hooks> {
  log.info("aiFRAMEWORK security hooks initialized")

  return {
    "tool.execute.before": async (input, output) => {
      const { tool } = input
      const { args } = output

      // Skip validation for afwk_* tools (they are the official interface)
      if (tool.startsWith("afwk_")) {
        return
      }

      // Check bash commands
      if (tool === "bash" || tool === "Bash") {
        const command = args?.command as string | undefined
        if (command && isDestructiveAfwkCommand(command)) {
          log.warn("blocked destructive bash command targeting .afwk/", {
            command: command.slice(0, 100),
            tool,
          })
          throw new AfwkSecurityError(
            `Cannot modify .afwk/ via bash. Use afwk_* tools instead.\n` +
              `Blocked command: ${command.slice(0, 50)}${command.length > 50 ? "..." : ""}`,
            tool,
            "bash_destructive"
          )
        }
      }

      // Check edit tool
      if (tool === "edit" || tool === "Edit") {
        const filePath = extractFilePath(args)
        if (isAfwkPath(filePath)) {
          log.warn("blocked edit tool targeting .afwk/", {
            path: filePath,
            tool,
          })
          throw new AfwkSecurityError(
            `Cannot modify .afwk/ directly via edit tool. Use afwk_* tools instead.\n` +
              `Blocked path: ${filePath}`,
            tool,
            "edit_afwk"
          )
        }
      }

      // Check write tool
      if (tool === "write" || tool === "Write") {
        const filePath = extractFilePath(args)
        if (isAfwkPath(filePath)) {
          log.warn("blocked write tool targeting .afwk/", {
            path: filePath,
            tool,
          })
          throw new AfwkSecurityError(
            `Cannot modify .afwk/ directly via write tool. Use afwk_* tools instead.\n` +
              `Blocked path: ${filePath}`,
            tool,
            "write_afwk"
          )
        }
      }

      // Check NotebookEdit tool (just in case)
      if (tool === "NotebookEdit" || tool === "notebookEdit") {
        const filePath =
          extractFilePath(args) || (args?.notebook_path as string)
        if (isAfwkPath(filePath)) {
          log.warn("blocked NotebookEdit tool targeting .afwk/", {
            path: filePath,
            tool,
          })
          throw new AfwkSecurityError(
            `Cannot modify .afwk/ directly via NotebookEdit tool. Use afwk_* tools instead.\n` +
              `Blocked path: ${filePath}`,
            tool,
            "notebook_afwk"
          )
        }
      }
    },
  }
}

// Named export for plugin registration
export const name = "afwk-security"
