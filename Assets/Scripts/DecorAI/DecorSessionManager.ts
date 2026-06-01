import { SyncEntity } from 'SpectaclesSyncKit.lspkg/Core/SyncEntity'
import { StorageProperty } from 'SpectaclesSyncKit.lspkg/Core/StorageProperty'
import { StoragePropertySet } from 'SpectaclesSyncKit.lspkg/Core/StoragePropertySet'
import { SessionController } from 'SpectaclesSyncKit.lspkg/Core/SessionController'
import { Instantiator } from 'SpectaclesSyncKit.lspkg/Components/Instantiator'
import { SyncKitLogger } from 'SpectaclesSyncKit.lspkg/Utils/SyncKitLogger'
import { DecorController } from './DecorController'
import { DecorStyleId, RoomAnalysis } from './DecorTypes'
import { Snap3DInteractableFactory } from '../Snap3DInteractableFactory'
import { Snap3DInteractable } from '../Snap3DInteractable'

const TAG = 'DecorSessionManager'

/** Synced session phases — all peers mirror the leader's UI step. */
export type DecorSessionPhase =
  | 'idle'
  | 'purpose'
  | 'scan'
  | 'live_preview'
  | 'analyzing'
  | 'results'

function sStr(p: StorageProperty<string>, fb: string): string {
  const v = p.currentOrPendingValue ?? p.currentValue
  return v !== null && v !== undefined ? (v as string) : fb
}

function sInt(p: StorageProperty<number>, fb: number): number {
  const v = p.currentOrPendingValue ?? p.currentValue
  return v !== null && v !== undefined ? (v as number) : fb
}

function sFloat(p: StorageProperty<number>, fb: number): number {
  const v = p.currentOrPendingValue ?? p.currentValue
  return v !== null && v !== undefined ? (v as number) : fb
}

/**
 * ONE shared SyncEntity for the whole Décor3D colocated session (ASHA / Tic Tac Toe pattern).
 *
 * When multiplayer is active (toggle ON + SessionController ready):
 *   • First user to press a button becomes session leader (`leaderConnId`).
 *   • Only the leader runs camera capture + Gemini/Imagen (expensive steps).
 *   • All peers mirror UI phase, analysis JSON, and Snap3D spawn triggers.
 *   • Snap3D objects spawn through {@link Instantiator} so everyone shares the same mesh.
 *
 * Single-player: this script stays idle — DecorController runs locally with no sync writes.
 *
 * Scene wiring (Inspector on DecorAI_controller):
 *   decorController  — DecorController on same object
 *   instantiator     — Instantiator under ColocatedWorld (Snap3DInteractable in prefab list)
 *   snap3dPrefab     — Snap3DInteractable prefab (same as factory prefab)
 */
@component
export class DecorSessionManager extends BaseScriptComponent {
  private static instance: DecorSessionManager | null = null

  @input
  decorController: DecorController

  @input
  @allowUndefined
  @hint('Network spawner — assign ColocatedWorld Instantiator with Snap3DInteractable prefab.')
  instantiator: Instantiator

  @input
  @allowUndefined
  @hint('Same prefab as Snap3DInteractableFactory.snap3DInteractablePrefab.')
  snap3dPrefab: ObjectPrefab

  private readonly log = new SyncKitLogger(TAG)

  // ── Synced state ─────────────────────────────────────────────────────────
  private phaseProp = StorageProperty.manualString('phase', 'idle')
  private styleProp = StorageProperty.manualString('style', '')
  private purposeProp = StorageProperty.manualString('purpose', '')
  private leaderProp = StorageProperty.manualString('leader', '')
  private analysisProp = StorageProperty.manualString('analysis', '')
  private snap3dPromptProp = StorageProperty.manualString('s3dPrompt', '')
  /** Short label for the in-world loading text (suggestion title / detail). */
  private snap3dLabelProp = StorageProperty.manualString('s3dLabel', '')
  private snap3dPosValidProp = StorageProperty.manualInt('s3dPosOk', 0)
  private snap3dPosXProp = StorageProperty.manualFloat('s3dPx', 0)
  private snap3dPosYProp = StorageProperty.manualFloat('s3dPy', 0)
  private snap3dPosZProp = StorageProperty.manualFloat('s3dPz', 0)
  /** Leader publishes artifact URLs so followers load the same GLB (no second Snap3D job). */
  private snap3dMeshUrlProp = StorageProperty.manualString('s3dMesh', '')
  private snap3dImageUrlProp = StorageProperty.manualString('s3dImg', '')
  /** World rotation (quaternion) + scale — updated when any peer finishes moving the 3D object. */
  private snap3dRotWProp = StorageProperty.manualFloat('s3dQw', 1)
  private snap3dRotXProp = StorageProperty.manualFloat('s3dQx', 0)
  private snap3dRotYProp = StorageProperty.manualFloat('s3dQy', 0)
  private snap3dRotZProp = StorageProperty.manualFloat('s3dQz', 0)
  private snap3dScaleXProp = StorageProperty.manualFloat('s3dSx', 1)
  private snap3dScaleYProp = StorageProperty.manualFloat('s3dSy', 1)
  private snap3dScaleZProp = StorageProperty.manualFloat('s3dSz', 1)
  private snap3dXfTrig = StorageProperty.manualInt('s3dXfT', 0)

  private scanTrig = StorageProperty.manualInt('scanT', 0)
  private captureTrig = StorageProperty.manualInt('capT', 0)
  private snap3dTrig = StorageProperty.manualInt('s3dT', 0)
  private restartTrig = StorageProperty.manualInt('rstT', 0)

  private syncEntity: SyncEntity
  private syncReady = false
  private mpActive = false
  private applyingRemote = false
  private lastScanT = 0
  private lastCapT = 0
  private lastS3dT = 0
  private lastRstT = 0
  private lastXfT = 0
  private followerSnap3dKey = ''
  private sampleCleanupFrames = 0
  private sampleCleanupEvent: SceneEvent | null = null

  onAwake(): void {
    DecorSessionManager.instance = this
    const props: StorageProperty<any>[] = [
      this.phaseProp,
      this.styleProp,
      this.purposeProp,
      this.leaderProp,
      this.analysisProp,
      this.snap3dPromptProp,
      this.snap3dLabelProp,
      this.snap3dPosValidProp,
      this.snap3dPosXProp,
      this.snap3dPosYProp,
      this.snap3dPosZProp,
      this.snap3dMeshUrlProp,
      this.snap3dImageUrlProp,
      this.snap3dRotWProp,
      this.snap3dRotXProp,
      this.snap3dRotYProp,
      this.snap3dRotZProp,
      this.snap3dScaleXProp,
      this.snap3dScaleYProp,
      this.snap3dScaleZProp,
      this.snap3dXfTrig,
      this.scanTrig,
      this.captureTrig,
      this.snap3dTrig,
      this.restartTrig,
    ]
    this.syncEntity = new SyncEntity(this, new StoragePropertySet(props), false, 'Session')
    this.syncEntity.notifyOnReady(() => this.onSyncReady())
    this.createEvent('OnStartEvent').bind(() => this.onStart())
  }

  onDestroy(): void {
    if (DecorSessionManager.instance === this) {
      DecorSessionManager.instance = null
    }
  }

  /** True when MP toggle is on AND user opted into sync AND SyncEntity is ready. */
  public static isSyncActive(): boolean {
    const inst = DecorSessionManager.instance
    return !!inst && inst.mpActive && inst.syncReady
  }

  public static getInstance(): DecorSessionManager | null {
    return DecorSessionManager.instance
  }

  /** Called by DecorMultiplayerController when the Connected Lens session is ready. */
  public activateMultiplayer(): void {
    this.mpActive = true
    this.disableAllSyncKitExamplesInScene()
    this.removeSyncKitSampleSpawns()
    this.ensureInstantiatorHierarchyEnabled()
    this.removeSyncKitSampleSpawns()
    this.startSampleSpawnWatchdog()
    this.log.i('Multiplayer sync armed')
    if (this.syncReady) {
      this.resetSessionState()
    }
  }

  /** Called when user turns MP toggle off — local play only. */
  public deactivateMultiplayer(): void {
    this.mpActive = false
    this.stopSampleSpawnWatchdog()
    this.log.i('Multiplayer sync disarmed — local play')
  }

  // ── Local action gates (called from DecorController before each step) ─────

  public onLocalStylePick(id: DecorStyleId): boolean {
    if (this.applyingRemote) return true
    if (!this.shouldGate()) return true
    if (!this.tryClaimLeader()) {
      this.blocked('Waiting for session leader…')
      return false
    }
    this.styleProp.setPendingValue(id)
    this.purposeProp.setPendingValue('')
    this.analysisProp.setPendingValue('')
    this.phaseProp.setPendingValue(this.decorController.hasPurposePanel() ? 'purpose' : 'scan')
    return true
  }

  public onLocalPurposePick(purpose: string | null): boolean {
    if (this.applyingRemote) return true
    if (!this.shouldGate()) return true
    if (!this.isLeader()) {
      this.blocked('Only the session leader can choose purpose.')
      return false
    }
    this.purposeProp.setPendingValue(purpose ?? 'skip')
    this.phaseProp.setPendingValue('scan')
    return true
  }

  public onLocalScanOpen(): boolean {
    if (!this.shouldGate()) return true
    if (!this.isLeader()) {
      this.mirrorLeaderScanUi()
      return false
    }
    const t = sInt(this.scanTrig, 0) + 1
    this.scanTrig.setPendingValue(t)
    this.phaseProp.setPendingValue('live_preview')
    return true
  }

  public onLocalCapture(): boolean {
    if (!this.shouldGate()) return true
    if (!this.isLeader()) {
      this.blocked('Session leader is capturing the room…')
      return false
    }
    const t = sInt(this.captureTrig, 0) + 1
    this.captureTrig.setPendingValue(t)
    this.phaseProp.setPendingValue('analyzing')
    return true
  }

  public onLocalAnalysisStarted(): void {
    if (!this.shouldGate()) return
    if (this.isLeader()) {
      this.phaseProp.setPendingValue('analyzing')
    }
  }

  public onLocalAnalysisComplete(analysis: RoomAnalysis): void {
    if (!this.shouldGate()) return
    if (!this.isLeader()) return
    try {
      this.analysisProp.setPendingValue(JSON.stringify(analysis))
      this.phaseProp.setPendingValue('results')
    } catch (e) {
      this.log.e('Failed to serialize analysis: ' + e)
    }
  }

  public onLocalRestart(): boolean {
    if (!this.shouldGate()) return true
    if (!this.isLeader()) {
      this.blocked('Only the session leader can restart.')
      return false
    }
    const t = sInt(this.restartTrig, 0) + 1
    this.restartTrig.setPendingValue(t)
    this.resetSessionState()
    return true
  }

  public onLocalSnap3DRequest(prompt: string): boolean {
    if (!this.shouldGate()) return true
    if (!this.isLeader()) {
      this.blocked('Only the session leader can generate 3D objects.')
      return false
    }
    this.snap3dPromptProp.setPendingValue(prompt)
    this.snap3dLabelProp.setPendingValue(Snap3DInteractable.truncateForDisplay(prompt))
    this.snap3dMeshUrlProp.setPendingValue('')
    this.snap3dImageUrlProp.setPendingValue('')
    this.snap3dXfTrig.setPendingValue(0)
    this.lastXfT = 0
    this.followerSnap3dKey = ''
    const t = sInt(this.snap3dTrig, 0) + 1
    this.snap3dTrig.setPendingValue(t)
    this.log.i('Snap3D generation started (trig ' + t + ')')
    return true
  }

  public publishSnap3DDisplayLabel(label: string): void {
    if (!this.shouldGate()) {
      return
    }
    this.snap3dLabelProp.setPendingValue(Snap3DInteractable.truncateForDisplay(label))
  }

  public getSnap3DDisplayLabel(): string {
    const label = sStr(this.snap3dLabelProp, '')
    if (label.length > 0) {
      return label
    }
    return Snap3DInteractable.truncateForDisplay(sStr(this.snap3dPromptProp, ''))
  }

  /** Leader publishes spawn point so followers place the shared replica at the same world pose. */
  public publishSnap3DSpawnWorldPosition(pos: vec3): void {
    if (!this.shouldGate()) return
    this.snap3dPosXProp.setPendingValue(pos.x)
    this.snap3dPosYProp.setPendingValue(pos.y)
    this.snap3dPosZProp.setPendingValue(pos.z)
    this.snap3dPosValidProp.setPendingValue(1)
  }

  public getSnap3DSpawnWorldPosition(): vec3 | null {
    if (!this.shouldGate() || sInt(this.snap3dPosValidProp, 0) !== 1) {
      return null
    }
    return new vec3(
      sFloat(this.snap3dPosXProp, 0),
      sFloat(this.snap3dPosYProp, 0),
      sFloat(this.snap3dPosZProp, 0),
    )
  }

  /**
   * Publish world transform after a peer moves/scales the active Snap3D object.
   * Last interaction wins for all devices (via s3dXfT trigger).
   */
  public publishSnap3DWorldTransform(obj: SceneObject, quiet: boolean = false): void {
    if (!this.shouldGate() || !obj) {
      return
    }
    const tr = obj.getTransform()
    const p = tr.getWorldPosition()
    const r = tr.getWorldRotation()
    const s = tr.getWorldScale()
    this.snap3dPosXProp.setPendingValue(p.x)
    this.snap3dPosYProp.setPendingValue(p.y)
    this.snap3dPosZProp.setPendingValue(p.z)
    this.snap3dRotWProp.setPendingValue(r.w)
    this.snap3dRotXProp.setPendingValue(r.x)
    this.snap3dRotYProp.setPendingValue(r.y)
    this.snap3dRotZProp.setPendingValue(r.z)
    this.snap3dScaleXProp.setPendingValue(s.x)
    this.snap3dScaleYProp.setPendingValue(s.y)
    this.snap3dScaleZProp.setPendingValue(s.z)
    this.snap3dPosValidProp.setPendingValue(1)
    const t = sInt(this.snap3dXfTrig, 0) + 1
    this.snap3dXfTrig.setPendingValue(t)
    if (!quiet) {
      this.log.i('Snap3D transform shared (xfT ' + t + ')')
    }
  }

  /** Leader calls when Snap3D finishes — followers download this exact GLB URL. */
  public publishSnap3DMeshReady(meshUrl: string, imageUrl: string): void {
    if (!this.shouldGate()) return
    this.snap3dMeshUrlProp.setPendingValue(meshUrl)
    this.snap3dImageUrlProp.setPendingValue(imageUrl ?? '')
    this.log.i('Snap3D mesh URL shared with session')
  }

  public getSnap3DMeshUrl(): string | null {
    if (!this.shouldGate()) return null
    const url = sStr(this.snap3dMeshUrlProp, '')
    return url.length > 0 ? url : null
  }

  public getSnap3DImageUrl(): string | null {
    if (!this.shouldGate()) return null
    const url = sStr(this.snap3dImageUrlProp, '')
    return url.length > 0 ? url : null
  }

  public getSnap3DPrompt(): string {
    return sStr(this.snap3dPromptProp, '')
  }

  /**
   * Apply the latest shared transform to the local Snap3D instance (e.g. after mesh load).
   * Safe to call when xfT was updated before the follower object existed.
   */
  public applyLatestSyncedSnap3DTransform(): void {
    if (!this.shouldGate()) {
      return
    }
    const t = sInt(this.snap3dXfTrig, 0)
    if (t === 0 || t === this.lastXfT || sInt(this.snap3dPosValidProp, 0) !== 1) {
      return
    }
    this.lastXfT = t
    const { pos, rot, scale } = this.readSnap3DTransform()
    this.decorController.applyRemoteSnap3DWorldTransform(pos, rot, scale)
  }

  /** Notify followers after the networked prefab exists (avoids trig-before-spawn race). */
  public broadcastSnap3DReady(): void {
    if (!this.shouldGate()) return
    const t = sInt(this.snap3dTrig, 0) + 1
    this.snap3dTrig.setPendingValue(t)
    this.log.i('Snap3D spawn relayed to session (trig ' + t + ')')
  }

  public canNetworkSpawnSnap3D(): boolean {
    const inst = this.resolveInstantiator()
    const prefab = this.resolveSnap3dPrefab()
    if (!inst || !prefab) {
      this.log.w(
        'Snap3D network spawn unavailable — instantiator=' +
          !!inst +
          ' prefab=' +
          !!prefab,
      )
    }
    return !!inst && !!prefab
  }

  /** Leader-only networked Snap3D spawn (Tic Tac Toe Instantiator pattern). */
  public networkSpawnSnap3D(
    _prompt: string,
    worldPosition: vec3,
    onSpawned: (obj: SceneObject) => void,
    onError: (msg: string) => void,
  ): void {
    const instantiator = this.resolveInstantiator()
    const prefab = this.resolveSnap3dPrefab()
    if (!instantiator || !prefab) {
      onError(
        'Snap3D network spawn unavailable — assign Instantiator + snap3dPrefab on DecorSessionManager, or use ColocatedWorld Instantiator.',
      )
      return
    }

    this.ensureInstantiatorHierarchyEnabled()

    const runInstantiate = (): void => {
      try {
        instantiator.instantiate(prefab, {
          worldPosition,
          persistence: 'Session',
          onSuccess: (root) => {
            onSpawned(root.sceneObject)
            const relay = this.createEvent('DelayedCallbackEvent')
            relay.bind(() => this.broadcastSnap3DReady())
            relay.reset(0.2)
          },
          onError: (msg) => {
            this.log.e('Instantiator spawn failed: ' + msg)
            onError(msg)
          },
        })
      } catch (e) {
        this.log.e('Instantiator instantiate threw: ' + e)
        onError(`${e}`)
      }
    }

    if (instantiator.isReady()) {
      this.log.i('Instantiator ready — spawning networked Snap3D')
      runInstantiate()
      return
    }

    let finished = false
    const finishOnce = (fn: () => void): void => {
      if (finished) {
        return
      }
      finished = true
      fn()
    }

    const timeout = this.createEvent('DelayedCallbackEvent')
    timeout.bind(() => {
      finishOnce(() => {
        this.log.w('Instantiator not ready after timeout — aborting network spawn')
        onError('Instantiator not ready')
      })
    })
    timeout.reset(2.5)

    this.log.i('Waiting for Instantiator ready…')
    instantiator.notifyOnReady(() => {
      finishOnce(runInstantiate)
    })
  }

  /** Enable ColocatedWorld chain for Instantiator without turning on Sync Kit sample scripts. */
  private ensureInstantiatorHierarchyEnabled(): void {
    const instantiator = this.resolveInstantiator()
    if (!instantiator) {
      return
    }
    const instObj = instantiator.getSceneObject()
    let node: SceneObject | null = instObj.getParent()
    while (node) {
      if (!node.enabled) {
        node.enabled = true
        this.log.i('Enabled for Snap3D Instantiator: ' + node.name)
      }
      if (node.name.indexOf('ColocatedWorld') >= 0) {
        break
      }
      node = node.getParent()
    }
    if (!instObj.enabled) {
      instObj.enabled = true
    }
    this.disableSyncKitSampleScripts(instObj)
  }

  /** Disable Sync Kit sample spawners anywhere in the scene (ghost logo). */
  private disableAllSyncKitExamplesInScene(): void {
    const roots: SceneObject[] = []
    if (this.decorController) {
      roots.push(this.getSceneRoot(this.decorController.getSceneObject()))
    }
    const colocated = this.findColocatedWorldRoot()
    if (colocated && roots.indexOf(colocated) < 0) {
      roots.push(colocated)
    }
    for (let r = 0; r < roots.length; r++) {
      const stack: SceneObject[] = [roots[r]]
      while (stack.length > 0) {
        const n = stack.pop()!
        if (n.name.indexOf('InstantiatorExample') >= 0) {
          n.enabled = false
        }
        const scripts = n.getComponents('ScriptComponent') as ScriptComponent[]
        for (let i = 0; i < scripts.length; i++) {
          const script = scripts[i]
          const label = script?.getSceneObject()?.name ?? ''
          if (script && label.indexOf('InstantiatorExample') >= 0) {
            script.enabled = false
          }
        }
        const c = n.getChildrenCount()
        for (let i = 0; i < c; i++) {
          stack.push(n.getChild(i))
        }
      }
    }
  }

  private getSceneRoot(node: SceneObject): SceneObject {
    let current = node
    while (current.getParent()) {
      current = current.getParent()
    }
    return current
  }

  private startSampleSpawnWatchdog(): void {
    if (this.sampleCleanupEvent) {
      return
    }
    this.sampleCleanupFrames = 0
    this.sampleCleanupEvent = this.createEvent('UpdateEvent')
    this.sampleCleanupEvent.bind(() => {
      if (!this.mpActive) {
        return
      }
      this.sampleCleanupFrames += 1
      if (this.sampleCleanupFrames % 30 !== 0) {
        return
      }
      this.disableAllSyncKitExamplesInScene()
      this.removeSyncKitSampleSpawns()
    })
  }

  private stopSampleSpawnWatchdog(): void {
    if (this.sampleCleanupEvent) {
      this.sampleCleanupEvent.enabled = false
      this.sampleCleanupEvent = null
    }
    this.sampleCleanupFrames = 0
  }

  /** InstantiatorExampleJavascript spawns the Snap logo sample (prefab 1f9e33dc) on session ready. */
  private disableSyncKitSampleScripts(instObj: SceneObject): void {
    const scripts = instObj.getComponents('ScriptComponent') as ScriptComponent[]
    for (let i = 0; i < scripts.length; i++) {
      const script = scripts[i]
      const scriptObj = script?.getSceneObject()
      const scriptLabel = scriptObj?.name ?? ''
      if (script && scriptLabel.indexOf('InstantiatorExample') >= 0) {
        script.enabled = false
        this.log.i('Disabled Sync Kit sample script: ' + scriptLabel)
      }
    }
    const colocated = this.findColocatedWorldRoot()
    if (!colocated) {
      return
    }
    const stack: SceneObject[] = [colocated]
    while (stack.length > 0) {
      const n = stack.pop()!
      if (n.name.indexOf('InstantiatorExample') >= 0 && n !== instObj) {
        n.enabled = false
      }
      const c = n.getChildrenCount()
      for (let i = 0; i < c; i++) {
        stack.push(n.getChild(i))
      }
    }
  }

  private removeSyncKitSampleSpawns(): void {
    const roots: SceneObject[] = []
    if (this.decorController) {
      roots.push(this.getSceneRoot(this.decorController.getSceneObject()))
    }
    const colocated = this.findColocatedWorldRoot()
    if (colocated && roots.indexOf(colocated) < 0) {
      roots.push(colocated)
    }
    if (roots.length === 0) {
      return
    }
    const interactableType = Snap3DInteractable.getTypeName()
    const toDestroy: SceneObject[] = []
    const stack: SceneObject[] = roots.slice()
    while (stack.length > 0) {
      const node = stack.pop()!
      const isHolder = node.name.indexOf('holder:') === 0
      const isGhostLikeName =
        node.name.indexOf('Ghost') >= 0 ||
        node.name.indexOf('ghost') >= 0 ||
        node.name.indexOf('Snap Logo') >= 0
      if (isHolder || isGhostLikeName) {
        let isDecorSnap3D = false
        const interactable = node.getComponent(interactableType) as Snap3DInteractable | null
        if (interactable) {
          isDecorSnap3D = true
        } else if (node.getChildrenCount() > 0) {
          const child = node.getChild(0)
          if (child.getComponent(interactableType)) {
            isDecorSnap3D = true
          }
        }
        if (!isDecorSnap3D) {
          toDestroy.push(node)
        }
      }
      const c = node.getChildrenCount()
      for (let i = 0; i < c; i++) {
        stack.push(node.getChild(i))
      }
    }
    for (let i = 0; i < toDestroy.length; i++) {
      toDestroy[i].destroy()
    }
    if (toDestroy.length > 0) {
      this.log.i('Removed ' + toDestroy.length + ' Sync Kit sample object(s)')
    }
  }

  public isLeader(): boolean {
    if (!this.shouldGate()) return true
    const leader = sStr(this.leaderProp, '')
    const me = this.localConnId()
    if (!leader) return true
    return !!me && leader === me
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  private onStart(): void {
    if (!this.decorController) {
      this.log.e('decorController not assigned')
      return
    }
    this.decorController.sessionManager = this
    this.resolveWiring()
  }

  private resolveWiring(): void {
    const inst = this.resolveInstantiator()
    const prefab = this.resolveSnap3dPrefab()
    if (inst) {
      this.log.i('Instantiator resolved: ' + inst.getSceneObject().name)
    } else {
      this.log.w('Instantiator not found — Snap3D will use local spawn on leader only')
    }
    if (prefab) {
      this.log.i('Snap3D prefab resolved: ' + prefab.name)
    } else {
      this.log.w(
        'Snap3D prefab not found — assign snap3dPrefab on DecorSessionManager or wire Snap3DInteractableFactory',
      )
    }
  }

  private resolveInstantiator(): Instantiator | null {
    if (this.instantiator) {
      return this.instantiator
    }
    const colocated = this.findColocatedWorldRoot()
    if (!colocated) {
      return null
    }
    const found = this.findInstantiatorInSubtree(colocated)
    if (found) {
      this.instantiator = found
    }
    return found
  }

  private findInstantiatorInSubtree(root: SceneObject): Instantiator | null {
    const typeName = Instantiator.getTypeName()
    const stack: SceneObject[] = [root]
    while (stack.length > 0) {
      const node = stack.pop()!
      const inst = node.getComponent(typeName) as Instantiator | null
      if (inst) {
        return inst
      }
      const childCount = node.getChildrenCount()
      for (let i = 0; i < childCount; i++) {
        stack.push(node.getChild(i))
      }
    }
    return null
  }

  private findColocatedWorldRoot(): SceneObject | null {
    const byName = this.findSceneObjectByName('ColocatedWorld [CONFIGURE_ME]')
    if (byName) {
      return byName
    }
    let node: SceneObject | null = this.decorController?.getSceneObject() ?? this.sceneObject
    while (node) {
      if (node.name.indexOf('ColocatedWorld') >= 0) {
        return node
      }
      node = node.getParent()
    }
    return null
  }

  private resolveSnap3dPrefab(): ObjectPrefab | null {
    if (this.snap3dPrefab) {
      return this.snap3dPrefab
    }
    const fromFactory = this.resolveSnap3dPrefabFromFactory()
    if (fromFactory) {
      this.snap3dPrefab = fromFactory
      return fromFactory
    }
    return null
  }

  private resolveSnap3dPrefabFromFactory(): ObjectPrefab | null {
    const generator = this.decorController?.snap3dGenerator
    const wiredFactory = generator?.snap3DFactory ?? null
    if (wiredFactory) {
      const prefab = wiredFactory.getInteractablePrefab()
      if (prefab) {
        return prefab
      }
    }
    const factory = this.findSnap3DFactoryInScene()
    if (factory) {
      return factory.getInteractablePrefab()
    }
    return null
  }

  private findSnap3DFactoryInScene(): Snap3DInteractableFactory | null {
    const typeName = Snap3DInteractableFactory.getTypeName()
    const roots: SceneObject[] = []
    const sceneRoot = this.getSceneRoot(this.sceneObject)
    roots.push(sceneRoot)
    const colocated = this.findColocatedWorldRoot()
    if (colocated && roots.indexOf(colocated) < 0) {
      roots.push(colocated)
    }
    for (let r = 0; r < roots.length; r++) {
      const stack: SceneObject[] = [roots[r]]
      while (stack.length > 0) {
        const node = stack.pop()!
        const factory = node.getComponent(typeName) as Snap3DInteractableFactory | null
        if (factory) {
          return factory
        }
        const childCount = node.getChildrenCount()
        for (let i = 0; i < childCount; i++) {
          stack.push(node.getChild(i))
        }
      }
    }
    return null
  }

  private findSceneObjectByName(name: string): SceneObject | null {
    const sceneAny = global as { scene?: { findByName?: (n: string) => SceneObject } }
    if (sceneAny.scene?.findByName) {
      return sceneAny.scene.findByName(name)
    }
    return null
  }

  private onSyncReady(): void {
    this.syncReady = true
    this.log.i('SyncEntity ready')

    this.phaseProp.onRemoteChange.add((v) => this.onRemotePhase(String(v)))
    this.styleProp.onRemoteChange.add((v) => this.onRemoteStyle(String(v)))
    this.purposeProp.onRemoteChange.add((v) => this.onRemotePurpose(String(v)))
    this.analysisProp.onRemoteChange.add(() => this.onRemoteAnalysis())
    this.scanTrig.onRemoteChange.add(() => this.onRemoteScanTrig())
    this.captureTrig.onRemoteChange.add(() => this.onRemoteCaptureTrig())
    this.snap3dTrig.onRemoteChange.add(() => this.onRemoteSnap3DTrig())
    this.snap3dPromptProp.onRemoteChange.add(() => this.onRemoteSnap3DPrompt())
    this.snap3dPosValidProp.onRemoteChange.add(() => this.onRemoteSnap3DSpawnPosition())
    this.snap3dMeshUrlProp.onRemoteChange.add(() => this.onRemoteSnap3DMeshUrl())
    this.snap3dXfTrig.onRemoteChange.add(() => this.onRemoteSnap3DTransform())
    this.restartTrig.onRemoteChange.add(() => this.onRemoteRestartTrig())

    if (this.mpActive) {
      this.hydrateFromSync()
    }
  }

  private shouldGate(): boolean {
    return this.mpActive && this.syncReady
  }

  private tryClaimLeader(): boolean {
    const me = this.localConnId()
    if (!me) return false
    const cur = sStr(this.leaderProp, '')
    if (!cur) {
      this.leaderProp.setPendingValue(me)
      this.log.i('Session leader claimed: ' + me)
      return true
    }
    return cur === me
  }

  private localConnId(): string | null {
    try {
      return SessionController.getInstance().getLocalConnectionId()
    } catch {
      return null
    }
  }

  private blocked(msg: string): void {
    this.log.i(msg)
    this.decorController.setStatusPublic(msg)
  }

  private mirrorLeaderScanUi(): void {
    this.decorController.applyRemoteScanOpen(false)
  }

  /** Clear stale keys when a new MP session starts (fixes preview cache bleed). */
  private resetSessionState(): void {
    this.leaderProp.setPendingValue('')
    this.styleProp.setPendingValue('')
    this.purposeProp.setPendingValue('')
    this.analysisProp.setPendingValue('')
    this.snap3dPromptProp.setPendingValue('')
    this.snap3dLabelProp.setPendingValue('')
    this.followerSnap3dKey = ''
    this.snap3dPosValidProp.setPendingValue(0)
    this.snap3dPosXProp.setPendingValue(0)
    this.snap3dPosYProp.setPendingValue(0)
    this.snap3dPosZProp.setPendingValue(0)
    this.snap3dRotWProp.setPendingValue(1)
    this.snap3dRotXProp.setPendingValue(0)
    this.snap3dRotYProp.setPendingValue(0)
    this.snap3dRotZProp.setPendingValue(0)
    this.snap3dScaleXProp.setPendingValue(1)
    this.snap3dScaleYProp.setPendingValue(1)
    this.snap3dScaleZProp.setPendingValue(1)
    this.snap3dXfTrig.setPendingValue(0)
    this.snap3dMeshUrlProp.setPendingValue('')
    this.snap3dImageUrlProp.setPendingValue('')
    this.phaseProp.setPendingValue('idle')
    this.scanTrig.setPendingValue(0)
    this.captureTrig.setPendingValue(0)
    this.snap3dTrig.setPendingValue(0)
    this.restartTrig.setPendingValue(0)
    this.lastScanT = 0
    this.lastCapT = 0
    this.lastS3dT = 0
    this.lastRstT = 0
    this.lastXfT = 0
    this.log.i('Session state reset')
  }

  private hydrateFromSync(): void {
    const phase = sStr(this.phaseProp, 'idle')
    const style = sStr(this.styleProp, '')
    if (style) {
      this.applyRemote(() => {
        this.decorController.applyRemoteStyleSelection(style as DecorStyleId)
        const purpose = sStr(this.purposeProp, '')
        if (purpose) {
          this.decorController.applyRemotePurposeSelection(purpose === 'skip' ? null : purpose)
        }
      })
    }
    if (phase === 'results') {
      this.onRemoteAnalysis()
    } else if (phase === 'live_preview') {
      this.decorController.applyRemoteScanOpen(false)
    } else if (phase === 'analyzing') {
      this.decorController.setStatusPublic('Session leader is analyzing the room…')
    }
    this.applyHydratedSnap3DTransform()
    this.tryStartFollowerSnap3D()
    this.onRemoteSnap3DSpawnPosition()
    this.log.i('Hydrated from sync — phase: ' + phase)
  }

  private applyHydratedSnap3DTransform(): void {
    const t = sInt(this.snap3dXfTrig, 0)
    if (t === 0 || t === this.lastXfT) {
      return
    }
    this.lastXfT = t
    const { pos, rot, scale } = this.readSnap3DTransform()
    this.applyRemote(() =>
      this.decorController.applyRemoteSnap3DWorldTransform(pos, rot, scale),
    )
  }

  private readSnap3DTransform(): { pos: vec3; rot: quat; scale: vec3 } {
    return {
      pos: new vec3(
        sFloat(this.snap3dPosXProp, 0),
        sFloat(this.snap3dPosYProp, 0),
        sFloat(this.snap3dPosZProp, 0),
      ),
      rot: new quat(
        sFloat(this.snap3dRotWProp, 1),
        sFloat(this.snap3dRotXProp, 0),
        sFloat(this.snap3dRotYProp, 0),
        sFloat(this.snap3dRotZProp, 0),
      ),
      scale: new vec3(
        sFloat(this.snap3dScaleXProp, 1),
        sFloat(this.snap3dScaleYProp, 1),
        sFloat(this.snap3dScaleZProp, 1),
      ),
    }
  }

  // ── Remote handlers ───────────────────────────────────────────────────────

  private onRemotePhase(phase: string): void {
    if (this.applyingRemote) return
    if (phase === 'idle') return
    if (phase === 'live_preview' && !this.isLeader()) {
      this.decorController.applyRemoteScanOpen(false)
    }
    if (phase === 'analyzing' && !this.isLeader()) {
      this.decorController.setStatusPublic('Session leader is analyzing the room…')
    }
  }

  private onRemoteStyle(id: string): void {
    if (!id || id.length === 0) return
    this.applyRemote(() => this.decorController.applyRemoteStyleSelection(id as DecorStyleId))
  }

  private onRemotePurpose(p: string): void {
    if (!p || p.length === 0) return
    this.applyRemote(() =>
      this.decorController.applyRemotePurposeSelection(p === 'skip' ? null : p),
    )
  }

  private onRemoteScanTrig(): void {
    const t = sInt(this.scanTrig, 0)
    if (t === this.lastScanT) return
    this.lastScanT = t
    if (this.isLeader()) return
    this.decorController.applyRemoteScanOpen(false)
  }

  private onRemoteCaptureTrig(): void {
    const t = sInt(this.captureTrig, 0)
    if (t === this.lastCapT) return
    this.lastCapT = t
    if (this.isLeader()) return
    this.decorController.setStatusPublic('Session leader captured — analyzing…')
  }

  private onRemoteAnalysis(): void {
    if (this.isLeader()) return
    const raw = sStr(this.analysisProp, '')
    if (!raw) return
    try {
      const analysis = JSON.parse(raw) as RoomAnalysis
      this.applyRemote(() => this.decorController.applyRemoteAnalysisComplete(analysis))
    } catch (e) {
      this.log.e('Bad analysis JSON: ' + e)
    }
  }

  private onRemoteSnap3DTrig(): void {
    const t = sInt(this.snap3dTrig, 0)
    if (t === this.lastS3dT) return
    this.lastS3dT = t
    if (this.isLeader()) return
    this.tryStartFollowerSnap3D()
  }

  private onRemoteSnap3DPrompt(): void {
    if (this.isLeader()) return
    this.tryStartFollowerSnap3D()
  }

  private onRemoteSnap3DSpawnPosition(): void {
    if (this.isLeader()) return
    if (sInt(this.snap3dPosValidProp, 0) !== 1) {
      return
    }
    const pos = this.getSnap3DSpawnWorldPosition()
    if (!pos) {
      return
    }
    this.decorController.applyRemoteSnap3DSpawnPosition(pos)
  }

  /** Spawn loading placeholder on followers as soon as the leader starts Snap3D. */
  private tryStartFollowerSnap3D(): void {
    if (!this.shouldGate() || this.isLeader()) {
      return
    }
    const prompt = sStr(this.snap3dPromptProp, '')
    if (!prompt) {
      return
    }
    if (sStr(this.snap3dMeshUrlProp, '').length > 0) {
      return
    }
    const key = prompt + '|' + sInt(this.snap3dTrig, 0)
    if (key === this.followerSnap3dKey) {
      return
    }
    this.followerSnap3dKey = key
    this.log.i('Follower: mirroring Snap3D generation UI')
    this.decorController.applyRemoteSnap3DGenerate(prompt, this.getSnap3DDisplayLabel())
  }

  /** Late mesh URL sync (leader finished after follower already spawned). */
  private onRemoteSnap3DMeshUrl(): void {
    if (this.isLeader()) return
    const meshUrl = this.getSnap3DMeshUrl()
    if (!meshUrl) return
    this.log.i('Follower: leader mesh URL received')
    this.decorController.applyRemoteSnap3DMeshUrl(meshUrl, this.getSnap3DImageUrl())
  }

  /** Any peer moved/scaled the shared Snap3D object — mirror world transform locally. */
  private onRemoteSnap3DTransform(): void {
    const t = sInt(this.snap3dXfTrig, 0)
    if (t === 0 || t === this.lastXfT) {
      return
    }
    this.lastXfT = t
    if (sInt(this.snap3dPosValidProp, 0) !== 1) {
      return
    }
    this.log.i('Snap3D transform update from session (xfT ' + t + ')')
    const { pos, rot, scale } = this.readSnap3DTransform()
    this.applyRemote(() =>
      this.decorController.applyRemoteSnap3DWorldTransform(pos, rot, scale),
    )
  }

  private onRemoteRestartTrig(): void {
    const t = sInt(this.restartTrig, 0)
    if (t === this.lastRstT) return
    this.lastRstT = t
    if (this.isLeader()) return
    this.applyRemote(() => this.decorController.restartLens())
  }

  private applyRemote(fn: () => void): void {
    this.applyingRemote = true
    try {
      fn()
    } finally {
      this.applyingRemote = false
    }
  }
}
