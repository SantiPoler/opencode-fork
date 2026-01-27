---
name: complete-aitask
description: Interactive workflow for documenting aiTASK completion notes. Use when user finishes working on an aiTASK and needs to document what was accomplished.
argument-hint: aiTASK ID (e.g., aiTASK-01_feature-name)
version: 1.0.0
author: NTEC
license: MIT
tags:
  - workflow
  - task-management
  - documentation
tools:
  - afwk_get_kanban_status
  - afwk_complete_aitask
  - afwk_update_latest_implementation
---

# aiTASK Completion Workflow

You are guiding the user through documenting the completion of an aiTASK. Completion notes capture what was actually implemented, problems encountered, decisions made, and lessons learned.

## Core Principles

- **Retrospective Focus**: Document what actually happened, not what was planned
- **Complete Documentation**: Capture implementation details, deviations, and learnings
- **Implementation Awareness**: Leverage your knowledge of the work done in this session
- **Direct Write**: Generate complete content and write directly to file

---

## Phase 1: Context & aiTASK Identification

**Goal**: Identify which aiTASK is being completed and understand its context

**Actions**:
1. If `$ARGUMENTS` contains an aiTASK ID, use it
2. If not specified, call `afwk_get_kanban_status` to show in_progress devTASKs and their aiTASKs
3. Ask user which aiTASK they completed (if not clear)
4. Read the aiTASK blueprint to understand:
   - Original objective
   - Planned implementation
   - Success criteria
5. **Confirm the aiTASK** before proceeding

---

## Phase 2: Implementation Summary

**Goal**: Gather information about what was actually implemented

**Actions**:
1. Based on your knowledge of the work done in this session, summarize:
   - **What was implemented**: Key components, features, or changes
   - **Files modified**: List of files created or changed
   - **Deviations from blueprint**: Anything done differently than planned
   - **Problems encountered**: Issues faced and how they were resolved
   - **Decisions made**: Architectural or implementation decisions

2. **Present summary to user**:
   ```
   ## Completion Summary for [aiTASK ID]

   **Implemented**:
   - [Key accomplishment 1]
   - [Key accomplishment 2]

   **Files Modified**:
   - `path/to/file.ts` - [description]
   - `path/to/another.ts` - [description]

   **Deviations from Blueprint**:
   - [Original plan] -> [What was actually done] - [Why]

   **Problems & Solutions**:
   - [Problem] -> [Solution]

   **Key Decisions**:
   - [Decision and rationale]

   Is this accurate? Anything to add or correct?
   ```

3. **Iterate based on feedback** until user confirms the summary is complete

---

## Phase 3: Generate Completion Notes & Create

**Goal**: Generate the complete completion notes document and create it

**Actions**:

1. **Read the template** to understand expected structure:
   - Read `.afwk/templates/completion-notes.md` if it exists
   - Default sections: Fecha, Resumen, Archivos, Desviaciones, Problemas, Decisiones, Tests, Deuda Tecnica

2. **Generate FULL content** following the template structure:
   - **Fecha de Implementacion**: Current date/time
   - **Resumen de Implementacion**: Comprehensive summary from Phase 2
   - **Archivos Creados/Modificados**: List with descriptions
   - **Desviaciones del Blueprint**: Detailed explanation of changes
   - **Problemas Encontrados y Soluciones**: Each problem and its resolution
   - **Decisiones de Implementacion**: Rationale for key choices
   - **Test Results**: Unit, integration, and manual testing results
   - **Deuda Tecnica Identificada**: Technical debt to address later

3. **Show brief preview** to user:
   ```
   📝 Generating completion notes:
   - aiTASK: [aiTASK ID]
   - Sections: Resumen, Archivos (X files), Decisiones (N items), ...

   Creating completion notes...
   ```

4. **Create with single tool call**:
   ```
   afwk_complete_aitask({
     aiTaskId: "aiTASK-XX_slug",
     notes: "Brief summary for metadata",
     content: "# Full Markdown Content\n\n## Fecha de Implementacion\n..."
   })
   ```
   - The `content` parameter contains your FULL generated document
   - Document is written directly (no staging required)

5. **Inform user about the created document**:
   - The document opens automatically in dipoleSTUDIO
   - Tell the user: "Las notas de completado han sido creadas y se abrieron en dipoleSTUDIO."

6. **Update latest-implementation.md** (if changes merit it):
   - Evaluate if the implementation introduced significant changes worth documenting in steering:
     - New patterns or conventions established
     - Architectural decisions that affect future work
     - Important technical debt identified
     - Key learnings that should persist
   - If yes, call `afwk_update_latest_implementation`:
     ```
     afwk_update_latest_implementation({
       summary: "Brief summary of what was implemented and key decisions"
     })
     ```
   - If the changes are minor/routine, skip this step and inform user:
     "Los cambios fueron rutinarios, no se requiere actualizar latest-implementation."

**IMPORTANT**:
- Always provide the `content` parameter with complete document
- Never leave placeholder sections for the user to fill
- The document is created directly in the devTASK folder
- Use judgment for latest-implementation update — not every completion needs it

---

## Special Cases

### When completion is straightforward
If the implementation followed the blueprint exactly:
- Simplify Phase 2 with a quick confirmation
- "La implementacion siguio el blueprint exactamente. Solo confirma los archivos modificados..."

### When there are significant deviations
If major changes occurred:
- Spend more time in Phase 2 documenting rationale
- "Hubo cambios significativos respecto al blueprint. Documentemos cada desviacion..."

### When tests failed or are incomplete
If testing is incomplete:
- Document the current state honestly
- "Algunos tests estan pendientes. Documentaremos el estado actual..."

---

## Language

- Completion notes sections use Spanish headers per template convention
- Communicate with user in their preferred language
- Content can be in either language based on user preference

---

## Example Flow

```
User: "Ya termine el aiTASK-01, documenta los completion notes"
LLM: [Reads aiTASK-01 blueprint]
     "Veo que trabajaste en la configuracion del proyecto.
     Basandome en el trabajo de esta sesion:

     ## Resumen:
     - Configuraste TypeScript con strict mode
     - Creaste el build script
     - Agregaste ESLint y Prettier

     **Archivos**:
     - tsconfig.json - configuracion TS
     - package.json - scripts y deps
     - .eslintrc.js - reglas de lint

     **Desviaciones**: Ninguna significativa

     ¿Es correcto?"
User: "Si, pero agrega que decidimos usar tsx en vez de ts-node"
LLM: [Updates summary]
     "Perfecto. Creando completion notes..."
     [Creates with content]
     "✅ Notas de completado creadas para aiTASK-01.
      El documento se abrio en dipoleSTUDIO.

      La decision de usar tsx en vez de ts-node es una convencion importante.
      Actualizando latest-implementation..."
     [Calls afwk_update_latest_implementation]
     "✅ Steering docs actualizados con la decision de tooling."
```
