import Event from 'SpectaclesInteractionKit.lspkg/Utils/Event'
import NativeLogger from 'SpectaclesInteractionKit.lspkg/Utils/NativeLogger'
import animate from 'SpectaclesInteractionKit.lspkg/Utils/animate'
import { BaseButton } from 'SpectaclesUIKit.lspkg/Scripts/Components/Button/BaseButton'
import { DecorStyleId } from './DecorTypes'
import { STYLES } from './DecorStyleCatalog'
import { bindStylePickButton, findStyleButtonUnder } from './StylePickerButtonBinder'
import { StylePickerListScroll } from './StylePickerListScroll'
import { StylePickerBlurbHover } from './StylePickerBlurbHover'
import { StylePickerScrollContentCreator } from './StylePickerScrollContentCreator'
import { applyPointAnchors } from './StylePickerSikScreenTransforms'
import { disableSikScrollScriptsUnder, getScriptInspectorName } from './StylePickerSikScrollDisable'

/**
 * Style picker before scanning.
 *
 * **SIK ScrollView (Rocket / ScrollViewCanvasExample pattern)** — under menu shell:
 * `Content` (ScreenTransform) → `ScrollView` (+ SIK ScrollView) → `ScrollViewContent`
 * with **StylePickerScrollContentCreator** (instantiates row prefabs, `setCenter` stack).
 * `ScrollBar` + `ScrollBarSlider` are **siblings** of `ScrollView` under `Content`.
 * Set binding **Scroll list**, `scrollStyleRowsParent` → **ScrollViewContent**, `useWorldSpaceRows`
 * **off**, disable `StylePickerListScroll`, enable SIK `ScrollBar`. Rows/buttons are owned by
 * the content creator (not `styleRowPrefab` on this controller).
 *
 * **World-space rows** — stack rows with `Transform` local Y only; use `StylePickerListScroll`
 * on the shell to move `PickerRoot` when dragging the thumb. No SIK `ScrollView` / row ST.
 * SIK `ScrollBar` script should stay **disabled** (no sibling ScrollView).
 *
 * **Explicit mode** — assign each `*Button` and optional label `Text` in the inspector.
 *
 * **Scroll list mode** — bind from direct children of `scrollStyleRowsParent` in order
 * (`STYLES[0]` = first child, …); finds `BaseButton` up to depth 4 under each row.
 * Optional **`styleRowPrefab`**: when set in scroll-list mode, instantiates one prefab per
 * catalog entry under `scrollStyleRowsParent` (empty parent in editor). Use
 * `rebuildPrefabRowsOnStart` to wipe and respawn when iterating on layout.
 */
@component
export class StylePickerController extends BaseScriptComponent {
  @input
  @widget(
    new ComboBoxWidget([
      new ComboBoxItem('Explicit (inspector slot per style)', 'explicit'),
      new ComboBoxItem('Scroll list (row children = styles in order)', 'scrollChildren'),
    ]),
  )
  @hint('SIK: Scroll list + prefab rows under ScrollView content. Explicit = per-slot buttons.')
  styleButtonBindingMode: string = 'explicit'

  @input
  @hint('Root scaled to zero after a pick (usually the whole picker + scroll chrome).')
  pickerRoot: SceneObject

  @input
  @allowUndefined
  @hint('Parent of style row objects (e.g. PickerRoot). Children are stacked on local Y.')
  scrollStyleRowsParent: SceneObject

  @input
  @hint('Off = SIK ScrollView row layout (ScreenTransform + offsets). On = Transform stack + StylePickerListScroll.')
  useWorldSpaceRows: boolean = true

  @input
  @hint('Local Y for row 0 (first style).')
  rowYStart: number = 8

  @input
  @hint('Local Y step per row (downward).')
  rowSpacing: number = 6

  @input
  @allowUndefined
  @hint('Optional — refreshed after rows spawn so thumb scroll range is correct.')
  listScroll: StylePickerListScroll

  @input
  @hint('SIK row 0 center Y when StylePickerScrollContentCreator syncLayoutFromController is on.')
  scrollItemYStart: number = 0

  @input
  @hint('Legacy SIK ScrollView: vertical step per row.')
  scrollItemYStep: number = -5.4

  @input
  @hint('Legacy SIK ScrollView: row width (offsets).')
  scrollRowWidth: number = 32

  @input
  @hint('Legacy SIK ScrollView: row height (offsets).')
  scrollRowHeight: number = 5.4

  @input
  @allowUndefined
  @hint('Scroll list: one prefab instance per style under scrollStyleRowsParent (leave empty if rows are already in the scene).')
  styleRowPrefab: ObjectPrefab

  @input
  @hint('Scroll list: destroy all children of scrollStyleRowsParent then recreate from styleRowPrefab (uses catalog count).')
  rebuildPrefabRowsOnStart: boolean = false

  @ui.group_start('Buttons (explicit mode only)')
  @input
  @allowUndefined
  scandinavianButton: BaseButton
  @input
  @allowUndefined
  vintageButton: BaseButton
  @input
  @allowUndefined
  industrialButton: BaseButton
  @input
  @allowUndefined
  midcenturyButton: BaseButton
  @input
  @allowUndefined
  japandiButton: BaseButton
  @input
  @allowUndefined
  modernFarmhouseButton: BaseButton
  @input
  @allowUndefined
  bohoButton: BaseButton
  @input
  @allowUndefined
  minimalistButton: BaseButton
  @input
  @allowUndefined
  mediterraneanButton: BaseButton
  @input
  @allowUndefined
  eclecticButton: BaseButton
  @ui.group_end

  @ui.group_start('Optional label + blurb Text (explicit mode; filled from catalog at start)')
  @input
  @allowUndefined
  scandinavianLabel: Text
  @input
  @allowUndefined
  scandinavianBlurb: Text
  @input
  @allowUndefined
  vintageLabel: Text
  @input
  @allowUndefined
  vintageBlurb: Text
  @input
  @allowUndefined
  industrialLabel: Text
  @input
  @allowUndefined
  industrialBlurb: Text
  @input
  @allowUndefined
  midcenturyLabel: Text
  @input
  @allowUndefined
  midcenturyBlurb: Text
  @input
  @allowUndefined
  japandiLabel: Text
  @input
  @allowUndefined
  japandiBlurb: Text
  @input
  @allowUndefined
  modernFarmhouseLabel: Text
  @input
  @allowUndefined
  modernFarmhouseBlurb: Text
  @input
  @allowUndefined
  bohoLabel: Text
  @input
  @allowUndefined
  bohoBlurb: Text
  @input
  @allowUndefined
  minimalistLabel: Text
  @input
  @allowUndefined
  minimalistBlurb: Text
  @input
  @allowUndefined
  mediterraneanLabel: Text
  @input
  @allowUndefined
  mediterraneanBlurb: Text
  @input
  @allowUndefined
  eclecticLabel: Text
  @input
  @allowUndefined
  eclecticBlurb: Text
  @ui.group_end

  @input
  @allowUndefined
  @hint('Optional hover tooltip for row blurbs (SIK Interactable on each row).')
  blurbHover: StylePickerBlurbHover

  @input
  @hint('Duration (seconds) of the scale-out animation when the picker hides.')
  hideDurationSeconds: number = 0.45

  readonly onStyleSelected: Event<DecorStyleId> = new Event<DecorStyleId>()

  private readonly log = new NativeLogger('StylePickerController')
  private buttonsBound: boolean = false

  onAwake(): void {
    if (this.useWorldSpaceRows) {
      this.scrollStyleRowsParent = this.resolveWorldSpaceRowsParent()
      this.disableSikScrollChrome()
    }
    if (this.shouldSpawnPrefabRows()) {
      this.spawnPrefabRowsIfNeeded()
    }
    if (this.shouldApplyControllerRowLayout()) {
      this.applyRowLayout()
    }
    this.createEvent('OnStartEvent').bind(() => {
      this.applyLabels()
      if (this.shouldApplyControllerRowLayout()) {
        this.applyRowLayout()
      }
      this.bindButtonsWhenReady()
      if (this.useWorldSpaceRows) {
        this.refreshListScroll()
      }
      const retry = this.createEvent('DelayedCallbackEvent')
      retry.bind(() => {
        if (this.shouldApplyControllerRowLayout()) {
          this.applyRowLayout()
        }
        if (this.useWorldSpaceRows) {
          this.refreshListScroll()
        }
        this.bindButtonsWhenReady()
        this.refreshBlurbHover()
      })
      retry.reset(0.25)
    })
  }

  /** Called by StylePickerScrollViewItem / StylePickerScrollContentCreator when a row is tapped. */
  pickStyle(id: DecorStyleId): void {
    this.handlePick(id)
  }

  show(): void {
    this.showMenu()
  }

  /** Reopen the style list (after back-to-menu or first launch). */
  showMenu(): void {
    if (!this.pickerRoot) {
      return
    }
    this.pickerRoot.enabled = true
    this.pickerRoot.getTransform().setLocalScale(new vec3(1, 1, 1))
    this.applyLabels()
    const creator = this.findScrollContentCreator()
    if (creator) {
      creator.relayout()
    } else if (this.shouldApplyControllerRowLayout()) {
      this.applyRowLayout()
    }
    if (this.useWorldSpaceRows) {
      this.refreshListScroll()
    }
    this.refreshBlurbHover()
  }

  private refreshBlurbHover(): void {
    if (this.blurbHover) {
      this.blurbHover.refreshBindings()
    }
  }

  private isScrollChildMode(): boolean {
    return this.styleButtonBindingMode === 'scrollChildren'
  }

  /** SIK rows belong on ScrollViewContent; ignore mistaken ScrollViewCanvas assignment. */
  private resolveScrollRowsParent(): SceneObject | null {
    if (this.useWorldSpaceRows) {
      return this.resolveWorldSpaceRowsParent() ?? this.scrollStyleRowsParent
    }
    if (this.scrollStyleRowsParent && this.scrollStyleRowsParent.name === 'ScrollViewContent') {
      return this.scrollStyleRowsParent
    }
    const root = this.pickerRoot ?? this.sceneObject
    const content = this.findChildByName(root, 'ScrollViewContent')
    if (content) {
      if (this.scrollStyleRowsParent && this.scrollStyleRowsParent.name !== 'ScrollViewContent') {
        this.log.w(
          `scrollStyleRowsParent was "${this.scrollStyleRowsParent.name}" — using ScrollViewContent`,
        )
      }
      return content
    }
    return this.scrollStyleRowsParent
  }

  private findScrollContentCreator(): StylePickerScrollContentCreator | null {
    const root = this.pickerRoot ?? this.sceneObject
    const content = this.findChildByName(root, 'ScrollViewContent')
    if (!content) {
      return null
    }
    return content.getComponent(
      StylePickerScrollContentCreator.getTypeName(),
    ) as StylePickerScrollContentCreator | null
  }

  /**
   * Rows must live under PickerRoot (moves with StylePickerListScroll).
   * ScrollViewContent is only for SIK layout — wrong parent when useWorldSpaceRows is on.
   */
  private resolveWorldSpaceRowsParent(): SceneObject | null {
    if (!this.scrollStyleRowsParent) {
      return null
    }
    if (this.scrollStyleRowsParent.name !== 'ScrollViewContent') {
      return this.scrollStyleRowsParent
    }
    const pickerRoot = this.findChildByName(
      this.pickerRoot ?? this.sceneObject,
      'PickerRoot',
    )
    if (pickerRoot) {
      this.log.w(
        'scrollStyleRowsParent was ScrollViewContent — using PickerRoot for world-space rows',
      )
      return pickerRoot
    }
    return this.scrollStyleRowsParent
  }

  /** SIK ScrollBar hooks Interactable in onAwake — disable those scripts in the scene too. */
  private disableSikScrollChrome(): void {
    const root = this.pickerRoot ?? this.sceneObject
    const scrollView = this.findChildByName(root, 'ScrollView')
    if (scrollView) {
      scrollView.enabled = false
    }
    disableSikScrollScriptsUnder(root)
  }

  private findChildByName(root: SceneObject, name: string): SceneObject | null {
    const stack: SceneObject[] = [root]
    while (stack.length > 0) {
      const node = stack.pop()!
      if (node.name === name) {
        return node
      }
      for (let i = 0; i < node.getChildrenCount(); i++) {
        stack.push(node.getChild(i))
      }
    }
    return null
  }

  private shouldApplyControllerRowLayout(): boolean {
    if (this.useWorldSpaceRows) {
      return true
    }
    const creator = this.findScrollContentCreator()
    if (creator) {
      return false
    }
    return true
  }

  /** SIK path: StylePickerScrollContentCreator on ScrollViewContent owns row spawn. */
  private shouldSpawnPrefabRows(): boolean {
    if (!this.styleRowPrefab) {
      return false
    }
    if (this.useWorldSpaceRows) {
      return this.resolveScrollRowsParent() !== null
    }
    return this.findScrollContentCreator() === null
  }

  private spawnPrefabRowsIfNeeded(): void {
    const parent = this.resolveScrollRowsParent()
    if (!this.styleRowPrefab || !parent) {
      return
    }
    if (!parent) {
      return
    }
    if (this.rebuildPrefabRowsOnStart) {
      while (parent.getChildrenCount() > 0) {
        parent.getChild(0).destroy()
      }
    }
    const n = parent.getChildrenCount()
    const target = STYLES.length
    if (n >= target) {
      return
    }
    if (n > 0 && n < target) {
      this.log.w(
        `Partial row count (${n}/${target}). Enable rebuildPrefabRowsOnStart or clear PickerRoot children.`,
      )
      return
    }
    const holder = this.styleRowPrefab.instantiate(parent)
    holder.name = 'StyleRows'
    if (holder.getChildrenCount() >= target) {
      this.flattenHolderRows(holder, parent)
      return
    }
    holder.destroy()
    for (let i = 0; i < target; i++) {
      const row = this.styleRowPrefab.instantiate(parent)
      row.name = `StyleRow_${STYLES[i].id}`
    }
  }

  /** styleroesholder prefab: one root with Btn_* children → direct rows on parent. */
  private flattenHolderRows(holder: SceneObject, parent: SceneObject): void {
    const count = holder.getChildrenCount()
    const rows: SceneObject[] = []
    for (let i = 0; i < count; i++) {
      rows.push(holder.getChild(i))
    }
    for (let i = 0; i < rows.length; i++) {
      rows[i].setParent(parent)
    }
    holder.destroy()
  }

  private applyRowLayout(): void {
    const parent = this.resolveScrollRowsParent()
    if (!parent) {
      return
    }
    if (this.useWorldSpaceRows) {
      this.applyWorldSpaceRowLayout(parent)
    } else {
      this.applyScrollViewScreenLayout(parent)
    }
  }

  /** Scan-room style: RectangleButton + label Text, positioned with Transform only. */
  private applyWorldSpaceRowLayout(parent: SceneObject): void {
    const step = Math.abs(this.rowSpacing) > 0.001 ? this.rowSpacing : 8
    const n = parent.getChildrenCount()
    for (let i = 0; i < n; i++) {
      const row = parent.getChild(i)
      const y = this.rowYStart - step * i
      row.getTransform().setLocalPosition(new vec3(0, y, 0))
    }
  }

  /**
   * Rocket-style point anchors (0,0,0,0). Full-bleed anchors (-1..1) make every row
   * overlap and setSize/setCenter cannot lay out a vertical list.
   */
  /** SIK ScrollView path — ScreenTransform on PickerRoot + each row; point anchors required. */
  private applyScrollViewScreenLayout(parent: SceneObject): void {
    const rowH = Math.max(0.01, this.scrollRowHeight > 0 ? this.scrollRowHeight : Math.abs(this.scrollItemYStep))
    const rowW = Math.max(1, this.scrollRowWidth)
    const n = parent.getChildrenCount()
    for (let i = 0; i < n; i++) {
      const row = parent.getChild(i)
      row.getTransform().setLocalPosition(new vec3(0, 0, 0))
      const st = row.getComponent('Component.ScreenTransform') as ScreenTransform | null
      if (!st) {
        this.log.w(`Scroll row "${row.name}" needs ScreenTransform when useWorldSpaceRows is off`)
        continue
      }
      applyPointAnchors(st)
      const y = this.scrollItemYStart + this.scrollItemYStep * i
      st.offsets.setSize(new vec2(rowW, rowH))
      st.offsets.setCenter(new vec2(0, y))
    }
    const rootSt = parent.getComponent('Component.ScreenTransform') as ScreenTransform | null
    if (!rootSt) {
      this.log.e(`scrollStyleRowsParent "${parent.name}" needs ScreenTransform for SIK ScrollView`)
      return
    }
    applyPointAnchors(rootSt)
    if (n > 0) {
      const firstY = this.scrollItemYStart
      const lastY = this.scrollItemYStart + this.scrollItemYStep * (n - 1)
      const contentH = Math.abs(lastY - firstY) + rowH
      const contentCenterY = (firstY + lastY) * 0.5
      rootSt.offsets.setSize(new vec2(rowW, contentH))
      rootSt.offsets.setCenter(new vec2(0, contentCenterY))
    }
  }

  private refreshListScroll(): void {
    if (this.listScroll) {
      this.listScroll.refreshLimits()
      return
    }
    let node: SceneObject | null = this.sceneObject
    while (node) {
      const scroll = node.getComponent(StylePickerListScroll.getTypeName()) as StylePickerListScroll | null
      if (scroll) {
        scroll.refreshLimits()
        return
      }
      node = node.getParent()
    }
  }

  private bindButtonsWhenReady(): void {
    if (this.buttonsBound) {
      return
    }
    let pairs = this.isScrollChildMode() ? this.buildScrollChildPairs() : this.buildExplicitPairs()
    if (pairs.length === 0) {
      pairs = this.buildScrollChildPairs()
    }
    if (pairs.length === 0) {
      return
    }
    for (let i = 0; i < pairs.length; i++) {
      this.bindOne(pairs[i][0], pairs[i][1])
    }
    this.buttonsBound = true
    this.log.i(`Bound ${pairs.length} style row buttons`)
  }

  private buildScrollChildPairs(): Array<[BaseButton, DecorStyleId]> {
    const resolved = this.resolveScrollRowsParent() ?? this.pickerRoot
    const out: Array<[BaseButton, DecorStyleId]> = []
    if (!resolved) {
      return out
    }
    const rows: SceneObject[] = []
    const n = resolved.getChildrenCount()
    for (let i = 0; i < n; i++) {
      rows.push(resolved.getChild(i))
    }
    rows.sort((a, b) => this.styleRowSortIndex(a) - this.styleRowSortIndex(b))
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]
      const styleId = this.styleIdFromRowName(row.name)
      if (!styleId) {
        this.log.w(`Row "${row.name}" does not match a catalog style — skipped`)
        continue
      }
      const btn = findStyleButtonUnder(row, 6)
      if (btn) {
        out.push([btn, styleId])
      } else {
        this.log.w(`Row "${row.name}" has no RectangleButton/BaseButton`)
      }
    }
    return out
  }

  private styleRowSortIndex(row: SceneObject): number {
    const id = this.styleIdFromRowName(row.name)
    if (!id) {
      return 999
    }
    for (let i = 0; i < STYLES.length; i++) {
      if (STYLES[i].id === id) {
        return i
      }
    }
    return 999
  }

  private styleIdFromRowName(name: string): DecorStyleId | null {
    const lower = name.toLowerCase().replace(/[^a-z0-9]/g, '')
    for (let i = 0; i < STYLES.length; i++) {
      const id = STYLES[i].id
      const compact = id.replace(/_/g, '')
      if (lower.includes(compact) || lower.includes(id.replace('_', ''))) {
        return id
      }
      if (id === 'midcentury' && lower.includes('mid')) {
        return id
      }
      if (id === 'modern_farmhouse' && lower.includes('modernfarmhouse')) {
        return id
      }
    }
    return null
  }

  private buildExplicitPairs(): Array<[BaseButton, DecorStyleId]> {
    const raw: Array<[BaseButton | null, DecorStyleId]> = [
      [this.scandinavianButton, 'scandinavian'],
      [this.vintageButton, 'vintage'],
      [this.industrialButton, 'industrial'],
      [this.midcenturyButton, 'midcentury'],
      [this.japandiButton, 'japandi'],
      [this.modernFarmhouseButton, 'modern_farmhouse'],
      [this.bohoButton, 'boho'],
      [this.minimalistButton, 'minimalist'],
      [this.mediterraneanButton, 'mediterranean'],
      [this.eclecticButton, 'eclectic'],
    ]
    const out: Array<[BaseButton, DecorStyleId]> = []
    for (let i = 0; i < raw.length; i++) {
      const btn = raw[i][0]
      if (btn) {
        out.push([btn, raw[i][1]])
      }
    }
    return out
  }

  private bindOne(button: BaseButton, id: DecorStyleId): void {
    bindStylePickButton(this, button, () => {
      this.handlePick(id)
    })
  }

  private handlePick(id: DecorStyleId): void {
    this.log.i(`Style picked: ${id}`)
    this.hideWithAnimation()
    this.onStyleSelected.invoke(id)
  }

  private hideWithAnimation(): void {
    if (!this.pickerRoot) {
      return
    }
    const tr = this.pickerRoot.getTransform()
    const start = tr.getLocalScale()
    const end = vec3.zero()
    const duration = Math.max(0.05, this.hideDurationSeconds)
    animate({
      duration,
      easing: 'ease-out-quad',
      update: (t) => {
        const sx = start.x + (end.x - start.x) * t
        const sy = start.y + (end.y - start.y) * t
        const sz = start.z + (end.z - start.z) * t
        tr.setLocalScale(new vec3(sx, sy, sz))
      },
      ended: () => {
        if (this.pickerRoot) {
          this.pickerRoot.enabled = false
        }
      },
    })
  }

  private applyLabels(): void {
    if (this.isScrollChildMode()) {
      this.applyLabelsToScrollRows()
      return
    }
    const labelSlots: Text[] = [
      this.scandinavianLabel,
      this.vintageLabel,
      this.industrialLabel,
      this.midcenturyLabel,
      this.japandiLabel,
      this.modernFarmhouseLabel,
      this.bohoLabel,
      this.minimalistLabel,
      this.mediterraneanLabel,
      this.eclecticLabel,
    ]
    const blurbSlots: Text[] = [
      this.scandinavianBlurb,
      this.vintageBlurb,
      this.industrialBlurb,
      this.midcenturyBlurb,
      this.japandiBlurb,
      this.modernFarmhouseBlurb,
      this.bohoBlurb,
      this.minimalistBlurb,
      this.mediterraneanBlurb,
      this.eclecticBlurb,
    ]
    for (let i = 0; i < STYLES.length; i++) {
      const s = STYLES[i]
      this.applyLabel(labelSlots[i], s.displayName)
      this.applyLabel(blurbSlots[i], s.blurb)
    }
  }

  private applyLabel(target: Text | undefined, value: string): void {
    if (target) {
      target.text = value
    }
  }

  /** Catalog copy on each scroll row: first Text = display name, second (if any) = blurb. */
  private applyLabelsToScrollRows(): void {
    const parent = this.resolveScrollRowsParent()
    if (!parent) {
      return
    }
    const max = Math.min(parent.getChildrenCount(), STYLES.length)
    for (let i = 0; i < max; i++) {
      const row = parent.getChild(i)
      const texts: Text[] = []
      this.collectTextsDepthFirst(row, 6, texts)
      const s = STYLES[i]
      if (texts.length >= 1) {
        texts[0].text = s.displayName
      }
      if (texts.length >= 2) {
        texts[1].text = s.blurb
      }
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
