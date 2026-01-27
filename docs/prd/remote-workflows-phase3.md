# PRD: Remote Workflows - Phase 3 (Skill Synchronization)

> Product Requirements Document para la implementación del sistema de sincronización de skills

**Version**: 1.0.0
**Status**: Draft
**Fecha**: 2026-01-23
**Owner**: aiFRAMEWORK Team
**Prerequisite**: Phase 1 (MVP) y Phase 2 (Discovery) completados

---

## Tabla de Contenidos

1. [Resumen Ejecutivo](#resumen-ejecutivo)
2. [Contexto: Phase 2 Completada](#contexto-phase-2-completada)
3. [Problema](#problema)
4. [Solución Propuesta](#solución-propuesta)
5. [Alcance de Phase 3](#alcance-de-phase-3)
6. [Requisitos Funcionales](#requisitos-funcionales)
7. [Requisitos No Funcionales](#requisitos-no-funcionales)
8. [Diseño Técnico](#diseño-técnico)
9. [Casos de Uso](#casos-de-uso)
10. [Criterios de Aceptación](#criterios-de-aceptación)
11. [Fuera de Alcance](#fuera-de-alcance)
12. [Dependencias](#dependencias)
13. [Riesgos y Mitigaciones](#riesgos-y-mitigaciones)
14. [Plan de Implementación](#plan-de-implementación)
15. [Métricas de Éxito](#métricas-de-éxito)

---

## Resumen Ejecutivo

### Objetivo

Implementar un sistema de **Skill Synchronization** que permita a dipoleCODE sincronizar skills desde repositorios remotos (GitHub), mantener un cache local actualizado, y gestionar múltiples fuentes de skills con configuración flexible.

### Entregables Clave

1. **Sync Command** - `dipolecode workflow sync` para sincronizar skills
2. **Cache Manager** - Gestión de skills en `~/.aifwk/cache/skills/`
3. **Config System** - `~/.aifwk/config.yaml` para definir fuentes
4. **Lock File** - `~/.aifwk/sync.lock` para tracking de estado
5. **Multi-Source Support** - Soporte para múltiples repos (oficial + custom)

### Impacto Esperado

- Skills actualizados sin rebuild de dipoleCODE
- Contribuciones comunitarias de workflows disponibles
- Empresas pueden tener repos internos de skills
- Funcionamiento offline con cache local
- Versionado y rollback de skills

---

## Contexto: Phase 2 Completada

### Lo que ya existe (implementado)

```
┌─────────────────────────────────────────────────────────────────┐
│                    PHASE 2 COMPLETADA ✅                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ✅ Skill Discovery Engine                                       │
│     src/skill/discovery.ts                                       │
│     - Escanea LOCAL > USER > CACHED > EMBEDDED                  │
│     - Genera SkillIndex con metadatos                           │
│     - Cachea índice para performance                            │
│                                                                  │
│  ✅ Skill Resolver                                               │
│     src/skill/resolver.ts                                        │
│     - Resuelve skill por nombre                                 │
│     - Carga contenido completo de SKILL.md                      │
│     - Búsqueda por tags y descripción                           │
│                                                                  │
│  ✅ Context Injection                                            │
│     src/skill/context.ts                                         │
│     - Genera tabla markdown de skills disponibles               │
│     - Inyecta en system prompt del LLM                          │
│                                                                  │
│  ✅ Skill Validation                                             │
│     src/skill/validator.ts                                       │
│     - Valida frontmatter con Zod schema                         │
│     - Warnings para tools no disponibles (soft validation)      │
│                                                                  │
│  ✅ Integration con Skill.state()                                │
│     src/skill/skill.ts                                           │
│     - Escanea USER y CACHED directories                         │
│     - Coexiste con sistema original                             │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Rutas configuradas

| Fuente | Path | Estado |
|--------|------|--------|
| LOCAL | `.opencode/skill/` | ✅ Funcional |
| USER | `~/.config/opencode/skill/` | ✅ Funcional |
| CACHED | `~/.aifwk/cache/skills/` | ✅ Funcional (manual) |
| EMBEDDED | (binario) | ✅ Funcional |

### Gap: Sincronización automática

```
┌─────────────────────────────────────────────────────────────────┐
│                         GAP ACTUAL                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  📂 ~/.aifwk/cache/skills/                                       │
│                                                                  │
│  ❌ No hay forma automática de poblar este directorio           │
│  ❌ Usuario debe copiar manualmente skills                       │
│  ❌ No hay tracking de versiones                                 │
│  ❌ No hay notificación de updates                              │
│                                                                  │
│  Phase 3 resuelve esto con sync automático desde repos          │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Problema

### Situación Actual

Los usuarios pueden agregar skills en `~/.aifwk/cache/skills/` pero deben hacerlo manualmente:

```bash
# Proceso actual (manual)
git clone https://github.com/aifwk/workflow-catalog /tmp/catalog
cp -r /tmp/catalog/skills/sync-dipolework ~/.aifwk/cache/skills/
rm -rf /tmp/catalog

# Repetir para cada skill...
# Sin tracking de versiones
# Sin notificaciones de updates
```

### Problemas Específicos

| # | Problema | Impacto |
|---|----------|---------|
| P1 | Sync manual de skills | Alto fricción para usuarios |
| P2 | Sin tracking de versiones | No saben si hay updates |
| P3 | Sin config de sources | No pueden agregar repos custom |
| P4 | Sin estado de sync | No saben qué tienen instalado |
| P5 | Sin validación en sync | Skills corruptos pueden entrar |
| P6 | Sin soporte multi-repo | Solo un source posible |

### Impacto en Usuarios

```
User Journey actual:
1. Descubre que existe un skill útil (ej: sync-dipolework)
2. Busca el repo donde está
3. Clona manualmente
4. Copia al directorio correcto
5. Verifica que funciona
6. Olvida actualizar cuando hay nueva versión

User Journey deseado:
1. Ejecuta: dipolecode workflow sync
2. ✅ Skills disponibles y actualizados
```

---

## Solución Propuesta

### Arquitectura de Sync

```
┌─────────────────────────────────────────────────────────────────┐
│                    SKILL SYNC ARCHITECTURE                       │
└─────────────────────────────────────────────────────────────────┘

                    ┌─────────────────────────┐
                    │    REPO CENTRAL         │
                    │  github.com/aifwk/      │
                    │  workflow-catalog       │
                    ├─────────────────────────┤
                    │  index.json             │
                    │  skills/                │
                    │    create-devtask/      │
                    │    sync-dipolework/     │
                    └───────────┬─────────────┘
                                │
                    ┌───────────┴─────────────┐
                    │                         │
                    ▼                         ▼
┌─────────────────────────┐     ┌─────────────────────────┐
│    COMPANY REPO         │     │    COMMUNITY REPO       │
│  github.com/myco/       │     │  github.com/user/       │
│  internal-skills        │     │  awesome-skills         │
└───────────┬─────────────┘     └───────────┬─────────────┘
            │                               │
            └───────────────┬───────────────┘
                            │
                            ▼
            ┌───────────────────────────────┐
            │     dipolecode workflow sync  │
            │                               │
            │  1. Read ~/.aifwk/config.yaml │
            │  2. Fetch index.json          │
            │  3. Compare versions          │
            │  4. Download new/updated      │
            │  5. Validate skills           │
            │  6. Update sync.lock          │
            └───────────────┬───────────────┘
                            │
                            ▼
            ┌───────────────────────────────┐
            │   ~/.aifwk/cache/skills/      │
            │                               │
            │   create-devtask/             │
            │   sync-dipolework/            │
            │   company-custom-skill/       │
            └───────────────────────────────┘
```

### Comandos CLI

```bash
# Sincronizar todos los skills
dipolecode workflow sync

# Sincronizar skill específico
dipolecode workflow sync sync-dipolework

# Ver skills disponibles (local + remote)
dipolecode workflow list
dipolecode workflow list --remote

# Ver información de un skill
dipolecode workflow info sync-dipolework

# Ver skills desactualizados
dipolecode workflow outdated

# Agregar nueva fuente
dipolecode workflow source add https://github.com/myco/skills

# Listar fuentes configuradas
dipolecode workflow source list

# Remover fuente
dipolecode workflow source remove myco-skills
```

---

## Alcance de Phase 3

### En Alcance ✅

| Feature | Descripción |
|---------|-------------|
| `workflow sync` | Comando para sincronizar skills |
| `workflow list` | Listar skills disponibles |
| `workflow info` | Información detallada de skill |
| `workflow outdated` | Mostrar skills desactualizados |
| `workflow source` | Gestión de fuentes |
| `config.yaml` | Configuración de sources |
| `sync.lock` | Estado de sincronización |
| Multi-source | Soporte para múltiples repos |
| Offline mode | Usar solo cache cuando sin red |
| Version tracking | Tracking de versiones por skill |
| Validation | Validación de skills descargados |

### Fuera de Alcance ❌

| Feature | Razón | Phase Futura |
|---------|-------|--------------|
| Auto-sync al iniciar | Complejidad, latencia startup | Phase 4 |
| Background sync | Requiere daemon/service | Phase 4 |
| Firma de skills | Infraestructura de PKI | Phase 4 |
| UI visual | Requiere extensión VSCode | Phase 4 |
| Rollback automático | Complejidad de UX | Phase 4 |
| Dependency resolution | Skills que dependen de otros | Phase 5 |

---

## Requisitos Funcionales

### RF1: Comando `workflow sync`

**Descripción**: Sincroniza skills desde fuentes configuradas

**Comportamiento**:
```
INPUT: dipolecode workflow sync [skill-name]
OUTPUT: Skills actualizados en ~/.aifwk/cache/skills/

Si skill-name especificado:
  - Sincronizar solo ese skill
  - Buscar en todas las fuentes configuradas

Si no especificado:
  - Sincronizar todos los skills de todas las fuentes
  - Respetar versiones existentes (solo update si newer)
```

**Flujo**:
```
1. Leer config.yaml para obtener sources
2. Para cada source habilitado:
   a. Fetch index.json del repo
   b. Comparar con sync.lock local
   c. Identificar new/updated skills
3. Descargar skills identificados
4. Validar frontmatter de cada skill
5. Guardar en cache directory
6. Actualizar sync.lock
7. Reportar resultados
```

**Output esperado**:
```
$ dipolecode workflow sync

Syncing from 2 sources...

📦 github.com/aifwk/workflow-catalog
   ✓ sync-dipolework    1.0.0 → 1.1.0 (updated)
   ✓ archive-tasks      1.0.0 (new)

📦 github.com/myco/internal-skills
   ✓ deploy-pipeline    2.0.0 (up to date)
   ⚠ legacy-workflow    requires dipoleCODE >= 0.8.0

Summary:
  1 updated
  1 new
  1 up to date
  1 warning

✓ Sync completed in 2.3s
```

### RF2: Comando `workflow list`

**Descripción**: Lista skills disponibles

**Comportamiento**:
```
INPUT: dipolecode workflow list [--remote] [--source <name>]
OUTPUT: Lista de skills con metadata

--remote: Mostrar también skills disponibles en repos que no están instalados
--source: Filtrar por source específico
```

**Output esperado**:
```
$ dipolecode workflow list

Available Skills (6 installed):

  Name               Version  Source              Description
  ─────────────────────────────────────────────────────────────────
  create-devtask     1.2.0    embedded           Create devTASK workflows
  create-aitask      1.1.0    embedded           Create aiTASK blueprints
  complete-aitask    1.0.0    embedded           Document completion notes
  sync-dipolework    1.1.0    cached (official)  Sync with dipole.work
  archive-tasks      1.0.0    cached (official)  Archive completed tasks
  deploy-pipeline    2.0.0    cached (myco)      Deploy to production

$ dipolecode workflow list --remote

Available from remotes (not installed):

  Name               Version  Source     Description
  ─────────────────────────────────────────────────────────────────
  code-review        1.0.0    official   Structured code review workflow
  onboarding         1.0.0    official   New project onboarding
```

### RF3: Comando `workflow info`

**Descripción**: Muestra información detallada de un skill

**Output esperado**:
```
$ dipolecode workflow info sync-dipolework

Skill: sync-dipolework
Version: 1.1.0
Source: cached (github.com/aifwk/workflow-catalog)
Status: installed

Description:
  Sync work done in dipole.work with local aiFRAMEWORK project

Tools required:
  ✓ afwk_get_kanban_status
  ✓ afwk_create_devtask
  ✓ afwk_move_kanban_task

Tags: sync, dipole.work, collaboration

Location: ~/.aifwk/cache/skills/sync-dipolework/SKILL.md

Last synced: 2026-01-23 10:30:00
```

### RF4: Comando `workflow outdated`

**Descripción**: Muestra skills con updates disponibles

**Output esperado**:
```
$ dipolecode workflow outdated

Outdated Skills:

  Name               Installed  Available  Source
  ──────────────────────────────────────────────────
  sync-dipolework    1.0.0      1.1.0      official
  deploy-pipeline    1.5.0      2.0.0      myco

Run 'dipolecode workflow sync' to update.
```

### RF5: Gestión de Sources (`workflow source`)

**Subcomandos**:
```bash
# Agregar nueva fuente
dipolecode workflow source add <url> [--name <name>] [--auth <token-ref>]

# Listar fuentes
dipolecode workflow source list

# Remover fuente
dipolecode workflow source remove <name>

# Habilitar/deshabilitar
dipolecode workflow source enable <name>
dipolecode workflow source disable <name>
```

### RF6: Archivo config.yaml

**Ubicación**: `~/.aifwk/config.yaml`

**Schema**:
```yaml
# ~/.aifwk/config.yaml

version: 1

sources:
  - name: official
    url: https://github.com/aifwk/workflow-catalog
    branch: main
    enabled: true
    priority: 100  # Higher = checked first

  - name: myco-internal
    url: https://github.com/mycompany/aifwk-skills
    branch: main
    enabled: true
    priority: 50
    auth:
      type: github-token
      env: GITHUB_TOKEN  # Reference to env var

settings:
  # Sync behavior
  auto_sync: false           # Auto sync on startup (Phase 4)
  sync_interval: 24h         # Interval for auto sync (Phase 4)

  # Network
  offline_mode: false        # Use only cache, no network
  timeout: 30s               # Network timeout

  # Validation
  skip_validation: false     # Skip frontmatter validation
  allow_incompatible: true   # Install skills with version warnings
```

### RF7: Archivo sync.lock

**Ubicación**: `~/.aifwk/sync.lock`

**Schema**:
```yaml
# ~/.aifwk/sync.lock
# DO NOT EDIT MANUALLY

version: 1
last_sync: "2026-01-23T10:30:00Z"

sources:
  official:
    url: https://github.com/aifwk/workflow-catalog
    commit: abc123def456789
    synced_at: "2026-01-23T10:30:00Z"

  myco-internal:
    url: https://github.com/mycompany/aifwk-skills
    commit: 789xyz012345678
    synced_at: "2026-01-23T10:30:00Z"

skills:
  sync-dipolework:
    version: "1.1.0"
    source: official
    hash: "sha256:abcdef123456..."
    installed_at: "2026-01-23T10:30:00Z"

  deploy-pipeline:
    version: "2.0.0"
    source: myco-internal
    hash: "sha256:fedcba654321..."
    installed_at: "2026-01-22T15:00:00Z"
```

### RF8: Formato de index.json (Repo)

**Ubicación en repo**: `index.json` en raíz

**Schema**:
```json
{
  "version": "1.0.0",
  "name": "aiFRAMEWORK Official Skills",
  "description": "Official skill catalog for aiFRAMEWORK",
  "lastUpdated": "2026-01-23T12:00:00Z",
  "skills": [
    {
      "name": "sync-dipolework",
      "version": "1.1.0",
      "description": "Sync work done in dipole.work with local project",
      "path": "skills/sync-dipolework",
      "minDipolecode": "0.5.0",
      "tags": ["sync", "dipole.work", "collaboration"],
      "hash": "sha256:abcdef123456..."
    },
    {
      "name": "archive-tasks",
      "version": "1.0.0",
      "description": "Archive old completed tasks",
      "path": "skills/archive-tasks",
      "minDipolecode": "0.6.0",
      "tags": ["archive", "cleanup"],
      "hash": "sha256:123456abcdef..."
    }
  ]
}
```

---

## Requisitos No Funcionales

### RNF1: Performance

| Métrica | Target | Medición |
|---------|--------|----------|
| Sync time (cold) | < 10s para 50 skills | Tiempo total de sync inicial |
| Sync time (warm) | < 3s para check updates | Tiempo con cache válido |
| Network timeout | 30s default, configurable | Por request |
| Parallel downloads | Hasta 5 concurrent | Skills en paralelo |

### RNF2: Reliability

| Requisito | Implementación |
|-----------|----------------|
| Atomic writes | Escribir a temp, luego rename |
| Rollback on failure | No modificar sync.lock hasta éxito |
| Graceful degradation | Offline mode si red falla |
| Retry logic | 3 retries con backoff exponencial |

### RNF3: Security

| Requisito | Implementación |
|-----------|----------------|
| HTTPS only | No permitir repos HTTP |
| Token storage | Referencia a env vars, no plaintext |
| Hash verification | Verificar hash de skills descargados |
| No arbitrary execution | Skills son texto, no código ejecutable |

### RNF4: Usability

| Requisito | Implementación |
|-----------|----------------|
| Progress feedback | Mostrar progreso durante sync |
| Error messages | Mensajes claros con acción sugerida |
| Confirmation prompts | Confirmar antes de acciones destructivas |
| Help text | `--help` completo para cada comando |

---

## Diseño Técnico

### Estructura de Módulos

```
packages/opencode/src/
├── workflow/                      # Nuevo módulo
│   ├── index.ts                   # Exports
│   ├── commands/
│   │   ├── sync.ts               # workflow sync command
│   │   ├── list.ts               # workflow list command
│   │   ├── info.ts               # workflow info command
│   │   ├── outdated.ts           # workflow outdated command
│   │   └── source.ts             # workflow source subcommands
│   ├── config/
│   │   ├── schema.ts             # Zod schemas for config.yaml
│   │   ├── loader.ts             # Load and validate config
│   │   └── defaults.ts           # Default configuration
│   ├── sync/
│   │   ├── fetcher.ts            # Fetch from remote repos
│   │   ├── comparator.ts         # Compare versions
│   │   ├── downloader.ts         # Download skills
│   │   └── lock.ts               # Manage sync.lock
│   └── types.ts                   # TypeScript types
├── skill/                         # Existente (Phase 2)
│   ├── discovery.ts              # Ya implementado
│   ├── resolver.ts               # Ya implementado
│   ├── validator.ts              # Ya implementado
│   └── ...
```

### Interfaces Principales

```typescript
// workflow/types.ts

export interface WorkflowConfig {
  version: number
  sources: SourceConfig[]
  settings: WorkflowSettings
}

export interface SourceConfig {
  name: string
  url: string
  branch: string
  enabled: boolean
  priority: number
  auth?: AuthConfig
}

export interface AuthConfig {
  type: 'github-token' | 'bearer'
  env: string  // Environment variable name
}

export interface WorkflowSettings {
  autoSync: boolean
  syncInterval: string
  offlineMode: boolean
  timeout: string
  skipValidation: boolean
  allowIncompatible: boolean
}

export interface SyncLock {
  version: number
  lastSync: string
  sources: Record<string, SourceLockEntry>
  skills: Record<string, SkillLockEntry>
}

export interface SourceLockEntry {
  url: string
  commit: string
  syncedAt: string
}

export interface SkillLockEntry {
  version: string
  source: string
  hash: string
  installedAt: string
}

export interface RemoteIndex {
  version: string
  name: string
  description: string
  lastUpdated: string
  skills: RemoteSkillEntry[]
}

export interface RemoteSkillEntry {
  name: string
  version: string
  description: string
  path: string
  minDipolecode?: string
  tags: string[]
  hash: string
}

export interface SyncResult {
  success: boolean
  updated: SkillSyncResult[]
  added: SkillSyncResult[]
  failed: SkillSyncError[]
  warnings: string[]
  duration: number
}

export interface SkillSyncResult {
  name: string
  version: string
  source: string
  previousVersion?: string
}

export interface SkillSyncError {
  name: string
  source: string
  error: string
}
```

### Flujo de Sync (Detallado)

```
┌─────────────────────────────────────────────────────────────────┐
│                    SYNC FLOW DETAIL                              │
└─────────────────────────────────────────────────────────────────┘

START: dipolecode workflow sync
        │
        ▼
┌───────────────────┐
│ 1. Load Config    │
│    config.yaml    │
└─────────┬─────────┘
          │
          ▼
┌───────────────────┐     ┌───────────────────┐
│ 2. Load Lock      │     │ Create default    │
│    sync.lock      │────▶│ if not exists     │
└─────────┬─────────┘     └───────────────────┘
          │
          ▼
┌───────────────────┐
│ 3. For each       │
│    enabled source │
└─────────┬─────────┘
          │
          ├──────────────────────────────────────┐
          │                                      │
          ▼                                      ▼
┌───────────────────┐                  ┌───────────────────┐
│ 4. Fetch index    │                  │ Skip if offline   │
│    from source    │                  │ mode & no cache   │
└─────────┬─────────┘                  └───────────────────┘
          │
          ▼
┌───────────────────┐
│ 5. Compare with   │
│    lock entries   │
└─────────┬─────────┘
          │
    ┌─────┴─────┐
    │           │
    ▼           ▼
┌─────────┐ ┌─────────┐
│ New     │ │ Updated │
│ skills  │ │ skills  │
└────┬────┘ └────┬────┘
     │           │
     └─────┬─────┘
           │
           ▼
┌───────────────────┐
│ 6. Download       │
│    (parallel)     │
└─────────┬─────────┘
          │
          ▼
┌───────────────────┐
│ 7. Validate       │
│    frontmatter    │
└─────────┬─────────┘
          │
    ┌─────┴─────┐
    │           │
    ▼           ▼
┌─────────┐ ┌─────────┐
│ Valid   │ │ Invalid │
│ skills  │ │ → warn  │
└────┬────┘ └─────────┘
     │
     ▼
┌───────────────────┐
│ 8. Verify hash    │
│    (if provided)  │
└─────────┬─────────┘
          │
          ▼
┌───────────────────┐
│ 9. Write to cache │
│    (atomic)       │
└─────────┬─────────┘
          │
          ▼
┌───────────────────┐
│ 10. Update lock   │
│     sync.lock     │
└─────────┬─────────┘
          │
          ▼
┌───────────────────┐
│ 11. Report        │
│     results       │
└───────────────────┘
          │
          ▼
        END
```

### Manejo de Errores

```typescript
// workflow/sync/errors.ts

export class SyncError extends Error {
  constructor(
    message: string,
    public readonly code: SyncErrorCode,
    public readonly source?: string,
    public readonly skill?: string
  ) {
    super(message)
  }
}

export enum SyncErrorCode {
  // Network errors
  NETWORK_TIMEOUT = 'SYNC_NETWORK_TIMEOUT',
  NETWORK_UNREACHABLE = 'SYNC_NETWORK_UNREACHABLE',

  // Auth errors
  AUTH_FAILED = 'SYNC_AUTH_FAILED',
  AUTH_TOKEN_MISSING = 'SYNC_AUTH_TOKEN_MISSING',

  // Validation errors
  INVALID_INDEX = 'SYNC_INVALID_INDEX',
  INVALID_SKILL = 'SYNC_INVALID_SKILL',
  HASH_MISMATCH = 'SYNC_HASH_MISMATCH',

  // Config errors
  CONFIG_INVALID = 'SYNC_CONFIG_INVALID',
  SOURCE_NOT_FOUND = 'SYNC_SOURCE_NOT_FOUND',

  // Filesystem errors
  WRITE_FAILED = 'SYNC_WRITE_FAILED',
  PERMISSION_DENIED = 'SYNC_PERMISSION_DENIED',
}
```

---

## Casos de Uso

### CU1: Usuario sincroniza por primera vez

**Actor**: Developer
**Precondición**: dipoleCODE instalado, config.yaml con source default
**Flujo**:
1. Usuario ejecuta `dipolecode workflow sync`
2. Sistema lee config.yaml (source: official)
3. Sistema fetch index.json de github.com/aifwk/workflow-catalog
4. Sistema encuentra 5 skills disponibles
5. Sistema descarga todos (primera vez = todos nuevos)
6. Sistema valida y guarda en cache
7. Sistema crea sync.lock
8. Sistema muestra: "✓ 5 skills installed"

### CU2: Usuario agrega repo interno de empresa

**Actor**: Developer en empresa
**Precondición**: Repo interno existe con skills
**Flujo**:
1. Usuario ejecuta `dipolecode workflow source add https://github.com/myco/skills --name myco`
2. Sistema valida URL (fetch index.json)
3. Sistema agrega entry a config.yaml
4. Usuario ejecuta `dipolecode workflow sync`
5. Sistema sincroniza de ambos sources
6. Skills de myco aparecen en `workflow list`

### CU3: Usuario en modo offline

**Actor**: Developer sin internet
**Precondición**: Skills previamente sincronizados
**Flujo**:
1. Usuario ejecuta `dipolecode workflow sync`
2. Sistema detecta que network está down
3. Sistema muestra: "⚠ Offline mode - using cached skills"
4. Skills cached siguen funcionando
5. Usuario puede usar `/sync-dipolework` normalmente

### CU4: Skill requiere versión mayor de dipoleCODE

**Actor**: Developer con dipoleCODE 0.5.0
**Precondición**: Skill requiere minDipolecode: "0.7.0"
**Flujo**:
1. Usuario ejecuta `dipolecode workflow sync`
2. Sistema detecta incompatibilidad
3. Sistema muestra: "⚠ archive-tasks requires dipoleCODE >= 0.7.0 (you have 0.5.0)"
4. Si allowIncompatible=true: instala con warning
5. Si allowIncompatible=false: skip skill

---

## Criterios de Aceptación

### CA1: Sync Command

- [ ] `workflow sync` sincroniza todos los skills de todas las fuentes habilitadas
- [ ] `workflow sync <name>` sincroniza solo el skill especificado
- [ ] Progreso visible durante sync (spinner + mensajes)
- [ ] Resumen al final con contadores (new/updated/failed)
- [ ] Exit code 0 si éxito, 1 si errores

### CA2: List/Info Commands

- [ ] `workflow list` muestra todos los skills instalados
- [ ] `workflow list --remote` muestra skills disponibles no instalados
- [ ] `workflow info <name>` muestra detalles completos
- [ ] Formato tabular legible en terminal

### CA3: Source Management

- [ ] `workflow source add` agrega nueva fuente a config.yaml
- [ ] `workflow source remove` elimina fuente
- [ ] `workflow source list` muestra fuentes configuradas
- [ ] Validación de URL antes de agregar

### CA4: Config & Lock Files

- [ ] config.yaml creado con defaults si no existe
- [ ] sync.lock actualizado después de cada sync exitoso
- [ ] Archivos YAML válidos y parseables

### CA5: Error Handling

- [ ] Network errors muestran mensaje claro
- [ ] Auth errors sugieren verificar token
- [ ] Validation errors indican qué está mal
- [ ] Modo offline funciona con cache existente

### CA6: Integration con Phase 2

- [ ] Skills sincronizados aparecen en Skill.all()
- [ ] Skills sincronizados aparecen en LLM context
- [ ] Prioridad LOCAL > USER > CACHED respetada

---

## Dependencias

### Internas

| Dependencia | Módulo | Propósito |
|-------------|--------|-----------|
| Skill Discovery | `src/skill/discovery.ts` | Detectar skills cacheados |
| Skill Validator | `src/skill/validator.ts` | Validar skills descargados |
| CLI Framework | `src/cli/` | Comandos y subcomandos |
| Config System | `src/config/` | Cargar YAML |

### Externas

| Dependencia | Versión | Propósito |
|-------------|---------|-----------|
| Bun | ^1.0.0 | Runtime, fetch API |
| zod | ^3.22.0 | Schema validation |
| yaml | existente | Parse config.yaml |

---

## Riesgos y Mitigaciones

| Riesgo | Probabilidad | Impacto | Mitigación |
|--------|--------------|---------|------------|
| GitHub rate limits | Media | Alto | Cache agresivo, usar API con auth |
| Skills maliciosos | Baja | Alto | Skills son texto (no ejecutable), validación |
| Network failures | Media | Medio | Offline mode, retry logic |
| Breaking changes en index format | Baja | Alto | Version field en index.json |
| Conflictos de nombres | Media | Bajo | Source prefix en lock file |

---

## Plan de Implementación

### Semana 1: Foundation

| # | aiTASK | Descripción | Estimación |
|---|--------|-------------|------------|
| 01 | Config System | Schema + loader para config.yaml | 4h |
| 02 | Lock System | Schema + manager para sync.lock | 4h |
| 03 | Types & Interfaces | TypeScript types compartidos | 2h |

### Semana 2: Core Sync

| # | aiTASK | Descripción | Estimación |
|---|--------|-------------|------------|
| 04 | Index Fetcher | Fetch y parse index.json de repos | 4h |
| 05 | Version Comparator | Comparar versiones local vs remote | 3h |
| 06 | Skill Downloader | Descargar SKILL.md con retry logic | 4h |
| 07 | Hash Verification | Verificar integridad de downloads | 2h |

### Semana 3: Commands

| # | aiTASK | Descripción | Estimación |
|---|--------|-------------|------------|
| 08 | `workflow sync` | Comando principal de sync | 6h |
| 09 | `workflow list` | Listar skills instalados/remote | 3h |
| 10 | `workflow info` | Info detallada de skill | 2h |
| 11 | `workflow outdated` | Mostrar skills desactualizados | 2h |
| 12 | `workflow source` | Subcomandos de source management | 4h |

### Semana 4: Polish & Test

| # | aiTASK | Descripción | Estimación |
|---|--------|-------------|------------|
| 13 | Error Handling | Manejo robusto de errores | 3h |
| 14 | Offline Mode | Graceful degradation sin red | 3h |
| 15 | Tests | Unit + integration tests | 6h |
| 16 | Documentation | CLI help + docs | 3h |

### Timeline Visual

```
Semana 1    Semana 2    Semana 3    Semana 4
────────────────────────────────────────────────
[Config  ]  [Fetcher ]  [sync cmd]  [Errors ]
[Lock    ]  [Compare ]  [list cmd]  [Offline]
[Types   ]  [Download]  [info cmd]  [Tests  ]
            [Hash    ]  [outdated]  [Docs   ]
                        [source  ]
────────────────────────────────────────────────
Foundation  Core Sync   Commands    Polish
```

---

## Métricas de Éxito

### Adoption Metrics

| Métrica | Target | Medición |
|---------|--------|----------|
| Users using sync | 50% of users | Telemetry (opt-in) |
| Custom sources added | 10% of users | Config analysis |
| Skills synced per user | > 3 promedio | sync.lock analysis |

### Performance Metrics

| Métrica | Target | Medición |
|---------|--------|----------|
| Cold sync < 10s | 95th percentile | Timing logs |
| Warm sync < 3s | 95th percentile | Timing logs |
| Sync success rate | > 99% | Error logs |

### Quality Metrics

| Métrica | Target | Medición |
|---------|--------|----------|
| Zero data loss | 100% | Atomic writes |
| Validation catch rate | > 95% | Invalid skills blocked |
| Offline reliability | 100% | Cache always works |

---

## Appendix: Default config.yaml

```yaml
# ~/.aifwk/config.yaml
# Created by dipoleCODE on first run

version: 1

sources:
  - name: official
    url: https://github.com/aifwk/workflow-catalog
    branch: main
    enabled: true
    priority: 100

settings:
  auto_sync: false
  sync_interval: 24h
  offline_mode: false
  timeout: 30s
  skip_validation: false
  allow_incompatible: true
```

---

## Appendix: CLI Help Text

```
$ dipolecode workflow --help

Manage workflow skills from remote repositories

Usage:
  dipolecode workflow <command> [options]

Commands:
  sync [name]       Synchronize skills from configured sources
  list              List installed skills
  info <name>       Show detailed information about a skill
  outdated          Show skills with available updates
  source            Manage skill sources

Options:
  -h, --help        Show this help message
  -v, --verbose     Show detailed output

Examples:
  dipolecode workflow sync                    # Sync all skills
  dipolecode workflow sync sync-dipolework   # Sync specific skill
  dipolecode workflow list --remote          # Show available remote skills
  dipolecode workflow source add <url>       # Add new source

Run 'dipolecode workflow <command> --help' for more information.
```
