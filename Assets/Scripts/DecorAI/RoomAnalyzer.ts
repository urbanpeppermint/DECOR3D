import Event from 'SpectaclesInteractionKit.lspkg/Utils/Event'
import NativeLogger from 'SpectaclesInteractionKit.lspkg/Utils/NativeLogger'
import { Gemini } from 'RemoteServiceGateway.lspkg/HostedExternal/GoogleGenAI'
import { GoogleGenAITypes } from 'RemoteServiceGateway.lspkg/HostedExternal/GoogleGenAITypes'
import { DecorShoppingCategory, DecorStyleId, DecorSuggestion, DecorShoppingItem, RoomAnalysis } from './DecorTypes'
import { getStyle } from './DecorStyleCatalog'

/**
 * Vision step: sends the captured room image + chosen style to Gemini and
 * parses the structured JSON response into `RoomAnalysis`.
 *
 * Uses the **sync** Gemini endpoint (`Gemini.models()`), not the Live
 * WebSocket — matches the Travel_Planner pattern. A single round-trip is
 * easier to reason about than streaming for one-shot vision analysis.
 *
 * The prompt commands the model to return JSON only. We tolerate optional
 * markdown code fences around the payload (some Gemini variants still wrap
 * outputs even with `responseMimeType: "application/json"`).
 */
@component
export class RoomAnalyzer extends BaseScriptComponent {
  @input
  @hint('Gemini model id for vision analysis. Flash-class models are fast enough for one-shot.')
  geminiModel: string = 'gemini-2.0-flash'

  @input
  @hint('Show this SceneObject while the Gemini round-trip is in flight.')
  @allowUndefined
  loadingIndicator: SceneObject

  @input
  @hint('Optional Text component used for short status messages (errors, retries, etc.).')
  @allowUndefined
  statusText: Text

  readonly onAnalysisComplete: Event<RoomAnalysis> = new Event<RoomAnalysis>()
  readonly onAnalysisFailed: Event<string> = new Event<string>()

  private readonly log = new NativeLogger('RoomAnalyzer')
  private inFlight: boolean = false

  /** Drop in-flight flag when user returns to the style menu (async call may still complete). */
  cancelPending(): void {
    this.inFlight = false
    this.setLoading(false)
    this.setStatus('')
  }

  /**
   * @param base64Jpeg  Raw base64 (no `data:` prefix) JPEG of the captured room.
   * @param styleId     Style chosen by the user — drives the analyzerHint and
   *                    nudges Gemini's `makeoverPrompt` toward the right palette.
   */
  analyze(base64Jpeg: string, styleId: DecorStyleId, targetPurpose?: string): void {
    if (this.inFlight) {
      this.log.w('analyze ignored: a previous request is still in flight')
      return
    }
    if (!base64Jpeg || base64Jpeg.length === 0) {
      this.onAnalysisFailed.invoke('analyze called with empty base64')
      return
    }
    this.inFlight = true
    this.setLoading(true)
    this.setStatus('Analyzing room…')

    const style = getStyle(styleId)
    const prompt = this.buildPrompt(style.analyzerHint, targetPurpose)

    const request: GoogleGenAITypes.Gemini.Models.GenerateContentRequest = {
      model: this.geminiModel,
      type: 'generateContent',
      body: {
        contents: [
          {
            role: 'user',
            parts: [
              {
                inlineData: {
                  mimeType: 'image/jpeg',
                  data: base64Jpeg,
                },
              },
              { text: prompt },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.4,
          responseMimeType: 'application/json',
        } as GoogleGenAITypes.Common.GenerationConfig,
      },
    }

    Gemini.models(request)
      .then((response) => {
        const text = this.extractText(response)
        if (!text || text.length === 0) {
          this.failAnalysis('Gemini returned no text. Check promptFeedback / safety block in Logger.')
          this.log.e(`Full response: ${JSON.stringify(response).substring(0, 1000)}`)
          return
        }
        const analysis = this.parseAnalysis(text)
        if (!analysis) {
          this.failAnalysis('Gemini response was not valid JSON. See Logger for raw text.')
          this.log.e(`Raw text (first 2000 chars): ${text.substring(0, 2000)}`)
          return
        }
        this.inFlight = false
        this.setLoading(false)
        this.setStatus(`Found ${analysis.suggestions.length} ideas for your ${style.displayName} makeover.`)
        this.onAnalysisComplete.invoke(analysis)
      })
      .catch((error) => {
        this.failAnalysis(`Gemini.models failed: ${error}`)
      })
  }

  private buildPrompt(analyzerHint: string, targetPurpose?: string): string {
    const isTransform = !!targetPurpose && targetPurpose.length > 0

    const preamble = isTransform
      ? `You are a senior interior decorator helping someone completely transform a real room. The user wants to convert this space into a ${targetPurpose}. Suggest furniture, fixtures, appliances, and finishes appropriate for that new purpose.`
      : 'You are a senior interior decorator helping someone redecorate a real room.'

    const makeoverInstruction = isTransform
      ? `- \`makeoverPrompt\`: 70–100 words for image generation. FIRST lock same camera angle, same window/door positions, same walls as the photo; THEN replace all furniture and fixtures with those appropriate for a ${targetPurpose}, styled per the target style.`
      : '- `makeoverPrompt`: 70–100 words for image generation. FIRST lock same camera angle, same window/door positions, same walls as the photo; THEN describe styled finishes and decor only.'

    const jsonSchemaLines: string[] = [
      '{',
      '  "roomType": "living room | bedroom | kitchen | dining room | office | other",',
    ]
    if (isTransform) {
      jsonSchemaLines.push(`  "targetRoomType": "${targetPurpose}",`)
    }
    jsonSchemaLines.push('  "roomSummary": "one short sentence: room type + current style in plain words",')

    return [
      preamble,
      'Analyze the photo and return ONE JSON object only (no markdown).',
      '',
      'Target style from the user:',
      analyzerHint,
      '',
      'Tone:',
      '- `roomType` + `roomSummary`: ONE line only — room type (living room, bedroom, etc.) and current vibe. Do NOT describe camera angles, window positions, or a long scan walkthrough.',
      isTransform
        ? `- \`suggestions\`: 4–6 concrete ideas to transform this space into a ${targetPurpose}. Focus on furniture, fixtures, appliances, and finishes needed for the new purpose, styled per the target style.`
        : '- `suggestions`: 4–6 concrete DECORATION ideas (paint, wallpaper, rugs, furniture swaps, lighting, textiles, art). Focus on what to buy and change — not architecture inventory.',
      '- `shoppingItems`: 4–6 real-world product TYPES the user could find nearby or online (IKEA, Home Depot, Target, local paint store, furniture outlet, etc.). Each must link to a suggestion via `relatedSuggestionTitle`. Include `snap3dPrompt` for Snap3D — one isolated product, no room, no people.',
      makeoverInstruction,
      '',
      'JSON shape (all keys required):',
      ...jsonSchemaLines,
      '  "dominantColors": ["3-5 colour names"],',
      '  "suggestions": [',
      '    { "title": "short title", "detail": "1-2 sentences: what to do and why", "priority": "high|medium|low", "snap3dPrompt": "15-40 words: single decor object for 3D, no room, no people" }',
      '  ],',
      '  "shoppingItems": [',
      '    {',
      '      "title": "product name or type",',
      '      "description": "1-2 sentences why it fits the makeover",',
      '      "category": "wallpaper|paint|carpet|furniture|lighting|textiles|decor|other",',
      '      "whereToLook": "store types or chains nearby",',
      '      "searchHint": "short Google-shopping style query",',
      '      "priceHint": "rough USD range e.g. $40–$120 (estimate only, not live pricing)",',
      '      "relatedSuggestionTitle": "must match one suggestions[].title exactly",',
      '      "snap3dPrompt": "15–40 words: single product only for 3D mesh, neutral background, no room, no people"',
      '    }',
      '  ],',
      '  "makeoverPrompt": "Imagen paragraph as described above"',
      '}',
    ].join('\n')
  }

  private extractText(response: GoogleGenAITypes.Gemini.Models.GenerateContentResponse): string {
    try {
      const candidates = response && response.candidates
      if (!candidates || candidates.length === 0) {
        return ''
      }
      const parts = candidates[0].content && candidates[0].content.parts
      if (!parts || parts.length === 0) {
        return ''
      }
      const first = parts[0] as GoogleGenAITypes.Common.Part
      if (first && typeof first.text === 'string') {
        return first.text
      }
    } catch (e) {
      this.log.e(`extractText error: ${e}`)
    }
    return ''
  }

  private parseAnalysis(raw: string): RoomAnalysis | null {
    const trimmed = this.stripCodeFence(raw).trim()
    const sliced = this.extractJsonObject(trimmed)
    if (!sliced) {
      return null
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(sliced)
    } catch (e) {
      this.log.e(`JSON.parse failed: ${e}`)
      return null
    }
    const obj = parsed as Partial<RoomAnalysis>
    if (
      typeof obj.roomSummary !== 'string' ||
      typeof obj.makeoverPrompt !== 'string' ||
      !Array.isArray(obj.dominantColors) ||
      !Array.isArray(obj.suggestions)
    ) {
      this.log.e('parsed JSON missing required keys')
      return null
    }
    const normalizedSuggestions = this.normalizeSuggestions(obj.suggestions)
    const shoppingItems = this.normalizeShoppingItems(
      Array.isArray(obj.shoppingItems) ? obj.shoppingItems : [],
    )
    const roomType =
      typeof obj.roomType === 'string' && obj.roomType.length > 0
        ? obj.roomType
        : this.inferRoomType(obj.roomSummary)
    const result: RoomAnalysis = {
      roomType,
      roomSummary: obj.roomSummary,
      dominantColors: obj.dominantColors.filter((c) => typeof c === 'string') as string[],
      suggestions: normalizedSuggestions,
      shoppingItems,
      makeoverPrompt: obj.makeoverPrompt,
    }
    if (typeof obj.targetRoomType === 'string' && obj.targetRoomType.length > 0) {
      result.targetRoomType = obj.targetRoomType
    }
    return result
  }

  private normalizeSuggestions(raw: unknown[]): DecorSuggestion[] {
    return raw
      .filter((s) => s && typeof s === 'object')
      .map((s) => {
        const row = s as Partial<DecorSuggestion>
        return {
          title: typeof row.title === 'string' ? row.title : '',
          detail: typeof row.detail === 'string' ? row.detail : '',
          priority: this.normalizePriority(row.priority),
          snap3dPrompt: typeof row.snap3dPrompt === 'string' ? row.snap3dPrompt : undefined,
        }
      })
      .filter((s) => s.title.length > 0)
  }

  private normalizeShoppingItems(raw: unknown[]): DecorShoppingItem[] {
    return raw
      .filter((s) => s && typeof s === 'object')
      .map((s) => {
        const row = s as Partial<DecorShoppingItem>
        return {
          title: typeof row.title === 'string' ? row.title : '',
          description: typeof row.description === 'string' ? row.description : '',
          category: this.normalizeCategory(row.category),
          whereToLook: typeof row.whereToLook === 'string' ? row.whereToLook : 'Local home store',
          searchHint: typeof row.searchHint === 'string' ? row.searchHint : row.title ?? '',
          priceHint: typeof row.priceHint === 'string' ? row.priceHint : undefined,
          relatedSuggestionTitle:
            typeof row.relatedSuggestionTitle === 'string' ? row.relatedSuggestionTitle : undefined,
          snap3dPrompt: typeof row.snap3dPrompt === 'string' ? row.snap3dPrompt : undefined,
        }
      })
      .filter((s) => s.title.length > 0)
  }

  private normalizeCategory(raw: unknown): DecorShoppingCategory | string {
    if (typeof raw !== 'string') {
      return 'other'
    }
    const v = raw.toLowerCase().replace(/\s+/g, '_')
    const allowed: DecorShoppingCategory[] = [
      'wallpaper',
      'paint',
      'carpet',
      'furniture',
      'lighting',
      'textiles',
      'decor',
      'other',
    ]
    for (let i = 0; i < allowed.length; i++) {
      if (v === allowed[i]) {
        return allowed[i]
      }
    }
    return raw
  }

  private inferRoomType(summary: string): string {
    const lower = summary.toLowerCase()
    if (lower.indexOf('bed') >= 0) {
      return 'bedroom'
    }
    if (lower.indexOf('kitchen') >= 0) {
      return 'kitchen'
    }
    if (lower.indexOf('dining') >= 0) {
      return 'dining room'
    }
    if (lower.indexOf('office') >= 0 || lower.indexOf('desk') >= 0) {
      return 'home office'
    }
    if (lower.indexOf('living') >= 0) {
      return 'living room'
    }
    return 'room'
  }

  private normalizePriority(raw: unknown): 'high' | 'medium' | 'low' | undefined {
    if (raw === 'high' || raw === 'medium' || raw === 'low') {
      return raw
    }
    return undefined
  }

  private stripCodeFence(text: string): string {
    let s = text
    if (s.indexOf('```') === 0) {
      s = s.replace(/^```[a-zA-Z]*\s*/, '')
      const end = s.lastIndexOf('```')
      if (end >= 0) {
        s = s.substring(0, end)
      }
    }
    return s
  }

  private extractJsonObject(text: string): string | null {
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if (start < 0 || end <= start) {
      return null
    }
    return text.substring(start, end + 1)
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

  private failAnalysis(message: string): void {
    this.log.e(message)
    this.setLoading(false)
    this.setStatus(message.length > 80 ? `${message.substring(0, 77)}…` : message)
    this.inFlight = false
    this.onAnalysisFailed.invoke(message)
  }
}
