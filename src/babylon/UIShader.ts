import { Constants } from '@babylonjs/core/Engines/constants.js';
import { Effect } from '@babylonjs/core/Materials/effect.js';
import { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial.js';
import type { BaseTexture } from '@babylonjs/core/Materials/Textures/baseTexture.js';
import { RawTexture } from '@babylonjs/core/Materials/Textures/rawTexture.js';
import type { Scene } from '@babylonjs/core/scene.js';
import { BlendMode } from '../core/FieldTypes.js';
import { MAX_CLIP_RECTS } from './ClipRects.js';

/** Name of the shared vertex/fragment pair in `Effect.ShadersStore`. */
const SHADER_NAME = 'fguiUI';

/**
 * Vertex stage.
 *
 * Besides the usual transform it exports two things the fragment stage needs:
 * the raw UV and a **UI-space** position. The latter is `uRootInverse * world`,
 * i.e. the root node's flip undone, so clip rects — which are expressed in
 * FairyGUI's y-down space — can be tested without ever teaching the CPU about
 * Babylon's y-up world.
 */
const VERTEX_SHADER = `
precision highp float;

attribute vec3 position;
attribute vec2 uv;
attribute vec4 color;

uniform mat4 world;
uniform mat4 worldViewProjection;
uniform mat4 uRootInverse;

varying vec2 vUV;
varying vec4 vColor;
varying vec2 vUI;

void main() {
    vec4 worldPos = world * vec4(position, 1.0);
    vUI = (uRootInverse * worldPos).xy;
    vUV = uv;
    vColor = color;
    gl_Position = worldViewProjection * vec4(position, 1.0);
}
`;

/**
 * Fragment stage.
 *
 * Clipping is per-fragment against up to {@link MAX_CLIP_RECTS} rects, each with
 * its own UI-space-to-clip-local matrix: a fragment survives only if it is inside
 * *every* active rect. A single scissor cannot express this, because a clip can
 * be under rotation and rects need not nest in a common axis-aligned space.
 *
 * All four slots are tested unconditionally. Unused slots are filled with the
 * identity matrix and an unbounded rect (see `ClipStack.writeUniforms`), so the
 * loop has a constant bound and needs no `break` — both of which keep the shader
 * inside the subset GLSL ES 1.0 guarantees.
 */
const FRAGMENT_SHADER = `
precision highp float;

varying vec2 vUV;
varying vec4 vColor;
varying vec2 vUI;

uniform sampler2D uTexture;
uniform vec4 uTint;
uniform float uGrayed;
uniform vec4 uClipRect[${MAX_CLIP_RECTS}];
uniform vec4 uClipRow0[${MAX_CLIP_RECTS}];
uniform vec4 uClipRow1[${MAX_CLIP_RECTS}];

void main() {
    for (int i = 0; i < ${MAX_CLIP_RECTS}; i++) {
        vec4 r = uClipRect[i];
        vec4 r0 = uClipRow0[i];
        vec4 r1 = uClipRow1[i];
        vec2 p = vec2(r0.x * vUI.x + r0.y * vUI.y + r0.z,
                      r1.x * vUI.x + r1.y * vUI.y + r1.z);
        float inside = step(r.x, p.x) * step(r.y, p.y) * step(p.x, r.z) * step(p.y, r.w);
        if (inside < 0.5) {
            discard;
        }
    }

    vec4 c = texture2D(uTexture, vUV) * uTint * vColor;
    float luma = dot(c.rgb, vec3(0.299, 0.587, 0.114));
    c.rgb = mix(c.rgb, vec3(luma), uGrayed);
    if (c.a < 0.004) {
        discard;
    }
    gl_FragColor = c;
}
`;

let shadersRegistered = false;

/** Publishes the shader pair into `Effect.ShadersStore` exactly once. */
export function registerUIShaders(): void {
    if (shadersRegistered)
        return;
    Effect.ShadersStore[SHADER_NAME + 'VertexShader'] = VERTEX_SHADER;
    Effect.ShadersStore[SHADER_NAME + 'FragmentShader'] = FRAGMENT_SHADER;
    shadersRegistered = true;
}

/** The uniform names the shader declares, as `ShaderMaterial` needs them. */
export const UI_UNIFORMS = [
    'world',
    'worldViewProjection',
    'uRootInverse',
    'uTint',
    'uGrayed',
    'uClipRect',
    'uClipRow0',
    'uClipRow1',
] as const;

/** The vertex attribute names the shader declares. */
export const UI_ATTRIBUTES = ['position', 'uv', 'color'] as const;

/** Maps a FairyGUI blend mode onto Babylon's fixed-function blend state. */
export function alphaModeFor(mode: BlendMode): number {
    switch (mode) {
        case BlendMode.Add:
        case BlendMode.One_One:
            return Constants.ALPHA_ADD;
        case BlendMode.Multiply:
            return Constants.ALPHA_MULTIPLY;
        case BlendMode.Screen:
            return Constants.ALPHA_SCREENMODE;
        case BlendMode.Erase:
            // "Erase" wants dst *= (1 - src.a); Babylon has no exact match, so
            // this falls back to `ONE_ONE` and over-brightens rather than
            // punching a hole. A real implementation needs a stencil pass.
            return Constants.ALPHA_ONEONE;
        case BlendMode.Mask:
        case BlendMode.Below:
        case BlendMode.Custom1:
        case BlendMode.Custom2:
        case BlendMode.Custom3:
            // These need stencil or a second render target; the shader stays
            // correct, only the compositing is plain.
            return Constants.ALPHA_COMBINE;
        default:
            // Normal, None, Off: "None"/"Off" mean "no blending" in FairyGUI,
            // which for a UI overlay that always has transparency is
            // indistinguishable from normal blending in practice.
            return Constants.ALPHA_COMBINE;
    }
}

/** Builds one `ShaderMaterial` for a blend mode. */
export function createUIMaterial(scene: Scene, name: string, mode: BlendMode): ShaderMaterial {
    registerUIShaders();
    const material = new ShaderMaterial(name, scene, SHADER_NAME, {
        attributes: [...UI_ATTRIBUTES],
        uniforms: [...UI_UNIFORMS],
        samplers: ['uTexture'],
        needAlphaBlending: true,
    });
    material.alphaMode = alphaModeFor(mode);
    // The UI root carries a negative determinant, so every triangle it holds is
    // mirrored. Geometry is emitted with the winding restored (see
    // `GeometryBuilder`), but nothing here is lit or depth-tested, so culling is
    // turned off as well: a future change to the root cannot silently blank the
    // whole interface.
    material.backFaceCulling = false;
    // Every UI mesh sits on z = 0; writing depth would let whichever drew first
    // occlude the rest, so ordering comes from `alphaIndex` instead. The depth
    // *test* is disabled too: the UI camera shares the host's depth buffer
    // (`autoClear` is off) and the two projections are not comparable, so any
    // comparison could punch holes in the overlay.
    material.disableDepthWrite = true;
    material.depthFunction = Constants.ALWAYS;
    return material;
}

/**
 * A 1×1 opaque white texture, used as the sampler for objects that carry no
 * texture of their own (a solid-fill `GGraph`), so the shader always has
 * something bound.
 */
export function createWhiteTexture(scene: Scene): BaseTexture {
    const texture = new RawTexture(
        new Uint8Array([255, 255, 255, 255]),
        1, 1,
        Constants.TEXTUREFORMAT_RGBA,
        scene,
        false,
        false,
    );
    texture.wrapU = Constants.TEXTURE_CLAMP_ADDRESSMODE;
    texture.wrapV = Constants.TEXTURE_CLAMP_ADDRESSMODE;
    return texture;
}
