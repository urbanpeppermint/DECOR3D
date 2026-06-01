/**
 * Catalog of design styles for the StylePickerController and prompt text for
 * Gemini + Imagen + TTS.
 *
 * `blurb` is a one-line subtitle: if you assign the matching `*Blurb` Text
 * inputs on StylePickerController, we copy it at start — static caption next
 * to the title, not a hover tooltip (unless you add separate hover UI).
 */

import { DecorStyleId } from './DecorTypes'

export interface DecorStyle {
  id: DecorStyleId
  displayName: string
  blurb: string
  analyzerHint: string
  imagenPromptSuffix: string
  voiceTone: string
}

export const STYLES: ReadonlyArray<DecorStyle> = [
  {
    id: 'scandinavian',
    displayName: 'Scandinavian',
    blurb: 'Pale woods, white walls, hygge.',
    analyzerHint:
      'Lean into Scandinavian minimalism: bright neutral palette, light oak, linen, abundant natural light, intentional negative space.',
    imagenPromptSuffix:
      'Scandinavian minimalist interior redesign: pale oak floors, soft white walls, light linen textiles, blonde wood furniture, hygge atmosphere, abundant natural daylight, uncluttered negative space, photorealistic, magazine quality, ',
    voiceTone: 'Calm, warm, softly spoken Nordic confidence. Unhurried pacing.',
  },
  {
    id: 'vintage',
    displayName: 'Vintage',
    blurb: 'Patina, antiques, layered texture.',
    analyzerHint:
      'Lean into a curated vintage look: 1940s–1970s antiques, patinated metals, layered rugs, framed prints, sentimental clutter that still feels intentional.',
    imagenPromptSuffix:
      'Vintage eclectic interior redesign: layered Persian rugs, mid-century brass fixtures, framed botanical prints, antique wooden cabinets, warm sepia ambient light, gentle patina on every surface, photorealistic, ',
    voiceTone: 'Wistful, slightly theatrical, romantic. Like a thoughtful antique-shop owner.',
  },
  {
    id: 'industrial',
    displayName: 'Industrial',
    blurb: 'Exposed brick, blackened steel, raw wood.',
    analyzerHint:
      'Lean into industrial loft style: exposed brick, blackened steel, raw wood, Edison bulbs, leather, factory-warehouse cues kept refined.',
    imagenPromptSuffix:
      'Industrial loft interior redesign: exposed red brick walls, blackened steel beams, polished concrete floors, reclaimed timber shelving, Edison-bulb pendants, distressed leather furniture, photorealistic, magazine quality, ',
    voiceTone: 'Confident, low-register, matter-of-fact. Brooklyn loft tour energy.',
  },
  {
    id: 'midcentury',
    displayName: 'Mid-Century Modern',
    blurb: 'Tapered legs, warm walnut, geometric.',
    analyzerHint:
      'Lean into mid-century modern: tapered walnut furniture, warm earth-tone palette, geometric textiles, atomic shapes, restrained ornament.',
    imagenPromptSuffix:
      'Mid-century modern interior redesign: walnut credenza with tapered legs, mustard and rust upholstery, abstract wall art, brass sputnik chandelier, terrazzo accents, warm afternoon light, photorealistic, ',
    voiceTone: 'Cool, articulate, mid-Atlantic confidence. Slightly dry humor.',
  },
  {
    id: 'japandi',
    displayName: 'Japandi',
    blurb: 'Quiet luxury, raw materials, wabi-sabi.',
    analyzerHint:
      'Lean into Japandi: a fusion of Japanese wabi-sabi and Scandinavian restraint. Low silhouettes, hand-thrown ceramics, raw plaster, shoji-style softness.',
    imagenPromptSuffix:
      'Japandi interior redesign: low-profile dark-oak furniture, hand-thrown ceramic vases with single ikebana stems, raw plaster walls, paper-screen diffused light, woven tatami textures, deeply restrained palette of charcoal and bone, photorealistic, ',
    voiceTone: 'Quiet, deliberate, meditative. Long pauses are welcome.',
  },
  {
    id: 'modern_farmhouse',
    displayName: 'Modern Farmhouse',
    blurb: 'Rustic comfort, clean lines, shiplap, light-filled.',
    analyzerHint:
      'Lean into modern farmhouse: rustic comfort with clean modern lines, shiplap or board-and-batten, natural wood beams, neutral palette, bright daylight, cozy textiles.',
    imagenPromptSuffix:
      'Modern farmhouse interior redesign: white shiplap accent walls, reclaimed wood beams, wide-plank oak floors, black iron hardware, linen slipcovered seating, apron-front sink cues, soft neutral palette, abundant natural light, photorealistic, ',
    voiceTone: 'Warm, neighborly, reassuring. Like a home-renovation host who loves natural materials.',
  },
  {
    id: 'boho',
    displayName: 'Bohemian',
    blurb: 'Eclectic layers, plants, patterns, texture.',
    analyzerHint:
      'Lean into bohemian style: layered textiles and rugs, macramé or woven wall art, abundant plants, mixed patterns, warm saturated accents, global-inspired décor.',
    imagenPromptSuffix:
      'Bohemian interior redesign: layered Moroccan-style rugs, rattan and cane furniture, hanging plants and potted greenery, embroidered throw pillows, terracotta pots, warm string lights, artful clutter that feels curated, photorealistic, ',
    voiceTone: 'Free-spirited, enthusiastic, sensory. Celebrate color and texture.',
  },
  {
    id: 'minimalist',
    displayName: 'Minimalist',
    blurb: 'Decluttered, functional, restrained neutrals.',
    analyzerHint:
      'Lean into minimalist interiors: decluttered planes, hidden storage, restrained neutral palette, crisp lines, few statement pieces, emphasis on negative space.',
    imagenPromptSuffix:
      'Minimalist interior redesign: seamless white walls, pale concrete or pale oak floors, built-in storage, single sculptural light fixture, one statement chair, almost no accessories, museum-quiet calm, photorealistic, ',
    voiceTone: 'Sparse, precise, calm. Short sentences.',
  },
  {
    id: 'mediterranean',
    displayName: 'Mediterranean',
    blurb: 'Earthy tones, textured walls, warm materials.',
    analyzerHint:
      'Lean into Mediterranean interiors: natural stone or lime-wash walls, terracotta or zellige tile accents, arched openings where appropriate, wrought iron, warm earthy palette.',
    imagenPromptSuffix:
      'Mediterranean interior redesign: textured stucco or lime-wash walls, terracotta floor tile or warm wood, arched niches, woven jute rugs, olive and sand palette, hand-painted ceramics, dappled sunlight, photorealistic, ',
    voiceTone: 'Sunny, relaxed, coastal-European warmth.',
  },
  {
    id: 'eclectic',
    displayName: 'Eclectic',
    blurb: 'Mixed eras, unified by palette or theme.',
    analyzerHint:
      'Lean into eclectic design: intentional mix of periods and styles held together by a cohesive color story or repeated motif, gallery wall, statement lighting.',
    imagenPromptSuffix:
      'Eclectic interior redesign: curated mix of vintage and contemporary furniture, bold but cohesive color accents, gallery wall of framed art, sculptural floor lamp, patterned area rug tying the room together, photorealistic, ',
    voiceTone: 'Curious, witty, confident curator energy.',
  },
]

const STYLES_BY_ID: Map<DecorStyleId, DecorStyle> = (() => {
  const m = new Map<DecorStyleId, DecorStyle>()
  for (let i = 0; i < STYLES.length; i++) {
    m.set(STYLES[i].id, STYLES[i])
  }
  return m
})()

export function getStyle(id: DecorStyleId): DecorStyle {
  const found = STYLES_BY_ID.get(id)
  if (!found) {
    throw new Error(`[DecorStyleCatalog] Unknown style id "${id}"`)
  }
  return found
}

/** Defensive runtime parse for any string coming from voice / args. */
export function parseStyleId(raw: string): DecorStyleId | null {
  const key = (raw || '').toLowerCase().trim().replace(/[\s-]+/g, '_')
  const direct: DecorStyleId[] = [
    'scandinavian',
    'vintage',
    'industrial',
    'midcentury',
    'japandi',
    'modern_farmhouse',
    'boho',
    'minimalist',
    'mediterranean',
    'eclectic',
  ]
  for (let i = 0; i < direct.length; i++) {
    if (key === direct[i] || key === direct[i].replace(/_/g, '')) {
      return direct[i]
    }
  }
  if (key.indexOf('scand') >= 0) {
    return 'scandinavian'
  }
  if (key.indexOf('vintage') >= 0 || key.indexOf('retro') >= 0) {
    return 'vintage'
  }
  if (key.indexOf('industrial') >= 0 || key.indexOf('loft') >= 0) {
    return 'industrial'
  }
  if (key.indexOf('mid') >= 0 && key.indexOf('century') >= 0) {
    return 'midcentury'
  }
  if (key.indexOf('japandi') >= 0 || key.indexOf('wabi') >= 0) {
    return 'japandi'
  }
  if (key.indexOf('farmhouse') >= 0 || key.indexOf('modern_farm') >= 0) {
    return 'modern_farmhouse'
  }
  if (key.indexOf('boho') >= 0 || key.indexOf('bohemian') >= 0) {
    return 'boho'
  }
  if (key.indexOf('minimal') >= 0) {
    return 'minimalist'
  }
  if (key.indexOf('mediterr') >= 0) {
    return 'mediterranean'
  }
  if (key.indexOf('eclectic') >= 0) {
    return 'eclectic'
  }
  return null
}
