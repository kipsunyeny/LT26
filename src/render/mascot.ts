// Talilei: a cylindrical billboard (upright, turns about y towards the camera) of the brand art (back view).
// The art has a ball drawn at his feet; it is erased at load time because the real 3D ball is drawn beside him.
import * as THREE from 'three';
import type { Vec3 } from '../contracts';
import { makeCanvas } from './geom';

export const TALILEI_HEIGHT = 1.75;
const ART_W = 768;
const ART_H = 1024;

const artUrl = new URL('../../assets/brand/talilei-1024.webp', import.meta.url).href;

/**
 * Copies the art to a canvas and erases the drawn ball (right of his left leg, between the boots).
 * Coordinates are for the 768×1024 art and scale with the image size.
 */
export function processTalileiImage(img: CanvasImageSource, w: number, h: number): HTMLCanvasElement {
  const { canvas, ctx } = makeCanvas(w, h);
  ctx.drawImage(img, 0, 0, w, h);
  const k = w / ART_W;
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  // Region to the right of the left leg's outer edge (traced from the art).
  ctx.beginPath();
  ctx.moveTo(302 * k, 830 * k);
  ctx.lineTo(300 * k, 838 * k);
  ctx.lineTo(286 * k, 860 * k);
  ctx.lineTo(278 * k, 880 * k);
  ctx.lineTo(271 * k, 900 * k);
  ctx.lineTo(266 * k, 915 * k);
  ctx.lineTo(265 * k, 940 * k);
  ctx.lineTo(266 * k, 960 * k);
  ctx.lineTo(265 * k, h);
  ctx.lineTo(440 * k, h);
  ctx.lineTo(440 * k, 830 * k);
  ctx.closePath();
  ctx.clip();
  ctx.beginPath();
  ctx.arc(302 * k, 919 * k, 82 * k, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  return canvas;
}

export class TalileiView {
  readonly mesh: THREE.Mesh;
  readonly ready: Promise<void>;
  private readonly material: THREE.MeshBasicMaterial;
  private disposed = false;

  constructor() {
    const width = (TALILEI_HEIGHT * ART_W) / ART_H;
    const g = new THREE.PlaneGeometry(width, TALILEI_HEIGHT);
    g.translate(0, TALILEI_HEIGHT / 2, 0);
    this.material = new THREE.MeshBasicMaterial({ transparent: true, alphaTest: 0.08, color: 0xf2f2f2 });
    this.mesh = new THREE.Mesh(g, this.material);
    this.mesh.name = 'talilei';
    this.mesh.visible = false;
    this.mesh.renderOrder = 3;
    this.ready = this.load();
  }

  private load(): Promise<void> {
    return new Promise<void>((resolve) => {
      if (typeof Image === 'undefined') {
        resolve();
        return;
      }
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => {
        if (!this.disposed) {
          try {
            const canvas = processTalileiImage(img, img.naturalWidth || ART_W, img.naturalHeight || ART_H);
            const tex = new THREE.CanvasTexture(canvas);
            tex.colorSpace = THREE.SRGBColorSpace;
            tex.anisotropy = 4;
            this.material.map = tex;
            this.material.needsUpdate = true;
          } catch (err) {
            console.warn('Talilei art could not be processed', err);
          }
        }
        resolve();
      };
      img.onerror = () => {
        console.warn('Talilei art failed to load');
        resolve();
      };
      img.src = artUrl;
    });
  }

  /** Feet at p; turns about y to face the camera; a small bob while running (0 < stride < 1). */
  update(p: Vec3, stride: number, camera: THREE.Vector3, show: boolean): void {
    this.mesh.visible = show && this.material.map !== null;
    if (!this.mesh.visible) return;
    const running = stride > 0.001 && stride < 0.999;
    const bob = running ? 0.04 * Math.abs(Math.sin(stride * Math.PI * 6)) : 0;
    this.mesh.position.set(p.x, p.y + bob, p.z);
    this.mesh.rotation.set(0, Math.atan2(camera.x - p.x, camera.z - p.z), 0);
  }

  dispose(): void {
    this.disposed = true;
    this.mesh.geometry.dispose();
    this.material.map?.dispose();
    this.material.dispose();
  }
}
