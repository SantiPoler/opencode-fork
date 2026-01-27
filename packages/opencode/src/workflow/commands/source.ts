/**
 * Workflow Source Command
 * Manage skill sources (repositories)
 *
 * @module workflow/commands/source
 */

import * as prompts from "@clack/prompts"
import { cmd } from "../../cli/cmd/cmd"
import { UI } from "../../cli/ui"
import { Instance } from "../../project/instance"
import { loadConfig, saveConfig, addSource, removeSource, updateSource } from "../config/loader"
import { fetchRemoteIndex } from "../sync/fetcher"
import { extractRepoName, isValidGitHubUrl } from "../config/defaults"
import type { SourceConfigParsed } from "../config/schema"

export const SourceCommand = cmd({
  command: "source",
  describe: "manage skill sources",
  builder: (yargs) =>
    yargs
      .command(SourceAddCommand)
      .command(SourceListCommand)
      .command(SourceRemoveCommand)
      .command(SourceEnableCommand)
      .command(SourceDisableCommand)
      .demandCommand(1, "Please specify a subcommand"),
  async handler() {},
})

const SourceAddCommand = cmd({
  command: "add <url>",
  describe: "add a new skill source",
  builder: (yargs) =>
    yargs
      .positional("url", {
        describe: "GitHub repository URL",
        type: "string",
        demandOption: true,
      })
      .option("name", {
        alias: "n",
        describe: "source name (defaults to repo name)",
        type: "string",
      })
      .option("branch", {
        alias: "b",
        describe: "branch to sync from",
        type: "string",
        default: "main",
      })
      .option("priority", {
        alias: "p",
        describe: "priority (higher = checked first)",
        type: "number",
        default: 50,
      })
      .option("auth-env", {
        describe: "environment variable containing auth token",
        type: "string",
      })
      .option("skip-validate", {
        describe: "skip validation of the source",
        type: "boolean",
        default: false,
      }),
  async handler(args) {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        UI.empty()
        prompts.intro("Add Source")

        const spinner = prompts.spinner()

        // Validate URL format
        if (!args.url.startsWith("https://")) {
          prompts.log.error("Only HTTPS URLs are allowed for security")
          prompts.outro("Failed")
          return
        }

        if (!isValidGitHubUrl(args.url)) {
          prompts.log.warn("URL does not appear to be a GitHub repository. Proceeding anyway...")
        }

        // Extract repo name for default
        const defaultName = extractRepoName(args.url) || "custom"
        const name = args.name || defaultName

        // Build source config
        const source: SourceConfigParsed = {
          name,
          url: args.url.replace(/\.git$/, ""), // Remove .git suffix if present
          branch: args.branch,
          enabled: true,
          priority: args.priority,
        }

        if (args.authEnv) {
          source.auth = {
            type: "github-token",
            env: args.authEnv,
          }
        }

        // Validate by fetching index (unless skipped)
        if (!args.skipValidate) {
          spinner.start("Validating source...")

          try {
            const config = await loadConfig()
            const index = await fetchRemoteIndex(source, config.settings)
            spinner.stop(`Found ${index.skills.length} skills`)
          } catch (error) {
            spinner.stop("Validation failed")
            prompts.log.error(error instanceof Error ? error.message : String(error))
            prompts.log.info("Use --skip-validate to add without validation")
            prompts.outro("Failed")
            return
          }
        }

        // Add the source
        try {
          await addSource(source)
          prompts.log.success(`Source '${name}' added successfully`)
          prompts.log.info(`Run 'opencode workflow sync' to download skills`)
          prompts.outro("Done")
        } catch (error) {
          prompts.log.error(error instanceof Error ? error.message : String(error))
          prompts.outro("Failed")
        }
      },
    })
  },
})

const SourceListCommand = cmd({
  command: "list",
  aliases: ["ls"],
  describe: "list configured sources",
  async handler() {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        UI.empty()
        prompts.intro("Configured Sources")

        const config = await loadConfig()

        if (config.sources.length === 0) {
          prompts.log.warn("No sources configured")
          prompts.log.info("Add a source with: opencode workflow source add <url>")
          prompts.outro("Done")
          return
        }

        // Sort by priority (descending)
        const sources = [...config.sources].sort((a, b) => b.priority - a.priority)

        console.log("")
        console.log("  Name                 Enabled  Priority  Branch     URL")
        console.log("  " + "─".repeat(80))

        for (const source of sources) {
          const status = source.enabled ? "✓" : "○"
          const name = source.name.padEnd(20)
          const enabled = status.padEnd(8)
          const priority = String(source.priority).padEnd(9)
          const branch = source.branch.padEnd(10)
          const url = source.url

          console.log(`  ${name} ${enabled} ${priority} ${branch} ${url}`)
        }

        console.log("")
        prompts.outro(`${config.sources.length} source(s)`)
      },
    })
  },
})

const SourceRemoveCommand = cmd({
  command: "remove <name>",
  aliases: ["rm"],
  describe: "remove a skill source",
  builder: (yargs) =>
    yargs
      .positional("name", {
        describe: "source name",
        type: "string",
        demandOption: true,
      })
      .option("force", {
        alias: "f",
        describe: "skip confirmation",
        type: "boolean",
        default: false,
      }),
  async handler(args) {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        UI.empty()

        if (!args.force) {
          const confirm = await prompts.confirm({
            message: `Remove source '${args.name}'?`,
          })

          if (prompts.isCancel(confirm) || !confirm) {
            prompts.outro("Cancelled")
            return
          }
        }

        try {
          await removeSource(args.name)
          prompts.log.success(`Source '${args.name}' removed`)
          prompts.outro("Done")
        } catch (error) {
          prompts.log.error(error instanceof Error ? error.message : String(error))
          prompts.outro("Failed")
        }
      },
    })
  },
})

const SourceEnableCommand = cmd({
  command: "enable <name>",
  describe: "enable a skill source",
  builder: (yargs) =>
    yargs.positional("name", {
      describe: "source name",
      type: "string",
      demandOption: true,
    }),
  async handler(args) {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        UI.empty()

        try {
          await updateSource(args.name, { enabled: true })
          prompts.log.success(`Source '${args.name}' enabled`)
          prompts.outro("Done")
        } catch (error) {
          prompts.log.error(error instanceof Error ? error.message : String(error))
          prompts.outro("Failed")
        }
      },
    })
  },
})

const SourceDisableCommand = cmd({
  command: "disable <name>",
  describe: "disable a skill source",
  builder: (yargs) =>
    yargs.positional("name", {
      describe: "source name",
      type: "string",
      demandOption: true,
    }),
  async handler(args) {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        UI.empty()

        try {
          await updateSource(args.name, { enabled: false })
          prompts.log.success(`Source '${args.name}' disabled`)
          prompts.outro("Done")
        } catch (error) {
          prompts.log.error(error instanceof Error ? error.message : String(error))
          prompts.outro("Failed")
        }
      },
    })
  },
})
