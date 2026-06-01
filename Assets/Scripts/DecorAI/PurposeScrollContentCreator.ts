import { ScrollView } from 'SpectaclesInteractionKit.lspkg/Components/UI/ScrollView/ScrollView'
import NativeLogger from 'SpectaclesInteractionKit.lspkg/Utils/NativeLogger'
import { bindStylePickButton, findStyleButtonUnder } from './StylePickerButtonBinder'
import { applyPointAnchors, ensureSikScreenTransformsOnSubtree } from './StylePickerSikScreenTransforms'
import { RoomPurposePanel } from './RoomPurposePanel'

const ROOM_PURPOSES: string[] = [
  'Living Room',
  'Bedroom',
  'Kitchen',
  'Home Office',
  'Laundry Room',
  'Dining Room',
  'Reading Nook',
  'Storage / Utility',
  'Nursery',
  'Gym / Workout',
  'Studio / Craft Room',
  'Walk-in Closet',
]

const DEFAULT_ROW_WIDTH = 22
const DEFAULT_ROW_HEIGHT = 5.4
const DEFAULT_Y_STEP = -5.4

/**
 * Attach to **ScrollViewContent** inside the purpose panel's ScrollView.
 * Same role as StylePickerScrollContentCreator: spawns row prefabs, lays
 * them out with ScreenTransform offsets, resizes content bounds, and tells
 * the SIK ScrollView to recompute.
 *
 * Row taps call `RoomPurposePanel.selectPurpose(purpose)`.
 */
@component
export class PurposeScrollContentCreator extends BaseScriptComponent {
  @input
  @allowUndefined
  @hint('The RoomPurposePanel — receives selectPurpose() on tap.')
  purposePanel: RoomPurposePanel

  @input
  @allowUndefined
  @hint('Single-row prefab (BaseButton + Text). One instance per purpose.')
  rowPrefab: ObjectPrefab

  @input
  rebuildOnStart: boolean = true

  @input
  @hint('Center Y of the first row (ScreenTransform offset units).')
  yStart: number = 0

  @input
  @hint('Y step per row (negative = downward).')
  yStep: number = DEFAULT_Y_STEP

  @input
  @hint('0 = use default.')
  rowWidth: number = DEFAULT_ROW_WIDTH

  @input
  rowHeight: number = DEFAULT_ROW_HEIGHT

  private readonly log = new NativeLogger('PurposeScrollContentCreator')
  private built: boolean = false
  private lastRowCount: number = 0
  private lastBandW: number = DEFAULT_ROW_WIDTH
  private lastBandH: number = DEFAULT_ROW_HEIGHT

  onAwake(): void {
    const content = this.getScrollContent()
    if (this.rebuildOnStart) {
      this.clearChildren(content)
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

  relayout(): void {
    const content = this.getScrollContent()
    if (content.getChildrenCount() < 1) {
      this.built = false
      this.buildWhenReady()
      return
    }
    this.layoutAndBindAll(content)
  }

  private buildWhenReady(): void {
    if (this.built) {
      return
    }
    if (!this.rowPrefab) {
      this.log.e('Assign rowPrefab — single-row prefab with BaseButton + Text')
      return
    }

    const content = this.getScrollContent()
    if (this.rebuildOnStart) {
      this.clearChildren(content)
    }

    if (content.getChildrenCount() < ROOM_PURPOSES.length) {
      this.clearChildren(content)
      for (let i = 0; i < ROOM_PURPOSES.length; i++) {
        const row = this.rowPrefab.instantiate(content)
        row.name = `Purpose_${ROOM_PURPOSES[i].replace(/[\s\/]/g, '_')}`
        row.enabled = true
      }
      this.log.i(`Spawned ${ROOM_PURPOSES.length} rows in ScrollViewContent`)
    }

    this.layoutAndBindAll(content)
  }

  private layoutAndBindAll(content: SceneObject): void {
    const bandW = Math.max(1, this.rowWidth)
    const bandH = Math.max(0.01, this.rowHeight)
    const n = Math.min(content.getChildrenCount(), ROOM_PURPOSES.length)

    for (let i = 0; i < n; i++) {
      const row = content.getChild(i)
      this.layoutRow(row, i, bandW, bandH)
      this.labelRow(row, i)
      this.bindRow(row, i, content, bandW, bandH)
    }

    this.lastRowCount = n
    this.lastBandW = bandW
    this.lastBandH = bandH
    this.ensureScreenTransformsForScrollContent(content)
    this.resizeContentBounds(content, n, bandW, bandH)
    this.scheduleScrollViewRefresh(content)
    this.built = true
    this.log.i(
      `Ready: ${n} purpose rows @ yStart=${this.yStart.toFixed(2)} step=${this.yStep.toFixed(2)}`,
    )
  }

  private layoutRow(
    row: SceneObject,
    index: number,
    bandW: number,
    bandH: number,
  ): void {
    row.getTransform().setLocalPosition(new vec3(0, 0, 0))

    const st = this.ensureScreenTransform(row)
    applyPointAnchors(st)
    st.offsets.setSize(new vec2(bandW, bandH))
    st.offsets.setCenter(new vec2(0, this.yStart + this.yStep * index))
    ensureSikScreenTransformsOnSubtree(row, { w: bandW, h: bandH })
  }

  private labelRow(row: SceneObject, index: number): void {
    const texts: Text[] = []
    this.collectTextsDepthFirst(row, 6, texts)
    if (texts.length >= 1) {
      texts[0].text = ROOM_PURPOSES[index]
    }
  }

  /**
   * Uses the shared `bindStylePickButton` helper — same pattern as
   * StylePickerScrollContentCreator. The `afterInitialized` callback
   * refreshes ScreenTransforms (for dynamically created "Collider"
   * children) and recomputes ScrollView bounds.
   */
  private bindRow(
    row: SceneObject,
    index: number,
    content: SceneObject,
    bandW: number,
    bandH: number,
  ): void {
    const btn = findStyleButtonUnder(row, 6)
    if (!btn) {
      this.log.w(`"${row.name}" has no BaseButton`)
      return
    }
    const purpose = ROOM_PURPOSES[index]
    bindStylePickButton(
      this,
      btn,
      () => {
        const panel = this.resolvePanel()
        if (panel) {
          panel.selectPurpose(purpose)
        } else {
          this.log.w('No RoomPurposePanel wired — tap ignored')
        }
      },
      () => {
        ensureSikScreenTransformsOnSubtree(row, { w: bandW, h: bandH })
        this.scheduleScrollViewRefresh(content)
      },
    )
  }

  /**
   * Mirrors StylePickerScrollContentCreator.scheduleScrollViewRefresh:
   * get parent ScrollView, call recomputeBoundaries with retry delays.
   */
  private scheduleScrollViewRefresh(content: SceneObject): void {
    const scrollViewObj = content.getParent()
    if (!scrollViewObj) {
      return
    }
    const scrollView = scrollViewObj.getComponent(
      ScrollView.getTypeName(),
    ) as ScrollView | null
    if (!scrollView) {
      this.log.w('ScrollViewContent parent has no SIK ScrollView — check hierarchy')
      return
    }

    const attempt = (): void => {
      this.ensureScreenTransformsForScrollContent(content)
      if (!scrollView.isReady) {
        scrollView.onReady.add(() => {
          this.ensureScreenTransformsForScrollContent(content)
          scrollView.recomputeBoundaries()
        })
        return
      }
      scrollView.recomputeBoundaries()
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

  private resolvePanel(): RoomPurposePanel | null {
    if (this.purposePanel) {
      return this.purposePanel
    }
    let node: SceneObject | null = this.getSceneObject()
    for (let depth = 0; depth < 10 && node; depth++) {
      const c = node.getComponent(
        RoomPurposePanel.getTypeName(),
      ) as RoomPurposePanel | null
      if (c) {
        this.purposePanel = c
        return c
      }
      node = node.getParent()
    }
    return null
  }

  private ensureScreenTransform(obj: SceneObject): ScreenTransform {
    let st = obj.getComponent('Component.ScreenTransform') as ScreenTransform | null
    if (!st) {
      st = obj.createComponent('Component.ScreenTransform') as ScreenTransform
    }
    return st
  }

  private resizeContentBounds(
    content: SceneObject,
    rowCount: number,
    bandW: number,
    bandH: number,
  ): void {
    if (rowCount <= 0) {
      return
    }
    const st = this.ensureScreenTransform(content)
    const firstY = this.yStart
    const lastY = this.yStart + this.yStep * (rowCount - 1)
    const contentH = Math.abs(lastY - firstY) + bandH
    const contentCenterY = (firstY + lastY) * 0.5
    applyPointAnchors(st)
    st.offsets.setSize(new vec2(bandW, contentH))
    st.offsets.setCenter(new vec2(0, contentCenterY))
  }

  private getScrollContent(): SceneObject {
    if (this.sceneObject.name === 'ScrollViewContent') {
      return this.sceneObject
    }
    const found = this.findChildByName(this.sceneObject, 'ScrollViewContent')
    return found ?? this.sceneObject
  }

  private clearChildren(parent: SceneObject): void {
    while (parent.getChildrenCount() > 0) {
      parent.getChild(0).destroy()
    }
  }

  private findChildByName(root: SceneObject, name: string): SceneObject | null {
    const stack: SceneObject[] = [root]
    while (stack.length > 0) {
      const node = stack.pop()!
      if (node !== root && node.name === name) {
        return node
      }
      for (let i = 0; i < node.getChildrenCount(); i++) {
        stack.push(node.getChild(i))
      }
    }
    return null
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
