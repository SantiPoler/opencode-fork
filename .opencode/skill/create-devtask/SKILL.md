---
name: create-devtask
description: Interactive workflow for creating well-defined devTASKs through discovery, exploration, and collaborative refinement. Use when user wants to create a new devTASK.
argument-hint: Brief description of what the task should accomplish (optional if context exists from conversation)
version: 2.0.0
author: NTEC
license: MIT
tags:
  - workflow
  - task-management
  - planning
tools:
  - afwk_get_steering_context
  - afwk_get_kanban_status
  - afwk_create_devtask
---

# devTASK Creation Workflow

You are guiding the user through creating a high-quality devTASK document. Follow this systematic approach to ensure the devTASK is well-defined, properly scoped, and ready for implementation.

## Core Principles

- **Context-First**: Leverage conversation history - the user may have already discussed what they want
- **Exploration-Driven**: Read steering docs, existing devTASKs, and codebase before proposing scope
- **Propose & Confirm**: Generate ALL values (title, scope, steps, time estimate) and confirm with user
- **Complete Content**: Generate ALL content (no placeholders) before creating the devTASK
- **User Approval**: Show the complete proposal, get explicit confirmation, then create

---

## Phase 1: Context Synthesis

**Goal**: Understand what the user wants based on conversation history and/or arguments

**Actions**:
1. Review the conversation history for context about what the user wants to build
2. If `$ARGUMENTS` provided, incorporate that information
3. If context is clear, summarize your understanding:
   - What problem this solves
   - High-level expected outcome
   - Any constraints mentioned
4. If context is unclear or insufficient, ask clarifying questions:
   - "What problem does this solve?"
   - "What should the end result look like?"
   - "Are there any constraints or dependencies I should know about?"
5. **Confirm understanding with user before proceeding**

---

## Phase 2: Deep Exploration

**Goal**: Gather context from steering docs, existing devTASKs, and codebase

**Actions**:
1. **Read steering documentation**:
   - Call `afwk_get_steering_context` to list available docs
   - Read `product.md` (project goals), `tech.md` (tech stack), `conventions.md` (standards)

2. **Review existing devTASKs**:
   - Call `afwk_get_kanban_status` to see current tasks
   - Read relevant devTASK overview.md files that might inform this task
   - Look for dependencies, related work, or conflicts

3. **Explore codebase** (if technical context needed):
   - Launch 1-2 code-explorer agents to understand:
     - Similar existing features or patterns
     - Integration points
     - Files/modules that will be affected

4. **Present exploration findings**:
   - Summarize what you learned
   - Highlight relevant existing patterns
   - Note any dependencies or conflicts with other tasks

---

## Phase 3: Propose Complete devTASK Definition

**Goal**: Generate and present ALL devTASK fields for user confirmation

**Actions**:
1. **Generate proposed values** for ALL required fields:

```
## 📋 Proposed devTASK

### Title
[Short, descriptive title - max 50 chars]

### Description
[One paragraph summary of what this accomplishes]

### Scope
[Full scope including:]
- **Problem**: [What issue/need this addresses]
- **Expected Outcome**: [What success looks like]
- **Proposed Route**: [High-level approach to solve it]

### Estimated Time
[X hours] - [Brief justification for estimate]

### Preliminary Steps
1. [Step 1 - what needs to happen first]
2. [Step 2 - next action]
3. [Step 3 - etc.]
...

---
¿Te parece bien esta definición? Puedo ajustar cualquier campo antes de crear el devTASK.
```

2. **Wait for user confirmation or feedback**:
   - If user says "sí", "ok", "create it", etc. → proceed to Phase 4
   - If user requests changes → update the proposal and show again
   - Iterate until user explicitly approves

**IMPORTANT**: Do NOT proceed to Phase 4 until user explicitly confirms the proposal.

---

## Phase 4: Document Generation & Creation

**Goal**: Generate the complete overview.md and create the devTASK

**Actions**:

1. **Read the template** to understand expected structure:
   - Read `.afwk/templates/overview.md` if it exists (use Read tool)
   - This tells you what sections are expected and their format
   - If template doesn't exist, use default structure: Objetivo, Alcance, Criterios de Exito, Consideraciones Tecnicas, Fuera de Alcance

2. **Generate FULL overview.md content** following the template structure:
   - **Objetivo**: Full description from the approved scope
   - **Alcance**: Complete scope including problem, expected outcome, proposed route
   - **Criterios de Exito**: 3-5 measurable success criteria with checkboxes
   - **Consideraciones Tecnicas**: Risks, dependencies, architectural decisions
   - **Fuera de Alcance**: Explicit list of what is NOT included
   - **NO `<!-- FILL: ... -->` placeholders** - generate real content for every section

3. **Create with single tool call** - ALL 6 PARAMETERS ARE REQUIRED:
   ```
   afwk_create_devtask({
     title: "Approved title",                              // REQUIRED
     description: "Approved description paragraph",        // REQUIRED
     estimatedTimeHr: 4,                                   // REQUIRED - number > 0
     scope: "Problem: X\nExpected: Y\nRoute: Z",          // REQUIRED - full scope text
     steps: ["Step 1", "Step 2", "Step 3"],               // REQUIRED - array of strings
     content: "# Full Markdown Content\n\n## Objetivo..." // REQUIRED - full overview.md
   })
   ```
   - **DO NOT SKIP ANY PARAMETER** - all 6 must be provided
   - `estimatedTimeHr`: Use the number from approved proposal (e.g., 4 for "4 hours")
   - `scope`: Combine Problem + Expected Outcome + Proposed Route into one string
   - `steps`: Array of step strings from the approved proposal
   - `content`: Full generated overview.md markdown

4. **Inform user about the created document**:
   - The document opens automatically in dipoleSTUDIO
   - Tell the user: "✅ devTASK creado. El documento se abrió en dipoleSTUDIO para revisión final."

**IMPORTANT**:
- Always provide ALL parameters with the approved values
- Never leave `<!-- FILL: ... -->` placeholders
- The devTASK.json will contain: title, description, estimatedTimeHr, scope, steps, status, source, created_at

---

## devTASK.json Schema

The created `devTASK.json` will have this structure:
```json
{
  "id": "devTASK-01_short-title",
  "title": "Short descriptive title",
  "description": "One paragraph summary",
  "estimatedTimeHr": 4,
  "scope": "Full scope text with problem, expected outcome, proposed route",
  "steps": ["Step 1", "Step 2", "Step 3"],
  "status": "backlog",
  "source": "local",
  "remoteIdentifier": null,
  "created_at": "2026-01-27T...",
  "aitasks": []
}
```

**Field descriptions**:
- `source`: "local" = created locally (placeholder until dipole.work sync)
- `remoteIdentifier`: Will be populated when task is synced to dipole.work
- `steps`: Preliminary steps that may change during development

---

## Special Cases

### When user has already discussed the topic extensively
If the conversation already contains detailed discussion about what to build:
- Skip directly to Phase 2 (Exploration) after briefly stating: "Based on our discussion, I understand you want to [summary]. Let me explore the codebase and existing tasks to propose a complete scope."

### When user says "just create it" or wants to skip
Still show the complete proposal but streamline:
- "Here's what I'll create: [compact proposal]. ¿Confirmas?"
- The confirmation step is MANDATORY - never skip it

### When exploration reveals conflicts with existing tasks
Pause and ask user how to proceed:
- "I found devTASK-XX '[title]' which seems related. Should I:
  A) Create a separate devTASK (they're independent)
  B) Suggest adding an aiTASK to the existing devTASK instead
  C) Let me read the existing devTASK first to understand the overlap"

### When user provides very detailed requirements upfront
If user already provided scope, criteria, and technical details:
- Acknowledge: "You've provided detailed requirements. Let me verify against the codebase and format this as a devTASK."
- Use their input as the proposal, still show for confirmation

---

## Language

- The devTASK document sections use Spanish headers (Objetivo, Alcance, etc.) per template convention
- Communicate with user in their preferred language (Spanish or English)
- Content can be in either language based on user preference

---

## Example Flow

```
User: "Necesito crear un devTASK para arreglar el bug del weekly report"
LLM: "Entendido. Déjame explorar el contexto primero..."
     [Reads steering, kanban, explores codebase if needed]

LLM: "## 📋 Proposed devTASK

     ### Title
     Fix Weekly Report Jira Integration

     ### Description
     Resolve issue where Goal of the Week set on fetched Jira Issues
     doesn't appear in dipoleWEEKLY report.

     ### Scope
     - **Problem**: User reports that despite setting Goal of the Week
       on Jira Issues fetched to dipole.work, it doesn't show in
       dipoleWEEKLY report.
     - **Expected Outcome**: When users fetch Jira Issues and set
       Goal of the Week, it maps correctly to dipoleWEEKLY.
     - **Proposed Route**: Investigate if it's a user/Jira relationship
       issue or dipoleWEEKLY logic issue. Test with reporting user.

     ### Estimated Time
     4 hours - Need to investigate and test with user

     ### Preliminary Steps
     1. Review dipoleWEEKLY code that processes Jira Issues
     2. Check how Goal of the Week is mapped from Jira fields
     3. Test with Viry's account to reproduce the issue
     4. Fix the mapping logic or document user workflow fix

     ---
     ¿Te parece bien? Puedo ajustar cualquier campo."

User: "Sí, está bien"

LLM: [Creates devTASK with all fields]
     "✅ devTASK-04_fix-weekly-report-jira creado en backlog.
      El documento se abrió en dipoleSTUDIO para revisión final."
```
