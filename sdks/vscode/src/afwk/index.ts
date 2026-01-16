/**
 * AFWK Module - Entry Point
 * Automatic detection and management of AFWK project structure
 */

import * as vscode from 'vscode';
import { fetchAFWKSchema } from './schema';
import { validateProjectStructure } from './validator';
import { createFullStructure, completeMissingStructure } from './scaffolder';
import {
  showNoStructureDialog,
  showIncompleteStructureDialog,
  showStructureCreatedNotification,
  showStructureCompletedNotification,
  showErrorNotification,
  saveAFWKPreference,
  getAFWKPreference,
  createAFWKStatusBarItem,
  updateStatusBar
} from './dialog';
import type { ValidationResult, AFWKPreference } from './types';

// Re-export types for external use
export type { AFWKSchema, ValidationResult, AFWKPreference } from './types';
export { AFWK_PREFERENCE_KEY } from './types';

/**
 * Status bar item for AFWK status
 */
let statusBarItem: vscode.StatusBarItem | undefined;

/**
 * Current validation result
 */
let currentValidation: ValidationResult | null = null;

/**
 * Main function to check AFWK structure on workspace load
 * Should be called from extension.ts activate function
 *
 * @param context - Extension context for disposables
 * @returns Promise that resolves when check is complete
 */
export async function checkAFWKStructure(
  context: vscode.ExtensionContext
): Promise<void> {
  const workspaceRoot = getWorkspaceRoot();

  if (!workspaceRoot) {
    // No workspace open, nothing to check
    return;
  }

  // Create and register status bar item
  if (!statusBarItem) {
    statusBarItem = createAFWKStatusBarItem();
    context.subscriptions.push(statusBarItem);
  }

  // Check if user has already made a preference
  const preference = getAFWKPreference();

  if (preference === 'none') {
    // User chose to use without AFWK, respect that choice
    updateStatusBar(statusBarItem, null, 'none');
    return;
  }

  // Show loading state
  updateStatusBar(statusBarItem, null, 'pending');

  try {
    // Fetch schema (mock for now, GitHub in future)
    const schema = await fetchAFWKSchema();

    // Validate current structure
    const validation = await validateProjectStructure(workspaceRoot, schema);
    currentValidation = validation;

    // Update status bar
    updateStatusBar(statusBarItem, validation, preference);

    // Handle based on validation result
    if (validation.valid) {
      // Structure is complete, nothing to do
      return;
    }

    if (!validation.rootExists) {
      // No .afwk directory at all
      const dialogResult = await showNoStructureDialog(workspaceRoot);

      if (dialogResult.action === 'create') {
        const created = await createFullStructure(workspaceRoot, schema);
        showStructureCreatedNotification(created.length);

        // Re-validate and update status
        currentValidation = await validateProjectStructure(workspaceRoot, schema);
        updateStatusBar(statusBarItem, currentValidation, 'full');
        await saveAFWKPreference('full');
      } else if (dialogResult.action === 'skip' || dialogResult.action === 'none') {
        if (dialogResult.savePreference) {
          await saveAFWKPreference('none');
          updateStatusBar(statusBarItem, validation, 'none');
        }
      }
    } else {
      // .afwk exists but is incomplete
      const dialogResult = await showIncompleteStructureDialog(workspaceRoot, validation);

      if (dialogResult.action === 'complete') {
        const completed = await completeMissingStructure(
          workspaceRoot,
          schema,
          validation.missing
        );
        showStructureCompletedNotification(completed.length);

        // Re-validate and update status
        currentValidation = await validateProjectStructure(workspaceRoot, schema);
        updateStatusBar(statusBarItem, currentValidation, 'full');
        await saveAFWKPreference('full');
      } else if (dialogResult.action === 'none') {
        if (dialogResult.savePreference) {
          await saveAFWKPreference('none');
          updateStatusBar(statusBarItem, validation, 'none');
        }
      }
    }
  } catch (error) {
    showErrorNotification(error instanceof Error ? error : new Error(String(error)));
    if (statusBarItem) {
      statusBarItem.text = '$(error) AFWK: Error';
      statusBarItem.tooltip = `Error: ${error}`;
    }
  }
}

/**
 * Registers workspace change listener to re-check AFWK on folder changes
 */
export function registerWorkspaceListener(
  context: vscode.ExtensionContext
): void {
  const disposable = vscode.workspace.onDidChangeWorkspaceFolders(async () => {
    await checkAFWKStructure(context);
  });

  context.subscriptions.push(disposable);
}

/**
 * Command to manually trigger AFWK structure check
 */
export function registerCheckCommand(
  context: vscode.ExtensionContext
): void {
  const disposable = vscode.commands.registerCommand(
    'dipolecode.checkAFWK',
    async () => {
      // Reset preference to allow re-checking
      await saveAFWKPreference('pending');
      await checkAFWKStructure(context);
    }
  );

  context.subscriptions.push(disposable);
}

/**
 * Command to create AFWK structure manually
 */
export function registerCreateCommand(
  context: vscode.ExtensionContext
): void {
  const disposable = vscode.commands.registerCommand(
    'dipolecode.createAFWK',
    async () => {
      const workspaceRoot = getWorkspaceRoot();

      if (!workspaceRoot) {
        vscode.window.showErrorMessage('No hay un workspace abierto');
        return;
      }

      try {
        const schema = await fetchAFWKSchema();
        const created = await createFullStructure(workspaceRoot, schema);
        showStructureCreatedNotification(created.length);

        await saveAFWKPreference('full');

        // Update validation and status bar
        currentValidation = await validateProjectStructure(workspaceRoot, schema);
        if (statusBarItem) {
          updateStatusBar(statusBarItem, currentValidation, 'full');
        }
      } catch (error) {
        showErrorNotification(error instanceof Error ? error : new Error(String(error)));
      }
    }
  );

  context.subscriptions.push(disposable);
}

/**
 * Gets the current validation result
 */
export function getCurrentValidation(): ValidationResult | null {
  return currentValidation;
}

/**
 * Gets workspace root path
 */
function getWorkspaceRoot(): string | undefined {
  const folders = vscode.workspace.workspaceFolders;
  return folders && folders.length > 0 ? folders[0].uri.fsPath : undefined;
}

/**
 * Initializes all AFWK-related functionality
 * Call this from extension.ts activate function
 */
export async function initializeAFWK(
  context: vscode.ExtensionContext
): Promise<void> {
  // Register commands
  registerCheckCommand(context);
  registerCreateCommand(context);

  // Register workspace listener for folder changes
  registerWorkspaceListener(context);

  // Perform initial check
  await checkAFWKStructure(context);
}
