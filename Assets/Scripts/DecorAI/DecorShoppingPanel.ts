import NativeLogger from 'SpectaclesInteractionKit.lspkg/Utils/NativeLogger'
import { BaseButton } from 'SpectaclesUIKit.lspkg/Scripts/Components/Button/BaseButton'
import { RectangleButton } from 'SpectaclesUIKit.lspkg/Scripts/Components/Button/RectangleButton'
import { DecorShoppingItem, DecorSuggestion, RoomAnalysis } from './DecorTypes'
import { bindStylePickButton } from './StylePickerButtonBinder'
import { DecorSnap3DGenerator } from './DecorSnap3DGenerator'

/**
 * Carousel for Gemini suggestions (4–6 slides). Prev/next changes the active suggestion;
 * Generate 3D uses that slide's title, detail, and snap3dPrompt.
 */
@component
export class DecorShoppingPanel extends BaseScriptComponent {
  @input
  panelRoot: SceneObject

  @input
  @allowUndefined
  titleText: Text

  @input
  @allowUndefined
  bodyText: Text

  @input
  @allowUndefined
  categoryText: Text

  @input
  @allowUndefined
  whereText: Text

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
  openOnCatalogSet: boolean = true

  @input
  @allowUndefined
  generate3dButton: BaseButton

  @input
  @allowUndefined
  duplicate3dButton: BaseButton

  @input
  @allowUndefined
  snap3dGenerator: DecorSnap3DGenerator

  @input
  @allowUndefined
  @hint('Shows which suggestion the 3D button will use (optional).')
  generate3dHintText: Text

  private readonly log = new NativeLogger('DecorShoppingPanel')
  private suggestions: DecorSuggestion[] = []
  private shoppingItems: DecorShoppingItem[] = []
  private index: number = 0
  private wired: boolean = false
  private styleName: string = ''
  private roomType: string = ''

  onAwake(): void {
    this.hide()
    this.createEvent('OnStartEvent').bind(() => {
      this.autowireTextsFromPanel()
      this.wireButtons()
    })
  }

  setGenerationContext(styleName: string, roomType: string): void {
    this.styleName = styleName ?? ''
    this.roomType = roomType ?? ''
    const gen = this.resolveSnap3D()
    if (gen) {
      gen.setContext(this.styleName, this.roomType)
    }
  }

  setCatalogFromAnalysis(analysis: RoomAnalysis): void {
    const suggestions = analysis.suggestions ?? []
    this.suggestions = suggestions.filter((s) => s && s.title && s.title.length > 0)
    this.shoppingItems = (analysis.shoppingItems ?? []).filter(
      (i) => i && i.title && i.title.length > 0,
    )
    this.index = 0
    if (this.suggestions.length === 0) {
      this.hide()
      return
    }
    this.log.i(`Suggestion slides: ${this.suggestions.length}`)
    if (this.openOnCatalogSet) {
      this.show()
    } else {
      this.refreshTexts()
    }
  }

  /** @deprecated Use setCatalogFromAnalysis */
  setCatalog(items: DecorShoppingItem[]): void {
    this.shoppingItems = items ? items.filter((i) => i && i.title && i.title.length > 0) : []
    this.suggestions = this.shoppingItems.map((item) => ({
      title: item.title,
      detail: item.description,
      snap3dPrompt: item.snap3dPrompt,
    }))
    this.index = 0
    if (this.suggestions.length === 0) {
      this.hide()
      return
    }
    if (this.openOnCatalogSet) {
      this.show()
    } else {
      this.refreshTexts()
    }
  }

  getCurrentSuggestion(): DecorSuggestion | null {
    if (this.suggestions.length === 0) {
      return null
    }
    return this.suggestions[this.index]
  }

  getCurrentShoppingItem(): DecorShoppingItem | null {
    const suggestion = this.getCurrentSuggestion()
    if (!suggestion) {
      return null
    }
    return this.findShoppingForSuggestion(suggestion)
  }

  show(): void {
    if (!this.panelRoot || this.suggestions.length === 0) {
      return
    }
    this.setPanelVisible(true)
    this.refreshTexts()
  }

  hide(): void {
    this.setPanelVisible(false)
    const gen = this.resolveSnap3D()
    if (gen) {
      gen.dismiss()
    }
  }

  /** Clears carousel data and Snap3D when the user hits RESTART. */
  resetForRestart(): void {
    this.index = 0
    this.suggestions = []
    this.shoppingItems = []
    this.setPanelVisible(false)
    const gen = this.resolveSnap3D()
    if (gen) {
      gen.dismiss()
      gen.clearStatus()
    }
  }

  private setPanelVisible(visible: boolean): void {
    if (!this.panelRoot) {
      return
    }
    this.panelRoot.enabled = visible
  }

  private wireButtons(): void {
    if (this.wired) {
      return
    }
    if (this.prevButton) {
      bindStylePickButton(this, this.prevButton, () => this.step(-1))
    }
    if (this.nextButton) {
      bindStylePickButton(this, this.nextButton, () => this.step(1))
    }
    if (this.closeButton) {
      bindStylePickButton(this, this.closeButton, () => this.hide())
    }
    if (this.generate3dButton) {
      bindStylePickButton(this, this.generate3dButton, () => this.generateCurrentSlide3D())
    }
    if (this.duplicate3dButton) {
      bindStylePickButton(this, this.duplicate3dButton, () => this.duplicateCurrentModel())
    }
    this.wired = true
  }

  private duplicateCurrentModel(): void {
    const gen = this.resolveSnap3D()
    if (!gen) {
      this.log.w('No DecorSnap3DGenerator — assign on panel')
      return
    }
    gen.duplicateActiveModel()
  }

  private generateCurrentSlide3D(): void {
    const suggestion = this.getCurrentSuggestion()
    if (!suggestion) {
      return
    }
    const gen = this.resolveSnap3D()
    if (!gen) {
      this.log.w('No DecorSnap3DGenerator — assign on panel or Snap3DInteractableFactory object')
      return
    }
    gen.setContext(this.styleName, this.roomType)
    gen.generateForSuggestion(suggestion, this.getCurrentShoppingItem())
  }

  private resolveSnap3D(): DecorSnap3DGenerator | null {
    if (this.snap3dGenerator) {
      return this.snap3dGenerator
    }
    return this.sceneObject.getComponent(
      DecorSnap3DGenerator.getTypeName(),
    ) as DecorSnap3DGenerator | null
  }

  private step(delta: number): void {
    if (this.suggestions.length === 0) {
      return
    }
    this.index = (this.index + delta + this.suggestions.length) % this.suggestions.length
    this.refreshTexts()
  }

  private findShoppingForSuggestion(suggestion: DecorSuggestion): DecorShoppingItem | null {
    const byLink = this.shoppingItems.find(
      (i) =>
        i.relatedSuggestionTitle &&
        i.relatedSuggestionTitle.toLowerCase() === suggestion.title.toLowerCase(),
    )
    if (byLink) {
      return byLink
    }
    if (this.index < this.shoppingItems.length) {
      return this.shoppingItems[this.index]
    }
    return null
  }

  private refreshTexts(): void {
    if (this.suggestions.length === 0) {
      return
    }
    const suggestion = this.suggestions[this.index]
    const shop = this.findShoppingForSuggestion(suggestion)
    const gen = this.resolveSnap3D()

    if (this.titleText) {
      this.titleText.text = suggestion.title
    }
    if (this.bodyText) {
      this.bodyText.text = suggestion.detail
    }
    if (this.categoryText) {
      this.categoryText.text = shop
        ? this.formatCategory(shop.category)
        : this.formatPriority(suggestion.priority)
    }
    if (this.whereText) {
      const shopLines = shop
        ? `Where to look: ${shop.whereToLook}\nSearch: ${shop.searchHint}`
        : 'Pinch Generate 3D to preview this idea in AR.'
      this.whereText.text = shopLines
    }
    if (this.indexText) {
      this.indexText.text = `${this.index + 1} / ${this.suggestions.length}`
    }
    if (this.generate3dHintText && gen) {
      const preview = gen.getPreviewPrompt(suggestion, shop)
      const short =
        preview.length > 120 ? `${preview.substring(0, 117)}…` : preview
      this.generate3dHintText.text = `3D prompt: ${short}`
    }
  }

  private formatCategory(raw: string): string {
    const label = raw.replace(/_/g, ' ')
    return label.charAt(0).toUpperCase() + label.slice(1)
  }

  private formatPriority(raw?: string): string {
    if (!raw) {
      return 'Decor idea'
    }
    return raw.charAt(0).toUpperCase() + raw.slice(1) + ' priority'
  }

  private autowireTextsFromPanel(): void {
    if (!this.panelRoot) {
      return
    }
    this.titleText = this.titleText ?? this.findTextByChildName('ShopTitle')
    this.bodyText = this.bodyText ?? this.findTextByChildName('ShopBody')
    this.categoryText = this.categoryText ?? this.findTextByChildName('ShopCategory')
    this.whereText = this.whereText ?? this.findTextByChildName('ShopWhere')
    this.indexText = this.indexText ?? this.findTextByChildName('ShopIndex')
    this.generate3dHintText =
      this.generate3dHintText ?? this.findTextByChildName('Generate3DHint')
    this.duplicate3dButton =
      this.duplicate3dButton ??
      (this.findButtonByChildName('Duplicate3DButton') as BaseButton | null)
  }

  private findButtonByChildName(name: string): BaseButton | null {
    const obj = this.panelRoot ? this.findChildByName(this.panelRoot, name) : null
    if (!obj) {
      return null
    }
    const asBase = obj.getComponent(BaseButton.getTypeName()) as BaseButton | null
    if (asBase) {
      return asBase
    }
    return obj.getComponent(RectangleButton.getTypeName()) as BaseButton | null
  }

  private findTextByChildName(name: string): Text | null {
    if (!this.panelRoot) {
      return null
    }
    const found = this.findChildByName(this.panelRoot, name)
    if (!found) {
      return null
    }
    return found.getComponent('Component.Text') as Text | null
  }

  private findChildByName(root: SceneObject, name: string): SceneObject | null {
    if (root.name === name) {
      return root
    }
    const n = root.getChildrenCount()
    for (let i = 0; i < n; i++) {
      const hit = this.findChildByName(root.getChild(i), name)
      if (hit) {
        return hit
      }
    }
    return null
  }
}
