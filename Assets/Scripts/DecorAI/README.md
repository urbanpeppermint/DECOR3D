# Décor3D — Lens module (DecorAI folder)

**Décor3D** orchestrates **RSG** (Gemini `models()`, Imagen, OpenAI TTS, Snap3D) plus **Spatial Image**, **World Query**, **SIK**, **Spectacles Sync Kit**, and the **Camera Module** from this folder.

**Flow:** **style → optional repurpose → scan → capture → makeover → suggestions → Generate 3D → place (floor / wall / ceiling) → duplicate → optional colocated multiplayer.**

The `DecorAI` folder name is unchanged for Lens Studio wiring; the public name is **Décor3D**.

**Notes:** Gemini reads the captured photo and writes the prompts; Imagen renders the makeover from those prompts (text-based, so it follows the room’s layout and style). Spatial Image depth renders on Spectacles hardware. Suggestions carry where-to-buy hints rather than live shop links. Snap3D placement classifies the prompt (rug vs painting vs pendant) before World Query picks ray direction and orientation.

---

## What we pushed (innovation highlights)

| Area | What’s different |
|---|---|
| **Colocated co-design** | **Connected Lens** + one `DecorSessionManager` SyncEntity (ASHA / Tic Tac Toe pattern). Peers mirror UI phase, style, analysis, and Snap3D triggers. |
| **Leader-only heavy APIs** | Only the session leader runs camera capture, Gemini, Imagen, and **one** Snap3D job — followers don’t burn duplicate generative credits or get mismatched models. |
| **Same 3D on every device** | Leader publishes the Snap3D **GLB URL**; followers instantiate locally and download that mesh (not a second Snap3D call per peer). |
| **Shared placement** | `SyncTransform` (custom network id) + session-backed world transform while dragging — **last interaction wins** for all peers. |
| **Synced loading UX** | When the leader hits **Generate 3D**, followers immediately see the **spinner + label** at the synced spawn pose, then the shared mesh when ready. |
| **Prompt-aware surfaces** | Keyword heuristics choose floor vs wall vs ceiling snap (8 horizontal wall rays, up for ceiling, down for floor) before generic hit-test placement. |
| **Duplicate 3D** | After generation, **Duplicate 3D** deep-clones the finished interactable at the **original spawn point** (spinner location) without another Snap3D request. |
| **Voice layer** | `DecorVoiceAssistant` + `DecorGeminiVoice` — ASR, `Gemini.models()`, OpenAI TTS. |
| **Single-player default** | Multiplayer is opt-in via toggle; local play never writes session sync. |

---

## Pipeline at a glance

```
StylePickerController ──onStyleSelected──▶ DecorController
                                                 │
                    ┌────────────────────────────┼────────────────────────────┐
                    │ two-step: Scan → live preview; Capture → shutter       │
                    ▼                                                        │
             RoomScanner ──onRoomCaptured(base64Jpeg)──▶ RoomAnalyzer (Gemini)
                                                        │
                    ┌──────────────────────────────────┼──────────────────────┐
                    ▼                                  ▼                      │
        MakeoverVisualizer (Imagen)          DecorTtsNarrator (OpenAI.speech)  │
```

---

## Required packages (Asset Library → Spectacles)

| Package | Why | Notes |
|---|---|---|
| **Remote Service Gateway** | Gemini.models / Imagen / OpenAI.speech | Already installed in this project |
| **Spectacles Interaction Kit (SIK)** | `BaseScriptComponent`, `animate`, `NativeLogger`, `Event` | Already installed |
| **Spectacles UI Kit** | `BaseButton` for style + scan + capture buttons | Already installed |
| **Spatial Image** | Server-side depth estimation for the makeover plane | **You must install this** — `Asset Library → Spectacles → Spatial Image` |
| **Camera Module** | Required for `RoomScanner` (already a built-in module) | Auto-available |

> If `Spatial Image` is not installed, `MakeoverVisualizer` automatically falls
> back to a flat `previewPlane` so editor testing still works.

---

## RSG credentials

`Window → Remote Service Gateway Token`. Generate both:

- **Google Token** — used by `Gemini.models()` and `Imagen.generateImage()`
- **OpenAI Token** — used by `OpenAI.speech()` for the TTS narration

Paste both into the `RemoteServiceGatewayCredentials` component on the scene
credentials object.

---

## Scene hierarchy (pre-built in `Assets/Scene.scene`)

The default scene is already patched:

- **`DecorAI`** root object (Décor3D) is **enabled** with `DecorController` and module
  scripts wired (style buttons, scan button, preview `Image`, `RoomScanner`
  preview hook).

- **`DecorAI_MakeoverPreview`** starts **disabled** in the patched scene so no
  blank plane shows until the camera preview or Imagen result enables it.
- **Two-step capture** — `DecorAI_ScanRoom` opens the **live** camera on the
  preview plane; `DecorAI_CaptureRoom` (hidden until then) takes the JPEG.
  Set `DecorController.twoStepRoomCapture` to **false** and leave capture UI
  empty to return to one-tap scan.

To re-apply the base patch:

`python3 Tools/patch_decor_scene.py`

If your scene predates the extra styles + capture row, run once:

`python3 Tools/append_decor_scene_extras.py`

### SIK scroll (Rocket / sample) — prefab rows + `ScrollView` + `ScrollBar` siblings

Use this when you want **masking + SIK thumb sync** like the official scroll example.

**Hierarchy (same rule as SIK: `ScrollBar` looks for `ScrollView` on a sibling):**

```
DecorAI_StylePicker (Décor3D)
├── ScrollBar                 ← SIK ScrollBar script ON; sibling of viewport owner below
├── ScrollBarSlider
└── StylePickerMenuShell      ← assign as StylePickerController.pickerRoot (hide target)
    └── StyleScrollView       ← SIK ScrollView + viewport ScreenTransform on this object
        └── StyleScrollContent   ← ScreenTransform on content; scrolling/mask region
            └── PickerRoot (optional) OR place prefab rows directly here
                ├── StyleRowPrefab (instance)   ← order must match STYLES[]
                ├── StyleRowPrefab (instance)
                └── …
```

**Inspector (`StylePickerController`):**

1. **Style button binding mode** → **Scroll list (row children = styles in order)**.
2. **Scroll style rows parent** → the object whose **direct children** are the row prefabs
   (usually `StyleScrollContent`, or `PickerRoot` if that is the only child of content).
3. **World space rows** → **off** (enables `ScreenTransform` row bands + `offsets.setCenter`).
4. Tune **Scroll item Y start / step**, **Row width / height** on **StylePickerController** (when **StylePickerScrollContentCreator → Sync layout from controller** is on). Do not rely on Creator **y Start** alone — Controller values are the source of truth.
5. **ScrollView viewport height** (cyan mask): edit **ScrollView** (not ScrollViewContent) **Screen Transform → Offset top/bottom**. Scripts do not change that object.
6. **Content padding / first-row offset**: Creator **Content padding top**, or Controller **Scroll item Y start**. Keep **Snap content top on refresh** **off** (default) or `yStart` looks ignored.
7. On **`StylePickerMenuShell`**: **disable** `StylePickerListScroll` (thumb-only mover; conflicts with SIK).
8. **Enable** SIK **`ScrollBar`** on the track object; **ScrollView** `isSynced` = true if the sample uses it.

**Prefab rows from catalog (no manual row objects):** leave `scrollStyleRowsParent` **empty** in the hierarchy (0 children), set **Style row prefab** to your row `ObjectPrefab`, and keep **Scroll list** mode. On lens start, `StylePickerController` instantiates `STYLES.length` copies and names them `StyleRow_<id>`. **Rebuild prefab rows on start** clears all children of that parent first (use when replacing an old hand-built list). Row labels: **first** `Text` found depth-first on each row = **display name**, **second** = **blurb** (optional).

**Repo scene defaults:** `PickerRoot` is the empty scroll parent (with point-anchor **ScreenTransform** for SIK). The previous ten hand-placed buttons live under **`LegacyHandPlacedStyleButtons`** (disabled) so you can delete that folder later. **`styleRowPrefab`** points at **`Assets/Btn_Scandinavian.prefab`** — duplicate/rename that asset in Lens Studio if you want a neutral `StyleRow` prefab without Canvas on the row root (Canvas can fight SIK scroll; remove Canvas from the row prefab if masking misbehaves).

**Each row prefab:** root needs **ScreenTransform** (anchors **0,0,0,0** on the row root). Text/background children may use full-bleed (-1..1) — the creator converts them to a **centered band** inside the row (do not use the old asymmetric `layoutRowVisuals` insets). For long names (e.g. Mid-Century Modern), raise **Scroll row width** on the controller (try **36–40**). Put `BaseButton` / label under that root (depth ≤ 4 for auto-bind).

**Ghosted text above the panel:** keep **titles and chrome outside** the ScrollView content tree, or only scrolling rows live under `StyleScrollContent`; otherwise labels scroll with the list and look like “leaks” above the header.

### World-space + thumb scroll (no SIK `ScrollView`) — legacy / optional

1. **`StylePickerController`:** `useWorldSpaceRows` **on**, `scrollStyleRowsParent` → **`PickerRoot`** (not `ScrollViewContent`), `styleRowPrefab` = your row prefab (holder with `Btn_*` children is OK — script flattens one level).
2. Rows stack with **Transform** local Y only (row root does **not** need `ScreenTransform` in this mode).
3. **`StylePickerListScroll`:** `listRoot` = `PickerRoot`, `scrollThumb` = `ScrollBarSlider`.
4. **Disable in the scene (required):** SIK **`ScrollBar`** on the track **and** SIK **`ScrollView`** on `ScrollView` — they register drag handlers in `onAwake`; re-enabling them causes `scrollPercentage` / `convertLocalUnitsToParentUnits` errors and a locked thumb.
5. **Enable** an **`Interactable`** on **`ScrollBarSlider`** (`enableInstantDrag` on). Drag the **slider**, not the track.
6. Re-apply after Lens Studio edits: `python3 Tools/fix_world_space_style_scroll.py`

### Legacy note: explicit per-style slots

You can still assign each `*Button` in **Explicit** mode; no prefab list order required.

### What you still wire by hand

1. **Spatial Image** — Install from Asset Library, place the prefab under
   `DecorAI`, drag its **SpatialImageFrame** (or `SikSpatialImageFrame`) script
   into `MakeoverVisualizer.spatialImageFrame` on `DecorAI_MakeoverVisualizer`.
2. **Optional UI text** — Create `Text` objects for status / suggestions /
   style label and assign them on `DecorController` if you want on-screen copy
   (scene leaves them unassigned).
3. **Loading spinners** — Optional `SceneObject` refs on scanner / analyzer /
   visualizer / TTS.

```
DecorAI
├── DecorAI_StylePicker (Décor3D)         (StylePickerController + optional ContainerFrame)
│   ├── ScrollBar / ScrollBarSlider   ← SIK: siblings of shell that owns ScrollView
│   └── StylePickerMenuShell    (pickerRoot — scales away after pick)
│       └── … ScrollView → Content → row prefabs (SIK) OR PickerRoot rows (world-space)
├── DecorAI_ScanRoom            → `scanRoomRoot` / `scanRoomButton` (opens live view)
├── DecorAI_CaptureRoom         → `captureRoomRoot` / `captureRoomButton` (two-step shutter)
├── DecorAI_RoomScanner         (previewImage → MakeoverPreview Image)
...
└── DecorAI_MakeoverPreview     (starts disabled; live preview + Imagen fallback)
```

---

## Step-by-step wiring (Lens Studio editor)

1. **Open** `Assets/Scene.scene` in Lens Studio 5.15+. The **Décor3D** (`DecorAI`) hierarchy should be wired in the editor.
2. **Add** the **Spatial Image** package from Asset Library if needed. Place the
   prefab under **DecorAI**, then drag its frame **ScriptComponent** into
   **DecorAI_MakeoverVisualizer** → `spatialImageFrame`.
3. **Optional** — Add `Text` objects for status / suggestions / style label and
   assign them on **DecorAI** → `DecorController` for on-screen copy.
4. **Test** — Preview with device override **Spectacles (2024)**. Pick a style,
   pinch **Scan room** (live view appears), then pinch **Capture** when the
   frame looks right.

### Style blurbs (`*Blurb` Text inputs)

If you assign the optional **blurb** `Text` objects on `StylePickerController`,
we copy the catalog’s one-line description **once at start** — they act as
**static subtitles** next to the button title, **not** hover tooltips. Hover
behaviour would require separate SIK wiring.

### How close can Imagen be to the real room?

**Gemini** sees the JPEG; **Imagen** gets structured text (`makeoverPrompt`,
layout-lock, optional `targetPurpose`). Results are layout-aware, not
pixel-perfect. Closer visual match needs image-conditioned / edit models
(roadmap).

### Suggestions panel + Snap3D

`RoomAnalysis.suggestions` are decor ideas with **where-to-buy-style hints**
from Gemini.

- **Generate 3D** — leader runs Snap3D once in MP; mesh URL is shared.
- **Duplicate 3D** — copies the finished model to the original generation anchor (hierarchy clone; no second API call).
- **Manipulate** — pinch move / rotate / scale; surfaces re-snap on release when enabled.

Live retail URLs and in-lens checkout are roadmap items.

### Colocated multiplayer

1. Enable **Multiplayer** on `DecorMultiplayerController` (under Décor3D hierarchy).
2. `SessionController` maps the space; share Snapcode with a second Spectacles user.
3. First meaningful action claims **session leader** (`DecorSessionManager`).
4. Leader drives scan, analysis, makeover, and Snap3D; follower UI follows via synced storage properties.
5. Move or scale a placed Snap3D object — peers see updates in near real time.

**Scene:** `DecorSessionManager` on `DecorAI_controller` — wire `decorController`, optional ColocatedWorld `Instantiator`, and `snap3dPrefab` (same as `Snap3DInteractableFactory` prefab). Disable Sync Kit sample spawns (`InstantiatorExample*`) in the scene if ghost logos appear.

**Inspector:** `DecorShoppingPanel` → `generate3dButton`, `duplicate3dButton`, `snap3dGenerator`.

> Spatial Image depth is computed server-side and **only renders on physical
> Spectacles hardware**. In Preview you will see the flat fallback texture.

---

## Files

| File | Responsibility |
|---|---|
| `DecorTypes.ts` | Shared TS types: `DecorStyleId`, `RoomAnalysis`, `DecorRunState`. |
| `DecorStyleCatalog.ts` | Ten styles + prompt text for Gemini / Imagen / TTS. |
| `StylePickerController.ts` | Style grid; emits `onStyleSelected`. |
| `RoomScanner.ts` | Live preview + `Base64.encodeTextureAsync` → JPEG base64. |
| `RoomAnalyzer.ts` | `Gemini.models()` with image part → structured JSON. |
| `MakeoverVisualizer.ts` | `Imagen.generateImage()` (optional `imagenEnhancePrompt`) → texture → spatial frame. |
| `DecorTtsNarrator.ts` | `OpenAI.speech()` → `AudioTrackAsset` → `AudioComponent.play()`. |
| `DecorController.ts` | Root orchestrator. Wires all modules. Holds `DecorRunState`. |
| `DecorSessionManager.ts` | **One SyncEntity** for MP: phase, leader, analysis JSON, Snap3D prompt/mesh/position/transform. |
| `DecorMultiplayerController.ts` | MP toggle, `SessionController.init`, enables `SyncTransform` on spawned Snap3D. |
| `DecorSnap3DGenerator.ts` | Per-slide Generate 3D, session gates, duplicate-at-spawn. |
| `DecorShoppingPanel.ts` | Suggestion carousel; **Generate 3D** + **Duplicate 3D** buttons. |
| `DecorGeminiVoice.ts` | Voice turns via `Gemini.models()` + Snap3D tool (RSG sync). |
| `DecorVoiceAssistant.ts` | Mic toggle, ASR, wires `DecorGeminiVoice` + Snap3D factory. |
| `Snap3DInteractable.ts` | Surface snap (floor/wall/ceiling), drag sync hooks, mesh cache for duplicate. |
| `Snap3DInteractableFactory.ts` | Snap3D submit, shared GLB load for followers, `duplicateCompletedModel()`. |

---

## What the AI sees

The Gemini Vision prompt asks for this exact JSON shape:

```json
{
  "roomSummary": "string",
  "dominantColors": ["string", "..."],
  "suggestions": [
    { "title": "string", "detail": "string", "priority": "high|medium|low" }
  ],
  "makeoverPrompt": "Imagen-ready paragraph, preserves layout"
}
```

The `makeoverPrompt` is combined with the style suffix, a **layout-lock**
preamble, and `roomSummary` for Imagen. **Imagen does not see the raw photo** in
this phase — only Gemini does — so prompts emphasize preserving openings and
perspective, but are not a guarantee of pixel-accurate architecture.

---

## Common errors

| Symptom | Cause | Fix |
|---|---|---|
| `Imagen API token not configured` | No Google token on the Credentials component | Generate Google token via `Window → Remote Service Gateway Token` |
| `OpenAI.speech failed: ...401` | No OpenAI token on the Credentials component | Same window — add OpenAI token too |
| Makeover renders flat in Preview | Spatial depth is server-side only | Deploy to a Spectacles device |
| Status: `Gemini returned no text` | Safety block on the photo | Re-scan with better lighting; check `Logger` for `promptFeedback` |
| `BaseButton onTriggerUp not firing` | Button hand-bound before SIK is ready | We bind via `onInitialized.add(() => onTriggerUp.add(...))` — make sure the SIK prefab is in the scene root |
| `ALD verification failed` (Snap3D) | Remote Service Gateway could not verify this Lens + device + **Snap** token | On device: Spectacles logged into the **same** Snapchat account used in **Window → Remote Service Gateway Token**. Paste the **Snap** token (not Google/OpenAI) into `RemoteServiceGatewayCredentials`. **Push** the Lens from Lens Studio to glasses; Snap3D is [Spectacles-only](https://developers.snap.com/spectacles/about-spectacles-features/apis/remoteservice-gateway). If it persists, revoke and regenerate the Snap token. |

---

## Roadmap

- Shop URLs on suggestion slides (structured hints today).
- Retail / WebView when a non-blocked browser flow is available.
- Tap-on-makeover region → crop → dedicated Snap3D prompt.
- Per-duplicate network ids if copies should sync independently in MP.
- Optional: follower-triggered Snap3D with leader approval.
