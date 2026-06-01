import NativeLogger from 'SpectaclesInteractionKit.lspkg/Utils/NativeLogger'
import { Interactable } from 'SpectaclesInteractionKit.lspkg/Components/Interaction/Interactable/Interactable'
import { STYLES } from './DecorStyleCatalog'

/**
 * Shows catalog blurbs in a floating tooltip beside the style row under the
 * user's hand (SIK hover). Hides the second Text on each row when enabled.
 *
 * Rows need an **Interactable** on the button root (or a child). UIKit
 * RectangleButton rows often get one at runtime — we bind on Start + retry.
 */
@component
export class StylePickerBlurbHover extends BaseScriptComponent {
  @input
  @hint('Parent whose direct children are style rows (e.g. PickerRoot / ScrollViewContent).')
  rowsParent: SceneObject

  @input
  @hint('Tooltip root (hidden until hover). Position updated next to the row.')
  tooltipRoot: SceneObject

  @input
  @allowUndefined
  blurbText: Text

  @input
  @hint('World-space offset from the row origin (e.g. right of the button).')
  tooltipOffset: vec3 = new vec3(14, 0, 0.2)

  @input
  @hint('Hide the second Text on each row so only the hover tooltip shows blurbs.')
  hideInlineRowBlurbs: boolean = true

  @input
  @hint('Max depth when searching row hierarchy for Interactable.')
  interactableSearchDepth: number = 6

  private readonly log = new NativeLogger('StylePickerBlurbHover')
  private activeRow: SceneObject | null = null
  private readonly boundRows: SceneObject[] = []

  onAwake(): void {
    this.hideTooltip()
    this.createEvent('OnStartEvent').bind(() => {
      this.refreshBindings()
      const retry = this.createEvent('DelayedCallbackEvent')
      retry.bind(() => this.refreshBindings())
      retry.reset(0.25)
    })
  }

  /** Re-scan rows (call after picker respawns prefab rows). */
  refreshBindings(): void {
    if (!this.rowsParent || !this.tooltipRoot) {
      return
    }
    this.hideInlineBlurbs()
    const n = Math.min(this.rowsParent.getChildrenCount(), STYLES.length)
    for (let i = 0; i < n; i++) {
      this.bindRow(this.rowsParent.getChild(i), STYLES[i].blurb)
    }
  }

  private hideInlineBlurbs(): void {
    if (!this.hideInlineRowBlurbs || !this.rowsParent) {
      return
    }
    const n = this.rowsParent.getChildrenCount()
    for (let i = 0; i < n; i++) {
      const texts: Text[] = []
      this.collectTexts(this.rowsParent.getChild(i), 6, texts)
      if (texts.length >= 2) {
        texts[1].sceneObject.enabled = false
      }
    }
  }

  private bindRow(row: SceneObject, blurb: string): void {
    if (this.boundRows.indexOf(row) >= 0) {
      return
    }
    const interactable = this.findInteractable(row, this.interactableSearchDepth)
    if (!interactable) {
      return
    }
    this.boundRows.push(row)
    interactable.onHoverEnter.add(() => {
      this.showTooltip(row, blurb)
    })
    interactable.onHoverExit.add(() => {
      if (this.activeRow === row) {
        this.hideTooltip()
      }
    })
    interactable.onSyncHoverEnter.add(() => {
      this.showTooltip(row, blurb)
    })
    interactable.onSyncHoverExit.add(() => {
      if (this.activeRow === row) {
        this.hideTooltip()
      }
    })
  }

  private showTooltip(row: SceneObject, blurb: string): void {
    if (!this.tooltipRoot) {
      return
    }
    this.activeRow = row
    if (this.blurbText) {
      this.blurbText.text = blurb
    }
    const rowPos = row.getTransform().getWorldPosition()
    const offset = this.tooltipOffset
    const tipTr = this.tooltipRoot.getTransform()
    tipTr.setWorldPosition(
      new vec3(rowPos.x + offset.x, rowPos.y + offset.y, rowPos.z + offset.z),
    )
    this.tooltipRoot.enabled = true
    this.tooltipRoot.getTransform().setLocalScale(new vec3(1, 1, 1))
  }

  private hideTooltip(): void {
    this.activeRow = null
    if (!this.tooltipRoot) {
      return
    }
    this.tooltipRoot.enabled = false
    this.tooltipRoot.getTransform().setLocalScale(vec3.zero())
  }

  private findInteractable(root: SceneObject, depth: number): Interactable | null {
    const typeName = Interactable.getTypeName()
    const direct = root.getComponent(typeName) as Interactable | null
    if (direct) {
      return direct
    }
    if (depth <= 0) {
      return null
    }
    const c = root.getChildrenCount()
    for (let i = 0; i < c; i++) {
      const hit = this.findInteractable(root.getChild(i), depth - 1)
      if (hit) {
        return hit
      }
    }
    return null
  }

  private collectTexts(root: SceneObject, depth: number, out: Text[]): void {
    const t = root.getComponent('Component.Text') as Text | null
    if (t) {
      out.push(t)
    }
    if (depth <= 0) {
      return
    }
    const c = root.getChildrenCount()
    for (let i = 0; i < c; i++) {
      this.collectTexts(root.getChild(i), depth - 1, out)
    }
  }
}
