import Event from 'SpectaclesInteractionKit.lspkg/Utils/Event'
import NativeLogger from 'SpectaclesInteractionKit.lspkg/Utils/NativeLogger'
import { Gemini } from 'RemoteServiceGateway.lspkg/HostedExternal/GoogleGenAI'
import { GoogleGenAITypes } from 'RemoteServiceGateway.lspkg/HostedExternal/GoogleGenAITypes'
import { DecorTtsNarrator } from './DecorTtsNarrator'
import { RoomAnalysis } from './DecorTypes'

type ChatPart = GoogleGenAITypes.Common.Part
type ChatContent = { role: string; parts: ChatPart[] }

/**
 * Décor3D voice brain — same stack as `RoomAnalyzer` and Travel_Planner:
 * **`Gemini.models()`** (RSG sync / ExampleGeminiCalls pattern), not Gemini Live.
 *
 * Mic capture is handled by `DecorVoiceAssistant` (Lens `AsrModule`). Replies are
 * spoken through `DecorTtsNarrator` (`OpenAI.speech` → `AudioComponent`), which
 * already works on Spectacles.
 */
@component
export class DecorGeminiVoice extends BaseScriptComponent {
  @input
  @hint('Gemini model for voice turns (e.g. gemini-2.0-flash).')
  geminiModel: string = 'gemini-2.0-flash'

  @input
  @allowUndefined
  @hint('Speaks assistant replies on device (Travel-style TTS).')
  ttsNarrator: DecorTtsNarrator

  @input
  @allowUndefined
  statusText: Text

  readonly updateTextEvent: Event<{ text: string; completed: boolean }> = new Event<{
    text: string
    completed: boolean
  }>()

  readonly functionCallEvent: Event<{ name: string; args: any; callId?: string }> = new Event<{
    name: string
    args: any
    callId?: string
  }>()

  private readonly log = new NativeLogger('DecorGeminiVoice')
  private instructions: string = ''
  private greeting: string = ''
  private roomContextBlock: string = ''
  private history: ChatContent[] = []
  private inFlight: boolean = false
  private pendingFunctionName: string = ''

  public setInstructions(text: string): void {
    if (text && text.trim().length > 0) {
      this.instructions = text.trim()
    }
  }

  public setGreeting(text: string): void {
    this.greeting = text || ''
  }

  /** Injected after room scan so voice answers can reference this space. */
  public setRoomContext(analysis: RoomAnalysis | null, styleDisplayName?: string): void {
    if (!analysis) {
      this.roomContextBlock = ''
      return
    }
    const lines: string[] = ['Room scan context (use for decor and shopping answers):']
    if (styleDisplayName && styleDisplayName.length > 0) {
      lines.push(`Chosen style: ${styleDisplayName}`)
    }
    lines.push(`Room type: ${analysis.roomType || 'unknown'}`)
    lines.push(`Summary: ${analysis.roomSummary}`)
    if (analysis.dominantColors && analysis.dominantColors.length > 0) {
      lines.push(`Colors: ${analysis.dominantColors.slice(0, 5).join(', ')}`)
    }
    const top = analysis.suggestions ? analysis.suggestions.slice(0, 4) : []
    if (top.length > 0) {
      lines.push('Top decor ideas from scan:')
      for (let i = 0; i < top.length; i++) {
        lines.push(`- ${top[i].title}: ${top[i].detail}`)
      }
    }
    const shop = analysis.shoppingItems ? analysis.shoppingItems.slice(0, 3) : []
    if (shop.length > 0) {
      lines.push('Where-to-buy hints from scan:')
      for (let j = 0; j < shop.length; j++) {
        lines.push(`- ${shop[j].title}: ${shop[j].whereToLook}`)
      }
    }
    this.roomContextBlock = lines.join('\n')
  }

  /** Short spoken line while Snap3D runs (does not add to Gemini history). */
  public speakBrief(text: string): void {
    this.speak(text)
  }

  /** Reset chat and optionally speak the greeting (no Live websocket). */
  public beginSession(): void {
    this.history = []
    this.inFlight = false
    this.pendingFunctionName = ''
    if (!this.greeting || this.greeting.trim().length === 0) {
      return
    }
    const line = this.greeting.trim()
    this.updateTextEvent.invoke({ text: line, completed: true })
    this.speak(line)
  }

  public interruptSpeech(): void {
    if (this.ttsNarrator) {
      this.ttsNarrator.stop()
    }
  }

  /** TTS used for greetings and replies — needed to sequence ASR after playback on Spectacles. */
  public getTtsNarrator(): DecorTtsNarrator | null {
    return this.ttsNarrator || null
  }

  /** Final ASR transcript from the user. */
  public handleTranscript(transcript: string): void {
    const text = transcript ? transcript.trim() : ''
    if (text.length === 0 || this.inFlight) {
      return
    }
    this.history.push({
      role: 'user',
      parts: [{ text }],
    })
    this.requestModelTurn()
  }

  public sendFunctionCallUpdate(functionName: string, response: string): void {
    const name =
      functionName && functionName.length > 0
        ? functionName
        : this.pendingFunctionName || 'Snap3D'
    this.history.push({
      role: 'user',
      parts: [
        {
          functionResponse: {
            name,
            response: { content: response },
          },
        } as ChatPart,
      ],
    })
    this.pendingFunctionName = ''
    this.requestModelTurn()
  }

  private requestModelTurn(): void {
    if (this.inFlight) {
      return
    }
    this.inFlight = true
    this.setStatus('Thinking…')

    const request: GoogleGenAITypes.Gemini.Models.GenerateContentRequest = {
      model: this.geminiModel,
      type: 'generateContent',
      body: {
        systemInstruction: {
          parts: [{ text: this.buildSystemInstruction() }],
        },
        contents: this.history,
        tools: [
          {
            functionDeclarations: [
              {
                name: 'Snap3D',
                description:
                  'ONLY when the user explicitly asks to add, place, create, or generate a 3D object in the room. ' +
                  'Never call for decorating advice, color opinions, or where-to-buy questions.',
                parameters: {
                  type: 'object',
                  properties: {
                    prompt: {
                      type: 'string',
                      description:
                        'Concise description of ONE isolated, photorealistic home-decor or furniture item. No people, no room background. Mention wall-mounted or ceiling-hung when relevant.',
                    },
                  },
                  required: ['prompt'],
                },
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.7,
        } as GoogleGenAITypes.Common.GenerationConfig,
      },
    }

    Gemini.models(request)
      .then((response) => {
        this.inFlight = false
        const reply = this.extractText(response)
        const functionCall = this.extractFunctionCall(response)
        if (functionCall) {
          this.pendingFunctionName = functionCall.name
          this.history.push({
            role: 'model',
            parts: [
              {
                functionCall: {
                  name: functionCall.name,
                  args: functionCall.args,
                },
              } as ChatPart,
            ],
          })
          if (reply && reply.length > 0) {
            this.updateTextEvent.invoke({ text: reply, completed: true })
            this.speak(reply)
          }
          this.functionCallEvent.invoke({
            name: functionCall.name,
            args: functionCall.args,
          })
          this.setStatus('')
          return
        }

        if (!reply || reply.length === 0) {
          this.setStatus('Gemini returned no text.')
          this.log.e('Empty generateContent response')
          return
        }

        this.history.push({
          role: 'model',
          parts: [{ text: reply }],
        })
        this.updateTextEvent.invoke({ text: reply, completed: true })
        this.speak(reply)
        this.setStatus('')
      })
      .catch((error) => {
        this.inFlight = false
        const msg = `Gemini.models failed: ${error}`
        this.log.e(msg)
        this.setStatus(msg)
      })
  }

  private extractText(
    response: GoogleGenAITypes.Gemini.Models.GenerateContentResponse,
  ): string {
    try {
      const candidates = response && response.candidates
      if (!candidates || candidates.length === 0) {
        return ''
      }
      const parts = candidates[0].content && candidates[0].content.parts
      if (!parts || parts.length === 0) {
        return ''
      }
      for (let i = 0; i < parts.length; i++) {
        const part = parts[i] as ChatPart
        if (part && typeof part.text === 'string' && part.text.length > 0) {
          return part.text
        }
      }
    } catch (e) {
      this.log.e(`extractText: ${e}`)
    }
    return ''
  }

  private extractFunctionCall(
    response: GoogleGenAITypes.Gemini.Models.GenerateContentResponse,
  ): { name: string; args: any } | null {
    try {
      const candidates = response && response.candidates
      if (!candidates || candidates.length === 0) {
        return null
      }
      const parts = candidates[0].content && candidates[0].content.parts
      if (!parts) {
        return null
      }
      for (let i = 0; i < parts.length; i++) {
        const part = parts[i] as ChatPart
        const fc = part && part.functionCall
        if (fc && fc.name) {
          return { name: fc.name, args: fc.args || {} }
        }
      }
    } catch (e) {
      this.log.e(`extractFunctionCall: ${e}`)
    }
    return null
  }

  private buildSystemInstruction(): string {
    const base = this.instructions ? this.instructions.trim() : ''
    if (!this.roomContextBlock || this.roomContextBlock.length === 0) {
      return base
    }
    if (base.length === 0) {
      return this.roomContextBlock
    }
    return `${base}\n\n${this.roomContextBlock}`
  }

  private speak(text: string): void {
    if (!this.ttsNarrator || !text || text.trim().length === 0) {
      return
    }
    this.ttsNarrator.speakPlainText(text)
  }

  private setStatus(msg: string): void {
    if (this.statusText) {
      this.statusText.text = msg
    }
  }
}
