import NativeLogger from 'SpectaclesInteractionKit.lspkg/Utils/NativeLogger'
import { Imagen } from 'RemoteServiceGateway.lspkg/HostedExternal/Imagen'
import { GoogleGenAITypes } from 'RemoteServiceGateway.lspkg/HostedExternal/GoogleGenAITypes'
import { BaseButton } from 'SpectaclesUIKit.lspkg/Scripts/Components/Button/BaseButton'
import { DecorProductIdea } from './DecorTypes'

/**
 * Carousel popup: product image + description + where to shop (online / nearby).
 * Images generated with Imagen from each idea's `imagenPrompt`.
 */
@component
export class DecorProductSuggestionsPanel extends BaseScriptComponent {
  @input
  @hint('Root scaled in when showing shop ideas (popup frame).')
  panelRoot: SceneObject

  @input
  @allowUndefined
  previewImage: Image

  @input
  @allowUndefined
  titleText: Text

  @input
  @allowUndefined
  descriptionText: Text

  @input
  @allowUndefined
  shopHintText: Text

  @input
  @allowUndefined
  categoryText: Text

  @input
  @allowUndefined
  indexText: Text

  @input
  @allowUndefined
  prevButton: BaseButton

  @input
  @allowUndefined
  nextButton: BaseButton

  @input
  @allowUndefined
  closeButton: BaseButton

  @input
  @allowUndefined
  openButton: BaseButton

  @input
  @hint('Generate a small product photo per item when shown.')
  generateImages: boolean = true

  @input
  imagenModel: string = 'imagen-3.0-generate-002'

  private readonly log = new NativeLogger('DecorProductSuggestionsPanel')
  private ideas: DecorProductIdea[] = []
  private index: number = 0
  private imageCache: Map<number, Texture> = new Map()
  private imageLoading: Set<number> = new Set()

  onAwake(): void {
    this.hide(true)
    this.createEvent('OnStartEvent').bind(() => this.wireButtons())
  }

  showIdeas(ideas: DecorProductIdea[]): void {
    this.ideas = ideas && ideas.length > 0 ? ideas : []
    this.index = 0
    this.imageCache.clear()
    this.imageLoading.clear()
    if (this.ideas.length === 0) {
      this.hide(true)
      return
    }
    if (this.panelRoot) {
      this.panelRoot.enabled = true
      this.panelRoot.getTransform().setLocalScale(new vec3(1, 1, 1))
    }
    this.refreshView()
  }

  hide(immediate: boolean = false): void {
    if (!this.panelRoot) {
      return
    }
    if (immediate) {
      this.panelRoot.enabled = false
      this.panelRoot.getTransform().setLocalScale(vec3.zero())
      return
    }
    this.panelRoot.getTransform().setLocalScale(vec3.zero())
    this.panelRoot.enabled = false
  }

  private wireButtons(): void {
    if (this.openButton) {
      this.openButton.onInitialized.add(() => {
        this.openButton.onTriggerUp.add(() => {
          if (this.ideas.length > 0 && this.panelRoot) {
            this.panelRoot.enabled = true
            this.panelRoot.getTransform().setLocalScale(new vec3(1, 1, 1))
          }
        })
      })
    }
    if (this.prevButton) {
      this.prevButton.onInitialized.add(() => {
        this.prevButton.onTriggerUp.add(() => this.step(-1))
      })
    }
    if (this.nextButton) {
      this.nextButton.onInitialized.add(() => {
        this.nextButton.onTriggerUp.add(() => this.step(1))
      })
    }
    if (this.closeButton) {
      this.closeButton.onInitialized.add(() => {
        this.closeButton.onTriggerUp.add(() => this.hide(false))
      })
    }
  }

  private step(delta: number): void {
    if (this.ideas.length === 0) {
      return
    }
    this.index = (this.index + delta + this.ideas.length) % this.ideas.length
    this.refreshView()
  }

  private refreshView(): void {
    if (this.ideas.length === 0) {
      return
    }
    const item = this.ideas[this.index]
    if (this.titleText) {
      this.titleText.text = item.title
    }
    if (this.descriptionText) {
      this.descriptionText.text = item.description
    }
    if (this.shopHintText) {
      this.shopHintText.text = `Where to look: ${item.shopHint}\nSearch: ${item.searchKeywords}`
    }
    if (this.categoryText) {
      this.categoryText.text = item.category.toUpperCase()
    }
    if (this.indexText) {
      this.indexText.text = `${this.index + 1} / ${this.ideas.length}`
    }
    this.applyImageForIndex(this.index)
  }

  private applyImageForIndex(idx: number): void {
    if (!this.previewImage) {
      return
    }
    const cached = this.imageCache.get(idx)
    if (cached) {
      this.previewImage.mainPass.baseTex = cached
      this.previewImage.sceneObject.enabled = true
      return
    }
    if (!this.generateImages || this.imageLoading.has(idx)) {
      return
    }
    const item = this.ideas[idx]
    this.imageLoading.add(idx)
    const request: GoogleGenAITypes.Imagen.ImagenRequest = {
      model: this.imagenModel,
      body: {
        parameters: {
          sampleCount: 1,
          addWatermark: false,
          aspectRatio: '1:1',
          enhancePrompt: false,
          language: 'en',
          seed: idx * 17,
        },
        instances: [{ prompt: item.imagenPrompt }],
      },
    }
    Imagen.generateImage(request)
      .then((response) => {
        this.imageLoading.delete(idx)
        if (!response.predictions || response.predictions.length === 0) {
          return
        }
        const b64 = response.predictions[0].bytesBase64Encoded || ''
        if (b64.length === 0) {
          return
        }
        Base64.decodeTextureAsync(
          b64,
          (texture: Texture) => {
            this.imageCache.set(idx, texture)
            if (this.index === idx && this.previewImage) {
              this.previewImage.mainPass.baseTex = texture
              this.previewImage.sceneObject.enabled = true
            }
          },
          () => {
            this.log.w(`Product image decode failed for "${item.title}"`)
          },
        )
      })
      .catch((err) => {
        this.imageLoading.delete(idx)
        this.log.w(`Imagen product thumb failed: ${err}`)
      })
  }
}
