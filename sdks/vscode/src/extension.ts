// This method is called when your extension is deactivated
export function deactivate() {}

import * as vscode from "vscode"
import * as path from "path"
import * as fs from "fs"
import * as os from "os"
import { initializeAFWK } from "./afwk"
import { initializeModalProvider } from "./ui/modal"
import { initializeStagingOutputChannel, startStagingEventListener, log, logError } from "./afwk/staging"
import { createDevTaskUriHandler } from "./devtask"

const TERMINAL_NAME = "dipoleCODE"
const terminalPortMap = new WeakMap<vscode.Terminal, number>()

/**
 * Get the path to the bundled dipoleCODE binary.
 * Throws an error if the binary is not found - no fallback to PATH.
 */
function getBinaryPath(extensionPath: string): string {
  const platform = os.platform()
  const arch = os.arch()

  // Map Node.js platform/arch to binary names
  let binaryName: string
  if (platform === "win32") {
    binaryName = `opencode-win32-${arch === "arm64" ? "arm64" : "x64"}.exe`
  } else if (platform === "darwin") {
    binaryName = `opencode-darwin-${arch === "arm64" ? "arm64" : "x64"}`
  } else {
    // Linux
    binaryName = `opencode-linux-${arch === "arm64" ? "arm64" : "x64"}`
  }

  const bundledPath = path.join(extensionPath, "bin", binaryName)

  // Check if bundled binary exists
  if (fs.existsSync(bundledPath)) {
    log(`Using bundled binary: ${bundledPath}`)
    return bundledPath
  }

  // No fallback - fail explicitly if binary not found
  const errorMsg = `Bundled binary not found at ${bundledPath}. Platform: ${platform}, Arch: ${arch}`
  logError(errorMsg)
  throw new Error(errorMsg)
}

export async function activate(context: vscode.ExtensionContext) {
  initializeStagingOutputChannel(context)
  // Initialize the custom modal system
  initializeModalProvider({ extensionUri: context.extensionUri })

  // Initialize AFWK structure detection
  await initializeAFWK(context)

  // Register URI handler for devTASK operations (dipolestudio://devtask?...)
  const uriHandler = createDevTaskUriHandler()
  context.subscriptions.push(vscode.window.registerUriHandler(uriHandler))
  log("URI handler registered for dipolestudio:// protocol")

  let panel: vscode.WebviewPanel | undefined
  let panelPort: number | undefined

  let openNewTerminalDisposable = vscode.commands.registerCommand("dipolecode.openNewTerminal", async () => {
    await openTerminal()
  })

  let openTerminalDisposable = vscode.commands.registerCommand("dipolecode.openTerminal", async () => {
    // A dipoleCODE terminal already exists => focus it
    const existingTerminal = vscode.window.terminals.find((t) => t.name === TERMINAL_NAME)
    if (existingTerminal) {
      existingTerminal.show()
      return
    }

    await openTerminal()
  })

  let addFilepathDisposable = vscode.commands.registerCommand("dipolecode.addFilepathToTerminal", async () => {
    const fileRef = getActiveFile()
    if (!fileRef) {
      return
    }

    const terminal = vscode.window.activeTerminal
    if (!terminal) {
      return
    }

    if (terminal.name === TERMINAL_NAME) {
      // @ts-ignore
      const portStr = terminal.creationOptions.env?.["_EXTENSION_DIPOLECODE_PORT"]
      if (portStr) {
        const port = parseInt(portStr)
        await appendPrompt(port, fileRef)

        // Ensure staging listener is running
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
        if (workspaceFolder) {
          startStagingEventListener(port, workspaceFolder, context)
        }
      } else {
        terminal.sendText(fileRef, false)
      }
      terminal.show()
    }
  })

  // Register an empty tree data provider for the sidebar view
  // The actual click is intercepted by dipoleSTUDIO's paneCompositeBar.ts
  // to directly open the terminal instead of showing a panel
  const emptyTreeDataProvider = vscode.window.registerTreeDataProvider("dipolecode.sidebar", {
    getTreeItem: () => { throw new Error("Not implemented") },
    getChildren: () => []
  })

  // Listen for any dipoleCODE terminal creation (including from dipoleSTUDIO sidebar)
  const terminalOpenDisposable = vscode.window.onDidOpenTerminal(async (terminal) => {
    if (terminal.name !== TERMINAL_NAME) {
      return
    }

    log("Terminal created, waiting for server...")

    const port = getTerminalPort(terminal)
    if (!port) {
      logError("No port found in terminal environment")
      return
    }

    const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath

    if (!workspaceFolder) {
      logError("No workspace folder found")
      return
    }

    startStagingEventListener(port, workspaceFolder, context)

    // Wait for server to be ready
    const connected = await waitForServer(port)
    if (connected) {
      log("Server connected on port", port)
    } else {
      logError("Failed to connect to server on port", port)
    }
  })

  context.subscriptions.push(openTerminalDisposable, openNewTerminalDisposable, addFilepathDisposable, emptyTreeDataProvider, terminalOpenDisposable)

  log("Extension activated successfully")

  const existingWorkspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
  const lastPort = context.globalState.get<number>("dipolecode.lastPort")
  if (existingWorkspace && lastPort) {
    startStagingEventListener(lastPort, existingWorkspace, context)
  }

  for (const terminal of vscode.window.terminals) {
    if (terminal.name !== TERMINAL_NAME) {
      continue
    }
    const port = getTerminalPort(terminal)
    if (port && existingWorkspace) {
      startStagingEventListener(port, existingWorkspace, context)
    }
  }

  async function openTerminal() {
    // Create a new terminal in split screen
    const { terminal, port } = ensureTerminal({
      show: true,
      location: { viewColumn: vscode.ViewColumn.Beside, preserveFocus: false },
    })

    const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
    if (workspaceFolder) {
      startStagingEventListener(port, workspaceFolder, context)
    }

    const connected = await waitForServer(port)

    // If connected, append the prompt to the terminal
    if (connected) {
      const fileRef = getActiveFile()
      if (fileRef) {
        await appendPrompt(port, `In ${fileRef}`)
      }
      terminal.show()

      // Start listening for staging events
    }
  }

  async function openPanel() {
    if (panel) {
      panel.reveal(vscode.ViewColumn.Active, false)
      return
    }

    const { port } = ensureTerminal({
      show: false,
      location: { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
    })

    panelPort = port
    panel = vscode.window.createWebviewPanel(
      "dipolecode.panel",
      "dipoleCODE",
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      }
    )

    panel.iconPath = vscode.Uri.file(context.asAbsolutePath("images/icon.png"))
    panel.webview.html = getPanelHtml(port)

    panel.onDidDispose(() => {
      panel = undefined
      panelPort = undefined
    })

    await waitForServer(port)
    if (panel && panelPort === port) {
      panel.webview.html = getPanelHtml(port)
    }
  }

  async function appendPrompt(port: number, text: string) {
    await fetch(`http://localhost:${port}/tui/append-prompt`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text }),
    })
  }

  function ensureTerminal(options: {
    show: boolean
    location:
      | vscode.TerminalLocation
      | vscode.TerminalEditorLocationOptions
      | vscode.TerminalSplitLocationOptions
  }): { terminal: vscode.Terminal; port: number } {
    const existingTerminal = vscode.window.terminals.find((t) => t.name === TERMINAL_NAME)
    if (existingTerminal) {
      const port = getTerminalPort(existingTerminal)
      if (port) {
        if (options.show) {
          existingTerminal.show()
        }
        return { terminal: existingTerminal, port }
      }
    }

    const port = Math.floor(Math.random() * (65535 - 16384 + 1)) + 16384

    // Get the current workspace folder to pass as project directory
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath

    // Build shell args: opencode [project] --port <port>
    const shellArgs: string[] = []
    if (workspaceFolder) {
      shellArgs.push(workspaceFolder)
    }
    shellArgs.push("--port", port.toString())

    const terminal = vscode.window.createTerminal({
      name: TERMINAL_NAME,
      shellPath: getBinaryPath(context.extensionPath),
      shellArgs,
      cwd: workspaceFolder,
      iconPath: new vscode.ThemeIcon("terminal"),
      location: options.location,
      env: {
        _EXTENSION_DIPOLECODE_PORT: port.toString(),
        DIPOLECODE_CALLER: "vscode",
      },
    })
    terminalPortMap.set(terminal, port)
    context.globalState.update("dipolecode.lastPort", port)

    if (options.show) {
      terminal.show()
    }

    return { terminal, port }
  }

  function getTerminalPort(terminal: vscode.Terminal): number | undefined {
    const mappedPort = terminalPortMap.get(terminal)
    if (mappedPort) {
      return mappedPort
    }
    // @ts-ignore
    const port = terminal.creationOptions?.env?.["_EXTENSION_DIPOLECODE_PORT"]
    return port ? Number(port) : undefined
  }

  async function waitForServer(port: number, timeoutMs: number = 10000) {
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
      await new Promise((resolve) => setTimeout(resolve, 200))
      try {
        await fetch(`http://localhost:${port}/app`)
        return true
      } catch (e) {}
    }

    return false
  }

  function getPanelHtml(port: number) {
    const appUrl = `http://localhost:${port}/app`
    const csp = [
      "default-src 'none'",
      "style-src 'unsafe-inline'",
      "frame-src http://localhost:* http://127.0.0.1:*",
    ].join("; ")

    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="${csp}" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>dipoleCODE</title>
    <style>
      html, body, iframe {
        width: 100%;
        height: 100%;
        padding: 0;
        margin: 0;
        border: 0;
        background: #000;
      }
    </style>
  </head>
  <body>
    <iframe src="${appUrl}" title="dipoleCODE"></iframe>
  </body>
</html>`
  }

  function getActiveFile() {
    const activeEditor = vscode.window.activeTextEditor
    if (!activeEditor) {
      return
    }

    const document = activeEditor.document
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri)
    if (!workspaceFolder) {
      return
    }

    // Get the relative path from workspace root
    const relativePath = vscode.workspace.asRelativePath(document.uri)
    let filepathWithAt = `@${relativePath}`

    // Check if there's a selection and add line numbers
    const selection = activeEditor.selection
    if (!selection.isEmpty) {
      // Convert to 1-based line numbers
      const startLine = selection.start.line + 1
      const endLine = selection.end.line + 1

      if (startLine === endLine) {
        // Single line selection
        filepathWithAt += `#L${startLine}`
      } else {
        // Multi-line selection
        filepathWithAt += `#L${startLine}-${endLine}`
      }
    }

    return filepathWithAt
  }
}
