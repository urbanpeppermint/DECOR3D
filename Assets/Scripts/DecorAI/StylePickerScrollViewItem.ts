import NativeLogger from 'SpectaclesInteractionKit.lspkg/Utils/NativeLogger'
import { STYLES } from './DecorStyleCatalog'
import { ScrollView } from 'SpectaclesInteractionKit.lspkg/Components/UI/ScrollView/ScrollView'
import { bindStylePickButtonForRow } from './StylePickerButtonBinder'
import { StylePickerController } from './StylePickerController'
import { ensureSikScreenTransformsOnSubtree } from './StylePickerSikScreenTransforms'

/**
 * Per-row behavior for SIK ScrollView lists (RocketScrollViewItem equivalent).
 * Assigned on the style row prefab root; initialized by StylePickerScrollContentCreator.
 */
@component
export class StylePickerScrollViewItem extends BaseScriptComponent {
  private controller: StylePickerController | null = null
  private styleIndex: number = -1
  private readonly log = new NativeLogger('StylePickerScrollViewItem')

  init(controller: StylePickerController, styleIndex: number): void {
    this.controller = controller
    this.styleIndex = styleIndex
    this.createEvent('OnStartEvent').bind(() => {
      this.setupRow()
    })
  }

  private setupRow(): void {
    if (!this.controller || this.styleIndex < 0 || this.styleIndex >= STYLES.length) {
      return
    }
    const style = STYLES[this.styleIndex]
    const root = this.getSceneObject()
    root.name = `StyleRow_${style.id}`

    const texts: Text[] = []
    this.collectTextsDepthFirst(root, 6, texts)
    if (texts.length >= 1) {
      texts[0].text = style.displayName
    }
    if (texts.length >= 2) {
      texts[1].text = style.blurb
    }

    if (!this.controller) {
      return
    }
    bindStylePickButtonForRow(
      this,
      root,
      style.id,
      (id) => {
        this.controller!.pickStyle(id)
      },
      () => {
        const rowSt = root.getComponent('Component.ScreenTransform') as ScreenTransform | null
        const size = rowSt ? rowSt.offsets.getSize() : new vec2(32, 5.4)
        ensureSikScreenTransformsOnSubtree(root, {
          w: Math.max(1, size.x),
          h: Math.max(0.01, size.y),
        })
        const content = root.getParent()
        if (!content) {
          return
        }
        const scrollView = content.getParent()?.getComponent(ScrollView.getTypeName()) as ScrollView | null
        if (scrollView?.isReady) {
          scrollView.recomputeBoundaries()
        }
      },
    )
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
