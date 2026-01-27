/**
 * AFWK Staging Handler
 * Handles document staging events from the TUI server
 * Opens staged files for user review and manages confirm/cancel workflow
 */

import * as vscode from 'vscode';
import * as path from 'path';

let outputChannel: vscode.OutputChannel | null = null;
let outputChannelRegistered = false;

function getOutputChannel(context?: vscode.ExtensionContext): vscode.OutputChannel {
  if (!outputChannel) {
    outputChannel = vscode.window.createOutputChannel('dipoleCODE');
  }
  if (context && !outputChannelRegistered) {
    context.subscriptions.push(outputChannel);
    outputChannelRegistered = true;
  }
  return outputChannel;
}

export function initializeStagingOutputChannel(context: vscode.ExtensionContext): void {
  getOutputChannel(context);
}

function formatLogArgs(args: unknown[]): string {
  if (!args.length) {
    return '';
  }
  return args
    .map((arg) => {
      if (typeof arg === 'string') {
        return arg;
      }
      try {
        return JSON.stringify(arg);
      } catch {
        return String(arg);
      }
    })
    .join(' ');
}

export function log(message: string, ...args: unknown[]): void {
  const channel = getOutputChannel();
  const suffix = formatLogArgs(args);
  const line = suffix ? `[INFO] ${message} ${suffix}` : `[INFO] ${message}`;
  channel.appendLine(line);
}

export function logError(message: string, ...args: unknown[]): void {
  const channel = getOutputChannel();
  const suffix = formatLogArgs(args);
  const line = suffix ? `[ERROR] ${message} ${suffix}` : `[ERROR] ${message}`;
  channel.appendLine(line);
}

export function logWarn(message: string, ...args: unknown[]): void {
  const channel = getOutputChannel();
  const suffix = formatLogArgs(args);
  const line = suffix ? `[WARN] ${message} ${suffix}` : `[WARN] ${message}`;
  channel.appendLine(line);
}

/**
 * Staging review event payload (matches TuiEvent.StagingReview)
 */
export interface StagingReviewEvent {
  stagingId: string;
  stagedPath: string;
  finalPath: string;
  documentType: 'devtask-overview' | 'aitask-blueprint' | 'completion-notes' | 'document-update';
  expiresAt: string;
}

/**
 * Handle a file open event from the TUI server
 * Opens a file directly in the editor (no staging, no confirmation needed)
 */
export async function handleFileOpen(
  event: { filePath: string; reason?: string },
  workspaceRoot: string
): Promise<void> {
  log('[dipoleCODE] Opening file:', event.filePath);

  try {
    // Build full path to file
    const fullPath = path.join(workspaceRoot, event.filePath);
    log('[dipoleCODE] Full path:', fullPath);

    // Open the file in editor
    const uri = vscode.Uri.file(fullPath);
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc, {
      preview: false,
      viewColumn: vscode.ViewColumn.One,
    });

    // Show notification if reason provided
    if (event.reason) {
      vscode.window.showInformationMessage(`dipoleCODE: ${event.reason}`);
    }

    log('[dipoleCODE] File opened successfully');
  } catch (error) {
    logError('[dipoleCODE] Error opening file:', error);
    vscode.window.showErrorMessage(
      `dipoleCODE: Error opening file: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Handle a staging review event from the TUI server
 * Opens the staged file in the editor for user review
 */
export async function handleStagingReview(
  port: number,
  event: StagingReviewEvent,
  workspaceRoot: string
): Promise<void> {
  log('[dipoleCODE] Handling staging review:', event.stagingId);
  log('[dipoleCODE] Staged path:', event.stagedPath);
  log('[dipoleCODE] Workspace root:', workspaceRoot);

  try {
    // Build full path to staged file within .afwk/
    const fullStagedPath = path.join(workspaceRoot, '.afwk', event.stagedPath);
    log('[dipoleCODE] Full staged path:', fullStagedPath);

    // Open the staged file in editor
    const uri = vscode.Uri.file(fullStagedPath);
    log('[dipoleCODE] Opening URI:', uri.fsPath);
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc, {
      preview: false,
      viewColumn: vscode.ViewColumn.One,
    });
    log('[dipoleCODE] Document opened successfully');
  } catch (error) {
    logError('[dipoleCODE] Error handling staging review:', error);
    vscode.window.showErrorMessage(
      `dipoleCODE: Error opening staged document: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * SSE connection state
 */
let sseAbortController: AbortController | null = null;
let ssePort: number | null = null;

/**
 * Start listening for staging events via SSE using fetch streaming
 * Should be called after terminal is connected to server
 */
export function startStagingEventListener(
  port: number,
  workspaceRoot: string,
  context: vscode.ExtensionContext
): void {
  getOutputChannel(context);
  // Avoid duplicate connections
  if (sseAbortController && ssePort === port) {
    return;
  }

  // Close existing connection if port changed
  stopStagingEventListener();

  sseAbortController = new AbortController();
  ssePort = port;

  // Start SSE connection in background
  startSSEConnection(port, workspaceRoot, sseAbortController.signal).catch((error) => {
    logError('[dipoleCODE] SSE connection failed:', error);
  });

  // Add cleanup on extension deactivation
  context.subscriptions.push({
    dispose: () => stopStagingEventListener(),
  });

  log('[dipoleCODE] Staging event listener started on port', port);
}

/**
 * Start SSE connection using fetch with streaming
 */
async function startSSEConnection(
  port: number,
  workspaceRoot: string,
  signal: AbortSignal
): Promise<void> {
  let attempt = 0;
  let reviewChain = Promise.resolve();

  while (!signal.aborted) {
    try {
      const response = await fetch(`http://localhost:${port}/event`, {
        headers: {
          'Accept': 'text/event-stream',
          'Cache-Control': 'no-cache',
        },
        signal,
      });

      if (!response.ok || !response.body) {
        throw new Error(`SSE connection failed with status ${response.status}`);
      }

      attempt = 0;
      log('[dipoleCODE] SSE connected');

      const decoder = new TextDecoder();
      let buffer = '';
      const stream = response.body as unknown as AsyncIterable<Uint8Array>;

      for await (const chunk of stream) {
        buffer += decoder.decode(chunk, { stream: true });

        // Process complete SSE messages (separated by double newline)
        const messages = buffer.split(/\r?\n\r?\n/);
        buffer = messages.pop() || ''; // Keep incomplete message in buffer

        for (const message of messages) {
          if (!message.trim()) continue;

          const dataLines = message
            .split(/\r?\n/)
            .filter((line) => line.startsWith('data:'))
            .map((line) => line.slice(5).trimStart());

          if (!dataLines.length) continue;

          const dataPayload = dataLines.join('\n');

          try {
            const data = JSON.parse(dataPayload);
            if (data?.type === 'server.heartbeat') {
              continue;
            }
            log('[dipoleCODE] SSE event received:', data?.type);

            if (data?.type === 'tui.staging.review') {
              log('[dipoleCODE] Staging review event detected!');
              const stagingEvent = data.properties as StagingReviewEvent;
              reviewChain = reviewChain
                .then(() => handleStagingReview(port, stagingEvent, workspaceRoot))
                .catch((error) => {
                  logError('[dipoleCODE] Failed to handle staging review:', error);
                });
            }

            // Handle file open events (non-staging, direct file opening)
            if (data?.type === 'tui.file.open') {
              log('[dipoleCODE] File open event detected!');
              const fileOpenEvent = data.properties as { filePath: string; reason?: string };
              handleFileOpen(fileOpenEvent, workspaceRoot).catch((error) => {
                logError('[dipoleCODE] Failed to open file:', error);
              });
            }
          } catch {
            // Ignore parse errors for non-JSON messages
          }
        }
      }

      if (!signal.aborted) {
        log('[dipoleCODE] SSE connection closed');
      }
    } catch (error) {
      if (signal.aborted) {
        log('[dipoleCODE] SSE connection aborted');
        break;
      }
      logError('[dipoleCODE] SSE connection error:', error);
    }

    if (signal.aborted) {
      break;
    }

    const delayMs = Math.min(1000 * Math.pow(2, attempt), 10000);
    attempt += 1;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
}

/**
 * Stop the staging event listener
 */
export function stopStagingEventListener(): void {
  if (sseAbortController) {
    sseAbortController.abort();
    sseAbortController = null;
    ssePort = null;
    log('[dipoleCODE] Staging event listener stopped');
  }
}
