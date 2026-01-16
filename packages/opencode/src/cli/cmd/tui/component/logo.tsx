import { TextAttributes } from "@opentui/core"
import { For } from "solid-js"
import { useTheme } from "@tui/context/theme"

// dipoleSTUDIO logo - "dipole" in primary color, "STUDIO" in secondary
const LOGO_LEFT = [
  `     █████  ███                     ████            `,
  `    ░░███  ░░░                     ░░███           `,
  `  ███████  ████  ████████   ██████  ░███   ██████ `,
  ` ███░░███ ░░███ ░░███░░███ ███░░███ ░███  ███░░███`,
  `░███ ░███  ░███  ░███ ░███░███ ░███ ░███ ░███████ `,
  `░███ ░███  ░███  ░███ ░███░███ ░███ ░███ ░███░░░  `,
  `░░████████ █████ ░███████ ░░██████  █████░░██████ `,
  ` ░░░░░░░░ ░░░░░  ░███░░░   ░░░░░░  ░░░░░  ░░░░░░  `,
  `                 ░███                              `,
  `                 █████                             `,
  `                ░░░░░                              `,
]

const LOGO_RIGHT = [
  `█████████  ███████████ █████  █████ ██████████   █████    ███████   `,
  `███░░░░░███░█░░░███░░░█░░███  ░░███ ░░███░░░░███ ░░███   ███░░░░░███`,
  `░███    ░░░ ░   ░███  ░  ░███   ░███  ░███   ░░███ ░███  ███     ░░███`,
  `░░█████████     ░███     ░███   ░███  ░███    ░███ ░███ ░███      ░███`,
  ` ░░░░░░░░███    ░███     ░███   ░███  ░███    ░███ ░███ ░███      ░███`,
  ` ███    ░███    ░███     ░███   ░███  ░███    ███  ░███ ░░███     ███ `,
  `░░█████████     █████    ░░████████   ██████████   █████ ░░░███████░  `,
  ` ░░░░░░░░░     ░░░░░      ░░░░░░░░   ░░░░░░░░░░   ░░░░░    ░░░░░░░   `,
  `                                                                      `,
  `                                                                      `,
  `                                                                      `,
]

export function Logo() {
  const { theme } = useTheme()
  return (
    <box>
      <For each={LOGO_LEFT}>
        {(line, index) => (
          <box flexDirection="row">
            <text fg={theme.primary} selectable={false}>
              {line}
            </text>
            <text fg={theme.secondary} attributes={TextAttributes.BOLD} selectable={false}>
              {LOGO_RIGHT[index()]}
            </text>
          </box>
        )}
      </For>
    </box>
  )
}
