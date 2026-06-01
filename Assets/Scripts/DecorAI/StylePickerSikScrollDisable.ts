/**
 * Disable SIK ScrollView / ScrollBar script components (inspector names).
 * SIK ScrollBar registers Interactable drag in onAwake — keep these disabled in the scene.
 */

/** Inspector "Name" field on ScriptComponent (not on public typings). */
export function getScriptInspectorName(script: ScriptComponent): string {
  const raw = script['name']
  return typeof raw === 'string' ? raw : ''
}

export function isSikScrollScriptName(name: string): boolean {
  return name === 'ScrollView' || name === 'ScrollBar'
}

export function disableSikScrollScriptsUnder(root: SceneObject): void {
  const stack: SceneObject[] = [root]
  while (stack.length > 0) {
    const node = stack.pop()!
    for (let i = 0; i < node.getChildrenCount(); i++) {
      stack.push(node.getChild(i))
    }
    const scripts = node.getComponents('Component.Script') as ScriptComponent[]
    for (let j = 0; j < scripts.length; j++) {
      const script = scripts[j]
      if (isSikScrollScriptName(getScriptInspectorName(script))) {
        script.enabled = false
      }
    }
  }
}

/** Walk from node up to root, disabling SIK scroll scripts on each ancestor. */
export function disableSikScrollScriptsOnAncestors(node: SceneObject): void {
  let current: SceneObject | null = node
  while (current) {
    disableSikScrollScriptsUnder(current)
    current = current.getParent()
  }
}
