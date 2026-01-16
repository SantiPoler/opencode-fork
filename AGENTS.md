## Codebase Overview

OpenCode is an open-source AI coding agent (like Claude Code) with a terminal UI, multi-provider LLM support, and extensible plugin architecture.

**Stack**: Bun, TypeScript, SolidJS, Hono, Tauri, Cloudflare Workers, PlanetScale

**Structure**:
- `packages/opencode/` - Core CLI with 36 modules (tools, providers, agents, sessions)
- `packages/app/` - Terminal UI (SolidJS)
- `packages/desktop/` - Tauri desktop app
- `packages/console/` - Admin console with billing/auth
- `packages/sdk/` - OpenAPI-generated JavaScript SDK
- `infra/` - SST infrastructure for Cloudflare

For detailed architecture, see [docs/CODEBASE_MAP.md](docs/CODEBASE_MAP.md).

## Quick Reference

- To test opencode in `packages/opencode`, run `bun dev`.
- To regenerate the JavaScript SDK, run `./packages/sdk/js/script/build.ts`.
- ALWAYS USE PARALLEL TOOLS WHEN APPLICABLE.
- The default branch in this repo is `dev`.
