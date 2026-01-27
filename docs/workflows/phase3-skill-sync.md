# Workflow: Phase 3 - Skill Synchronization System

> Implementation workflow generado desde `docs/prd/remote-workflows-phase3.md`

**Version**: 1.0.0
**Fecha**: 2026-01-23
**Prerequisito**: Phase 2 (Discovery) completada
**Estimación Total**: 4 semanas (~55 horas)

---

## Tabla de Contenidos

1. [Resumen de Implementación](#resumen-de-implementación)
2. [Dependencias del Proyecto](#dependencias-del-proyecto)
3. [Estructura de Archivos](#estructura-de-archivos)
4. [Semana 1: Foundation](#semana-1-foundation)
5. [Semana 2: Core Sync](#semana-2-core-sync)
6. [Semana 3: Commands](#semana-3-commands)
7. [Semana 4: Polish & Test](#semana-4-polish--test)
8. [Criterios de Validación](#criterios-de-validación)
9. [Riesgos y Mitigaciones](#riesgos-y-mitigaciones)

---

## Resumen de Implementación

### Objetivo
Crear un sistema de sincronización de skills que permita:
- Sincronizar skills desde repositorios GitHub remotos
- Gestionar múltiples fuentes (sources) con prioridad configurable
- Mantener un cache local con tracking de versiones
- Funcionar en modo offline con skills previamente cacheados

### Arquitectura de Alto Nivel

```
┌─────────────────────────────────────────────────────────────────────┐
│                     SKILL SYNC SYSTEM (Phase 3)                       │
├─────────────────────────────────────────────────────────────────────┤
│                                                                       │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐           │
│  │   Config     │    │    Sync      │    │   Commands   │           │
│  │   System     │───▶│   Engine     │◀───│   (CLI)      │           │
│  │ config.yaml  │    │ fetch/dl/    │    │ sync/list/   │           │
│  │  sync.lock   │    │ validate     │    │ info/source  │           │
│  └──────────────┘    └──────────────┘    └──────────────┘           │
│         │                   │                   │                    │
│         └───────────────────┼───────────────────┘                    │
│                             │                                        │
│                             ▼                                        │
│                   ┌──────────────────┐                               │
│                   │ Phase 2 Integration │                            │
│                   │ src/skill/discovery │                            │
│                   │ src/skill/validator │                            │
│                   └──────────────────┘                               │
│                                                                       │
└─────────────────────────────────────────────────────────────────────┘
```

### Entregables Clave
| # | Entregable | Descripción |
|---|------------|-------------|
| 1 | Config System | `~/.aifwk/config.yaml` con schema Zod |
| 2 | Lock System | `~/.aifwk/sync.lock` para tracking |
| 3 | Sync Engine | Fetcher, comparator, downloader, validator |
| 4 | CLI Commands | `workflow sync/list/info/outdated/source` |
| 5 | Tests | Unit + Integration con coverage >80% |

---

## Dependencias del Proyecto

### Existentes (Reutilizar)
| Módulo | Ubicación | Uso |
|--------|-----------|-----|
| Skill Discovery | `src/skill/discovery.ts` | Detectar skills cacheados |
| Skill Validator | `src/skill/validator.ts` | Validar skills descargados |
| Skill Types | `src/skill/types.ts` | Interfaces base |
| Skill Constants | `src/skill/constants.ts` | Paths y patrones |
| CLI Framework | `src/cli/cmd/cmd.ts` | Patrón de comandos |
| Config System | `src/config/config.ts` | Patrón de configuración |
| UI System | `src/cli/ui.ts` | Prompts y spinners |

### Nuevas (Crear)
| Módulo | Ubicación | Propósito |
|--------|-----------|-----------|
| Workflow Types | `src/workflow/types.ts` | Interfaces nuevas |
| Config Schema | `src/workflow/config/schema.ts` | Zod schemas |
| Config Loader | `src/workflow/config/loader.ts` | Load/save config |
| Lock Manager | `src/workflow/sync/lock.ts` | Gestión sync.lock |
| Index Fetcher | `src/workflow/sync/fetcher.ts` | Fetch index.json |
| Version Comparator | `src/workflow/sync/comparator.ts` | Comparar versiones |
| Skill Downloader | `src/workflow/sync/downloader.ts` | Download skills |
| Sync Command | `src/workflow/commands/sync.ts` | CLI sync |
| List Command | `src/workflow/commands/list.ts` | CLI list |
| Info Command | `src/workflow/commands/info.ts` | CLI info |
| Outdated Command | `src/workflow/commands/outdated.ts` | CLI outdated |
| Source Command | `src/workflow/commands/source.ts` | CLI source |

---

## Estructura de Archivos

```
packages/opencode/src/
├── workflow/                          # 🆕 Nuevo módulo Phase 3
│   ├── index.ts                       # Exports públicos
│   ├── types.ts                       # TypeScript interfaces
│   │
│   ├── config/
│   │   ├── schema.ts                  # Zod schemas para config.yaml
│   │   ├── loader.ts                  # Load/save/validate config
│   │   └── defaults.ts                # Configuración por defecto
│   │
│   ├── sync/
│   │   ├── fetcher.ts                 # Fetch index.json de repos
│   │   ├── comparator.ts              # Comparar versiones
│   │   ├── downloader.ts              # Download SKILL.md files
│   │   ├── lock.ts                    # Gestionar sync.lock
│   │   ├── hash.ts                    # Verificación de integridad
│   │   └── errors.ts                  # Error classes
│   │
│   └── commands/
│       ├── sync.ts                    # workflow sync command
│       ├── list.ts                    # workflow list command
│       ├── info.ts                    # workflow info command
│       ├── outdated.ts                # workflow outdated command
│       └── source.ts                  # workflow source subcommands
│
├── skill/                             # ✅ Existente (Phase 2)
│   ├── discovery.ts                   # Ya implementado
│   ├── resolver.ts                    # Ya implementado
│   ├── validator.ts                   # Ya implementado
│   ├── types.ts                       # Extender si necesario
│   └── constants.ts                   # Extender si necesario
│
└── cli/
    └── cmd/
        └── workflow.ts                # 🆕 Entry point CLI

packages/opencode/test/
└── workflow/                          # 🆕 Tests Phase 3
    ├── config.test.ts
    ├── sync.test.ts
    ├── lock.test.ts
    ├── fetcher.test.ts
    └── commands.test.ts
```

---

## Semana 1: Foundation

### Objetivo
Establecer la infraestructura base: tipos TypeScript, sistema de configuración y gestión del lock file.

---

### aiTASK 01: Types & Interfaces

**Archivo**: `src/workflow/types.ts`
**Estimación**: 2h
**Dependencias**: Ninguna

#### Descripción
Definir todas las interfaces TypeScript compartidas para el módulo workflow.

#### Interfaces a Implementar

```typescript
// src/workflow/types.ts

/**
 * Configuration for a skill source (repository)
 */
export interface SourceConfig {
  /** Unique name for this source */
  name: string
  /** GitHub repository URL */
  url: string
  /** Branch to sync from (default: main) */
  branch: string
  /** Whether this source is enabled */
  enabled: boolean
  /** Priority for conflict resolution (higher = preferred) */
  priority: number
  /** Optional authentication config */
  auth?: AuthConfig
}

/**
 * Authentication configuration for private repos
 */
export interface AuthConfig {
  type: 'github-token' | 'bearer'
  /** Environment variable name containing the token */
  env: string
}

/**
 * Global workflow settings
 */
export interface WorkflowSettings {
  /** Auto-sync on startup (Phase 4) */
  autoSync: boolean
  /** Interval for auto-sync (Phase 4) */
  syncInterval: string
  /** Use only cached skills, no network */
  offlineMode: boolean
  /** Network request timeout */
  timeout: string
  /** Skip frontmatter validation */
  skipValidation: boolean
  /** Install skills with version warnings */
  allowIncompatible: boolean
}

/**
 * Complete workflow configuration (config.yaml)
 */
export interface WorkflowConfig {
  version: number
  sources: SourceConfig[]
  settings: WorkflowSettings
}

/**
 * Lock entry for a synced source
 */
export interface SourceLockEntry {
  url: string
  commit: string
  syncedAt: string
}

/**
 * Lock entry for a synced skill
 */
export interface SkillLockEntry {
  version: string
  source: string
  hash: string
  installedAt: string
}

/**
 * Complete sync lock file (sync.lock)
 */
export interface SyncLock {
  version: number
  lastSync: string
  sources: Record<string, SourceLockEntry>
  skills: Record<string, SkillLockEntry>
}

/**
 * Remote repository index (index.json)
 */
export interface RemoteIndex {
  version: string
  name: string
  description: string
  lastUpdated: string
  skills: RemoteSkillEntry[]
}

/**
 * Single skill entry in remote index
 */
export interface RemoteSkillEntry {
  name: string
  version: string
  description: string
  path: string
  minDipolecode?: string
  tags: string[]
  hash: string
}

/**
 * Result of a sync operation
 */
export interface SyncResult {
  success: boolean
  updated: SkillSyncResult[]
  added: SkillSyncResult[]
  failed: SkillSyncError[]
  warnings: string[]
  duration: number
}

/**
 * Successfully synced skill
 */
export interface SkillSyncResult {
  name: string
  version: string
  source: string
  previousVersion?: string
}

/**
 * Failed skill sync
 */
export interface SkillSyncError {
  name: string
  source: string
  error: string
}
```

#### Criterios de Aceptación
- [ ] Todas las interfaces del PRD implementadas
- [ ] JSDoc comments en cada interface
- [ ] Export desde `src/workflow/index.ts`
- [ ] No dependencias circulares

---

### aiTASK 02: Config Schema & Validation

**Archivo**: `src/workflow/config/schema.ts`
**Estimación**: 2h
**Dependencias**: aiTASK 01

#### Descripción
Implementar Zod schemas para validación estricta de config.yaml.

#### Schemas a Implementar

```typescript
// src/workflow/config/schema.ts

import { z } from "zod"

/**
 * URL validation for repository URLs
 */
const urlSchema = z.string().url().refine(
  (url) => url.startsWith("https://"),
  { message: "Only HTTPS URLs are allowed for security" }
)

/**
 * Auth config schema
 */
export const AuthConfigSchema = z.object({
  type: z.enum(["github-token", "bearer"]),
  env: z.string().min(1, "Environment variable name required"),
})

/**
 * Source config schema
 */
export const SourceConfigSchema = z.object({
  name: z.string()
    .min(1, "Source name required")
    .regex(/^[a-z][a-z0-9-]*$/, "Source name must be kebab-case"),
  url: urlSchema,
  branch: z.string().default("main"),
  enabled: z.boolean().default(true),
  priority: z.number().int().min(0).max(1000).default(50),
  auth: AuthConfigSchema.optional(),
})

/**
 * Workflow settings schema
 */
export const WorkflowSettingsSchema = z.object({
  autoSync: z.boolean().default(false),
  syncInterval: z.string().default("24h"),
  offlineMode: z.boolean().default(false),
  timeout: z.string().default("30s"),
  skipValidation: z.boolean().default(false),
  allowIncompatible: z.boolean().default(true),
})

/**
 * Complete config schema
 */
export const WorkflowConfigSchema = z.object({
  version: z.number().int().positive().default(1),
  sources: z.array(SourceConfigSchema).default([]),
  settings: WorkflowSettingsSchema.default({}),
})

/**
 * Sync lock schemas
 */
export const SourceLockEntrySchema = z.object({
  url: z.string(),
  commit: z.string(),
  syncedAt: z.string().datetime(),
})

export const SkillLockEntrySchema = z.object({
  version: z.string(),
  source: z.string(),
  hash: z.string(),
  installedAt: z.string().datetime(),
})

export const SyncLockSchema = z.object({
  version: z.number().int().positive().default(1),
  lastSync: z.string().datetime(),
  sources: z.record(SourceLockEntrySchema).default({}),
  skills: z.record(SkillLockEntrySchema).default({}),
})

/**
 * Remote index schema
 */
export const RemoteSkillEntrySchema = z.object({
  name: z.string(),
  version: z.string(),
  description: z.string(),
  path: z.string(),
  minDipolecode: z.string().optional(),
  tags: z.array(z.string()).default([]),
  hash: z.string(),
})

export const RemoteIndexSchema = z.object({
  version: z.string(),
  name: z.string(),
  description: z.string(),
  lastUpdated: z.string().datetime(),
  skills: z.array(RemoteSkillEntrySchema),
})

// Type exports
export type WorkflowConfigParsed = z.infer<typeof WorkflowConfigSchema>
export type SyncLockParsed = z.infer<typeof SyncLockSchema>
export type RemoteIndexParsed = z.infer<typeof RemoteIndexSchema>
```

#### Criterios de Aceptación
- [ ] Schema valida config.yaml correctamente
- [ ] Schema rechaza URLs HTTP (solo HTTPS)
- [ ] Defaults aplicados cuando valores no presentes
- [ ] Mensajes de error claros y accionables

---

### aiTASK 03: Config Loader

**Archivo**: `src/workflow/config/loader.ts`
**Estimación**: 2h
**Dependencias**: aiTASK 02

#### Descripción
Implementar carga, validación y escritura de config.yaml.

#### Funciones a Implementar

```typescript
// src/workflow/config/loader.ts

import path from "path"
import os from "os"
import yaml from "yaml"
import { WorkflowConfigSchema, type WorkflowConfigParsed } from "./schema"

/** Path to config file */
export const CONFIG_PATH = path.join(os.homedir(), ".aifwk", "config.yaml")

/**
 * Default configuration for new installations
 */
export function getDefaultConfig(): WorkflowConfigParsed {
  return {
    version: 1,
    sources: [
      {
        name: "official",
        url: "https://github.com/aifwk/workflow-catalog",
        branch: "main",
        enabled: true,
        priority: 100,
      },
    ],
    settings: {
      autoSync: false,
      syncInterval: "24h",
      offlineMode: false,
      timeout: "30s",
      skipValidation: false,
      allowIncompatible: true,
    },
  }
}

/**
 * Load and validate config from disk
 * Creates default config if file doesn't exist
 */
export async function loadConfig(): Promise<WorkflowConfigParsed> {
  const file = Bun.file(CONFIG_PATH)

  if (!(await file.exists())) {
    const defaultConfig = getDefaultConfig()
    await saveConfig(defaultConfig)
    return defaultConfig
  }

  const content = await file.text()
  const parsed = yaml.parse(content)

  // Validate with Zod
  const result = WorkflowConfigSchema.safeParse(parsed)
  if (!result.success) {
    throw new ConfigError(
      `Invalid config.yaml: ${result.error.message}`,
      "CONFIG_INVALID"
    )
  }

  return result.data
}

/**
 * Save config to disk
 */
export async function saveConfig(config: WorkflowConfigParsed): Promise<void> {
  const dir = path.dirname(CONFIG_PATH)
  await fs.mkdir(dir, { recursive: true })

  const content = yaml.stringify(config, {
    lineWidth: 0, // No line wrapping
    defaultKeyType: "PLAIN",
  })

  // Atomic write
  const tempPath = `${CONFIG_PATH}.tmp`
  await Bun.write(tempPath, content)
  await fs.rename(tempPath, CONFIG_PATH)
}

/**
 * Add a new source to config
 */
export async function addSource(source: SourceConfig): Promise<void> {
  const config = await loadConfig()

  // Check for duplicate name
  if (config.sources.some(s => s.name === source.name)) {
    throw new ConfigError(
      `Source '${source.name}' already exists`,
      "SOURCE_EXISTS"
    )
  }

  config.sources.push(source)
  await saveConfig(config)
}

/**
 * Remove a source from config
 */
export async function removeSource(name: string): Promise<void> {
  const config = await loadConfig()

  const index = config.sources.findIndex(s => s.name === name)
  if (index === -1) {
    throw new ConfigError(
      `Source '${name}' not found`,
      "SOURCE_NOT_FOUND"
    )
  }

  config.sources.splice(index, 1)
  await saveConfig(config)
}

/**
 * Get enabled sources sorted by priority (descending)
 */
export function getEnabledSources(config: WorkflowConfigParsed): SourceConfig[] {
  return config.sources
    .filter(s => s.enabled)
    .sort((a, b) => b.priority - a.priority)
}
```

#### Criterios de Aceptación
- [ ] Crea default config si no existe
- [ ] Valida config con Zod schema
- [ ] Atomic writes (temp file + rename)
- [ ] Error handling con códigos específicos
- [ ] Unit tests con 100% coverage

---

### aiTASK 04: Lock Manager

**Archivo**: `src/workflow/sync/lock.ts`
**Estimación**: 2h
**Dependencias**: aiTASK 02

#### Descripción
Gestionar sync.lock para tracking de estado de sincronización.

#### Funciones a Implementar

```typescript
// src/workflow/sync/lock.ts

import path from "path"
import os from "os"
import yaml from "yaml"
import { SyncLockSchema, type SyncLockParsed } from "../config/schema"

/** Path to lock file */
export const LOCK_PATH = path.join(os.homedir(), ".aifwk", "sync.lock")

/**
 * Create empty lock file
 */
export function createEmptyLock(): SyncLockParsed {
  return {
    version: 1,
    lastSync: new Date().toISOString(),
    sources: {},
    skills: {},
  }
}

/**
 * Load lock file from disk
 * Creates empty lock if file doesn't exist
 */
export async function loadLock(): Promise<SyncLockParsed> {
  const file = Bun.file(LOCK_PATH)

  if (!(await file.exists())) {
    return createEmptyLock()
  }

  const content = await file.text()
  const parsed = yaml.parse(content)

  const result = SyncLockSchema.safeParse(parsed)
  if (!result.success) {
    // Corrupted lock file - recreate
    console.warn("Corrupted sync.lock, recreating...")
    return createEmptyLock()
  }

  return result.data
}

/**
 * Save lock file to disk (atomic)
 */
export async function saveLock(lock: SyncLockParsed): Promise<void> {
  const dir = path.dirname(LOCK_PATH)
  await fs.mkdir(dir, { recursive: true })

  const header = "# ~/.aifwk/sync.lock\n# DO NOT EDIT MANUALLY\n\n"
  const content = header + yaml.stringify(lock, { lineWidth: 0 })

  const tempPath = `${LOCK_PATH}.tmp`
  await Bun.write(tempPath, content)
  await fs.rename(tempPath, LOCK_PATH)
}

/**
 * Update lock after successful sync
 */
export async function updateLockAfterSync(
  sourceName: string,
  sourceUrl: string,
  commit: string,
  syncedSkills: SkillSyncResult[]
): Promise<void> {
  const lock = await loadLock()

  lock.lastSync = new Date().toISOString()

  lock.sources[sourceName] = {
    url: sourceUrl,
    commit,
    syncedAt: new Date().toISOString(),
  }

  for (const skill of syncedSkills) {
    lock.skills[skill.name] = {
      version: skill.version,
      source: sourceName,
      hash: "", // Will be computed by downloader
      installedAt: new Date().toISOString(),
    }
  }

  await saveLock(lock)
}

/**
 * Get installed skill info from lock
 */
export function getInstalledSkill(
  lock: SyncLockParsed,
  name: string
): SkillLockEntry | undefined {
  return lock.skills[name]
}

/**
 * Check if skill needs update
 */
export function skillNeedsUpdate(
  lock: SyncLockParsed,
  name: string,
  remoteVersion: string
): boolean {
  const installed = lock.skills[name]
  if (!installed) return true // New skill

  return compareVersions(remoteVersion, installed.version) > 0
}
```

#### Criterios de Aceptación
- [ ] Crea empty lock si no existe
- [ ] Recupera gracefully de lock corrupto
- [ ] Atomic writes para data safety
- [ ] Funciones helper para queries

---

### aiTASK 05: Config Defaults

**Archivo**: `src/workflow/config/defaults.ts`
**Estimación**: 1h
**Dependencias**: aiTASK 01

#### Descripción
Constantes y valores por defecto centralizados.

```typescript
// src/workflow/config/defaults.ts

import path from "path"
import os from "os"

/**
 * File paths for workflow system
 */
export const WORKFLOW_PATHS = {
  /** Base directory for aiFRAMEWORK data */
  base: path.join(os.homedir(), ".aifwk"),
  /** Config file location */
  config: path.join(os.homedir(), ".aifwk", "config.yaml"),
  /** Lock file location */
  lock: path.join(os.homedir(), ".aifwk", "sync.lock"),
  /** Cache directory for synced skills */
  cache: path.join(os.homedir(), ".aifwk", "cache", "skills"),
} as const

/**
 * Official repository configuration
 */
export const OFFICIAL_SOURCE = {
  name: "official",
  url: "https://github.com/aifwk/workflow-catalog",
  branch: "main",
  enabled: true,
  priority: 100,
} as const

/**
 * Network configuration defaults
 */
export const NETWORK_DEFAULTS = {
  /** Default timeout for HTTP requests */
  timeoutMs: 30000,
  /** Maximum concurrent downloads */
  maxConcurrent: 5,
  /** Number of retries for failed requests */
  maxRetries: 3,
  /** Initial backoff delay (ms) */
  backoffInitial: 1000,
  /** Maximum backoff delay (ms) */
  backoffMax: 10000,
} as const

/**
 * GitHub raw content URL template
 */
export function getGitHubRawUrl(
  repoUrl: string,
  branch: string,
  filePath: string
): string {
  // Convert https://github.com/owner/repo to raw content URL
  const match = repoUrl.match(/github\.com\/([^/]+)\/([^/]+)/)
  if (!match) {
    throw new Error(`Invalid GitHub URL: ${repoUrl}`)
  }
  const [, owner, repo] = match
  return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${filePath}`
}

/**
 * Parse timeout string to milliseconds
 */
export function parseTimeoutString(timeout: string): number {
  const match = timeout.match(/^(\d+)(ms|s|m|h)?$/)
  if (!match) return NETWORK_DEFAULTS.timeoutMs

  const [, value, unit] = match
  const num = parseInt(value, 10)

  switch (unit) {
    case "ms": return num
    case "s": return num * 1000
    case "m": return num * 60 * 1000
    case "h": return num * 60 * 60 * 1000
    default: return num * 1000 // Default to seconds
  }
}
```

---

### Checkpoint Semana 1

**Archivos Creados**:
- `src/workflow/index.ts`
- `src/workflow/types.ts`
- `src/workflow/config/schema.ts`
- `src/workflow/config/loader.ts`
- `src/workflow/config/defaults.ts`
- `src/workflow/sync/lock.ts`

**Validación**:
```bash
# Ejecutar tests
bun test packages/opencode/test/workflow/

# Verificar tipos
bun run typecheck

# Test manual
bun run packages/opencode/scripts/test-workflow-config.ts
```

---

## Semana 2: Core Sync

### Objetivo
Implementar el motor de sincronización: fetch de índices, comparación de versiones, descarga y validación de skills.

---

### aiTASK 06: Sync Error Classes

**Archivo**: `src/workflow/sync/errors.ts`
**Estimación**: 1h
**Dependencias**: aiTASK 01

#### Descripción
Definir clases de error específicas para el sistema de sync.

```typescript
// src/workflow/sync/errors.ts

/**
 * Error codes for sync operations
 */
export enum SyncErrorCode {
  // Network
  NETWORK_TIMEOUT = "SYNC_NETWORK_TIMEOUT",
  NETWORK_UNREACHABLE = "SYNC_NETWORK_UNREACHABLE",

  // Auth
  AUTH_FAILED = "SYNC_AUTH_FAILED",
  AUTH_TOKEN_MISSING = "SYNC_AUTH_TOKEN_MISSING",

  // Validation
  INVALID_INDEX = "SYNC_INVALID_INDEX",
  INVALID_SKILL = "SYNC_INVALID_SKILL",
  HASH_MISMATCH = "SYNC_HASH_MISMATCH",

  // Config
  CONFIG_INVALID = "SYNC_CONFIG_INVALID",
  SOURCE_NOT_FOUND = "SYNC_SOURCE_NOT_FOUND",
  SOURCE_EXISTS = "SYNC_SOURCE_EXISTS",

  // Filesystem
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
    public readonly skill?: string
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
        return `Network timeout${this.source ? ` for ${this.source}` : ""}. Check your internet connection or try again later.`
      case SyncErrorCode.AUTH_TOKEN_MISSING:
        return `Authentication required for ${this.source}. Set the environment variable specified in config.yaml.`
      case SyncErrorCode.INVALID_INDEX:
        return `Invalid index.json from ${this.source}. The repository may be misconfigured.`
      case SyncErrorCode.HASH_MISMATCH:
        return `Integrity check failed for skill '${this.skill}'. The file may have been tampered with.`
      default:
        return this.message
    }
  }
}

/**
 * Config-specific error
 */
export class ConfigError extends SyncError {
  constructor(message: string, code: SyncErrorCode = SyncErrorCode.CONFIG_INVALID) {
    super(message, code)
    this.name = "ConfigError"
  }
}
```

---

### aiTASK 07: Index Fetcher

**Archivo**: `src/workflow/sync/fetcher.ts`
**Estimación**: 3h
**Dependencias**: aiTASK 05, aiTASK 06

#### Descripción
Fetch y parseo de index.json desde repositorios remotos.

```typescript
// src/workflow/sync/fetcher.ts

import { RemoteIndexSchema, type RemoteIndexParsed } from "../config/schema"
import { getGitHubRawUrl, NETWORK_DEFAULTS, parseTimeoutString } from "../config/defaults"
import { SyncError, SyncErrorCode } from "./errors"
import type { SourceConfig, WorkflowSettings } from "../types"

/**
 * Fetch index.json from a source repository
 */
export async function fetchRemoteIndex(
  source: SourceConfig,
  settings: WorkflowSettings
): Promise<RemoteIndexParsed> {
  const indexUrl = getGitHubRawUrl(source.url, source.branch, "index.json")
  const timeout = parseTimeoutString(settings.timeout)

  const headers: Record<string, string> = {
    "Accept": "application/json",
    "User-Agent": "dipoleCODE-sync/1.0",
  }

  // Add auth header if configured
  if (source.auth) {
    const token = process.env[source.auth.env]
    if (!token) {
      throw new SyncError(
        `Environment variable '${source.auth.env}' not set`,
        SyncErrorCode.AUTH_TOKEN_MISSING,
        source.name
      )
    }

    if (source.auth.type === "github-token") {
      headers["Authorization"] = `token ${token}`
    } else {
      headers["Authorization"] = `Bearer ${token}`
    }
  }

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
    if (error instanceof Error && error.name === "AbortError") {
      throw new SyncError(
        `Request timed out after ${settings.timeout}`,
        SyncErrorCode.NETWORK_TIMEOUT,
        source.name
      )
    }
    throw new SyncError(
      `Network error: ${error instanceof Error ? error.message : "Unknown"}`,
      SyncErrorCode.NETWORK_UNREACHABLE,
      source.name
    )
  }

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new SyncError(
        `Authentication failed (${response.status})`,
        SyncErrorCode.AUTH_FAILED,
        source.name
      )
    }
    throw new SyncError(
      `HTTP ${response.status}: ${response.statusText}`,
      SyncErrorCode.NETWORK_UNREACHABLE,
      source.name
    )
  }

  let json: unknown
  try {
    json = await response.json()
  } catch {
    throw new SyncError(
      "Invalid JSON response",
      SyncErrorCode.INVALID_INDEX,
      source.name
    )
  }

  const result = RemoteIndexSchema.safeParse(json)
  if (!result.success) {
    throw new SyncError(
      `Invalid index format: ${result.error.message}`,
      SyncErrorCode.INVALID_INDEX,
      source.name
    )
  }

  return result.data
}

/**
 * Fetch with retry logic
 */
export async function fetchWithRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = NETWORK_DEFAULTS.maxRetries
): Promise<T> {
  let lastError: Error | undefined
  let delay = NETWORK_DEFAULTS.backoffInitial

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))

      if (attempt < maxRetries) {
        await sleep(delay)
        delay = Math.min(delay * 2, NETWORK_DEFAULTS.backoffMax)
      }
    }
  }

  throw lastError
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
```

---

### aiTASK 08: Version Comparator

**Archivo**: `src/workflow/sync/comparator.ts`
**Estimación**: 2h
**Dependencias**: aiTASK 01

#### Descripción
Comparación de versiones semver para determinar updates.

```typescript
// src/workflow/sync/comparator.ts

import type { SyncLockParsed, RemoteSkillEntry, SkillLockEntry } from "../types"

/**
 * Result of comparing local vs remote skills
 */
export interface ComparisonResult {
  /** Skills that need to be added (new) */
  toAdd: RemoteSkillEntry[]
  /** Skills that need to be updated */
  toUpdate: Array<{ remote: RemoteSkillEntry; local: SkillLockEntry }>
  /** Skills that are up to date */
  upToDate: RemoteSkillEntry[]
  /** Skills with version warnings */
  warnings: Array<{ skill: RemoteSkillEntry; message: string }>
}

/**
 * Compare semver versions
 * Returns: positive if a > b, negative if a < b, 0 if equal
 */
export function compareVersions(a: string, b: string): number {
  const parseVersion = (v: string) => {
    const [version, prerelease] = v.split("-")
    const parts = version.split(".").map(Number)
    return { parts, prerelease }
  }

  const va = parseVersion(a)
  const vb = parseVersion(b)

  // Compare major.minor.patch
  for (let i = 0; i < 3; i++) {
    const diff = (va.parts[i] || 0) - (vb.parts[i] || 0)
    if (diff !== 0) return diff
  }

  // Handle prerelease (no prerelease > with prerelease)
  if (!va.prerelease && vb.prerelease) return 1
  if (va.prerelease && !vb.prerelease) return -1
  if (va.prerelease && vb.prerelease) {
    return va.prerelease.localeCompare(vb.prerelease)
  }

  return 0
}

/**
 * Check if current dipoleCODE version satisfies minimum requirement
 */
export function checkVersionCompatibility(
  currentVersion: string,
  minRequired?: string
): { compatible: boolean; message?: string } {
  if (!minRequired) {
    return { compatible: true }
  }

  const comparison = compareVersions(currentVersion, minRequired)
  if (comparison >= 0) {
    return { compatible: true }
  }

  return {
    compatible: false,
    message: `requires dipoleCODE >= ${minRequired} (you have ${currentVersion})`,
  }
}

/**
 * Compare local lock with remote index
 */
export function compareWithLock(
  lock: SyncLockParsed,
  remoteSkills: RemoteSkillEntry[],
  currentDipolecodeVersion: string,
  allowIncompatible: boolean
): ComparisonResult {
  const result: ComparisonResult = {
    toAdd: [],
    toUpdate: [],
    upToDate: [],
    warnings: [],
  }

  for (const remote of remoteSkills) {
    // Check version compatibility
    const compat = checkVersionCompatibility(
      currentDipolecodeVersion,
      remote.minDipolecode
    )

    if (!compat.compatible) {
      result.warnings.push({
        skill: remote,
        message: compat.message!,
      })

      if (!allowIncompatible) {
        continue // Skip incompatible skills
      }
    }

    const local = lock.skills[remote.name]

    if (!local) {
      // New skill
      result.toAdd.push(remote)
    } else if (compareVersions(remote.version, local.version) > 0) {
      // Update available
      result.toUpdate.push({ remote, local })
    } else {
      // Up to date
      result.upToDate.push(remote)
    }
  }

  return result
}

/**
 * Filter skills by name (for single-skill sync)
 */
export function filterByName(
  skills: RemoteSkillEntry[],
  name: string
): RemoteSkillEntry | undefined {
  return skills.find(s => s.name === name)
}
```

---

### aiTASK 09: Skill Downloader

**Archivo**: `src/workflow/sync/downloader.ts`
**Estimación**: 3h
**Dependencias**: aiTASK 05, aiTASK 06, aiTASK 07

#### Descripción
Descargar SKILL.md files desde repositorios remotos con validación.

```typescript
// src/workflow/sync/downloader.ts

import path from "path"
import fs from "fs/promises"
import { getGitHubRawUrl, NETWORK_DEFAULTS, WORKFLOW_PATHS } from "../config/defaults"
import { fetchWithRetry } from "./fetcher"
import { SyncError, SyncErrorCode } from "./errors"
import type { SourceConfig, RemoteSkillEntry, WorkflowSettings } from "../types"

/**
 * Download result for a single skill
 */
export interface DownloadResult {
  success: boolean
  name: string
  version: string
  path?: string
  error?: string
}

/**
 * Download a single skill from a source
 */
export async function downloadSkill(
  source: SourceConfig,
  skill: RemoteSkillEntry,
  settings: WorkflowSettings
): Promise<DownloadResult> {
  const skillUrl = getGitHubRawUrl(
    source.url,
    source.branch,
    `${skill.path}/SKILL.md`
  )

  const headers: Record<string, string> = {
    "User-Agent": "dipoleCODE-sync/1.0",
  }

  // Add auth header
  if (source.auth) {
    const token = process.env[source.auth.env]
    if (token) {
      headers["Authorization"] = source.auth.type === "github-token"
        ? `token ${token}`
        : `Bearer ${token}`
    }
  }

  try {
    const content = await fetchWithRetry(async () => {
      const response = await fetch(skillUrl, { headers })
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }
      return response.text()
    })

    // Verify hash if provided
    if (skill.hash) {
      const computed = await computeHash(content)
      if (computed !== skill.hash) {
        throw new SyncError(
          "Hash mismatch - content may have been tampered with",
          SyncErrorCode.HASH_MISMATCH,
          source.name,
          skill.name
        )
      }
    }

    // Write to cache directory (atomic)
    const skillDir = path.join(WORKFLOW_PATHS.cache, skill.name)
    const skillPath = path.join(skillDir, "SKILL.md")

    await fs.mkdir(skillDir, { recursive: true })

    const tempPath = `${skillPath}.tmp`
    await Bun.write(tempPath, content)
    await fs.rename(tempPath, skillPath)

    return {
      success: true,
      name: skill.name,
      version: skill.version,
      path: skillPath,
    }
  } catch (error) {
    return {
      success: false,
      name: skill.name,
      version: skill.version,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

/**
 * Download multiple skills in parallel
 */
export async function downloadSkills(
  source: SourceConfig,
  skills: RemoteSkillEntry[],
  settings: WorkflowSettings,
  onProgress?: (completed: number, total: number) => void
): Promise<DownloadResult[]> {
  const results: DownloadResult[] = []
  const concurrent = NETWORK_DEFAULTS.maxConcurrent

  // Process in batches
  for (let i = 0; i < skills.length; i += concurrent) {
    const batch = skills.slice(i, i + concurrent)
    const batchResults = await Promise.all(
      batch.map(skill => downloadSkill(source, skill, settings))
    )
    results.push(...batchResults)

    onProgress?.(results.length, skills.length)
  }

  return results
}

/**
 * Compute SHA256 hash of content
 */
async function computeHash(content: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(content)
  const hashBuffer = await crypto.subtle.digest("SHA-256", data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return "sha256:" + hashArray.map(b => b.toString(16).padStart(2, "0")).join("")
}
```

---

### aiTASK 10: Hash Verification

**Archivo**: `src/workflow/sync/hash.ts`
**Estimación**: 1h
**Dependencias**: Ninguna

#### Descripción
Utilidades para verificación de integridad de archivos.

```typescript
// src/workflow/sync/hash.ts

/**
 * Compute SHA256 hash of string content
 */
export async function computeContentHash(content: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(content)
  const hashBuffer = await crypto.subtle.digest("SHA-256", data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return "sha256:" + hashArray.map(b => b.toString(16).padStart(2, "0")).join("")
}

/**
 * Compute SHA256 hash of a file
 */
export async function computeFileHash(filePath: string): Promise<string> {
  const file = Bun.file(filePath)
  const content = await file.text()
  return computeContentHash(content)
}

/**
 * Verify hash matches expected value
 */
export function verifyHash(computed: string, expected: string): boolean {
  // Normalize hash format
  const normalizedComputed = computed.startsWith("sha256:")
    ? computed
    : `sha256:${computed}`
  const normalizedExpected = expected.startsWith("sha256:")
    ? expected
    : `sha256:${expected}`

  return normalizedComputed === normalizedExpected
}
```

---

### Checkpoint Semana 2

**Archivos Creados**:
- `src/workflow/sync/errors.ts`
- `src/workflow/sync/fetcher.ts`
- `src/workflow/sync/comparator.ts`
- `src/workflow/sync/downloader.ts`
- `src/workflow/sync/hash.ts`

**Validación**:
```bash
# Ejecutar tests de sync
bun test packages/opencode/test/workflow/sync.test.ts

# Test manual de fetch
bun run packages/opencode/scripts/test-workflow-fetch.ts
```

---

## Semana 3: Commands

### Objetivo
Implementar los comandos CLI para interacción con el sistema de sync.

---

### aiTASK 11: Workflow Command Entry Point

**Archivo**: `src/cli/cmd/workflow.ts`
**Estimación**: 1h
**Dependencias**: Semana 2 completa

#### Descripción
Entry point para el comando `workflow` con subcomandos.

```typescript
// src/cli/cmd/workflow.ts

import { cmd } from "./cmd"
import { SyncCommand } from "../../workflow/commands/sync"
import { ListCommand } from "../../workflow/commands/list"
import { InfoCommand } from "../../workflow/commands/info"
import { OutdatedCommand } from "../../workflow/commands/outdated"
import { SourceCommand } from "../../workflow/commands/source"

export const WorkflowCommand = cmd({
  command: "workflow",
  describe: "manage workflow skills from remote repositories",
  builder: (yargs) =>
    yargs
      .command(SyncCommand)
      .command(ListCommand)
      .command(InfoCommand)
      .command(OutdatedCommand)
      .command(SourceCommand)
      .demandCommand(1, "Please specify a subcommand"),
  async handler() {},
})
```

---

### aiTASK 12: Sync Command

**Archivo**: `src/workflow/commands/sync.ts`
**Estimación**: 4h
**Dependencias**: aiTASK 11

#### Descripción
Implementar el comando principal `workflow sync`.

```typescript
// src/workflow/commands/sync.ts

import * as prompts from "@clack/prompts"
import { cmd } from "../../cli/cmd/cmd"
import { UI } from "../../cli/ui"
import { Instance } from "../../project/instance"
import { Installation } from "../../installation"
import { loadConfig, getEnabledSources } from "../config/loader"
import { loadLock, updateLockAfterSync } from "../sync/lock"
import { fetchRemoteIndex, fetchWithRetry } from "../sync/fetcher"
import { compareWithLock } from "../sync/comparator"
import { downloadSkills } from "../sync/downloader"
import { SkillValidator } from "../../skill/validator"
import type { SyncResult, SkillSyncResult, SkillSyncError } from "../types"

export const SyncCommand = cmd({
  command: "sync [name]",
  describe: "synchronize skills from configured sources",
  builder: (yargs) =>
    yargs
      .positional("name", {
        describe: "specific skill name to sync",
        type: "string",
      })
      .option("force", {
        alias: "f",
        describe: "force re-download even if up to date",
        type: "boolean",
        default: false,
      })
      .option("dry-run", {
        describe: "show what would be synced without downloading",
        type: "boolean",
        default: false,
      }),
  async handler(args) {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        UI.empty()
        prompts.intro("Workflow Sync")

        const spinner = prompts.spinner()

        try {
          // Load config and lock
          spinner.start("Loading configuration...")
          const config = await loadConfig()
          const lock = await loadLock()
          const sources = getEnabledSources(config)

          if (sources.length === 0) {
            spinner.stop("No sources configured")
            prompts.log.warn("Add a source with: opencode workflow source add <url>")
            prompts.outro("Done")
            return
          }

          spinner.stop(`Found ${sources.length} source(s)`)

          // Check for offline mode
          if (config.settings.offlineMode) {
            prompts.log.warn("Offline mode enabled - using cached skills only")
            prompts.outro("Done")
            return
          }

          const results: SyncResult = {
            success: true,
            updated: [],
            added: [],
            failed: [],
            warnings: [],
            duration: 0,
          }

          const startTime = Date.now()

          // Process each source
          for (const source of sources) {
            prompts.log.info(`\n📦 ${source.url}`)

            spinner.start("Fetching index...")

            let index
            try {
              index = await fetchWithRetry(
                () => fetchRemoteIndex(source, config.settings)
              )
            } catch (error) {
              spinner.stop("Failed to fetch index", 1)
              prompts.log.error(error instanceof Error ? error.message : String(error))
              results.success = false
              continue
            }

            spinner.stop(`Found ${index.skills.length} skills`)

            // Compare with lock
            const comparison = compareWithLock(
              lock,
              index.skills,
              Installation.VERSION,
              config.settings.allowIncompatible
            )

            // Filter by name if specified
            let toSync = [...comparison.toAdd, ...comparison.toUpdate.map(u => u.remote)]
            if (args.name) {
              toSync = toSync.filter(s => s.name === args.name)
              if (toSync.length === 0) {
                prompts.log.info(`   ${args.name} is up to date`)
                continue
              }
            }

            // Report warnings
            for (const { skill, message } of comparison.warnings) {
              prompts.log.warn(`   ⚠ ${skill.name} ${message}`)
              results.warnings.push(`${skill.name}: ${message}`)
            }

            // Dry run - just report
            if (args.dryRun) {
              for (const skill of toSync) {
                const isUpdate = comparison.toUpdate.some(u => u.remote.name === skill.name)
                prompts.log.info(`   ${isUpdate ? "update" : "add"}: ${skill.name} ${skill.version}`)
              }
              continue
            }

            // Download skills
            if (toSync.length > 0) {
              spinner.start(`Downloading ${toSync.length} skill(s)...`)

              const downloads = await downloadSkills(
                source,
                toSync,
                config.settings,
                (done, total) => {
                  spinner.message(`Downloading ${done}/${total}...`)
                }
              )

              spinner.stop("Downloads complete")

              // Process results
              const syncedSkills: SkillSyncResult[] = []

              for (const download of downloads) {
                if (download.success) {
                  const isUpdate = comparison.toUpdate.some(
                    u => u.remote.name === download.name
                  )
                  const prev = isUpdate
                    ? comparison.toUpdate.find(u => u.remote.name === download.name)?.local.version
                    : undefined

                  const result: SkillSyncResult = {
                    name: download.name,
                    version: download.version,
                    source: source.name,
                    previousVersion: prev,
                  }

                  syncedSkills.push(result)

                  if (isUpdate) {
                    results.updated.push(result)
                    prompts.log.success(`   ✓ ${download.name} ${prev} → ${download.version} (updated)`)
                  } else {
                    results.added.push(result)
                    prompts.log.success(`   ✓ ${download.name} ${download.version} (new)`)
                  }

                  // Validate downloaded skill
                  if (!config.settings.skipValidation && download.path) {
                    const validator = new SkillValidator()
                    const validation = await validator.validate(download.path, source.name as any)

                    for (const warning of validation.warnings) {
                      prompts.log.warn(`     ⚠ ${warning}`)
                    }
                  }
                } else {
                  results.failed.push({
                    name: download.name,
                    source: source.name,
                    error: download.error || "Unknown error",
                  })
                  prompts.log.error(`   ✗ ${download.name}: ${download.error}`)
                }
              }

              // Update lock
              if (syncedSkills.length > 0) {
                await updateLockAfterSync(
                  source.name,
                  source.url,
                  "HEAD", // TODO: Get actual commit hash
                  syncedSkills
                )
              }
            }

            // Report up-to-date skills
            const upToDateCount = comparison.upToDate.length
            if (upToDateCount > 0 && !args.name) {
              prompts.log.info(`   ${upToDateCount} skill(s) up to date`)
            }
          }

          results.duration = Date.now() - startTime

          // Summary
          prompts.log.info("\n" + "─".repeat(50))
          prompts.log.info("Summary:")
          if (results.added.length > 0) {
            prompts.log.info(`  ${results.added.length} new`)
          }
          if (results.updated.length > 0) {
            prompts.log.info(`  ${results.updated.length} updated`)
          }
          if (results.failed.length > 0) {
            prompts.log.error(`  ${results.failed.length} failed`)
          }
          if (results.warnings.length > 0) {
            prompts.log.warn(`  ${results.warnings.length} warning(s)`)
          }

          const status = results.failed.length === 0 ? "completed" : "completed with errors"
          prompts.outro(`✓ Sync ${status} in ${(results.duration / 1000).toFixed(1)}s`)

          // Exit with error code if failures
          if (results.failed.length > 0) {
            process.exitCode = 1
          }
        } catch (error) {
          spinner.stop("Sync failed", 1)
          prompts.log.error(error instanceof Error ? error.message : String(error))
          prompts.outro("Sync failed")
          process.exitCode = 1
        }
      },
    })
  },
})
```

---

### aiTASK 13: List Command

**Archivo**: `src/workflow/commands/list.ts`
**Estimación**: 2h
**Dependencias**: aiTASK 11

```typescript
// src/workflow/commands/list.ts

import * as prompts from "@clack/prompts"
import { cmd } from "../../cli/cmd/cmd"
import { UI } from "../../cli/ui"
import { Instance } from "../../project/instance"
import { Skill } from "../../skill"
import { loadConfig, getEnabledSources } from "../config/loader"
import { loadLock } from "../sync/lock"
import { fetchRemoteIndex } from "../sync/fetcher"

export const ListCommand = cmd({
  command: "list",
  aliases: ["ls"],
  describe: "list available skills",
  builder: (yargs) =>
    yargs
      .option("remote", {
        alias: "r",
        describe: "show skills available from remote sources (not installed)",
        type: "boolean",
        default: false,
      })
      .option("source", {
        alias: "s",
        describe: "filter by source name",
        type: "string",
      }),
  async handler(args) {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        UI.empty()
        prompts.intro("Available Skills")

        if (args.remote) {
          // Show remote skills not installed
          await showRemoteSkills(args.source)
        } else {
          // Show installed skills
          await showInstalledSkills(args.source)
        }
      },
    })
  },
})

async function showInstalledSkills(sourceFilter?: string) {
  const skills = await Skill.all()
  const lock = await loadLock()

  if (skills.length === 0) {
    prompts.log.warn("No skills installed")
    prompts.outro("Run 'opencode workflow sync' to install skills")
    return
  }

  // Group by source
  const bySource: Record<string, typeof skills> = {}
  for (const skill of skills) {
    // Determine source from lock or location
    let source = "embedded"
    if (skill.location.includes(".aifwk/cache")) {
      const lockEntry = lock.skills[skill.name]
      source = lockEntry?.source || "cached"
    } else if (skill.location.includes(".config/opencode")) {
      source = "user"
    } else if (skill.location.includes(".opencode/skill")) {
      source = "local"
    }

    if (sourceFilter && source !== sourceFilter) continue

    if (!bySource[source]) bySource[source] = []
    bySource[source].push(skill)
  }

  // Display table
  console.log("\n  Name               Version  Source              Description")
  console.log("  " + "─".repeat(70))

  for (const [source, sourceSkills] of Object.entries(bySource)) {
    for (const skill of sourceSkills) {
      const lockEntry = lock.skills[skill.name]
      const version = lockEntry?.version || skill.version || "-"
      const desc = skill.description.slice(0, 30) + (skill.description.length > 30 ? "..." : "")

      console.log(
        `  ${skill.name.padEnd(18)} ${version.padEnd(8)} ${source.padEnd(18)} ${desc}`
      )
    }
  }

  prompts.outro(`${skills.length} skill(s) installed`)
}

async function showRemoteSkills(sourceFilter?: string) {
  const config = await loadConfig()
  const lock = await loadLock()
  const sources = getEnabledSources(config)

  if (sourceFilter) {
    const filtered = sources.filter(s => s.name === sourceFilter)
    if (filtered.length === 0) {
      prompts.log.error(`Source '${sourceFilter}' not found`)
      return
    }
  }

  const spinner = prompts.spinner()
  spinner.start("Fetching remote indices...")

  const notInstalled: Array<{ name: string; version: string; source: string; description: string }> = []

  for (const source of sources) {
    if (sourceFilter && source.name !== sourceFilter) continue

    try {
      const index = await fetchRemoteIndex(source, config.settings)

      for (const skill of index.skills) {
        if (!lock.skills[skill.name]) {
          notInstalled.push({
            name: skill.name,
            version: skill.version,
            source: source.name,
            description: skill.description,
          })
        }
      }
    } catch (error) {
      prompts.log.warn(`Failed to fetch from ${source.name}`)
    }
  }

  spinner.stop("Done")

  if (notInstalled.length === 0) {
    prompts.log.info("All available skills are installed")
    prompts.outro("Done")
    return
  }

  console.log("\n  Available from remotes (not installed):\n")
  console.log("  Name               Version  Source     Description")
  console.log("  " + "─".repeat(70))

  for (const skill of notInstalled) {
    const desc = skill.description.slice(0, 35) + (skill.description.length > 35 ? "..." : "")
    console.log(
      `  ${skill.name.padEnd(18)} ${skill.version.padEnd(8)} ${skill.source.padEnd(10)} ${desc}`
    )
  }

  prompts.outro(`${notInstalled.length} skill(s) available`)
}
```

---

### aiTASK 14: Info Command

**Archivo**: `src/workflow/commands/info.ts`
**Estimación**: 1.5h
**Dependencias**: aiTASK 11

```typescript
// src/workflow/commands/info.ts

import * as prompts from "@clack/prompts"
import { cmd } from "../../cli/cmd/cmd"
import { UI } from "../../cli/ui"
import { Instance } from "../../project/instance"
import { Skill } from "../../skill"
import { loadLock } from "../sync/lock"

export const InfoCommand = cmd({
  command: "info <name>",
  describe: "show detailed information about a skill",
  builder: (yargs) =>
    yargs.positional("name", {
      describe: "skill name",
      type: "string",
      demandOption: true,
    }),
  async handler(args) {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        UI.empty()

        const skill = await Skill.get(args.name)
        if (!skill) {
          prompts.log.error(`Skill '${args.name}' not found`)
          prompts.log.info("Run 'opencode workflow list' to see available skills")
          return
        }

        const lock = await loadLock()
        const lockEntry = lock.skills[args.name]

        // Determine source
        let source = "embedded"
        let sourceUrl = ""
        if (skill.location.includes(".aifwk/cache")) {
          source = lockEntry?.source ? `cached (${lockEntry.source})` : "cached"
          const sourceLock = lockEntry?.source ? lock.sources[lockEntry.source] : undefined
          sourceUrl = sourceLock?.url || ""
        } else if (skill.location.includes(".config/opencode")) {
          source = "user"
        } else if (skill.location.includes(".opencode/skill")) {
          source = "local"
        }

        console.log(`
Skill: ${skill.name}
Version: ${skill.version || lockEntry?.version || "-"}
Source: ${source}${sourceUrl ? ` (${sourceUrl})` : ""}
Status: installed

Description:
  ${skill.description}

${skill.tools?.length ? `Tools required:
${skill.tools.map(t => `  ✓ ${t}`).join("\n")}
` : ""}
${skill.tags?.length ? `Tags: ${skill.tags.join(", ")}
` : ""}
Location: ${skill.location}

${lockEntry ? `Last synced: ${new Date(lockEntry.installedAt).toLocaleString()}` : ""}
`)

      },
    })
  },
})
```

---

### aiTASK 15: Outdated Command

**Archivo**: `src/workflow/commands/outdated.ts`
**Estimación**: 1.5h
**Dependencias**: aiTASK 11

```typescript
// src/workflow/commands/outdated.ts

import * as prompts from "@clack/prompts"
import { cmd } from "../../cli/cmd/cmd"
import { UI } from "../../cli/ui"
import { Instance } from "../../project/instance"
import { loadConfig, getEnabledSources } from "../config/loader"
import { loadLock } from "../sync/lock"
import { fetchRemoteIndex } from "../sync/fetcher"
import { compareVersions } from "../sync/comparator"

export const OutdatedCommand = cmd({
  command: "outdated",
  describe: "show skills with available updates",
  async handler() {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        UI.empty()
        prompts.intro("Outdated Skills")

        const config = await loadConfig()
        const lock = await loadLock()
        const sources = getEnabledSources(config)

        const spinner = prompts.spinner()
        spinner.start("Checking for updates...")

        const outdated: Array<{
          name: string
          installed: string
          available: string
          source: string
        }> = []

        for (const source of sources) {
          try {
            const index = await fetchRemoteIndex(source, config.settings)

            for (const remote of index.skills) {
              const local = lock.skills[remote.name]
              if (local && compareVersions(remote.version, local.version) > 0) {
                outdated.push({
                  name: remote.name,
                  installed: local.version,
                  available: remote.version,
                  source: source.name,
                })
              }
            }
          } catch {
            // Ignore errors for outdated check
          }
        }

        spinner.stop("Done")

        if (outdated.length === 0) {
          prompts.log.success("All skills are up to date!")
          prompts.outro("Done")
          return
        }

        console.log("\n  Outdated Skills:\n")
        console.log("  Name               Installed  Available  Source")
        console.log("  " + "─".repeat(55))

        for (const skill of outdated) {
          console.log(
            `  ${skill.name.padEnd(18)} ${skill.installed.padEnd(10)} ${skill.available.padEnd(10)} ${skill.source}`
          )
        }

        prompts.log.info("\nRun 'opencode workflow sync' to update.")
        prompts.outro(`${outdated.length} skill(s) have updates`)
      },
    })
  },
})
```

---

### aiTASK 16: Source Command

**Archivo**: `src/workflow/commands/source.ts`
**Estimación**: 3h
**Dependencias**: aiTASK 11

```typescript
// src/workflow/commands/source.ts

import * as prompts from "@clack/prompts"
import { cmd } from "../../cli/cmd/cmd"
import { UI } from "../../cli/ui"
import { Instance } from "../../project/instance"
import { loadConfig, saveConfig, addSource, removeSource } from "../config/loader"
import { fetchRemoteIndex } from "../sync/fetcher"
import type { SourceConfig } from "../types"

export const SourceCommand = cmd({
  command: "source",
  describe: "manage skill sources",
  builder: (yargs) =>
    yargs
      .command(SourceAddCommand)
      .command(SourceListCommand)
      .command(SourceRemoveCommand)
      .command(SourceEnableCommand)
      .command(SourceDisableCommand)
      .demandCommand(1, "Please specify a subcommand"),
  async handler() {},
})

const SourceAddCommand = cmd({
  command: "add <url>",
  describe: "add a new skill source",
  builder: (yargs) =>
    yargs
      .positional("url", {
        describe: "repository URL",
        type: "string",
        demandOption: true,
      })
      .option("name", {
        alias: "n",
        describe: "source name (defaults to repo name)",
        type: "string",
      })
      .option("branch", {
        alias: "b",
        describe: "branch to sync from",
        type: "string",
        default: "main",
      })
      .option("priority", {
        alias: "p",
        describe: "priority (higher = checked first)",
        type: "number",
        default: 50,
      })
      .option("auth-env", {
        describe: "environment variable containing auth token",
        type: "string",
      }),
  async handler(args) {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        UI.empty()
        prompts.intro("Add Source")

        const spinner = prompts.spinner()

        // Validate URL
        if (!args.url.startsWith("https://")) {
          prompts.log.error("Only HTTPS URLs are allowed for security")
          return
        }

        // Extract repo name for default
        const match = args.url.match(/github\.com\/[^/]+\/([^/]+)/)
        const defaultName = match?.[1]?.replace(/\.git$/, "") || "custom"
        const name = args.name || defaultName

        // Validate by fetching index
        spinner.start("Validating source...")

        const source: SourceConfig = {
          name,
          url: args.url,
          branch: args.branch,
          enabled: true,
          priority: args.priority,
        }

        if (args.authEnv) {
          source.auth = {
            type: "github-token",
            env: args.authEnv,
          }
        }

        try {
          const config = await loadConfig()
          const index = await fetchRemoteIndex(source, config.settings)
          spinner.stop(`Found ${index.skills.length} skills`)

          await addSource(source)

          prompts.log.success(`Source '${name}' added successfully`)
          prompts.log.info(`Run 'opencode workflow sync' to download skills`)
          prompts.outro("Done")
        } catch (error) {
          spinner.stop("Validation failed", 1)
          prompts.log.error(error instanceof Error ? error.message : String(error))
        }
      },
    })
  },
})

const SourceListCommand = cmd({
  command: "list",
  aliases: ["ls"],
  describe: "list configured sources",
  async handler() {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        UI.empty()
        prompts.intro("Configured Sources")

        const config = await loadConfig()

        if (config.sources.length === 0) {
          prompts.log.warn("No sources configured")
          prompts.log.info("Add a source with: opencode workflow source add <url>")
          prompts.outro("Done")
          return
        }

        console.log("\n  Name               Enabled  Priority  URL")
        console.log("  " + "─".repeat(70))

        for (const source of config.sources) {
          const status = source.enabled ? "✓" : "○"
          console.log(
            `  ${source.name.padEnd(18)} ${status.padEnd(8)} ${String(source.priority).padEnd(9)} ${source.url}`
          )
        }

        prompts.outro(`${config.sources.length} source(s)`)
      },
    })
  },
})

const SourceRemoveCommand = cmd({
  command: "remove <name>",
  aliases: ["rm"],
  describe: "remove a skill source",
  builder: (yargs) =>
    yargs.positional("name", {
      describe: "source name",
      type: "string",
      demandOption: true,
    }),
  async handler(args) {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        UI.empty()

        const confirm = await prompts.confirm({
          message: `Remove source '${args.name}'?`,
        })

        if (prompts.isCancel(confirm) || !confirm) {
          prompts.outro("Cancelled")
          return
        }

        try {
          await removeSource(args.name)
          prompts.log.success(`Source '${args.name}' removed`)
        } catch (error) {
          prompts.log.error(error instanceof Error ? error.message : String(error))
        }
      },
    })
  },
})

const SourceEnableCommand = cmd({
  command: "enable <name>",
  describe: "enable a skill source",
  builder: (yargs) =>
    yargs.positional("name", {
      describe: "source name",
      type: "string",
      demandOption: true,
    }),
  async handler(args) {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        const config = await loadConfig()
        const source = config.sources.find(s => s.name === args.name)

        if (!source) {
          prompts.log.error(`Source '${args.name}' not found`)
          return
        }

        source.enabled = true
        await saveConfig(config)
        prompts.log.success(`Source '${args.name}' enabled`)
      },
    })
  },
})

const SourceDisableCommand = cmd({
  command: "disable <name>",
  describe: "disable a skill source",
  builder: (yargs) =>
    yargs.positional("name", {
      describe: "source name",
      type: "string",
      demandOption: true,
    }),
  async handler(args) {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        const config = await loadConfig()
        const source = config.sources.find(s => s.name === args.name)

        if (!source) {
          prompts.log.error(`Source '${args.name}' not found`)
          return
        }

        source.enabled = false
        await saveConfig(config)
        prompts.log.success(`Source '${args.name}' disabled`)
      },
    })
  },
})
```

---

### Checkpoint Semana 3

**Archivos Creados**:
- `src/cli/cmd/workflow.ts`
- `src/workflow/commands/sync.ts`
- `src/workflow/commands/list.ts`
- `src/workflow/commands/info.ts`
- `src/workflow/commands/outdated.ts`
- `src/workflow/commands/source.ts`

**Validación**:
```bash
# Build y test
bun run build
bun run packages/opencode/bin/opencode.js workflow --help
bun run packages/opencode/bin/opencode.js workflow sync --dry-run
```

---

## Semana 4: Polish & Test

### Objetivo
Mejorar robustez, agregar tests comprehensivos y documentación.

---

### aiTASK 17: Error Handling Enhancement

**Archivo**: Múltiples archivos
**Estimación**: 2h
**Dependencias**: Semana 3 completa

#### Mejoras
1. Mensajes de error más claros con acciones sugeridas
2. Graceful degradation cuando network falla
3. Retry con backoff exponencial
4. Logging detallado para debugging

---

### aiTASK 18: Offline Mode

**Archivo**: `src/workflow/sync/offline.ts`
**Estimación**: 2h
**Dependencias**: aiTASK 17

```typescript
// src/workflow/sync/offline.ts

import { loadLock } from "./lock"
import { WORKFLOW_PATHS } from "../config/defaults"

/**
 * Check if system is offline
 */
export async function isOffline(): Promise<boolean> {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 5000)

    await fetch("https://github.com", {
      method: "HEAD",
      signal: controller.signal,
    })

    clearTimeout(timeout)
    return false
  } catch {
    return true
  }
}

/**
 * Get cached skills available offline
 */
export async function getCachedSkillsForOffline(): Promise<string[]> {
  const lock = await loadLock()
  return Object.keys(lock.skills)
}

/**
 * Report offline status to user
 */
export function formatOfflineMessage(): string {
  return `⚠ Offline mode active

Using cached skills only. Network operations will be skipped.
To sync when online: opencode workflow sync`
}
```

---

### aiTASK 19: Unit Tests

**Archivo**: `test/workflow/*.test.ts`
**Estimación**: 4h
**Dependencias**: Semana 3 completa

#### Tests a Implementar

```typescript
// test/workflow/config.test.ts
- loadConfig creates default if not exists
- loadConfig validates schema
- saveConfig writes atomically
- addSource prevents duplicates
- removeSource throws for not found

// test/workflow/lock.test.ts
- loadLock creates empty if not exists
- loadLock recovers from corruption
- saveLock writes atomically
- updateLockAfterSync updates correctly

// test/workflow/fetcher.test.ts
- fetchRemoteIndex parses valid index
- fetchRemoteIndex rejects invalid JSON
- fetchRemoteIndex handles timeout
- fetchRemoteIndex handles auth errors
- fetchWithRetry retries on failure

// test/workflow/comparator.test.ts
- compareVersions handles semver correctly
- compareVersions handles prerelease
- compareWithLock identifies new skills
- compareWithLock identifies updates
- checkVersionCompatibility validates minimum

// test/workflow/downloader.test.ts
- downloadSkill writes to cache
- downloadSkill verifies hash
- downloadSkills processes in batches
```

---

### aiTASK 20: Integration Tests

**Archivo**: `test/workflow/integration.test.ts`
**Estimación**: 2h
**Dependencias**: aiTASK 19

```typescript
// test/workflow/integration.test.ts

describe("workflow sync integration", () => {
  it("syncs skills from mock server", async () => {
    // Setup mock HTTP server
    // Run sync command
    // Verify skills in cache
    // Verify lock file updated
  })

  it("handles offline gracefully", async () => {
    // Disconnect network mock
    // Run sync command
    // Verify offline message shown
    // Verify cached skills still work
  })

  it("validates downloaded skills", async () => {
    // Serve skill with invalid frontmatter
    // Run sync command
    // Verify warning logged
  })
})
```

---

### aiTASK 21: CLI Help & Documentation

**Estimación**: 2h
**Dependencias**: Semana 3 completa

#### Entregables
1. Help text completo para cada comando
2. Examples en `--help` output
3. Error messages con sugerencias
4. README section para workflow commands

---

### Checkpoint Final

**Validación Completa**:
```bash
# All tests pass
bun test packages/opencode/test/workflow/

# Type check passes
bun run typecheck

# Lint passes
bun run lint

# Build succeeds
bun run build

# Manual testing
bun run packages/opencode/bin/opencode.js workflow sync
bun run packages/opencode/bin/opencode.js workflow list
bun run packages/opencode/bin/opencode.js workflow list --remote
bun run packages/opencode/bin/opencode.js workflow info sync-dipolework
bun run packages/opencode/bin/opencode.js workflow outdated
bun run packages/opencode/bin/opencode.js workflow source list
```

---

## Criterios de Validación

### Acceptance Criteria (del PRD)

| # | Criterio | Validación |
|---|----------|------------|
| CA1.1 | `workflow sync` sincroniza todos los skills | Manual + Integration test |
| CA1.2 | `workflow sync <name>` sincroniza skill específico | Manual test |
| CA1.3 | Progreso visible durante sync | Manual verification |
| CA1.4 | Resumen al final | Manual verification |
| CA1.5 | Exit code correcto | Unit test |
| CA2.1 | `workflow list` muestra instalados | Manual test |
| CA2.2 | `workflow list --remote` muestra disponibles | Manual test |
| CA2.3 | `workflow info <name>` muestra detalles | Manual test |
| CA3.1 | `source add` agrega fuente | Unit test |
| CA3.2 | `source remove` elimina fuente | Unit test |
| CA3.3 | Validación de URL | Unit test |
| CA4.1 | config.yaml con defaults | Unit test |
| CA4.2 | sync.lock actualizado | Integration test |
| CA5.1 | Network errors claros | Manual test |
| CA5.2 | Auth errors sugerencias | Manual test |
| CA5.3 | Offline mode funciona | Integration test |
| CA6.1 | Skills en Skill.all() | Integration test |
| CA6.2 | Skills en LLM context | Integration test |
| CA6.3 | Prioridad respetada | Unit test |

### Performance Targets

| Métrica | Target | Test |
|---------|--------|------|
| Cold sync (50 skills) | < 10s | Performance test |
| Warm sync | < 3s | Performance test |
| Memory usage | < 50MB | Profile test |

---

## Riesgos y Mitigaciones

| Riesgo | Probabilidad | Mitigación |
|--------|--------------|------------|
| GitHub rate limits | Media | Cache agresivo, auth token |
| Network instability | Media | Retry logic, offline mode |
| Large skill files | Baja | Streaming download, size limits |
| Concurrent sync | Baja | Lock file mutex |
| Config corruption | Baja | Backup before write, validation |

---

## Notas de Implementación

### Orden Recomendado

1. **Semana 1**: Foundation (sequential, dependencies críticas)
2. **Semana 2**: Core Sync (parallel después de fetcher)
3. **Semana 3**: Commands (parallel, independientes)
4. **Semana 4**: Polish (parallel tests, sequential docs)

### Tips de Desarrollo

- Usar `bun test --watch` durante desarrollo
- Crear mock server local para testing
- Probar con `--dry-run` antes de commits
- Mantener backward compatibility con Phase 2

### Integration Points

```typescript
// Registrar comando en CLI principal
// src/cli/cmd/cmd.ts - agregar:
import { WorkflowCommand } from "./workflow"

// En el builder de comandos:
.command(WorkflowCommand)
```

---

## Changelog

| Fecha | Versión | Cambios |
|-------|---------|---------|
| 2026-01-23 | 1.0.0 | Workflow inicial generado |
