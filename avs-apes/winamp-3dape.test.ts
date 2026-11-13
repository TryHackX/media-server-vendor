import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ape, parse3dApeConfig, parseAsc, buildTables, ftol, rotationCoefficients, rotatePoint, faceNormal,
  drawLine, cameraBasis, projectVertex, CrtTextStream, DEG,
} from "./winamp-3dape.ts";
import type { ApeContext } from "./winamp-3dape.ts";

const hex = (s: string): Uint8Array => Uint8Array.from(s.match(/../g)!.map((b) => parseInt(b, 16)));
const fbits = (v: number): string => {
  const b = new Uint8Array(new Float32Array([v]).buffer);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
};

function ctx(w: number, h: number): ApeContext {
  return {
    w, h, isBeat: false,
    visdata: new Int8Array(2304), visdataUnsigned: new Uint8Array(2304),
    rand: () => 0, makeRand: () => () => 0, registers: new Float64Array(100),
    lineBlendMode: 0, globalBuffer: () => null, now: () => 0,
  };
}

// The 14 configs of the 11 presets that use the plug-in (bytes as stored in the .avs files).
const PRESETS: [string, string, number, string][] = [
  ["Fabry - AVS Busting Balls #1", "0100000089365b005350484552452e415343", 0x5b3689, "SPHERE.ASC"],
  ["Fabry - AVS Busting Balls #2", "010000001e6366005350484552452e415343", 0x66631e, "SPHERE.ASC"],
  ["Arco-trippy simple", "0100000000000000435542452e415343", 0x000000, "CUBE.ASC"],
  ["[l0tus vs. duo] geomatrix", "0100000000ff00005350484552452e415343", 0x00ff00, "SPHERE.ASC"],
  ["[degnic vs. t-k + l0tus] spirits", "010000000000ff005350484552452e415343", 0xff0000, "SPHERE.ASC"],
  ["Mr_Nudge - 29Tessalation", "010000000000e1005350484552452e415343", 0xe10000, "SPHERE.ASC"],
  ["Tonic - ant", "01000000ff000000414e542e415343", 0x0000ff, "ANT.ASC"],
  ["Tonic - Mravka v komina #1", "01000000ffffff00414e542e415343", 0xffffff, "ANT.ASC"],
  ["Tonic - Mravka v komina #2", "01000000c0c0c000414e542e415343", 0xc0c0c0, "ANT.ASC"],
  ["Tonic - 3D Disco wall", "01000000ffffff005350484552452e415343", 0xffffff, "SPHERE.ASC"],
  ["Zen-X - Ants, Everywhere", "0100000037327800414e542e415343", 0x783237, "ANT.ASC"],
  ["ZXe-My mind imprisoned 2", "010000004856b7005350484552452e415343", 0xb75648, "SPHERE.ASC"],
  ["ZXe-My mind imprisoned #1", "0100000048d52b005350484552452e415343", 0x2bd548, "SPHERE.ASC"],
  ["ZXe-My mind imprisoned #2", "010000004856b7005350484552452e415343", 0xb75648, "SPHERE.ASC"],
];

test("config: the real preset bytes", () => {
  for (const [name, bytes, color, file] of PRESETS) {
    const c = parse3dApeConfig(hex(bytes));
    assert.equal(c.enabled, 1, name);
    assert.equal(c.color, color, name);
    assert.equal(c.file, file, name);
  }
});

test("config: defaults, NUL-terminated name, short data", () => {
  assert.deepEqual(parse3dApeConfig(new Uint8Array(0)), { enabled: 1, color: 0x00ff00, file: "" });
  assert.deepEqual(parse3dApeConfig(hex("00000000")), { enabled: 0, color: 0x00ff00, file: "" });
  assert.deepEqual(parse3dApeConfig(hex("01000000112233004142004344")), { enabled: 1, color: 0x332211, file: "AB" });
  assert.deepEqual(parse3dApeConfig(hex("010000001122330000414243")), { enabled: 1, color: 0x332211, file: "" });
});

test("tables: float sin/cos of i * 3.141592654/180", () => {
  assert.equal(DEG, 3.141592654 / 180);
  const t = buildTables();
  assert.equal(fbits(t.sin[1]), "59f88e3c");
  assert.equal(fbits(t.cos[1]), "05f67f3f");
  assert.equal(t.sin[90], 1);
  assert.equal(fbits(t.cos[90]), "7c8361af"); // -2.05e-10, not 0 (pi is 3.141592654)
  assert.equal(fbits(t.sin[180]), "7c83e1af");
  assert.equal(t.cos[180], -1);
  const cs = rotationCoefficients(0, 1, 0);
  assert.deepEqual(Array.from(cs), [0, 1, t.sin[1], t.cos[1], 0, 1]);
  const neg = rotationCoefficients(-90, 361, 0);
  assert.deepEqual(Array.from(neg), [t.sin[270], t.cos[270], t.sin[1], t.cos[1], 0, 1]);
});

test("_ftol: truncation and the low 32 bits", () => {
  assert.equal(ftol(2.9), 2);
  assert.equal(ftol(-2.9), -2);
  assert.equal(ftol(-0.5), 0);
  assert.equal(ftol(3e9), 3000000000 - 4294967296);
  assert.equal(ftol(NaN), 0);
  assert.equal(ftol(1e19), 0);
});

test("rotation by one degree about y accumulates in float (values from Python doubles)", () => {
  const cs = rotationCoefficients(0, 1, 0);
  const p = Float32Array.of(100, 50, -20);
  rotatePoint(p, 0, cs);
  assert.deepEqual([fbits(p[0]), fbits(p[1]), fbits(p[2])], ["7d45c742", "00004842", "04f0adc1"]);
  rotatePoint(p, 0, cs);
  assert.deepEqual([fbits(p[0]), fbits(p[1]), fbits(p[2])], ["707bc642", "00004842", "78d2bbc1"]);
  const q = Float32Array.of(-183.804398, 47.193581, -7.267748);
  for (let i = 0; i < 1000; i++) rotatePoint(q, 0, cs);
  assert.deepEqual(Array.from(q), [-24.760074615478516, 47.193580627441406, -182.27694702148438]);
});

test("face normal: normalize((C-A) x (B-A))", () => {
  const v = Float32Array.of(1.5, 2.25, -3, 7, -1, 0.5, -2, 4, 9);
  const n = new Float32Array(3);
  faceNormal(v, 0, 1, 2, n, 0);
  assert.deepEqual(Array.from(n), [0.49946901202201843, 0.8661152124404907, 0.01936998963356018]);
});

test("camera at (0,0,1024) looking at the origin, projection with focal 256", () => {
  const cam = cameraBasis({ px: 0, py: 0, pz: 1024, tx: 0, ty: 0, tz: 0 });
  assert.deepEqual([cam.dx, cam.dy, cam.dz], [0, 0, -1]);
  assert.deepEqual([cam.ux, cam.uy, cam.uz], [-0, 1, 0]);
  assert.deepEqual([cam.rx, cam.ry, cam.rz], [-1, 0, -0]);
  const cs = rotationCoefficients(0, 1, 0);
  const cases: [number[], number, number, number, number, number][] = [
    // input (engine axes), cz, sx/sy at 64x48, sx/sy at 320x200
    [[100, 0, 0], 1025.7452392578125, 8, 24, 136, 100],
    [[0, 100, 0], 1024, 32, -1, 160, 75],
    [[-37.5, 12.25, 300], 723.3912353515625, 43, 20, 171, 96],
  ];
  for (const [p, cz, sx64, sy48, sx320, sy200] of cases) {
    const o = { rel: Float32Array.from(p), cz: new Float32Array(1), sx: new Int32Array(1), sy: new Int32Array(1) };
    rotatePoint(o.rel, 0, cs);
    projectVertex(o, 0, cam, 32, 24);
    assert.deepEqual([o.cz[0], o.sx[0], o.sy[0]], [cz, sx64, sy48]);
    projectVertex(o, 0, cam, 160, 100);
    assert.deepEqual([o.sx[0], o.sy[0]], [sx320, sy200]);
  }
});

test("line: 16.16 DDA, both ends must be inside, truncating slope", () => {
  const w = 10, h = 10;
  const px = (fb: Int32Array): string[] => {
    const out: string[] = [];
    fb.forEach((v, i) => { if (v) out.push(`${i % w},${(i / w) | 0}`); });
    return out;
  };
  let fb = new Int32Array(w * h);
  drawLine(fb, w, h, 1, 1, 8, 4, 7);
  assert.deepEqual(px(fb), ["1,1", "2,1", "3,1", "4,2", "5,2", "6,3", "7,3", "8,3"]); // never reaches y=4
  fb = new Int32Array(w * h);
  drawLine(fb, w, h, 2, 0, 0, 5, 7);
  assert.deepEqual(px(fb).sort(), ["0,3", "0,4", "0,5", "1,1", "1,2", "2,0"]);
  fb = new Int32Array(w * h);
  drawLine(fb, w, h, -1, 0, 5, 5, 7);
  drawLine(fb, w, h, 0, 0, 10, 5, 7);
  assert.equal(px(fb).length, 0);
  drawLine(fb, w, h, 4, 4, 4, 4, 7);
  assert.deepEqual(px(fb), ["4,4"]);
});

test("fscanf subset: %s, %d, %f, %[^:], text mode", () => {
  const f = new CrtTextStream("Vertex 12:  X:-1.5e2\r\n  Y: 0.1\x1aZ: 9");
  assert.equal(f.scanS(), "Vertex");
  assert.equal(f.scanD(), 12);
  assert.equal(f.scanS(), ":");
  assert.equal(f.scanNotColon(), "  X");
  assert.equal(f.getc(), 58);
  assert.equal(f.scanF(), -150);
  assert.equal(f.scanNotColon(), "\n  Y");
  assert.equal(f.scanNotColon(), null);
  f.getc();
  assert.equal(f.scanF(), Math.fround(0.1));
  assert.equal(f.eof, true); // ^Z ends the text-mode file
  assert.equal(f.scanS(), null);
});

const CRLF = (s: string): string => s.replace(/\n/g, "\r\n");
// A synthetic triangle in the 3D Studio ASCII layout (file axes: X, Y, Z with Z up).
const TRI = (order: string): string => CRLF(`Ambient light color: Red=0.1 Green=0.1 Blue=0.1

Named object: "Tri"
Tri-mesh, Vertices: 3     Faces: 1
Vertex list:
Vertex 0:  X: 0     Y: 0     Z: 0
Vertex 1:  X: 100     Y: 0     Z: 0
Vertex 2:  X:0     Y:0     Z:100
Face list:
Face 0:    ${order} AB:1 BC:1 CA:1
Material:"Default"
Smoothing:  1
`);

test("ASC: vertices with Y/Z swapped, faces, default camera, mapped meshes, camera section", () => {
  const s = parseAsc(TRI("A:0 B:2 C:1"))!;
  assert.equal(s.objects.length, 1);
  assert.deepEqual(Array.from(s.objects[0].verts), [0, 0, 0, 100, 0, 0, 0, 100, 0]);
  assert.deepEqual(Array.from(s.objects[0].faces), [0, 2, 1]);
  assert.deepEqual(s.camera, { px: 0, py: 0, pz: 1024, tx: 0, ty: 0, tz: 0 });

  const mapped = parseAsc(CRLF(`Named object: "Box"
Tri-mesh, Vertices: 2     Faces: 0
Mapped
Vertex list:
Vertex 0:  X:-200     Y:-199.999939     Z:200.000046     U:0     V:0.996094
Vertex 1:  X:200     Y:-1     Z:-2     U:0.996094     V:0.996094
Face list:
Named object: "Camera01"
Camera (48.235291mm)
Position:  X:10 Y:1024 Z:512
Target:  X:0 Y:0 Z:0
`))!;
  assert.deepEqual(Array.from(mapped.objects[0].verts),
    [-200, Math.fround(200.000046), Math.fround(-199.999939), 200, -2, -1]);
  assert.deepEqual(mapped.camera, { px: 10, py: 512, pz: 1024, tx: 0, ty: 0, tz: 0 });

  assert.equal(parseAsc("Tri-mesh, Vertices: 3\r\n"), null); // the original exits the process here
  assert.deepEqual(parseAsc("")!.objects, []);
});

test("render: wireframe in the preset colour, back faces culled, nothing without the mesh", () => {
  const cfg = hex("01000000ff00ff00" + Array.from("TRI.ASC", (c) => c.charCodeAt(0).toString(16)).join(""));
  const w = 64, h = 48;
  const draw = (order: string, frames: number): Int32Array => {
    const fx = ape.create(cfg, { "tri.asc": TRI(order) });
    let fb = new Int32Array(w * h);
    for (let i = 0; i < frames; i++) {
      fb = new Int32Array(w * h); // a cleared frame each time; only the last one is checked
      assert.equal(fx.render(ctx(w, h), fb, new Int32Array(w * h)), 0);
    }
    return fb;
  };
  const front = draw("A:0 B:2 C:1", 1);
  const lit = Array.from(front).filter((v) => v !== 0);
  assert.ok(lit.every((v) => v === 0xff00ff));
  // vertex (100,0,0) after one degree projects to (8, 24) and the apex (0,100,0) to (32, -1): that edge
  // is off-screen, so only the base edge from (32,24) to (8,24) is drawn on row 24.
  assert.equal(front[24 * w + 8], 0xff00ff);
  assert.equal(front[24 * w + 32], 0xff00ff);
  assert.equal(lit.length, 25);
  assert.equal(draw("A:0 B:1 C:2", 1).filter((v) => v !== 0).length, 0); // back face
  // after 180 frames the triangle has turned half way round and the other winding becomes visible
  assert.ok(draw("A:0 B:1 C:2", 180).filter((v) => v !== 0).length > 0);
  assert.equal(draw("A:0 B:2 C:1", 180).filter((v) => v !== 0).length, 0);

  const missing = ape.create(cfg, {});
  const fb = new Int32Array(w * h);
  missing.render(ctx(w, h), fb, new Int32Array(w * h));
  assert.ok(fb.every((v) => v === 0));
  const disabled = ape.create(hex("00000000ff00ff00545249"), new Map([["TRI", TRI("A:0 B:2 C:1")]]));
  disabled.render(ctx(w, h), fb, new Int32Array(w * h));
  assert.ok(fb.every((v) => v === 0));
});
