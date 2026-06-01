import { DragType } from 'SpectaclesInteractionKit.lspkg/Core/Interactor/Interactor'
import { DragInteractorEvent } from 'SpectaclesInteractionKit.lspkg/Core/Interactor/InteractorEvent'
import { Interactable } from 'SpectaclesInteractionKit.lspkg/Components/Interaction/Interactable/Interactable'
import NativeLogger from 'SpectaclesInteractionKit.lspkg/Utils/NativeLogger'

/**
 * Vertical list scroll for Décor3D style picker (no SIK ScrollView).
 * Drag ScrollBarSlider on Y; PickerRoot moves so world-space RectangleButton rows scroll.
 */
@component
export class StylePickerListScroll extends BaseScriptComponent {
  @input
  @hint('Parent of style rows (PickerRoot).')
  listRoot: SceneObject

  @input
  @hint('Draggable thumb (ScrollBarSlider).')
  scrollThumb: SceneObject

  @input
  @hint('Thumb local Y when list is at the top.')
  thumbYTop: number = -6.5

  @input
  @hint('Thumb local Y when list is at the bottom.')
  thumbYBottom: number = 6.5

  @input
  @hint('Must match StylePickerController rowSpacing.')
  rowSpacing: number = 6

  @input
  @hint('Rows visible before scrolling.')
  visibleRowCount: number = 5

  private readonly log = new NativeLogger('StylePickerListScroll')
  private listScrollMin = 0
  private listScrollMax = 0
  private thumbRange = 1
  private lastRowCount = -1

  onAwake(): void {
    this.thumbRange = this.thumbYTop - this.thumbYBottom
    if (Math.abs(this.thumbRange) < 0.001) {
      this.thumbRange = 1
    }
    this.createEvent('OnStartEvent').bind(() => {
      this.bindThumbDrag()
      this.refreshLimits()
      const retry = this.createEvent('DelayedCallbackEvent')
      retry.bind(() => {
        this.bindThumbDrag()
        this.refreshLimits()
      })
      retry.reset(0.25)
    })
    this.createEvent('UpdateEvent').bind(() => this.onUpdate())
  }

  /** Call after rows spawn / layout (StylePickerController OnStart). */
  refreshLimits(): void {
    this.computeScrollLimits()
    this.syncListFromThumb()
  }

  /** Top of list: thumb up, content at scroll max. */
  resetToTop(): void {
    this.computeScrollLimits()
    if (!this.scrollThumb || !this.listRoot) {
      return
    }
    const thumbTf = this.scrollThumb.getTransform()
    thumbTf.setLocalPosition(
      new vec3(thumbTf.getLocalPosition().x, this.thumbYTop, thumbTf.getLocalPosition().z),
    )
    const listTf = this.listRoot.getTransform()
    const p = listTf.getLocalPosition()
    listTf.setLocalPosition(new vec3(p.x, this.listScrollMax, p.z))
  }

  private onUpdate(): void {
    if (!this.listRoot) {
      return
    }
    const n = this.listRoot.getChildrenCount()
    if (n !== this.lastRowCount) {
      this.lastRowCount = n
      this.refreshLimits()
    }
    this.syncListFromThumb()
  }

  private computeScrollLimits(): void {
    this.listScrollMin = 0
    this.listScrollMax = 0
    if (!this.listRoot) {
      return
    }
    const n = this.listRoot.getChildrenCount()
    if (n <= 1) {
      return
    }
    const step = Math.abs(this.rowSpacing) > 0.001 ? this.rowSpacing : 6
    const contentSpan = (n - 1) * step
    const viewSpan = Math.max(1, this.visibleRowCount - 1) * step
    this.listScrollMax = 0
    this.listScrollMin = Math.min(0, viewSpan - contentSpan)
    this.log.i(`List scroll Y ${this.listScrollMin} … ${this.listScrollMax} (${n} rows)`)
  }

  private bindThumbDrag(): void {
    const interactable = this.findThumbInteractable()
    if (!interactable) {
      this.log.w(
        'Add Interactable on ScrollBarSlider (enableInstantDrag). Keep SIK ScrollBar script disabled.',
      )
      return
    }
    interactable.enableInstantDrag = true
    interactable.onDragStart.add((event) => this.applyDragToThumb(event))
    interactable.onDragUpdate.add((event) => this.applyDragToThumb(event))
  }

  /** Use Interactable on the thumb only — not the track (SIK ScrollBar uses the track). */
  private findThumbInteractable(): Interactable | null {
    if (!this.scrollThumb) {
      return null
    }
    const typeName = Interactable.getTypeName()
    return this.scrollThumb.getComponent(typeName) as Interactable | null
  }

  private applyDragToThumb(event: DragInteractorEvent): void {
    if (!this.scrollThumb) {
      return
    }
    const dragVector =
      event.interactor.dragType !== DragType.Touchpad
        ? event.planecastDragVector
        : event.dragVector
    if (!dragVector) {
      return
    }
    const ref = this.scrollThumb.getParent() || this.scrollThumb
    const localDelta = ref.getTransform().getInvertedWorldTransform().multiplyDirection(dragVector)
    const thumbTf = this.scrollThumb.getTransform()
    const p = thumbTf.getLocalPosition()
    const yMin = Math.min(this.thumbYTop, this.thumbYBottom)
    const yMax = Math.max(this.thumbYTop, this.thumbYBottom)
    const newY = Math.max(yMin, Math.min(yMax, p.y + localDelta.y))
    thumbTf.setLocalPosition(new vec3(p.x, newY, p.z))
  }

  private syncListFromThumb(): void {
    if (!this.listRoot || !this.scrollThumb) {
      return
    }
    const thumbTf = this.scrollThumb.getTransform()
    const thumbPos = thumbTf.getLocalPosition()
    let thumbY = thumbPos.y
    const yMin = Math.min(this.thumbYTop, this.thumbYBottom)
    const yMax = Math.max(this.thumbYTop, this.thumbYBottom)
    thumbY = Math.max(yMin, Math.min(yMax, thumbY))
    if (Math.abs(thumbY - thumbPos.y) > 0.0001) {
      thumbTf.setLocalPosition(new vec3(thumbPos.x, thumbY, thumbPos.z))
    }

    const t = (thumbY - this.thumbYBottom) / this.thumbRange
    const clamped = Math.max(0, Math.min(1, t))
    const listY = this.listScrollMax + (this.listScrollMin - this.listScrollMax) * clamped
    const listTf = this.listRoot.getTransform()
    const p = listTf.getLocalPosition()
    if (Math.abs(p.y - listY) > 0.0001) {
      listTf.setLocalPosition(new vec3(p.x, listY, p.z))
    }
  }
}
