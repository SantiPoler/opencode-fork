/**
 * Workflow Info Command
 * Show detailed information about a skill
 *
 * @module workflow/commands/info
 */

import * as prompts from "@clack/prompts"
import { cmd } from "../../cli/cmd/cmd"
import { UI } from "../../cli/ui"
import { Instance } from "../../project/instance"
import { resolveSkill, loadSkill } from "../../skill/resolver"
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
        prompts.intro(`Skill: ${args.name}`)

        // Try to resolve the skill
        const skillEntry = await resolveSkill(args.name)
        if (!skillEntry) {
          prompts.log.error(`Skill '${args.name}' not found`)
          prompts.log.info("Run 'opencode workflow list' to see available skills")
          prompts.outro("Done")
          return
        }

        // Load the full skill content
        const loadedSkill = await loadSkill(args.name)

        // Get lock entry for sync info
        const lock = await loadLock()
        const lockEntry = lock.skills[args.name]
        const sourceLock = lockEntry?.source ? lock.sources[lockEntry.source] : undefined

        // Display information
        console.log("")
        console.log(`  Name:        ${skillEntry.name}`)
        console.log(`  Version:     ${lockEntry?.version || skillEntry.version || "unknown"}`)
        console.log(`  Source:      ${skillEntry.source}${sourceLock ? ` (${sourceLock.url})` : ""}`)
        console.log(`  Status:      installed`)
        console.log("")
        console.log(`  Description:`)
        console.log(`    ${skillEntry.description || "No description"}`)
        console.log("")

        // Show tools if available
        const tools = loadedSkill?.entry?.tools || skillEntry.tools
        if (tools && tools.length > 0) {
          console.log(`  Tools required:`)
          for (const tool of tools) {
            console.log(`    ✓ ${tool}`)
          }
          console.log("")
        }

        // Show tags if available
        if (skillEntry.tags && skillEntry.tags.length > 0) {
          console.log(`  Tags: ${skillEntry.tags.join(", ")}`)
          console.log("")
        }

        // Show file location
        console.log(`  Location:    ${skillEntry.path}`)

        // Show sync info
        if (lockEntry) {
          console.log("")
          console.log(`  Sync info:`)
          console.log(`    Hash:      ${lockEntry.hash || "none"}`)
          console.log(`    Installed: ${new Date(lockEntry.installedAt).toLocaleString()}`)
        }

        console.log("")
        prompts.outro("Done")
      },
    })
  },
})
