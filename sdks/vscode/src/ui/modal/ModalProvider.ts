/**
 * Modal Provider
 * Manages WebviewPanel lifecycle for custom modal dialogs
 * Supports native dipoleSTUDIO modal with full-app overlay when available
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
 * Result from the native modal command
 */
interface NativeModalResult {
  buttonId: string;
  cancelled: boolean;
}

/**
 * Manages the creation and lifecycle of modal dialogs
 */
export class ModalProvider {
  private readonly extensionUri: vscode.Uri;
  private readonly theme: ModalTheme;
  private currentPanel: vscode.WebviewPanel | null = null;
  private disposables: vscode.Disposable[] = [];
  private useNativeModal: boolean | null = null;

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
   * Checks if native modal command is available (dipoleSTUDIO)
   */
  private async isNativeModalAvailable(): Promise<boolean> {
    if (this.useNativeModal !== null) {
      return this.useNativeModal;
    }

    try {
      const commands = await vscode.commands.getCommands(true);
      this.useNativeModal = commands.includes('dipolecode.showNativeModal');
      return this.useNativeModal;
    } catch {
      this.useNativeModal = false;
      return false;
    }
  }

  /**
   * Shows a modal dialog using native dipoleSTUDIO command (full-app overlay)
   */
  private async showNativeModal<T = unknown>(config: ModalConfig): Promise<ModalResult<T>> {
    const nativeConfig = {
      id: config.id,
      title: config.title,
      message: config.content.heading,
      detail: config.content.description +
        (config.content.details?.length
          ? '\n\n• ' + config.content.details.join('\n• ')
          : ''),
      type: config.icon === 'warning' ? 'warning'
          : config.icon === 'error' ? 'error'
          : 'info',
      buttons: config.buttons.map(btn => ({
        id: btn.id,
        label: btn.label,
        primary: btn.variant === 'primary',
      })),
    };

    try {
      const result = await vscode.commands.executeCommand<NativeModalResult>(
        'dipolecode.showNativeModal',
        nativeConfig
      );

      if (result?.cancelled || !result?.buttonId) {
        return { buttonId: null };
      }

      return { buttonId: result.buttonId };
    } catch (error) {
      // Fallback to webview modal if native fails
      console.warn('Native modal failed, falling back to webview:', error);
      return this.showWebviewModal<T>(config);
    }
  }

  /**
   * Shows a modal dialog and returns a promise that resolves when closed
   */
  public async showModal<T = unknown>(config: ModalConfig): Promise<ModalResult<T>> {
    // Try native modal first (full-app overlay in dipoleSTUDIO)
    if (await this.isNativeModalAvailable()) {
      return this.showNativeModal<T>(config);
    }

    // Fallback to webview-based modal
    return this.showWebviewModal<T>(config);
  }

  /**
   * Shows a webview-based modal dialog (fallback)
   */
  private async showWebviewModal<T = unknown>(config: ModalConfig): Promise<ModalResult<T>> {
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
