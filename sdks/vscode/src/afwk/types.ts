/**
 * AFWK Structure Detection Types
 * TypeScript interfaces for the AFWK project schema
 */

/**
 * Represents a file entry in the AFWK schema
 * Key is filename, value is description
 */
export interface AFWKFiles {
  [filename: string]: string;
}

/**
 * Represents a directory entry in the AFWK schema
 */
export interface AFWKDirectory {
  description: string;
  files: AFWKFiles;
  directories?: AFWKDirectories;
}

/**
 * Map of directory names to their configurations
 */
export interface AFWKDirectories {
  [dirname: string]: AFWKDirectory;
}

/**
 * Root schema structure fetched from GitHub (or mock)
 */
export interface AFWKSchema {
  version: string;
  root: string;
  directories: AFWKDirectories;
}

/**
 * Result of structure validation
 */
export interface ValidationResult {
  /** Whether the structure is completely valid */
  valid: boolean;
  /** Whether the root .afwk directory exists */
  rootExists: boolean;
  /** List of missing file/directory paths */
  missing: string[];
  /** List of existing file/directory paths */
  existing: string[];
  /** Total expected items count */
  totalExpected: number;
}

/**
 * User preference for AFWK integration
 */
export type AFWKPreference = 'full' | 'none' | 'pending';

/**
 * Workspace settings key for AFWK preference
 */
export const AFWK_PREFERENCE_KEY = 'dipolecode.afwk.preference';
