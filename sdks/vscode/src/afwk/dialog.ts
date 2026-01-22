/**
 * AFWK Dialog Handlers
 * Custom branded dialogs for AFWK structure management using dipoleCODE modal system
 */

import * as vscode from 'vscode';
import type { ValidationResult, AFWKPreference } from './types';
import { AFWK_PREFERENCE_KEY } from './types';
import { getValidationSummary } from './validator';
import { getModalProvider, type ModalConfig, type ModalResult } from '../ui/modal';

/**
 * Button IDs for dialogs
 */
const BUTTON_IDS = {
  CREATE_FULL: 'create-full',
  COMPLETE_MISSING: 'complete-missing',
  USE_WITHOUT: 'use-without',
} as const;

/**
 * Saves the AFWK preference to workspace settings
 */
export async function saveAFWKPreference(preference: AFWKPreference): Promise<void> {
  const config = vscode.workspace.getConfiguration();
  await config.update(AFWK_PREFERENCE_KEY, preference, vscode.ConfigurationTarget.Workspace);
}

/**
 * Gets the saved AFWK preference from workspace settings
 */
export function getAFWKPreference(): AFWKPreference {
  const config = vscode.workspace.getConfiguration();
  return config.get<AFWKPreference>(AFWK_PREFERENCE_KEY, 'pending');
}

/**
 * Result of dialog interaction
 */
export interface DialogResult {
  action: 'create' | 'complete' | 'skip' | 'none' | 'cancelled';
  savePreference: boolean;
}

/**
 * Shows custom branded dialog when AFWK structure doesn't exist
 */
export async function showNoStructureDialog(
  workspaceRoot: string
): Promise<DialogResult> {
  const modalProvider = getModalProvider();

  const config: ModalConfig = {
    id: 'afwk-no-structure',
    title: 'dipoleCODE - Configuración AFWK',
    subtitle: 'Configuración inicial',
    template: 'single',
    icon: 'info',
    content: {
      heading: 'Estructura AFWK no detectada',
      description:
        'Este proyecto no tiene la estructura AFWK configurada. ' +
        'La estructura AFWK permite integrar tu proyecto con el ecosistema dipoleDIGITAL ' +
        'y habilita funciones avanzadas de gestión de documentos.',
      details: [
        'Carpeta .afwk con configuración del proyecto',
        'Plantillas de documentos estándar',
        'Integración con dipoleFRAMEWORK',
      ],
    },
    buttons: [
      {
        id: BUTTON_IDS.CREATE_FULL,
        label: 'Crear estructura',
        variant: 'primary',
      },
      {
        id: BUTTON_IDS.USE_WITHOUT,
        label: 'Continuar sin AFWK',
        variant: 'secondary',
      },
    ],
  };

  const result: ModalResult = await modalProvider.showModal(config);

  switch (result.buttonId) {
    case BUTTON_IDS.CREATE_FULL:
      return { action: 'create', savePreference: true };
    case BUTTON_IDS.USE_WITHOUT:
      return { action: 'none', savePreference: true };
    default:
      return { action: 'cancelled', savePreference: false };
  }
}

/**
 * Shows custom branded dialog when AFWK structure exists but is incomplete
 */
export async function showIncompleteStructureDialog(
  workspaceRoot: string,
  validationResult: ValidationResult
): Promise<DialogResult> {
  const modalProvider = getModalProvider();
  const missingCount = validationResult.missing.length;
  const missingItems = validationResult.missing.slice(0, 5).map((item) =>
    item.replace(workspaceRoot, '').replace(/^[\\/]/, '')
  );

  const config: ModalConfig = {
    id: 'afwk-incomplete-structure',
    title: 'dipoleCODE - Estructura Incompleta',
    subtitle: `${missingCount} elemento(s) faltante(s)`,
    template: 'single',
    icon: 'warning',
    content: {
      heading: 'Estructura AFWK incompleta',
      description:
        `Se detectó una estructura AFWK parcial en este proyecto. ` +
        `Faltan ${missingCount} elemento(s) para completar la configuración.`,
      details: [
        ...missingItems,
        ...(missingCount > 5 ? [`...y ${missingCount - 5} más`] : []),
      ],
    },
    buttons: [
      {
        id: BUTTON_IDS.COMPLETE_MISSING,
        label: 'Completar estructura',
        variant: 'primary',
      },
      {
        id: BUTTON_IDS.USE_WITHOUT,
        label: 'Continuar sin completar',
        variant: 'secondary',
      },
    ],
  };

  const result: ModalResult = await modalProvider.showModal(config);

  switch (result.buttonId) {
    case BUTTON_IDS.COMPLETE_MISSING:
      return { action: 'complete', savePreference: true };
    case BUTTON_IDS.USE_WITHOUT:
      return { action: 'none', savePreference: true };
    default:
      return { action: 'cancelled', savePreference: false };
  }
}

/**
 * Shows success notification after structure creation
 * (Using native notification for non-blocking feedback)
 */
export function showStructureCreatedNotification(createdCount: number): void {
  vscode.window.showInformationMessage(
    `dipoleCODE: Estructura AFWK creada exitosamente (${createdCount} elementos)`
  );
}

/**
 * Shows success notification after completing missing structure
 * (Using native notification for non-blocking feedback)
 */
export function showStructureCompletedNotification(completedCount: number): void {
  vscode.window.showInformationMessage(
    `dipoleCODE: Estructura AFWK completada (${completedCount} elementos añadidos)`
  );
}

/**
 * Shows error notification
 * (Using native notification for non-blocking feedback)
 */
export function showErrorNotification(error: Error): void {
  vscode.window.showErrorMessage(
    `dipoleCODE: Error al crear estructura AFWK: ${error.message}`
  );
}

/**
 * Shows status bar message for AFWK status
 * Clicking the status bar item will open the AFWK initialization modal
 */
export function createAFWKStatusBarItem(): vscode.StatusBarItem {
  const statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100
  );
  statusBarItem.name = 'dipoleCODE AFWK Status';
  statusBarItem.command = 'dipolecode.checkAFWK';
  return statusBarItem;
}

/**
 * Updates status bar with AFWK status
 */
export function updateStatusBar(
  statusBarItem: vscode.StatusBarItem,
  validationResult: ValidationResult | null,
  preference: AFWKPreference
): void {
  const clickHint = '\n\nClick para configurar AFWK';

  if (preference === 'none') {
    statusBarItem.text = '$(circle-slash) AFWK: Desactivado';
    statusBarItem.tooltip = 'Integración AFWK desactivada para este proyecto' + clickHint;
    statusBarItem.backgroundColor = undefined;
  } else if (!validationResult) {
    statusBarItem.text = '$(loading~spin) AFWK: Verificando...';
    statusBarItem.tooltip = 'Verificando estructura AFWK';
    statusBarItem.backgroundColor = undefined;
  } else if (validationResult.valid) {
    statusBarItem.text = '$(check) AFWK: Activo';
    statusBarItem.tooltip = getValidationSummary(validationResult) + clickHint;
    statusBarItem.backgroundColor = undefined;
  } else if (validationResult.rootExists) {
    statusBarItem.text = '$(warning) AFWK: Incompleto';
    statusBarItem.tooltip = getValidationSummary(validationResult) + clickHint;
    statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
  } else {
    statusBarItem.text = '$(circle-slash) AFWK: No detectado';
    statusBarItem.tooltip = 'No se encontró estructura .afwk' + clickHint;
    statusBarItem.backgroundColor = undefined;
  }

  statusBarItem.show();
}
