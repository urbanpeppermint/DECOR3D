import NativeLogger from 'SpectaclesInteractionKit.lspkg/Utils/NativeLogger'
import { BaseButton } from 'SpectaclesUIKit.lspkg/Scripts/Components/Button/BaseButton'
import { Snap3DInteractableFactory } from '../Snap3DInteractableFactory'
import { DecorGeminiVoice } from './DecorGeminiVoice'

/** Used when the Inspector `instructions` field is left blank (scene often overrides script defaults with ""). */
export const DECOR_VOICE_DEFAULT_INSTRUCTIONS =
  'You are Décor3D, a friendly interior-design voice assistant in AR glasses. ' +
  'Answer decorating questions in plain conversational text (styles, colors, layout, materials, light renovation). ' +
  'Do NOT call Snap3D for advice, opinions, shopping questions, or general chat. ' +
  'Call Snap3D ONLY when the user clearly asks to add, place, create, or generate a specific 3D decor or furniture object. ' +
  'For where-to-buy: ask which city or area they are in first, then suggest store types or retailers in 1–3 short sentences. ' +
  'Use the room scan context below when present; if there is no scan yet, say room-specific advice needs a scan first. ' +
  'Keep every reply to 1–3 short sentences suitable for speech.'

/**
 * Voice overlay for Décor3D (Travel_Planner–style stack).
 *
 * - **Listen:** Lens `AsrModule` (not Gemini Live / MicrophoneRecorder).
 * - **Think:** `DecorGeminiVoice` → `Gemini.models()` (RSG sync, same as RoomAnalyzer).
 * - **Speak:** `DecorTtsNarrator` → `OpenAI.speech` → `AudioComponent`.
 *
 * Does **not** use `Assets/Scripts/GeminiAssistant.ts` (AI Playground Live sample).
 * Leave that object disabled unless you are testing the Live demo.
 */
@component
export class DecorVoiceAssistant extends BaseScriptComponent {
  @ui.group_start('Mic toggle')
  @input
  @hint('Button that toggles the voice assistant on/off. First press also opens the session.')
  private micButton: BaseButton

  @input
  @allowUndefined
  @hint('Optional object shown while listening (mic ON state).')
  private micOnObject: SceneObject

  @input
  @allowUndefined
  @hint('Optional object shown while idle (mic OFF state).')
  private micOffObject: SceneObject
  @ui.group_end

  @ui.group_start('Output UI')
  @input
  @allowUndefined
  @hint('Text that shows the assistant reply / suggestions / where-to-buy answers.')
  private resultText: Text

  @input
  @allowUndefined
  @hint('Optional small status line (Listening… / Tap to talk).')
  private statusText: Text
  @ui.group_end

  @ui.group_start('Assistant engine')
  @input
  @allowUndefined
  @hint('Gemini.models() voice brain — assign DecorGeminiVoice, NOT AI Playground Gemini Live.')
  private decorGeminiVoice: DecorGeminiVoice

  @input
  @hint('Factory used to generate 3D objects the assistant is asked to create.')
  private snap3DFactory: Snap3DInteractableFactory

  @input
  @widget(new TextAreaWidget())
  @hint('System persona pushed to Gemini before each models() call.')
  private instructions: string = DECOR_VOICE_DEFAULT_INSTRUCTIONS

  @input
  @widget(new TextAreaWidget())
  @hint('Spoken opener when the session first starts (after the mic is pressed).')
  private greeting: string =
    'In one short sentence, greet me and ask whether I would like you to create a ' +
    'particular item in 3D, or help me find where to buy something. Then wait for my answer.'
  @ui.group_end

  private readonly log = new NativeLogger('DecorVoiceAssistant')
  private readonly asrModule: AsrModule = require('LensStudio:AsrModule') as AsrModule
  private sessionStarted: boolean = false
  private active: boolean = false
  private isRecording: boolean = false
  private accumulatedText: string = ''
  private eventsBound: boolean = false
  private ttsEventsBound: boolean = false
  private asrResumePending: boolean = false

  onAwake(): void {
    this.createEvent('OnStartEvent').bind(() => this.onStart())
  }

  private onStart(): void {
    this.setMicVisual(false)
    this.setStatus('Tap the mic to talk')

    if (!this.decorGeminiVoice) {
      this.log.e('decorGeminiVoice not assigned — wire DecorGeminiVoice (not Gemini Live).')
    }

    if (!this.micButton) {
      this.log.e('micButton not assigned — voice toggle is disabled.')
      return
    }
    this.micButton.onInitialized.add(() => {
      this.micButton.onTriggerUp.add(() => {
        this.log.i('mic button triggered → toggle')
        this.toggle()
      })
    })
    this.bindTtsFinishedHandler()
  }

  private bindTtsFinishedHandler(): void {
    if (this.ttsEventsBound || !this.decorGeminiVoice) {
      return
    }
    const tts = this.decorGeminiVoice.getTtsNarrator()
    if (!tts) {
      return
    }
    tts.onSpeechFinished.add(() => {
      if (this.asrResumePending || (this.active && !this.isRecording)) {
        this.asrResumePending = false
        this.tryStartListening()
      }
    })
    this.ttsEventsBound = true
  }

  public deactivate(): void {
    if (this.active) {
      this.setActive(false)
    }
  }

  private toggle(): void {
    if (!this.sessionStarted) {
      if (!this.startSession()) {
        return
      }
      this.setActive(true)
      return
    }
    this.setActive(!this.active)
  }

  private startSession(): boolean {
    if (!this.decorGeminiVoice) {
      this.setStatus('Assign DecorGeminiVoice on DecorVoiceAssistant.')
      return false
    }

    const persona = this.getEffectiveInstructions()
    this.decorGeminiVoice.setInstructions(persona)
    this.log.i(`voice persona length=${persona.length}`)
    this.decorGeminiVoice.setGreeting(this.greeting)
    if (!this.eventsBound) {
      this.decorGeminiVoice.updateTextEvent.add((data) => this.showText(data))
      this.decorGeminiVoice.functionCallEvent.add((data) => this.handleFunctionCall(data))
      this.eventsBound = true
    }

    this.bindTtsFinishedHandler()
    this.decorGeminiVoice.beginSession()
    this.sessionStarted = true
    return true
  }

  private setActive(active: boolean): void {
    this.active = active
    if (active) {
      this.tryStartListening()
    } else {
      this.asrResumePending = false
      this.stopListening()
      if (this.decorGeminiVoice) {
        this.decorGeminiVoice.interruptSpeech()
      }
    }
    this.setMicVisual(active)
    this.setStatus(active ? 'Listening… tap to stop' : 'Tap the mic to talk')
  }

  /** Wait until TTS finishes — ASR + playback together causes InternalError on Spectacles. */
  private tryStartListening(): void {
    if (!this.active || this.isRecording) {
      return
    }
    const tts = this.decorGeminiVoice ? this.decorGeminiVoice.getTtsNarrator() : null
    if (tts && tts.isSpeaking()) {
      this.asrResumePending = true
      this.setStatus('Listen after I finish speaking…')
      this.log.i('ASR deferred until TTS playback ends')
      return
    }
    this.asrResumePending = false
    this.startListening()
  }

  private startListening(): void {
    if (this.isRecording || !this.active) {
      return
    }

    const tts = this.decorGeminiVoice ? this.decorGeminiVoice.getTtsNarrator() : null
    if (tts && tts.isSpeaking()) {
      this.asrResumePending = true
      return
    }

    const settings = AsrModule.AsrTranscriptionOptions.create()
    settings.mode = AsrModule.AsrMode.HighAccuracy
    settings.silenceUntilTerminationMs = 1500

    settings.onTranscriptionUpdateEvent.add((asrOutput) => {
      if (!asrOutput.isFinal) {
        return
      }
      this.stopListening()
      const heard = asrOutput.text || ''
      if (heard.length > 0 && this.decorGeminiVoice) {
        this.setStatus(`Heard: ${heard}`)
        this.decorGeminiVoice.handleTranscript(heard)
        if (this.active) {
          this.asrResumePending = true
        }
      } else if (this.active) {
        this.tryStartListening()
      }
    })

    settings.onTranscriptionErrorEvent.add((errorData) => {
      this.stopListening()
      const detail = this.describeAsrError(errorData)
      this.log.e(`ASR error: ${errorData} (${detail})`)
      this.setStatus(detail)
      if (this.active) {
        this.asrResumePending = true
      }
    })

    this.isRecording = true
    this.setStatus('Listening… tap to stop')
    this.asrModule.startTranscribing(settings)
  }

  private describeAsrError(code: AsrModule.AsrStatusCode): string {
    switch (code) {
      case AsrModule.AsrStatusCode.InternalError:
        return 'Voice capture failed — wait for speech to finish, then tap mic again.'
      case AsrModule.AsrStatusCode.Unauthenticated:
        return 'Sign in to Snapchat on Spectacles, then try again.'
      case AsrModule.AsrStatusCode.NoInternet:
        return 'No internet — connect Spectacles and try again.'
      case AsrModule.AsrStatusCode.Success:
        return 'Voice capture ended.'
      default:
        return `Voice capture error (${code}) — try again.`
    }
  }

  private stopListening(): void {
    if (!this.isRecording) {
      return
    }
    this.isRecording = false
    try {
      this.asrModule.stopTranscribing()
    } catch (e) {
      this.log.w(`stopTranscribing: ${e}`)
    }
  }

  private getEffectiveInstructions(): string {
    const trimmed = this.instructions ? this.instructions.trim() : ''
    return trimmed.length > 0 ? trimmed : DECOR_VOICE_DEFAULT_INSTRUCTIONS
  }

  private handleFunctionCall(data: { name: string; args: any }): void {
    if (data.name !== 'Snap3D') {
      return
    }
    const prompt = data && data.args ? data.args.prompt : ''
    if (this.decorGeminiVoice) {
      this.decorGeminiVoice.speakBrief('Creating that in 3D for you.')
    }
    this.ackFunctionCall(data.name, 'Creating that now…')
    this.setStatus('Generating 3D…')

    if (!this.snap3DFactory || !prompt) {
      this.ackFunctionCall(data.name, 'Could not start 3D generation.')
      return
    }

    this.snap3DFactory
      .createInteractable3DObject(prompt)
      .then((spawned) => {
        this.ackFunctionCall(data.name, `Created: ${spawned.name}`)
        if (this.active) {
          this.asrResumePending = true
          this.tryStartListening()
        } else {
          this.setStatus('Tap the mic to talk')
        }
      })
      .catch((error) => {
        const msg = typeof error === 'string' ? error : `${error}`
        this.ackFunctionCall(data.name, msg)
        this.log.e(`Snap3D voice generate failed: ${msg}`)
      })
  }

  private ackFunctionCall(functionName: string, response: string): void {
    if (!this.decorGeminiVoice) {
      return
    }
    this.decorGeminiVoice.sendFunctionCallUpdate(functionName, response)
  }

  private showText(data: { text: string; completed: boolean }): void {
    if (!data || data.text === undefined || data.text === null) {
      return
    }
    if (data.completed) {
      this.accumulatedText = data.text
    } else {
      this.accumulatedText += data.text
    }
    if (this.resultText) {
      this.resultText.enabled = true
      const obj = this.resultText.getSceneObject()
      if (obj) {
        obj.enabled = true
      }
      this.resultText.text = this.accumulatedText
    }
  }

  private setStatus(msg: string): void {
    if (this.statusText) {
      this.statusText.text = msg
    }
  }

  private setMicVisual(listening: boolean): void {
    if (this.micOnObject) {
      this.micOnObject.enabled = listening
    }
    if (this.micOffObject) {
      this.micOffObject.enabled = !listening
    }
    this.log.i(
      `mic visual → ${listening ? 'ON' : 'OFF'} ` +
        `(on=${!!this.micOnObject}, off=${!!this.micOffObject})`,
    )
  }
}
