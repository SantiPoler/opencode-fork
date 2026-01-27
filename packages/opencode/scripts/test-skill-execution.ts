#!/usr/bin/env bun
/**
 * Script para verificar que Skill.state() encuentra skills cacheados
 * Ejecutar: bun run packages/opencode/scripts/test-skill-execution.ts
 */

import { Skill } from "../src/skill/skill"

async function main() {
  console.log("🔍 Verificando sistema de ejecución de skills (Skill namespace)...\n")

  // Obtener todos los skills
  const skills = await Skill.all()

  console.log(`📊 Skills encontrados: ${skills.length}\n`)

  for (const skill of skills) {
    // Check if it's from cached directory
    const isCached = skill.location.includes(".aifwk/cache/skills") || skill.location.includes(".aifwk\\cache\\skills")
    const isUser = skill.location.includes(".config/opencode/skill") || skill.location.includes(".config\\opencode\\skill")

    let source = "local/embedded"
    if (isCached) source = "🌐 CACHED (remote sync)"
    else if (isUser) source = "👤 USER"

    console.log(`  - ${skill.name}`)
    console.log(`    ${source}`)
    console.log(`    "${skill.description}"`)
    console.log(`    📁 ${skill.location}\n`)
  }

  // Buscar específicamente sync-dipolework
  console.log("🔎 Buscando 'sync-dipolework'...")
  const syncSkill = await Skill.get("sync-dipolework")

  if (syncSkill) {
    console.log(`✅ ¡Encontrado! El skill sync-dipolework está disponible para ejecución`)
    console.log(`   Ubicación: ${syncSkill.location}`)
  } else {
    console.log(`❌ No encontrado. El skill sync-dipolework NO está disponible`)
  }
}

main().catch(console.error)
