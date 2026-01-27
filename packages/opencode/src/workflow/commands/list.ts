/**
 * Workflow List Command
 * List available and installed skills
 *
 * @module workflow/commands/list
 */

import * as prompts from "@clack/prompts"
import { cmd } from "../../cli/cmd/cmd"
import { UI } from "../../cli/ui"
import { Instance } from "../../project/instance"
import { getAllSkills } from "../../skill/resolver"
import { loadConfig, getEnabledSources } from "../config/loader"
import { loadLock } from "../sync/lock"
import { fetchRemoteIndex } from "../sync/fetcher"
import type { SkillIndexEntry } from "../../skill/types"

export const ListCommand = cmd({
  command: "list",
  aliases: ["ls"],
  describe: "list available skills",
  builder: (yargs) =>
    yargs
      .option("remote", {
        alias: "r",
        describe: "show skills available from remote sources (not installed)",
        type: "boolean",
        default: false,
      })
      .option("source", {
        alias: "s",
        describe: "filter by source name",
        type: "string",
      })
      .option("all", {
        alias: "a",
        describe: "show all skills (installed + remote)",
        type: "boolean",
        default: false,
      }),
  async handler(args) {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        UI.empty()

        if (args.remote || args.all) {
          await showRemoteSkills(args.source, args.all)
        } else {
          await showInstalledSkills(args.source)
        }
      },
    })
  },
})

async function showInstalledSkills(sourceFilter?: string) {
  prompts.intro("Installed Skills")

  const skills = await getAllSkills()
  const lock = await loadLock()

  if (skills.length === 0) {
    prompts.log.warn("No skills installed")
    prompts.outro("Run 'opencode workflow sync' to install skills")
    return
  }

  // Group by source
  const bySource: Record<string, SkillIndexEntry[]> = {}
  for (const skill of skills) {
    const source = skill.source || "unknown"

    if (sourceFilter && source !== sourceFilter) continue

    if (!bySource[source]) bySource[source] = []
    bySource[source].push(skill)
  }

  // Display table header
  console.log("")
  console.log("  Name                    Version    Source       Description")
  console.log("  " + "─".repeat(75))

  let totalCount = 0
  for (const [source, sourceSkills] of Object.entries(bySource)) {
    for (const skill of sourceSkills) {
      const lockEntry = lock.skills[skill.name]
      const version = lockEntry?.version || skill.version || "-"
      const desc = truncate(skill.description || "", 30)
      const name = skill.name.padEnd(24)
      const ver = version.padEnd(10)
      const src = source.padEnd(12)

      console.log(`  ${name} ${ver} ${src} ${desc}`)
      totalCount++
    }
  }

  console.log("")
  prompts.outro(`${totalCount} skill(s) installed`)
}

async function showRemoteSkills(sourceFilter?: string, includeInstalled = false) {
  prompts.intro(includeInstalled ? "All Skills" : "Remote Skills (Not Installed)")

  const config = await loadConfig()
  const lock = await loadLock()
  let sources = getEnabledSources(config)

  if (sourceFilter) {
    sources = sources.filter((s) => s.name === sourceFilter)
    if (sources.length === 0) {
      prompts.log.error(`Source '${sourceFilter}' not found or not enabled`)
      prompts.outro("Done")
      return
    }
  }

  if (sources.length === 0) {
    prompts.log.warn("No sources configured")
    prompts.log.info("Add a source with: opencode workflow source add <url>")
    prompts.outro("Done")
    return
  }

  const spinner = prompts.spinner()
  spinner.start("Fetching remote indices...")

  const remoteSkills: Array<{
    name: string
    version: string
    source: string
    description: string
    installed: boolean
    localVersion?: string
  }> = []

  for (const source of sources) {
    try {
      const index = await fetchRemoteIndex(source, config.settings)

      for (const skill of index.skills) {
        const localSkill = lock.skills[skill.name]
        const isInstalled = !!localSkill

        if (!includeInstalled && isInstalled) {
          continue // Skip installed skills in remote-only view
        }

        remoteSkills.push({
          name: skill.name,
          version: skill.version,
          source: source.name,
          description: skill.description,
          installed: isInstalled,
          localVersion: localSkill?.version,
        })
      }
    } catch (error) {
      prompts.log.warn(`Failed to fetch from ${source.name}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  spinner.stop("Done")

  if (remoteSkills.length === 0) {
    if (includeInstalled) {
      prompts.log.info("No skills found")
    } else {
      prompts.log.info("All available skills are installed")
    }
    prompts.outro("Done")
    return
  }

  // Display table
  console.log("")
  if (includeInstalled) {
    console.log("  Name                    Version    Source       Status       Description")
  } else {
    console.log("  Name                    Version    Source       Description")
  }
  console.log("  " + "─".repeat(80))

  for (const skill of remoteSkills) {
    const desc = truncate(skill.description, 25)
    const name = skill.name.padEnd(24)
    const ver = skill.version.padEnd(10)
    const src = skill.source.padEnd(12)

    if (includeInstalled) {
      let status: string
      if (!skill.installed) {
        status = "not installed"
      } else if (skill.localVersion === skill.version) {
        status = "✓ up to date "
      } else {
        status = `↑ ${skill.localVersion}`
      }
      console.log(`  ${name} ${ver} ${src} ${status.padEnd(12)} ${desc}`)
    } else {
      console.log(`  ${name} ${ver} ${src} ${desc}`)
    }
  }

  console.log("")
  prompts.outro(`${remoteSkills.length} skill(s)`)
}

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str
  return str.slice(0, maxLen - 3) + "..."
}
