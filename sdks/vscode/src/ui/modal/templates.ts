/**
 * Modal Templates
 * HTML generation for custom modal dialogs with dipoleDIGITAL branding
 */

import type { ModalConfig, ModalTheme, ButtonVariant } from './types';
import { BRAND_COLORS } from './types';

/**
 * dipoleDIGITAL logo SVG (horizontal variant)
 */
const DIPOLE_LOGO_SVG = `
<svg viewBox="0 0 200 40" xmlns="http://www.w3.org/2000/svg">
  <text x="0" y="28" font-family="system-ui, -apple-system, sans-serif" font-size="22" font-weight="600">
    <tspan fill="${BRAND_COLORS.cyan}">dipole</tspan><tspan fill="${BRAND_COLORS.teal}">CODE</tspan>
  </text>
</svg>
`;

/**
 * Icon SVGs for different modal types (24x24 viewBox)
 */
const ICONS = {
  warning: `<svg viewBox="0 0 24 24" fill="none" stroke="${BRAND_COLORS.cyan}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
    <path d="M12 9v4"/>
    <path d="M12 17h.01"/>
    <path d="M12 3l9.5 16.5H2.5L12 3z"/>
  </svg>`,
  error: `<svg viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="12" cy="12" r="10"/>
    <path d="M15 9l-6 6"/>
    <path d="M9 9l6 6"/>
  </svg>`,
  info: `<svg viewBox="0 0 24 24" fill="none" stroke="${BRAND_COLORS.cyan}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="12" cy="12" r="10"/>
    <path d="M12 16v-4"/>
    <path d="M12 8h.01"/>
  </svg>`,
  success: `<svg viewBox="0 0 24 24" fill="none" stroke="${BRAND_COLORS.tealGreen}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
    <path d="M22 11.08V12a10 10 0 11-5.93-9.14"/>
    <path d="M22 4L12 14.01l-3-3"/>
  </svg>`,
};

/**
 * Get button styles based on variant and theme
 */
function getButtonStyles(variant: ButtonVariant, theme: ModalTheme): string {
  const base = `
    padding: 10px 24px;
    border-radius: 6px;
    font-family: 'Montserrat', system-ui, sans-serif;
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s ease;
    border: none;
    outline: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    min-width: 140px;
  `;

  const variants: Record<ButtonVariant, string> = {
    primary: `
      ${base}
      background: ${BRAND_COLORS.cyan};
      color: ${BRAND_COLORS.navyBlue};
    `,
    secondary: `
      ${base}
      background: ${theme === 'dark' ? BRAND_COLORS.gray : '#e5e7eb'};
      color: ${theme === 'dark' ? BRAND_COLORS.white : BRAND_COLORS.navyBlue};
    `,
    danger: `
      ${base}
      background: #ef4444;
      color: white;
    `,
    ghost: `
      ${base}
      background: transparent;
      color: ${theme === 'dark' ? BRAND_COLORS.gray : BRAND_COLORS.navyBlue};
      border: 1px solid ${theme === 'dark' ? BRAND_COLORS.gray : '#d1d5db'};
    `,
  };

  return variants[variant];
}

/**
 * Generate CSS styles for the modal
 */
function generateStyles(theme: ModalTheme, width: number): string {
  const isDark = theme === 'dark';

  return `
    @import url('https://fonts.googleapis.com/css2?family=Exo+2:wght@400;500;600;700&family=Montserrat:wght@400;500;600&display=swap');

    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    html, body {
      width: 100%;
      height: 100%;
      overflow: hidden;
    }

    body {
      font-family: 'Montserrat', system-ui, -apple-system, sans-serif;
      background: ${isDark ? BRAND_COLORS.overlayDark : BRAND_COLORS.overlayLight};
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
    }

    .modal-overlay {
      position: fixed;
      inset: 0;
      background: ${isDark ? BRAND_COLORS.overlayDark : BRAND_COLORS.overlayLight};
      display: flex;
      align-items: center;
      justify-content: center;
      animation: fadeIn 0.2s ease;
    }

    @keyframes fadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }

    @keyframes slideUp {
      from {
        opacity: 0;
        transform: translateY(20px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }

    .modal-container {
      background: ${isDark ? BRAND_COLORS.navyBlue : BRAND_COLORS.white};
      border: 1px solid ${isDark ? BRAND_COLORS.darkTeal : BRAND_COLORS.teal};
      border-radius: 12px;
      width: ${width}px;
      max-width: 90vw;
      max-height: 90vh;
      overflow: hidden;
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
      animation: slideUp 0.3s ease;
    }

    .modal-header {
      padding: 16px 24px;
      border-bottom: 1px solid ${isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'};
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .modal-logo {
      height: 24px;
      width: auto;
    }

    .modal-logo svg {
      height: 24px;
      width: auto;
    }

    .modal-subtitle {
      font-family: 'Exo 2', system-ui, sans-serif;
      font-size: 12px;
      font-weight: 500;
      color: ${isDark ? BRAND_COLORS.gray : '#6b7280'};
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .modal-body {
      padding: 24px;
    }

    .modal-heading-row {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 16px;
    }

    .modal-icon {
      width: 28px;
      height: 28px;
      flex-shrink: 0;
    }

    .modal-icon svg {
      width: 28px;
      height: 28px;
    }

    .modal-heading {
      font-family: 'Exo 2', system-ui, sans-serif;
      font-size: 18px;
      font-weight: 600;
      color: ${isDark ? BRAND_COLORS.white : BRAND_COLORS.navyBlue};
    }

    .modal-description {
      font-size: 14px;
      line-height: 1.6;
      color: ${isDark ? '#a0aec0' : '#4b5563'};
      margin-bottom: 20px;
    }

    .modal-details {
      list-style: none;
      padding: 16px 20px;
      background: ${isDark ? 'rgba(0,0,0,0.25)' : 'rgba(0,0,0,0.04)'};
      border-radius: 8px;
      border-left: 3px solid ${BRAND_COLORS.cyan};
    }

    .modal-details li {
      font-size: 13px;
      color: ${isDark ? '#a0aec0' : '#6b7280'};
      padding: 8px 0;
      padding-left: 20px;
      position: relative;
    }

    .modal-details li:first-child {
      padding-top: 0;
    }

    .modal-details li:last-child {
      padding-bottom: 0;
    }

    .modal-details li::before {
      content: '';
      position: absolute;
      left: 0;
      top: 50%;
      transform: translateY(-50%);
      width: 6px;
      height: 6px;
      background: ${BRAND_COLORS.cyan};
      border-radius: 50%;
    }

    .modal-footer {
      padding: 16px 24px;
      border-top: 1px solid ${isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'};
      display: flex;
      justify-content: flex-end;
      gap: 12px;
    }

    .btn:hover {
      filter: brightness(1.1);
      transform: translateY(-1px);
    }

    .btn:active {
      transform: translateY(0);
    }

    .btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
      transform: none;
    }

    .btn:focus-visible {
      outline: 2px solid ${BRAND_COLORS.cyan};
      outline-offset: 2px;
    }
  `;
}

/**
 * Generate button HTML
 */
function generateButton(
  button: { id: string; label: string; variant: ButtonVariant; disabled?: boolean },
  theme: ModalTheme
): string {
  const styles = getButtonStyles(button.variant, theme);
  return `
    <button
      class="btn"
      data-button-id="${button.id}"
      style="${styles.replace(/\s+/g, ' ')}"
      ${button.disabled ? 'disabled' : ''}
    >
      ${button.label}
    </button>
  `;
}

/**
 * Generate the complete modal HTML
 */
export function generateModalHTML(config: ModalConfig, theme: ModalTheme): string {
  const width = config.width ?? 480;
  const iconSvg = config.icon && config.icon !== 'logo' ? ICONS[config.icon] : null;

  const detailsHTML = config.content.details?.length
    ? `
      <ul class="modal-details">
        ${config.content.details.map((detail) => `<li>${detail}</li>`).join('')}
      </ul>
    `
    : '';

  const buttonsHTML = config.buttons
    .map((btn) => generateButton(btn, theme))
    .join('');

  const headingRowHTML = iconSvg
    ? `
      <div class="modal-heading-row">
        <div class="modal-icon">${iconSvg}</div>
        <h2 id="modal-heading" class="modal-heading">${config.content.heading}</h2>
      </div>
    `
    : `<h2 id="modal-heading" class="modal-heading" style="margin-bottom: 16px;">${config.content.heading}</h2>`;

  return `
    <!DOCTYPE html>
    <html lang="es">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'unsafe-inline';">
      <title>${config.title}</title>
      <style>${generateStyles(theme, width)}</style>
    </head>
    <body>
      <div class="modal-overlay">
        <div class="modal-container" role="dialog" aria-modal="true" aria-labelledby="modal-heading">
          <div class="modal-header">
            <div class="modal-logo">${DIPOLE_LOGO_SVG}</div>
            ${config.subtitle ? `<span class="modal-subtitle">${config.subtitle}</span>` : ''}
          </div>

          <div class="modal-body">
            ${headingRowHTML}
            <p class="modal-description">${config.content.description}</p>
            ${detailsHTML}
          </div>

          <div class="modal-footer">
            ${buttonsHTML}
          </div>
        </div>
      </div>

      <script>
        (function() {
          const vscode = acquireVsCodeApi();

          // Notify extension that modal is ready
          vscode.postMessage({ type: 'ready', payload: {} });

          // Handle button clicks
          document.querySelectorAll('.btn').forEach(btn => {
            btn.addEventListener('click', () => {
              const buttonId = btn.getAttribute('data-button-id');
              vscode.postMessage({
                type: 'button-click',
                payload: { buttonId }
              });
            });
          });

          // Handle escape key
          document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
              vscode.postMessage({ type: 'close', payload: {} });
            }
          });

          // Handle overlay click (close on background click)
          document.querySelector('.modal-overlay').addEventListener('click', (e) => {
            if (e.target === e.currentTarget) {
              vscode.postMessage({ type: 'close', payload: {} });
            }
          });
        })();
      </script>
    </body>
    </html>
  `;
}
