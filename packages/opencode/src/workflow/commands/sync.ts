/**
 * Workflow Sync Command
 * Synchronize skills from configured remote sources
 *
 * @module workflow/commands/sync
 */

import * as prompts from "@clack/prompts"
import { cmd } from "../../cli/cmd/cmd"
import { UI } from "../../cli/ui"
import { Instance } from "../../project/instance"
import { Installation } from "../../installation"
import { loadConfig, getEnabledSources } from "../config/loader"
import { loadLock, updateLockAfterSync, updateLockAfterTemplateSync, templateNeedsUpdate, type TemplateSyncResult } from "../sync/lock"
import { fetchRemoteIndex, fetchWithRetry } from "../sync/fetcher"
import { compareWithLock, getSkillsToSync, hasChanges } from "../sync/comparator"
import {
  downloadSkills,
  downloadTemplates,
  getDownloadStats,
  getSuccessfulDownloads,
  getSuccessfulTemplateDownloads,
  getTemplateDownloadStats,
} from "../sync/downloader"
import type { SkillSyncResult, SkillSyncError, SyncResult } from "../types"
import type { RemoteSkillEntryParsed, RemoteTemplateEntryParsed } from "../config/schema"

export const SyncCommand = cmd({
  command: "sync [name]",
  describe: "synchronize skills from configured sources",
  builder: (yargs) =>
    yargs
      .positional("name", {
        describe: "specific skill name to sync",
        type: "string",
      })
      .option("force", {
        alias: "f",
        describe: "force re-download even if up to date",
        type: "boolean",
        default: false,
      })
      .option("dry-run", {
        describe: "show what would be synced without downloading",
        type: "boolean",
        default: false,
      })
      .option("source", {
        alias: "s",
        describe: "sync from specific source only",
        type: "string",
      }),
  async handler(args) {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        UI.empty()
        prompts.intro("Workflow Sync")

        const spinner = prompts.spinner()

        try {
          // Load config and lock
          spinner.start("Loading configuration...")
          const config = await loadConfig()
          let lock = await loadLock()
          let sources = getEnabledSources(config)

          // Filter by source if specified
          if (args.source) {
            sources = sources.filter((s) => s.name === args.source)
            if (sources.length === 0) {
              spinner.stop(`Source '${args.source}' not found or not enabled`)
              prompts.outro("Done")
              return
            }
          }

          if (sources.length === 0) {
            spinner.stop("No sources configured")
            prompts.log.warn("Add a source with: opencode workflow source add <url>")
            prompts.outro("Done")
            return
          }

          spinner.stop(`Found ${sources.length} source(s)`)

          // Check for offline mode
          if (config.settings.offlineMode) {
            prompts.log.warn("Offline mode enabled - using cached skills only")
            prompts.outro("Done")
            return
          }

          const results: SyncResult = {
            success: true,
            updated: [],
            added: [],
            failed: [],
            warnings: [],
            duration: 0,
          }

          const startTime = Date.now()

          // Process each source
          for (const source of sources) {
            prompts.log.info(`\n📦 ${source.name} (${source.url})`)

            spinner.start("Fetching index...")

            let index
            try {
              index = await fetchWithRetry(() => fetchRemoteIndex(source, config.settings))
            } catch (error) {
              spinner.stop("Failed to fetch index")
              const errorMsg = error instanceof Error ? error.message : String(error)
              prompts.log.error(`   ${errorMsg}`)
              results.success = false
              results.failed.push({
                name: source.name,
                source: source.name,
                error: errorMsg,
              })
              continue
            }

            const templateCount = index.templates?.length || 0
            spinner.stop(`Found ${index.skills.length} skills and ${templateCount} templates in index`)

            // Compare with lock
            const comparison = compareWithLock(
              lock,
              index.skills,
              Installation.VERSION,
              config.settings.allowIncompatible,
            )

            // Filter by name if specified
            let toSync: RemoteSkillEntryParsed[]
            if (args.name) {
              const skill = index.skills.find((s) => s.name === args.name)
              if (!skill) {
                prompts.log.warn(`   Skill '${args.name}' not found in ${source.name}`)
                continue
              }

              // Check if skill needs update (unless force)
              const localSkill = lock.skills[args.name]
              if (localSkill && !args.force) {
                const needsUpdate = comparison.toUpdate.some((u) => u.remote.name === args.name)
                if (!needsUpdate) {
                  prompts.log.info(`   ${args.name} is up to date (v${localSkill.version})`)
                  continue
                }
              }
              toSync = [skill]
            } else if (args.force) {
              // Force mode: sync all skills
              toSync = index.skills
            } else {
              // Normal mode: only new and updated skills
              toSync = getSkillsToSync(comparison)
            }

            // Report warnings
            for (const { skill, message } of comparison.warnings) {
              prompts.log.warn(`   ⚠ ${skill.name}: ${message}`)
              results.warnings.push(`${skill.name}: ${message}`)
            }

            // Dry run - just report what would happen
            if (args.dryRun) {
              if (toSync.length === 0) {
                prompts.log.info("   All skills up to date")
              } else {
                for (const skill of toSync) {
                  const isNew = comparison.toAdd.some((s) => s.name === skill.name)
                  const action = isNew ? "add" : "update"
                  const localVersion = lock.skills[skill.name]?.version
                  const versionInfo = localVersion ? `${localVersion} → ${skill.version}` : skill.version
                  prompts.log.info(`   [dry-run] ${action}: ${skill.name} ${versionInfo}`)
                }
              }
              continue
            }

            // Download skills
            if (toSync.length === 0) {
              prompts.log.info("   All skills up to date")
              continue
            }

            spinner.start(`Downloading ${toSync.length} skill(s)...`)

            const downloads = await downloadSkills(source, toSync, config.settings, (done, total, current) => {
              spinner.message(`Downloading ${done}/${total}${current ? ` (${current})` : ""}...`)
            })

            spinner.stop("Downloads complete")

            // Process results
            const stats = getDownloadStats(downloads)
            const successful = getSuccessfulDownloads(downloads)

            // Build sync results for lock update
            const syncedSkills: SkillSyncResult[] = []
            const skillHashes: Record<string, string> = {}

            for (const download of successful) {
              const isNew = comparison.toAdd.some((s) => s.name === download.name)
              const localVersion = lock.skills[download.name]?.version

              const syncResult: SkillSyncResult = {
                name: download.name,
                version: download.version,
                source: source.name,
                previousVersion: isNew ? undefined : localVersion,
              }

              syncedSkills.push(syncResult)
              if (download.hash) {
                skillHashes[download.name] = download.hash
              }

              if (isNew) {
                results.added.push(syncResult)
                prompts.log.success(`   ✓ ${download.name} ${download.version} (new)`)
              } else {
                results.updated.push(syncResult)
                prompts.log.success(`   ✓ ${download.name} ${localVersion} → ${download.version}`)
              }
            }

            // Log failures
            for (const download of downloads.filter((d) => !d.success)) {
              const error: SkillSyncError = {
                name: download.name,
                source: source.name,
                error: download.error || "Unknown error",
              }
              results.failed.push(error)
              prompts.log.error(`   ✗ ${download.name}: ${download.error}`)
            }

            // Update lock file for skills
            if (syncedSkills.length > 0) {
              await updateLockAfterSync(source.name, source.url, "HEAD", syncedSkills, skillHashes)
              // Reload lock for next source
              lock = await loadLock()
            }

            // Report stats
            if (stats.failed > 0) {
              results.success = false
            }

            // ============================================================
            // Template sync
            // ============================================================
            const remoteTemplates = index.templates || []
            if (remoteTemplates.length > 0) {
              // Determine which templates need sync
              let templatesToSync: RemoteTemplateEntryParsed[]
              if (args.force) {
                templatesToSync = remoteTemplates
              } else {
                templatesToSync = remoteTemplates.filter((t) => templateNeedsUpdate(lock, t.name, t.version))
              }

              if (templatesToSync.length > 0) {
                if (args.dryRun) {
                  for (const template of templatesToSync) {
                    const localVersion = lock.templates?.[template.name]?.version
                    const isNew = !localVersion
                    const action = isNew ? "add" : "update"
                    const versionInfo = localVersion ? `${localVersion} → ${template.version}` : template.version
                    prompts.log.info(`   [dry-run] ${action} template: ${template.name} ${versionInfo}`)
                  }
                } else {
                  spinner.start(`Downloading ${templatesToSync.length} template(s)...`)

                  const templateDownloads = await downloadTemplates(
                    source,
                    templatesToSync,
                    config.settings,
                    (done, total, current) => {
                      spinner.message(`Downloading templates ${done}/${total}${current ? ` (${current})` : ""}...`)
                    },
                  )

                  spinner.stop("Template downloads complete")

                  // Process template results
                  const templateStats = getTemplateDownloadStats(templateDownloads)
                  const successfulTemplates = getSuccessfulTemplateDownloads(templateDownloads)

                  const syncedTemplates: TemplateSyncResult[] = []
                  const templateHashes: Record<string, string> = {}

                  for (const download of successfulTemplates) {
                    const localVersion = lock.templates?.[download.name]?.version
                    const isNew = !localVersion

                    syncedTemplates.push({
                      name: download.name,
                      version: download.version,
                      source: source.name,
                      previousVersion: isNew ? undefined : localVersion,
                    })

                    if (download.hash) {
                      templateHashes[download.name] = download.hash
                    }

                    if (isNew) {
                      prompts.log.success(`   ✓ template: ${download.name} ${download.version} (new)`)
                    } else {
                      prompts.log.success(`   ✓ template: ${download.name} ${localVersion} → ${download.version}`)
                    }
                  }

                  // Log template failures
                  for (const download of templateDownloads.filter((d) => !d.success)) {
                    prompts.log.error(`   ✗ template: ${download.name}: ${download.error}`)
                    results.warnings.push(`Template ${download.name}: ${download.error}`)
                  }

                  // Update lock file for templates
                  if (syncedTemplates.length > 0) {
                    await updateLockAfterTemplateSync(source.name, syncedTemplates, templateHashes)
                    lock = await loadLock()
                  }

                  if (templateStats.failed > 0) {
                    results.success = false
                  }
                }
              } else {
                prompts.log.info("   All templates up to date")
              }
            }
          }

          results.duration = Date.now() - startTime

          // Summary
          prompts.log.info("\n" + "─".repeat(50))
          prompts.log.info("Summary:")

          const totalChanges = results.added.length + results.updated.length
          if (totalChanges === 0 && results.failed.length === 0) {
            prompts.log.info("  Everything up to date")
          } else {
            if (results.added.length > 0) {
              prompts.log.success(`  ${results.added.length} new skill(s)`)
            }
            if (results.updated.length > 0) {
              prompts.log.success(`  ${results.updated.length} updated skill(s)`)
            }
            if (results.failed.length > 0) {
              prompts.log.error(`  ${results.failed.length} failed`)
            }
            if (results.warnings.length > 0) {
              prompts.log.warn(`  ${results.warnings.length} warning(s)`)
            }
          }

          const status = results.success ? "completed" : "completed with errors"
          prompts.outro(`Sync ${status} in ${(results.duration / 1000).toFixed(1)}s`)

          // Exit with error code if failures
          if (!results.success) {
            process.exitCode = 1
          }
        } catch (error) {
          spinner.stop("Sync failed")
          prompts.log.error(error instanceof Error ? error.message : String(error))
          prompts.outro("Sync failed")
          process.exitCode = 1
        }
      },
    })
  },
})
