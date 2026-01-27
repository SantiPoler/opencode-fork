/**
 * Workflow Sync Error Classes
 * Specialized error types for sync operations with user-friendly messages
 *
 * @module workflow/sync/errors
 */

/**
 * Error codes for sync operations
 */
export enum SyncErrorCode {
  // Network errors
  NETWORK_TIMEOUT = "SYNC_NETWORK_TIMEOUT",
  NETWORK_UNREACHABLE = "SYNC_NETWORK_UNREACHABLE",

  // Auth errors
  AUTH_FAILED = "SYNC_AUTH_FAILED",
  AUTH_TOKEN_MISSING = "SYNC_AUTH_TOKEN_MISSING",

  // Validation errors
  INVALID_INDEX = "SYNC_INVALID_INDEX",
  INVALID_SKILL = "SYNC_INVALID_SKILL",
  HASH_MISMATCH = "SYNC_HASH_MISMATCH",

  // Config errors
  CONFIG_INVALID = "SYNC_CONFIG_INVALID",
  CONFIG_NOT_FOUND = "SYNC_CONFIG_NOT_FOUND",
  SOURCE_NOT_FOUND = "SYNC_SOURCE_NOT_FOUND",
  SOURCE_EXISTS = "SYNC_SOURCE_EXISTS",

  // Lock errors
  LOCK_CORRUPTED = "SYNC_LOCK_CORRUPTED",

  // Filesystem errors
  WRITE_FAILED = "SYNC_WRITE_FAILED",
  PERMISSION_DENIED = "SYNC_PERMISSION_DENIED",
}

/**
 * Base error class for sync operations
 */
export class SyncError extends Error {
  constructor(
    message: string,
    public readonly code: SyncErrorCode,
    public readonly source?: string,
    public readonly skill?: string,
  ) {
    super(message)
    this.name = "SyncError"
  }

  /**
   * Get user-friendly error message with suggested action
   */
  getUserMessage(): string {
    switch (this.code) {
      case SyncErrorCode.NETWORK_TIMEOUT:
        return `Network timeout${this.source ? ` for ${this.source}` : ""}. Check your internet connection or increase the timeout in config.yaml.`

      case SyncErrorCode.NETWORK_UNREACHABLE:
        return `Could not reach ${this.source || "the server"}. Check your internet connection or try again later.`

      case SyncErrorCode.AUTH_FAILED:
        return `Authentication failed for ${this.source}. Verify your token is valid and has the required permissions.`

      case SyncErrorCode.AUTH_TOKEN_MISSING:
        return `Authentication required for ${this.source}. Set the environment variable specified in config.yaml.`

      case SyncErrorCode.INVALID_INDEX:
        return `Invalid index.json from ${this.source}. The repository may be misconfigured or incompatible.`

      case SyncErrorCode.INVALID_SKILL:
        return `Invalid skill format for '${this.skill}'. The SKILL.md file may be malformed.`

      case SyncErrorCode.HASH_MISMATCH:
        return `Integrity check failed for skill '${this.skill}'. The file may have been tampered with or corrupted during download.`

      case SyncErrorCode.CONFIG_INVALID:
        return `Invalid configuration in config.yaml. Run 'opencode workflow source list' to check your configuration.`

      case SyncErrorCode.SOURCE_NOT_FOUND:
        return `Source '${this.source}' not found. Run 'opencode workflow source list' to see available sources.`

      case SyncErrorCode.SOURCE_EXISTS:
        return `Source '${this.source}' already exists. Use a different name or remove the existing source first.`

      case SyncErrorCode.LOCK_CORRUPTED:
        return "Sync lock file is corrupted. It will be recreated on next sync."

      case SyncErrorCode.WRITE_FAILED:
        return `Failed to write to disk. Check available disk space and permissions.`

      case SyncErrorCode.PERMISSION_DENIED:
        return `Permission denied. Check that you have write access to ~/.aifwk/`

      default:
        return this.message
    }
  }
}

/**
 * Configuration-specific error
 */
export class ConfigError extends SyncError {
  constructor(message: string, code: SyncErrorCode = SyncErrorCode.CONFIG_INVALID, source?: string) {
    super(message, code, source)
    this.name = "ConfigError"
  }
}

/**
 * Network-specific error
 */
export class NetworkError extends SyncError {
  constructor(
    message: string,
    code: SyncErrorCode,
    source?: string,
    public readonly statusCode?: number,
    skill?: string,
  ) {
    super(message, code, source, skill)
    this.name = "NetworkError"
  }
}

/**
 * Validation-specific error
 */
export class ValidationError extends SyncError {
  constructor(message: string, code: SyncErrorCode, source?: string, skill?: string) {
    super(message, code, source, skill)
    this.name = "ValidationError"
  }
}

/**
 * Create appropriate error from HTTP response
 */
export function errorFromResponse(response: Response, source: string, skill?: string): NetworkError {
  const status = response.status

  if (status === 401 || status === 403) {
    return new NetworkError(
      `Authentication failed (HTTP ${status})`,
      SyncErrorCode.AUTH_FAILED,
      source,
      status,
      skill,
    )
  }

  if (status === 404) {
    return new NetworkError(
      `Resource not found (HTTP 404)`,
      SyncErrorCode.INVALID_INDEX,
      source,
      status,
      skill,
    )
  }

  if (status >= 500) {
    return new NetworkError(
      `Server error (HTTP ${status})`,
      SyncErrorCode.NETWORK_UNREACHABLE,
      source,
      status,
      skill,
    )
  }

  return new NetworkError(
    `HTTP ${status}: ${response.statusText}`,
    SyncErrorCode.NETWORK_UNREACHABLE,
    source,
    status,
    skill,
  )
}

/**
 * Create timeout error
 */
export function timeoutError(source: string, timeoutMs: number): NetworkError {
  return new NetworkError(
    `Request timed out after ${timeoutMs}ms`,
    SyncErrorCode.NETWORK_TIMEOUT,
    source,
  )
}

/**
 * Create network error from caught exception
 */
export function networkErrorFromException(error: unknown, source: string): NetworkError {
  if (error instanceof Error) {
    if (error.name === "AbortError") {
      return new NetworkError(
        "Request was aborted",
        SyncErrorCode.NETWORK_TIMEOUT,
        source,
      )
    }
    return new NetworkError(
      `Network error: ${error.message}`,
      SyncErrorCode.NETWORK_UNREACHABLE,
      source,
    )
  }
  return new NetworkError(
    `Network error: ${String(error)}`,
    SyncErrorCode.NETWORK_UNREACHABLE,
    source,
  )
}
