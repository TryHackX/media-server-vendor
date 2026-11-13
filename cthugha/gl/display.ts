/**
 * glcthugha's display, ported line by line from Cthugha-L 1.4: GL_display.cc (the seventeen
 * "display" entries and their camera), GL_Light.cc (light), GL_Background.cc (background),
 * GL_Fly.cc (fly), CthughaDisplayGL.cc (the order they are drawn in), the joystick.cc motion it
 * fell back on without a joystick, and DisplayDeviceGL.cc's text. GLU's sphere and cylinder are
 * tessellated as the GLU of Mesa 3 did it. Cthugha (c) Kevin "Zaph" Burfitt, Torps Productions;
 * Cthugha-L (c) 1995-97 Harald Deischinger. Non-commercial use only, with credit
 * (COPYING-cthugha-L.txt).
 */

import { GlEmulator, lookAt, ortho, perspective, type Texture } from "./emulator";
import { MONO_ROMAN, STROKE_DESCENT, STROKE_HEIGHT, STROKE_WIDTH } from "./stroke-font";

/** A display's kind: an object the camera circles, or a plane the camera looks along. */
type ScreenType = "object" | "plane";

/** _screens[] of GL_display.cc: name, description, kind, the buffers it shows. */
export const GL_SCREENS: readonly { name: string; desc: string; type: ScreenType; buffers: number }[] = [
  { name: "Plate", desc: "Plate", type: "object", buffers: 1 },
  { name: "2Plates", desc: "", type: "object", buffers: 2 },
  { name: "Plane", desc: "", type: "plane", buffers: 1 },
  { name: "dPlane", desc: "", type: "plane", buffers: 1 },
  { name: "2Planes", desc: "", type: "plane", buffers: 2 },
  { name: "Wave1", desc: "Wave 1", type: "object", buffers: 1 },
  { name: "Wave", desc: "Full Wave", type: "object", buffers: 1 },
  { name: "Height", desc: "Height field", type: "object", buffers: 1 },
  { name: "Cross", desc: "Cross", type: "object", buffers: 3 },
  { name: "CWave", desc: "Centered Wave", type: "object", buffers: 1 },
  { name: "NearRing", desc: "Almost a Ring", type: "object", buffers: 1 },
  { name: "Tube", desc: "Simple Tube", type: "plane", buffers: 1 },
  { name: "SHeight", desc: "Smooth Height", type: "object", buffers: 1 },
  { name: "2D-Big", desc: "2 dimensional", type: "object", buffers: 1 },
  { name: "2D-Quad", desc: "2 dimensional", type: "object", buffers: 1 },
  { name: "Sphere", desc: "", type: "object", buffers: 1 },
  { name: "Cones", desc: "", type: "object", buffers: 1 }
];
export const GL_LIGHTS = ["none", "spots1", "spots2", "with-spot"] as const;
export const GL_BACKGROUNDS = ["image", "image-blend", "off"] as const;
export const GL_FLIES = ["none", "rings"] as const;

/** What a frame of the display needs from the rest of glcthugha. */
export interface GlFrame {
  /** getTime(): seconds since 1970, and the duration of the last frame. */
  now: number;
  deltaT: number;
  /** The window (disp_size). */
  width: number;
  height: number;
  /** The CoreOptions display, light, background and fly. */
  screen: number;
  light: number;
  background: number;
  fly: number;
  /** soundAnalyze.intensity. */
  intensity: number;
  /** The buffers' textures (setTexture(P)), and buffer 0's passive buffer (BUFF_WIDTH × BUFF_HEIGHT, with its borders). */
  buffers: readonly Texture[];
  passive: Uint8Array;
  base: number;
  bufferWidth: number;
  bufferHeight: number;
  /** pcxTextures[buffers[0].pcx.currentN()]: null for "no picture". */
  picture: Texture | null;
  /** The silence message and its line (Interface::msg), or null. */
  message: string | null;
  messageLine: number;
}

type Vec3 = Float32Array;
type MeshFunction = (pos: Vec3, normal: Vec3, alpha: number) => void;

const M_PI2 = 2 * Math.PI;
/** The text grid of DisplayDeviceGL: 80 × 40 characters, glut's stroke font. */
const TEXT_COLUMNS = 80;
const TEXT_ROWS = 40;
const FW = STROKE_WIDTH;
const FH = STROKE_HEIGHT;

export class GlDisplay {
  /** OptionS "mesh-size": 32, so h = 1/32. */
  private readonly S = 32;
  private readonly h = 1 / 32;
  /** CameraObject's alpha[2], CameraRotate's a, plane()'s s: static in C, kept between frames. */
  private readonly alpha = [0.4, 0.6];
  private rotateA = 0;
  private planeS = 0;
  /** Joystick::stiffAxis without a joystick (joystick.cc): the axes swing with time. */
  private readonly stiffAxis = [8000, 9000, -5000, 0];
  /** screen_sheight's H and H2 (static GLfloat[256][256]). */
  private readonly H = new Float32Array(256 * 256);
  private readonly H2 = new Float32Array(256 * 256);
  /** Fly's texture: 32 × 32, made once. */
  private readonly fire: Texture;
  private frame!: GlFrame;
  private displayPhase: "before" | "after" = "before";

  constructor(private readonly gl: GlEmulator, makeTexture: (mipmaps: boolean) => Texture) {
    this.fire = makeTexture(true);
    const rgba = new Uint8Array(32 * 32 * 4);
    for (let i = 0; i < 32; i += 1) {
      for (let j = 0; j < 32; j += 1) {
        const r = Math.min((i - 16) * (i - 16) + (j - 16) * (j - 16), 255);
        const at = (i * 32 + j) * 4;
        rgba[at] = 255;
        rgba[at + 1] = r < 5 ? 255 - r : Math.min(128, 64 + Math.trunc(r / 4));
        rgba[at + 2] = r < 5 ? 255 - r : 0;
        rgba[at + 3] = 255 - r;
      }
    }
    this.fire.upload(32, 32, rgba);
  }

  private get type(): ScreenType {
    return GL_SCREENS[this.frame.screen]!.type;
  }

  /** drawCB() and CthughaDisplayGL::operator()(): one frame. */
  draw(frame: GlFrame): void {
    this.frame = frame;
    const gl = this.gl;
    // Joystick::run() without a joystick.
    this.stiffAxis[0] = Math.trunc(20000 * Math.sin(0.2 * frame.now));
    this.stiffAxis[1] = Math.trunc(20000 * Math.sin(0.5 * frame.now));
    gl.beginFrame(frame.width, frame.height);
    gl.setTexturing(true);
    gl.setDepthTest(true);
    gl.depthMask(true);
    gl.setBlend(false);
    gl.setFog(false);

    this.displayPhase = "before";
    this.background();
    gl.matrixMode("projection");
    gl.loadIdentity();
    gl.multMatrix(perspective(60, frame.width / frame.height, 0.1, 40));
    gl.matrixMode("modelview");
    gl.loadIdentity();
    this.light();
    this.screen();
    this.displayPhase = "after";
    this.fly();
    this.background();
    gl.setLighting(false);

    if (frame.message) this.text(frame.message, frame.messageLine);
    gl.endFrame();
  }

  // --- textures -----------------------------------------------------------------------------

  private setTexture(p: number): void {
    this.gl.bindTexture(this.frame.buffers[p] ?? this.frame.buffers[0]!);
    this.gl.setTexturing(true);
  }

  // --- camera -------------------------------------------------------------------------------

  private cameraObject(): void {
    // Distance from the object: axis 3 (a Sidewinder's throttle), 0 without a joystick.
    const r = 0 / 32767 + 1.5;
    this.alpha[0] = this.alpha[0]! + this.stiffAxis[0]! * this.frame.deltaT;
    this.alpha[1] = this.alpha[1]! + this.stiffAxis[1]! * this.frame.deltaT;
    const s0 = Math.sin(this.alpha[0] * 9.588e-5);
    const s1 = Math.sin(this.alpha[1] * 9.588e-5);
    const c0 = Math.cos(this.alpha[0] * 9.588e-5);
    const c1 = Math.cos(this.alpha[1] * 9.588e-5);
    this.gl.multMatrix(lookAt(r * s0 * s1, r * c0 * s1, r * c1, 0, 0, 0, s0 * c1, c0 * c1, -s1));
  }

  private cameraRotate(): void {
    this.rotateA += this.stiffAxis[0]! * 1e-4 * this.frame.deltaT;
    const a = this.rotateA;
    this.gl.multMatrix(lookAt(0, 0, 0, 0, 0, 2, Math.sin(a), Math.cos(a), 0));
  }

  // --- the mesh -----------------------------------------------------------------------------

  /** mesh(): the unit square in QUAD_STRIPs of n × n, each vertex placed by f. */
  private mesh(f: MeshFunction, n = 0, alpha = 0): void {
    const gl = this.gl;
    const h = n === 0 ? this.h : Math.fround(1 / n);
    const pos1 = new Float32Array(3);
    const pos2 = new Float32Array(3);
    const normal1 = new Float32Array([0, 0, 1]);
    const normal2 = new Float32Array([0, 0, 1]);
    for (let y = 0; y < 1.0; y += h) {
      gl.begin("quadStrip");
      for (let x = 0; x <= 1.001; x += h) {
        pos1[0] = x;
        pos2[0] = x;
        pos1[1] = y;
        pos2[1] = y + h;
        gl.texCoord(pos1[0]!, pos1[1]!);
        f(pos1, normal1, alpha);
        gl.normal(normal1[0]!, normal1[1]!, normal1[2]!);
        gl.vertex(pos1[0]!, pos1[1]!, pos1[2]!);
        gl.texCoord(pos2[0]!, pos2[1]!);
        f(pos2, normal2, alpha);
        gl.normal(normal2[0]!, normal2[1]!, normal2[2]!);
        gl.vertex(pos2[0]!, pos2[1]!, pos2[2]!);
      }
      gl.end();
    }
  }

  // --- the displays -------------------------------------------------------------------------

  private screen(): void {
    switch (GL_SCREENS[this.frame.screen]!.name) {
      case "Plate": this.screenPlate(); break;
      case "2Plates": this.screen2Plates(); break;
      case "Plane": this.screenPlane(); break;
      case "dPlane": this.screenDPlane(); break;
      case "2Planes": this.screen2Planes(); break;
      case "Wave1": this.screenWave1(); break;
      case "Wave": this.screenWave(); break;
      case "Height": this.screenHeight(); break;
      case "Cross": this.screenCross(); break;
      case "CWave": this.screenCWave(); break;
      case "NearRing": this.screenNearRing(); break;
      case "Tube": this.screenTube(); break;
      case "SHeight": this.screenSHeight(); break;
      case "2D-Big": this.screen2dBig(); break;
      case "2D-Quad": this.screen2dQuad(); break;
      case "Sphere": this.screenSphere(); break;
      default: this.screenCones();
    }
  }

  /** (light.currentN() == 0) ? 1 : S */
  private litMesh(): number {
    return this.frame.light === 0 ? 1 : this.S;
  }

  private readonly plate: MeshFunction = (pos) => {
    pos[0] = -1.0 + pos[0]! * 2.0;
    pos[1] = -1.0 + pos[1]! * 2.0;
    pos[2] = 0;
  };

  private screenPlate(): void {
    this.cameraObject();
    this.setTexture(0);
    this.mesh(this.plate, this.litMesh());
  }

  private readonly plateSmall: MeshFunction = (pos) => {
    pos[0] = -0.8 + pos[0]! * 1.6;
    pos[1] = -0.8 + pos[1]! * 1.6;
    pos[2] = 0.25;
  };

  private screen2Plates(): void {
    this.cameraObject();
    this.setTexture(0);
    this.mesh(this.plate, this.litMesh());
    // glPushMatrix() without a pop: the stack fills, the matrix is reset next frame anyway.
    this.gl.pushMatrix();
    this.setTexture(1);
    const now = this.frame.now;
    const alpha = 520.0 * Math.sin(now * 0.3 + 1.01) + 200.0 * Math.sin(now * 0.5 + 1.1);
    this.gl.rotate(alpha, 0, 0, 1);
    this.mesh(this.plateSmall, this.litMesh());
  }

  private plane(tex: number, pos: number): void {
    const gl = this.gl;
    this.setTexture(tex);
    // A static s: dPlane and 2Planes move it twice a frame.
    this.planeS -= this.stiffAxis[1]! * 1e-4 * this.frame.deltaT;
    this.planeS %= 2.0;
    const s = this.planeS;
    gl.begin("polygon");
    gl.texCoord(0.0, 0.0 + s);
    gl.vertex(-3.0, pos, 0.0);
    gl.texCoord(1.0, 0.0 + s);
    gl.vertex(3.0, pos, 0.0);
    gl.texCoord(1.0, 3.0 + s);
    gl.vertex(4.0, 0, 5.0);
    gl.texCoord(0.0, 3.0 + s);
    gl.vertex(-4.0, 0, 5.0);
    gl.end();
  }

  /** fogIntensity = 0.4, GL_FOG on for the "plane" displays. */
  private fog(on: boolean): void {
    this.gl.setFog(on);
    if (on) this.gl.fogf(0.4);
  }

  private screenPlane(): void {
    this.fog(true);
    this.cameraRotate();
    this.plane(0, 0.5);
    this.fog(false);
  }

  private screenDPlane(): void {
    this.fog(true);
    this.cameraRotate();
    this.plane(0, 0.5);
    this.plane(0, -0.5);
    this.fog(false);
  }

  private screen2Planes(): void {
    this.fog(true);
    this.cameraRotate();
    this.plane(0, 0.5);
    this.plane(1, -0.5);
    this.fog(false);
  }

  private readonly wave1: MeshFunction = (pos, normal, alpha) => {
    const intensity = this.frame.intensity;
    pos[2] = intensity * Math.sin(2.0 * Math.PI * pos[0]! + alpha);
    pos[0] = -1.0 + pos[0]! * 2.0;
    pos[1] = -1.0 + pos[1]! * 2.0;
    // As written: the normal from the x already moved to −1 … 1.
    normal[0] = intensity * Math.cos(2.0 * Math.PI * pos[0]! + alpha);
  };

  private screenWave1(): void {
    this.cameraObject();
    const alpha = this.frame.now % M_PI2;
    this.setTexture(0);
    this.gl.setNormalize(true);
    this.mesh(this.wave1, this.S, alpha);
    this.gl.setNormalize(false);
  }

  private readonly wave: MeshFunction = (pos, normal, alpha) => {
    const intensity = this.frame.intensity;
    pos[2] = intensity * Math.sin(2.0 * Math.PI * pos[0]! + alpha) * Math.sin(2.0 * Math.PI * pos[1]! + alpha);
    pos[0] = -1.0 + pos[0]! * 2.0;
    pos[1] = -1.0 + pos[1]! * 2.0;
    normal[0] = intensity * Math.cos(2.0 * Math.PI * pos[0]! + alpha) * Math.sin(2.0 * Math.PI * pos[1]! + alpha);
    normal[1] = intensity * Math.sin(2.0 * Math.PI * pos[0]! + alpha) * Math.cos(2.0 * Math.PI * pos[1]! + alpha);
  };

  private screenWave(): void {
    this.cameraObject();
    const alpha = this.frame.now % M_PI2;
    this.setTexture(0);
    this.mesh(this.wave, this.S, alpha);
  }

  private scX = 1;
  private scY = 1;

  private readonly height1: MeshFunction = (pos) => {
    const f = this.frame;
    pos[2] = (1.0 / 256.0) * f.passive[f.base + Math.trunc(pos[1]! * this.scY + pos[0]! * this.scX)]!;
    pos[0] = -1.0 + pos[0]! * 2.0;
    pos[1] = -1.0 + pos[1]! * 2.0;
  };

  private screenHeight(): void {
    this.cameraObject();
    this.scX = this.frame.bufferWidth;
    this.scY = this.frame.bufferHeight * this.frame.bufferWidth;
    this.setTexture(0);
    this.mesh(this.height1);
  }

  private readonly cross1: MeshFunction = (pos) => {
    pos[0] = -1.0 + pos[0]! * 2.0;
    pos[1] = -1.0 + pos[1]! * 2.0;
    pos[2] = 0.0;
  };

  private readonly cross2: MeshFunction = (pos, normal) => {
    pos[2] = -1.0 + pos[1]! * 2.0;
    pos[1] = -1.0 + pos[0]! * 2.0;
    pos[0] = 0.0;
    normal[0] = 1;
    normal[1] = 0;
    normal[2] = 0;
  };

  private readonly cross3: MeshFunction = (pos, normal) => {
    pos[0] = -1.0 + pos[0]! * 2.0;
    pos[2] = -1.0 + pos[1]! * 2.0;
    pos[1] = 0.0;
    normal[0] = 0;
    normal[1] = 1;
    normal[2] = 0;
  };

  private screenCross(): void {
    this.cameraObject();
    const n = this.litMesh();
    this.setTexture(0);
    this.mesh(this.cross1, n);
    this.setTexture(1);
    this.mesh(this.cross2, n);
    this.setTexture(2);
    this.mesh(this.cross3, n);
  }

  private readonly cwave: MeshFunction = (pos, _normal, alpha) => {
    const x = pos[0]! - 0.5;
    const y = pos[1]! - 0.5;
    const r = x * x + y * y;
    pos[0] = -1.0 + pos[0]! * 2.0;
    pos[1] = -1.0 + pos[1]! * 2.0;
    pos[2] = (this.frame.intensity * 0.2 * Math.sin(25.0 * r - alpha)) / (r + 0.5);
  };

  private screenCWave(): void {
    this.cameraObject();
    const alpha = this.frame.now % M_PI2;
    this.setTexture(0);
    this.mesh(this.cwave, this.S, alpha);
  }

  private readonly nearRing: MeshFunction = (pos) => {
    const F = 0.25 * (1.0 + pos[0]!);
    const alpha = 8.0 * pos[0]! + this.frame.now * 0.5;
    const beta = M_PI2 * pos[1]!;
    pos[0] = Math.sin(alpha) * (1.0 + F * Math.sin(beta));
    pos[1] = F * Math.cos(beta);
    pos[2] = Math.cos(alpha) * (1.0 + F * Math.sin(beta));
  };

  private screenNearRing(): void {
    this.cameraObject();
    this.setTexture(0);
    this.mesh(this.nearRing);
  }

  private readonly tube1: MeshFunction = (pos, _normal, alpha) => {
    const p = pos[1]!;
    pos[2] = 4.0 * pos[0]! + alpha;
    pos[0] = Math.sin(p * Math.PI);
    pos[1] = Math.cos(p * Math.PI);
  };

  private readonly tube2: MeshFunction = (pos, _normal, alpha) => {
    const p = pos[1]!;
    pos[2] = 4.0 * pos[0]! + alpha;
    pos[0] = -Math.sin(p * Math.PI);
    pos[1] = Math.cos(p * Math.PI);
  };

  private screenTube(): void {
    this.fog(true);
    this.cameraRotate();
    this.setTexture(0);
    const half = Math.trunc(this.S / 2);
    this.mesh(this.tube1, half);
    this.mesh(this.tube2, half);
    this.mesh(this.tube1, half, 4.0);
    this.mesh(this.tube2, half, 4.0);
    this.mesh(this.tube1, half, 8.0);
    this.mesh(this.tube2, half, 8.0);
    this.fog(false);
  }

  private readonly sheight: MeshFunction = (pos) => {
    const x = Math.trunc(pos[0]! * this.S);
    const y = Math.trunc(pos[1]! * this.S);
    pos[0] = -1.0 + pos[0]! * 2;
    pos[1] = -1.0 + pos[1]! * 2;
    pos[2] = this.H2[x * 256 + y]!;
  };

  private screenSHeight(): void {
    this.cameraObject();
    const f = this.frame;
    const S = this.S;
    const H = this.H;
    const scXi = Math.trunc(f.bufferWidth / S);
    const scYi = Math.trunc(f.bufferHeight / S) * f.bufferWidth;
    // Take new values from the buffer.
    for (let i = 0; i < S; i += 1) {
      for (let j = 0; j < S; j += 1) H[i * 256 + j] = f.passive[f.base + i * scYi + j * scXi]! / 512.0;
    }
    // The border to 0.
    for (let i = 0; i < S; i += 1) {
      H[i * 256] = 0;
      H[i * 256 + S - 1] = 0;
      H[i] = 0;
      H[(S - 1) * 256 + i] = 0;
    }
    // Some smoothing steps.
    for (let l = 0; l < 3; l += 1) {
      for (let i = 1; i < S; i += 1) {
        for (let j = 1; j < S; j += 2) {
          H[i * 256 + j] = 0.25 * (H[(i - 1) * 256 + j]! + H[(i + 1) * 256 + j]! + H[i * 256 + j + 1]! + H[i * 256 + j - 1]!);
        }
      }
      for (let i = 1; i < S; i += 1) {
        for (let j = 2; j < S; j += 2) {
          H[i * 256 + j] = 0.25 * (H[(i - 1) * 256 + j]! + H[(i + 1) * 256 + j]! + H[i * 256 + j + 1]! + H[i * 256 + j - 1]!);
        }
      }
    }
    // Averaged with the last height.
    for (let i = 0; i < S; i += 1) {
      for (let j = 0; j < S; j += 1) this.H2[i * 256 + j] = 0.7 * this.H2[i * 256 + j]! + 0.3 * H[i * 256 + j]!;
    }
    this.setTexture(0);
    this.mesh(this.sheight);
  }

  private orthoScreen(): void {
    const gl = this.gl;
    gl.matrixMode("projection");
    gl.loadIdentity();
    gl.multMatrix(ortho(-1.0, 1.0, -1.0, 1.0, -1.0, 1.0));
    gl.matrixMode("modelview");
    gl.loadIdentity();
  }

  private screen2dBig(): void {
    this.setTexture(0);
    this.orthoScreen();
    this.mesh(this.plate, this.litMesh());
  }

  private readonly plateQ1: MeshFunction = (pos) => {
    pos[0] = -1.0 + pos[0]!;
    pos[1] = -1.0 + pos[1]!;
    pos[2] = 0;
  };

  private readonly plateQ2: MeshFunction = (pos) => {
    pos[0] = 1.0 - pos[0]!;
    pos[1] = -1.0 + pos[1]!;
    pos[2] = 0;
  };

  private readonly plateQ3: MeshFunction = (pos) => {
    pos[0] = 1.0 - pos[0]!;
    pos[1] = 1.0 - pos[1]!;
    pos[2] = 0;
  };

  private readonly plateQ4: MeshFunction = (pos) => {
    pos[0] = -1.0 + pos[0]!;
    pos[1] = 1.0 - pos[1]!;
    pos[2] = 0;
  };

  private screen2dQuad(): void {
    this.setTexture(0);
    this.orthoScreen();
    const n = this.frame.light === 0 ? 1 : Math.trunc(this.S / 2);
    this.mesh(this.plateQ1, n);
    this.mesh(this.plateQ2, n);
    this.mesh(this.plateQ3, n);
    this.mesh(this.plateQ4, n);
  }

  /** gluSphere(radius, slices, stacks) with texture coordinates, as Mesa 3's GLU drew it. */
  private sphere(radius: number, slices: number, stacks: number): void {
    const gl = this.gl;
    const drho = Math.PI / stacks;
    const dtheta = (2 * Math.PI) / slices;
    const ds = 1 / slices;
    const dt = 1 / stacks;
    let t = 1.0;
    for (let i = 0; i < stacks; i += 1) {
      const rho = i * drho;
      gl.begin("quadStrip");
      let s = 0.0;
      for (let j = 0; j <= slices; j += 1) {
        const theta = j === slices ? 0.0 : j * dtheta;
        let x = -Math.sin(theta) * Math.sin(rho);
        let y = Math.cos(theta) * Math.sin(rho);
        let z = Math.cos(rho);
        gl.normal(x, y, z);
        gl.texCoord(s, t);
        gl.vertex(x * radius, y * radius, z * radius);
        x = -Math.sin(theta) * Math.sin(rho + drho);
        y = Math.cos(theta) * Math.sin(rho + drho);
        z = Math.cos(rho + drho);
        gl.normal(x, y, z);
        gl.texCoord(s, t - dt);
        s += ds;
        gl.vertex(x * radius, y * radius, z * radius);
      }
      gl.end();
      t -= dt;
    }
  }

  /** gluCylinder(base, top, height, slices, stacks), as Mesa 3's GLU drew it (a negative height too). */
  private cylinder(base: number, top: number, height: number, slices: number, stacks: number): void {
    const gl = this.gl;
    const da = (2 * Math.PI) / slices;
    const dr = (top - base) / stacks;
    const dz = height / stacks;
    const nz = (base - top) / height;
    const ds = 1 / slices;
    const dt = 1 / stacks;
    let t = 0.0;
    let z = 0.0;
    let r = base;
    for (let j = 0; j < stacks; j += 1) {
      let s = 0.0;
      gl.begin("quadStrip");
      for (let i = 0; i <= slices; i += 1) {
        const x = i === slices ? Math.sin(0) : Math.sin(i * da);
        const y = i === slices ? Math.cos(0) : Math.cos(i * da);
        gl.normal(x, y, nz);
        gl.texCoord(s, t);
        gl.vertex(x * r, y * r, z);
        gl.normal(x, y, nz);
        gl.texCoord(s, t + dt);
        gl.vertex(x * (r + dr), y * (r + dr), z + dz);
        s += ds;
      }
      gl.end();
      r += dr;
      t += dt;
      z += dz;
    }
  }

  private screenSphere(): void {
    this.cameraObject();
    this.setTexture(0);
    this.sphere(0.5, this.S, this.S);
  }

  private screenCones(): void {
    this.cameraObject();
    this.setTexture(0);
    this.gl.rotate(90, 1, 0, 0);
    this.cylinder(0.0, 0.5, 0.5, this.S, this.S);
    this.cylinder(0.0, 0.5, -0.5, this.S, this.S);
  }

  // --- light (GL_Light.cc) ------------------------------------------------------------------

  private static readonly RED: [number, number, number] = [1.0, 0.2, 0.2];
  private static readonly GREEN: [number, number, number] = [0.2, 1.0, 0.2];
  private static readonly BLUE: [number, number, number] = [0.2, 0.2, 1.0];
  private static readonly WHITE: [number, number, number] = [1.0, 1.0, 1.0];

  private light(): void {
    const gl = this.gl;
    const entry = GL_LIGHTS[this.frame.light]!;
    if (entry === "none") {
      gl.texEnvModulate(false);
      gl.setLighting(false);
      return;
    }
    if (this.type !== "object") {
      gl.texEnvModulate(false);
      return;
    }
    gl.setLighting(true);
    gl.texEnvModulate(true);
    const now = this.frame.now;
    const down: [number, number, number] = [0, 0, -1];
    if (entry === "spots1") {
      gl.spot(0, [0.5 * Math.sin(now), 0.5 * Math.cos(now), 1.5, 1], down, GlDisplay.RED);
      gl.spot(1, [0.5 * Math.sin(now + M_PI2 / 3.0), 0.5 * Math.cos(now + M_PI2 / 3.0), 1.5, 1], down, GlDisplay.GREEN);
      gl.spot(2, [0.5 * Math.sin(now + (2.0 * M_PI2) / 3.0), 0.5 * Math.cos(now + (2.0 * M_PI2) / 3.0), 1.5, 1], down, GlDisplay.BLUE);
    } else if (entry === "spots2") {
      const r = Math.sin(now);
      gl.spot(0, [0, r, 1.5, 1], down, GlDisplay.RED);
      gl.spot(1, [r * Math.sin(M_PI2 / 3.0), r * Math.cos(M_PI2 / 3.0), 1.5, 1], down, GlDisplay.GREEN);
      gl.spot(2, [r * Math.sin((2.0 * M_PI2) / 3.0), r * Math.cos((2.0 * M_PI2) / 3.0), 1.5, 1], down, GlDisplay.BLUE);
    } else {
      gl.spot(0, [0, 0, 1.2, 1.0], [0, 0, -1], GlDisplay.WHITE);
      gl.disableLight(1);
      gl.disableLight(2);
    }
  }

  // --- background (GL_Background.cc) and fly (GL_Fly.cc) -------------------------------------

  private windowQuad(): void {
    const gl = this.gl;
    const { width, height } = this.frame;
    gl.matrixMode("projection");
    gl.loadIdentity();
    gl.multMatrix(ortho(0.0, width, 0.0, height, -1.0, 1.0));
    gl.matrixMode("modelview");
    gl.loadIdentity();
    gl.bindTexture(this.frame.picture);
    gl.setTexturing(true);
    gl.texEnvModulate(false);
    gl.setLighting(false);
    gl.begin("polygon");
    gl.texCoord(0.0, 1.0);
    gl.vertex(0, 0, 0);
    gl.texCoord(0.0, 0.0);
    gl.vertex(0, height, 0);
    gl.texCoord(1.0, 0.0);
    gl.vertex(width, height, 0);
    gl.texCoord(1.0, 1.0);
    gl.vertex(width, 0, 0);
    gl.end();
  }

  private background(): void {
    const gl = this.gl;
    const entry = GL_BACKGROUNDS[this.frame.background]!;
    if (entry === "off") return;
    if (entry === "image" && this.displayPhase === "after") return;
    if (entry === "image-blend" && this.displayPhase === "before") return;
    // Image 0 is empty.
    if (!this.frame.picture) return;
    // Only with "object" displays.
    if (this.type !== "object") {
      gl.texEnvModulate(false);
      return;
    }
    if (entry === "image") {
      gl.depthMask(false);
      gl.setDepthTest(false);
      this.windowQuad();
      gl.setDepthTest(true);
      gl.depthMask(true);
    } else {
      gl.setDepthTest(false);
      gl.blendFunction("add");
      gl.setBlend(true);
      this.windowQuad();
      gl.setBlend(false);
      gl.setDepthTest(true);
    }
  }

  private fly(): void {
    const gl = this.gl;
    if (GL_FLIES[this.frame.fly] !== "rings" || this.type !== "plane") return;
    gl.bindTexture(this.fire);
    gl.setTexturing(true);
    gl.setDepthTest(false);
    gl.setBlend(true);
    gl.blendFunction("alpha");
    const N = 16;
    const now = this.frame.now;
    const offset = [0.3 * Math.sin(now), 0, 1.4 + 0.6 * Math.sin(now)];
    for (let i = 0; i < N; i += 1) {
      const alpha = now + (i / N) * M_PI2;
      const x = 0.1 * Math.sin(alpha) + offset[0]!;
      const y = 0.6 * Math.sin(now * 0.2) + offset[1]!;
      const z = 0.1 * Math.cos(alpha) + offset[2]!;
      const r = 0.02;
      gl.begin("polygon");
      gl.texCoord(0.0, 0.0);
      gl.vertex(x - r, y - r, z);
      gl.texCoord(1.0, 0.0);
      gl.vertex(x + r, y - r, z);
      gl.texCoord(1.0, 1.0);
      gl.vertex(x + r, y + r, z);
      gl.texCoord(0.0, 1.0);
      gl.vertex(x - r, y + r, z);
      gl.end();
    }
    gl.setDepthTest(true);
    gl.setBlend(false);
  }

  // --- text (DisplayDeviceGL::printString, Interface's silence message) -----------------------

  private text(message: string, line: number): void {
    const gl = this.gl;
    gl.setTexturing(false);
    gl.setDepthTest(false);
    gl.setFog(false);
    gl.setLighting(false);
    gl.matrixMode("projection");
    gl.loadIdentity();
    gl.multMatrix(ortho(0.0, FW * TEXT_COLUMNS, 0.0, FH * TEXT_ROWS, -1.0, 1.0));
    gl.matrixMode("modelview");
    gl.loadIdentity();
    const len = Math.min(message.length, TEXT_COLUMNS);
    // print(): centred, fontSize 100 a character; printString(x, y × 100, …).
    const x = Math.max(Math.trunc((100 * (TEXT_COLUMNS - len)) / 2), 0);
    const y = line * 100;
    gl.pushMatrix();
    gl.translate((FW * x) / 100.0, FH * (39.0 - y / 100.0), 0);
    // The dark box behind the text.
    gl.setBlend(true);
    gl.blendFunction("alpha");
    gl.color4f(0.0, 0.0, 0.0, 0.5);
    gl.begin("polygon");
    gl.vertex(0.0, 0.0, 0);
    gl.vertex(0.0, FH * 1.0, 0);
    gl.vertex(FW * len, FH * 1.0, 0);
    gl.vertex(FW * len, 0.0, 0);
    gl.end();
    gl.setBlend(false);
    // textColorRGB[TEXT_COLOR_NORMAL]: 192, 192, 192.
    gl.color4f(192 / 255, 192 / 255, 192 / 255, 0.0);
    gl.translate(0, STROKE_DESCENT, 0);
    for (let i = 0; i < len; i += 1) {
      const glyph = MONO_ROMAN[message.charCodeAt(i) - 32];
      if (glyph) {
        for (const strip of glyph) {
          gl.begin("lineStrip");
          for (let k = 0; k + 1 < strip.length; k += 2) gl.vertex(strip[k]! / 100, strip[k + 1]! / 100, 0);
          gl.end();
        }
      }
      gl.translate(FW, 0, 0);
    }
    gl.popMatrix();
    gl.color4f(1, 1, 1, 1);
  }
}
