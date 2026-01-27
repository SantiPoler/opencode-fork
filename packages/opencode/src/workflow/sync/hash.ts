/**
 * Hash Verification Utilities
 * SHA256 integrity verification for downloaded skill files
 *
 * @module workflow/sync/hash
 */

/**
 * Hash prefix for SHA256 hashes
 */
export const HASH_PREFIX = "sha256:"

/**
 * Compute SHA256 hash of string content
 *
 * @param content - String content to hash
 * @returns Hash string with "sha256:" prefix
 */
export async function computeContentHash(content: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(content)
  const hashBuffer = await crypto.subtle.digest("SHA-256", data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return HASH_PREFIX + hashArray.map((b) => b.toString(16).padStart(2, "0")).join("")
}

/**
 * Compute SHA256 hash of a file
 *
 * @param filePath - Path to file
 * @returns Hash string with "sha256:" prefix
 */
export async function computeFileHash(filePath: string): Promise<string> {
  const file = Bun.file(filePath)
  if (!(await file.exists())) {
    throw new Error(`File not found: ${filePath}`)
  }
  const content = await file.text()
  return computeContentHash(content)
}

/**
 * Compute SHA256 hash of binary data
 *
 * @param data - Binary data as Uint8Array or ArrayBuffer
 * @returns Hash string with "sha256:" prefix
 */
export async function computeBinaryHash(data: Uint8Array | ArrayBuffer): Promise<string> {
  // Convert to ArrayBuffer for crypto.subtle.digest
  let buffer: ArrayBuffer
  if (data instanceof ArrayBuffer) {
    buffer = data
  } else {
    // Create a new ArrayBuffer copy from Uint8Array to avoid SharedArrayBuffer issues
    buffer = new ArrayBuffer(data.byteLength)
    new Uint8Array(buffer).set(data)
  }
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return HASH_PREFIX + hashArray.map((b) => b.toString(16).padStart(2, "0")).join("")
}

/**
 * Normalize hash format (ensure prefix)
 *
 * @param hash - Hash string (with or without prefix)
 * @returns Hash string with "sha256:" prefix
 */
export function normalizeHash(hash: string): string {
  if (hash.startsWith(HASH_PREFIX)) {
    return hash
  }
  return HASH_PREFIX + hash
}

/**
 * Verify hash matches expected value
 *
 * @param computed - Computed hash
 * @param expected - Expected hash from index
 * @returns true if hashes match
 */
export function verifyHash(computed: string, expected: string): boolean {
  const normalizedComputed = normalizeHash(computed)
  const normalizedExpected = normalizeHash(expected)
  return normalizedComputed === normalizedExpected
}

/**
 * Extract hash value without prefix
 *
 * @param hash - Hash string (with or without prefix)
 * @returns Hash value without prefix
 */
export function extractHashValue(hash: string): string {
  if (hash.startsWith(HASH_PREFIX)) {
    return hash.slice(HASH_PREFIX.length)
  }
  return hash
}

/**
 * Validate hash format
 *
 * @param hash - Hash string to validate
 * @returns true if hash is valid SHA256 format
 */
export function isValidHashFormat(hash: string): boolean {
  const value = extractHashValue(hash)
  // SHA256 produces 64 hex characters
  return /^[a-f0-9]{64}$/i.test(value)
}
