import NativeLogger from 'SpectaclesInteractionKit.lspkg/Utils/NativeLogger'
import { BaseButton } from 'SpectaclesUIKit.lspkg/Scripts/Components/Button/BaseButton'
import { RectangleButton } from 'SpectaclesUIKit.lspkg/Scripts/Components/Button/RectangleButton'
import { DecorStyleId } from './DecorTypes'

const BASE_BUTTON_TYPE = BaseButton.getTypeName()
const RECT_BUTTON_TYPE = RectangleButton.getTypeName()
const log = new NativeLogger('StylePickerButtonBinder')

/**
 * Binds a UIKit button after it has finished initializing (required for prefabs
 * spawned at runtime, especially inside SIK ScrollView).
 */
export function bindStylePickButton(
  host: BaseScriptComponent,
  button: BaseButton,
  onPick: () => void,
  afterInitialized?: () => void,
): void {
  let bound = false
  const attach = (): void => {
    if (bound) {
      return
    }
    bound = true
    button.onTriggerUp.add(onPick)
    if (afterInitialized) {
      afterInitialized()
    }
  }
  button.onInitialized.add(attach)
  host.createEvent('OnStartEvent').bind(attach)
  const retry = host.createEvent('DelayedCallbackEvent')
  retry.bind(attach)
  retry.reset(0.08)
  if (afterInitialized) {
    const late = host.createEvent('DelayedCallbackEvent')
    late.bind(afterInitialized)
    late.reset(0.2)
  }
}

export function findStyleButtonUnder(root: SceneObject, maxDepth: number): BaseButton | null {
  const direct = root.getComponent(BASE_BUTTON_TYPE) as BaseButton | null
  if (direct) {
    return direct
  }
  const rect = root.getComponent(RECT_BUTTON_TYPE) as RectangleButton | null
  if (rect) {
    return rect
  }
  if (maxDepth <= 0) {
    return null
  }
  const count = root.getChildrenCount()
  for (let i = 0; i < count; i++) {
    const found = findStyleButtonUnder(root.getChild(i), maxDepth - 1)
    if (found) {
      return found
    }
  }
  return null
}

export function bindStylePickButtonForRow(
  host: BaseScriptComponent,
  row: SceneObject,
  styleId: DecorStyleId,
  onPick: (id: DecorStyleId) => void,
  afterButtonReady?: () => void,
): boolean {
  const btn = findStyleButtonUnder(row, 6)
  if (!btn) {
    log.w(`No BaseButton on row "${row.name}" (style ${styleId})`)
    return false
  }
  bindStylePickButton(
    host,
    btn,
    () => {
      log.i(`Row tapped: ${styleId}`)
      onPick(styleId)
    },
    afterButtonReady,
  )
  return true
}
