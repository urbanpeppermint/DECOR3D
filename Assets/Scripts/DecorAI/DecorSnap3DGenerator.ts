import NativeLogger from 'SpectaclesInteractionKit.lspkg/Utils/NativeLogger'
import { Snap3DInteractable } from '../Snap3DInteractable'
import { Snap3DInteractableFactory } from '../Snap3DInteractableFactory'
import { DecorShoppingItem, DecorSuggestion } from './DecorTypes'
import { buildSnap3DPromptFromSuggestion } from './DecorSnap3DPrompt'
import { DecorSessionManager } from './DecorSessionManager'

/**
 * Snap3D for the active suggestion slide (same index as prev/next in the shopping panel).
 * Uses Remote Service Gateway — requires a Snap token in RemoteServiceGatewayCredentials.
 */
@component
export class DecorSnap3DGenerator extends BaseScriptComponent {
  @input
  @hint('Scene object with Snap3DInteractableFactory (e.g. Snap3DInteractableFactory in hierarchy).')
  snap3DFactory: Snap3DInteractableFactory

  @input
  @allowUndefined
  statusText: Text

  @input
  dismissPreviousOnGenerate: boolean = true

  @input
  @hint('How long the status line stays visible, then clears (success or error).')
  statusVisibleSeconds: number = 4

  @input
  @hint('Hide the status Text object when cleared (not only empty string).')
  hideStatusObjectWhenCleared: boolean = true

  private readonly log = new NativeLogger('DecorSnap3DGenerator')
  private styleName: string = ''
  private roomType: string = ''
  private busy: boolean = false
  private lastSpawn: SceneObject | null = null
  private lastPrompt: string = ''
  private generationSpawnWorldPos: vec3 | null = null
  private statusClearToken: number = 0

  onAwake(): void {
    this.createEvent('OnStartEvent').bind(() => this.resolveFactory())
  }

  setContext(styleName: string, roomType: string): void {
    this.styleName = styleName ?? ''
    this.roomType = roomType ?? ''
  }

  /** Prompt that will be used for the current slide (for UI hints). */
  getPreviewPrompt(
    suggestion: DecorSuggestion,
    relatedShop?: DecorShoppingItem | null,
  ): string {
    return buildSnap3DPromptFromSuggestion(suggestion, this.styleName, this.roomType, relatedShop)
  }

  dismiss(): void {
    if (this.lastSpawn) {
      const interactable = this.lastSpawn.getComponent(
        Snap3DInteractable.getTypeName(),
      ) as Snap3DInteractable | null
      if (interactable) {
        interactable.dismiss()
      } else {
        this.lastSpawn.destroy()
      }
      this.lastSpawn = null
    }
    this.busy = false
    this.lastPrompt = ''
    this.generationSpawnWorldPos = null
    this.clearStatus()
    const factory = this.resolveFactory()
    if (factory) {
      factory.resetSession()
    }
  }

  /** Remove any Snap3DInteractable instances left in the scene (e.g. after errors). */
  destroyAllSpawnedInteractables(root: SceneObject): void {
    const roots: SceneObject[] = [this.getSceneRoot(root)]
    const factory = this.resolveFactory()
    if (factory) {
      const factoryObj = factory.getSceneObject()
      if (factoryObj && roots.indexOf(factoryObj) < 0) {
        roots.push(this.getSceneRoot(factoryObj))
      }
      factory.resetSession()
    }
    const typeName = Snap3DInteractable.getTypeName()
    for (let r = 0; r < roots.length; r++) {
      const stack: SceneObject[] = [roots[r]]
      while (stack.length > 0) {
        const node = stack.pop()!
        const interactable = node.getComponent(typeName) as Snap3DInteractable | null
        if (interactable) {
          interactable.dismiss()
          continue
        }
        const childCount = node.getChildrenCount()
        for (let i = 0; i < childCount; i++) {
          stack.push(node.getChild(i))
        }
      }
    }
    this.lastSpawn = null
    this.generationSpawnWorldPos = null
    this.busy = false
  }

  public canDuplicateModel(): boolean {
    return !!this.findDuplicateSource() && !!this.resolveDuplicateSpawnPosition()
  }

  /** Place another copy at the original generation spawn (spinner) location. */
  duplicateActiveModel(): void {
    const factory = this.resolveFactory()
    const source = this.findDuplicateSource()
    const spawnPos = this.resolveDuplicateSpawnPosition(source)
    if (!factory || !source || !spawnPos) {
      this.setStatus('Generate a 3D model first, then duplicate.')
      return
    }
    if (!source.isReadyForDuplicate()) {
      this.setStatus('Wait for the current 3D model to finish generating.')
      return
    }
    this.setStatus('Placing duplicate…')
    factory
      .duplicateCompletedModel(source, spawnPos)
      .then(() => {
        this.setStatus('Duplicate placed at spawn point')
      })
      .catch((err) => {
        const msg = typeof err === 'string' ? err : `${err}`
        this.setStatus(this.formatSnap3DUserHint(msg))
        this.log.e(`Snap3D duplicate: ${msg}`)
      })
  }

  private findDuplicateSource(): Snap3DInteractable | null {
    const factory = this.resolveFactory()
    if (!factory) {
      return null
    }
    if (this.lastSpawn) {
      const fromLast =
        factory.findInteractable(this.lastSpawn) ??
        (this.lastSpawn.getComponent(
          Snap3DInteractable.getTypeName(),
        ) as Snap3DInteractable | null)
      if (fromLast?.isReadyForDuplicate()) {
        return fromLast
      }
    }
    return factory.findLatestReadyInteractable()
  }

  private resolveDuplicateSpawnPosition(
    source?: Snap3DInteractable | null,
  ): vec3 | null {
    const interactable = source ?? this.findDuplicateSource()
    const fromSource = interactable?.getInitialSpawnWorldPosition()
    if (fromSource) {
      return fromSource
    }
    if (this.generationSpawnWorldPos) {
      return this.generationSpawnWorldPos
    }
    const session = DecorSessionManager.getInstance()
    return session?.getSnap3DSpawnWorldPosition() ?? null
  }

  private rememberGenerationSpawnPosition(spawned: SceneObject): void {
    const factory = this.resolveFactory()
    const interactable =
      factory?.findInteractable(spawned) ??
      (spawned.getComponent(
        Snap3DInteractable.getTypeName(),
      ) as Snap3DInteractable | null)
    const fromInteractable = interactable?.getInitialSpawnWorldPosition()
    if (fromInteractable) {
      this.generationSpawnWorldPos = fromInteractable
      return
    }
    const session = DecorSessionManager.getInstance()
    const synced = session?.getSnap3DSpawnWorldPosition()
    if (synced) {
      this.generationSpawnWorldPos = synced
      return
    }
    const p = spawned.getTransform().getWorldPosition()
    this.generationSpawnWorldPos = new vec3(p.x, p.y, p.z)
  }

  private getSceneRoot(node: SceneObject): SceneObject {
    let current = node
    while (current.getParent()) {
      current = current.getParent()
    }
    return current
  }

  /** If the follower object exists but is still on spinner, apply the synced GLB. */
  applySharedMeshFromSession(meshUrl: string, imageUrl: string | null): void {
    const factory = this.resolveFactory()
    if (!factory || !meshUrl) {
      return
    }
    if (this.lastSpawn) {
      factory
        .applySharedMeshToExisting(this.lastSpawn, meshUrl, imageUrl)
        .then(() => {
          this.busy = false
          const interactable = this.findDuplicateSource()
          interactable?.setCachedAssetUrls(meshUrl, imageUrl ?? '')
          if (this.lastSpawn) {
            this.rememberGenerationSpawnPosition(this.lastSpawn)
          }
          this.setStatus('3D ready (shared session)')
        })
        .catch((err) => {
          const msg = typeof err === 'string' ? err : `${err}`
          this.log.e(`Snap3D follower mesh apply: ${msg}`)
        })
      return
    }
    if (this.busy) {
      return
    }
    const session = DecorSessionManager.getInstance()
    const prompt = session?.getSnap3DPrompt() ?? ''
    if (prompt) {
      this.generateFromSyncedPrompt(prompt)
    }
  }

  /** Apply world transform published by any peer after they move/scale the 3D object. */
  applyRemoteSnap3DSpawnPosition(pos: vec3): void {
    if (!this.lastSpawn || !pos) {
      return
    }
    this.lastSpawn.getTransform().setWorldPosition(pos)
  }

  applySyncedWorldTransform(pos: vec3, rot: quat, scale: vec3): void {
    if (!this.lastSpawn) {
      return
    }
    const factory = this.resolveFactory()
    const interactable =
      factory?.findInteractable(this.lastSpawn) ??
      (this.lastSpawn.getComponent(
        Snap3DInteractable.getTypeName(),
      ) as Snap3DInteractable | null)
    if (interactable?.isUserDragging()) {
      return
    }
    const tr = this.lastSpawn.getTransform()
    tr.setWorldPosition(pos)
    tr.setWorldRotation(rot)
    tr.setWorldScale(scale)
    interactable?.syncColliderAfterRemoteTransform()
  }

  /** Called on followers when the leader starts Snap3D (spawn + wait for mesh URL). */
  generateFromSyncedPrompt(prompt: string, displayLabel?: string): void {
    if (!prompt || this.busy) {
      return
    }
    const factory = this.resolveFactory()
    if (!factory) {
      return
    }
    const session = DecorSessionManager.getInstance()
    const spawnPos = session?.getSnap3DSpawnWorldPosition() ?? undefined
    const label =
      displayLabel ??
      session?.getSnap3DDisplayLabel() ??
      Snap3DInteractable.truncateForDisplay(prompt)

    if (this.dismissPreviousOnGenerate) {
      this.dismiss()
    }

    this.busy = true
    this.lastPrompt = prompt
    this.generationSpawnWorldPos = null
    this.setStatus(label)
    factory
      .runSnap3DOnSyncedSpawn(prompt, spawnPos, label)
      .then((spawned) => {
        this.busy = false
        this.lastSpawn = spawned
        this.rememberGenerationSpawnPosition(spawned)
        this.setStatus('3D ready (shared session)')
      })
      .catch((err) => {
        this.busy = false
        const msg = typeof err === 'string' ? err : `${err}`
        this.setStatus(this.formatSnap3DUserHint(msg))
        this.log.e(`Snap3D follower: ${msg}`)
      })
  }

  generateForSuggestion(
    suggestion: DecorSuggestion,
    relatedShop?: DecorShoppingItem | null,
  ): void {
    if (!suggestion || !suggestion.title) {
      this.setStatus('No suggestion on this slide.')
      return
    }

    const factory = this.resolveFactory()
    if (!factory) {
      this.setStatus('Assign Snap3DInteractableFactory (see Snap3DExample).')
      this.log.e('snap3DFactory missing')
      return
    }
    if (this.busy) {
      this.setStatus('3D generation in progress…')
      return
    }

    const prompt = buildSnap3DPromptFromSuggestion(
      suggestion,
      this.styleName,
      this.roomType,
      relatedShop,
    )
    this.lastPrompt = prompt
    this.log.i(`Snap3D [slide "${suggestion.title}"]: ${prompt}`)

    const session = DecorSessionManager.getInstance()
    const displayLabel = this.formatSnap3DDisplayLabel(suggestion)
    if (DecorSessionManager.isSyncActive() && session) {
      session.publishSnap3DDisplayLabel(displayLabel)
      if (!session.onLocalSnap3DRequest(prompt)) {
        return
      }
    }

    if (this.dismissPreviousOnGenerate) {
      this.dismiss()
    }

    this.busy = true
    this.generationSpawnWorldPos = null
    this.setStatus(displayLabel)

    factory
      .createInteractable3DObject(prompt)
      .then((spawned) => {
        this.busy = false
        this.lastSpawn = spawned
        this.rememberGenerationSpawnPosition(spawned)
        this.setStatus(`3D ready: ${suggestion.title}`)
      })
      .catch((err) => {
        this.busy = false
        const msg = typeof err === 'string' ? err : `${err}`
        this.setStatus(this.formatSnap3DUserHint(msg))
        this.log.e(`Snap3D: ${msg}`)
      })
  }

  clearStatus(): void {
    this.statusClearToken += 1
    if (this.statusText) {
      this.statusText.text = ''
      if (this.hideStatusObjectWhenCleared) {
        this.statusText.enabled = false
        const statusObj = this.statusText.getSceneObject()
        if (statusObj) {
          statusObj.enabled = false
        }
      }
    }
  }

  private resolveFactory(): Snap3DInteractableFactory | null {
    if (this.snap3DFactory) {
      return this.snap3DFactory
    }
    const found = this.sceneObject.getComponent(
      Snap3DInteractableFactory.getTypeName(),
    ) as Snap3DInteractableFactory | null
    if (found) {
      this.snap3DFactory = found
    }
    return this.snap3DFactory ?? null
  }

  private setStatus(msg: string): void {
    if (!this.statusText) {
      return
    }
    this.statusText.enabled = true
    const statusObj = this.statusText.getSceneObject()
    if (statusObj) {
      statusObj.enabled = true
    }
    this.statusText.text = msg

    this.statusClearToken += 1
    const token = this.statusClearToken
    const delay = Math.max(0.5, this.statusVisibleSeconds)
    const clear = this.createEvent('DelayedCallbackEvent')
    clear.bind(() => {
      if (token !== this.statusClearToken) {
        return
      }
      this.clearStatus()
    })
    clear.reset(delay)
  }

  /**
   * Snap-hosted APIs verify the Lens + device + token (server returns "ALD verification failed"
   * when that chain fails — not a prompt bug).
   */
  private formatSnap3DDisplayLabel(suggestion: DecorSuggestion): string {
    const detail = (suggestion.detail || suggestion.snap3dPrompt || '').trim()
    if (detail.length > 0) {
      return Snap3DInteractable.truncateForDisplay(detail)
    }
    const title = (suggestion.title || '').trim()
    return title.length > 0 ? title : 'Generating 3D…'
  }

  private formatSnap3DUserHint(raw: string): string {
    const lower = raw.toLowerCase()
    if (lower.indexOf('ald verification') >= 0) {
      return (
        'Snap3D: ALD verification failed — use Spectacles (not Preview), same Snapchat as your ' +
        'RSG token, Snap token in RemoteServiceGatewayCredentials, then Push Lens from Lens Studio.'
      )
    }
    return `3D failed: ${raw}`
  }
}
