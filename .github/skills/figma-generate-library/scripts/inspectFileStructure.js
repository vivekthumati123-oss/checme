/**
 * inspectFileStructure
 *
 * Reads the current Figma file and returns a structural inventory:
 * the current page, all local variable collections (with mode names and
 * variable counts), the current page's component sets, all local text styles,
 * and all local effect styles.
 *
 * This is a read-only discovery function — it never creates or mutates nodes.
 * Run it at the start of Phase 0 to understand what already exists before
 * planning any creation work.
 *
 * @returns {Promise<{
 *   page: {id: string, name: string, childCount: number},
 *   variableCollections: Array<{
 *     id: string,
 *     name: string,
 *     modes: Array<{modeId: string, name: string}>,
 *     variableCount: number,
 *     variableNames: string[]
 *   }>,
 *   componentSets: Array<{id: string, name: string, variantCount: number, pageId: string, pageName: string}>,
 *   textStyles: Array<{id: string, name: string, fontFamily: string, fontStyle: string, fontSize: number}>,
 *   effectStyles: Array<{id: string, name: string, effectCount: number}>
 * }>}
 */
async function inspectFileStructure() {
  const result = {
    page: {
      id: figma.currentPage.id,
      name: figma.currentPage.name,
      childCount: figma.currentPage.children.length,
    },
    variableCollections: [],
    componentSets: [],
    textStyles: [],
    effectStyles: [],
  }

  // --- Variable collections ---
  const collections = await figma.variables.getLocalVariableCollectionsAsync()
  for (const coll of collections) {
    const variables = await Promise.all(
      coll.variableIds.map((id) => figma.variables.getVariableByIdAsync(id)),
    )
    const variableNames = variables.filter(Boolean).map((v) => v.name)

    result.variableCollections.push({
      id: coll.id,
      name: coll.name,
      modes: coll.modes.map((m) => ({ modeId: m.modeId, name: m.name })),
      variableCount: coll.variableIds.length,
      variableNames,
    })
  }

  // --- Component sets (and standalone components) ---
  // Keep this helper scoped to the current page. Figma's execution context
  // allows only one page switch per call, so callers needing a file-wide
  // inventory should list page IDs first and run this helper once per page.
  const page = figma.currentPage
  const found = page.findAllWithCriteria({ types: ['COMPONENT_SET', 'COMPONENT'] })
  for (const node of found) {
    if (node.type === 'COMPONENT_SET') {
      result.componentSets.push({
        id: node.id,
        name: node.name,
        variantCount: node.children.length,
        pageId: page.id,
        pageName: page.name,
      })
    } else if (node.parent && node.parent.type !== 'COMPONENT_SET') {
      // Standalone component (not a variant inside a COMPONENT_SET)
      result.componentSets.push({
        id: node.id,
        name: node.name,
        variantCount: 1,
        pageId: page.id,
        pageName: page.name,
      })
    }
  }

  // --- Text styles ---
  const textStyles = await figma.getLocalTextStylesAsync()
  for (const ts of textStyles) {
    result.textStyles.push({
      id: ts.id,
      name: ts.name,
      fontFamily: ts.fontName.family,
      fontStyle: ts.fontName.style,
      fontSize: ts.fontSize,
    })
  }

  // --- Effect styles ---
  const effectStyles = await figma.getLocalEffectStylesAsync()
  for (const es of effectStyles) {
    result.effectStyles.push({
      id: es.id,
      name: es.name,
      effectCount: es.effects.length,
    })
  }

  return result
}
