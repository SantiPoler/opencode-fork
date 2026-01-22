/**
 * AFWK Staging Handler
 * Handles document staging events from the TUI server
 * Opens staged files for user review and manages confirm/cancel workflow
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { getModalProvider, type ModalConfig, type ModalResult } from '../ui/modal';

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
 * Button IDs for staging dialog
 */
const BUTTON_IDS = {
  CONFIRM: 'staging-confirm',
  CANCEL: 'staging-cancel',
} as const;

/**
 * Human-readable document type labels
 */
const DOCUMENT_TYPE_LABELS: Record<string, string> = {
  'devtask-overview': 'DevTASK Overview',
  'aitask-blueprint': 'AiTASK Blueprint',
  'completion-notes': 'Completion Notes',
  'document-update': 'Document Update',
};

/**
 * Handle a staging review event from the TUI server
 * 1. Opens the staged file in the editor
 * 2. Shows confirm/cancel dialog
 * 3. Sends result back to server
 */
export async function handleStagingReview(
  port: number,
  event: StagingReviewEvent,
  workspaceRoot: string
): Promise<void> {
  try {
    // Build full path to staged file within .afwk/
    const fullStagedPath = path.join(workspaceRoot, '.afwk', event.stagedPath);

    // Open the staged file in editor
    const uri = vscode.Uri.file(fullStagedPath);
    const doc = await vscode.workspace.openTextDocument(uri);
    const editor = await vscode.window.showTextDocument(doc, {
      preview: false,
      viewColumn: vscode.ViewColumn.One,
    });

    // Show the staging confirm/cancel dialog
    const result = await showStagingConfirmDialog(event);

    if (result.action === 'confirm') {
      // Save any edits the user made
      await doc.save();

      // Send confirm request to server
      await sendStagingConfirm(port, event.stagingId);

      // Show success notification
      vscode.window.showInformationMessage(
        `dipoleCODE: Document saved to ${event.finalPath}`
      );
    } else {
      // Send cancel request to server
      await sendStagingCancel(port, event.stagingId);

      // Show cancellation notification
      vscode.window.showInformationMessage(
        `dipoleCODE: Document staging cancelled`
      );
    }

    // Close the editor
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
  } catch (error) {
    console.error('[dipoleCODE] Error handling staging review:', error);
    vscode.window.showErrorMessage(
      `dipoleCODE: Error handling staged document: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Dialog result for staging confirmation
 */
interface StagingDialogResult {
  action: 'confirm' | 'cancel';
}

/**
 * Show the staging confirmation dialog
 */
async function showStagingConfirmDialog(
  event: StagingReviewEvent
): Promise<StagingDialogResult> {
  const modalProvider = getModalProvider();
  const documentTypeLabel = DOCUMENT_TYPE_LABELS[event.documentType] || event.documentType;

  // Calculate time remaining
  const expiresAt = new Date(event.expiresAt);
  const now = new Date();
  const hoursRemaining = Math.max(0, Math.floor((expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60)));

  const config: ModalConfig = {
    id: `staging-review-${event.stagingId}`,
    title: 'dipoleCODE - Revisar Documento',
    subtitle: documentTypeLabel,
    template: 'single',
    icon: 'info',
    content: {
      heading: 'Documento preparado para revisión',
      description:
        'El documento ha sido generado y está listo para tu revisión. ' +
        'Puedes editarlo en el editor antes de confirmar. ' +
        'Los cambios se guardarán automáticamente al confirmar.',
      details: [
        `Tipo: ${documentTypeLabel}`,
        `Destino: .afwk/${event.finalPath}`,
        `Expira en: ${hoursRemaining} horas`,
      ],
    },
    buttons: [
      {
        id: BUTTON_IDS.CONFIRM,
        label: 'Confirmar y Guardar',
        variant: 'primary',
      },
      {
        id: BUTTON_IDS.CANCEL,
        label: 'Cancelar',
        variant: 'secondary',
      },
    ],
  };

  const result: ModalResult = await modalProvider.showModal(config);

  // Default to cancel if dialog was dismissed without clicking a button
  if (result.buttonId === BUTTON_IDS.CONFIRM) {
    return { action: 'confirm' };
  }
  return { action: 'cancel' };
}

/**
 * Send staging confirmation to server
 */
async function sendStagingConfirm(port: number, stagingId: string): Promise<void> {
  const response = await fetch(`http://localhost:${port}/tui/staging/confirm`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ stagingId }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to confirm staging: ${error}`);
  }
}

/**
 * Send staging cancellation to server
 */
async function sendStagingCancel(port: number, stagingId: string): Promise<void> {
  const response = await fetch(`http://localhost:${port}/tui/staging/cancel`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ stagingId }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to cancel staging: ${error}`);
  }
}

/**
 * EventSource connection state
 */
let stagingEventSource: EventSource | null = null;
let stagingEventSourcePort: number | null = null;

/**
 * Start listening for staging events via SSE
 * Should be called after terminal is connected to server
 */
export function startStagingEventListener(
  port: number,
  workspaceRoot: string,
  context: vscode.ExtensionContext
): void {
  // Avoid duplicate connections
  if (stagingEventSource && stagingEventSourcePort === port) {
    return;
  }

  // Close existing connection if port changed
  stopStagingEventListener();

  try {
    // Use the global event stream to receive staging events
    const eventSource = new EventSource(`http://localhost:${port}/event`);
    stagingEventSource = eventSource;
    stagingEventSourcePort = port;

    eventSource.onmessage = async (event) => {
      try {
        const data = JSON.parse(event.data);

        // Check if this is a staging review event
        if (data.type === 'tui.staging.review') {
          const stagingEvent = data.properties as StagingReviewEvent;
          await handleStagingReview(port, stagingEvent, workspaceRoot);
        }
      } catch (error) {
        console.error('[dipoleCODE] Error parsing event:', error);
      }
    };

    eventSource.onerror = (error) => {
      console.error('[dipoleCODE] SSE connection error:', error);
      // Don't auto-reconnect on error to avoid spam
      // The extension will reconnect when a new terminal is opened
    };

    // Add cleanup on extension deactivation
    context.subscriptions.push({
      dispose: () => stopStagingEventListener(),
    });

    console.log('[dipoleCODE] Staging event listener started on port', port);
  } catch (error) {
    console.error('[dipoleCODE] Failed to start staging event listener:', error);
  }
}

/**
 * Stop the staging event listener
 */
export function stopStagingEventListener(): void {
  if (stagingEventSource) {
    stagingEventSource.close();
    stagingEventSource = null;
    stagingEventSourcePort = null;
    console.log('[dipoleCODE] Staging event listener stopped');
  }
}
