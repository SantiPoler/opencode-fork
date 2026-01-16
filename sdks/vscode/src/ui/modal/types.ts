/**
 * Modal System Types
 * Type definitions for the dipoleCODE custom modal system
 */

import * as vscode from 'vscode';

/**
 * Modal template types
 */
export type ModalTemplate = 'single' | 'wizard';

/**
 * Modal theme (follows VS Code theme)
 */
export type ModalTheme = 'dark' | 'light';

/**
 * Button style variants
 */
export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';

/**
 * Button configuration for modal dialogs
 */
export interface ModalButton {
  id: string;
  label: string;
  variant: ButtonVariant;
  icon?: string;  // Codicon name or SVG path
  disabled?: boolean;
}

/**
 * Modal dialog configuration
 */
export interface ModalConfig {
  id: string;
  title: string;
  subtitle?: string;
  template: ModalTemplate;
  icon?: 'logo' | 'warning' | 'error' | 'info' | 'success';
  buttons: ModalButton[];
  content: ModalContent;
  width?: number;   // px, default 480
  height?: number;  // px, default auto
}

/**
 * Content for single-page modal
 */
export interface ModalContent {
  heading: string;
  description: string;
  details?: string[];  // Bullet points or additional info
}

/**
 * Wizard step configuration (for future use)
 */
export interface WizardStep {
  id: string;
  title: string;
  content: ModalContent;
  buttons: ModalButton[];
  validation?: () => Promise<boolean>;
  onEnter?: () => Promise<void>;
  onLeave?: () => Promise<void>;
}

/**
 * Wizard modal configuration (for future use)
 */
export interface WizardConfig extends Omit<ModalConfig, 'template' | 'buttons' | 'content'> {
  template: 'wizard';
  steps: WizardStep[];
  initialStep?: number;
  allowSkip?: boolean;
}

/**
 * Message types for postMessage communication
 */
export type MessageType =
  | 'button-click'
  | 'close'
  | 'wizard-next'
  | 'wizard-prev'
  | 'wizard-goto'
  | 'ready';

/**
 * Message from webview to extension
 */
export interface WebviewMessage {
  type: MessageType;
  payload: {
    buttonId?: string;
    stepId?: string;
    data?: Record<string, unknown>;
  };
}

/**
 * Message from extension to webview
 */
export interface ExtensionMessage {
  type: 'update-content' | 'update-step' | 'set-loading' | 'set-error';
  payload: Record<string, unknown>;
}

/**
 * Result returned when modal is closed
 */
export interface ModalResult<T = unknown> {
  buttonId: string | null;  // null if closed without button click
  data?: T;
}

/**
 * Modal provider options
 */
export interface ModalProviderOptions {
  extensionUri: vscode.Uri;
  theme?: ModalTheme;
}

/**
 * dipoleDIGITAL brand colors
 */
export const BRAND_COLORS = {
  // Primary
  cyan: '#33DEFC',
  teal: '#03B5CF',
  darkTeal: '#006378',
  black: '#000000',

  // Secondary
  tealGreen: '#1D988C',
  navyBlue: '#152850',
  gray: '#6F7173',

  // UI
  white: '#FFFFFF',
  overlayDark: 'rgba(0, 0, 0, 0.7)',
  overlayLight: 'rgba(0, 0, 0, 0.5)',
} as const;
