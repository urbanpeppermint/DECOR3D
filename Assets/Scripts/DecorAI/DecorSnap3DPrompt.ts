import { DecorShoppingItem, DecorSuggestion } from './DecorTypes'

/** Snap3D prompt from the decor suggestion currently on screen (carousel slide). */
export function buildSnap3DPromptFromSuggestion(
  suggestion: DecorSuggestion,
  styleName?: string,
  roomType?: string,
  relatedShop?: DecorShoppingItem | null,
): string {
  if (suggestion.snap3dPrompt && suggestion.snap3dPrompt.trim().length > 0) {
    return suggestion.snap3dPrompt.trim()
  }

  const style = styleName && styleName.length > 0 ? styleName : 'modern interior'
  const room = roomType && roomType.length > 0 ? roomType : 'living room'
  const productHint =
    relatedShop && relatedShop.title.length > 0 ? `Product type: ${relatedShop.title}. ` : ''

  return [
    productHint,
    `Home decor object for ${suggestion.title}.`,
    suggestion.detail,
    `${style} style, suitable for a ${room}.`,
    'Single isolated item, neutral studio lighting, no people, no room background, AR-ready.',
  ]
    .filter((line) => line && line.length > 0)
    .join(' ')
}

/** Legacy: shopping-item-only prompt (kept for shop-linked flows). */
export function buildSnap3DPrompt(
  item: DecorShoppingItem,
  styleName?: string,
  roomType?: string,
): string {
  if (item.snap3dPrompt && item.snap3dPrompt.trim().length > 0) {
    return item.snap3dPrompt.trim()
  }

  const style = styleName && styleName.length > 0 ? styleName : 'modern interior'
  const room = roomType && roomType.length > 0 ? roomType : 'living room'
  const category =
    typeof item.category === 'string' ? item.category.replace(/_/g, ' ') : 'home decor'

  return [
    `Single ${category} product: ${item.title}.`,
    item.description,
    `Photorealistic object for AR preview in a ${room} with ${style} decor.`,
    'One isolated item, neutral studio lighting, no people, no room background.',
  ]
    .filter((line) => line && line.length > 0)
    .join(' ')
}
