import { Material, Mesh, MeshRenderer, Node, Quat, Vec3, primitives, utils } from 'cc';

type Geometry = { positions: number[]; normals?: number[]; indices?: number[]; uvs?: number[] };

/** Merge procedural pieces by material, rather than drawing every tree/tank part separately. */
export class PrototypeGeometry {
  private groups = new Map<Material, Required<Geometry>>();

  add(material: Material, geometry: Geometry, position: Vec3 = Vec3.ZERO,
    scale: Vec3 = Vec3.ONE, euler: Vec3 = Vec3.ZERO): void {
    let group = this.groups.get(material);
    if (!group) {
      group = { positions: [], normals: [], indices: [], uvs: [] };
      this.groups.set(material, group);
    }
    const offset = group.positions.length / 3, rotation = Quat.fromEuler(new Quat(), euler.x, euler.y, euler.z);
    const point = new Vec3(), normal = new Vec3();
    for (let i = 0; i < geometry.positions.length; i += 3) {
      point.set(geometry.positions[i] * scale.x, geometry.positions[i + 1] * scale.y, geometry.positions[i + 2] * scale.z);
      Vec3.transformQuat(point, point, rotation);
      Vec3.add(point, point, position);
      group.positions.push(point.x, point.y, point.z);
      normal.set((geometry.normals?.[i] ?? 0) / scale.x, (geometry.normals?.[i + 1] ?? 1) / scale.y,
        (geometry.normals?.[i + 2] ?? 0) / scale.z);
      Vec3.transformQuat(normal, normal, rotation);
      normal.normalize();
      group.normals.push(normal.x, normal.y, normal.z);
      const uv = i / 3 * 2;
      group.uvs.push(geometry.uvs?.[uv] ?? 0, geometry.uvs?.[uv + 1] ?? 0);
    }
    for (const index of geometry.indices ?? []) group.indices.push(offset + index);
  }

  box(material: Material, position: Vec3, scale: Vec3, euler?: Vec3): void {
    this.add(material, primitives.box(), position, scale, euler);
  }

  cylinder(material: Material, position: Vec3, top: number, bottom: number, height: number,
    segments = 10, euler?: Vec3): void {
    this.add(material, primitives.cylinder(top, bottom, height, { radialSegments: segments }), position, Vec3.ONE, euler);
  }

  line(material: Material, start: Vec3, end: Vec3, width: number): void {
    const delta = Vec3.subtract(new Vec3(), end, start), length = delta.length();
    if (length < 0.001) return;
    // Cylinders point along local Y. Rotate that axis onto the segment.
    const geometry = primitives.cylinder(width, width, length, { radialSegments: 5 });
    const rotation = Quat.rotationTo(new Quat(), Vec3.UP, delta.normalize());
    const euler = new Vec3();
    Quat.toEuler(euler, rotation);
    this.add(material, geometry, Vec3.lerp(new Vec3(), start, end, 0.5), Vec3.ONE, euler);
  }

  build(parent: Node, name: string, ownedMeshes: Mesh[], castShadow = true): Node {
    const root = new Node(name);
    parent.addChild(root);
    for (const [material, geometry] of this.groups) {
      const node = new Node(`${name}_${material.name}`);
      root.addChild(node);
      const mesh = utils.createMesh(geometry);
      ownedMeshes.push(mesh);
      const renderer = node.addComponent(MeshRenderer);
      renderer.mesh = mesh;
      renderer.setSharedMaterial(material, 0);
      renderer.shadowCastingMode = castShadow ? 1 : 0;
      renderer.receiveShadow = 1;
    }
    return root;
  }
}
