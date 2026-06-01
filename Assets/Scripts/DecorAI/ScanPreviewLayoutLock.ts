import NativeLogger from 'SpectaclesInteractionKit.lspkg/Utils/NativeLogger'

/**
 * Keeps a child (e.g. scan preview Image) at its editor local transform.
 * ContainerFrame moves content on Z at runtime — this resets it every frame.
 */
@component
export class ScanPreviewLayoutLock extends BaseScriptComponent {
  @input
  @allowUndefined
  @hint('Usually the Image child under Scan_preview. If empty, uses the first child.')
  content: SceneObject

  @input
  @hint('When off, this component does nothing.')
  lockEnabled: boolean = true

  private readonly log = new NativeLogger('ScanPreviewLayoutLock')
  private captured: boolean = false
  private localPos: vec3 = vec3.zero()
  private localRot: quat = quat.quatIdentity()
  private localScale: vec3 = new vec3(1, 1, 1)

  onAwake(): void {
    this.createEvent('OnStartEvent').bind(() => {
      this.resolveContent()
      this.captureLocalTransform()
    })
    this.createEvent('UpdateEvent').bind(() => this.enforceLocalTransform())
  }

  /** Re-read editor transform (call after you move the Image in the scene). */
  recapture(): void {
    this.captureLocalTransform()
  }

  private resolveContent(): void {
    if (this.content) {
      return
    }
    if (this.sceneObject.getChildrenCount() > 0) {
      this.content = this.sceneObject.getChild(0)
      this.log.i(`Auto-assigned content: ${this.content.name}`)
    }
  }

  private captureLocalTransform(): void {
    this.resolveContent()
    if (!this.content) {
      return
    }
    const t = this.content.getTransform()
    this.localPos = t.getLocalPosition()
    this.localRot = t.getLocalRotation()
    this.localScale = t.getLocalScale()
    this.captured = true
  }

  private enforceLocalTransform(): void {
    if (!this.lockEnabled || !this.captured || !this.content) {
      return
    }
    const t = this.content.getTransform()
    t.setLocalPosition(this.localPos)
    t.setLocalRotation(this.localRot)
    t.setLocalScale(this.localScale)
  }
}
