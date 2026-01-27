# dipoleCODE Bundled Binaries

This directory contains platform-specific dipoleCODE binaries bundled with the extension.

## Expected Files

| File | Platform | Architecture |
|------|----------|--------------|
| `opencode-win32-x64.exe` | Windows | x64 |
| `opencode-darwin-arm64` | macOS | Apple Silicon |
| `opencode-darwin-x64` | macOS | Intel |
| `opencode-linux-x64` | Linux | x64 |
| `opencode-linux-arm64` | Linux | ARM64 |

## How to Populate

Run the sync script from `scripts/`:

```powershell
# Windows (PowerShell)
.\scripts\sync-binary.ps1

# Build only current platform (faster)
.\scripts\sync-binary.ps1 -SinglePlatform
```

```bash
# macOS/Linux
./scripts/sync-binary.sh

# Build only current platform (faster)
./scripts/sync-binary.sh --single
```

## Requirements

1. `opencode-fork` cloned at `C:\repos\opencode-fork` (or set `OPENCODE_PATH`)
2. Bun installed (`bun --version`)
3. Run `bun install` in opencode-fork first

## Note

These binaries are **not** committed to git (see `.gitignore`).
For distribution builds, CI/CD should run the sync script before packaging.
