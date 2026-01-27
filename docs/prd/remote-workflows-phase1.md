# PRD: Remote Workflows - Phase 1 (Skill Discovery)

> Product Requirements Document para la implementación de Skill Discovery dinámico

**Version**: 1.0.0
**Status**: Draft
**Fecha**: 2025-01-23
**Owner**: aiFRAMEWORK Team

---

## Tabla de Contenidos

1. [Resumen Ejecutivo](#resumen-ejecutivo)
2. [Problema](#problema)
3. [Solución Propuesta](#solución-propuesta)
4. [Alcance de Phase 1](#alcance-de-phase-1)
5. [Requisitos Funcionales](#requisitos-funcionales)
6. [Requisitos No Funcionales](#requisitos-no-funcionales)
7. [Diseño Técnico](#diseño-técnico)
8. [Casos de Uso](#casos-de-uso)
9. [Criterios de Aceptación](#criterios-de-aceptación)
10. [Fuera de Alcance](#fuera-de-alcance)
11. [Dependencias](#dependencias)
12. [Riesgos y Mitigaciones](#riesgos-y-mitigaciones)
13. [Plan de Implementación](#plan-de-implementación)
14. [Métricas de Éxito](#métricas-de-éxito)

---

## Resumen Ejecutivo

### Objetivo

Implementar un sistema de **Skill Discovery** que permita a dipoleCODE descubrir y cargar skills desde múltiples fuentes (local, usuario, embebido) y exponer un índice dinámico al LLM para que pueda sugerir y ejecutar workflows disponibles.

### Entregables Clave

1. **Skill Index Generator** - Escanea fuentes y genera índice de skills disponibles
2. **Context Injection** - Inyecta índice dinámico en el contexto del LLM
3. **Multi-Source Resolver** - Resuelve skills con orden de prioridad definido
4. **Skill Validation** - Valida frontmatter y compatibilidad de tools

### Impacto Esperado

- LLM puede descubrir y sugerir skills sin hardcoding en system prompt
- Nuevos skills disponibles sin modificar código compilado
- Usuarios pueden agregar skills custom por proyecto o globalmente
- Base para Phase 2 (sync con repo central)

---

## Problema

### Situación Actual

```
┌─────────────────────────────────────────────────────────────────┐
│                      ESTADO ACTUAL                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  System Prompt (compilado en binario)                            │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  ## aiFRAMEWORK Context                                     │ │
│  │                                                             │ │
│  │  ## devTASK Creation — MANDATORY Workflow                   │ │
│  │  Use create-devtask skill when...                           │ │
│  │                                                             │ │
│  │  ## aiTASK Creation — Recommended Workflow                  │ │
│  │  Use create-aitask skill when...                            │ │
│  │                                                             │ │
│  │  ❌ Lista de skills HARDCODEADA                             │ │
│  │  ❌ Agregar skill = modificar código + rebuild              │ │
│  │  ❌ No hay discovery de skills externos                     │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  Embedded Skills (en binario)                                    │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  EMBEDDED_SKILL_PATHS = {                                   │ │
│  │    "create-devtask": ...,                                   │ │
│  │    "create-aitask": ...,                                    │ │
│  │    "complete-aitask": ...                                   │ │
│  │  }                                                          │ │
│  │                                                             │ │
│  │  ❌ Skills fijos en tiempo de compilación                   │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Problemas Específicos

| # | Problema | Impacto |
|---|----------|---------|
| P1 | Skills hardcodeados en system prompt | Agregar skill requiere cambio de código |
| P2 | No hay discovery de skills externos | Usuarios no pueden agregar skills custom |
| P3 | LLM no sabe qué skills existen | No puede sugerir skills apropiados |
| P4 | Sin prioridad de fuentes | No hay override por proyecto |
| P5 | Sin validación de skills | Skills malformados causan errores |

### User Stories Afectadas

- *"Como usuario, quiero agregar un skill custom a mi proyecto sin modificar dipoleCODE"*
- *"Como usuario, quiero que el LLM me sugiera skills relevantes basado en mi pregunta"*
- *"Como desarrollador, quiero que mi skill custom tenga prioridad sobre el default"*

---

## Solución Propuesta

### Arquitectura de Alto Nivel

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         ARQUITECTURA PHASE 1                                 │
└─────────────────────────────────────────────────────────────────────────────┘

                         STARTUP DE dipoleCODE
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         SKILL DISCOVERY                                      │
│                                                                              │
│   ┌─────────────┐   ┌─────────────┐   ┌─────────────┐   ┌─────────────┐    │
│   │ 1. LOCAL    │   │ 2. USER     │   │ 3. CACHED   │   │ 4. EMBEDDED │    │
│   │ .opencode/  │──►│ ~/.config/  │──►│ ~/.aifwk/   │──►│ (binary)    │    │
│   │ skill/      │   │ opencode/   │   │ cache/      │   │             │    │
│   └─────────────┘   └─────────────┘   └─────────────┘   └─────────────┘    │
│          │                 │                 │                 │            │
│          └─────────────────┴─────────────────┴─────────────────┘            │
│                                    │                                         │
│                                    ▼                                         │
│                         ┌─────────────────────┐                             │
│                         │   SKILL INDEX       │                             │
│                         │   GENERATOR         │                             │
│                         └──────────┬──────────┘                             │
│                                    │                                         │
│                                    ▼                                         │
│                         ┌─────────────────────┐                             │
│                         │   SkillIndex        │                             │
│                         │   {                 │                             │
│                         │     skills: [...],  │                             │
│                         │     generatedAt     │                             │
│                         │   }                 │                             │
│                         └─────────────────────┘                             │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ inject
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         LLM CONTEXT                                          │
│                                                                              │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │  [Static System Prompt]                                              │   │
│   │  - Reglas de aiFRAMEWORK                                             │   │
│   │  - Tools disponibles                                                 │   │
│   │                                                                      │   │
│   │  [Dynamic Skill Index]  ◄── NUEVO                                    │   │
│   │  ## Available Skills                                                 │   │
│   │  | Skill | Description | Invoke |                                    │   │
│   │  | create-devtask | Create devTASKs... | /create-devtask |           │   │
│   │  | my-custom-skill | Custom workflow... | /my-custom-skill |         │   │
│   │                                                                      │   │
│   │  [Skill Content]  (cuando se invoca)                                 │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Componentes Nuevos

| Componente | Responsabilidad | Ubicación |
|------------|-----------------|-----------|
| `SkillDiscovery` | Escanear fuentes, parsear frontmatter | `src/skill/discovery.ts` |
| `SkillIndex` | Almacenar índice en memoria | `src/skill/index.ts` |
| `SkillResolver` | Resolver skill por nombre con prioridad | `src/skill/resolver.ts` |
| `SkillValidator` | Validar frontmatter y tools | `src/skill/validator.ts` |
| `ContextBuilder` | Inyectar índice en contexto LLM | `src/session/context.ts` |

---

## Alcance de Phase 1

### En Alcance

| ID | Feature | Descripción |
|----|---------|-------------|
| F1 | Skill Index Generator | Generar índice de skills al iniciar |
| F2 | Multi-Source Discovery | Escanear LOCAL → USER → CACHED → EMBEDDED |
| F3 | Priority Resolution | Primera coincidencia gana |
| F4 | Context Injection | Inyectar tabla de skills en contexto LLM |
| F5 | Frontmatter Validation | Validar campos requeridos |
| F6 | Tool Compatibility Check | Warning si skill usa tools inexistentes |
| F7 | Skill Loading | Cargar contenido completo al invocar |

### Fuera de Alcance (Phase 2+)

| ID | Feature | Phase |
|----|---------|-------|
| X1 | Sync con repo central | Phase 2 |
| X2 | Comando `dipolecode workflow sync` | Phase 2 |
| X3 | Cache management | Phase 2 |
| X4 | config.yaml para sources | Phase 2 |
| X5 | Auto-sync al iniciar | Phase 3 |
| X6 | Background sync | Phase 3 |
| X7 | Firma de skills | Phase 4 |

---

## Requisitos Funcionales

### RF1: Skill Discovery

**Descripción**: El sistema debe descubrir skills de múltiples fuentes al iniciar.

**Criterios**:
- RF1.1: Escanear `.opencode/skill/*/SKILL.md` en directorio de proyecto
- RF1.2: Escanear `~/.config/opencode/skill/*/SKILL.md` para skills de usuario
- RF1.3: Escanear `~/.aifwk/cache/skills/*/SKILL.md` para skills cacheados
- RF1.4: Incluir skills embebidos en el binario
- RF1.5: Orden de prioridad: LOCAL > USER > CACHED > EMBEDDED

**Input**: Ninguno (automático al iniciar)

**Output**: Lista de skills descubiertos con metadata

---

### RF2: Skill Index Generation

**Descripción**: Generar índice estructurado de skills disponibles.

**Criterios**:
- RF2.1: Parsear frontmatter YAML de cada SKILL.md
- RF2.2: Extraer: name, description, argument-hint, tags, version, tools
- RF2.3: Registrar source de cada skill (local/user/cached/embedded)
- RF2.4: Generar timestamp de generación
- RF2.5: Almacenar en memoria para consulta rápida

**Estructura del Index**:
```typescript
interface SkillIndexEntry {
  name: string           // Requerido
  description: string    // Requerido
  argumentHint?: string  // Opcional
  tags: string[]         // Opcional, default []
  version?: string       // Opcional
  tools: string[]        // Opcional, extraído del frontmatter
  source: 'local' | 'user' | 'cached' | 'embedded'
  path: string           // Path al SKILL.md
}

interface SkillIndex {
  skills: SkillIndexEntry[]
  generatedAt: string
}
```

---

### RF3: Priority Resolution

**Descripción**: Resolver conflictos de nombre con orden de prioridad.

**Criterios**:
- RF3.1: Si skill existe en LOCAL, ignorar otras fuentes
- RF3.2: Si skill existe en USER (y no LOCAL), ignorar CACHED/EMBEDDED
- RF3.3: Si skill existe en CACHED (y no LOCAL/USER), ignorar EMBEDDED
- RF3.4: EMBEDDED es fallback final
- RF3.5: Log de debug indicando qué fuente se usó

**Ejemplo**:
```
Skill "create-devtask" found in:
  - LOCAL: .opencode/skill/create-devtask/SKILL.md  ◄── WINS
  - EMBEDDED: (compiled)

Using LOCAL version.
```

---

### RF4: Context Injection

**Descripción**: Inyectar índice de skills en el contexto del LLM.

**Criterios**:
- RF4.1: Generar sección markdown con tabla de skills
- RF4.2: Incluir: nombre, descripción, comando de invocación
- RF4.3: Inyectar después del system prompt estático
- RF4.4: Formato legible para el LLM

**Formato de Inyección**:
```markdown
## Available Skills

The following skills are available. Suggest them when the user's request matches their purpose.
To invoke a skill, the user types `/skill-name` or you can suggest it.

| Skill | Description | Invocation |
|-------|-------------|------------|
| create-devtask | Interactive workflow for creating devTASKs | `/create-devtask [description]` |
| create-aitask | Create aiTASK blueprints within devTASK | `/create-aitask [devTaskId]` |
| complete-aitask | Document completion notes for aiTASK | `/complete-aitask [aiTaskId]` |

When a skill is invoked, you will receive detailed instructions on how to execute it.
```

---

### RF5: Frontmatter Validation

**Descripción**: Validar estructura del frontmatter de skills.

**Criterios**:
- RF5.1: Validar campo `name` (requerido, string, kebab-case)
- RF5.2: Validar campo `description` (requerido, string, max 200 chars)
- RF5.3: Validar `version` si presente (semver válido)
- RF5.4: Validar `tools` si presente (array de strings)
- RF5.5: Skill con frontmatter inválido: log error, no incluir en index

**Schema de Validación**:
```typescript
const SkillFrontmatterSchema = z.object({
  name: z.string()
    .min(1)
    .regex(/^[a-z][a-z0-9-]*$/, "Must be kebab-case"),

  description: z.string()
    .min(10)
    .max(200),

  version: z.string()
    .regex(/^\d+\.\d+\.\d+(-[\w.]+)?$/)
    .optional(),

  "argument-hint": z.string().optional(),

  tools: z.array(z.string()).optional(),

  templates: z.array(z.string()).optional(),

  tags: z.array(z.string()).optional(),

  "min_dipolecode": z.string().optional(),

  author: z.string().optional(),
})
```

---

### RF6: Tool Compatibility Check

**Descripción**: Verificar que tools referenciados en skill existan.

**Criterios**:
- RF6.1: Extraer lista de tools del frontmatter
- RF6.2: Comparar contra tools disponibles en dipoleCODE
- RF6.3: Si tool no existe: agregar warning al SkillIndexEntry
- RF6.4: Warning visible al cargar skill, no bloquea

**Estructura con Warnings**:
```typescript
interface SkillIndexEntry {
  // ... campos existentes
  warnings: string[]  // Ej: ["Tool 'afwk_archive' not available"]
}
```

---

### RF7: Skill Loading

**Descripción**: Cargar contenido completo de skill al invocar.

**Criterios**:
- RF7.1: Usuario invoca `/skill-name` o LLM sugiere
- RF7.2: Resolver path usando SkillIndex
- RF7.3: Leer contenido completo de SKILL.md
- RF7.4: Inyectar contenido en contexto del LLM
- RF7.5: Si hay warnings, incluir en contexto

**Formato al Cargar**:
```markdown
<skill name="create-devtask" source="local">

⚠️ Warnings:
- Tool 'afwk_experimental' referenced but not available

---

[Contenido completo del SKILL.md]

</skill>
```

---

## Requisitos No Funcionales

### RNF1: Performance

| Métrica | Requisito |
|---------|-----------|
| Tiempo de discovery | < 100ms para 50 skills |
| Tiempo de index generation | < 50ms |
| Memoria del index | < 1MB para 100 skills |
| Tiempo de skill loading | < 10ms |

### RNF2: Reliability

| Métrica | Requisito |
|---------|-----------|
| Skill inválido | No crashea, log error, continúa |
| Directorio no existe | Skip silencioso |
| Frontmatter malformado | Skip skill, log warning |
| Uptime | 100% (no hay servicios externos) |

### RNF3: Usability

| Métrica | Requisito |
|---------|-----------|
| Documentación | README en cada skill |
| Error messages | Claros, accionables |
| Debug logging | Disponible con flag |

### RNF4: Maintainability

| Métrica | Requisito |
|---------|-----------|
| Test coverage | > 80% para módulos nuevos |
| Código documentado | JSDoc en funciones públicas |
| Separación de concerns | Un módulo por responsabilidad |

---

## Diseño Técnico

### Estructura de Archivos

```
packages/opencode/src/
├── skill/
│   ├── index.ts           # Exports públicos
│   ├── discovery.ts       # SkillDiscovery class
│   ├── resolver.ts        # SkillResolver class
│   ├── validator.ts       # Validación de frontmatter
│   ├── types.ts           # Interfaces y tipos
│   ├── embedded.ts        # Skills embebidos (existente)
│   └── constants.ts       # Paths, prioridades
│
├── session/
│   └── context.ts         # Modificar para inyectar skill index
│
└── afwk/
    └── system-prompt.ts   # Remover hardcoding de skills
```

### Interfaces Principales

```typescript
// skill/types.ts

export interface SkillFrontmatter {
  name: string
  description: string
  version?: string
  "argument-hint"?: string
  tools?: string[]
  templates?: string[]
  tags?: string[]
  "min_dipolecode"?: string
  author?: string
}

export interface SkillIndexEntry {
  name: string
  description: string
  argumentHint?: string
  tags: string[]
  version?: string
  tools: string[]
  source: SkillSource
  path: string
  warnings: string[]
}

export type SkillSource = 'local' | 'user' | 'cached' | 'embedded'

export interface SkillIndex {
  skills: SkillIndexEntry[]
  generatedAt: string
}

export interface LoadedSkill {
  entry: SkillIndexEntry
  content: string
  frontmatter: SkillFrontmatter
}

export interface SkillDiscoveryOptions {
  projectDir?: string
  userDir?: string
  cacheDir?: string
  includeEmbedded?: boolean
}
```

### Flujo de Discovery

```typescript
// skill/discovery.ts

export class SkillDiscovery {
  private options: SkillDiscoveryOptions

  constructor(options: SkillDiscoveryOptions = {}) {
    this.options = {
      projectDir: process.cwd(),
      userDir: path.join(os.homedir(), '.config', 'opencode'),
      cacheDir: path.join(os.homedir(), '.aifwk', 'cache'),
      includeEmbedded: true,
      ...options
    }
  }

  async discover(): Promise<SkillIndex> {
    const skills: SkillIndexEntry[] = []
    const seen = new Set<string>()

    // 1. LOCAL
    const localSkills = await this.scanDirectory(
      path.join(this.options.projectDir!, '.opencode', 'skill'),
      'local'
    )
    for (const skill of localSkills) {
      if (!seen.has(skill.name)) {
        skills.push(skill)
        seen.add(skill.name)
      }
    }

    // 2. USER
    const userSkills = await this.scanDirectory(
      path.join(this.options.userDir!, 'skill'),
      'user'
    )
    for (const skill of userSkills) {
      if (!seen.has(skill.name)) {
        skills.push(skill)
        seen.add(skill.name)
      }
    }

    // 3. CACHED
    const cachedSkills = await this.scanDirectory(
      path.join(this.options.cacheDir!, 'skills'),
      'cached'
    )
    for (const skill of cachedSkills) {
      if (!seen.has(skill.name)) {
        skills.push(skill)
        seen.add(skill.name)
      }
    }

    // 4. EMBEDDED
    if (this.options.includeEmbedded) {
      const embeddedSkills = await this.loadEmbeddedSkills()
      for (const skill of embeddedSkills) {
        if (!seen.has(skill.name)) {
          skills.push(skill)
          seen.add(skill.name)
        }
      }
    }

    return {
      skills,
      generatedAt: new Date().toISOString()
    }
  }

  private async scanDirectory(
    dir: string,
    source: SkillSource
  ): Promise<SkillIndexEntry[]> {
    // Implementación...
  }

  private async loadEmbeddedSkills(): Promise<SkillIndexEntry[]> {
    // Usar embedded.ts existente
  }
}
```

### Context Injection

```typescript
// session/context.ts

export function buildSkillIndexSection(index: SkillIndex): string {
  if (index.skills.length === 0) {
    return ''
  }

  const rows = index.skills.map(skill => {
    const invoke = skill.argumentHint
      ? `\`/${skill.name} ${skill.argumentHint}\``
      : `\`/${skill.name}\``
    return `| ${skill.name} | ${skill.description} | ${invoke} |`
  })

  return `
## Available Skills

The following skills are available. Suggest them when the user's request matches their purpose.
To invoke a skill, the user types \`/skill-name\` or you can suggest it.

| Skill | Description | Invocation |
|-------|-------------|------------|
${rows.join('\n')}

When a skill is invoked, you will receive detailed instructions on how to execute it.
`.trim()
}

export function buildFullContext(
  staticPrompt: string,
  skillIndex: SkillIndex,
  loadedSkill?: LoadedSkill
): string {
  let context = staticPrompt

  // Agregar skill index
  const skillSection = buildSkillIndexSection(skillIndex)
  if (skillSection) {
    context += '\n\n' + skillSection
  }

  // Agregar skill cargado si existe
  if (loadedSkill) {
    context += '\n\n' + formatLoadedSkill(loadedSkill)
  }

  return context
}
```

---

## Casos de Uso

### CU1: Startup con Skills Locales

**Actor**: Sistema (dipoleCODE)

**Precondiciones**:
- Proyecto tiene `.opencode/skill/my-skill/SKILL.md`
- Skill embebido `create-devtask` existe

**Flujo**:
1. dipoleCODE inicia
2. SkillDiscovery escanea LOCAL, encuentra `my-skill`
3. SkillDiscovery escanea EMBEDDED, encuentra `create-devtask`
4. SkillIndex generado con ambos skills
5. `my-skill` tiene source='local', `create-devtask` tiene source='embedded'

**Resultado**: Index contiene 2 skills de diferentes fuentes

---

### CU2: Override de Skill Embebido

**Actor**: Usuario

**Precondiciones**:
- Skill embebido `create-devtask` existe
- Usuario crea `.opencode/skill/create-devtask/SKILL.md` custom

**Flujo**:
1. dipoleCODE inicia
2. SkillDiscovery encuentra `create-devtask` en LOCAL
3. SkillDiscovery encuentra `create-devtask` en EMBEDDED
4. LOCAL tiene prioridad, EMBEDDED ignorado
5. Index tiene `create-devtask` con source='local'

**Resultado**: Versión local del skill tiene prioridad

---

### CU3: LLM Sugiere Skill

**Actor**: Usuario, LLM

**Precondiciones**:
- SkillIndex inyectado en contexto
- Usuario pregunta "quiero crear una tarea"

**Flujo**:
1. Usuario: "Quiero crear una tarea para implementar auth"
2. LLM ve en contexto: `create-devtask | Interactive workflow for creating devTASKs`
3. LLM responde: "Puedo ayudarte. Tengo el skill `/create-devtask` para eso..."
4. Usuario: `/create-devtask`
5. Sistema carga SKILL.md completo
6. LLM ejecuta workflow

**Resultado**: LLM sugirió skill apropiado basado en índice

---

### CU4: Skill con Tool Inexistente

**Actor**: Sistema

**Precondiciones**:
- Skill define `tools: [afwk_future_tool]` en frontmatter
- `afwk_future_tool` no existe en dipoleCODE

**Flujo**:
1. SkillDiscovery parsea frontmatter
2. SkillValidator detecta tool no disponible
3. Warning agregado: "Tool 'afwk_future_tool' not available"
4. Skill incluido en index con warning
5. Al invocar, LLM ve warning en contexto

**Resultado**: Skill cargado con warning, no bloqueado

---

### CU5: Skill con Frontmatter Inválido

**Actor**: Sistema

**Precondiciones**:
- Archivo `.opencode/skill/bad-skill/SKILL.md` existe
- Frontmatter no tiene campo `name`

**Flujo**:
1. SkillDiscovery intenta parsear
2. SkillValidator detecta `name` faltante
3. Error loggeado: "Skill at path X: missing required field 'name'"
4. Skill NO incluido en index
5. Otros skills continúan procesándose

**Resultado**: Skill inválido ignorado, sistema continúa

---

## Criterios de Aceptación

### CA1: Discovery Básico

```gherkin
Feature: Skill Discovery

  Scenario: Discover skills from multiple sources
    Given a project with .opencode/skill/custom/SKILL.md
    And embedded skills exist in binary
    When dipoleCODE starts
    Then SkillIndex contains "custom" with source "local"
    And SkillIndex contains embedded skills with source "embedded"

  Scenario: Priority resolution
    Given embedded skill "create-devtask" exists
    And local skill "create-devtask" exists in .opencode/skill/
    When dipoleCODE starts
    Then SkillIndex contains ONE "create-devtask"
    And its source is "local"
```

### CA2: Context Injection

```gherkin
Feature: Context Injection

  Scenario: Skill index in LLM context
    Given SkillIndex contains 3 skills
    When a conversation starts
    Then LLM context includes "## Available Skills"
    And context includes a table with 3 rows
    And each row has name, description, invocation

  Scenario: LLM can suggest skills
    Given SkillIndex contains "create-devtask"
    And user says "I want to create a task"
    When LLM responds
    Then response may reference "/create-devtask"
```

### CA3: Validation

```gherkin
Feature: Skill Validation

  Scenario: Valid skill included
    Given SKILL.md with valid frontmatter
    When discovery runs
    Then skill is included in index
    And warnings array is empty

  Scenario: Invalid skill excluded
    Given SKILL.md without "name" field
    When discovery runs
    Then skill is NOT in index
    And error is logged

  Scenario: Missing tool warning
    Given SKILL.md with tools: [afwk_nonexistent]
    When discovery runs
    Then skill is included in index
    And warnings contains "Tool 'afwk_nonexistent' not available"
```

### CA4: Skill Loading

```gherkin
Feature: Skill Loading

  Scenario: Load skill on invocation
    Given skill "create-devtask" in index
    When user types "/create-devtask"
    Then full SKILL.md content is loaded
    And content is injected into LLM context

  Scenario: Load skill with warnings
    Given skill "experimental" has warnings
    When user types "/experimental"
    Then warnings are shown in context
    And full content is still loaded
```

---

## Fuera de Alcance

| Item | Razón | Phase |
|------|-------|-------|
| Sync con repo central | Requiere networking, config | Phase 2 |
| CLI commands (workflow sync/list) | Requiere sync primero | Phase 2 |
| config.yaml para sources | No hay sources remotos aún | Phase 2 |
| Cache invalidation | No hay cache remoto | Phase 2 |
| Auto-refresh de index | Complejidad innecesaria en P1 | Phase 3 |
| Skill versioning conflicts | No hay múltiples versions | Phase 3 |
| Skill signatures | Seguridad avanzada | Phase 4 |

---

## Dependencias

### Dependencias Técnicas

| Dependencia | Tipo | Estado |
|-------------|------|--------|
| `gray-matter` | NPM package | Ya instalado |
| `zod` | NPM package | Ya instalado |
| `glob` | Bun built-in | Disponible |
| Embedded skills loader | Código existente | Refactorizar |

### Dependencias de Código

| Módulo | Cambio Requerido |
|--------|------------------|
| `src/skill/embedded.ts` | Exponer como fuente de discovery |
| `src/afwk/system-prompt.ts` | Remover hardcoding de skills |
| `src/session/processor.ts` | Integrar context builder |
| `src/skill/skill.ts` | Usar nuevo resolver |

---

## Riesgos y Mitigaciones

### R1: Performance en proyectos grandes

**Riesgo**: Muchos skills (>100) pueden hacer lento el startup

**Probabilidad**: Baja (pocos usuarios tendrán tantos skills)

**Impacto**: Medio (UX degradada)

**Mitigación**:
- Lazy loading del contenido (solo frontmatter al inicio)
- Cache del index entre sesiones
- Límite configurable de skills

---

### R2: Conflictos de nombres

**Riesgo**: Dos skills con mismo nombre de diferentes fuentes

**Probabilidad**: Media (posible en overrides)

**Impacto**: Bajo (comportamiento definido)

**Mitigación**:
- Prioridad clara: LOCAL > USER > CACHED > EMBEDDED
- Log indicando qué fuente se usó
- Documentación clara del comportamiento

---

### R3: Skills maliciosos

**Riesgo**: Usuario agrega skill que instruye mal al LLM

**Probabilidad**: Baja (requiere acceso local)

**Impacto**: Medio (LLM podría hacer acciones no deseadas)

**Mitigación**:
- Skills son instrucciones, no código ejecutable
- Tools tienen sus propias validaciones
- Phase 4 agregará firmas para skills remotos

---

### R4: Backward compatibility

**Riesgo**: Cambios rompen skills existentes

**Probabilidad**: Baja (formato es simple)

**Impacto**: Alto (skills dejan de funcionar)

**Mitigación**:
- Schema de frontmatter es aditivo (nuevos campos opcionales)
- Validación permisiva (warnings, no errores)
- Versionado de formato si es necesario

---

## Plan de Implementación

### Milestones

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         PLAN DE IMPLEMENTACIÓN                               │
└─────────────────────────────────────────────────────────────────────────────┘

Week 1: Foundation
├── M1.1: Crear estructura de módulos (types.ts, constants.ts)
├── M1.2: Implementar SkillValidator con Zod schema
├── M1.3: Implementar scanDirectory para una fuente
└── M1.4: Tests unitarios para validator

Week 2: Discovery
├── M2.1: Implementar SkillDiscovery completo
├── M2.2: Integrar embedded skills como fuente
├── M2.3: Implementar priority resolution
└── M2.4: Tests de integración para discovery

Week 3: Integration
├── M3.1: Implementar buildSkillIndexSection
├── M3.2: Modificar context builder para inyectar index
├── M3.3: Modificar skill loader para usar resolver
└── M3.4: Remover hardcoding de system-prompt.ts

Week 4: Polish
├── M4.1: Tests end-to-end
├── M4.2: Documentación
├── M4.3: Performance testing
└── M4.4: Bug fixes y refinamiento
```

### Tareas Detalladas

| ID | Tarea | Estimación | Dependencias |
|----|-------|------------|--------------|
| T1 | Crear `skill/types.ts` con interfaces | 2h | - |
| T2 | Crear `skill/constants.ts` con paths | 1h | - |
| T3 | Implementar `skill/validator.ts` | 4h | T1 |
| T4 | Tests para validator | 2h | T3 |
| T5 | Implementar `skill/discovery.ts` | 6h | T1, T2 |
| T6 | Refactorizar `skill/embedded.ts` | 2h | T5 |
| T7 | Tests para discovery | 4h | T5, T6 |
| T8 | Implementar `skill/resolver.ts` | 3h | T5 |
| T9 | Modificar `session/context.ts` | 4h | T5 |
| T10 | Modificar `afwk/system-prompt.ts` | 2h | T9 |
| T11 | Modificar `skill/skill.ts` | 3h | T8 |
| T12 | Tests de integración | 4h | T9, T10, T11 |
| T13 | Tests E2E | 4h | T12 |
| T14 | Documentación | 3h | T13 |
| T15 | Performance testing | 2h | T13 |

**Total estimado**: ~46 horas de desarrollo

---

## Métricas de Éxito

### Métricas Cuantitativas

| Métrica | Target | Medición |
|---------|--------|----------|
| Tiempo de discovery | < 100ms | Performance test |
| Skills soportados | > 50 sin degradación | Load test |
| Test coverage | > 80% | Coverage report |
| Errores en producción | 0 críticos | Monitoring |

### Métricas Cualitativas

| Métrica | Target | Validación |
|---------|--------|------------|
| LLM sugiere skills correctamente | > 80% accuracy | Manual testing |
| Override local funciona | 100% | Test case |
| Documentación clara | Feedback positivo | User review |

### Definition of Done

- [ ] Todos los requisitos funcionales implementados
- [ ] Tests unitarios con > 80% coverage
- [ ] Tests de integración pasando
- [ ] Performance dentro de targets
- [ ] Documentación actualizada
- [ ] Code review aprobado
- [ ] No hay errores críticos conocidos
- [ ] Backward compatible con skills existentes

---

## Apéndice

### A1: Ejemplo de SKILL.md Válido

```markdown
---
name: example-skill
version: 1.0.0
description: Example skill demonstrating the format
argument-hint: optional argument description

tools:
  - afwk_get_kanban_status
  - afwk_create_devtask

templates:
  - overview.md

tags:
  - example
  - documentation

author: aiFRAMEWORK Team
---

# Example Skill

Description of what this skill does.

## Phase 1: Setup

Instructions for phase 1...

## Phase 2: Execute

Instructions for phase 2...
```

### A2: Mensajes de Error

| Código | Mensaje | Acción |
|--------|---------|--------|
| SKILL_INVALID_FRONTMATTER | "Skill '{path}': Invalid frontmatter - {details}" | Skip skill |
| SKILL_MISSING_NAME | "Skill '{path}': Missing required field 'name'" | Skip skill |
| SKILL_MISSING_DESCRIPTION | "Skill '{path}': Missing required field 'description'" | Skip skill |
| SKILL_TOOL_NOT_FOUND | "Skill '{name}': Tool '{tool}' not available" | Warning |
| SKILL_LOAD_ERROR | "Failed to load skill '{name}': {error}" | Skip skill |

### A3: Logging

```typescript
// Niveles de log para skill discovery

log.debug("Scanning directory", { path, source })
log.debug("Found skill file", { path })
log.debug("Parsed frontmatter", { name, version })
log.info("Skill discovered", { name, source })
log.warn("Skill has warnings", { name, warnings })
log.error("Invalid skill", { path, error })
log.info("SkillIndex generated", { count, duration })
```
