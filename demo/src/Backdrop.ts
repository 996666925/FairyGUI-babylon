import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera.js';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight.js';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder.js';
import { CreateGround } from '@babylonjs/core/Meshes/Builders/groundBuilder.js';
import type { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import type { Scene } from '@babylonjs/core/scene.js';

/**
 * A small 3D scene for the UI to sit over.
 *
 * This is not decoration. It is the evidence for the backend's central claim:
 * that the UI gets its own orthographic camera on its own layer, so it neither
 * disturbs the host's camera nor is disturbed by it. Orbiting this scene with
 * the mouse should leave the UI perfectly still, and toggling the UI off should
 * leave the scene untouched.
 */
export class Backdrop {
    public readonly camera: ArcRotateCamera;
    private readonly _meshes: Mesh[] = [];
    private readonly _spinners: Mesh[] = [];
    private _visible = true;

    public constructor(scene: Scene, canvas: HTMLCanvasElement) {
        scene.clearColor = new Color4(0.07, 0.08, 0.1, 1);

        this.camera = new ArcRotateCamera('host-camera', 1, 1.1, 14, Vector3.Zero(), scene);
        this.camera.wheelDeltaPercentage = 0.02;
        this.camera.lowerRadiusLimit = 6;
        this.camera.upperRadiusLimit = 32;
        this.camera.attachControl(canvas, true);

        const key = new DirectionalLight('key', new Vector3(-1, -2, 1), scene);
        key.intensity = 1.1;
        const fill = new HemisphericLight('fill', new Vector3(0, 1, 0), scene);
        fill.intensity = 0.45;
        fill.diffuse = new Color3(0.6, 0.7, 1);

        const ground = CreateGround('ground', { width: 30, height: 30 }, scene);
        ground.material = material(scene, 'ground-mat', new Color3(0.13, 0.15, 0.19));
        ground.position.y = -3;
        this._meshes.push(ground);

        // A ring of boxes turning at different rates: movement is what makes a
        // camera or layer mix-up obvious at a glance.
        const palette = [
            new Color3(0.35, 0.62, 1), new Color3(0.42, 0.85, 0.66),
            new Color3(0.95, 0.68, 0.36), new Color3(0.85, 0.46, 0.72),
        ];
        for (let i = 0; i < 8; i++) {
            const angle = (i / 8) * Math.PI * 2;
            const box = CreateBox(`box-${i}`, { size: 1.4 }, scene);
            box.position = new Vector3(Math.cos(angle) * 6, -1.6 + (i % 3) * 1.1, Math.sin(angle) * 6);
            box.material = material(scene, `box-mat-${i}`, palette[i % palette.length]);
            this._meshes.push(box);
            this._spinners.push(box);
        }
    }

    /** Advances the animation. `dt` is in seconds. */
    public update(dt: number): void {
        if (!this._visible)
            return;
        for (let i = 0; i < this._spinners.length; i++) {
            const box = this._spinners[i];
            box.rotation.y += dt * (0.25 + i * 0.05);
            box.rotation.x += dt * 0.12;
        }
    }

    public get visible(): boolean {
        return this._visible;
    }

    /** Hides the 3D content without touching the UI or the UI camera. */
    public set visible(value: boolean) {
        this._visible = value;
        for (const mesh of this._meshes)
            mesh.setEnabled(value);
    }
}

function material(scene: Scene, name: string, diffuse: Color3): StandardMaterial {
    const mat = new StandardMaterial(name, scene);
    mat.diffuseColor = diffuse;
    mat.specularColor = new Color3(0.12, 0.12, 0.14);
    return mat;
}
