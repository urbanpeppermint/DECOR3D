import { ScrollView } from 'SpectaclesInteractionKit.lspkg/Components/UI/ScrollView/ScrollView'
import NativeLogger from 'SpectaclesInteractionKit.lspkg/Utils/NativeLogger'
import { STYLES } from './DecorStyleCatalog'
import { bindStylePickButtonForRow } from './StylePickerButtonBinder'
import { StylePickerController } from './StylePickerController'
import { StylePickerScrollViewItem } from './StylePickerScrollViewItem'
import { applyPointAnchors, ensureSikScreenTransformsOnSubtree } from './StylePickerSikScreenTransforms'

const DEFAULT_ROW_WIDTH = 20
const DEFAULT_ROW_HEIGHT = 5.4
const DEFAULT_Y_OFFSET = -5.4

/**
 * Builds style rows as direct children of ScrollViewContent (SIK Rocket pattern).
 * Prefers an existing styleroesholder / PickerRoot sibling under Content, then prefab spawn.
 */
@component
export class StylePickerScrollContentCreator extends BaseScriptComponent {
  @input
  @allowUndefined
  stylePickerController: StylePickerController

  @input
  @allowUndefined
  styleRowsHolderPrefab: ObjectPrefab

  @input
  @allowUndefined
  styleRowPrefab: ObjectPrefab

  @input
  @allowUndefined
  styleRowPrefabs: ObjectPrefab[] = []

  @input
  rebuildOnStart: boolean = true

  @input
  @hint('First row center Y. Ignored when syncLayoutFromController is on — use StylePickerController scrollItemYStart instead.')
  yStart: number = 0

  @input
  @hint('Y step per row (negative = list grows downward).')
  yOffset: number = DEFAULT_Y_OFFSET

  @input
  @hint('When on, row layout uses StylePickerController scrollItemYStart / scrollItemYStep / scrollRowHeight / scrollRowWidth.')
  syncLayoutFromController: boolean = true

  @input
  @hint('Extra space above row 0 inside the scroll content (local Y).')
  contentPaddingTop: number = 0

  @input
  @hint('0 = match ScrollView viewport width.')
  rowWidth: number = 0

  @input
  rowHeight: number = DEFAULT_ROW_HEIGHT

  @input
  @hint('Off = only recompute scroll bounds (keeps yStart padding). On = SIK snap content top to viewport (clips first row).')
  snapContentTopOnRefresh: boolean = false

  private readonly log = new NativeLogger('StylePickerScrollContentCreator')
  private built: boolean = false

  onAwake(): void {
    // RocketGridContentCreator: spawn rows on ScrollViewContent in onAwake (not OnStart).
    if (this.rebuildOnStart) {
      this.clearChildren(this.getScrollContent())
    }
    this.buildWhenReady()
    this.createEvent('OnStartEvent').bind(() => {
      this.buildWhenReady()
    })
    const retry = this.createEvent('DelayedCallbackEvent')
    retry.bind(() => {
      this.buildWhenReady()
    })
    retry.reset(0.15)
  }

  private buildWhenReady(): void {
    if (this.built) {
      return
    }

    const controller = this.resolveController()
    if (!controller) {
      this.log.e('Assign stylePickerController (scene StylePicker / DecorAI_StylePicker → StylePickerController)')
      return
    }

    const content = this.getScrollContent()
    if (this.rebuildOnStart) {
      this.clearChildren(content)
    } else if (content.getChildrenCount() > 0) {
      this.layoutAndBindExisting(content, controller)
      return
    }

    let rows = this.adoptRowsFromSceneHolder(content)
    if (rows.length === 0) {
      rows = this.spawnRowsFromPrefabs(content)
    }
    if (rows.length === 0) {
      this.log.e('No rows — add styleroesholder under Content or assign styleRowsHolderPrefab')
      return
    }

    const layout = this.resolveLayoutParams(controller)
    for (let i = 0; i < rows.length; i++) {
      this.layoutRow(rows[i], i, layout.bandW, layout.bandH, layout.yStart, layout.yOffset)
      this.bindRow(rows[i], i, controller)
    }
    this.ensureScreenTransformsForScrollContent(content)
    this.resizeContentBounds(content, rows.length, layout)
    this.scheduleScrollViewRefresh(content)
    this.built = true
    this.log.i(
      `Ready: ${rows.length} rows @ yStart=${layout.yStart.toFixed(2)} step=${layout.yOffset.toFixed(2)} padTop=${layout.paddingTop.toFixed(2)}`,
    )
  }

  /** Re-run row layout (e.g. after inspector tweaks or showMenu). Does not respawn prefabs. */
  relayout(): void {
    const controller = this.resolveController()
    if (!controller) {
      return
    }
    const content = this.getScrollContent()
    if (content.getChildrenCount() < 1) {
      this.built = false
      this.buildWhenReady()
      return
    }
    this.layoutAndBindExisting(content, controller)
  }

  /**
   * SIK VisualBoundariesProvider requires ScreenTransform on every SceneObject in the
   * ScrollViewContent tree. UIKit RectangleButton adds a child named "Collider" after
   * onInitialized — refresh boundaries only after ST exists on the full hierarchy.
   */
  private scheduleScrollViewRefresh(content: SceneObject): void {
    const scrollViewObj = content.getParent()
    if (!scrollViewObj) {
      return
    }
    const scrollView = scrollViewObj.getComponent(ScrollView.getTypeName()) as ScrollView | null
    if (!scrollView) {
      this.log.w('ScrollViewContent parent has no SIK ScrollView — enable ScrollView on sibling')
      return
    }

    const attempt = (): void => {
      this.ensureScreenTransformsForScrollContent(content)
      if (!scrollView.isReady) {
        scrollView.onReady.add(() => {
          this.ensureScreenTransformsForScrollContent(content)
          scrollView.recomputeBoundaries()
          if (this.snapContentTopOnRefresh) {
            scrollView.snapToEdges({ x: -1, y: 1, type: 'Content' })
          }
        })
        return
      }
      scrollView.recomputeBoundaries()
      if (this.snapContentTopOnRefresh) {
        scrollView.snapToEdges({ x: -1, y: 1, type: 'Content' })
      }
    }

    attempt()
    const delays = [0.15, 0.35, 0.6, 1.0]
    for (let i = 0; i < delays.length; i++) {
      const retry = this.createEvent('DelayedCallbackEvent')
      retry.bind(() => {
        attempt()
      })
      retry.reset(delays[i])
    }
  }

  private ensureScreenTransformsForScrollContent(content: SceneObject): void {
    const count = content.getChildrenCount()
    for (let i = 0; i < count; i++) {
      const row = content.getChild(i)
      const rowSt = row.getComponent('Component.ScreenTransform') as ScreenTransform | null
      const size = rowSt ? rowSt.offsets.getSize() : new vec2(DEFAULT_ROW_WIDTH, DEFAULT_ROW_HEIGHT)
      const bandW = Math.max(1, size.x)
      const bandH = Math.max(0.01, size.y)
      ensureSikScreenTransformsOnSubtree(row, { w: bandW, h: bandH })
    }
  }

  private resolveController(): StylePickerController | null {
    if (!isNull(this.stylePickerController)) {
      return this.stylePickerController
    }
    let node: SceneObject | null = this.getSceneObject()
    for (let depth = 0; depth < 8 && node; depth++) {
      const c = node.getComponent(StylePickerController.getTypeName()) as StylePickerController | null
      if (c) {
        this.stylePickerController = c
        return c
      }
      node = node.getParent()
    }
    return null
  }

  private clearChildren(parent: SceneObject): void {
    while (parent.getChildrenCount() > 0) {
      parent.getChild(0).destroy()
    }
  }

  private layoutAndBindExisting(content: SceneObject, controller: StylePickerController): void {
    const n = content.getChildrenCount()
    const rows: SceneObject[] = []
    for (let i = 0; i < n; i++) {
      rows.push(content.getChild(i))
    }
    const sorted = this.sortRowsByStyle(rows)
    const layout = this.resolveLayoutParams(controller)
    for (let i = 0; i < sorted.length; i++) {
      this.layoutRow(sorted[i], i, layout.bandW, layout.bandH, layout.yStart, layout.yOffset)
      this.bindRow(sorted[i], i, controller)
    }
    this.ensureScreenTransformsForScrollContent(content)
    this.resizeContentBounds(content, sorted.length, layout)
    this.scheduleScrollViewRefresh(content)
    this.built = true
  }

  private resolveLayoutParams(controller: StylePickerController): {
    yStart: number
    yOffset: number
    bandW: number
    bandH: number
    paddingTop: number
  } {
    const content = this.getScrollContent()
    let yStart = this.yStart
    let yOffset = this.yOffset
    let bandH = this.rowHeight > 0 ? this.rowHeight : Math.abs(this.yOffset)
    let bandW = this.rowWidth > 0.01 ? this.rowWidth : this.resolveRowWidth(content)

    if (this.syncLayoutFromController) {
      yStart = controller.scrollItemYStart
      yOffset = controller.scrollItemYStep
      if (controller.scrollRowHeight > 0.01) {
        bandH = controller.scrollRowHeight
      }
      if (controller.scrollRowWidth > 0.01) {
        bandW = controller.scrollRowWidth
      }
    }

    bandH = Math.max(0.01, bandH)
    bandW = Math.max(1, bandW)
    return {
      yStart,
      yOffset,
      bandW,
      bandH,
      paddingTop: this.contentPaddingTop,
    }
  }

  /** styleroesholder / PickerRoot placed next to ScrollView under Content. */
  private adoptRowsFromSceneHolder(content: SceneObject): SceneObject[] {
    const contentObj = content.getParent()
    if (!contentObj) {
      return []
    }
    const shell = contentObj.getParent()
    if (!shell) {
      return []
    }
    for (let i = 0; i < shell.getChildrenCount(); i++) {
      const holder = shell.getChild(i)
      if (holder === contentObj) {
        continue
      }
      const name = holder.name.toLowerCase()
      if (
        !name.includes('holder') &&
        !name.includes('pickerroot') &&
        !name.includes('stylerow')
      ) {
        continue
      }
      if (holder.getChildrenCount() < 1) {
        continue
      }
      this.log.i(`Adopting rows from scene object "${holder.name}"`)
      return this.reparentHolderChildren(holder, content)
    }
    return []
  }

  private reparentHolderChildren(holder: SceneObject, content: SceneObject): SceneObject[] {
    const collected: SceneObject[] = []
    const n = holder.getChildrenCount()
    for (let i = 0; i < n; i++) {
      collected.push(holder.getChild(i))
    }
    for (let i = 0; i < collected.length; i++) {
      collected[i].setParent(content)
      collected[i].enabled = true
    }
    holder.enabled = false
    return this.sortRowsByStyle(collected)
  }

  private spawnRowsFromPrefabs(content: SceneObject): SceneObject[] {
    if (this.styleRowsHolderPrefab) {
      const holder = this.styleRowsHolderPrefab.instantiate(content.getParent() || content)
      holder.enabled = true
      if (holder.getChildrenCount() >= STYLES.length) {
        const rows = this.reparentHolderChildren(holder, content)
        holder.destroy()
        if (rows.length > 0) {
          return rows
        }
      }
      holder.destroy()
    }
    const prefabs = this.resolvePrefabs()
    if (prefabs.length === 0) {
      return []
    }
    const rows: SceneObject[] = []
    for (let i = 0; i < STYLES.length; i++) {
      const row = prefabs[i % prefabs.length].instantiate(content)
      row.enabled = true
      rows.push(row)
    }
    return rows
  }

  /** SIK rows live under ScrollViewContent (child of ScrollView), not ScrollViewCanvas. */
  private getScrollContent(): SceneObject {
    if (this.sceneObject.name === 'ScrollViewContent') {
      return this.sceneObject
    }
    const fromParent = this.findScrollViewContentUnder(this.sceneObject)
    if (fromParent) {
      return fromParent
    }
    const controller = this.resolveController()
    if (controller) {
      const fromPicker = this.findScrollViewContentUnder(controller.pickerRoot)
      if (fromPicker) {
        return fromPicker
      }
    }
    return this.sceneObject
  }

  private findScrollViewContentUnder(root: SceneObject | null): SceneObject | null {
    if (!root) {
      return null
    }
    const stack: SceneObject[] = [root]
    while (stack.length > 0) {
      const node = stack.pop()!
      if (node.name === 'ScrollViewContent') {
        return node
      }
      for (let i = 0; i < node.getChildrenCount(); i++) {
        stack.push(node.getChild(i))
      }
    }
    return null
  }

  private resolvePrefabs(): ObjectPrefab[] {
    if (this.styleRowPrefabs.length > 0) {
      return this.styleRowPrefabs
    }
    if (!isNull(this.styleRowPrefab)) {
      return [this.styleRowPrefab]
    }
    const controller = this.resolveController()
    if (controller && !isNull(controller.styleRowPrefab)) {
      return [controller.styleRowPrefab]
    }
    return []
  }

  private resolveRowWidth(content: SceneObject): number {
    if (this.rowWidth > 0.01) {
      return this.rowWidth
    }
    const scrollView = content.getParent()
    if (!scrollView) {
      return DEFAULT_ROW_WIDTH
    }
    const vst = scrollView.getComponent('Component.ScreenTransform') as ScreenTransform | null
    if (!vst) {
      return DEFAULT_ROW_WIDTH
    }
    const size = vst.offsets.getSize()
    if (size.x > 0.01) {
      return size.x
    }
    const fromEdges = Math.abs(vst.offsets.right - vst.offsets.left)
    if (fromEdges > 0.01) {
      return fromEdges
    }
    return DEFAULT_ROW_WIDTH
  }

  private sortRowsByStyle(rows: SceneObject[]): SceneObject[] {
    const sorted: Array<SceneObject | null> = new Array(STYLES.length).fill(null)
    for (let i = 0; i < rows.length; i++) {
      const idx = this.styleIndexForRowName(rows[i].name)
      if (idx >= 0 && idx < STYLES.length && sorted[idx] === null) {
        sorted[idx] = rows[i]
      }
    }
    const out: SceneObject[] = []
    for (let i = 0; i < sorted.length; i++) {
      if (sorted[i] !== null) {
        out.push(sorted[i]!)
      }
    }
    for (let i = 0; i < rows.length; i++) {
      if (!out.includes(rows[i])) {
        out.push(rows[i])
      }
    }
    return out
  }

  private styleIndexForRowName(name: string): number {
    const key = name.toLowerCase().replace(/[^a-z0-9]/g, '')
    for (let i = 0; i < STYLES.length; i++) {
      const id = STYLES[i].id.replace(/_/g, '')
      if (key.includes(id)) {
        return i
      }
    }
    if (key.includes('farmhouse')) {
      return STYLES.findIndex((s) => s.id === 'modern_farmhouse')
    }
    if (key.includes('midcentury') || key.includes('midcent')) {
      return STYLES.findIndex((s) => s.id === 'midcentury')
    }
    if (key.includes('scandi')) {
      return STYLES.findIndex((s) => s.id === 'scandinavian')
    }
    return -1
  }

  private layoutRow(
    row: SceneObject,
    index: number,
    bandW: number,
    bandH: number,
    yStart: number,
    yOffset: number,
  ): void {
    const style = STYLES[index]
    if (style) {
      row.name = `StyleRow_${style.id}`
    }
    row.getTransform().setLocalPosition(new vec3(0, 0, 0))

    const st = this.ensureRowScreenTransform(row)
    if (!st) {
      return
    }

    applyPointAnchors(st)
    const y = this.contentPaddingTop + yStart + yOffset * index
    st.offsets.setSize(new vec2(bandW, bandH))
    st.offsets.setCenter(new vec2(0, y))
    ensureSikScreenTransformsOnSubtree(row, { w: bandW, h: bandH })
  }

  private ensureRowScreenTransform(row: SceneObject): ScreenTransform | null {
    let st = row.getComponent('Component.ScreenTransform') as ScreenTransform | null
    if (!st) {
      st = row.createComponent('Component.ScreenTransform') as ScreenTransform
      this.log.i(`Added ScreenTransform on row "${row.name}"`)
    }
    return st
  }

  private resizeContentBounds(
    content: SceneObject,
    rowCount: number,
    layout: { yStart: number; yOffset: number; bandW: number; bandH: number; paddingTop: number },
  ): void {
    if (rowCount <= 0) {
      return
    }
    const st = content.getComponent('Component.ScreenTransform') as ScreenTransform | null
    if (!st) {
      return
    }
    const firstY = layout.paddingTop + layout.yStart
    const lastY = layout.paddingTop + layout.yStart + layout.yOffset * (rowCount - 1)
    const contentH = Math.abs(lastY - firstY) + layout.bandH
    const contentCenterY = (firstY + lastY) * 0.5

    applyPointAnchors(st)
    st.offsets.setSize(new vec2(layout.bandW, contentH))
    st.offsets.setCenter(new vec2(0, contentCenterY))
  }

  private bindRow(row: SceneObject, styleIndex: number, controller: StylePickerController): void {
    if (styleIndex < 0 || styleIndex >= STYLES.length) {
      return
    }
    const style = STYLES[styleIndex]
    this.applyRowLabels(row, style.displayName, style.blurb)

    const item = row.getComponent(StylePickerScrollViewItem.getTypeName()) as StylePickerScrollViewItem | null
    if (item !== null) {
      item.init(controller, styleIndex)
      return
    }

    const content = this.getScrollContent()
    bindStylePickButtonForRow(
      this,
      row,
      style.id,
      (id) => {
        controller.pickStyle(id)
      },
      () => {
        const layout = this.resolveLayoutParams(controller)
        ensureSikScreenTransformsOnSubtree(row, { w: layout.bandW, h: layout.bandH })
        this.scheduleScrollViewRefresh(content)
      },
    )
  }

  private applyRowLabels(row: SceneObject, title: string, blurb: string): void {
    const texts: Text[] = []
    this.collectTextsDepthFirst(row, 6, texts)
    if (texts.length >= 1) {
      texts[0].text = title
    }
    if (texts.length >= 2) {
      texts[1].text = blurb
    }
  }

  private collectTextsDepthFirst(root: SceneObject, maxDepth: number, out: Text[]): void {
    const t = root.getComponent('Component.Text') as Text | null
    if (t) {
      out.push(t)
    }
    if (maxDepth <= 0) {
      return
    }
    const c = root.getChildrenCount()
    for (let i = 0; i < c; i++) {
      this.collectTextsDepthFirst(root.getChild(i), maxDepth - 1, out)
    }
  }
}
