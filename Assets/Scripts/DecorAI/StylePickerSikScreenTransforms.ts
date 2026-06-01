/**
 * SIK VisualBoundariesProvider walks every SceneObject under ScrollViewContent and
 * throws if any node lacks ScreenTransform (including UIKit RectangleButton "Collider" children).
 */
export function applyPointAnchors(st: ScreenTransform): void {
  st.anchors.left = 0
  st.anchors.right = 0
  st.anchors.top = 0
  st.anchors.bottom = 0
}

export function hasFullBleedAnchors(st: ScreenTransform): boolean {
  return st.anchors.left <= -0.5 || st.anchors.right >= 0.5 || st.anchors.bottom <= -0.5 || st.anchors.top >= 0.5
}

/**
 * Ensures every node has ScreenTransform for SIK scroll bounds.
 * Row children with full-bleed (-1..1) anchors are converted to a centered band (prefab-safe).
 * Existing point-anchor children keep their offsets (your hand-tuned layout).
 */
export function ensureSikScreenTransformsOnSubtree(
  root: SceneObject,
  rowBand?: { w: number; h: number },
): void {
  const stack: SceneObject[] = [root]
  while (stack.length > 0) {
    const node = stack.pop()!
    const isRowRoot = node === root
    let st = node.getComponent('Component.ScreenTransform') as ScreenTransform | null

    if (!st) {
      st = node.createComponent('Component.ScreenTransform') as ScreenTransform
      applyPointAnchors(st)
      if (!isRowRoot && rowBand) {
        st.offsets.setSize(new vec2(rowBand.w, rowBand.h))
        st.offsets.setCenter(new vec2(0, 0))
      }
    } else if (!isRowRoot && hasFullBleedAnchors(st)) {
      applyPointAnchors(st)
      if (rowBand) {
        st.offsets.setSize(new vec2(rowBand.w, rowBand.h))
        st.offsets.setCenter(new vec2(0, 0))
      }
    }
    // Row root + already-tuned point-anchor children: leave offsets unchanged.

    const n = node.getChildrenCount()
    for (let i = 0; i < n; i++) {
      stack.push(node.getChild(i))
    }
  }
}
