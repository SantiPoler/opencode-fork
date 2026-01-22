/**
 * Manual test script for rules.yaml and updateLatestImplementation
 * Run with: bun run src/afwk/__tests__/manual-test.ts
 */

import * as fs from "fs/promises"
import * as path from "path"
import {
  loadRules,
  validateTransition,
  setBasePath,
  clearRulesCache,
} from "../rules-engine"

const TEST_PROJECT = "C:/repos/test-project"

async function testRulesYaml() {
  console.log("\n========================================")
  console.log("TEST 1: rules.yaml Loading")
  console.log("========================================\n")

  // Set base path to test-project
  setBasePath(TEST_PROJECT)

  try {
    const rules = await loadRules()
    console.log("✅ rules.yaml loaded successfully!")
    console.log(`   Version: ${rules.version}`)
    console.log(`   Transitions defined: ${Object.keys(rules.transitions || {}).length}`)
    console.log(`   Validations defined: ${Object.keys(rules.validations || {}).length}`)
    console.log(`   Naming rules defined: ${Object.keys(rules.naming || {}).length}`)
  } catch (error) {
    console.log("❌ Failed to load rules.yaml:")
    console.log(`   ${error}`)
    return false
  }

  return true
}

async function testTransitionBlocking() {
  console.log("\n========================================")
  console.log("TEST 2: Transition Blocking (backlog → todo sin overview.md)")
  console.log("========================================\n")

  // Create a temp task without overview.md
  const tempTaskPath = path.join(TEST_PROJECT, ".afwk", "kanban", "backlog", "devTASK-99_test")

  try {
    await fs.mkdir(tempTaskPath, { recursive: true })
    console.log(`   Created temp task at: ${tempTaskPath}`)

    const result = await validateTransition(tempTaskPath, "backlog", "todo")

    if (!result.valid) {
      console.log("✅ Transition correctly BLOCKED!")
      console.log(`   Violations: ${result.violations.length}`)
      for (const v of result.violations) {
        console.log(`   - ${v.check}: ${v.message}`)
      }
    } else {
      console.log("❌ Transition should have been blocked but wasn't!")
      return false
    }
  } finally {
    // Cleanup
    try {
      await fs.rm(tempTaskPath, { recursive: true, force: true })
      console.log(`   Cleaned up temp task`)
    } catch {}
  }

  return true
}

async function testTransitionAllowed() {
  console.log("\n========================================")
  console.log("TEST 3: Transition Allowed (backlog → todo con overview.md)")
  console.log("========================================\n")

  // Create a temp task WITH overview.md
  const tempTaskPath = path.join(TEST_PROJECT, ".afwk", "kanban", "backlog", "devTASK-98_test-allowed")

  try {
    await fs.mkdir(tempTaskPath, { recursive: true })
    await fs.writeFile(path.join(tempTaskPath, "overview.md"), "# Test\n\n## Objetivo\nTest")
    console.log(`   Created temp task with overview.md`)

    const result = await validateTransition(tempTaskPath, "backlog", "todo")

    if (result.valid) {
      console.log("✅ Transition correctly ALLOWED!")
    } else {
      console.log("❌ Transition should have been allowed but was blocked:")
      for (const v of result.violations) {
        console.log(`   - ${v.message}`)
      }
      return false
    }
  } finally {
    // Cleanup
    try {
      await fs.rm(tempTaskPath, { recursive: true, force: true })
      console.log(`   Cleaned up temp task`)
    } catch {}
  }

  return true
}

async function testMissingRulesYaml() {
  console.log("\n========================================")
  console.log("TEST 4: Missing rules.yaml throws error")
  console.log("========================================\n")

  // Point to a directory without rules.yaml
  clearRulesCache()
  setBasePath("C:/repos/nonexistent-project")

  try {
    await loadRules()
    console.log("❌ Should have thrown error for missing rules.yaml!")
    return false
  } catch (error) {
    const msg = String(error)
    if (msg.includes("rules.yaml not found")) {
      console.log("✅ Correctly threw error for missing rules.yaml!")
      console.log(`   Error: ${msg.slice(0, 100)}...`)
    } else {
      console.log("❌ Wrong error type:")
      console.log(`   ${error}`)
      return false
    }
  } finally {
    // Restore
    clearRulesCache()
    setBasePath(TEST_PROJECT)
  }

  return true
}

async function main() {
  console.log("╔════════════════════════════════════════╗")
  console.log("║  aiFRAMEWORK Manual Test Suite         ║")
  console.log("╚════════════════════════════════════════╝")

  const results: boolean[] = []

  results.push(await testRulesYaml())
  results.push(await testTransitionBlocking())
  results.push(await testTransitionAllowed())
  results.push(await testMissingRulesYaml())

  console.log("\n========================================")
  console.log("SUMMARY")
  console.log("========================================")

  const passed = results.filter(r => r).length
  const total = results.length

  console.log(`\n${passed}/${total} tests passed\n`)

  if (passed === total) {
    console.log("✅ All tests passed!")
  } else {
    console.log("❌ Some tests failed!")
    process.exit(1)
  }
}

main().catch(console.error)
