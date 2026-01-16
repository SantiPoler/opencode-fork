/**
 * AFWK Structure Scaffolder
 * Creates missing directories and files for AFWK structure
 */

import * as vscode from 'vscode';
import * as path from 'path';
import type { AFWKSchema, AFWKDirectories, AFWKDirectory } from './types';

/**
 * Default content for newly created files
 */
const DEFAULT_FILE_CONTENT = '# Hola mundo!\n\nEste archivo fue creado automáticamente por dipoleCODE.\n';

/**
 * Creates a directory if it doesn't exist
 */
async function ensureDirectory(dirPath: string): Promise<void> {
  try {
    await vscode.workspace.fs.createDirectory(vscode.Uri.file(dirPath));
  } catch (error) {
    // Directory might already exist, which is fine
    const exists = await pathExists(dirPath);
    if (!exists) {
      throw error;
    }
  }
}

/**
 * Checks if a path exists
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
 * Creates a file with default content if it doesn't exist
 */
async function ensureFile(filePath: string, description: string): Promise<void> {
  if (await pathExists(filePath)) {
    return;
  }

  const content = `# ${path.basename(filePath)}\n\n${description}\n\n---\n\n# Hola mundo!\n\nEste archivo fue creado automáticamente por dipoleCODE.\n`;
  const encoder = new TextEncoder();
  await vscode.workspace.fs.writeFile(
    vscode.Uri.file(filePath),
    encoder.encode(content)
  );
}

/**
 * Recursively creates directory structure and files
 */
async function scaffoldDirectories(
  directories: AFWKDirectories,
  basePath: string,
  createdPaths: string[]
): Promise<void> {
  for (const [dirName, dirConfig] of Object.entries(directories)) {
    const dirPath = path.join(basePath, dirName);

    // Create directory
    await ensureDirectory(dirPath);
    createdPaths.push(dirPath);

    // Create files in this directory
    for (const [fileName, fileDescription] of Object.entries(dirConfig.files)) {
      const filePath = path.join(dirPath, fileName);
      await ensureFile(filePath, fileDescription);
      createdPaths.push(filePath);
    }

    // Recursively create subdirectories
    if (dirConfig.directories) {
      await scaffoldDirectories(dirConfig.directories, dirPath, createdPaths);
    }
  }
}

/**
 * Creates the complete AFWK structure from scratch
 *
 * @param workspaceRoot - Root path of the workspace
 * @param schema - AFWK schema to create
 * @returns List of created paths
 */
export async function createFullStructure(
  workspaceRoot: string,
  schema: AFWKSchema
): Promise<string[]> {
  const rootPath = path.join(workspaceRoot, schema.root);
  const createdPaths: string[] = [];

  // Create root directory
  await ensureDirectory(rootPath);
  createdPaths.push(rootPath);

  // Create all subdirectories and files
  await scaffoldDirectories(schema.directories, rootPath, createdPaths);

  return createdPaths;
}

/**
 * Creates only the missing parts of the AFWK structure
 *
 * @param workspaceRoot - Root path of the workspace
 * @param schema - AFWK schema to complete
 * @param missingPaths - List of paths that need to be created
 * @returns List of actually created paths
 */
export async function completeMissingStructure(
  workspaceRoot: string,
  schema: AFWKSchema,
  missingPaths: string[]
): Promise<string[]> {
  const createdPaths: string[] = [];
  const rootPath = path.join(workspaceRoot, schema.root);

  // Sort paths to ensure parent directories are created before children
  const sortedPaths = [...missingPaths].sort((a, b) => a.length - b.length);

  // Build a map of file descriptions from schema
  const fileDescriptions = buildFileDescriptionMap(schema, rootPath);

  for (const missingPath of sortedPaths) {
    const isFile = path.extname(missingPath) !== '';

    if (isFile) {
      // Ensure parent directory exists
      const parentDir = path.dirname(missingPath);
      await ensureDirectory(parentDir);

      // Create file with description if available
      const description = fileDescriptions.get(missingPath) || 'Archivo del proyecto';
      await ensureFile(missingPath, description);
    } else {
      // Create directory
      await ensureDirectory(missingPath);
    }

    createdPaths.push(missingPath);
  }

  return createdPaths;
}

/**
 * Builds a map of file paths to their descriptions from the schema
 */
function buildFileDescriptionMap(
  schema: AFWKSchema,
  rootPath: string
): Map<string, string> {
  const map = new Map<string, string>();

  function traverse(directories: AFWKDirectories, basePath: string): void {
    for (const [dirName, dirConfig] of Object.entries(directories)) {
      const dirPath = path.join(basePath, dirName);

      for (const [fileName, description] of Object.entries(dirConfig.files)) {
        map.set(path.join(dirPath, fileName), description);
      }

      if (dirConfig.directories) {
        traverse(dirConfig.directories, dirPath);
      }
    }
  }

  traverse(schema.directories, rootPath);
  return map;
}

/**
 * Removes the AFWK structure (for testing/reset purposes)
 * USE WITH CAUTION - this deletes files!
 */
export async function removeStructure(
  workspaceRoot: string,
  schema: AFWKSchema
): Promise<void> {
  const rootPath = path.join(workspaceRoot, schema.root);

  if (await pathExists(rootPath)) {
    await vscode.workspace.fs.delete(vscode.Uri.file(rootPath), { recursive: true });
  }
}
