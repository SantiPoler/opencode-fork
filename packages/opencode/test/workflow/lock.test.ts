import { test, expect } from "bun:test"
import {
  createEmptyLock,
  compareVersions,
  skillNeedsUpdate,
} from "../../src/workflow/sync/lock"
import {
  SyncError,
  ConfigError,
  NetworkError,
  ValidationError,
  SyncErrorCode,
  errorFromResponse,
  timeoutError,
  networkErrorFromException,
} from "../../src/workflow/sync/errors"
import type { SyncLockParsed } from "../../src/workflow/config/schema"

// Lock creation tests
test("createEmptyLock creates valid structure", () => {
  const lock = createEmptyLock()

  expect(lock.version).toBe(1)
  expect(lock.lastSync).toBeDefined()
  expect(typeof lock.lastSync).toBe("string")
  expect(lock.sources).toEqual({})
  expect(lock.skills).toEqual({})
})

test("createEmptyLock sets current timestamp", () => {
  const before = new Date().toISOString()
  const lock = createEmptyLock()
  const after = new Date().toISOString()

  expect(lock.lastSync >= before).toBe(true)
  expect(lock.lastSync <= after).toBe(true)
})

// Version comparison tests
test("compareVersions handles equal versions", () => {
  expect(compareVersions("1.0.0", "1.0.0")).toBe(0)
  expect(compareVersions("2.5.3", "2.5.3")).toBe(0)
})

test("compareVersions handles major version differences", () => {
  expect(compareVersions("2.0.0", "1.0.0")).toBeGreaterThan(0)
  expect(compareVersions("1.0.0", "2.0.0")).toBeLessThan(0)
})

test("compareVersions handles minor version differences", () => {
  expect(compareVersions("1.2.0", "1.1.0")).toBeGreaterThan(0)
  expect(compareVersions("1.1.0", "1.2.0")).toBeLessThan(0)
})

test("compareVersions handles patch version differences", () => {
  expect(compareVersions("1.0.2", "1.0.1")).toBeGreaterThan(0)
  expect(compareVersions("1.0.1", "1.0.2")).toBeLessThan(0)
})

test("compareVersions handles prerelease versions", () => {
  // No prerelease > with prerelease
  expect(compareVersions("1.0.0", "1.0.0-alpha")).toBeGreaterThan(0)
  expect(compareVersions("1.0.0-alpha", "1.0.0")).toBeLessThan(0)

  // Alphabetical comparison for prereleases
  expect(compareVersions("1.0.0-beta", "1.0.0-alpha")).toBeGreaterThan(0)
  expect(compareVersions("1.0.0-alpha", "1.0.0-beta")).toBeLessThan(0)
})

test("compareVersions handles missing parts", () => {
  expect(compareVersions("1.0", "1.0.0")).toBe(0)
  expect(compareVersions("1", "1.0.0")).toBe(0)
})

// skillNeedsUpdate tests
test("skillNeedsUpdate returns true for new skills", () => {
  const lock: SyncLockParsed = createEmptyLock()
  expect(skillNeedsUpdate(lock, "new-skill", "1.0.0")).toBe(true)
})

test("skillNeedsUpdate returns true when remote is newer", () => {
  const lock: SyncLockParsed = {
    ...createEmptyLock(),
    skills: {
      "test-skill": {
        version: "1.0.0",
        source: "official",
        hash: "sha256:abc",
        installedAt: new Date().toISOString(),
      },
    },
  }

  expect(skillNeedsUpdate(lock, "test-skill", "1.1.0")).toBe(true)
  expect(skillNeedsUpdate(lock, "test-skill", "2.0.0")).toBe(true)
})

test("skillNeedsUpdate returns false when up to date", () => {
  const lock: SyncLockParsed = {
    ...createEmptyLock(),
    skills: {
      "test-skill": {
        version: "1.0.0",
        source: "official",
        hash: "sha256:abc",
        installedAt: new Date().toISOString(),
      },
    },
  }

  expect(skillNeedsUpdate(lock, "test-skill", "1.0.0")).toBe(false)
})

test("skillNeedsUpdate returns false when local is newer", () => {
  const lock: SyncLockParsed = {
    ...createEmptyLock(),
    skills: {
      "test-skill": {
        version: "2.0.0",
        source: "official",
        hash: "sha256:abc",
        installedAt: new Date().toISOString(),
      },
    },
  }

  expect(skillNeedsUpdate(lock, "test-skill", "1.0.0")).toBe(false)
})

// Error class tests
test("SyncError creates with correct properties", () => {
  const error = new SyncError("Test error", SyncErrorCode.NETWORK_TIMEOUT, "official", "test-skill")

  expect(error.message).toBe("Test error")
  expect(error.code).toBe(SyncErrorCode.NETWORK_TIMEOUT)
  expect(error.source).toBe("official")
  expect(error.skill).toBe("test-skill")
  expect(error.name).toBe("SyncError")
})

test("SyncError.getUserMessage returns helpful messages", () => {
  const timeoutErr = new SyncError("timeout", SyncErrorCode.NETWORK_TIMEOUT, "official")
  expect(timeoutErr.getUserMessage()).toContain("timeout")
  expect(timeoutErr.getUserMessage()).toContain("official")

  const authErr = new SyncError("auth", SyncErrorCode.AUTH_TOKEN_MISSING, "private-repo")
  expect(authErr.getUserMessage()).toContain("Authentication")
  expect(authErr.getUserMessage()).toContain("private-repo")

  const hashErr = new SyncError("hash", SyncErrorCode.HASH_MISMATCH, "official", "bad-skill")
  expect(hashErr.getUserMessage()).toContain("Integrity")
  expect(hashErr.getUserMessage()).toContain("bad-skill")
})

test("ConfigError is a SyncError", () => {
  const error = new ConfigError("Config error", SyncErrorCode.CONFIG_INVALID)
  expect(error).toBeInstanceOf(SyncError)
  expect(error.name).toBe("ConfigError")
})

test("NetworkError includes status code", () => {
  const error = new NetworkError("HTTP error", SyncErrorCode.AUTH_FAILED, "source", 401)
  expect(error.statusCode).toBe(401)
  expect(error.name).toBe("NetworkError")
})

test("ValidationError includes skill info", () => {
  const error = new ValidationError("Invalid", SyncErrorCode.INVALID_SKILL, "official", "bad-skill")
  expect(error.skill).toBe("bad-skill")
  expect(error.name).toBe("ValidationError")
})

// Error factory function tests
test("errorFromResponse creates correct errors for status codes", () => {
  const response401 = { status: 401, statusText: "Unauthorized" } as Response
  const err401 = errorFromResponse(response401, "test")
  expect(err401.code).toBe(SyncErrorCode.AUTH_FAILED)

  const response403 = { status: 403, statusText: "Forbidden" } as Response
  const err403 = errorFromResponse(response403, "test")
  expect(err403.code).toBe(SyncErrorCode.AUTH_FAILED)

  const response404 = { status: 404, statusText: "Not Found" } as Response
  const err404 = errorFromResponse(response404, "test")
  expect(err404.code).toBe(SyncErrorCode.INVALID_INDEX)

  const response500 = { status: 500, statusText: "Internal Server Error" } as Response
  const err500 = errorFromResponse(response500, "test")
  expect(err500.code).toBe(SyncErrorCode.NETWORK_UNREACHABLE)
})

test("timeoutError creates timeout error", () => {
  const error = timeoutError("test-source", 30000)
  expect(error.code).toBe(SyncErrorCode.NETWORK_TIMEOUT)
  expect(error.source).toBe("test-source")
  expect(error.message).toContain("30000")
})

test("networkErrorFromException handles AbortError", () => {
  const abortError = new Error("Aborted")
  abortError.name = "AbortError"
  const error = networkErrorFromException(abortError, "test")
  expect(error.code).toBe(SyncErrorCode.NETWORK_TIMEOUT)
})

test("networkErrorFromException handles generic errors", () => {
  const genericError = new Error("Connection refused")
  const error = networkErrorFromException(genericError, "test")
  expect(error.code).toBe(SyncErrorCode.NETWORK_UNREACHABLE)
  expect(error.message).toContain("Connection refused")
})

test("networkErrorFromException handles non-Error values", () => {
  const error = networkErrorFromException("string error", "test")
  expect(error.code).toBe(SyncErrorCode.NETWORK_UNREACHABLE)
  expect(error.message).toContain("string error")
})
