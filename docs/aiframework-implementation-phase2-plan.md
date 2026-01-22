# aiFRAMEWORK - Plan de Implementación Fase 2

## Resumen Ejecutivo

Extender el aiFRAMEWORK con tools de creación de contenido, getters adicionales, motor de validación de transiciones, y templates. Sigue los patrones establecidos en Fase 1.

---

## Estado Actual (Fase 1 Completada)

**Ubicación:** `packages/opencode/src/afwk/`

| Componente | Archivo | Estado |
|------------|---------|--------|
| Tools | `tools.ts` | `afwk_get_kanban_status`, `afwk_move_kanban_task` |
| Contratos | `contracts.ts` | `AfwkToolOutput`, `TOOL_REGISTRY`, `AFWK_TOOL_IDS` |
| Estado | `state.ts` | Audit log, pending actions |
| Enforcement | `classifier.ts`, `policy-gate.ts`, `evidence.ts` | Intent → Policy Gate → Retry |

---

## Orden de Implementación

### Wave 1: Foundation (Templates + Contratos)

#### 1.1 `contracts.ts` - Actualizar registros
```typescript
export const AFWK_TOOL_IDS = {
  // Existentes
  getKanbanStatus: "afwk_get_kanban_status",
  moveKanbanTask: "afwk_move_kanban_task",
  // Nuevos Getters
  getSteeringContext: "afwk_get_steering_context",
  validateDevTask: "afwk_validate_devtask",
  // Nuevos Mutators
  createDevTask: "afwk_create_devtask",
  createAiTask: "afwk_create_aitask",
  completeAiTask: "afwk_complete_aitask",
} as const

export const TOOL_REGISTRY = {
  getters: [
    AFWK_TOOL_IDS.getKanbanStatus,
    AFWK_TOOL_IDS.getSteeringContext,
    AFWK_TOOL_IDS.validateDevTask,
  ],
  mutators: [
    AFWK_TOOL_IDS.moveKanbanTask,
    AFWK_TOOL_IDS.createDevTask,
    AFWK_TOOL_IDS.createAiTask,
    AFWK_TOOL_IDS.completeAiTask,
  ],
} as const
```

#### 1.2 Nuevo archivo: `template-loader.ts`
- Cargar templates desde `.afwk/templates/` con fallback a bundled
- Interpolación tipo mustache (`{{key}}`)
- Templates: `overview.md`, `aitask-blueprint.md`, `completion-notes.md`

---

### Wave 2: Content Creation Tools (Prioridad Alta)

#### 2.1 `afwk_create_devtask`
**Parámetros:**
- `title: string` - Título del devTASK
- `description: string` - Descripción

**Lógica:**
1. Auto-increment ID (escanear backlog, encontrar máximo XX)
2. Generar slug del título (kebab-case, max 30 chars)
3. Crear carpeta: `.afwk/kanban/backlog/devTASK-XX_slug/`
4. Crear `devTASK.json` con metadata
5. Crear `overview.md` desde template
6. Log audit trail

#### 2.2 `afwk_create_aitask`
**Parámetros:**
- `devTaskId: string` - ID del devTASK padre
- `title: string` - Título del aiTASK
- `objective: string` - Objetivo de la iteración

**Lógica:**
1. Validar que devTASK existe (buscar en todas las columnas)
2. Auto-increment aiTASK ID dentro del devTASK
3. Crear `aiTASK-XX_slug.md` desde template
4. Actualizar `devTASK.json` (agregar aiTASK al array)
5. Log audit trail

#### 2.3 `afwk_complete_aitask`
**Parámetros:**
- `aiTaskId: string` - ID del aiTASK a completar
- `notes: string` - Notas de completado

**Lógica:**
1. Encontrar aiTASK file (buscar en todos los devTASKs)
2. Validar que no tiene completion notes
3. Crear `aiTASK-XX_completion-notes.md` desde template
4. Encolar pending action `update_latest_implementation`
5. Log audit trail

---

### Wave 3: Additional Getters (Prioridad Media)

#### 3.1 `afwk_get_steering_context`
**Parámetros:**
- `docType?: string` - Doc específico (tech.md, roles.md, etc.)

**Lógica:**
1. Si `docType` especificado → leer ese archivo de `.afwk/steering/`
2. Si no → retornar índice de docs disponibles
3. Retornar contenido para contexto LLM

#### 3.2 `afwk_validate_devtask`
**Parámetros:**
- `taskId: string` - ID del devTASK a validar

**Lógica:**
1. Encontrar carpeta del devTASK
2. Verificar archivos requeridos (overview.md, devTASK.json)
3. Verificar secciones requeridas en overview.md
4. Verificar aiTASKs tienen secciones requeridas
5. Retornar reporte de validación

---

### Wave 4: Transition Validation Engine

#### 4.1 Nuevo archivo: `rules-engine.ts`
```typescript
const TRANSITION_RULES = [
  {
    from: "backlog", to: "todo",
    checks: [{ type: "file_exists", path: "overview.md", error: "..." }]
  },
  {
    from: "todo", to: "in_progress",
    checks: [{ type: "min_files_match", pattern: "aiTASK-*.md", min: 1, error: "..." }]
  },
  {
    from: "in_progress", to: "completed",
    checks: [{ type: "all_aitasks_have_completion_notes", error: "..." }]
  }
]

export async function validateTransition(devTaskPath, from, to): Promise<RuleResult>
```

#### 4.2 Actualizar `afwk_move_kanban_task`
- Llamar `validateTransition()` antes de mover
- Retornar `ok:false` con errores de reglas si falla

---

### Wave 5: Integración

#### 5.1 `system-prompt.ts`
- Agregar nuevas tools a la sección "Available Tools"

#### 5.2 `tools.ts`
- Exportar array actualizado: `AfwkTools = [..., nuevas tools]`

#### 5.3 `index.ts`
- Exportar nuevos módulos y tools

---

## Archivos a Crear/Modificar

| Archivo | Acción | Descripción |
|---------|--------|-------------|
| `contracts.ts` | Modificar | Agregar IDs y actualizar registry |
| `template-loader.ts` | Crear | Carga e interpolación de templates |
| `rules-engine.ts` | Crear | Motor de validación de transiciones |
| `tools.ts` | Modificar | 5 nuevas tools + actualizar move |
| `system-prompt.ts` | Modificar | Documentar nuevas tools |
| `index.ts` | Modificar | Exports adicionales |

---

## Tests Requeridos

### Unit Tests
| Archivo | Cobertura |
|---------|-----------|
| `__tests__/template-loader.test.ts` | Carga, interpolación, fallback |
| `__tests__/rules-engine.test.ts` | Cada tipo de check, transiciones |
| `__tests__/tools-phase2.test.ts` | Las 5 nuevas tools |

### Integration Tests
| Archivo | Escenarios |
|---------|------------|
| `__tests__/tools-integration.test.ts` | Workflow completo, bloqueos de transición |

---

## Riesgos y Mitigación

| Riesgo | Mitigación |
|--------|------------|
| Race condition en auto-increment ID | Aceptable para MVP; devTASKs se crean manualmente |
| Template no encontrado | Fallback a bundled defaults |
| Steering docs muy grandes | Retornar índice por defecto, soporte para doc específico |
| Security hooks (bloquear .afwk/) | **Diferido a Fase 3** - complejidad alta |

---

## Verificación

### Smoke Tests Manuales
1. Crear devTASK → verificar carpeta y archivos creados
2. Crear aiTASK → verificar dentro del devTASK
3. Mover backlog→todo SIN overview.md → debe fallar
4. Mover backlog→todo CON overview.md → debe funcionar
5. Mover todo→in_progress SIN aiTASK → debe fallar
6. Completar aiTASK → verificar completion notes creadas
7. Mover in_progress→completed → verificar todas las notas

### Tests Automatizados
```bash
cd packages/opencode
bun test src/afwk/__tests__/
```

---

## Estimación

| Wave | Componentes | Complejidad |
|------|-------------|-------------|
| Wave 1 | contracts, templates | Baja |
| Wave 2 | 3 tools creación | Media |
| Wave 3 | 2 tools getters | Baja |
| Wave 4 | rules engine + update | Media |
| Wave 5 | integración | Baja |

**Diferido:** Security hooks (bloquear bash/edit en .afwk/) - Fase 3

---

## Diagrama de Dependencias

```
contracts.ts (Wave 1)
    ↓
template-loader.ts (Wave 1)
    ↓
createDevTask (Wave 2) ────┐
    ↓                      │
createAiTask (Wave 2) ─────┤
    ↓                      │
completeAiTask (Wave 2) ───┤
                           │
rules-engine.ts (Wave 4) ──┼── moveKanbanTask update (Wave 4)
                           │
getSteeringContext (Wave 3)│
validateDevTask (Wave 3) ──┘
                           ↓
system-prompt.ts (Wave 5)
    ↓
index.ts (Wave 5)
```

---

*Documento generado: 21 enero 2026*
*Basado en: aiframework-plugin-architecture-v2.1.2.md y aiframework-architecture-phase1.md*
