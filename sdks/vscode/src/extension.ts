// This method is called when your extension is deactivated
export function deactivate() {}

import * as vscode from "vscode"
import { initializeAFWK } from "./afwk"
import { initializeModalProvider } from "./ui/modal"

const TERMINAL_NAME = "dipoleCODE"

export async function activate(context: vscode.ExtensionContext) {
  // Initialize the custom modal system
  initializeModalProvider({ extensionUri: context.extensionUri })

  // Initialize AFWK structure detection
  await initializeAFWK(context)
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
      const port = terminal.creationOptions.env?.["_EXTENSION_DIPOLECODE_PORT"]
      port ? await appendPrompt(parseInt(port), fileRef) : terminal.sendText(fileRef, false)
      terminal.show()
    }
  })

  const sidebarProvider = vscode.window.registerWebviewViewProvider("dipolecode.sidebar", {
    resolveWebviewView: async (view) => {
      view.webview.options = { enableScripts: true }
      view.webview.html = getSidebarHtml()

      const openIfVisible = () => {
        if (view.visible) {
          void openTerminalAsEditorTab()
        }
      }

      openIfVisible()
      view.onDidChangeVisibility(openIfVisible)
    },
  })

  context.subscriptions.push(openTerminalDisposable, openNewTerminalDisposable, addFilepathDisposable, sidebarProvider)

  async function openTerminal() {
    // Create a new terminal in split screen
    const { terminal, port } = ensureTerminal({
      show: true,
      location: { viewColumn: vscode.ViewColumn.Beside, preserveFocus: false },
    })

    const fileRef = getActiveFile()
    if (!fileRef) {
      return
    }

    const connected = await waitForServer(port)

    // If connected, append the prompt to the terminal
    if (connected) {
      await appendPrompt(port, `In ${fileRef}`)
      terminal.show()
    }
  }

  async function openTerminalAsEditorTab() {
    // Create or focus terminal as a full editor tab (not split)
    const { terminal, port } = ensureTerminal({
      show: true,
      location: vscode.TerminalLocation.Editor,
    })

    await waitForServer(port)
    terminal.show()
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
      shellPath: "opencode",
      shellArgs,
      cwd: workspaceFolder,
      iconPath: new vscode.ThemeIcon("terminal"),
      location: options.location,
      env: {
        _EXTENSION_DIPOLECODE_PORT: port.toString(),
        DIPOLECODE_CALLER: "vscode",
      },
    })

    if (options.show) {
      terminal.show()
    }

    return { terminal, port }
  }

  function getTerminalPort(terminal: vscode.Terminal): number | undefined {
    // @ts-ignore
    const port = terminal.creationOptions?.env?.["_EXTENSION_DIPOLECODE_PORT"]
    return port ? Number(port) : undefined
  }

  async function waitForServer(port: number) {
    let tries = 10
    let connected = false
    do {
      await new Promise((resolve) => setTimeout(resolve, 200))
      try {
        await fetch(`http://localhost:${port}/app`)
        connected = true
        break
      } catch (e) {}

      tries--
    } while (tries > 0)

    return connected
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

  function getSidebarHtml() {
    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <style>
      body {
        font-family: var(--vscode-font-family);
        color: var(--vscode-foreground);
        padding: 12px;
      }
      .hint {
        opacity: 0.8;
        font-size: 12px;
        line-height: 1.4;
      }
    </style>
  </head>
  <body>
    <div class="hint">dipoleCODE se abre como terminal en una pestaña completa.</div>
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
