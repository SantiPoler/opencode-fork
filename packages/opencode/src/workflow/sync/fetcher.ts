/**
 * Remote Index Fetcher
 * Fetch and parse index.json from remote skill repositories
 *
 * @module workflow/sync/fetcher
 */

import { RemoteIndexSchema, type RemoteIndexParsed } from "../config/schema"
import { getGitHubRawUrl, NETWORK_DEFAULTS, parseTimeoutString } from "../config/defaults"
import { SyncError, NetworkError, SyncErrorCode, errorFromResponse, timeoutError, networkErrorFromException } from "./errors"
import type { SourceConfigParsed, WorkflowSettingsParsed } from "../config/schema"

/**
 * Headers used for fetch requests
 */
function buildHeaders(source: SourceConfigParsed): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "User-Agent": "dipoleCODE-sync/1.0",
  }

  // Add auth header if configured
  if (source.auth) {
    const token = process.env[source.auth.env]
    if (!token) {
      throw new SyncError(
        `Environment variable '${source.auth.env}' not set`,
        SyncErrorCode.AUTH_TOKEN_MISSING,
        source.name,
      )
    }

    if (source.auth.type === "github-token") {
      headers["Authorization"] = `token ${token}`
    } else {
      headers["Authorization"] = `Bearer ${token}`
    }
  }

  return headers
}

/**
 * Fetch index.json from a source repository
 *
 * @param source - Source configuration
 * @param settings - Workflow settings (for timeout)
 * @returns Parsed and validated remote index
 * @throws SyncError for network, auth, or validation errors
 */
export async function fetchRemoteIndex(
  source: SourceConfigParsed,
  settings: WorkflowSettingsParsed,
): Promise<RemoteIndexParsed> {
  const indexUrl = getGitHubRawUrl(source.url, source.branch, "index.json")
  const timeout = parseTimeoutString(settings.timeout)
  const headers = buildHeaders(source)

  let response: Response
  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeout)

    response = await fetch(indexUrl, {
      headers,
      signal: controller.signal,
    })

    clearTimeout(timeoutId)
  } catch (error) {
    if (error instanceof SyncError) {
      throw error
    }
    if (error instanceof Error && error.name === "AbortError") {
      throw timeoutError(source.name, timeout)
    }
    throw networkErrorFromException(error, source.name)
  }

  if (!response.ok) {
    throw errorFromResponse(response, source.name)
  }

  let json: unknown
  try {
    json = await response.json()
  } catch {
    throw new SyncError("Invalid JSON response from index.json", SyncErrorCode.INVALID_INDEX, source.name)
  }

  const result = RemoteIndexSchema.safeParse(json)
  if (!result.success) {
    // Format Zod error
    const issues = result.error.issues ?? []
    const errorMsg = issues.map((e) => `${e.path?.join(".") || ""}: ${e.message}`).join("; ")
    throw new SyncError(`Invalid index format: ${errorMsg}`, SyncErrorCode.INVALID_INDEX, source.name)
  }

  return result.data
}

/**
 * Fetch raw content from a URL
 *
 * @param url - URL to fetch
 * @param headers - Request headers
 * @param timeout - Timeout in milliseconds
 * @returns Response text content
 */
export async function fetchRawContent(
  url: string,
  headers: Record<string, string>,
  timeout: number,
): Promise<string> {
  let response: Response
  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeout)

    response = await fetch(url, {
      headers,
      signal: controller.signal,
    })

    clearTimeout(timeoutId)
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new NetworkError(`Request timed out after ${timeout}ms`, SyncErrorCode.NETWORK_TIMEOUT, "unknown", timeout)
    }
    throw networkErrorFromException(error, "unknown")
  }

  if (!response.ok) {
    throw errorFromResponse(response, "unknown")
  }

  return response.text()
}

/**
 * Sleep utility for retry backoff
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Fetch with exponential backoff retry logic
 *
 * @param fn - Async function to retry
 * @param maxRetries - Maximum number of retries (default from NETWORK_DEFAULTS)
 * @returns Result of successful fetch
 * @throws Last error if all retries fail
 */
export async function fetchWithRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = NETWORK_DEFAULTS.maxRetries,
): Promise<T> {
  let lastError: Error | undefined
  let delay: number = NETWORK_DEFAULTS.backoffInitial

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))

      // Don't retry auth errors - they won't succeed
      if (error instanceof SyncError) {
        if (
          error.code === SyncErrorCode.AUTH_FAILED ||
          error.code === SyncErrorCode.AUTH_TOKEN_MISSING
        ) {
          throw error
        }
      }

      if (attempt < maxRetries) {
        await sleep(delay)
        delay = Math.min(delay * 2, NETWORK_DEFAULTS.backoffMax)
      }
    }
  }

  throw lastError
}

/**
 * Build headers for a source (exported for downloader)
 */
export function getSourceHeaders(source: SourceConfigParsed): Record<string, string> {
  return buildHeaders(source)
}
