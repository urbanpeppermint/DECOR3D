import Event from 'SpectaclesInteractionKit.lspkg/Utils/Event'
import NativeLogger from 'SpectaclesInteractionKit.lspkg/Utils/NativeLogger'
import { OpenAI } from 'RemoteServiceGateway.lspkg/HostedExternal/OpenAI'
import { DecorStyleId, RoomAnalysis } from './DecorTypes'
import { getStyle } from './DecorStyleCatalog'

/**
 * Reads the room analysis aloud via OpenAI TTS (`audio_speech` endpoint, model
 * `gpt-4o-mini-tts`). One-shot REST round-trip; result is an
 * `AudioTrackAsset` we feed into an `AudioComponent`.
 *
 * Why OpenAI TTS rather than Gemini Live for narration:
 *   - One-shot, no WebSocket session management
 *   - `instructions` field lets us steer voice tone per style
 *   - The original Decor Assistant used this exact path; we are 1:1 with it.
 */
@component
export class DecorTtsNarrator extends BaseScriptComponent {
  @input
  @hint('OpenAI TTS voice. `nova` is calm and clear; `coral` is warmer.')
  @widget(
    new ComboBoxWidget([
      new ComboBoxItem('Nova (calm, clear) — recommended', 'nova'),
      new ComboBoxItem('Coral (warm, friendly)', 'coral'),
      new ComboBoxItem('Alloy (neutral)', 'alloy'),
      new ComboBoxItem('Echo (low, calm)', 'echo'),
      new ComboBoxItem('Fable (story-teller)', 'fable'),
      new ComboBoxItem('Onyx (deep)', 'onyx'),
      new ComboBoxItem('Shimmer (bright)', 'shimmer'),
    ]),
  )
  voice: string = 'nova'

  @input
  @hint('Maximum characters spoken out loud. Keeps the round-trip cheap and stops monologues.')
  maxSpokenChars: number = 480

  @input
  @hint('Show this SceneObject while the TTS round-trip is in flight.')
  @allowUndefined
  loadingIndicator: SceneObject

  @input
  @allowUndefined
  @hint('Optional pre-existing AudioComponent. If unset, one is created on this SceneObject lazily.')
  audioOutput: AudioComponent

  readonly onNarrationStarted: Event<string> = new Event<string>()
  readonly onNarrationFailed: Event<string> = new Event<string>()
  /** Fires when playback ends (or TTS is stopped). Use before starting ASR on Spectacles. */
  readonly onSpeechFinished: Event<void> = new Event<void>()

  private readonly log = new NativeLogger('DecorTtsNarrator')
  private inFlight: boolean = false

  /**
   * Synthesize a spoken summary of the analysis tailored to the chosen style.
   * Optionally pass a custom override script; if omitted, we assemble one from
   * the analysis (summary + top 3 suggestions).
   */
  narrate(analysis: RoomAnalysis, styleId: DecorStyleId, overrideScript?: string): void {
    if (this.inFlight) {
      this.log.w('narrate ignored: previous TTS still in flight')
      return
    }
    const script =
      overrideScript && overrideScript.length > 0
        ? overrideScript
        : this.buildScript(analysis, styleId)
    if (!script || script.length === 0) {
      this.onNarrationFailed.invoke('narrate called with empty script')
      return
    }
    const trimmed = script.length > this.maxSpokenChars ? `${script.substring(0, this.maxSpokenChars - 1)}…` : script
    this.inFlight = true
    this.setLoading(true)

    const style = getStyle(styleId)
    OpenAI.speech({
      model: 'gpt-4o-mini-tts',
      input: trimmed,
      voice: this.voice,
      instructions: style.voiceTone,
    })
      .then((track) => {
        this.inFlight = false
        this.setLoading(false)
        this.playAudioTrack(track)
        this.onNarrationStarted.invoke(trimmed)
      })
      .catch((err) => {
        this.failNarration(`OpenAI.speech failed: ${err}`)
      })
  }

  /**
   * One-shot speech for voice-assistant replies (no room-analysis script).
   * Uses the same OpenAI TTS path as makeover narration.
   */
  speakPlainText(text: string): void {
    if (!text || text.trim().length === 0) {
      return
    }
    if (this.inFlight) {
      this.stop()
    }
    const trimmed =
      text.length > this.maxSpokenChars ? `${text.substring(0, this.maxSpokenChars - 1)}…` : text
    this.inFlight = true
    this.setLoading(true)
    OpenAI.speech({
      model: 'gpt-4o-mini-tts',
      input: trimmed,
      voice: this.voice,
      instructions: 'Speak clearly and warmly in one to three short sentences.',
    })
      .then((track) => {
        this.inFlight = false
        this.setLoading(false)
        this.playAudioTrack(track)
      })
      .catch((err) => {
        this.failNarration(`OpenAI.speech failed: ${err}`)
      })
  }

  /** Stops narration and clears the in-flight flag (e.g. back to style menu). */
  stop(): void {
    this.inFlight = false
    this.setLoading(false)
    const aud = this.audioOutput
    if (!aud || !aud.enabled) {
      this.onSpeechFinished.invoke()
      return
    }
    const host = aud.sceneObject
    if (host && !host.enabled) {
      this.onSpeechFinished.invoke()
      return
    }
    try {
      aud.stop(false)
    } catch (err) {
      this.log.w(`TTS stop skipped: ${err}`)
    }
    this.onSpeechFinished.invoke()
  }

  /** True while OpenAI TTS is in flight or the clip is playing on device. */
  public isSpeaking(): boolean {
    if (this.inFlight) {
      return true
    }
    const aud = this.audioOutput
    if (!aud || !aud.enabled) {
      return false
    }
    try {
      return aud.isPlaying()
    } catch (err) {
      this.log.w(`isSpeaking check skipped: ${err}`)
      return false
    }
  }

  private playAudioTrack(track: AudioTrackAsset): void {
    let aud = this.audioOutput
    if (!aud) {
      aud = this.sceneObject.createComponent('Component.AudioComponent') as AudioComponent
      this.audioOutput = aud
    }
    aud.audioTrack = track
    aud.setOnFinish(() => {
      this.onSpeechFinished.invoke()
    })
    aud.play(1)
  }

  /**
   * Brief room type + style, then decor ideas and one shopping hint (no long scan monologue).
   */
  private buildScript(analysis: RoomAnalysis, styleId: DecorStyleId): string {
    const parts: string[] = []
    const style = getStyle(styleId)
    const roomLine =
      analysis.roomType && analysis.roomType.length > 0
        ? analysis.roomType
        : analysis.roomSummary
    parts.push(`This looks like a ${roomLine}. Let's dress it in ${style.displayName} style.`)
    const ranked = analysis.suggestions
      .slice(0, 6)
      .sort((a, b) => this.priorityRank(b.priority) - this.priorityRank(a.priority))
    const topDecor = ranked.slice(0, 4)
    if (topDecor.length > 0) {
      parts.push('Decoration ideas.')
      for (let i = 0; i < topDecor.length; i++) {
        const s = topDecor[i]
        parts.push(`${s.title}. ${s.detail}`)
      }
    }
    const shop = analysis.shoppingItems && analysis.shoppingItems.length > 0 ? analysis.shoppingItems[0] : null
    if (shop) {
      parts.push(
        `For shopping, look for ${shop.title} at ${shop.whereToLook}. Use the suggestion panel for more picks.`,
      )
    }
    return parts.join(' ')
  }

  private priorityRank(p: 'high' | 'medium' | 'low' | undefined): number {
    if (p === 'high') {
      return 3
    }
    if (p === 'medium') {
      return 2
    }
    if (p === 'low') {
      return 1
    }
    return 0
  }

  private setLoading(enabled: boolean): void {
    if (this.loadingIndicator) {
      this.loadingIndicator.enabled = enabled
    }
  }

  private failNarration(message: string): void {
    this.log.e(message)
    this.inFlight = false
    this.setLoading(false)
    this.onNarrationFailed.invoke(message)
  }
}
