/**
 * DevTask Handler Module
 * Handles incoming devTASK URIs from the web application
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { log, logError } from '../afwk/staging';

/**
 * DevTask URI parameters
 */
interface DevTaskParams {
  identifier: string;
  title?: string;
}

/**
 * Parses the query string from a URI
 */
function parseQueryParams(query: string): DevTaskParams {
  const params = new URLSearchParams(query);
  return {
    identifier: params.get('identifier') || '',
    title: params.get('title') || undefined,
  };
}

/**
 * Ensures a directory exists, creating it if necessary
 */
async function ensureDirectory(dirPath: string): Promise<void> {
  try {
    await vscode.workspace.fs.createDirectory(vscode.Uri.file(dirPath));
  } catch (error) {
    // Directory might already exist, which is fine
    try {
      await vscode.workspace.fs.stat(vscode.Uri.file(dirPath));
    } catch {
      throw error;
    }
  }
}

/**
 * Reads text from the system clipboard
 */
async function readClipboard(): Promise<string> {
  return await vscode.env.clipboard.readText();
}

/**
 * Validates that the clipboard content looks like a devTASK JSON
 */
function validateDevTaskJson(content: string): boolean {
  try {
    const parsed = JSON.parse(content);
    // Check for expected structure
    return (
      parsed &&
      typeof parsed === 'object' &&
      parsed.itemInfo &&
      typeof parsed.itemInfo.identifier === 'string'
    );
  } catch {
    return false;
  }
}

/**
 * Creates a devTASK file in the AFWK backlog directory
 */
export async function createDevTaskFile(
  identifier: string,
  jsonContent: string
): Promise<vscode.Uri | null> {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

  if (!workspaceFolder) {
    vscode.window.showErrorMessage(
      'No workspace folder open. Please open a folder first.'
    );
    return null;
  }

  // Create the backlog directory path
  const backlogDir = path.join(workspaceFolder, '.afwk', 'kanban', 'backlog');

  try {
    // Ensure the directory structure exists
    await ensureDirectory(path.join(workspaceFolder, '.afwk'));
    await ensureDirectory(path.join(workspaceFolder, '.afwk', 'kanban'));
    await ensureDirectory(backlogDir);

    // Create the file path
    const fileName = `${identifier}.json`;
    const filePath = path.join(backlogDir, fileName);
    const fileUri = vscode.Uri.file(filePath);

    // Check if file already exists
    let fileExists = false;
    try {
      await vscode.workspace.fs.stat(fileUri);
      fileExists = true;
    } catch {
      // File doesn't exist, which is expected
    }

    if (fileExists) {
      // Ask user what to do
      const action = await vscode.window.showWarningMessage(
        `File "${fileName}" already exists in backlog. What would you like to do?`,
        'Overwrite',
        'Open Existing',
        'Cancel'
      );

      if (action === 'Cancel' || !action) {
        return null;
      }

      if (action === 'Open Existing') {
        return fileUri;
      }
      // If 'Overwrite', continue with writing
    }

    // Format the JSON nicely
    let formattedJson: string;
    try {
      const parsed = JSON.parse(jsonContent);
      formattedJson = JSON.stringify(parsed, null, 2);
    } catch {
      formattedJson = jsonContent;
    }

    // Write the file
    const encoder = new TextEncoder();
    await vscode.workspace.fs.writeFile(fileUri, encoder.encode(formattedJson));

    log(`Created devTASK file: ${filePath}`);
    return fileUri;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logError(`Failed to create devTASK file: ${errorMessage}`);
    vscode.window.showErrorMessage(
      `Failed to create devTASK file: ${errorMessage}`
    );
    return null;
  }
}

/**
 * Handles incoming devTASK URIs
 * Expected format: dipolestudio://devtask?identifier=xxx-xxx-devTASK
 */
export async function handleDevTaskUri(uri: vscode.Uri): Promise<void> {
  log(`Handling devTASK URI: ${uri.toString()}`);

  // Parse parameters
  const params = parseQueryParams(uri.query);

  if (!params.identifier) {
    vscode.window.showErrorMessage(
      'Invalid devTASK URI: missing identifier parameter'
    );
    return;
  }

  // Show progress notification
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'Creating devTASK...',
      cancellable: false,
    },
    async (progress) => {
      progress.report({ message: 'Reading from clipboard...' });

      // Read JSON from clipboard
      const clipboardContent = await readClipboard();

      if (!clipboardContent) {
        vscode.window.showErrorMessage(
          'Clipboard is empty. Please copy the devTASK JSON first.'
        );
        return;
      }

      // Validate the JSON
      if (!validateDevTaskJson(clipboardContent)) {
        vscode.window.showErrorMessage(
          'Clipboard does not contain valid devTASK JSON. Please use "Copy JSON" from the web app first.'
        );
        return;
      }

      // Verify the identifier matches
      try {
        const parsed = JSON.parse(clipboardContent);
        const clipboardIdentifier = parsed.itemInfo?.identifier;

        if (clipboardIdentifier !== params.identifier) {
          const proceed = await vscode.window.showWarningMessage(
            `The clipboard contains a different devTASK (${clipboardIdentifier}). Continue anyway?`,
            'Yes',
            'No'
          );

          if (proceed !== 'Yes') {
            return;
          }
        }
      } catch {
        // If we can't parse, we already validated above, so continue
      }

      progress.report({ message: 'Creating file...' });

      // Create the file
      const fileUri = await createDevTaskFile(params.identifier, clipboardContent);

      if (fileUri) {
        progress.report({ message: 'Opening file...' });

        // Open the file in the editor
        const document = await vscode.workspace.openTextDocument(fileUri);
        await vscode.window.showTextDocument(document, {
          preview: false,
          viewColumn: vscode.ViewColumn.One,
        });

        // Show success message
        vscode.window.showInformationMessage(
          `devTASK "${params.identifier}" created successfully in backlog.`
        );
      }
    }
  );
}

/**
 * Creates the URI handler for devTASK operations
 */
export function createDevTaskUriHandler(): vscode.UriHandler {
  return {
    async handleUri(uri: vscode.Uri): Promise<void> {
      log(`URI received: ${uri.toString()}`);

      // Handle devtask path
      if (uri.path === '/devtask' || uri.path === 'devtask') {
        await handleDevTaskUri(uri);
      } else {
        log(`Unknown URI path: ${uri.path}`);
      }
    },
  };
}
