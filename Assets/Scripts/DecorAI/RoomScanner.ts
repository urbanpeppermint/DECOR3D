import Event from 'SpectaclesInteractionKit.lspkg/Utils/Event'
import NativeLogger from 'SpectaclesInteractionKit.lspkg/Utils/NativeLogger'

/**
 * Room camera: live preview on an optional `Image`, then JPEG base64 for Gemini.
 *
 * **Two-step flow** (recommended): call `startLivePreview()` when the user taps
 * “Scan” so they see the live feed and can aim; call `commitSnapshot()` when
 * they tap “Capture”. **One-step** `captureRoom()` keeps the old behaviour
 * (brief preview settle then immediate encode).
 */
@component
export class RoomScanner extends BaseScriptComponent {
  @input
  @hint('JPEG compression quality used when encoding the captured frame for Gemini.')
  @widget(
    new ComboBoxWidget([
      new ComboBoxItem('Low (smaller upload, faster)', 'low'),
      new ComboBoxItem('Medium (recommended)', 'medium'),
      new ComboBoxItem('High (best vision quality)', 'high'),
    ]),
  )
  encodeQuality: string = 'medium'

  @input
  @hint('Show this SceneObject while capture is in-flight (e.g. a loading spinner).')
  @allowUndefined
  loadingIndicator: SceneObject

  @input
  @hint('Optional Image plane: hidden until live preview or result; shows camera feed then still.')
  @allowUndefined
  previewImage: Image

  @input
  @hint('Optional parent (e.g. ContainerFrame). Only visibility is toggled — your position/scale in the scene are kept.')
  @allowUndefined
  previewFrameRoot: SceneObject

  @input
  @hint('When on, scripts never reset preview scale/position (recommended).')
  preserveEditorTransform: boolean = true

  /** Subscribe with `onRoomCaptured.add(({texture, base64Jpeg}) => ...)`. */
  readonly onRoomCaptured: Event<RoomScanResult> = new Event<RoomScanResult>()
  readonly onScanFailed: Event<string> = new Event<string>()

  private readonly log = new NativeLogger('RoomScanner')
  private cameraModule: CameraModule
  private cameraRequest: CameraModule.CameraRequest
  private liveTexture: Texture | null = null
  /** True while Base64.encodeTextureAsync is running. */
  private encodeInProgress: boolean = false

  onAwake(): void {
    this.cameraModule = require('LensStudio:CameraModule') as CameraModule
    this.cameraRequest = CameraModule.createCameraRequest()
    this.cameraRequest.cameraId = CameraModule.CameraId.Left_Color
    this.ensurePreviewHidden()
  }

  /**
   * Hides the preview plane (e.g. on app start or after picking a new style).
   * Safe if `previewImage` is unassigned.
   */
  ensurePreviewHidden(): void {
    this.setPreviewVisible(false)
  }

  private setPreviewVisible(visible: boolean): void {
    const frame = this.previewFrameRoot
    const imageObj = this.previewImage?.sceneObject ?? null

    if (frame) {
      frame.enabled = visible
      if (imageObj && !this.isDescendantOf(imageObj, frame)) {
        imageObj.enabled = visible
      }
    } else if (imageObj) {
      imageObj.enabled = visible
    }

    if (!this.preserveEditorTransform) {
      const root = frame ?? imageObj
      if (root && visible) {
        root.getTransform().setLocalScale(new vec3(1, 1, 1))
      }
    }
  }

  private isDescendantOf(child: SceneObject, ancestor: SceneObject): boolean {
    let node: SceneObject | null = child
    while (node) {
      if (node === ancestor) {
        return true
      }
      node = node.getParent()
    }
    return false
  }

  /** Stop live preview / loading when returning to the style menu. */
  cancelSession(): void {
    this.encodeInProgress = false
    this.setLoading(false)
    this.ensurePreviewHidden()
  }

  /**
   * Opens the Spectacles RGB camera and mirrors the feed to `previewImage`
   * without encoding yet — use when the user should aim before capture.
   */
  startLivePreview(): void {
    if (this.encodeInProgress) {
      this.log.w('startLivePreview ignored: encode already in progress')
      return
    }
    if (!this.openCameraTexture()) {
      return
    }
    this.showPreviewTexture()
  }

  /**
   * Encodes the current live camera frame to JPEG base64 and emits
   * `onRoomCaptured`. Call after `startLivePreview()` (or `captureRoom()`).
   */
  commitSnapshot(): void {
    if (this.encodeInProgress) {
      this.log.w('commitSnapshot ignored: already encoding')
      return
    }
    if (!this.liveTexture) {
      this.onScanFailed.invoke('No camera frame — start live preview first.')
      return
    }
    this.encodeInProgress = true
    this.setLoading(true)
    const settle = this.createEvent('DelayedCallbackEvent')
    settle.bind(() => {
      this.encodeAndEmit()
    })
    settle.reset(0.08)
  }

  /**
   * Legacy one-tap capture: preview on, short settle, then encode (does not use
   * `commitSnapshot()` so we can take a single lock for the whole shutter).
   */
  captureRoom(): void {
    if (this.encodeInProgress) {
      this.log.w('captureRoom ignored: already encoding')
      return
    }
    this.encodeInProgress = true
    this.setLoading(true)
    if (!this.openCameraTexture()) {
      this.encodeInProgress = false
      this.setLoading(false)
      return
    }
    this.showPreviewTexture()
    const settle = this.createEvent('DelayedCallbackEvent')
    settle.bind(() => {
      this.encodeAndEmit()
    })
    settle.reset(0.1)
  }

  private openCameraTexture(): boolean {
    try {
      if (!this.liveTexture) {
        this.liveTexture = this.cameraModule.requestCamera(this.cameraRequest)
      }
    } catch (err) {
      this.failCapture(`camera request failed: ${err}`)
      return false
    }
    if (!this.liveTexture) {
      this.failCapture('camera texture was null')
      return false
    }
    return true
  }

  private showPreviewTexture(): void {
    if (this.previewImage && this.liveTexture) {
      this.previewImage.mainPass.baseTex = this.liveTexture
    }
    this.setPreviewVisible(true)
  }

  private encodeAndEmit(): void {
    const tex = this.liveTexture
    if (!tex) {
      this.failCapture('camera texture went null before encode')
      return
    }

    const quality = this.resolveCompressionQuality()
    Base64.encodeTextureAsync(
      tex,
      (base64Jpeg: string) => {
        this.setLoading(false)
        this.encodeInProgress = false
        if (!base64Jpeg || base64Jpeg.length === 0) {
          this.encodeInProgress = false
          this.setLoading(false)
          this.onScanFailed.invoke('encoded image was empty')
          return
        }
        this.log.i(`Room captured: ${base64Jpeg.length} base64 chars`)
        this.onRoomCaptured.invoke({ texture: tex, base64Jpeg })
      },
      () => {
        this.failCapture('Base64.encodeTextureAsync failed')
      },
      quality,
      EncodingType.Jpg,
    )
  }

  private resolveCompressionQuality(): CompressionQuality {
    if (this.encodeQuality === 'low') {
      return CompressionQuality.LowQuality
    }
    if (this.encodeQuality === 'high') {
      return CompressionQuality.HighQuality
    }
    return CompressionQuality.MaximumCompression
  }

  private setLoading(enabled: boolean): void {
    if (this.loadingIndicator) {
      this.loadingIndicator.enabled = enabled
    }
  }

  private failCapture(message: string): void {
    this.log.e(message)
    this.setLoading(false)
    this.encodeInProgress = false
    this.onScanFailed.invoke(message)
  }
}

export interface RoomScanResult {
  texture: Texture
  base64Jpeg: string
}
