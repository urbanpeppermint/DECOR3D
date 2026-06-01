import NativeLogger from 'SpectaclesInteractionKit.lspkg/Utils/NativeLogger'
import { BaseButton } from 'SpectaclesUIKit.lspkg/Scripts/Components/Button/BaseButton'
import { SessionController } from 'SpectaclesSyncKit.lspkg/Core/SessionController'
import { SyncTransform } from 'SpectaclesSyncKit.lspkg/Components/SyncTransform'
import { DecorSessionManager } from './DecorSessionManager'

/**
 * Multiplayer toggle for Décor3D colocated play.
 *
 * Default: single-player. Toggle ON → starts a Connected Lens session via
 * SessionController.init() directly (bypassing StartModeController, which is
 * inside a disabled hierarchy in the SpectaclesSyncKit prefab).
 *
 * When the session becomes ready, DecorSessionManager activates full UI + Snap3D sync.
 * Toggle OFF → local play only (session may keep running).
 *
 * Scene wiring (all in Inspector):
 *   multiplayerButton  — BaseButton / SIK toggle to flip between modes
 *   singlePlayerLabel  — SceneObject shown in single-player (optional)
 *   twoPlayerLabel     — SceneObject shown in multiplayer (optional)
 *   statusText         — short status Text (optional)
 */
@component
export class DecorMultiplayerController extends BaseScriptComponent {
  private static instance: DecorMultiplayerController | null = null

  @ui.group_start('2-player toggle')
  @input
  @hint('Button or toggle that flips between 1-player and 2-player mode.')
  private multiplayerButton: BaseButton

  @input
  @allowUndefined
  @hint('Label visible in 1-player mode.')
  private singlePlayerLabel: SceneObject

  @input
  @allowUndefined
  @hint('Label visible in 2-player mode.')
  private twoPlayerLabel: SceneObject
  @ui.group_end

  @input
  @allowUndefined
  @hint('Short status line (optional — shows single-player / connecting / multiplayer ready).')
  private statusText: Text

  private readonly log = new NativeLogger('DecorMultiplayer')

  private twoPlayerRequested = false
  private sessionReady = false
  private connecting = false
  private notifyRegistered = false
  private readonly pendingSyncObjects: SceneObject[] = []

  onAwake(): void {
    DecorMultiplayerController.instance = this
    this.createEvent('OnStartEvent').bind(() => this.onStart())
  }

  onDestroy(): void {
    if (DecorMultiplayerController.instance === this) {
      DecorMultiplayerController.instance = null
    }
  }

  /** True when 2-player toggle is on AND session is connected. */
  public static isTwoPlayerActive(): boolean {
    const inst = DecorMultiplayerController.instance
    return !!inst && inst.twoPlayerRequested && inst.sessionReady
  }

  /**
   * Called by Snap3DInteractableFactory after every spawned object.
   * Enables SyncTransform if the session is active, or queues it for later.
   */
  public static enableSyncOnObject(obj: SceneObject): void {
    const inst = DecorMultiplayerController.instance
    if (inst) {
      inst.queueOrEnableSync(obj)
    }
  }

  private onStart(): void {
    this.setModeVisuals(false)
    this.setStatus('Single-player')

    if (!this.multiplayerButton) {
      this.log.e('multiplayerButton not assigned — 2-player toggle disabled.')
      return
    }

    this.multiplayerButton.onInitialized.add(() => {
      this.multiplayerButton.onTriggerUp.add(() => this.onTogglePressed())
    })
  }

  private onTogglePressed(): void {
    if (this.connecting) {
      // Already mid-connect — ignore
      return
    }
    if (!this.twoPlayerRequested) {
      this.turnOnTwoPlayer()
    } else {
      this.turnOffTwoPlayer()
    }
  }

  private turnOnTwoPlayer(): void {
    this.twoPlayerRequested = true
    this.sessionReady = false
    this.connecting = true
    this.setModeVisuals(true)
    this.setStatus('Multiplayer on — connecting…')

    let session: SessionController
    try {
      session = SessionController.getInstance()
    } catch (e) {
      this.fail('SessionController unavailable: ' + e)
      return
    }

    // If session is already connected from a previous toggle cycle, use it directly
    if (session.getIsReady()) {
      this.onSessionReady()
      return
    }

    // Register for the ready callback before calling init()
    if (!this.notifyRegistered) {
      this.notifyRegistered = true
      session.notifyOnReady(() => this.onSessionReady())
    }

    // init() bypasses StartModeController (which lives in a disabled hierarchy)
    // and goes straight to SessionController → createSession() → mapping flow
    try {
      session.init()
    } catch (e) {
      this.fail('session.init() failed: ' + e)
    }
  }

  private turnOffTwoPlayer(): void {
    this.twoPlayerRequested = false
    this.sessionReady = false
    this.connecting = false
    this.pendingSyncObjects.length = 0
    DecorSessionManager.getInstance()?.deactivateMultiplayer()
    this.setModeVisuals(false)
    this.setStatus('Single-player')
  }

  private onSessionReady(): void {
    if (!this.twoPlayerRequested) {
      return
    }
    this.sessionReady = true
    this.connecting = false
    this.setStatus('Multiplayer ready')
    this.log.i('Connected Lens session ready')
    DecorSessionManager.getInstance()?.activateMultiplayer()
    this.flushPendingSync()
  }

  private fail(msg: string): void {
    this.connecting = false
    this.twoPlayerRequested = false
    this.setModeVisuals(false)
    this.setStatus('Multiplayer failed — check Logger')
    this.log.e(msg)
  }

  private queueOrEnableSync(obj: SceneObject): void {
    if (!this.twoPlayerRequested) {
      return
    }
    if (!this.sessionReady) {
      this.pendingSyncObjects.push(obj)
      return
    }
    this.enableSyncTransform(obj)
  }

  private flushPendingSync(): void {
    while (this.pendingSyncObjects.length > 0) {
      const obj = this.pendingSyncObjects.shift()
      if (obj) {
        this.enableSyncTransform(obj)
      }
    }
  }

  private enableSyncTransform(obj: SceneObject): void {
    try {
      const sync = obj.getComponent(SyncTransform.getTypeName()) as SyncTransform | null
      if (sync) {
        sync.enabled = true
        this.log.i('SyncTransform enabled on ' + obj.name)
      } else {
        this.log.w(
          obj.name +
            ' has no SyncTransform — add it to Snap3DInteractable.prefab (disabled by default).',
        )
      }
    } catch (e) {
      this.log.w('Could not enable SyncTransform: ' + e)
    }
  }

  private setModeVisuals(twoPlayer: boolean): void {
    if (this.singlePlayerLabel) {
      this.singlePlayerLabel.enabled = !twoPlayer
    }
    if (this.twoPlayerLabel) {
      this.twoPlayerLabel.enabled = twoPlayer
    }
  }

  private setStatus(msg: string): void {
    if (this.statusText) {
      this.statusText.text = msg
    }
    this.log.i(msg)
  }
}
