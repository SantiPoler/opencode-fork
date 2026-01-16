/**
 * AFWK Schema Fetching
 * Mock implementation - will be replaced with GitHub fetch in the future
 */

import type { AFWKSchema } from './types';

/**
 * Mock AFWK schema that defines the expected project structure
 * In the future, this will be fetched from a GitHub repository
 */
const MOCK_AFWK_SCHEMA: AFWKSchema = {
  version: "1.0.0",
  root: ".afwk",

  directories: {
    steering: {
      description: "Documentos guía del proyecto",
      files: {
        "latest-implementation.md": "Estado actual de la implementación",
        "product.md": "Visión y alcance del producto",
        "structure.md": "Estructura del proyecto",
        "tech.md": "Stack tecnológico y decisiones técnicas",
        "testing.txt": "TEsting the document",
      }
    },
    kanban: {
      description: "Tablero de tareas del proyecto",
      files: {},
      directories: {
        todo: {
          description: "Tareas listas para comenzar",
          files: {}
        },
        in_progress: {
          description: "Tareas en desarrollo",
          files: {}
        },
        completed: {
          description: "Tareas finalizadas",
          files: {}
        },
        backlog: {
          description: "Tareas pendientes de priorizar",
          files: {}
        }
      }
    }
  }
};

/**
 * Fetches the AFWK schema
 * Currently returns a mock schema, but will fetch from GitHub in the future
 *
 * @param _repoUrl - Optional GitHub repository URL (ignored in mock implementation)
 * @returns Promise resolving to the AFWK schema
 */
export async function fetchAFWKSchema(_repoUrl?: string): Promise<AFWKSchema> {
  // TODO: In the future, implement actual GitHub fetch:
  // const response = await fetch(`${repoUrl}/raw/main/afwk-schema.json`);
  // return response.json();

  // For now, return the mock schema
  // Simulate network delay for realistic behavior
  await new Promise(resolve => setTimeout(resolve, 100));

  return MOCK_AFWK_SCHEMA;
}

/**
 * Gets the current schema version
 */
export function getSchemaVersion(): string {
  return MOCK_AFWK_SCHEMA.version;
}
