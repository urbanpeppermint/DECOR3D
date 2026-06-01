import Event from 'SpectaclesInteractionKit.lspkg/Utils/Event'
import NativeLogger from 'SpectaclesInteractionKit.lspkg/Utils/NativeLogger'
import { Imagen } from 'RemoteServiceGateway.lspkg/HostedExternal/Imagen'
import { GoogleGenAITypes } from 'RemoteServiceGateway.lspkg/HostedExternal/GoogleGenAITypes'
import { DecorStyleId, RoomAnalysis } from './DecorTypes'
import { getStyle } from './DecorStyleCatalog'

/**
 * Generates the redecoration image via **RSG Imagen** (`Imagen.generateImage`)
 * and hands the resulting texture to a Spatial Image template so Snap's
 * server-side depth estimator can spatialize it into a parallax-aware plane.
 *
 * The `spatialImageFrame` field is intentionally duck-typed (`ScriptComponent`
 * with an optional `setImage(texture, swap?)`) so this script works with both
 * `SikSpatialImageFrame` and the stock `SpatialImage.lsc` template without
 * importing their concrete classes. Same trick as Travel_Planner's
 * DestinationVisualizer.
 *
 * If no spatial frame is wired, we fall back to a single flat `previewPlane`
 * — convenient for editor testing where the spatializer doesn't run anyway.
 */
@component
export class MakeoverVisualizer extends BaseScriptComponent {
  @input
  @hint('Imagen model id (RSG Imagen proxy).')
  imagenModel: string = 'imagen-3.0-generate-002'

  @input
  @hint('Aspect ratio passed to Imagen. 16:9 reads as a natural room view.')
  @widget(
    new ComboBoxWidget([
      new ComboBoxItem('16:9 (wide room view)', '16:9'),
      new ComboBoxItem('4:3 (portrait-leaning)', '4:3'),
      new ComboBoxItem('1:1 (square)', '1:1'),
    ]),
  )
  imagenAspectRatio: string = '16:9'

  @input
  @hint('When true, Imagen may rewrite the prompt for “quality” (can drift from your room). Off by default for layout fidelity.')
  imagenEnhancePrompt: boolean = false

  @input
  @allowUndefined
  @hint(
    'Assign the Spatial Image template ScriptComponent (SikSpatialImageFrame or stock SpatialImage). We call setImage(texture, swap) on it.',
  )
  spatialImageFrame: ScriptComponent

  @input
  @hint('When true, asks the spatial frame to swap to its depth-mapped version once the spatializer finishes (~2-4s).')
  swapSpatialWhenReady: boolean = true

  @input
  @allowUndefined
  @hint('Fallback flat preview plane used when no spatial frame is assigned (e.g. in editor).')
  previewPlane: SceneObject

  @input
  @allowUndefined
  @hint('Optional parent of previewPlane (e.g. Scan_preview frame). Visibility only — layout stays as you placed it.')
  previewFrameRoot: SceneObject

  @input
  @hint('Show this SceneObject while Imagen is generating.')
  @allowUndefined
  loadingIndicator: SceneObject

  @input
  @hint('Optional Text component used for short status messages.')
  @allowUndefined
  statusText: Text

  /** Subscribers receive the freshly generated room makeover texture. */
  readonly onMakeoverReady: Event<Texture> = new Event<Texture>()
  readonly onMakeoverFailed: Event<string> = new Event<string>()

  private readonly log = new NativeLogger('MakeoverVisualizer')
  private inFlight: boolean = false

  /**
   * Build the full Imagen prompt from the chosen style and the analyzer's
   * makeoverPrompt, then kick off generation.
   */
  generateMakeover(analysis: RoomAnalysis, styleId: DecorStyleId, targetPurpose?: string): void {
    if (this.inFlight) {
      this.log.w('generateMakeover ignored: already generating')
      return
    }
    if (!analysis || !analysis.makeoverPrompt || analysis.makeoverPrompt.length === 0) {
      this.onMakeoverFailed.invoke('makeoverPrompt was empty')
      return
    }

    this.inFlight = true
    this.setLoading(true)
    this.setStatus('Painting the makeover…')

    const style = getStyle(styleId)
    const prompt = this.buildPrompt(style.imagenPromptSuffix, analysis, targetPurpose)
    this.log.i(`Imagen prompt: ${prompt.substring(0, 240)}…`)

    const request: GoogleGenAITypes.Imagen.ImagenRequest = {
      model: this.imagenModel,
      body: {
        parameters: {
          sampleCount: 1,
          addWatermark: false,
          aspectRatio: this.imagenAspectRatio,
          enhancePrompt: this.imagenEnhancePrompt,
          language: 'en',
          seed: 0,
        },
        instances: [{ prompt }],
      },
    }

    Imagen.generateImage(request)
      .then((response) => {
        if (!response.predictions || response.predictions.length === 0) {
          this.failMakeover('Imagen returned no predictions')
          return
        }
        const b64 = this.stripDataUrl(response.predictions[0].bytesBase64Encoded || '')
        if (b64.length === 0) {
          this.failMakeover('Imagen prediction missing bytesBase64Encoded')
          return
        }
        Base64.decodeTextureAsync(
          b64,
          (texture: Texture) => {
            this.applyTexture(texture)
            this.inFlight = false
            this.setLoading(false)
            this.setStatus('Makeover ready. Look around to feel the depth.')
            this.onMakeoverReady.invoke(texture)
          },
          () => {
            this.failMakeover('Base64.decodeTextureAsync failed')
          },
        )
      })
      .catch((err) => {
        this.failMakeover(`Imagen.generateImage failed: ${err}`)
      })
  }

  /**
   * Hide the makeover (e.g. when starting a new scan or returning to picker).
   */
  dismiss(): void {
    this.inFlight = false
    this.setLoading(false)
    if (this.spatialImageFrame) {
      this.spatialImageFrame.sceneObject.enabled = false
    }
    this.setPreviewPlaneVisible(false)
  }

  private setPreviewPlaneVisible(visible: boolean): void {
    const frame = this.previewFrameRoot
    const plane = this.previewPlane

    if (frame) {
      frame.enabled = visible
      if (plane && !this.isDescendantOf(plane, frame)) {
        plane.enabled = visible
      }
    } else if (plane) {
      plane.enabled = visible
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

  private applyTexture(texture: Texture): void {
    if (this.spatialImageFrame) {
      const framed = this.spatialImageFrame as unknown as {
        setImage?: (image: Texture, swap?: boolean) => void
      }
      if (typeof framed.setImage === 'function') {
        this.spatialImageFrame.sceneObject.enabled = true
        if (framed.setImage.length >= 2) {
          framed.setImage(texture, this.swapSpatialWhenReady)
        } else {
          framed.setImage(texture)
        }
        this.setPreviewPlaneVisible(false)
        return
      }
      this.log.w('spatialImageFrame has no setImage(); falling back to previewPlane')
    }

    if (this.previewPlane) {
      const img = this.previewPlane.getComponent('Component.Image') as Image | null
      if (img) {
        img.mainPass.baseTex = texture
        this.setPreviewPlaneVisible(true)
      } else {
        this.log.w(`previewPlane "${this.previewPlane.name}" has no Image component`)
      }
    } else {
      this.log.w('No spatial frame and no preview plane wired — texture generated but not displayed')
    }
  }

  private buildPrompt(suffix: string, analysis: RoomAnalysis, targetPurpose?: string): string {
    const colourHint =
      analysis.dominantColors && analysis.dominantColors.length > 0
        ? `Existing palette cues: ${analysis.dominantColors.join(', ')}. `
        : ''
    const isTransform = !!targetPurpose && targetPurpose.length > 0
    const layoutLock = isTransform
      ? `PHOTOREAL INTERIOR — This must be the SAME physical room as the reference capture: identical camera viewpoint, same window and door openings on the same walls, same ceiling and floor boundaries. Transform this space into a ${targetPurpose}: replace all furniture and fixtures with those appropriate for a ${targetPurpose}. Do not invent new windows, doors, or walls. `
      : 'PHOTOREAL INTERIOR — This must be the SAME physical room as the reference capture: identical camera viewpoint, same window and door openings on the same walls, same ceiling and floor boundaries. Change only finishes, paint, wallpaper, furniture pieces, lighting fixtures, textiles, and decor. Do not invent new windows, doors, or walls. '
    const summaryGlue =
      analysis.roomSummary && analysis.roomSummary.length > 0
        ? `Scene anchor notes: ${analysis.roomSummary} `
        : ''
    return `${suffix}${layoutLock}${summaryGlue}${colourHint}${analysis.makeoverPrompt}`
  }

  private stripDataUrl(value: string): string {
    const marker = 'base64,'
    const idx = value.indexOf(marker)
    if (idx >= 0) {
      return value.substring(idx + marker.length)
    }
    return value
  }

  private setStatus(message: string): void {
    if (this.statusText) {
      this.statusText.text = message
    }
  }

  private setLoading(enabled: boolean): void {
    if (this.loadingIndicator) {
      this.loadingIndicator.enabled = enabled
    }
  }

  private failMakeover(message: string): void {
    this.log.e(message)
    this.inFlight = false
    this.setLoading(false)
    this.setStatus(message.length > 80 ? `${message.substring(0, 77)}…` : message)
    this.onMakeoverFailed.invoke(message)
  }
}
