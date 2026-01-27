#!/usr/bin/env bun
/**
 * Script de verificación del sistema de descubrimiento de skills
 * Ejecutar: bun run packages/opencode/scripts/test-skill-discovery.ts
 */

import { getSkillIndex, invalidateSkillIndex } from "../src/skill/discovery"
import { buildSkillIndexSection } from "../src/skill/context"
import { SkillResolver } from "../src/skill/resolver"

async function main() {
  console.log("🔍 Verificando sistema de descubrimiento de skills...\n")

  // 1. Invalidar caché para forzar re-escaneo
  invalidateSkillIndex()
  console.log("✅ Caché invalidado")

  // 2. Obtener índice de skills
  console.log("\n📋 Descubriendo skills...")
  const startTime = performance.now()
  const index = await getSkillIndex()
  const duration = (performance.now() - startTime).toFixed(2)

  console.log(`✅ Descubrimiento completado en ${duration}ms`)
  console.log(`\n📊 Resumen:`)
  console.log(`   - Total skills: ${index.skills.length}`)
  console.log(`   - Local: ${index.sources.local}`)
  console.log(`   - User: ${index.sources.user}`)
  console.log(`   - Cached: ${index.sources.cached}`)
  console.log(`   - Embedded: ${index.sources.embedded}`)

  // 3. Listar skills encontrados
  if (index.skills.length > 0) {
    console.log(`\n📝 Skills encontrados:`)
    for (const skill of index.skills) {
      const warnings = skill.warnings.length > 0 ? ` ⚠️ (${skill.warnings.length} warnings)` : ""
      console.log(`   - ${skill.name} [${skill.source}]${warnings}`)
      console.log(`     "${skill.description}"`)
    }
  }

  // 4. Probar resolver
  console.log("\n🔧 Probando SkillResolver...")
  const resolver = new SkillResolver()

  if (index.skills.length > 0) {
    const firstSkill = index.skills[0]
    const resolved = await resolver.resolve(firstSkill.name)
    if (resolved) {
      console.log(`✅ Resolver funciona: encontró "${resolved.name}"`)

      // Cargar skill completo
      const loaded = await resolver.load(firstSkill.name)
      if (loaded) {
        console.log(`✅ Carga de contenido funciona: ${loaded.content.length} caracteres`)
      }
    }
  }

  // 5. Generar sección de contexto
  console.log("\n📄 Generando sección de contexto para LLM...")
  const contextSection = buildSkillIndexSection(index)
  if (contextSection) {
    const lines = contextSection.split("\n").length
    console.log(`✅ Sección generada: ${lines} líneas, ${contextSection.length} caracteres`)
    console.log("\n--- Preview del contexto ---")
    console.log(contextSection.slice(0, 500) + (contextSection.length > 500 ? "\n..." : ""))
  } else {
    console.log("ℹ️  No se generó contexto (sin skills disponibles)")
  }

  console.log("\n✅ Verificación completada!")
}

main().catch(console.error)
