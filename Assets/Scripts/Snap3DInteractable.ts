import { setTimeout } from 'SpectaclesInteractionKit.lspkg/Utils/FunctionTimingUtils'
import { Interactable } from 'SpectaclesInteractionKit.lspkg/Components/Interaction/Interactable/Interactable'
import { InteractableManipulation } from 'SpectaclesInteractionKit.lspkg/Components/Interaction/InteractableManipulation/InteractableManipulation'
import { DecorSessionManager } from './DecorAI/DecorSessionManager'
import { DecorMultiplayerController } from './DecorAI/DecorMultiplayerController'

const WorldQueryModule = require('LensStudio:WorldQueryModule')

const EPSILON = 0.01

@component
export class Snap3DInteractable extends BaseScriptComponent {
  @input
  private modelParent: SceneObject
  @input
  private img: Image
  @input
  private promptDisplay: Text
  @input
  private spinner: SceneObject
  @input
  private mat: Material
  @input
  private displayPlate: SceneObject
  @input
  private colliderObj: SceneObject

  @input
  @hint('Seconds before the floating prompt label is hidden (success or error).')
  private promptHideDelaySeconds: number = 4

  @ui.group_start('Surface Snapping')
  @input
  @hint('Snap the 3D object to detected surfaces via WorldQueryModule.')
  enableSurfaceSnap: boolean = true

  @input
  @hint('Smooth/filter the hit-test results for less jitter.')
  hitTestFilter: boolean = true

  @input
  @hint('Max ray length (cm) for initial surface detection (before first place).')
  surfaceRayLength: number = 200

  @input
  @hint('Max distance (cm) to snap to a surface on drag release. No snap if further.')
  snapProximityCm: number = 50

  @input
  @hint('Only snap to horizontal surfaces (floors/tables). Ignores walls and slopes.')
  horizontalSurfacesOnly: boolean = true

  @input
  @hint('Min surface normal Y (1 = flat floor). 0.85 ≈ 32° max slope.')
  minHorizontalNormalY: number = 0.85

  @input
  @hint('On drag release: keep rotation, only move onto surface at drop X/Z.')
  preserveRotationOnSnap: boolean = true

  @input
  @hint('Re-snap to surfaces when dragging the object to a new position.')
  resnapOnDrag: boolean = true

  @input
  @hint('Deprecated — no longer affects placement. Snap height uses half display height + Surface Clearance. Use Surface Clearance (signed) to close the gap.')
  anchorPivotAtBottom: boolean = true

  @input
  @hint('Signed vertical offset (cm) applied after snap. Negative pulls the object DOWN onto the surface, positive lifts it. Lower this toward a negative value to close the gap.')
  surfaceClearanceCm: number = 0
  @ui.group_end

  @ui.group_start('Wall Snapping')
  @input
  @hint('Allow wall items (curtains, paintings, wall lamps, mirrors) to snap to nearby walls. Auto-enabled by the factory from the prompt; can also be forced on.')
  enableWallSnap: boolean = true

  @input
  @hint('Max distance (cm) to a wall on drag release for the item to snap to it.')
  wallSnapProximityCm: number = 50

  @input
  @hint('A surface counts as a wall when |normal.y| is below this (0 = perfectly vertical). 0.3 ≈ up to ~17° tilt.')
  wallMaxNormalY: number = 0.3

  @input
  @hint('Signed offset (cm) out from the wall along its normal. Increase if the item clips into the wall; use a small negative to sit flush.')
  wallClearanceCm: number = 2

  @input
  @hint('Flip facing if the item ends up facing INTO the wall instead of into the room.')
  wallFacingFlip: boolean = false
  @ui.group_end

  @ui.group_start('Ceiling Snapping')
  @input
  @hint('Allow ceiling items (hanging plants, ceiling/pendant lamps, chandeliers) to snap to the ceiling above. Auto-enabled by the factory from the prompt.')
  enableCeilingSnap: boolean = true

  @input
  @hint('Max distance (cm) to the ceiling on drag release for the item to snap up to it.')
  ceilingSnapProximityCm: number = 80

  @input
  @hint('A surface counts as a ceiling when its normal points down past this (1 = perfectly flat ceiling). 0.85 ≈ up to ~32° tilt.')
  ceilingMinNormalDownY: number = 0.85

  @input
  @hint('How far (cm) the item hangs BELOW the ceiling hit. Increase for a longer cord/chain.')
  ceilingDropCm: number = 20
  @ui.group_end

  @ui.group_start('Display Size')
  @input
  @hint('Base size (cm) for the 2D preview, collider scale, and center-pivot placement.')
  baseDisplaySize: number = 40
  @ui.group_end

  @ui.group_start('Manipulation')
  @input
  @hint('Allow single-hand pinch-drag to move the item.')
  canTranslate: boolean = true

  @input
  @hint('Allow two-hand pinch to rotate the item on its anchor.')
  canRotate: boolean = true

  @input
  @hint('Allow two-hand pinch (spread/pinch) to scale the item.')
  canScale: boolean = true

  @input
  @hint('Minimum scale factor (relative to original).')
  minScaleFactor: number = 0.3

  @input
  @hint('Maximum scale factor (relative to original pinch size).')
  maxScaleFactor: number = 15.0
  @ui.group_end

  private tempModel: SceneObject = null
  private finalModel: SceneObject = null
  private sizeVec: vec3 = null
  private promptHideTimer: number = 0

  private hitTestSession: HitTestSession = null
  private isPlaced: boolean = false
  private isDragging: boolean = false
  private generationComplete: boolean = false
  private wallMount: boolean = false
  private ceilingMount: boolean = false
  private interactable: Interactable = null
  private manipulation: InteractableManipulation = null
  private updateEvent: SceneEvent = null
  private dragSyncEvent: SceneEvent = null
  private dragSyncFrames: number = 0
  private readonly dragSyncEveryNFrames: number = 3
  private anchoredNormal: vec3 = vec3.up()
  private sourcePrompt: string = ''
  private cachedMeshUrl: string = ''
  private cachedImageUrl: string = ''
  private initialSpawnWorldPos: vec3 | null = null

  onAwake() {
    let imgMaterial = this.img.mainMaterial
    imgMaterial.mainPass.baseTex = this.img.mainPass.baseTex
    this.img.enabled = false

    const base = Math.max(1, this.baseDisplaySize)
    this.sizeVec = vec3.one().uniformScale(base)
    this.displayPlate
      .getTransform()
      .setLocalPosition(new vec3(0, -base * 0.5, 0))
    this.colliderObj.getTransform().setLocalScale(this.sizeVec)
    this.img.getTransform().setLocalScale(this.sizeVec)

    if (this.enableSurfaceSnap || this.enableWallSnap || this.enableCeilingSnap) {
      this.initHitTest()
    }

    this.createEvent('OnStartEvent').bind(() => this.wireInteraction())
  }

  /**
   * Mark this object as a wall-mounted item (curtain, painting, wall lamp,
   * mirror…). When set, it snaps to nearby vertical surfaces instead of floors
   * and tables. Called by the factory based on the prompt, or wire it manually.
   */
  setWallMount(enabled: boolean): void {
    this.wallMount = enabled
    if (enabled) {
      this.ceilingMount = false
    }
    if (enabled && this.enableWallSnap && !this.hitTestSession) {
      this.initHitTest()
    }
  }

  /**
   * Mark this object as a ceiling-mounted item (hanging plant, pendant/ceiling
   * lamp, chandelier). When set, it snaps up to the ceiling and hangs below it.
   * Called by the factory based on the prompt, or wire it manually.
   */
  setCeilingMount(enabled: boolean): void {
    this.ceilingMount = enabled
    if (enabled) {
      this.wallMount = false
    }
    if (enabled && this.enableCeilingSnap && !this.hitTestSession) {
      this.initHitTest()
    }
  }

  setPrompt(prompt: string) {
    this.setSourcePrompt(prompt)
    this.beginGenerating(prompt)
  }

  /** Store Snap3D API prompt without showing the loading UI. */
  public setSourcePrompt(prompt: string): void {
    this.sourcePrompt = (prompt || '').trim()
  }

  public setInitialSpawnWorldPosition(pos: vec3): void {
    this.initialSpawnWorldPos = new vec3(pos.x, pos.y, pos.z)
  }

  public getInitialSpawnWorldPosition(): vec3 | null {
    return this.initialSpawnWorldPos
  }

  public setCachedAssetUrls(meshUrl: string, imageUrl: string): void {
    this.cachedMeshUrl = meshUrl ?? ''
    this.cachedImageUrl = imageUrl ?? ''
  }

  public getSourcePrompt(): string {
    return this.sourcePrompt
  }

  public getCachedMeshUrl(): string {
    return this.cachedMeshUrl
  }

  public getCachedImageUrl(): string {
    return this.cachedImageUrl
  }

  public isReadyForDuplicate(): boolean {
    return this.generationComplete
  }

  /** After hierarchy copy — ensure drag/snap works without re-running Snap3D. */
  public markReadyAfterDuplicate(): void {
    this.generationComplete = true
    this.hideLoadingUi()
    this.resetColliderLocalTransform()
  }

  public copyMountSettingsTo(target: Snap3DInteractable): void {
    if (!target) {
      return
    }
    target.setWallMount(this.wallMount)
    target.setCeilingMount(this.ceilingMount)
  }

  /** Hide spinner/label on duplicates (mesh is applied immediately). */
  public hideLoadingUi(): void {
    if (this.spinner) {
      this.spinner.enabled = false
    }
    this.setPromptVisible(false)
  }

  /** Spinner + floating label while Snap3D runs (leader and followers). */
  public beginGenerating(displayText: string): void {
    const label = Snap3DInteractable.truncateForDisplay(displayText)
    if (this.promptDisplay) {
      this.promptDisplay.text = label
    }
    this.setPromptVisible(true)
    if (this.spinner) {
      this.spinner.enabled = true
    }
    if (this.img) {
      this.img.enabled = false
    }
    const root = this.getSceneObject()
    if (root) {
      root.enabled = true
    }
  }

  public static truncateForDisplay(text: string, maxLen: number = 72): string {
    const t = (text || '').trim()
    if (t.length <= maxLen) {
      return t.length > 0 ? t : 'Generating 3D…'
    }
    return `${t.substring(0, maxLen - 1)}…`
  }

  setImage(image: Texture) {
    this.img.enabled = true
    this.img.mainPass.baseTex = image
  }

  setModel(model: GltfAsset, isFinal: boolean) {
    this.img.enabled = false
    if (isFinal) {
      if (!isNull(this.finalModel)) {
        this.finalModel.destroy()
      }
      this.spinner.enabled = false
      this.finalModel = model.tryInstantiate(this.modelParent, this.mat)
      this.finalModel.getTransform().setLocalScale(this.sizeVec)
      this.scheduleHidePrompt()

      this.generationComplete = true

      if (this.isSnapEnabled() && !this.isPlaced) {
        this.snapOnceFromObject()
      }
    } else {
      this.tempModel = model.tryInstantiate(this.modelParent, this.mat)
      this.tempModel.getTransform().setLocalScale(this.sizeVec)
    }
  }

  onFailure(error: string) {
    this.img.enabled = false
    this.spinner.enabled = false
    if (this.tempModel) {
      this.tempModel.destroy()
    }
    if (this.finalModel) {
      this.finalModel.destroy()
    }
    const short = error.length > 72 ? `${error.substring(0, 69)}…` : error
    this.promptDisplay.text = `Error: ${short}`
    this.setPromptVisible(true)
    this.scheduleHidePrompt()
    const delay = Math.max(0.5, this.promptHideDelaySeconds) + 1
    setTimeout(() => this.dismiss(), delay * 1000)
  }

  dismiss(): void {
    this.stopSurfaceScan()
    this.setPromptVisible(false)
    this.destroy()
  }

  /** True while this user is dragging/scaling the object (skip remote transform apply). */
  public isUserDragging(): boolean {
    return this.isDragging
  }

  /** Re-align collider after a remote peer moved the root transform. */
  public syncColliderAfterRemoteTransform(): void {
    this.resetColliderLocalTransform()
  }

  /**
   * Called by the factory after the object is positioned forward.
   * Only initializes the hit-test session — actual scanning is deferred
   * until the final 3D model is loaded (generationComplete).
   */
  snapToSurfaceOnce(): void {
    if (!this.isSnapEnabled()) {
      return
    }
    if (!this.hitTestSession) {
      this.initHitTest()
    }
  }

  /** True when this object should snap to something (floor, wall, or ceiling). */
  private isSnapEnabled(): boolean {
    if (this.ceilingMount) {
      return this.enableCeilingSnap
    }
    if (this.wallMount) {
      return this.enableWallSnap
    }
    return this.enableSurfaceSnap
  }

  private initHitTest(): void {
    try {
      const options = HitTestSessionOptions.create()
      options.filter = this.hitTestFilter
      this.hitTestSession = WorldQueryModule.createHitTestSessionWithOptions(options)
    } catch (e) {
      print('[Snap3DInteractable] WorldQueryModule not available: ' + e)
      this.enableSurfaceSnap = false
    }
  }

  private wireInteraction(): void {
    if (!this.colliderObj) {
      return
    }

    this.interactable = this.colliderObj.getComponent(
      Interactable.getTypeName(),
    ) as Interactable
    this.manipulation = this.colliderObj.getComponent(
      InteractableManipulation.getTypeName(),
    ) as InteractableManipulation

    if (this.manipulation) {
      this.manipulation.setCanTranslate(this.canTranslate)
      this.manipulation.setCanRotate(this.canRotate)
      this.manipulation.setCanScale(this.canScale)
      this.manipulation.minimumScaleFactor = this.minScaleFactor
      this.manipulation.maximumScaleFactor = this.maxScaleFactor
    }

    if (this.interactable) {
      this.interactable.onDragStart.add(() => {
        this.isDragging = true
        if (this.generationComplete) {
          DecorMultiplayerController.enableSyncOnObject(this.getSceneObject())
          this.startDragTransformSync()
        }
      })
      this.interactable.onDragEnd.add(() => {
        this.isDragging = false
        this.stopDragTransformSync()
        if (
          this.generationComplete &&
          this.resnapOnDrag &&
          this.isSnapEnabled()
        ) {
          this.snapOnDragRelease()
        }
        DecorSessionManager.getInstance()?.publishSnap3DWorldTransform(
          this.getSceneObject(),
          true,
        )
        this.scheduleTransformSyncPublish()
      })
    }
  }

  /** ~10 Hz session updates while dragging (backup to SyncTransform custom network id). */
  private startDragTransformSync(): void {
    if (!DecorSessionManager.isSyncActive() || this.dragSyncEvent) {
      return
    }
    this.dragSyncFrames = 0
    this.dragSyncEvent = this.createEvent('UpdateEvent')
    this.dragSyncEvent.bind(() => this.onDragTransformSyncTick())
  }

  private stopDragTransformSync(): void {
    if (this.dragSyncEvent) {
      this.dragSyncEvent.enabled = false
      this.dragSyncEvent = null
    }
    this.dragSyncFrames = 0
  }

  private onDragTransformSyncTick(): void {
    if (!this.isDragging || !this.generationComplete) {
      return
    }
    this.dragSyncFrames += 1
    if (this.dragSyncFrames % this.dragSyncEveryNFrames !== 0) {
      return
    }
    DecorSessionManager.getInstance()?.publishSnap3DWorldTransform(
      this.getSceneObject(),
      true,
    )
  }

  /** Final pose after surface snap settles (~0.12s). */
  private scheduleTransformSyncPublish(): void {
    if (!DecorSessionManager.isSyncActive() || !this.generationComplete) {
      return
    }
    const ev = this.createEvent('DelayedCallbackEvent')
    ev.bind(() => {
      if (this.isDragging) {
        return
      }
      DecorSessionManager.getInstance()?.publishSnap3DWorldTransform(
        this.getSceneObject(),
        false,
      )
    })
    ev.reset(0.12)
  }

  private startSurfaceScan(): void {
    if (this.updateEvent) {
      return
    }
    this.updateEvent = this.createEvent('UpdateEvent')
    this.updateEvent.bind(() => this.onSurfaceUpdate())
  }

  private stopSurfaceScan(): void {
    if (this.updateEvent) {
      this.updateEvent.enabled = false
      this.updateEvent = null
    }
  }

  private onSurfaceUpdate(): void {
    if (!this.hitTestSession || !this.generationComplete) {
      return
    }

    if (!this.isPlaced) {
      this.raycastFromObject()
    } else {
      this.stopSurfaceScan()
    }
  }

  /**
   * Single-shot snap: start a temporary update loop that tries to find a
   * surface below the object. Stops as soon as it hits one.
   */
  private snapOnceFromObject(): void {
    if (!this.hitTestSession) {
      this.initHitTest()
    }
    this.startSurfaceScan()
  }

  /**
   * Initial placement: wall items search nearby walls; everything else rays
   * straight down for a horizontal surface under the object.
   */
  private raycastFromObject(): void {
    const pos = this.getTransform().getWorldPosition()

    if (this.ceilingMount && this.enableCeilingSnap) {
      this.raycastUpForCeiling(pos, this.surfaceRayLength, (hit) => {
        if (hit) {
          this.applyCeilingHit(hit.position, hit.normal)
        }
        this.isPlaced = true
        this.stopSurfaceScan()
      })
      return
    }

    if (this.wallMount && this.enableWallSnap) {
      this.findNearestWall(pos, (hit) => {
        if (hit) {
          this.applyWallHit(hit.position, hit.normal)
        }
        this.isPlaced = true
        this.stopSurfaceScan()
      })
      return
    }

    this.raycastDownForSurface(pos, this.surfaceRayLength, (hit) => {
      if (!hit) {
        this.isPlaced = true
        this.stopSurfaceScan()
        return
      }
      this.applySurfaceHit(hit.position, hit.normal, {
        preserveRotation: false,
        anchorXZ: pos,
      })
      this.isPlaced = true
      this.stopSurfaceScan()
    })
  }

  /**
   * On drag release: ray down from drop point only. Snap if a horizontal
   * surface is within snapProximityCm; otherwise stay exactly where released.
   */
  private snapOnDragRelease(): void {
    if (!this.hitTestSession) {
      return
    }
    const dropPos = this.colliderObj
      ? this.colliderObj.getTransform().getWorldPosition()
      : this.getTransform().getWorldPosition()

    if (this.ceilingMount && this.enableCeilingSnap) {
      this.snapToCeilingOnRelease(dropPos)
      return
    }

    if (this.wallMount && this.enableWallSnap) {
      this.snapToWallOnRelease(dropPos)
      return
    }

    const range = Math.max(1, this.snapProximityCm)
    const rayStart = dropPos.add(new vec3(0, range * 0.5, 0))

    this.raycastDownForSurface(rayStart, range * 1.5, (hit) => {
      if (!hit) {
        this.moveRootToDragPosition(dropPos)
        return
      }
      const verticalDist = Math.abs(dropPos.y - hit.position.y)
      if (verticalDist > range) {
        this.moveRootToDragPosition(dropPos)
        return
      }
      this.applySurfaceHit(hit.position, hit.normal, {
        preserveRotation: this.preserveRotationOnSnap,
        anchorXZ: dropPos,
      })
      this.isPlaced = true
    })

    this.stopSurfaceScan()
  }

  /**
   * On drag release for a wall item: find the nearest wall around the drop
   * point and mount on it. If no wall is within range, stay where released.
   */
  private snapToWallOnRelease(dropPos: vec3): void {
    if (!this.hitTestSession) {
      return
    }
    this.findNearestWall(dropPos, (hit) => {
      if (!hit) {
        this.moveRootToDragPosition(dropPos)
        return
      }
      this.applyWallHit(hit.position, hit.normal)
      this.isPlaced = true
    })
    this.stopSurfaceScan()
  }

  /**
   * Cast rays horizontally in 8 directions around `fromPos` and return the
   * closest acceptable vertical surface (wall) within wallSnapProximityCm.
   * Aggregates the async hit-test callbacks before reporting the best hit.
   */
  private findNearestWall(
    fromPos: vec3,
    onResult: (hit: { position: vec3; normal: vec3 } | null) => void,
  ): void {
    if (!this.hitTestSession) {
      onResult(null)
      return
    }
    const range = Math.max(1, this.wallSnapProximityCm)
    const d = 0.70710678 // sqrt(2)/2 for diagonal unit vectors
    const dirs: vec3[] = [
      new vec3(0, 0, -1),
      new vec3(0, 0, 1),
      new vec3(-1, 0, 0),
      new vec3(1, 0, 0),
      new vec3(d, 0, -d),
      new vec3(-d, 0, -d),
      new vec3(d, 0, d),
      new vec3(-d, 0, d),
    ]

    let pending = dirs.length
    let best: { position: vec3; normal: vec3; dist: number } | null = null

    for (let i = 0; i < dirs.length; i++) {
      const rayEnd = fromPos.add(dirs[i].uniformScale(range))
      this.hitTestSession.hitTest(fromPos, rayEnd, (results: any) => {
        if (results !== null && this.isAcceptableWall(results.normal)) {
          const dist = fromPos.distance(results.position)
          if (dist <= range && (best === null || dist < best.dist)) {
            best = { position: results.position, normal: results.normal, dist }
          }
        }
        pending -= 1
        if (pending === 0) {
          onResult(best ? { position: best.position, normal: best.normal } : null)
        }
      })
    }
  }

  private isAcceptableWall(normal: vec3): boolean {
    const n = normal.normalize()
    const maxY = Math.max(0, Math.min(0.7, this.wallMaxNormalY))
    return Math.abs(n.y) <= maxY
  }

  /**
   * Place a wall item flat against the wall: position at the hit, pushed out
   * along the wall normal by wallClearanceCm, facing into the room, upright.
   */
  private applyWallHit(position: vec3, normal: vec3): void {
    const transform = this.getTransform()
    const n = normal.normalize()

    const placePos = position.add(n.uniformScale(this.wallClearanceCm))
    transform.setWorldPosition(placePos)
    this.anchoredNormal = n

    const faceDir = this.wallFacingFlip ? n.uniformScale(-1) : n
    transform.setWorldRotation(quat.lookAt(faceDir, vec3.up()))

    this.resetColliderLocalTransform()
  }

  /**
   * On drag release for a ceiling item: ray up from the drop point. Snap to the
   * ceiling if it is within ceilingSnapProximityCm; otherwise stay put.
   */
  private snapToCeilingOnRelease(dropPos: vec3): void {
    if (!this.hitTestSession) {
      return
    }
    const range = Math.max(1, this.ceilingSnapProximityCm)
    this.raycastUpForCeiling(dropPos, range * 1.5, (hit) => {
      if (!hit) {
        this.moveRootToDragPosition(dropPos)
        return
      }
      const verticalDist = Math.abs(hit.position.y - dropPos.y)
      if (verticalDist > range) {
        this.moveRootToDragPosition(dropPos)
        return
      }
      this.applyCeilingHit(hit.position, hit.normal)
      this.isPlaced = true
    })
    this.stopSurfaceScan()
  }

  private raycastUpForCeiling(
    fromPos: vec3,
    rayLength: number,
    onResult: (hit: { position: vec3; normal: vec3 } | null) => void,
  ): void {
    if (!this.hitTestSession) {
      onResult(null)
      return
    }
    const len = Math.max(1, rayLength)
    const rayStart = fromPos
    const rayEnd = fromPos.add(new vec3(0, len, 0))

    this.hitTestSession.hitTest(rayStart, rayEnd, (results: any) => {
      if (results === null) {
        onResult(null)
        return
      }
      if (!this.isAcceptableCeiling(results.normal)) {
        onResult(null)
        return
      }
      onResult({ position: results.position, normal: results.normal })
    })
  }

  private isAcceptableCeiling(normal: vec3): boolean {
    const n = normal.normalize()
    const minDown = Math.max(0.5, Math.min(1, this.ceilingMinNormalDownY))
    // Ceiling normals point downward into the room (negative Y).
    return n.y <= -minDown
  }

  /**
   * Hang a ceiling item below the ceiling hit, keeping its X/Z, upright.
   */
  private applyCeilingHit(position: vec3, normal: vec3): void {
    const transform = this.getTransform()
    const n = normal.normalize()

    const placePos = new vec3(
      position.x,
      position.y - this.ceilingDropCm,
      position.z,
    )
    transform.setWorldPosition(placePos)
    this.anchoredNormal = n

    this.resetColliderLocalTransform()
  }

  private raycastDownForSurface(
    fromPos: vec3,
    rayLength: number,
    onResult: (hit: { position: vec3; normal: vec3 } | null) => void,
  ): void {
    if (!this.hitTestSession) {
      onResult(null)
      return
    }
    const len = Math.max(1, rayLength)
    const rayStart = fromPos
    const rayEnd = fromPos.sub(new vec3(0, len, 0))

    this.hitTestSession.hitTest(rayStart, rayEnd, (results: any) => {
      if (results === null) {
        onResult(null)
        return
      }
      if (!this.isAcceptableSurface(results.normal)) {
        onResult(null)
        return
      }
      onResult({ position: results.position, normal: results.normal })
    })
  }

  private isAcceptableSurface(normal: vec3): boolean {
    if (!this.horizontalSurfacesOnly) {
      return true
    }
    const n = normal.normalize()
    return n.y >= Math.max(0.5, Math.min(1, this.minHorizontalNormalY))
  }

  /**
   * After dragging, re-center the child collider on the root so the
   * hierarchy stays aligned for the next drag cycle.
   */
  private moveRootToDragPosition(worldPos: vec3): void {
    this.getTransform().setWorldPosition(worldPos)
    this.resetColliderLocalTransform()
  }

  /**
   * World Y for the prefab root on a surface hit.
   *
   * Placement = surface hit + half the (scaled) display height, so the object's
   * center sits half a body above the surface and its base rests on it. This is
   * the behaviour that placed objects consistently before the bounds experiment.
   *
   * `surfaceClearanceCm` is a *signed* fine-tune: negative values pull the object
   * down toward (or into) the surface, positive values lift it. Use it to dial
   * the gap to zero for a given mesh set.
   *
   * Note: this intentionally does NOT branch on `anchorPivotAtBottom`. Trusting a
   * "bottom pivot" buried meshes below the surface (Snap3D pivots are not
   * reliably at the base), so we always use the half-height offset + clearance.
   */
  private computeSurfaceWorldY(hitPosition: vec3): number {
    const scaleY = this.getTransform().getWorldScale().y
    const halfH = (Math.max(1, this.baseDisplaySize) * scaleY) * 0.5
    return hitPosition.y + halfH + this.surfaceClearanceCm
  }

  private applySurfaceHit(
    position: vec3,
    normal: vec3,
    options: { preserveRotation: boolean; anchorXZ: vec3 },
  ): void {
    const transform = this.getTransform()
    const n = normal.normalize()

    const placePos = new vec3(
      options.anchorXZ.x,
      this.computeSurfaceWorldY(position),
      options.anchorXZ.z,
    )
    transform.setWorldPosition(placePos)
    this.anchoredNormal = n

    if (!options.preserveRotation) {
      const lookDir =
        1 - Math.abs(n.dot(vec3.up())) < EPSILON
          ? vec3.forward()
          : n.cross(vec3.up())
      transform.setWorldRotation(quat.lookAt(lookDir, n))
    }

    this.resetColliderLocalTransform()
  }

  private resetColliderLocalTransform(): void {
    if (this.colliderObj) {
      this.colliderObj.getTransform().setLocalPosition(vec3.zero())
      this.colliderObj.getTransform().setLocalRotation(quat.quatIdentity())
    }
  }

  private scheduleHidePrompt(): void {
    const delay = Math.max(0.5, this.promptHideDelaySeconds)
    this.promptHideTimer += 1
    const token = this.promptHideTimer
    setTimeout(() => {
      if (token !== this.promptHideTimer) {
        return
      }
      this.setPromptVisible(false)
    }, delay * 1000)
  }

  private setPromptVisible(visible: boolean): void {
    if (this.promptDisplay) {
      this.promptDisplay.enabled = visible
    }
    const promptObj = this.promptDisplay
      ? this.promptDisplay.getSceneObject()
      : null
    if (promptObj && promptObj !== this.getSceneObject()) {
      promptObj.enabled = visible
    }
  }
}
