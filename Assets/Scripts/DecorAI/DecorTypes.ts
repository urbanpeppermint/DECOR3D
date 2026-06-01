/**
 * Shared types for the Décor3D feature (DecorAI module folder).
 *
 * Keep this file dependency-free so other module scripts can import it without
 * pulling Lens-Studio-only types. All runtime types live in sibling files.
 */

/** Canonical id of every design style the picker supports. */
export type DecorStyleId =
  | 'scandinavian'
  | 'vintage'
  | 'industrial'
  | 'midcentury'
  | 'japandi'
  | 'modern_farmhouse'
  | 'boho'
  | 'minimalist'
  | 'mediterranean'
  | 'eclectic'

/** Single design suggestion as returned by the Gemini room analyzer. */
export interface DecorSuggestion {
  /** Short title surfaced in UI, e.g. "Swap wall art" or "Soften the lighting". */
  title: string
  /** One-to-two sentence rationale. Played back by TTS narrator. */
  detail: string
  /** Optional priority hint ("high" | "medium" | "low") used to order suggestions. */
  priority?: 'high' | 'medium' | 'low'
  /** Object-only prompt for Snap3D (single decor piece, no room). */
  snap3dPrompt?: string
}

/** Product the user could buy locally or online — tied to a decor suggestion. */
export type DecorShoppingCategory =
  | 'wallpaper'
  | 'paint'
  | 'carpet'
  | 'furniture'
  | 'lighting'
  | 'textiles'
  | 'decor'
  | 'other'

export interface DecorShoppingItem {
  title: string
  description: string
  category: DecorShoppingCategory | string
  /** e.g. "IKEA, Home Depot, local paint store" */
  whereToLook: string
  /** Short search phrase for web / maps */
  searchHint: string
  /** Optional rough price band from Gemini (not live retailer pricing). */
  priceHint?: string
  /** Matches `DecorSuggestion.title` from the same analysis */
  relatedSuggestionTitle?: string
  /**
   * Object-only prompt for Snap3D (single product, no room). If omitted, built from
   * title + description + category at generation time.
   */
  snap3dPrompt?: string
}

/**
 * Product row for {@link DecorProductSuggestionsPanel} (Imagen product thumbnails).
 * Distinct from {@link DecorShoppingItem} field names used by {@link DecorShoppingPanel}.
 */
export interface DecorProductIdea {
  title: string
  description: string
  category: DecorShoppingCategory | string
  /** Retailers or store types, e.g. "IKEA, local lighting shop". */
  shopHint: string
  /** Short search phrase for web / maps. */
  searchKeywords: string
  /** Object-only Imagen prompt for a product photo thumbnail. */
  imagenPrompt: string
}

/**
 * Structured analysis returned by the Gemini Vision step.
 *
 * `makeoverPrompt` is the seed string we pass to Imagen for the redecoration
 * visualization. It should already include phrases that preserve the room's
 * geometry (e.g. "same camera angle, same window position") so Imagen does not
 * invent a completely different room.
 */
export interface RoomAnalysis {
  /** e.g. "living room", "bedroom", "home office" */
  roomType: string
  /** One short line: room type + current vibe (not a full scan walkthrough). */
  roomSummary: string
  /** Up to ~5 dominant colour names ("warm beige", "muted forest green", ...). */
  dominantColors: string[]
  /** Ordered list of actionable redecoration suggestions for the chosen style. */
  suggestions: DecorSuggestion[]
  /** Shoppable picks related to suggestions and the AI makeover direction. */
  shoppingItems: DecorShoppingItem[]
  /**
   * Imagen-ready makeover prompt. Combines layout-preserving hints with the
   * chosen style. Final `imagenPrompt` is `style.imagenPromptSuffix + this`.
   */
  makeoverPrompt: string
  /** Echoed back by Gemini when a room-purpose transform was requested. */
  targetRoomType?: string
}

/** Top-level orchestrator state. Mostly informational; not persisted. */
export interface DecorRunState {
  selectedStyle: DecorStyleId | null
  /** When non-null the user wants to convert the space to a different function. */
  targetPurpose: string | null
  hasRoomScan: boolean
  hasAnalysis: boolean
  hasMakeover: boolean
}
