# Remote Workflows Architecture

> Arquitectura para gestión de workflows declarativos en dipoleCODE/aiFRAMEWORK

**Version**: 1.0.0
**Status**: Propuesta
**Fecha**: 2025-01-23

---

## Tabla de Contenidos

1. [Resumen Ejecutivo](#resumen-ejecutivo)
2. [Conceptos Fundamentales](#conceptos-fundamentales)
3. [Arquitectura de Componentes](#arquitectura-de-componentes)
4. [Skill Discovery & Resolution](#skill-discovery--resolution)
5. [Formato Estándar de Skills](#formato-estándar-de-skills)
6. [Sincronización con Repo Central](#sincronización-con-repo-central)
7. [Flujos de Datos](#flujos-de-datos)
8. [Ejemplos de Implementación](#ejemplos-de-implementación)
9. [Consideraciones de Compatibilidad](#consideraciones-de-compatibilidad)
10. [Guía de Contribución](#guía-de-contribución)

---

## Resumen Ejecutivo

### Problema

Los workflows de aiFRAMEWORK (crear devTASKs, aiTASKs, etc.) están definidos como instrucciones para el LLM. Actualmente estos workflows están embebidos en el binario, lo que requiere un rebuild para cualquier modificación.

### Solución

Separar la arquitectura en tres capas:

| Capa | Ubicación | Mutabilidad | Responsabilidad |
|------|-----------|-------------|-----------------|
| **Tools** | Binario compilado | Estable | Operaciones genéricas (crear entidad, mover tarea) |
| **Schemas** | Repo central + proyecto | Dinámica | Estructura de carpetas, validación, campos |
| **Skills** | Repo central + cache | Dinámica | Orquestación de tools (workflows conversacionales) |
| **Templates** | Repo central + proyecto | Dinámica | Contenido inicial de documentos |

### Beneficios

- Modificar workflows sin rebuild de dipoleCODE
- Versionado independiente de skills
- Contribuciones comunitarias de workflows
- Customización por proyecto
- Funcionamiento offline (con cache)

---

## Conceptos Fundamentales

### Tools: Primitivas Genéricas

Los **Tools** son funciones TypeScript compiladas en el binario de dipoleCODE. Son operaciones **genéricas** que leen la configuración de schemas en runtime, permitiendo que la estructura y validación cambien sin recompilar.

```typescript
// Ejemplo: Tool genérico para crear entidades
afwk_create_entity({
  type: string,         // Tipo de entidad (devtask, aitask, etc.)
  data: {               // Datos validados contra el schema
    title: string,
    description: string,
    [key: string]: any  // Campos adicionales según schema
  }
}) → {
  ok: boolean,
  tool_run_id: string,
  entity_path: string,  // Path de la entidad creada
  changes: Change[],
  errors: string[]
}

// El tool internamente:
// 1. Lee schema desde .afwk/schemas/{type}.yaml (o cache/embedded)
// 2. Valida data contra campos del schema
// 3. Crea estructura de carpetas según schema.structure
// 4. Aplica templates a cada archivo
// 5. Registra en kanban según schema.kanban
```

**Características de los Tools:**
- Ejecutan una sola operación bien definida
- Validan inputs y retornan resultados estructurados
- Escriben audit log automáticamente
- Emiten eventos para la UI (VSCode extension)
- NO contienen lógica conversacional

> **Nota sobre Atomicidad**: Los tools son "atómicos" a nivel de **negocio**, no a nivel de sistema de archivos. Por ejemplo, `afwk_create_devtask` puede internamente crear directorios, escribir archivos y actualizar el kanban — pero desde la perspectiva del LLM y los skills, es UNA operación indivisible que o tiene éxito completamente o falla sin dejar estado parcial. Esta abstracción permite que los skills expresen *intención* ("crear devTASK") sin coordinar primitivas de bajo nivel.

**Tools Disponibles:**

| Tool | Tipo | Descripción |
|------|------|-------------|
| `afwk_get_kanban_status` | Read | Lee estado del kanban |
| `afwk_get_steering_context` | Read | Lee steering docs |
| `afwk_get_schema` | Read | Lee schema de una entidad |
| `afwk_validate_entity` | Read | Valida datos contra schema de entidad |
| `afwk_create_entity` | Write | Crea entidad según su schema (devtask, aitask, etc.) |
| `afwk_update_entity` | Write | Actualiza entidad existente |
| `afwk_move_kanban_task` | Write | Mueve tarea entre columnas |
| `afwk_update_document` | Write | Actualiza documento en .afwk/ |

> **Nota**: Los tools anteriores específicos (`afwk_create_devtask`, `afwk_create_aitask`) son ahora aliases del tool genérico `afwk_create_entity` con el tipo pre-configurado para backward compatibility.

### Skills: Orquestación Declarativa

Los **Skills** son documentos Markdown que contienen instrucciones para el LLM sobre cómo ejecutar un workflow. NO son código ejecutable.

```markdown
---
name: create-devtask
description: Interactive workflow for creating devTASKs
---

# devTASK Creation Workflow

## Phase 1: Context
1. Ask user clarifying questions
2. Understand the problem to solve

## Phase 2: Exploration
1. Call `afwk_get_steering_context` to read project context
2. Call `afwk_get_kanban_status` to see existing tasks

## Phase 3: Generate & Create
1. Generate complete content
2. Call `afwk_create_devtask` with content parameter
```

**Características de los Skills:**
- Son instrucciones en lenguaje natural para el LLM
- Definen fases conversacionales
- Indican cuándo y cómo llamar tools
- Pueden ser modificados sin rebuild
- Se versionan en repositorio Git

### Templates: Estructura de Documentos

Los **Templates** son archivos Markdown que definen la estructura esperada de los documentos generados. El LLM los usa como GUÍA, no como OUTPUT directo.

```markdown
# {{title}}

## Objetivo
<!-- Descripción del objetivo -->

## Alcance
- Componente 1
- Componente 2

## Criterios de Éxito
- [ ] Criterio 1
- [ ] Criterio 2
```

**Características de los Templates:**
- Definen secciones esperadas
- Usan placeholders para referencia (`{{variable}}`)
- El LLM genera contenido real basado en la estructura
- Pueden customizarse por proyecto

### Schemas: Estructura Configurable

Los **Schemas** son archivos YAML que definen la estructura de carpetas, archivos requeridos, campos y reglas de validación para cada tipo de entidad. Permiten modificar completamente cómo se organizan los artefactos sin recompilar el binario.

```yaml
# .afwk/schemas/devtask.yaml
entity: devtask
version: 1

# Estructura de carpetas (soporta anidamiento recursivo)
structure:
  root: ".afwk/tasks/devtask-{slug}"

  contents:
    - type: file
      name: "overview.md"
      template: "devtask-overview.md"
      required: true

    - type: directory
      name: "specs"
      required: true
      contents:
        - type: file
          name: "requirements.md"
          template: "devtask-requirements.md"
          required: true
        - type: file
          name: "acceptance-criteria.md"
          template: "devtask-acceptance.md"
          required: false

    - type: directory
      name: "implementation"
      required: false
      contents:
        - type: file
          name: "notes.md"
          template: "implementation-notes.md"
          required: false
        - type: directory
          name: "iterations"
          required: false
          contents:
            - type: file
              name: "iteration-{n}.md"
              template: "iteration.md"
              dynamic: true  # se crean bajo demanda

# Campos de la entidad
fields:
  title:
    type: string
    required: true
    max_length: 100
  description:
    type: string
    required: true
  priority:
    type: enum
    values: [low, medium, high, critical]
    default: medium
  tags:
    type: array
    items: string
    required: false

# Reglas de validación
validation:
  - rule: "title_not_empty"
    message: "El título no puede estar vacío"
  - rule: "slug_unique"
    message: "Ya existe un devTASK con ese slug"

# Integración con kanban
kanban:
  initial_column: "backlog"
  allowed_transitions:
    backlog: [todo]
    todo: [in_progress, backlog]
    in_progress: [review, todo]
    review: [done, in_progress]
    done: [archive]
```

**Estructura resultante:**
```
.afwk/tasks/devtask-auth-system/
├── overview.md
├── specs/
│   ├── requirements.md
│   └── acceptance-criteria.md
└── implementation/
    ├── notes.md
    └── iterations/
        ├── iteration-1.md
        └── iteration-2.md
```

**Características de los Schemas:**
- Definen estructura de carpetas con anidamiento recursivo
- Especifican archivos requeridos vs opcionales
- Declaran campos con tipos y validación
- Configuran integración con kanban
- Son versionados independientemente del binario
- Pueden customizarse por proyecto (override local)

> **Tools Genéricos**: Los tools en el binario son genéricos y leen el schema en runtime. Por ejemplo, `afwk_create_entity(type: "devtask", data: {...})` consulta el schema para saber qué carpetas crear, qué archivos generar, y qué validaciones aplicar. Esto permite agregar nuevos tipos de entidad o modificar estructuras existentes sin rebuild.

**Orden de resolución de schemas:**
| Prioridad | Fuente | Path |
|-----------|--------|------|
| 1 | LOCAL | `.afwk/schemas/{entity}.yaml` |
| 2 | CACHED | `~/.aifwk/cache/schemas/{entity}.yaml` |
| 3 | EMBEDDED | (defaults en binario) |

---

## Arquitectura de Componentes

### Diagrama General

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           REPO CENTRAL (GitHub)                              │
│                     github.com/aifwk/workflow-catalog                        │
│                                                                              │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐              │
│  │ skills/         │  │ templates/      │  │ index.json      │              │
│  │ ├─ create-devta │  │ ├─ overview.md  │  │                 │              │
│  │ ├─ create-aitas │  │ ├─ blueprint.md │  │ Catálogo de     │              │
│  │ └─ sync-dipole  │  │ └─ completion.md│  │ skills          │              │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘              │
└──────────────────────────────────┬──────────────────────────────────────────┘
                                   │
                                   │ git clone / sync
                                   ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              dipoleCODE                                      │
│                                                                              │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │                         SKILL RESOLVER                                 │  │
│  │                                                                        │  │
│  │   Priority Order:                                                      │  │
│  │   1. LOCAL      .opencode/skill/         (project overrides)           │  │
│  │   2. USER       ~/.config/opencode/skill/ (user customs)               │  │
│  │   3. CACHED     ~/.aifwk/cache/skills/   (synced from repo)            │  │
│  │   4. EMBEDDED   (compiled in binary)      (fallback defaults)          │  │
│  │                                                                        │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                   │                                          │
│                                   ▼                                          │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │                         SKILL INDEX                                    │  │
│  │                                                                        │  │
│  │   Generated at startup from all sources:                               │  │
│  │   [                                                                    │  │
│  │     { name: "create-devtask", description: "...", source: "embedded" },│  │
│  │     { name: "sync-dipolework", description: "...", source: "cached" }  │  │
│  │   ]                                                                    │  │
│  │                                                                        │  │
│  │   Injected into LLM context for discovery                              │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                   │                                          │
│                                   ▼                                          │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │                              LLM                                       │  │
│  │                                                                        │  │
│  │   Context = Static System Prompt                                       │  │
│  │           + Dynamic Skill Index                                        │  │
│  │           + Skill Content (when invoked)                               │  │
│  │                                                                        │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                   │                                          │
│                                   ▼                                          │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │                     TOOLS (TypeScript)                                 │  │
│  │                                                                        │  │
│  │   Compiled in binary - stable primitives                               │  │
│  │   Execute atomic operations when called by LLM                         │  │
│  │                                                                        │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                   │                                          │
└───────────────────────────────────┼──────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                        VSCode Extension                                      │
│                                                                              │
│   Receives events from tools (FileOpen, StagingRequest)                      │
│   Renders UI components                                                      │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Estructura de Directorios

```
# Repo Central (github.com/aifwk/workflow-catalog)
workflow-catalog/
├── index.json                    # Catálogo de skills y schemas
├── schemas/
│   ├── devtask.yaml              # Estructura de devTASKs
│   ├── aitask.yaml               # Estructura de aiTASKs
│   └── steering.yaml             # Estructura de steering docs
├── skills/
│   ├── create-devtask/
│   │   ├── SKILL.md              # Instrucciones del workflow
│   │   └── README.md             # Documentación para contributors
│   ├── create-aitask/
│   │   └── SKILL.md
│   ├── complete-aitask/
│   │   └── SKILL.md
│   └── sync-dipolework/
│       └── SKILL.md
├── templates/
│   ├── devtask-overview.md       # Template para devTASK overview
│   ├── devtask-requirements.md   # Template para requirements
│   ├── aitask-blueprint.md       # Template para aiTASK blueprint
│   └── completion-notes.md       # Template para completion notes
└── CONTRIBUTING.md

# Cache Local (~/.aifwk/)
~/.aifwk/
├── cache/
│   ├── schemas/                  # Schemas sincronizados
│   │   ├── devtask.yaml
│   │   └── aitask.yaml
│   ├── skills/                   # Skills sincronizados
│   │   ├── create-devtask/
│   │   └── sync-dipolework/
│   └── templates/                # Templates sincronizados
├── config.yaml                   # Configuración de sources
└── sync.lock                     # Estado de última sincronización

# Proyecto Local
mi-proyecto/
├── .opencode/
│   └── skill/                    # Overrides locales (prioridad máxima)
│       └── create-devtask/       # Override del skill por defecto
│           └── SKILL.md
├── .afwk/
│   ├── schemas/                  # Schemas del proyecto (override)
│   │   └── devtask.yaml          # Estructura custom de devTASKs
│   ├── templates/                # Templates del proyecto
│   │   └── devtask-overview.md   # Override de template
│   ├── kanban/
│   └── steering/
└── ...
```

---

## Skill Discovery & Resolution

### Orden de Prioridad

Cuando se invoca un skill (ej: `/create-devtask`), el sistema busca en este orden:

| Prioridad | Fuente | Path | Caso de Uso |
|-----------|--------|------|-------------|
| 1 | LOCAL | `.opencode/skill/{name}/` | Override específico del proyecto |
| 2 | USER | `~/.config/opencode/skill/{name}/` | Customización personal |
| 3 | CACHED | `~/.aifwk/cache/skills/{name}/` | Skills del repo central |
| 4 | EMBEDDED | (en binario) | Defaults que siempre funcionan |

**Primera coincidencia gana.** Si existe en LOCAL, no busca en USER/CACHED/EMBEDDED.

### Skill Index Generation

Al iniciar dipoleCODE, se genera un índice de todos los skills disponibles:

```typescript
interface SkillIndexEntry {
  name: string           // Identificador único
  description: string    // Descripción breve
  argumentHint?: string  // Hint para argumentos
  tags: string[]         // Tags para búsqueda
  source: 'local' | 'user' | 'cached' | 'embedded'
  version?: string       // Versión del skill
}

interface SkillIndex {
  skills: SkillIndexEntry[]
  generatedAt: string    // Timestamp de generación
}
```

**Proceso de generación:**

```
1. Scan LOCAL (.opencode/skill/*/SKILL.md)
   └─► Parse frontmatter de cada archivo
   └─► Agregar al índice con source='local'

2. Scan USER (~/.config/opencode/skill/*/SKILL.md)
   └─► Skip si name ya existe en índice
   └─► Parse frontmatter
   └─► Agregar con source='user'

3. Scan CACHED (~/.aifwk/cache/skills/*/SKILL.md)
   └─► Skip si name ya existe
   └─► Parse frontmatter
   └─► Agregar con source='cached'

4. Scan EMBEDDED (skills compilados)
   └─► Skip si name ya existe
   └─► Agregar con source='embedded'

5. Generar SkillIndex final
```

### Context Injection

El Skill Index se inyecta en el contexto del LLM en cada conversación:

```
┌─────────────────────────────────────────────────────────────────┐
│                    CONTEXTO DEL LLM                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  [STATIC SYSTEM PROMPT]                                          │
│  - Reglas de aiFRAMEWORK                                         │
│  - Descripción de tools disponibles                              │
│  - Principios de operación                                       │
│                                                                  │
│  [DYNAMIC SKILL INDEX]           ◄── Generado en runtime         │
│  ## Available Skills                                             │
│                                                                  │
│  | Skill | Description | Invocation |                            │
│  |-------|-------------|------------|                            │
│  | create-devtask | Create devTASKs... | /create-devtask |       │
│  | sync-dipolework | Sync with dipole.work | /sync-dipolework |  │
│                                                                  │
│  [SKILL CONTENT]                 ◄── Solo cuando se invoca       │
│  (Cargado dinámicamente al invocar /skill-name)                  │
│                                                                  │
│  [USER MESSAGE]                                                  │
│  ...                                                             │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Formato Estándar de Skills

### Estructura del Archivo SKILL.md

```markdown
---
# REQUIRED
name: string                    # Identificador único (kebab-case)
description: string             # Descripción breve (< 100 chars)

# RECOMMENDED
version: string                 # Versión semántica (ej: "1.2.0")
argument-hint: string           # Hint para el usuario

# OPTIONAL
tools:                          # Tools que usa este skill
  - afwk_create_devtask
  - afwk_get_steering_context

templates:                      # Templates que referencia
  - overview.md

min_dipolecode: string          # Versión mínima requerida (ej: "0.5.0")

tags:                           # Tags para búsqueda/categorización
  - task-management
  - interactive

author: string                  # Autor o equipo
---

# Título del Workflow

Descripción general del workflow y cuándo usarlo.

## Core Principles

Principios que guían la ejecución del workflow.

---

## Phase 1: [Nombre de la Fase]

**Goal**: Objetivo de esta fase

**Actions**:
1. Acción específica
2. Llamar tool: `afwk_tool_name`
3. Preguntar al usuario sobre X

---

## Phase 2: [Nombre de la Fase]

...

---

## Special Cases

### Caso especial 1
Instrucciones para manejar este caso.

### Caso especial 2
...

---

## Example Flow

```
User: "mensaje del usuario"
LLM: [acciones y respuestas esperadas]
```
```

### Reglas de Validación

| Campo | Regla | Error si no cumple |
|-------|-------|-------------------|
| `name` | Requerido, kebab-case, único | Skill no carga |
| `description` | Requerido, < 100 chars | Warning en index |
| `version` | Semver válido si presente | Warning |
| `tools` | Deben existir en dipoleCODE | Warning al cargar |
| `min_dipolecode` | Semver válido si presente | Warning si incompatible |

### Buenas Prácticas

**DO:**
- Usar fases claras con objetivos definidos
- Especificar cuándo llamar cada tool
- Incluir ejemplo de conversación
- Documentar casos especiales

**DON'T:**
- Dejar instrucciones ambiguas
- Asumir contexto no provisto
- Referenciar tools que no existen
- Usar placeholders en contenido generado (`<!-- FILL: -->`)

---

## Sincronización con Repo Central

### Comando de Sincronización

```bash
# Sincronizar todos los skills del repo central
dipolecode workflow sync

# Sincronizar skill específico
dipolecode workflow sync create-devtask

# Ver skills disponibles
dipolecode workflow list

# Ver información de un skill
dipolecode workflow info create-devtask

# Ver skills desactualizados
dipolecode workflow outdated
```

### Proceso de Sync

```
┌─────────────────────────────────────────────────────────────────┐
│                    dipolecode workflow sync                      │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
                ┌─────────────────────────┐
                │ 1. Read config.yaml     │
                │    Get source URLs      │
                └────────────┬────────────┘
                             │
                             ▼
                ┌─────────────────────────┐
                │ 2. Fetch index.json     │
                │    from each source     │
                └────────────┬────────────┘
                             │
                             ▼
                ┌─────────────────────────┐
                │ 3. Compare with local   │
                │    cache versions       │
                └────────────┬────────────┘
                             │
              ┌──────────────┴──────────────┐
              │                             │
              ▼                             ▼
    ┌─────────────────┐           ┌─────────────────┐
    │ New skills      │           │ Updated skills  │
    │ Download full   │           │ Download if     │
    │ SKILL.md        │           │ version changed │
    └────────┬────────┘           └────────┬────────┘
             │                             │
             └──────────────┬──────────────┘
                            │
                            ▼
                ┌─────────────────────────┐
                │ 4. Validate downloaded  │
                │    skills (frontmatter) │
                └────────────┬────────────┘
                             │
                             ▼
                ┌─────────────────────────┐
                │ 5. Check compatibility  │
                │    with local tools     │
                └────────────┬────────────┘
                             │
                  ┌──────────┴──────────┐
                  │                     │
                  ▼                     ▼
        ┌─────────────────┐   ┌─────────────────┐
        │ Compatible      │   │ Incompatible    │
        │ Save to cache   │   │ Show warning    │
        │                 │   │ Save anyway     │
        └─────────────────┘   └─────────────────┘
                  │                     │
                  └──────────┬──────────┘
                             │
                             ▼
                ┌─────────────────────────┐
                │ 6. Update sync.lock     │
                │    Regenerate index     │
                └─────────────────────────┘
                             │
                             ▼
                ┌─────────────────────────┐
                │ 7. Report results       │
                │    ✓ 2 new skills       │
                │    ✓ 1 updated          │
                │    ⚠ 1 incompatible     │
                └─────────────────────────┘
```

### Archivo de Configuración

```yaml
# ~/.aifwk/config.yaml

sources:
  - name: official
    url: https://github.com/aifwk/workflow-catalog
    branch: main
    enabled: true

  - name: company-internal
    url: https://github.com/mycompany/aifwk-skills
    branch: main
    enabled: true
    auth: github-token  # Referencia a credential store

settings:
  auto_sync: false          # Sync automático al iniciar
  sync_interval: 24h        # Intervalo de sync automático
  offline_mode: false       # Usar solo cache/embedded
  verify_signatures: false  # Verificar firmas de skills (futuro)
```

### Archivo sync.lock

```yaml
# ~/.aifwk/sync.lock

last_sync: "2025-01-23T10:30:00Z"

sources:
  official:
    commit: "abc123def456"
    synced_at: "2025-01-23T10:30:00Z"

  company-internal:
    commit: "789xyz012"
    synced_at: "2025-01-23T10:30:00Z"

skills:
  create-devtask:
    version: "1.2.0"
    source: official
    hash: "sha256:..."

  sync-dipolework:
    version: "1.0.0"
    source: official
    hash: "sha256:..."
```

---

## Flujos de Datos

### Flujo Completo: Invocación de Skill

```
┌──────────────────────────────────────────────────────────────────────────┐
│                         FLUJO DE INVOCACIÓN                               │
└──────────────────────────────────────────────────────────────────────────┘

 USER                    dipoleCODE                   LLM                TOOL
  │                          │                         │                   │
  │  "Quiero crear un       │                         │                   │
  │   devTASK para auth"    │                         │                   │
  ├─────────────────────────►                         │                   │
  │                          │                         │                   │
  │                          │  Context includes:      │                   │
  │                          │  - System Prompt        │                   │
  │                          │  - Skill Index          │                   │
  │                          ├────────────────────────►│                   │
  │                          │                         │                   │
  │                          │  "Puedo ayudarte.       │                   │
  │                          │   Uso /create-devtask"  │                   │
  │◄─────────────────────────┼─────────────────────────┤                   │
  │                          │                         │                   │
  │  "/create-devtask"       │                         │                   │
  ├─────────────────────────►│                         │                   │
  │                          │                         │                   │
  │                    ┌─────┴─────┐                   │                   │
  │                    │  RESOLVE  │                   │                   │
  │                    │  SKILL    │                   │                   │
  │                    └─────┬─────┘                   │                   │
  │                          │                         │                   │
  │                    Load SKILL.md                   │                   │
  │                    from first source               │                   │
  │                          │                         │                   │
  │                          │  Context now includes:  │                   │
  │                          │  + Full SKILL.md        │                   │
  │                          ├────────────────────────►│                   │
  │                          │                         │                   │
  │                          │         [Phase 1: Ask questions]            │
  │◄─────────────────────────┼─────────────────────────┤                   │
  │                          │                         │                   │
  │  "OAuth2 con Google"     │                         │                   │
  ├─────────────────────────►├────────────────────────►│                   │
  │                          │                         │                   │
  │                          │         [Phase 2: Call tools]               │
  │                          │                         │                   │
  │                          │                         │  afwk_get_steering│
  │                          │                         ├──────────────────►│
  │                          │                         │◄──────────────────┤
  │                          │                         │                   │
  │                          │         [Phase 3: Propose scope]            │
  │◄─────────────────────────┼─────────────────────────┤                   │
  │                          │                         │                   │
  │  "Aprobado"              │                         │                   │
  ├─────────────────────────►├────────────────────────►│                   │
  │                          │                         │                   │
  │                          │         [Phase 4: Generate & Create]        │
  │                          │                         │                   │
  │                          │                         │  afwk_create_     │
  │                          │                         │  devtask(content) │
  │                          │                         ├──────────────────►│
  │                          │                         │                   │
  │                          │                         │   Create files    │
  │                          │                         │   Emit FileOpen   │
  │                          │                         │◄──────────────────┤
  │                          │                         │                   │
  │                          │◄────────────────────────┤                   │
  │                          │                         │                   │
  │  [File opens in editor]  │                         │                   │
  │◄─────────────────────────┤                         │                   │
  │                          │                         │                   │
```

### Flujo de Sincronización

```
┌──────────────────────────────────────────────────────────────────────────┐
│                         FLUJO DE SYNC                                     │
└──────────────────────────────────────────────────────────────────────────┘

 USER                    dipoleCODE                 REPO CENTRAL
  │                          │                          │
  │  dipolecode workflow     │                          │
  │  sync                    │                          │
  ├─────────────────────────►│                          │
  │                          │                          │
  │                          │  GET index.json          │
  │                          ├─────────────────────────►│
  │                          │◄─────────────────────────┤
  │                          │                          │
  │                    ┌─────┴─────┐                    │
  │                    │  COMPARE  │                    │
  │                    │  VERSIONS │                    │
  │                    └─────┬─────┘                    │
  │                          │                          │
  │                          │  GET skills/new-skill/   │
  │                          │  SKILL.md                │
  │                          ├─────────────────────────►│
  │                          │◄─────────────────────────┤
  │                          │                          │
  │                    ┌─────┴─────┐                    │
  │                    │ VALIDATE  │                    │
  │                    │ & SAVE    │                    │
  │                    └─────┬─────┘                    │
  │                          │                          │
  │  ✓ Synced 3 skills       │                          │
  │◄─────────────────────────┤                          │
  │                          │                          │
```

---

## Ejemplos de Implementación

### Ejemplo 1: Crear Nuevo Skill

**Escenario**: Agregar skill `sync-dipolework` que sincroniza con dipole.work

**Paso 1: Crear archivo en repo central**

```markdown
# workflow-catalog/skills/sync-dipolework/SKILL.md

---
name: sync-dipolework
version: 1.0.0
description: Sync work done in dipole.work with local aiFRAMEWORK project
argument-hint: project URL (optional)

tools:
  - afwk_get_kanban_status
  - afwk_create_devtask
  - afwk_move_kanban_task

tags:
  - sync
  - dipole.work
  - collaboration

author: aiFRAMEWORK Team
---

# Sync dipole.work Workflow

Synchronize tasks from a dipole.work project to your local aiFRAMEWORK kanban.

## Core Principles

- **Non-destructive**: Never delete local tasks
- **Additive**: Only add new tasks from remote
- **Status-aware**: Match task statuses between systems

---

## Phase 1: Connect

**Goal**: Establish connection to dipole.work project

**Actions**:
1. If `$ARGUMENTS` contains a URL, use it
2. Otherwise, check for saved project URL in `.afwk/config.yaml`
3. If no URL available, ask user for the dipole.work project URL
4. Validate URL format: `https://dipole.work/p/{project-id}`

---

## Phase 2: Fetch & Compare

**Goal**: Get remote state and compare with local

**Actions**:
1. Call dipole.work API to fetch tasks (implementation note: use WebFetch)
2. Call `afwk_get_kanban_status` to get local state
3. Compare and identify:
   - Tasks in remote but not in local (to create)
   - Tasks with different status (to update)
4. Present comparison to user:
   ```
   ## Sync Preview

   **New tasks to create**: 3
   - "Setup CI/CD" (todo)
   - "Auth module" (in_progress)
   - "API endpoints" (backlog)

   **Status changes**: 1
   - "Database setup": local=todo, remote=done

   Proceed with sync?
   ```

---

## Phase 3: Sync

**Goal**: Create/update local tasks

**Actions**:
1. For each new task:
   - Call `afwk_create_devtask` with content from remote
   - Call `afwk_move_kanban_task` to set correct status
2. For status changes:
   - Call `afwk_move_kanban_task` to update status

---

## Phase 4: Report

**Goal**: Summarize sync results

**Actions**:
1. Present summary:
   ```
   ✅ Sync completed

   - 3 tasks created
   - 1 status updated
   - 0 errors

   Your local kanban is now in sync with dipole.work.
   ```

---

## Special Cases

### Conflict Detection
If a task exists locally with different content:
- Show diff to user
- Ask whether to keep local or override with remote
- Default: keep local (non-destructive)

### Offline Mode
If dipole.work is unreachable:
- Inform user of connection issue
- Suggest checking network or URL
- Do not modify local state
```

**Paso 2: Actualizar index.json**

```json
{
  "version": "1.0.0",
  "lastUpdated": "2025-01-23T12:00:00Z",
  "skills": [
    {
      "name": "create-devtask",
      "version": "1.2.0",
      "description": "Interactive workflow for creating devTASKs",
      "path": "skills/create-devtask"
    },
    {
      "name": "sync-dipolework",
      "version": "1.0.0",
      "description": "Sync work done in dipole.work with local project",
      "path": "skills/sync-dipolework"
    }
  ]
}
```

**Paso 3: Usuario sincroniza**

```bash
$ dipolecode workflow sync
Fetching from github.com/aifwk/workflow-catalog...
✓ Found 1 new skill: sync-dipolework
✓ Skill index updated

$ dipolecode workflow list
Available skills:
  create-devtask     Interactive workflow for creating devTASKs    [embedded]
  create-aitask      Create aiTASK blueprints                      [embedded]
  complete-aitask    Document completion notes                     [embedded]
  sync-dipolework    Sync with dipole.work                         [cached]    NEW
```

### Ejemplo 2: Override Local de Skill

**Escenario**: Proyecto necesita workflow customizado de create-devtask

```markdown
# mi-proyecto/.opencode/skill/create-devtask/SKILL.md

---
name: create-devtask
version: 1.2.0-custom
description: Custom devTASK creation for this project
---

# devTASK Creation (Custom)

Este proyecto tiene requisitos especiales para devTASKs.

## Phase 1: Context

[Igual que el original]

## Phase 2: Compliance Check    ◄── FASE CUSTOM AGREGADA

**Goal**: Verificar compliance con políticas internas

**Actions**:
1. Ask user for JIRA ticket number
2. Validate ticket exists (implementation: WebFetch to JIRA API)
3. Include ticket reference in devTASK metadata

## Phase 3: Exploration

[Resto igual...]
```

**Resultado**: Este proyecto usa el skill customizado, otros proyectos usan el default.

### Ejemplo 3: Agregar Nuevo Tool

**Escenario**: dipoleCODE v0.6.0 agrega `afwk_archive_devtask`

**Paso 1: Implementar tool en TypeScript**

```typescript
// packages/opencode/src/afwk/tools.ts

export const AfwkArchiveDevTaskTool = Tool.define(
  "afwk_archive_devtask",
  {
    description: "Archive a completed devTASK",
    parameters: z.object({
      devTaskId: z.string(),
      reason: z.string().optional()
    }),
    async execute(params) {
      // Move to .afwk/archive/
      // Update metadata
      // Return result
    }
  }
)
```

**Paso 2: Crear skill que use el nuevo tool**

```markdown
# workflow-catalog/skills/archive-completed/SKILL.md

---
name: archive-completed
version: 1.0.0
description: Archive old completed devTASKs
min_dipolecode: "0.6.0"    ◄── Requiere versión con el tool

tools:
  - afwk_get_kanban_status
  - afwk_archive_devtask   ◄── Nuevo tool
---

# Archive Completed Tasks

...
```

**Paso 3: Comportamiento en versiones anteriores**

```bash
# Usuario con dipoleCODE v0.5.0
$ dipolecode workflow sync
⚠ Warning: skill 'archive-completed' requires dipoleCODE >= 0.6.0
  You have v0.5.0. Skill may not work correctly.

Synced anyway? [y/N]
```

Si el usuario procede y ejecuta el skill, el LLM verá el warning y puede informar al usuario que necesita actualizar.

---

## Consideraciones de Compatibilidad

### Matriz de Compatibilidad

| Escenario | Comportamiento |
|-----------|----------------|
| Skill usa tool que existe | ✅ Funciona normalmente |
| Skill usa tool que no existe | ⚠️ Warning al cargar, LLM ve warning |
| Skill requiere versión mayor de dipoleCODE | ⚠️ Warning al sync |
| Template referenciado no existe | ⚠️ Warning, LLM usa estructura genérica |
| Skill con frontmatter inválido | ❌ No carga, error reportado |

### Validación Soft vs Hard

La validación es **soft** (warnings, no errores bloqueantes) porque:

1. **Skills son instrucciones para LLM, no código ejecutable**
   - El LLM puede adaptarse si un tool no está disponible
   - Puede informar al usuario del problema

2. **Permite forward compatibility**
   - Skills pueden prepararse para tools futuros
   - Usuarios pueden probar skills experimentales

3. **Simplifica contribuciones**
   - No hay "build failures" al agregar skills
   - Feedback inmediato al usuario

### Estrategia de Degradación

```
┌────────────────────────────────────────────────────────────────┐
│                  DEGRADACIÓN GRACEFUL                          │
└────────────────────────────────────────────────────────────────┘

Skill invocado
      │
      ▼
┌─────────────────┐
│ Validar tools   │
│ requeridos      │
└────────┬────────┘
         │
    ┌────┴────┐
    │         │
    ▼         ▼
  [OK]    [MISSING]
    │         │
    │         ▼
    │    ┌─────────────────┐
    │    │ Agregar warning │
    │    │ al contexto LLM │
    │    └────────┬────────┘
    │             │
    └──────┬──────┘
           │
           ▼
┌─────────────────────────────────────────────────────────────┐
│ LLM recibe contexto:                                         │
│                                                              │
│ ## Skill: archive-completed                                  │
│                                                              │
│ ⚠️ WARNING: This skill references tool 'afwk_archive_devtask'│
│ which is not available in your version of dipoleCODE.        │
│ The skill may not complete successfully.                     │
│                                                              │
│ [Instrucciones del skill...]                                 │
└─────────────────────────────────────────────────────────────┘
           │
           ▼
LLM puede:
- Informar al usuario del problema
- Sugerir actualizar dipoleCODE
- Intentar alternativa si existe
- Completar parcialmente el workflow
```

---

## Guía de Contribución

### Agregar Nuevo Skill

1. **Fork** el repo `aifwk/workflow-catalog`
2. **Crear** directorio `skills/{nombre-del-skill}/`
3. **Escribir** `SKILL.md` siguiendo el formato estándar
4. **Documentar** en `README.md` del skill
5. **Actualizar** `index.json`
6. **Probar** localmente:
   ```bash
   # Copiar a proyecto local
   cp -r skills/mi-skill ~/.aifwk/cache/skills/

   # Probar
   dipolecode
   > /mi-skill
   ```
7. **PR** al repo central

### Modificar Skill Existente

1. **Incrementar** versión en frontmatter
2. **Documentar** cambios en skill o CHANGELOG
3. **Mantener** backward compatibility si es posible
4. **PR** con descripción de cambios

### Checklist de Revisión

- [ ] Frontmatter completo y válido
- [ ] Descripción clara y concisa
- [ ] Fases bien definidas con objetivos
- [ ] Tools referenciados existen (o warning documentado)
- [ ] Ejemplo de conversación incluido
- [ ] Casos especiales documentados
- [ ] Sin placeholders `<!-- FILL: -->` en contenido generado

---

## Implementación por Fases

### Phase 1: MVP (Actual)

```
✅ Embedded skills en binario
✅ Override local en .opencode/skill/
❌ Sync con repo central (manual copy)
❌ Skill index dinámico
```

### Phase 2: Discovery (Próximo)

```
✅ Skill index generado en runtime
✅ Index inyectado en contexto LLM
✅ Múltiples fuentes (local/user/embedded)
❌ Sync automático
```

### Phase 3: Sync (Siguiente)

```
✅ Comando dipolecode workflow sync
✅ Cache en ~/.aifwk/
✅ config.yaml para sources
✅ sync.lock para estado
```

### Phase 4: Advanced (Futuro)

```
□ Auto-sync al iniciar
□ Background sync
□ Múltiples repos (oficial + interno)
□ Firma de skills (seguridad)
□ UI para gestión de skills
```

---

## Referencias

- [aiFRAMEWORK Tools Documentation](./tools.md)
- [Skill Format Specification](./skill-format.md)
- [dipoleCODE CLI Reference](./cli.md)
