/**
 * Modal Provider
 * Manages WebviewPanel lifecycle for custom modal dialogs
 */

import * as vscode from 'vscode';
import type {
  ModalConfig,
  ModalResult,
  ModalProviderOptions,
  WebviewMessage,
  ModalTheme,
} from './types';
import { generateModalHTML } from './templates';

/**
 * Manages the creation and lifecycle of modal dialogs
 */
export class ModalProvider {
  private readonly extensionUri: vscode.Uri;
  private readonly theme: ModalTheme;
  private currentPanel: vscode.WebviewPanel | null = null;
  private disposables: vscode.Disposable[] = [];

  constructor(options: ModalProviderOptions) {
    this.extensionUri = options.extensionUri;
    this.theme = options.theme ?? this.detectTheme();
  }

  /**
   * Detects the current VS Code theme
   */
  private detectTheme(): ModalTheme {
    const colorTheme = vscode.window.activeColorTheme;
    return colorTheme.kind === vscode.ColorThemeKind.Light ? 'light' : 'dark';
  }

  /**
   * Shows a modal dialog and returns a promise that resolves when closed
   */
  public async showModal<T = unknown>(config: ModalConfig): Promise<ModalResult<T>> {
    // Close existing panel if any
    if (this.currentPanel) {
      this.currentPanel.dispose();
    }

    return new Promise((resolve) => {
      // Create webview panel
      this.currentPanel = vscode.window.createWebviewPanel(
        `dipolecode-modal-${config.id}`,
        config.title,
        {
          viewColumn: vscode.ViewColumn.Active,
          preserveFocus: false,
        },
        {
          enableScripts: true,
          retainContextWhenHidden: true,
          localResourceRoots: [this.extensionUri],
        }
      );

      // Generate and set HTML content
      this.currentPanel.webview.html = generateModalHTML(config, this.theme);

      // Handle messages from webview
      this.currentPanel.webview.onDidReceiveMessage(
        (message: WebviewMessage) => {
          switch (message.type) {
            case 'button-click':
              resolve({
                buttonId: message.payload.buttonId ?? null,
                data: message.payload.data as T,
              });
              this.closeModal();
              break;

            case 'close':
              resolve({ buttonId: null });
              this.closeModal();
              break;

            case 'ready':
              // Modal is ready, could send initial data here
              break;
          }
        },
        null,
        this.disposables
      );

      // Handle panel disposal
      this.currentPanel.onDidDispose(
        () => {
          resolve({ buttonId: null });
          this.cleanup();
        },
        null,
        this.disposables
      );

      // Reveal the panel
      this.currentPanel.reveal(vscode.ViewColumn.Active);
    });
  }

  /**
   * Closes the current modal
   */
  public closeModal(): void {
    if (this.currentPanel) {
      this.currentPanel.dispose();
      this.currentPanel = null;
    }
    this.cleanup();
  }

  /**
   * Sends a message to the webview
   */
  public postMessage(message: Record<string, unknown>): void {
    if (this.currentPanel) {
      this.currentPanel.webview.postMessage(message);
    }
  }

  /**
   * Cleanup disposables
   */
  private cleanup(): void {
    this.disposables.forEach((d) => d.dispose());
    this.disposables = [];
    this.currentPanel = null;
  }

  /**
   * Dispose the provider
   */
  public dispose(): void {
    this.closeModal();
  }
}

/**
 * Singleton instance for easy access
 */
let modalProviderInstance: ModalProvider | null = null;

/**
 * Initializes the modal provider singleton
 */
export function initializeModalProvider(options: ModalProviderOptions): ModalProvider {
  if (modalProviderInstance) {
    modalProviderInstance.dispose();
  }
  modalProviderInstance = new ModalProvider(options);
  return modalProviderInstance;
}

/**
 * Gets the modal provider singleton
 */
export function getModalProvider(): ModalProvider {
  if (!modalProviderInstance) {
    throw new Error('ModalProvider not initialized. Call initializeModalProvider first.');
  }
  return modalProviderInstance;
}
