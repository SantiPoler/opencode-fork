/**
 * Workflow Outdated Command
 * Show skills with available updates
 *
 * @module workflow/commands/outdated
 */

import * as prompts from "@clack/prompts"
import { cmd } from "../../cli/cmd/cmd"
import { UI } from "../../cli/ui"
import { Instance } from "../../project/instance"
import { loadConfig, getEnabledSources } from "../config/loader"
import { loadLock } from "../sync/lock"
import { fetchRemoteIndex } from "../sync/fetcher"
import { compareVersions } from "../sync/lock"

export const OutdatedCommand = cmd({
  command: "outdated",
  describe: "show skills with available updates",
  builder: (yargs) =>
    yargs.option("source", {
      alias: "s",
      describe: "check specific source only",
      type: "string",
    }),
  async handler(args) {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        UI.empty()
        prompts.intro("Outdated Skills")

        const config = await loadConfig()
        const lock = await loadLock()
        let sources = getEnabledSources(config)

        if (args.source) {
          sources = sources.filter((s) => s.name === args.source)
          if (sources.length === 0) {
            prompts.log.error(`Source '${args.source}' not found or not enabled`)
            prompts.outro("Done")
            return
          }
        }

        if (sources.length === 0) {
          prompts.log.warn("No sources configured")
          prompts.outro("Done")
          return
        }

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
          } catch (error) {
            // Skip sources that fail to fetch
            prompts.log.warn(`Failed to check ${source.name}: ${error instanceof Error ? error.message : String(error)}`)
          }
        }

        spinner.stop("Done")

        if (outdated.length === 0) {
          prompts.log.success("All skills are up to date!")
          prompts.outro("Done")
          return
        }

        // Display table
        console.log("")
        console.log("  Outdated Skills:")
        console.log("")
        console.log("  Name                    Installed    Available    Source")
        console.log("  " + "─".repeat(65))

        for (const skill of outdated) {
          const name = skill.name.padEnd(24)
          const installed = skill.installed.padEnd(12)
          const available = skill.available.padEnd(12)
          console.log(`  ${name} ${installed} ${available} ${skill.source}`)
        }

        console.log("")
        prompts.log.info("Run 'opencode workflow sync' to update.")
        prompts.outro(`${outdated.length} skill(s) have updates`)
      },
    })
  },
})
