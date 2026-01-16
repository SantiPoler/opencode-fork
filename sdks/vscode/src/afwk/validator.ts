/**
 * AFWK Structure Validator
 * Recursively validates project structure against AFWK schema
 */

import * as vscode from 'vscode';
import * as path from 'path';
import type { AFWKSchema, AFWKDirectories, ValidationResult } from './types';

/**
 * Checks if a path exists in the filesystem
 */
async function pathExists(fsPath: string): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(vscode.Uri.file(fsPath));
    return true;
  } catch {
    return false;
  }
}

/**
 * Recursively collects all expected paths from the schema
 */
function collectExpectedPaths(
  directories: AFWKDirectories,
  basePath: string
): string[] {
  const paths: string[] = [];

  for (const [dirName, dirConfig] of Object.entries(directories)) {
    const dirPath = path.join(basePath, dirName);
    paths.push(dirPath);

    // Add files in this directory
    for (const fileName of Object.keys(dirConfig.files)) {
      paths.push(path.join(dirPath, fileName));
    }

    // Recursively add subdirectories
    if (dirConfig.directories) {
      paths.push(...collectExpectedPaths(dirConfig.directories, dirPath));
    }
  }

  return paths;
}

/**
 * Validates the project structure against the AFWK schema
 *
 * @param workspaceRoot - Root path of the workspace
 * @param schema - AFWK schema to validate against
 * @returns Validation result with missing and existing paths
 */
export async function validateProjectStructure(
  workspaceRoot: string,
  schema: AFWKSchema
): Promise<ValidationResult> {
  const rootPath = path.join(workspaceRoot, schema.root);

  // Check if root .afwk directory exists
  const rootExists = await pathExists(rootPath);

  if (!rootExists) {
    // If root doesn't exist, all paths are missing
    const allPaths = [rootPath, ...collectExpectedPaths(schema.directories, rootPath)];
    return {
      valid: false,
      rootExists: false,
      missing: allPaths,
      existing: [],
      totalExpected: allPaths.length
    };
  }

  // Collect all expected paths
  const expectedPaths = collectExpectedPaths(schema.directories, rootPath);
  const allPaths = [rootPath, ...expectedPaths];

  // Check each path
  const missing: string[] = [];
  const existing: string[] = [rootPath]; // Root already confirmed to exist

  for (const expectedPath of expectedPaths) {
    if (await pathExists(expectedPath)) {
      existing.push(expectedPath);
    } else {
      missing.push(expectedPath);
    }
  }

  return {
    valid: missing.length === 0,
    rootExists: true,
    missing,
    existing,
    totalExpected: allPaths.length
  };
}

/**
 * Gets a human-readable summary of the validation result
 */
export function getValidationSummary(result: ValidationResult): string {
  if (result.valid) {
    return `Estructura AFWK completa (${result.totalExpected} elementos verificados)`;
  }

  if (!result.rootExists) {
    return 'No se detectó estructura AFWK en este proyecto';
  }

  const percentage = Math.round((result.existing.length / result.totalExpected) * 100);
  return `Estructura AFWK incompleta: ${result.existing.length}/${result.totalExpected} elementos (${percentage}%)`;
}

/**
 * Formats missing paths for display in dialog
 * Returns relative paths from workspace root
 */
export function formatMissingPaths(
  workspaceRoot: string,
  missingPaths: string[],
  maxDisplay: number = 5
): string {
  const relativePaths = missingPaths.map(p =>
    path.relative(workspaceRoot, p).replace(/\\/g, '/')
  );

  if (relativePaths.length <= maxDisplay) {
    return relativePaths.map(p => `• ${p}`).join('\n');
  }

  const displayed = relativePaths.slice(0, maxDisplay);
  const remaining = relativePaths.length - maxDisplay;

  return [
    ...displayed.map(p => `• ${p}`),
    `• ...y ${remaining} más`
  ].join('\n');
}
