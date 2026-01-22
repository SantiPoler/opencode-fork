import { describe, test, expect, beforeEach } from "bun:test"
import {
  isDestructiveAfwkCommand,
  isAfwkPath,
  AfwkSecurityError,
  AfwkSecurityPlugin,
} from "../security-hooks"

describe("security-hooks", () => {
  describe("isDestructiveAfwkCommand", () => {
    describe("should block destructive commands", () => {
      test("blocks rm commands targeting .afwk/", () => {
        expect(isDestructiveAfwkCommand("rm -rf .afwk/")).toBe(true)
        expect(isDestructiveAfwkCommand("rm .afwk/state.json")).toBe(true)
        expect(isDestructiveAfwkCommand("rm -r /path/to/.afwk/kanban")).toBe(true)
      })

      test("blocks mv commands targeting .afwk/", () => {
        expect(isDestructiveAfwkCommand("mv .afwk/old .afwk/new")).toBe(true)
        expect(isDestructiveAfwkCommand("mv file.txt .afwk/")).toBe(true)
      })

      test("blocks cp commands targeting .afwk/", () => {
        expect(isDestructiveAfwkCommand("cp file.txt .afwk/")).toBe(true)
        expect(isDestructiveAfwkCommand("cp -r dir/ .afwk/")).toBe(true)
      })

      test("blocks redirect operations to .afwk/", () => {
        expect(isDestructiveAfwkCommand('echo "test" > .afwk/file.json')).toBe(true)
        expect(isDestructiveAfwkCommand("cat foo > .afwk/bar")).toBe(true)
        expect(isDestructiveAfwkCommand('printf "x" > .afwk/test')).toBe(true)
      })

      test("blocks tee commands to .afwk/", () => {
        expect(isDestructiveAfwkCommand("echo test | tee .afwk/file")).toBe(true)
      })

      test("blocks sed -i (in-place edit) on .afwk/", () => {
        expect(isDestructiveAfwkCommand("sed -i 's/old/new/' .afwk/config.yaml")).toBe(true)
      })

      test("blocks touch commands in .afwk/", () => {
        expect(isDestructiveAfwkCommand("touch .afwk/newfile")).toBe(true)
      })

      test("blocks mkdir commands in .afwk/", () => {
        expect(isDestructiveAfwkCommand("mkdir .afwk/newdir")).toBe(true)
        expect(isDestructiveAfwkCommand("mkdir -p .afwk/a/b/c")).toBe(true)
      })

      test("blocks chmod/chown commands on .afwk/", () => {
        expect(isDestructiveAfwkCommand("chmod 777 .afwk/")).toBe(true)
        expect(isDestructiveAfwkCommand("chown user:group .afwk/")).toBe(true)
      })

      test("blocks archive extraction to .afwk/", () => {
        expect(isDestructiveAfwkCommand("tar -xf archive.tar -C .afwk/")).toBe(true)
        expect(isDestructiveAfwkCommand("unzip archive.zip -d .afwk/")).toBe(true)
      })

      test("blocks Windows commands targeting .afwk/", () => {
        expect(isDestructiveAfwkCommand("del .afwk\\state.json")).toBe(true)
        expect(isDestructiveAfwkCommand("move file.txt .afwk\\")).toBe(true)
        expect(isDestructiveAfwkCommand("copy file.txt .afwk\\")).toBe(true)
        expect(isDestructiveAfwkCommand("xcopy dir .afwk\\")).toBe(true)
      })
    })

    describe("should allow read-only commands", () => {
      test("allows cat commands on .afwk/", () => {
        expect(isDestructiveAfwkCommand("cat .afwk/state.json")).toBe(false)
      })

      test("allows ls commands on .afwk/", () => {
        expect(isDestructiveAfwkCommand("ls .afwk/")).toBe(false)
        expect(isDestructiveAfwkCommand("ls -la .afwk/kanban")).toBe(false)
      })

      test("allows head/tail commands on .afwk/", () => {
        expect(isDestructiveAfwkCommand("head .afwk/state.json")).toBe(false)
        expect(isDestructiveAfwkCommand("tail -f .afwk/state.json")).toBe(false)
      })

      test("allows grep commands on .afwk/", () => {
        expect(isDestructiveAfwkCommand("grep pattern .afwk/rules.yaml")).toBe(false)
        expect(isDestructiveAfwkCommand("rg pattern .afwk/")).toBe(false)
      })

      test("allows find commands on .afwk/", () => {
        expect(isDestructiveAfwkCommand("find .afwk/ -name '*.json'")).toBe(false)
      })

      test("allows wc commands on .afwk/", () => {
        expect(isDestructiveAfwkCommand("wc -l .afwk/state.json")).toBe(false)
      })

      test("allows diff commands on .afwk/", () => {
        expect(isDestructiveAfwkCommand("diff .afwk/old.json .afwk/new.json")).toBe(false)
      })

      test("allows stat/file commands on .afwk/", () => {
        expect(isDestructiveAfwkCommand("stat .afwk/state.json")).toBe(false)
        expect(isDestructiveAfwkCommand("file .afwk/state.json")).toBe(false)
      })

      test("allows Windows dir command on .afwk/", () => {
        expect(isDestructiveAfwkCommand("dir .afwk\\")).toBe(false)
      })
    })

    describe("should not affect non-.afwk commands", () => {
      test("allows destructive commands on other paths", () => {
        expect(isDestructiveAfwkCommand("rm -rf /tmp/test")).toBe(false)
        expect(isDestructiveAfwkCommand("mv file1.txt file2.txt")).toBe(false)
        expect(isDestructiveAfwkCommand("echo test > output.txt")).toBe(false)
      })

      test("allows general commands", () => {
        expect(isDestructiveAfwkCommand("npm install")).toBe(false)
        expect(isDestructiveAfwkCommand("git status")).toBe(false)
        expect(isDestructiveAfwkCommand("bun test")).toBe(false)
      })
    })
  })

  describe("isAfwkPath", () => {
    describe("should detect .afwk paths", () => {
      test("detects Unix-style paths", () => {
        expect(isAfwkPath(".afwk/state.json")).toBe(true)
        expect(isAfwkPath(".afwk/kanban/backlog")).toBe(true)
        expect(isAfwkPath("/home/user/project/.afwk/rules.yaml")).toBe(true)
        expect(isAfwkPath("project/.afwk/templates/")).toBe(true)
      })

      test("detects Windows-style paths", () => {
        expect(isAfwkPath(".afwk\\state.json")).toBe(true)
        expect(isAfwkPath("C:\\project\\.afwk\\kanban")).toBe(true)
        expect(isAfwkPath("D:\\repos\\test\\.afwk\\rules.yaml")).toBe(true)
      })

      test("detects bare .afwk directory", () => {
        expect(isAfwkPath(".afwk")).toBe(true)
        expect(isAfwkPath(".afwk/")).toBe(true)
      })

      test("is case-insensitive", () => {
        expect(isAfwkPath(".AFWK/state.json")).toBe(true)
        expect(isAfwkPath(".Afwk/kanban")).toBe(true)
      })
    })

    describe("should not detect non-.afwk paths", () => {
      test("allows regular paths", () => {
        expect(isAfwkPath("/home/user/project/src/app.ts")).toBe(false)
        expect(isAfwkPath("package.json")).toBe(false)
        expect(isAfwkPath("C:\\project\\src\\index.ts")).toBe(false)
      })

      test("allows paths containing 'afwk' but not '.afwk'", () => {
        expect(isAfwkPath("afwk-plugin.ts")).toBe(false)
        expect(isAfwkPath("/src/afwk/tools.ts")).toBe(false)
        expect(isAfwkPath("myafwk/config")).toBe(false)
      })

      test("handles null/undefined/empty", () => {
        expect(isAfwkPath(null)).toBe(false)
        expect(isAfwkPath(undefined)).toBe(false)
        expect(isAfwkPath("")).toBe(false)
      })
    })
  })

  describe("AfwkSecurityError", () => {
    test("creates error with correct properties", () => {
      const error = new AfwkSecurityError("Test message", "bash", "rm_command")

      expect(error.message).toBe("Test message")
      expect(error.name).toBe("AfwkSecurityError")
      expect(error.tool).toBe("bash")
      expect(error.operation).toBe("rm_command")
    })

    test("is instance of Error", () => {
      const error = new AfwkSecurityError("Test", "edit", "edit_afwk")
      expect(error instanceof Error).toBe(true)
    })
  })

  describe("AfwkSecurityPlugin", () => {
    test("returns hooks object", async () => {
      const mockInput = {
        client: {} as any,
        project: {} as any,
        directory: "/test",
        worktree: "/test",
        serverUrl: new URL("http://localhost:4096"),
        $: {} as any,
      }

      const hooks = await AfwkSecurityPlugin(mockInput)

      expect(hooks).toBeDefined()
      expect(hooks["tool.execute.before"]).toBeDefined()
      expect(typeof hooks["tool.execute.before"]).toBe("function")
    })

    describe("tool.execute.before hook", () => {
      // Helper to get hook instance
      async function getHook() {
        const mockInput = {
          client: {} as any,
          project: {} as any,
          directory: "/test",
          worktree: "/test",
          serverUrl: new URL("http://localhost:4096"),
          $: {} as any,
        }
        const hooks = await AfwkSecurityPlugin(mockInput)
        return hooks["tool.execute.before"]!
      }

      test("allows afwk_* tools", async () => {
        const hook = await getHook()
        await expect(
          hook(
            { tool: "afwk_move_kanban_task", sessionID: "s1", callID: "c1" },
            { args: { path: ".afwk/kanban" } }
          )
        ).resolves.toBeUndefined()

        await expect(
          hook(
            { tool: "afwk_create_devtask", sessionID: "s1", callID: "c1" },
            { args: { title: "test" } }
          )
        ).resolves.toBeUndefined()
      })

      test("allows read-only bash commands on .afwk/", async () => {
        const hook = await getHook()
        await expect(
          hook(
            { tool: "bash", sessionID: "s1", callID: "c1" },
            { args: { command: "cat .afwk/state.json" } }
          )
        ).resolves.toBeUndefined()

        await expect(
          hook(
            { tool: "Bash", sessionID: "s1", callID: "c1" },
            { args: { command: "ls -la .afwk/" } }
          )
        ).resolves.toBeUndefined()
      })

      test("blocks destructive bash commands on .afwk/", async () => {
        const hook = await getHook()
        await expect(
          hook(
            { tool: "bash", sessionID: "s1", callID: "c1" },
            { args: { command: "rm -rf .afwk/" } }
          )
        ).rejects.toThrow(AfwkSecurityError)

        await expect(
          hook(
            { tool: "Bash", sessionID: "s1", callID: "c1" },
            { args: { command: 'echo "test" > .afwk/file.json' } }
          )
        ).rejects.toThrow("Cannot modify .afwk/ via bash")
      })

      test("blocks edit tool on .afwk/ paths", async () => {
        const hook = await getHook()
        await expect(
          hook(
            { tool: "edit", sessionID: "s1", callID: "c1" },
            { args: { file_path: ".afwk/rules.yaml" } }
          )
        ).rejects.toThrow(AfwkSecurityError)

        await expect(
          hook(
            { tool: "Edit", sessionID: "s1", callID: "c1" },
            { args: { path: "/project/.afwk/state.json" } }
          )
        ).rejects.toThrow("Cannot modify .afwk/ directly via edit")
      })

      test("blocks write tool on .afwk/ paths", async () => {
        const hook = await getHook()
        await expect(
          hook(
            { tool: "write", sessionID: "s1", callID: "c1" },
            { args: { file_path: ".afwk/kanban/new-task.json" } }
          )
        ).rejects.toThrow(AfwkSecurityError)

        await expect(
          hook(
            { tool: "Write", sessionID: "s1", callID: "c1" },
            { args: { path: ".afwk/templates/new.md" } }
          )
        ).rejects.toThrow("Cannot modify .afwk/ directly via write")
      })

      test("allows edit/write on non-.afwk paths", async () => {
        const hook = await getHook()
        await expect(
          hook(
            { tool: "edit", sessionID: "s1", callID: "c1" },
            { args: { file_path: "src/index.ts" } }
          )
        ).resolves.toBeUndefined()

        await expect(
          hook(
            { tool: "write", sessionID: "s1", callID: "c1" },
            { args: { file_path: "package.json" } }
          )
        ).resolves.toBeUndefined()
      })

      test("allows other tools without path arguments", async () => {
        const hook = await getHook()
        await expect(
          hook(
            { tool: "grep", sessionID: "s1", callID: "c1" },
            { args: { pattern: "test" } }
          )
        ).resolves.toBeUndefined()

        await expect(
          hook(
            { tool: "glob", sessionID: "s1", callID: "c1" },
            { args: { pattern: "**/*.ts" } }
          )
        ).resolves.toBeUndefined()
      })

      test("handles missing args gracefully", async () => {
        const hook = await getHook()
        await expect(
          hook(
            { tool: "bash", sessionID: "s1", callID: "c1" },
            { args: {} }
          )
        ).resolves.toBeUndefined()

        await expect(
          hook(
            { tool: "edit", sessionID: "s1", callID: "c1" },
            { args: undefined as any }
          )
        ).resolves.toBeUndefined()
      })
    })
  })
})
