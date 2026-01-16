/**
 * Modal System
 * Custom modal dialogs for dipoleCODE VS Code extension
 */

export { ModalProvider, initializeModalProvider, getModalProvider } from './ModalProvider';
export { generateModalHTML } from './templates';
export type {
  ModalConfig,
  ModalResult,
  ModalButton,
  ModalContent,
  ModalTheme,
  ModalTemplate,
  ButtonVariant,
  WizardStep,
  WizardConfig,
  ModalProviderOptions,
  WebviewMessage,
  ExtensionMessage,
} from './types';
export { BRAND_COLORS } from './types';
