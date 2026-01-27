/**
 * Workflow Command Entry Point
 * CLI commands for workflow skill management
 *
 * @module cli/cmd/workflow
 */

import { cmd } from "./cmd"
import { SyncCommand, ListCommand, InfoCommand, OutdatedCommand, SourceCommand } from "../../workflow/commands"

export const WorkflowCommand = cmd({
  command: "workflow",
  describe: "manage workflow skills from remote repositories",
  builder: (yargs) =>
    yargs
      .command(SyncCommand)
      .command(ListCommand)
      .command(InfoCommand)
      .command(OutdatedCommand)
      .command(SourceCommand)
      .demandCommand(1, "Please specify a subcommand"),
  async handler() {},
})
