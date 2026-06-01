import NativeLogger from 'SpectaclesInteractionKit.lspkg/Utils/NativeLogger'
import animate from 'SpectaclesInteractionKit.lspkg/Utils/animate'
import { BaseButton } from 'SpectaclesUIKit.lspkg/Scripts/Components/Button/BaseButton'
import { DecorStyleId, DecorRunState, RoomAnalysis, DecorSuggestion } from './DecorTypes'
import { getStyle } from './DecorStyleCatalog'
import { bindStylePickButton } from './StylePickerButtonBinder'
import { StylePickerController } from './StylePickerController'
import { StylePickerListScroll } from './StylePickerListScroll'
import { RoomScanner } from './RoomScanner'
import { RoomAnalyzer } from './RoomAnalyzer'
import { MakeoverVisualizer } from './MakeoverVisualizer'
import { DecorTtsNarrator } from './DecorTtsNarrator'
import { DecorShoppingPanel } from './DecorShoppingPanel'
import { DecorSnap3DGenerator } from './DecorSnap3DGenerator'
import { RoomPurposePanel } from './RoomPurposePanel'
import { DecorSessionManager } from './DecorSessionManager'
import { DecorGeminiVoice } from './DecorGeminiVoice'

/**
 * Décor3D root orchestrator: style → (purpose) → (aim → capture) → Gemini → Imagen + TTS.
 *
 * When `twoStepRoomCapture` is true and capture UI is wired, **Scan** opens the
 * live camera on the preview plane; **Capture** takes the still. Otherwise
 * **Scan** performs a one-tap shutter (legacy).
 */
@component
export class DecorController extends BaseScriptComponent {
  @ui.group_start('Modules')
  @input
  @hint('Style picker shown at the start.')
  stylePicker: StylePickerController

  @input
  @hint('Room camera + JPEG encode.')
  roomScanner: RoomScanner

  @input
  @hint('Gemini vision → structured analysis JSON.')
  roomAnalyzer: RoomAnalyzer

  @input
  @hint('Imagen → Spatial Image makeover.')
  makeoverVisualizer: MakeoverVisualizer

  @input
  @hint('OpenAI TTS for the spoken summary.')
  ttsNarrator: DecorTtsNarrator

  @input
  @allowUndefined
  @hint('Optional — receives room scan context for voice Q&A after analysis.')
  decorGeminiVoice: DecorGeminiVoice
  @ui.group_end

  @ui.group_start('UI')
  @input
  @hint('SceneObject root for the "scan room" button — hidden until a style is picked.')
  @allowUndefined
  scanRoomRoot: SceneObject

  @input
  @hint('Opens live camera preview (two-step) or captures immediately (one-step).')
  @allowUndefined
  scanRoomButton: BaseButton

  @input
  @hint('SceneObject root for the "capture" button — only used in two-step mode.')
  @allowUndefined
  captureRoomRoot: SceneObject

  @input
  @hint('Commits the still JPEG after the user has aimed (two-step mode).')
  @allowUndefined
  captureRoomButton: BaseButton

  @input
  @hint('When true (and capture UI assigned): Scan = live preview, Capture = shutter.')
  twoStepRoomCapture: boolean = true

  @input
  @allowUndefined
  @hint('Optional single-line status.')
  statusText: Text

  @input
  @allowUndefined
  @hint('Optional multiline: room summary + ranked suggestions from Gemini.')
  suggestionsText: Text

  @input
  @allowUndefined
  @hint('Optional picked style label.')
  styleLabelText: Text

  @input
  @hint('Hide the scan affordance after a successful shutter (two-step: after capture, not after opening preview).')
  hideScanAfterTrigger: boolean = true

  @input
  @hint('Fade-in duration (seconds) when the scan button appears.')
  showDurationSeconds: number = 0.4

  @input
  @allowUndefined
  @hint('Shopping popup — product cards after analysis.')
  shoppingPanel: DecorShoppingPanel

  @input
  @allowUndefined
  @hint('Back-to-menu control — shown only after a style is picked.')
  backToMenuRoot: SceneObject

  @input
  @allowUndefined
  @hint('Pinch to RESTART — full soft reset (style menu, scan, 3D, shopping, status text).')
  backToMenuButton: BaseButton

  @input
  @allowUndefined
  @hint('Optional — dismissed when returning to menu.')
  snap3dGenerator: DecorSnap3DGenerator

  @input
  @allowUndefined
  @hint('Room-purpose transform panel — shown between style pick and scan.')
  purposePanel: RoomPurposePanel

  @input
  @allowUndefined
  @hint('SceneObject root for the purpose panel — hidden/shown by controller.')
  purposePanelRoot: SceneObject
  @ui.group_end

  @ui.group_start('Auto-narration')
  @input
  @hint('Play TTS when analysis is ready.')
  autoNarrate: boolean = true

  @input
  @hint('Max suggestions rendered into `suggestionsText`.')
  maxSuggestionsRendered: number = 5
  @ui.group_end

  private readonly log = new NativeLogger('DecorController')
  private lastAnalysis: RoomAnalysis | null = null
  private state: DecorRunState = {
    selectedStyle: null,
    targetPurpose: null,
    hasRoomScan: false,
    hasAnalysis: false,
    hasMakeover: false,
  }

  /** Set by DecorSessionManager on start — gates local actions when MP sync is active. */
  sessionManager: DecorSessionManager | null = null
  private applyingRemoteUi = false

  onAwake(): void {
    this.createEvent('OnStartEvent').bind(() => this.onStart())
  }

  /**
   * Apply a style selection that arrived from a remote peer.
   * Uses StylePickerController.pickStyle() so the picker hides with its own animation
   * and the normal handleStyleSelected chain runs (hooks fire but are suppressed by
   * DecorStateSync's applyingRemote flag to prevent echo broadcasts).
   */
  applyRemoteStyleSelection(id: DecorStyleId): void {
    this.applyingRemoteUi = true
    try {
      if (this.stylePicker) {
        this.stylePicker.pickStyle(id)
      } else {
        this.handleStyleSelected(id)
      }
    } finally {
      this.applyingRemoteUi = false
    }
  }

  applyRemotePurposeSelection(purpose: string | null): void {
    this.applyingRemoteUi = true
    try {
      if (this.purposePanel) {
        this.purposePanel.selectPurpose(purpose)
      } else {
        this.handlePurposeSelected(purpose)
      }
    } finally {
      this.applyingRemoteUi = false
    }
  }

  private onStart(): void {
    this.hideScanAffordance(true)
    this.hideCaptureAffordance(true)
    this.tryEnsurePreviewHidden()
    if (this.makeoverVisualizer) {
      this.makeoverVisualizer.dismiss()
    }
    this.setStatus('Pick a style to begin.')
    this.wireStylePicker()
    this.wireScanner()
    this.wireAnalyzer()
    this.wireVisualizer()
    this.wireTts()
    this.wireScanButton()
    this.wireCaptureButton()
    this.wireBackToMenuButton()
    this.wirePurposePanel()
    this.hideBackToMenu(true)
    this.hideShoppingPanel()
    this.dismissSnap3D()
  }

  /**
   * Full soft reset: clears scan, makeover, shopping, Snap3D spawns, and status UI,
   * then reopens the style picker. Wire your RESTART button to `backToMenuButton`.
   * (Runtime cannot reload the Lens binary — this resets all Décor3D session data.)
   */
  restartLens(): void {
    if (this.sessionManager && !this.sessionManager.onLocalRestart()) {
      return
    }
    this.log.i('RESTART — resetting Décor3D session')
    this.returnToStyleMenu()
  }

  public hasPurposePanel(): boolean {
    return !!this.purposePanel || !!this.purposePanelRoot
  }

  public setStatusPublic(message: string): void {
    this.setStatus(message)
  }

  /** Non-leaders: mirror scan step UI while leader aims the camera. */
  applyRemoteScanOpen(leaderRunsCamera: boolean): void {
    if (!this.state.selectedStyle) {
      return
    }
    this.hideCaptureAffordance(true)
    if (leaderRunsCamera && this.roomScanner) {
      this.roomScanner.startLivePreview()
      this.setStatus('Live view on. Aim the headset, then pinch Capture.')
      if (this.hideScanAfterTrigger) {
        this.hideScanAffordance(false)
      }
      this.showCaptureAffordance()
      return
    }
    this.hideScanAffordance(true)
    this.setStatus('Session leader is scanning — watch their preview.')
  }

  /** All peers run the same analysis + makeover from synced JSON (leader ran Gemini). */
  applyRemoteAnalysisComplete(analysis: RoomAnalysis): void {
    if (!this.state.selectedStyle) {
      return
    }
    this.state.hasRoomScan = true
    this.state.hasAnalysis = true
    this.lastAnalysis = analysis
    this.renderSuggestions(analysis)
    this.showShoppingCatalog(analysis)
    if (this.makeoverVisualizer) {
      this.makeoverVisualizer.generateMakeover(
        analysis,
        this.state.selectedStyle,
        this.state.targetPurpose ?? undefined,
      )
    }
    if (this.autoNarrate && this.ttsNarrator) {
      this.ttsNarrator.narrate(analysis, this.state.selectedStyle)
    }
    this.pushRoomContextToVoice(analysis)
    this.setStatus('Done. Move your head around to feel the depth.')
  }

  /** Follower: local spawn + load leader's shared GLB (no second Snap3D job). */
  applyRemoteSnap3DGenerate(prompt: string, displayLabel?: string): void {
    const gen = this.resolveSnap3DGenerator()
    if (!gen) {
      return
    }
    gen.generateFromSyncedPrompt(prompt, displayLabel)
  }

  /** Move follower loading placeholder when leader publishes spawn pose. */
  applyRemoteSnap3DSpawnPosition(pos: vec3): void {
    const gen = this.resolveSnap3DGenerator()
    if (!gen) {
      return
    }
    gen.applyRemoteSnap3DSpawnPosition(pos)
  }

  /** Apply leader mesh when URL arrives (covers trig/URL ordering races). */
  applyRemoteSnap3DMeshUrl(meshUrl: string, imageUrl: string | null): void {
    const gen = this.resolveSnap3DGenerator()
    if (!gen) {
      return
    }
    gen.applySharedMeshFromSession(meshUrl, imageUrl)
  }

  /** Mirror another peer's Snap3D placement (position, rotation, scale). */
  applyRemoteSnap3DWorldTransform(pos: vec3, rot: quat, scale: vec3): void {
    const gen = this.resolveSnap3DGenerator()
    if (!gen) {
      return
    }
    gen.applySyncedWorldTransform(pos, rot, scale)
  }

  /** @deprecated Use restartLens() — same behavior. */
  returnToStyleMenu(): void {
    this.log.i('Returning to style menu')
    this.state = {
      selectedStyle: null,
      targetPurpose: null,
      hasRoomScan: false,
      hasAnalysis: false,
      hasMakeover: false,
    }
    if (this.roomScanner) {
      this.roomScanner.cancelSession()
    }
    if (this.roomAnalyzer) {
      this.roomAnalyzer.cancelPending()
    }
    if (this.makeoverVisualizer) {
      this.makeoverVisualizer.dismiss()
    }
    if (this.ttsNarrator) {
      this.ttsNarrator.stop()
    }
    this.hideScanAffordance(true)
    this.hideCaptureAffordance(true)
    if (this.styleLabelText) {
      this.styleLabelText.text = ''
    }
    if (this.suggestionsText) {
      this.suggestionsText.text = ''
    }
    this.clearStatusLine()
    this.setStatus('Pick a style to begin.')
    this.resetStyleListScroll()
    if (this.stylePicker) {
      this.stylePicker.showMenu()
    } else {
      this.log.e('No StylePickerController — cannot show menu')
    }
    this.hideBackToMenu(true)
    const panel = this.resolveShoppingPanel()
    if (panel) {
      panel.resetForRestart()
    } else {
      this.hideShoppingPanel()
    }
    this.resetPurposePanel()
    this.dismissSnap3D()
    this.destroyAllSnap3DInScene()
    this.lastAnalysis = null
    this.pushRoomContextToVoice(null)
  }

  private tryEnsurePreviewHidden(): void {
    const rs = this.roomScanner as unknown as { ensurePreviewHidden?: () => void } | undefined
    if (rs && typeof rs.ensurePreviewHidden === 'function') {
      rs.ensurePreviewHidden()
    }
  }

  private usesTwoStepCapture(): boolean {
    return (
      this.twoStepRoomCapture &&
      !!this.captureRoomButton &&
      !!this.captureRoomRoot
    )
  }

  private wireStylePicker(): void {
    if (!this.stylePicker) {
      this.log.e('No StylePickerController assigned')
      return
    }
    this.stylePicker.onStyleSelected.add((id) => this.handleStyleSelected(id))
  }

  private wireScanner(): void {
    if (!this.roomScanner) {
      this.log.e('No RoomScanner assigned')
      return
    }
    this.roomScanner.onRoomCaptured.add(({ base64Jpeg }) => this.handleRoomCaptured(base64Jpeg))
    this.roomScanner.onScanFailed.add((msg) => {
      this.setStatus(`Capture failed: ${this.truncate(msg, 80)}`)
      if (this.usesTwoStepCapture()) {
        this.showCaptureAffordance()
        this.showScanAffordance()
      }
    })
  }

  private wireAnalyzer(): void {
    if (!this.roomAnalyzer) {
      this.log.e('No RoomAnalyzer assigned')
      return
    }
    this.roomAnalyzer.onAnalysisComplete.add((analysis) => this.handleAnalysisComplete(analysis))
    this.roomAnalyzer.onAnalysisFailed.add((msg) => {
      this.setStatus(`Analysis failed: ${this.truncate(msg, 80)}`)
    })
  }

  private wireVisualizer(): void {
    if (!this.makeoverVisualizer) {
      this.log.e('No MakeoverVisualizer assigned')
      return
    }
    this.makeoverVisualizer.onMakeoverReady.add(() => {
      this.state.hasMakeover = true
      this.setStatus('Done. Move your head around to feel the depth.')
    })
    this.makeoverVisualizer.onMakeoverFailed.add((msg) => {
      this.setStatus(`Makeover failed: ${this.truncate(msg, 80)}`)
    })
  }

  private wireTts(): void {
    if (!this.ttsNarrator) {
      this.log.w('No DecorTtsNarrator — running without voice')
      return
    }
    this.ttsNarrator.onNarrationFailed.add((msg) => {
      this.log.w(`TTS skipped: ${msg}`)
    })
  }

  private wireScanButton(): void {
    if (!this.scanRoomButton) {
      this.log.w('No scan room button — call startScanFlow() from another script')
      return
    }
    this.scanRoomButton.onInitialized.add(() => {
      this.scanRoomButton.onTriggerUp.add(() => this.onScanButtonPressed())
    })
  }

  private wireCaptureButton(): void {
    if (!this.captureRoomButton) {
      return
    }
    this.captureRoomButton.onInitialized.add(() => {
      this.captureRoomButton.onTriggerUp.add(() => this.onCaptureButtonPressed())
    })
  }

  private wireBackToMenuButton(): void {
    if (!this.backToMenuButton) {
      this.log.w('No backToMenuButton — assign one or call returnToStyleMenu() from code')
      return
    }
    bindStylePickButton(this, this.backToMenuButton, () => {
      this.restartLens()
    })
  }

  private showBackToMenu(): void {
    if (!this.backToMenuRoot) {
      return
    }
    this.backToMenuRoot.enabled = true
    this.backToMenuRoot.getTransform().setLocalScale(new vec3(1, 1, 1))
  }

  private hideBackToMenu(immediate: boolean): void {
    if (!this.backToMenuRoot) {
      return
    }
    if (immediate) {
      this.backToMenuRoot.getTransform().setLocalScale(vec3.zero())
      this.backToMenuRoot.enabled = false
      return
    }
    const tr = this.backToMenuRoot.getTransform()
    const start = tr.getLocalScale()
    animate({
      duration: 0.2,
      easing: 'ease-out-quad',
      update: (t) => {
        const k = 1 - t
        tr.setLocalScale(new vec3(start.x * k, start.y * k, start.z * k))
      },
      ended: () => {
        if (this.backToMenuRoot) {
          this.backToMenuRoot.enabled = false
        }
      },
    })
  }

  private resolveShoppingPanel(): DecorShoppingPanel | null {
    if (this.shoppingPanel) {
      return this.shoppingPanel
    }
    return this.sceneObject.getComponent(DecorShoppingPanel.getTypeName()) as DecorShoppingPanel | null
  }

  private showShoppingCatalog(analysis: RoomAnalysis): void {
    const panel = this.resolveShoppingPanel()
    if (!panel) {
      return
    }
    const styleName = this.state.selectedStyle ? getStyle(this.state.selectedStyle).displayName : ''
    panel.setGenerationContext(styleName, analysis.roomType)
    panel.setCatalogFromAnalysis(analysis)
  }

  private resolveSnap3DGenerator(): DecorSnap3DGenerator | null {
    if (this.snap3dGenerator) {
      return this.snap3dGenerator
    }
    return this.sceneObject.getComponent(
      DecorSnap3DGenerator.getTypeName(),
    ) as DecorSnap3DGenerator | null
  }

  private dismissSnap3D(): void {
    const gen = this.resolveSnap3DGenerator()
    if (gen) {
      gen.dismiss()
      gen.clearStatus()
    }
  }

  private destroyAllSnap3DInScene(): void {
    const gen = this.resolveSnap3DGenerator()
    if (gen) {
      gen.destroyAllSpawnedInteractables(this.sceneObject)
      gen.clearStatus()
    }
  }

  private hideShoppingPanel(): void {
    const panel = this.resolveShoppingPanel()
    if (panel) {
      panel.hide()
    }
  }

  private wirePurposePanel(): void {
    if (!this.purposePanel) {
      return
    }
    this.purposePanel.onPurposeSelected.add((purpose) =>
      this.handlePurposeSelected(purpose),
    )
  }

  private handlePurposeSelected(purpose: string | null): void {
    if (
      this.sessionManager &&
      !this.applyingRemoteUi &&
      !this.sessionManager.onLocalPurposePick(purpose)
    ) {
      return
    }
    this.state.targetPurpose = purpose
    this.hidePurposePanel()
    const label = purpose ? `Transform → ${purpose}.` : 'Restyle only.'
    const scanHint = this.usesTwoStepCapture()
      ? `${label} Pinch Scan to open the live view, then Capture.`
      : `${label} Pinch Scan when you are ready.`
    this.setStatus(scanHint)
    this.showScanAffordance()
  }

  private showPurposePanel(): void {
    if (this.purposePanel) {
      this.purposePanel.show()
    } else if (this.purposePanelRoot) {
      this.purposePanelRoot.enabled = true
    }
  }

  private hidePurposePanel(): void {
    if (this.purposePanel) {
      this.purposePanel.hide()
    } else if (this.purposePanelRoot) {
      this.purposePanelRoot.enabled = false
    }
  }


  private resetPurposePanel(): void {
    if (this.purposePanel) {
      this.purposePanel.resetForRestart()
    } else {
      this.hidePurposePanel()
    }
  }

  private resetStyleListScroll(): void {
    let node: SceneObject | null = this.sceneObject
    while (node) {
      const scroll = node.getComponent(StylePickerListScroll.getTypeName()) as StylePickerListScroll | null
      if (scroll) {
        scroll.resetToTop()
        return
      }
      node = node.getParent()
    }
  }

  private onScanButtonPressed(): void {
    if (!this.state.selectedStyle) {
      this.setStatus('Pick a style first.')
      return
    }
    if (!this.roomScanner) {
      return
    }
    if (this.sessionManager && !this.sessionManager.onLocalScanOpen()) {
      return
    }
    if (this.usesTwoStepCapture()) {
      this.roomScanner.startLivePreview()
      this.setStatus('Live view on. Aim the headset, then pinch Capture.')
      if (this.hideScanAfterTrigger) {
        this.hideScanAffordance(false)
      }
      this.showCaptureAffordance()
      return
    }
    this.startSingleTapCapture()
  }

  private onCaptureButtonPressed(): void {
    if (!this.state.selectedStyle) {
      this.setStatus('Pick a style first.')
      return
    }
    if (!this.roomScanner) {
      return
    }
    if (!this.usesTwoStepCapture()) {
      return
    }
    if (this.sessionManager && !this.sessionManager.onLocalCapture()) {
      return
    }
    this.setStatus('Capturing this frame…')
    this.roomScanner.commitSnapshot()
    this.hideCaptureAffordance(false)
    if (this.hideScanAfterTrigger) {
      /* scan row already hidden when preview opened */
    }
  }

  /** Legacy / one-step entry used by external callers. */
  startScan(): void {
    if (this.usesTwoStepCapture()) {
      this.onScanButtonPressed()
    } else {
      this.startSingleTapCapture()
    }
  }

  private startSingleTapCapture(): void {
    if (!this.state.selectedStyle) {
      this.setStatus('Pick a style first.')
      return
    }
    if (!this.roomScanner) {
      return
    }
    if (this.sessionManager && !this.sessionManager.onLocalCapture()) {
      return
    }
    this.setStatus('Capturing your room…')
    this.roomScanner.captureRoom()
    if (this.hideScanAfterTrigger) {
      this.hideScanAffordance(false)
    }
  }

  private handleStyleSelected(id: DecorStyleId): void {
    if (
      this.sessionManager &&
      !this.applyingRemoteUi &&
      !this.sessionManager.onLocalStylePick(id)
    ) {
      return
    }
    this.state.selectedStyle = id
    this.state.targetPurpose = null
    this.state.hasRoomScan = false
    this.state.hasAnalysis = false
    this.state.hasMakeover = false
    this.tryEnsurePreviewHidden()
    if (this.makeoverVisualizer) {
      this.makeoverVisualizer.dismiss()
    }
    this.hideCaptureAffordance(true)
    const style = getStyle(id)
    if (this.styleLabelText) {
      this.styleLabelText.text = style.displayName
    }
    this.showBackToMenu()

    if (this.purposePanel) {
      this.setStatus(`${style.displayName} selected. Choose a room transform or skip.`)
      this.showPurposePanel()
    } else {
      const scanHint = this.usesTwoStepCapture()
        ? `${style.displayName} selected. Pinch Scan to open the live view, then Capture.`
        : `${style.displayName} selected. Pinch Scan when you are ready.`
      this.setStatus(scanHint)
      this.showScanAffordance()
    }
  }

  private handleRoomCaptured(base64Jpeg: string): void {
    if (!this.state.selectedStyle) {
      return
    }
    this.state.hasRoomScan = true
    if (!this.roomAnalyzer) {
      this.setStatus('No analyzer wired — cannot continue.')
      return
    }
    this.setStatus('Analyzing layout and style fit…')
    if (this.sessionManager) {
      this.sessionManager.onLocalAnalysisStarted()
    }
    this.roomAnalyzer.analyze(base64Jpeg, this.state.selectedStyle, this.state.targetPurpose ?? undefined)
  }

  private handleAnalysisComplete(analysis: RoomAnalysis): void {
    if (!this.state.selectedStyle) {
      return
    }
    this.state.hasAnalysis = true
    this.lastAnalysis = analysis
    this.renderSuggestions(analysis)
    this.showShoppingCatalog(analysis)

    if (this.makeoverVisualizer) {
      this.makeoverVisualizer.generateMakeover(
        analysis,
        this.state.selectedStyle,
        this.state.targetPurpose ?? undefined,
      )
    }
    if (this.sessionManager) {
      this.sessionManager.onLocalAnalysisComplete(analysis)
    }
    if (this.autoNarrate && this.ttsNarrator) {
      const narrate =
        !this.sessionManager || !DecorSessionManager.isSyncActive() || this.sessionManager.isLeader()
      if (narrate) {
        this.ttsNarrator.narrate(analysis, this.state.selectedStyle)
      }
    }
    this.pushRoomContextToVoice(analysis)
  }

  private pushRoomContextToVoice(analysis: RoomAnalysis | null): void {
    if (!this.decorGeminiVoice) {
      return
    }
    const styleName =
      this.state.selectedStyle != null ? getStyle(this.state.selectedStyle).displayName : ''
    this.decorGeminiVoice.setRoomContext(analysis, styleName)
  }

  private renderSuggestions(analysis: RoomAnalysis): void {
    if (!this.suggestionsText) {
      return
    }
    const ranked = analysis.suggestions
      .slice(0, this.maxSuggestionsRendered)
      .sort((a, b) => this.priorityRank(b.priority) - this.priorityRank(a.priority))
    const lines: string[] = []
    const roomLine =
      analysis.roomType && analysis.roomType.length > 0 ? analysis.roomType : analysis.roomSummary
    lines.push(`Room: ${roomLine}`)
    if (this.state.selectedStyle) {
      lines.push(`Style: ${getStyle(this.state.selectedStyle).displayName}`)
    }
    lines.push('')
    lines.push('Decoration ideas')
    for (let i = 0; i < ranked.length; i++) {
      lines.push(this.renderSuggestionLine(i + 1, ranked[i]))
    }
    const shop = analysis.shoppingItems ? analysis.shoppingItems.slice(0, 4) : []
    if (shop.length > 0) {
      lines.push('')
      lines.push('Use Prev/Next on the panel — pinch Generate 3D per suggestion')
      for (let j = 0; j < shop.length; j++) {
        const p = shop[j]
        lines.push(`• ${p.title} (${p.category}) — ${p.whereToLook}`)
      }
    }
    this.suggestionsText.text = lines.join('\n')
  }

  private renderSuggestionLine(idx: number, s: DecorSuggestion): string {
    const tag = s.priority ? ` (${s.priority})` : ''
    return `${idx}. ${s.title}${tag}\n   ${s.detail}`
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

  private clearStatusLine(): void {
    if (!this.statusText) {
      return
    }
    this.statusText.text = ''
    this.statusText.enabled = true
    const statusObj = this.statusText.getSceneObject()
    if (statusObj) {
      statusObj.enabled = true
    }
  }

  private setStatus(message: string): void {
    if (this.statusText) {
      this.statusText.enabled = true
      const statusObj = this.statusText.getSceneObject()
      if (statusObj) {
        statusObj.enabled = true
      }
      this.statusText.text = message
    }
  }

  private truncate(value: string, max: number): string {
    if (!value) {
      return ''
    }
    return value.length > max ? `${value.substring(0, max - 1)}…` : value
  }

  private hideScanAffordance(immediate: boolean): void {
    if (!this.scanRoomRoot) {
      return
    }
    if (immediate) {
      this.scanRoomRoot.getTransform().setLocalScale(vec3.zero())
      this.scanRoomRoot.enabled = false
      return
    }
    const tr = this.scanRoomRoot.getTransform()
    const start = tr.getLocalScale()
    animate({
      duration: 0.3,
      easing: 'ease-out-quad',
      update: (t) => {
        const k = 1 - t
        tr.setLocalScale(new vec3(start.x * k, start.y * k, start.z * k))
      },
      ended: () => {
        if (this.scanRoomRoot) {
          this.scanRoomRoot.enabled = false
        }
      },
    })
  }

  private showScanAffordance(): void {
    if (!this.scanRoomRoot) {
      return
    }
    this.scanRoomRoot.enabled = true
    const tr = this.scanRoomRoot.getTransform()
    tr.setLocalScale(vec3.zero())
    animate({
      duration: Math.max(0.05, this.showDurationSeconds),
      easing: 'ease-out-back',
      update: (t) => {
        tr.setLocalScale(new vec3(t, t, t))
      },
      ended: () => {
        tr.setLocalScale(new vec3(1, 1, 1))
      },
    })
  }

  private hideCaptureAffordance(immediate: boolean): void {
    if (!this.captureRoomRoot) {
      return
    }
    if (immediate) {
      this.captureRoomRoot.getTransform().setLocalScale(vec3.zero())
      this.captureRoomRoot.enabled = false
      return
    }
    const tr = this.captureRoomRoot.getTransform()
    const start = tr.getLocalScale()
    animate({
      duration: 0.25,
      easing: 'ease-out-quad',
      update: (t) => {
        const k = 1 - t
        tr.setLocalScale(new vec3(start.x * k, start.y * k, start.z * k))
      },
      ended: () => {
        if (this.captureRoomRoot) {
          this.captureRoomRoot.enabled = false
        }
      },
    })
  }

  private showCaptureAffordance(): void {
    if (!this.captureRoomRoot) {
      return
    }
    this.captureRoomRoot.enabled = true
    const tr = this.captureRoomRoot.getTransform()
    tr.setLocalScale(vec3.zero())
    animate({
      duration: Math.max(0.05, this.showDurationSeconds),
      easing: 'ease-out-back',
      update: (t) => {
        tr.setLocalScale(new vec3(t, t, t))
      },
      ended: () => {
        tr.setLocalScale(new vec3(1, 1, 1))
      },
    })
  }
}
