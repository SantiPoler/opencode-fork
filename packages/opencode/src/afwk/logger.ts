/**
 * AFWK Logger
 * Redirects AFWK debug logs to a file instead of console
 */

import * as fs from "fs"
import * as path from "path"
import { Instance } from "../project/instance"

// Log file path - stored in project root
const LOG_FILENAME = "afwk-debug.log"

// Maximum log file size (1MB)
const MAX_LOG_SIZE = 1 * 1024 * 1024

// Whether logging is enabled (can be toggled)
let loggingEnabled = true

/**
 * Get the log file path
 */
function getLogPath(): string {
  try {
    return path.join(Instance.directory, LOG_FILENAME)
  } catch {
    // Fallback if Instance is not available
    return path.join(process.cwd(), LOG_FILENAME)
  }
}

/**
 * Rotate log file if it's too large
 */
function rotateLogIfNeeded(): void {
  try {
    const logPath = getLogPath()
    if (fs.existsSync(logPath)) {
      const stats = fs.statSync(logPath)
      if (stats.size > MAX_LOG_SIZE) {
        // Rename old log to .old
        const oldLogPath = logPath + ".old"
        if (fs.existsSync(oldLogPath)) {
          fs.unlinkSync(oldLogPath)
        }
        fs.renameSync(logPath, oldLogPath)
      }
    }
  } catch {
    // Ignore rotation errors
  }
}

/**
 * Write a log entry to the file
 */
function writeLog(level: string, prefix: string, ...args: unknown[]): void {
  if (!loggingEnabled) return

  try {
    rotateLogIfNeeded()

    const timestamp = new Date().toISOString()
    const message = args
      .map((arg) => {
        if (typeof arg === "string") return arg
        if (arg instanceof Error) return `${arg.name}: ${arg.message}\n${arg.stack}`
        try {
          return JSON.stringify(arg, null, 2)
        } catch {
          return String(arg)
        }
      })
      .join(" ")

    const logLine = `[${timestamp}] [${level}] ${prefix} ${message}\n`

    fs.appendFileSync(getLogPath(), logLine, "utf-8")
  } catch {
    // Silently fail - we don't want logging errors to break the app
  }
}

/**
 * AFWK Logger - writes to file instead of console
 */
export const AfwkLog = {
  /**
   * Log debug info (replaces console.error for debug output)
   */
  debug(prefix: string, ...args: unknown[]): void {
    writeLog("DEBUG", prefix, ...args)
  },

  /**
   * Log info
   */
  info(prefix: string, ...args: unknown[]): void {
    writeLog("INFO", prefix, ...args)
  },

  /**
   * Log warning
   */
  warn(prefix: string, ...args: unknown[]): void {
    writeLog("WARN", prefix, ...args)
  },

  /**
   * Log error
   */
  error(prefix: string, ...args: unknown[]): void {
    writeLog("ERROR", prefix, ...args)
  },

  /**
   * Enable/disable logging
   */
  setEnabled(enabled: boolean): void {
    loggingEnabled = enabled
  },

  /**
   * Check if logging is enabled
   */
  isEnabled(): boolean {
    return loggingEnabled
  },

  /**
   * Clear the log file
   */
  clear(): void {
    try {
      const logPath = getLogPath()
      if (fs.existsSync(logPath)) {
        fs.writeFileSync(logPath, "", "utf-8")
      }
    } catch {
      // Ignore errors
    }
  },

  /**
   * Get the log file path
   */
  getLogPath(): string {
    return getLogPath()
  },
}
