---
name: create-aitask
description: Interactive workflow for creating aiTASK blueprints within a devTASK. Use when user wants to create a new iteration/aiTASK for an existing devTASK.
argument-hint: devTASK ID and brief description of the iteration objective
version: 1.0.0
author: NTEC
license: MIT
tags:
  - workflow
  - task-management
  - implementation
tools:
  - afwk_get_kanban_status
  - afwk_create_aitask
---

# aiTASK Creation Workflow

You are guiding the user through creating an aiTASK blueprint within an existing devTASK. aiTASKs are smaller, focused iterations that break down a devTASK into implementable chunks.

## Core Principles

- **Context-Aware**: Understand the parent devTASK's objective and scope
- **Focused Scope**: Each aiTASK should be completable in a single session
- **Complete Content**: Generate ALL content (no placeholders) before creating
- **Implementation-Ready**: Blueprint should be detailed enough to execute immediately

---

## Phase 1: Context & Parent Task

**Goal**: Understand which devTASK this aiTASK belongs to and what iteration is needed

**Actions**:
1. If `$ARGUMENTS` contains a devTASK ID, use it
2. If not specified, call `afwk_get_kanban_status` to show available devTASKs
3. Ask user which devTASK this aiTASK is for (if not clear)
4. Read the parent devTASK's overview.md to understand:
   - Overall objective
   - Scope and success criteria
   - What has been done vs. what remains

5. **Confirm the parent devTASK** before proceeding

---

## Phase 2: Iteration Scope Definition

**Goal**: Define what this specific aiTASK will accomplish

**Actions**:
1. Based on the parent devTASK and conversation context, propose:
   - **Title**: Short descriptive name for this iteration
   - **Objective**: What this specific iteration accomplishes
   - **Scope**: Files/components to be modified
   - **Success criteria**: How to know this iteration is complete

2. **Present proposal to user**:
   ```
   ## Proposed aiTASK: [Title]

   **Parent**: [devTASK-XX]

   **Objective**: [What this iteration accomplishes]

   **Scope**:
   - [File/component 1]
   - [File/component 2]

   **Success Criteria**:
   - [ ] [Criterion 1]
   - [ ] [Criterion 2]

   Does this look right?
   ```

3. **Iterate based on feedback** until user approves the scope

---

## Phase 3: Blueprint Generation & Creation

**Goal**: Generate the complete aiTASK blueprint and create it

**Actions**:

1. **Read the template** to understand expected structure:
   - Read `.afwk/templates/aitask-blueprint.md` if it exists
   - Default sections: Objetivo, Especificacion de Implementacion, Criterios de Validacion, Archivos a Modificar, Casos de Prueba

2. **Generate FULL content** following the template structure:
   - **Objetivo de esta Iteracion**: Clear statement from approved scope
   - **Especificacion de Implementacion**: Detailed technical steps
   - **Criterios de Validacion**: 3-5 specific validation checks
   - **Archivos a Modificar**: List of files with change descriptions
   - **Casos de Prueba**: 2-4 test cases including edge cases
   - **NO `<!-- FILL: ... -->` placeholders** - generate real content

3. **Show brief preview** to user:
   ```
   📝 Generating aiTASK blueprint:
   - Title: [Title]
   - Objective: [First sentence]
   - Files to modify: [X files]
   - Test cases: [N cases]

   Creating aiTASK...
   ```

4. **Create with single tool call**:
   ```
   afwk_create_aitask({
     devTaskId: "devTASK-XX_slug",
     title: "Short descriptive title",
     objective: "One-paragraph objective",
     content: "# Full Markdown Content\n\n## Objetivo de esta Iteracion\n..."
   })
   ```
   - The `content` parameter contains your FULL generated blueprint
   - Document is written directly (no staging required)

5. **Inform user about the created blueprint**:
   - The document opens automatically in dipoleSTUDIO
   - Tell the user: "El aiTASK ha sido creado y el blueprint se abrió en dipoleSTUDIO. Puedes editarlo si necesitas hacer ajustes."

**IMPORTANT**:
- Always provide the `content` parameter with complete blueprint
- Never leave `<!-- FILL: ... -->` placeholders for the user to see
- The document is created directly in the devTASK folder

---

## Special Cases

### When user says "next iteration" or similar
If context makes it clear what the next step should be:
- Skip to Phase 2 with a proposal based on the remaining work
- "Based on the devTASK progress, the next iteration should focus on [X]. Let me propose the scope..."

### When multiple aiTASKs are needed
If the user wants to plan multiple iterations:
- List them briefly, then create one at a time
- "I see 3 iterations needed: A) [X], B) [Y], C) [Z]. Let's start with A..."

### When devTASK is not in todo or in_progress
If the devTASK is still in backlog:
- Warn the user: "This devTASK is still in backlog. You should move it to 'todo' first with `afwk_move_kanban_task`."
- Offer to move it before creating the aiTASK

---

## Language

- Blueprint sections use Spanish headers per template convention
- Communicate with user in their preferred language
- Content can be in either language based on user preference

---

## Example Flow

```
User: "Crea un aiTASK para empezar con el devTASK de autenticación"
LLM: [Reads devTASK-03_oauth2-auth/overview.md]
     "El devTASK tiene como objetivo implementar OAuth2. Propongo empezar con:

     ## aiTASK: Setup OAuth2 Provider Config
     **Objetivo**: Configurar el proveedor OAuth2 y las variables de entorno
     **Scope**: auth/config.ts, .env.example
     **Criterios**: Provider configurado, tests de conexión pasan

     ¿Te parece bien?"
User: "Sí, agrégale también el endpoint de callback"
LLM: [Updates scope]
     "Scope actualizado. Creando aiTASK..."
     [Creates aiTASK with content]
     "✅ aiTASK-01_oauth2-config creado en devTASK-03.
      El blueprint se abrió en dipoleSTUDIO para revisión."
```
