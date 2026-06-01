import Event from 'SpectaclesInteractionKit.lspkg/Utils/Event'
import NativeLogger from 'SpectaclesInteractionKit.lspkg/Utils/NativeLogger'
import animate from 'SpectaclesInteractionKit.lspkg/Utils/animate'
import { BaseButton } from 'SpectaclesUIKit.lspkg/Scripts/Components/Button/BaseButton'
import { bindStylePickButton } from './StylePickerButtonBinder'

const OFFSCREEN_Y = 200

/**
 * Optional step between style pick and scan: the user picks a target room
 * purpose from a scrollable list, or skips to keep restyle-only.
 *
 * Row spawning, layout, and SIK ScrollView wiring are handled by
 * `PurposeScrollContentCreator` (on ScrollViewContent). This script owns
 * show/hide lifecycle and the `onPurposeSelected` event.
 *
 * INIT STRATEGY: The panel is moved far off-screen (not scaled to zero)
 * during init. SIK computes content bounds via world-space conversions —
 * scaling to zero collapses all points to a dot, producing zero-size bounds
 * and the "negative bounding height" error. Moving off-screen preserves
 * scale=1 so ScreenTransform math stays correct.
 */
@component
export class RoomPurposePanel extends BaseScriptComponent {
  @input
  @hint('Root SceneObject for the whole panel — hidden/shown by controller.')
  panelRoot: SceneObject

  @input
  @allowUndefined
  @hint('"Restyle only" / Skip button — emits null.')
  skipButton: BaseButton

  @input
  @hint('Scale-out duration (seconds).')
  hideDurationSeconds: number = 0.4

  readonly onPurposeSelected: Event<string | null> = new Event<string | null>()

  private readonly log = new NativeLogger('RoomPurposePanel')
  private sikInitDone: boolean = false
  private isShowing: boolean = false
  private originalPos: vec3 = vec3.zero()

  onAwake(): void {
    if (this.panelRoot) {
      const tr = this.panelRoot.getTransform()
      this.originalPos = tr.getLocalPosition()
      tr.setLocalPosition(
        new vec3(this.originalPos.x, this.originalPos.y + OFFSCREEN_Y, this.originalPos.z),
      )
    }
    this.createEvent('OnStartEvent').bind(() => {
      if (this.skipButton) {
        bindStylePickButton(this, this.skipButton, () => this.selectPurpose(null))
      }
      const deferDisable = this.createEvent('DelayedCallbackEvent')
      deferDisable.bind(() => {
        this.sikInitDone = true
        if (this.panelRoot && !this.isShowing) {
          this.panelRoot.getTransform().setLocalPosition(this.originalPos)
          this.panelRoot.enabled = false
        }
      })
      deferDisable.reset(2.0)
    })
  }

  selectPurpose(purpose: string | null): void {
    this.log.i(purpose ? `Purpose: ${purpose}` : 'Skipped — restyle only')
    this.hideWithAnimation()
    this.onPurposeSelected.invoke(purpose)
  }

  show(): void {
    if (!this.panelRoot) {
      return
    }
    this.isShowing = true
    this.panelRoot.enabled = true
    const tr = this.panelRoot.getTransform()
    tr.setLocalPosition(this.originalPos)
    tr.setLocalScale(new vec3(1, 1, 1))
  }

  hide(): void {
    if (!this.panelRoot) {
      return
    }
    this.isShowing = false
    if (this.sikInitDone) {
      this.panelRoot.getTransform().setLocalScale(vec3.zero())
      this.panelRoot.enabled = false
    } else {
      this.panelRoot.getTransform().setLocalPosition(
        new vec3(this.originalPos.x, this.originalPos.y + OFFSCREEN_Y, this.originalPos.z),
      )
    }
  }

  resetForRestart(): void {
    this.hide()
  }

  private hideWithAnimation(): void {
    if (!this.panelRoot) {
      return
    }
    const tr = this.panelRoot.getTransform()
    const start = tr.getLocalScale()
    animate({
      duration: Math.max(0.05, this.hideDurationSeconds),
      easing: 'ease-out-quad',
      update: (t) => {
        const k = 1 - t
        tr.setLocalScale(new vec3(start.x * k, start.y * k, start.z * k))
      },
      ended: () => {
        if (this.panelRoot && this.sikInitDone) {
          this.panelRoot.enabled = false
        }
      },
    })
  }
}
