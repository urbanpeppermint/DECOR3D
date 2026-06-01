import { Snap3D } from "RemoteServiceGateway.lspkg/HostedSnap/Snap3D";
import { Snap3DInteractable } from "./Snap3DInteractable";
import { Snap3DTypes } from "RemoteServiceGateway.lspkg/HostedSnap/Snap3DTypes";
import { Promisfy } from "RemoteServiceGateway.lspkg/Utils/Promisfy";
import WorldCameraFinderProvider from "SpectaclesInteractionKit.lspkg/Providers/CameraProvider/WorldCameraFinderProvider";
import { DecorMultiplayerController } from "./DecorAI/DecorMultiplayerController";
import { DecorSessionManager } from "./DecorAI/DecorSessionManager";
import { SyncTransform } from "SpectaclesSyncKit.lspkg/Components/SyncTransform";
import NativeLogger from "SpectaclesInteractionKit.lspkg/Utils/NativeLogger";

const INTERNET_MODULE = require("LensStudio:InternetModule") as InternetModule;
const REMOTE_MEDIA_MODULE =
  require("LensStudio:RemoteMediaModule") as RemoteMediaModule;

@component
export class Snap3DInteractableFactory extends BaseScriptComponent {
  @ui.separator
  @ui.group_start("Submit and Get Status Example")
  @input
  @widget(new TextAreaWidget())
  private prompt: string = "A cute dog wearing a hat";
  @input
  private refineMesh: boolean = true;
  @input
  private useVertexColor: boolean = false;
  @ui.group_end
  @input
  runOnTap: boolean = false;

  @input
  snap3DInteractablePrefab: ObjectPrefab;

  private avaliableToRequest: boolean = true;
  private readonly log = new NativeLogger("Snap3DInteractableFactory");
  private wcfmp = WorldCameraFinderProvider.getInstance();

  onAwake() {
    this.createEvent("TapEvent").bind(() => {
      if (!this.runOnTap) {
        return;
      }
      this.createInteractable3DObject(this.prompt);
    });
  }

  /** Call on RESTART so a cancelled or destroyed request does not block the next generate. */
  resetSession(): void {
    this.avaliableToRequest = true
  }

  /** Used by DecorSessionManager to resolve the networked Snap3D prefab. */
  getInteractablePrefab(): ObjectPrefab | null {
    return this.snap3DInteractablePrefab ?? null
  }

  /**
   * Followers: local interactable at the synced pose + leader's GLB URL.
   * Instantiator holders only spawn on the spawner device (Sync Kit), so we never wait for holder:…
   */
  runSnap3DOnSyncedSpawn(
    prompt: string,
    overridePosition?: vec3,
    displayLabel?: string,
  ): Promise<SceneObject> {
    return new Promise((resolve, reject) => {
      const trimmed = (prompt || '').trim()
      if (!trimmed) {
        reject('Snap3D prompt is empty.')
        return
      }
      if (!this.snap3DInteractablePrefab) {
        reject('Assign snap3DInteractablePrefab on Snap3DInteractableFactory.')
        return
      }
      this.avaliableToRequest = false

      const spawnPos =
        overridePosition ?? this.wcfmp.getForwardPosition(80)
      const outputObj = this.snap3DInteractablePrefab.instantiate(this.sceneObject)
      outputObj.name = 'Snap3DInteractable (shared) - ' + trimmed
      outputObj.getTransform().setWorldPosition(spawnPos)
      const placed = this.findInteractable(outputObj)
      placed?.setInitialSpawnWorldPosition(spawnPos)
      this.waitForSharedMeshAndApply(outputObj, trimmed, resolve, reject, displayLabel)
    })
  }

  createInteractable3DObject(
    input: string,
    overridePosition?: vec3
  ): Promise<SceneObject> {
    return new Promise((resolve, reject) => {
      if (!this.avaliableToRequest) {
        reject("Snap3D busy — wait for the current model to finish.");
        return;
      }
      if (!this.snap3DInteractablePrefab) {
        reject("Assign snap3DInteractablePrefab on Snap3DInteractableFactory.");
        return;
      }
      const trimmed = (input || "").trim();
      if (trimmed.length === 0) {
        reject("Snap3D prompt is empty.");
        return;
      }

      this.avaliableToRequest = false;

      const spawnPos =
        overridePosition ?? this.wcfmp.getForwardPosition(80);

      const session = DecorSessionManager.getInstance();
      if (DecorSessionManager.isSyncActive() && session?.isLeader()) {
        session.publishSnap3DSpawnWorldPosition(spawnPos);
        // Leader generates once and shares GLB URLs; Instantiator replicas do not appear on other peers.
        this.spawnLocalInteractable(trimmed, spawnPos, session, resolve, reject);
        return;
      }

      this.spawnLocalInteractable(trimmed, spawnPos, session, resolve, reject);
    });
  }

  private spawnLocalInteractable(
    trimmed: string,
    spawnPos: vec3,
    session: DecorSessionManager | null,
    resolve: (obj: SceneObject) => void,
    reject: (reason: string) => void,
  ): void {
    const outputObj = this.snap3DInteractablePrefab.instantiate(this.sceneObject);
    outputObj.name = "Snap3DInteractable - " + trimmed;
    outputObj.getTransform().setWorldPosition(spawnPos);
    const placed = this.findInteractable(outputObj);
    placed?.setInitialSpawnWorldPosition(spawnPos);
    this.finishSpawn(outputObj, trimmed, resolve, reject);
  }

  private prepareFollowerInteractable(
    outputObj: SceneObject,
    trimmed: string,
    displayLabel?: string,
  ): Snap3DInteractable | null {
    const snap3DInteractable = this.findInteractable(outputObj);
    if (!snap3DInteractable) {
      return null;
    }
    const session = DecorSessionManager.getInstance();
    const label =
      displayLabel ??
      session?.getSnap3DDisplayLabel() ??
      Snap3DInteractable.truncateForDisplay(trimmed);
    snap3DInteractable.setSourcePrompt(trimmed);
    snap3DInteractable.beginGenerating(label);
    if (this.isCeilingMountedItem(trimmed)) {
      snap3DInteractable.setCeilingMount(true);
    } else if (this.isWallMountedItem(trimmed)) {
      snap3DInteractable.setWallMount(true);
    }
    const root = snap3DInteractable.getSceneObject();
    if (DecorSessionManager.isSyncActive()) {
      DecorMultiplayerController.enableSyncOnObject(root);
    }
    return snap3DInteractable;
  }

  private registerSpawnWithSession(outputObj: SceneObject): void {
    if (!DecorSessionManager.isSyncActive()) {
      return;
    }
    DecorMultiplayerController.enableSyncOnObject(outputObj);
  }

  private waitForSharedMeshAndApply(
    outputObj: SceneObject,
    trimmed: string,
    resolve: (obj: SceneObject) => void,
    reject: (reason: string) => void,
    displayLabel?: string,
  ): void {
    const snap3DInteractable = this.prepareFollowerInteractable(
      outputObj,
      trimmed,
      displayLabel,
    );
    if (!snap3DInteractable) {
      this.avaliableToRequest = true;
      outputObj.destroy();
      reject("Snap3DInteractable prefab is missing Snap3DInteractable script.");
      return;
    }
    const session = DecorSessionManager.getInstance();
    const poll = (n: number) => {
      const meshUrl = session?.getSnap3DMeshUrl() ?? null;
      if (meshUrl) {
        const imageUrl = session?.getSnap3DImageUrl() ?? null;
        this.applySharedSnap3DAssets(snap3DInteractable, meshUrl, imageUrl)
          .then(() => {
            snap3DInteractable.setCachedAssetUrls(meshUrl, imageUrl ?? '');
            snap3DInteractable.snapToSurfaceOnce();
            this.registerSpawnWithSession(outputObj);
            session?.applyLatestSyncedSnap3DTransform();
            this.avaliableToRequest = true;
            resolve(outputObj);
          })
          .catch((err) => {
            this.avaliableToRequest = true;
            const msg = typeof err === "string" ? err : `${err}`;
            snap3DInteractable.onFailure(msg);
            reject(msg);
          });
        return;
      }
      if (n >= 480) {
        this.avaliableToRequest = true;
        reject("Timed out waiting for leader Snap3D mesh URL.");
        return;
      }
      const wait = this.createEvent("DelayedCallbackEvent");
      wait.bind(() => poll(n + 1));
      wait.reset(0.25);
    };
    poll(0);
  }

  private finishSpawn(
    outputObj: SceneObject,
    trimmed: string,
    resolve: (obj: SceneObject) => void,
    reject: (reason: string) => void,
  ): void {
    const session = DecorSessionManager.getInstance();
    const displayLabel = session?.getSnap3DDisplayLabel();
    const snap3DInteractable = this.prepareFollowerInteractable(
      outputObj,
      trimmed,
      displayLabel,
    );
    if (!snap3DInteractable) {
      this.avaliableToRequest = true;
      outputObj.destroy();
      reject("Snap3DInteractable prefab is missing Snap3DInteractable script.");
      return;
    }
    snap3DInteractable.snapToSurfaceOnce();
    this.registerSpawnWithSession(outputObj);

    const shareWithSession =
      DecorSessionManager.isSyncActive() && session?.isLeader();
    let sharedImageUrl = "";

    Snap3D.submitAndGetStatus({
      prompt: trimmed,
      format: "glb",
      refine: this.refineMesh,
      use_vertex_color: this.useVertexColor,
    })
      .then((submitGetStatusResults) => {
        submitGetStatusResults.event.add(([value, assetOrError]) => {
          if (value === "image") {
            assetOrError = assetOrError as Snap3DTypes.TextureAssetData;
            snap3DInteractable.setImage(assetOrError.texture);
            sharedImageUrl = assetOrError.url;
          } else if (value === "base_mesh") {
            assetOrError = assetOrError as Snap3DTypes.GltfAssetData;
            if (!this.refineMesh) {
              snap3DInteractable.setModel(assetOrError.gltfAsset, true);
              if (shareWithSession) {
                session.publishSnap3DMeshReady(assetOrError.url, sharedImageUrl);
              }
              snap3DInteractable.setCachedAssetUrls(assetOrError.url, sharedImageUrl);
              this.registerSpawnWithSession(outputObj);
              this.avaliableToRequest = true;
              resolve(outputObj);
            } else {
              snap3DInteractable.setModel(assetOrError.gltfAsset, false);
            }
          } else if (value === "refined_mesh") {
            assetOrError = assetOrError as Snap3DTypes.GltfAssetData;
            snap3DInteractable.setModel(assetOrError.gltfAsset, true);
            if (shareWithSession) {
              session.publishSnap3DMeshReady(assetOrError.url, sharedImageUrl);
            }
            snap3DInteractable.setCachedAssetUrls(assetOrError.url, sharedImageUrl);
            this.registerSpawnWithSession(outputObj);
            this.avaliableToRequest = true;
            resolve(outputObj);
          } else if (value === "failed") {
            assetOrError = assetOrError as Snap3DTypes.ErrorData;
            print("Snap3D Error: " + assetOrError.errorMsg);
            snap3DInteractable.onFailure(assetOrError.errorMsg);
            this.avaliableToRequest = true;
            reject(assetOrError.errorMsg || "Snap3D failed");
          }
        });
      })
      .catch((error) => {
        snap3DInteractable.onFailure(`${error}`);
        print("Error submitting Snap3D: " + error);
        this.avaliableToRequest = true;
        reject(`${error}`);
      });
  }

  /**
   * Place another copy of the finished model at the original generation spawn point
   * (where the loading spinner appeared). Does not call Snap3D again.
   */
  duplicateCompletedModel(
    source: Snap3DInteractable,
    spawnWorldPos: vec3,
  ): Promise<SceneObject> {
    if (!source || !source.isReadyForDuplicate()) {
      return Promise.reject('Generate a 3D model first, then duplicate.')
    }
    const sourceRoot = source.getSceneObject()
    if (!sourceRoot) {
      return Promise.reject('Source Snap3D object is missing.')
    }
    try {
      const copyRoot = this.duplicateByHierarchyCopy(source, sourceRoot, spawnWorldPos)
      this.log.i('Duplicate placed via hierarchy copy')
      return Promise.resolve(copyRoot)
    } catch (e) {
      this.log.w('Hierarchy copy failed, trying mesh URL: ' + e)
      return this.duplicateFromSharedMesh(source, spawnWorldPos)
    }
  }

  /** Deep-clone the finished interactable (mesh + scripts); works in SP and MP. */
  private duplicateByHierarchyCopy(
    source: Snap3DInteractable,
    sourceRoot: SceneObject,
    spawnWorldPos: vec3,
  ): SceneObject {
    const copyRoot = this.sceneObject.copyWholeHierarchy(sourceRoot)
    copyRoot.name = 'Snap3DInteractable (copy)'
    const sourceTr = sourceRoot.getTransform()
    const copyTr = copyRoot.getTransform()
    copyTr.setWorldPosition(spawnWorldPos)
    copyTr.setWorldRotation(sourceTr.getWorldRotation())
    copyTr.setWorldScale(sourceTr.getWorldScale())
    this.disableSyncTransformOnObject(copyRoot)
    const copy = this.findInteractable(copyRoot)
    if (copy) {
      copy.setInitialSpawnWorldPosition(spawnWorldPos)
      source.copyMountSettingsTo(copy)
      copy.markReadyAfterDuplicate()
    }
    return copyRoot
  }

  private duplicateFromSharedMesh(
    source: Snap3DInteractable,
    spawnWorldPos: vec3,
  ): Promise<SceneObject> {
    return new Promise((resolve, reject) => {
      if (!this.snap3DInteractablePrefab) {
        reject('Assign snap3DInteractablePrefab on Snap3DInteractableFactory.')
        return
      }
      const prompt = source.getSourcePrompt()
      if (!prompt) {
        reject('Missing Snap3D prompt on source object.')
        return
      }
      const session = DecorSessionManager.getInstance()
      const meshUrl =
        source.getCachedMeshUrl() ?? session?.getSnap3DMeshUrl() ?? null
      if (!meshUrl) {
        reject('No mesh available to duplicate.')
        return
      }
      const imageUrl =
        source.getCachedImageUrl() ?? session?.getSnap3DImageUrl() ?? null

      const outputObj = this.snap3DInteractablePrefab.instantiate(this.sceneObject)
      outputObj.name = 'Snap3DInteractable (copy)'
      outputObj.getTransform().setWorldPosition(spawnWorldPos)

      const copy = this.findInteractable(outputObj)
      if (!copy) {
        outputObj.destroy()
        reject('Snap3DInteractable prefab is missing Snap3DInteractable script.')
        return
      }
      copy.setSourcePrompt(prompt)
      if (this.isCeilingMountedItem(prompt)) {
        copy.setCeilingMount(true)
      } else if (this.isWallMountedItem(prompt)) {
        copy.setWallMount(true)
      }
      copy.setInitialSpawnWorldPosition(spawnWorldPos)
      source.copyMountSettingsTo(copy)
      copy.hideLoadingUi()

      this.applySharedSnap3DAssets(copy, meshUrl, imageUrl)
        .then(() => {
          copy.setCachedAssetUrls(meshUrl, imageUrl ?? '')
          copy.markReadyAfterDuplicate()
          copy.snapToSurfaceOnce()
          resolve(outputObj)
        })
        .catch((err) => {
          const msg = typeof err === 'string' ? err : `${err}`
          copy.onFailure(msg)
          reject(msg)
        })
    })
  }

  private disableSyncTransformOnObject(root: SceneObject): void {
    try {
      const sync = root.getComponent(
        SyncTransform.getTypeName(),
      ) as SyncTransform | null
      if (sync) {
        sync.enabled = false
      }
    } catch {
      // optional component
    }
  }

  /** Find Snap3DInteractable on prefab root or first child. */
  public findInteractable(root: SceneObject): Snap3DInteractable | null {
    return this.findInteractableInternal(root)
  }

  /** Most recent finished model under this factory (fallback when lastSpawn unset). */
  public findLatestReadyInteractable(): Snap3DInteractable | null {
    let found: Snap3DInteractable | null = null
    const stack: SceneObject[] = [this.sceneObject]
    const typeName = Snap3DInteractable.getTypeName()
    while (stack.length > 0) {
      const node = stack.pop()!
      const direct = node.getComponent(typeName) as Snap3DInteractable | null
      if (direct?.isReadyForDuplicate()) {
        found = direct
      }
      const childCount = node.getChildrenCount()
      for (let i = 0; i < childCount; i++) {
        stack.push(node.getChild(i))
      }
    }
    return found
  }

  /** Apply leader GLB to an existing follower interactable (late URL delivery). */
  applySharedMeshToExisting(
    outputObj: SceneObject,
    meshUrl: string,
    imageUrl: string | null,
  ): Promise<void> {
    const interactable = this.findInteractable(outputObj)
    if (!interactable) {
      return Promise.reject('Snap3DInteractable missing on follower object.')
    }
    return this.applySharedSnap3DAssets(interactable, meshUrl, imageUrl)
  }

  private applySharedSnap3DAssets(
    interactable: Snap3DInteractable,
    meshUrl: string,
    imageUrl: string | null,
  ): Promise<void> {
    const tasks: Promise<void>[] = [];
    if (imageUrl) {
      tasks.push(
        this.loadTextureFromUrl(imageUrl).then((tex) => {
          interactable.setImage(tex);
        }),
      );
    }
    tasks.push(
      this.loadGltfFromUrl(meshUrl).then((gltf) => {
        interactable.setModel(gltf, true);
      }),
    );
    return Promise.all(tasks).then(() => {});
  }

  private loadGltfFromUrl(url: string): Promise<GltfAsset> {
    const request = RemoteServiceHttpRequest.create();
    request.url = url;
    return Promisfy.InternetModule.performHttpRequest(INTERNET_MODULE, request).then(
      (response) =>
        Promisfy.RemoteMediaModule.loadResourceAsGltfAsset(
          REMOTE_MEDIA_MODULE,
          response.asResource(),
        ),
    );
  }

  private loadTextureFromUrl(url: string): Promise<Texture> {
    const request = RemoteServiceHttpRequest.create();
    request.url = url;
    return Promisfy.InternetModule.performHttpRequest(INTERNET_MODULE, request).then(
      (response) =>
        Promisfy.RemoteMediaModule.loadResourceAsImageTexture(
          REMOTE_MEDIA_MODULE,
          response.asResource(),
        ),
    );
  }

  private findInteractableInternal(root: SceneObject): Snap3DInteractable | null {
    const direct = root.getComponent(Snap3DInteractable.getTypeName()) as Snap3DInteractable | null;
    if (direct) {
      return direct;
    }
    if (root.getChildrenCount() > 0) {
      return root.getChild(0).getComponent(Snap3DInteractable.getTypeName()) as Snap3DInteractable | null;
    }
    return null;
  }

  private onTap() {}

  /**
   * Heuristic: does this prompt describe a wall-mounted item (hangs on / fixes
   * to a vertical surface)? Used to flag the Snap3DInteractable for wall snap.
   */
  private isWallMountedItem(prompt: string): boolean {
    return this.matchesAny(prompt, WALL_ITEM_KEYWORDS);
  }

  /**
   * Heuristic: does this prompt describe a ceiling-mounted item (hangs from /
   * fixes to the ceiling)? Checked before the wall test so e.g. "wall hanging"
   * (a wall item) is not mistaken for a hanging ceiling item.
   */
  private isCeilingMountedItem(prompt: string): boolean {
    return this.matchesAny(prompt, CEILING_ITEM_KEYWORDS);
  }

  private matchesAny(prompt: string, keywords: string[]): boolean {
    const text = (prompt || "").toLowerCase();
    for (let i = 0; i < keywords.length; i++) {
      if (text.indexOf(keywords[i]) >= 0) {
        return true;
      }
    }
    return false;
  }
}

/**
 * Items that mount to a vertical surface (wall). Kept broad to cover decoration
 * and light renovation items that can surface in Décor3D suggestions.
 * NOTE: ceiling keywords are tested first (see isCeilingMountedItem) so that
 * "wall hanging" stays a wall item and "hanging plant" goes to the ceiling.
 */
const WALL_ITEM_KEYWORDS: string[] = [
  // Shelving (the reported miss)
  "shelf",
  "shelves",
  "shelving",
  "floating shelf",
  "wall shelf",
  "spice rack",
  "display ledge",
  "picture ledge",
  // Window treatments
  "curtain",
  "drape",
  "drapery",
  "valance",
  "blind",
  "blinds",
  "window shade",
  "roller shade",
  // Art & framed pieces
  "painting",
  "canvas",
  "artwork",
  "wall art",
  "wallart",
  "framed",
  "picture frame",
  "photo frame",
  "gallery frame",
  "poster",
  "art print",
  "wall print",
  "wall hanging",
  "wall decor",
  "wall decoration",
  "wall sculpture",
  "wall plaque",
  "wall panel",
  "wall paneling",
  "wall mural",
  "mural",
  "tapestry",
  "macrame",
  // Mirrors
  "mirror",
  "wall mirror",
  // Wall lighting
  "wall lamp",
  "wall light",
  "wall sconce",
  "sconce",
  "wall lantern",
  "picture light",
  "vanity light",
  // Clocks & boards
  "wall clock",
  "whiteboard",
  "corkboard",
  "cork board",
  "pegboard",
  "peg board",
  "bulletin board",
  "memo board",
  "mood board",
  // Hooks, racks & organizers (wall-mounted)
  "coat rack",
  "coat hook",
  "wall hook",
  "key holder",
  "key rack",
  "towel rack",
  "towel bar",
  "towel ring",
  "robe hook",
  "wall organizer",
  "mail organizer",
  // Wall planters & greenery
  "wall planter",
  "wall vase",
  "vertical garden",
  "living wall",
  "wall mounted",
  "wall-mounted",
  // Surfaces / renovation
  "backsplash",
  "wall tile",
  "wainscoting",
  "wall molding",
  "wallpaper",
  "accent wall",
];

/**
 * Items that mount to or hang from the ceiling. Multi-word "hanging X" entries
 * (not a bare "hanging") so wall items like "wall hanging" are not matched.
 */
const CEILING_ITEM_KEYWORDS: string[] = [
  "hanging plant",
  "hanging planter",
  "hanging basket",
  "hanging light",
  "hanging lamp",
  "hanging lantern",
  "hanging pendant",
  "ceiling lamp",
  "ceiling light",
  "ceiling fan",
  "ceiling fixture",
  "ceiling mounted",
  "ceiling-mounted",
  "ceiling medallion",
  "ceiling rose",
  "flush mount light",
  "flush-mount light",
  "semi-flush",
  "chandelier",
  "pendant light",
  "pendant lamp",
  "pendant lighting",
  "track light",
  "track lighting",
  "suspended light",
  "suspended lamp",
  "skylight",
];
