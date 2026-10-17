import { Color, Graphics } from 'cc';
import { seawallJunctions, seawallJointPolygon, SeawallSegment } from '../core/SeawallJunctions';

/** Fill the corner with the intersection of the two strips' offset outlines. */
export function drawSeawallJoints(g: Graphics, segments: readonly SeawallSegment[], size: number, center?: {x:number;y:number}) {
  const joints=seawallJunctions(segments,size).filter(p=>!center || Math.hypot(p.x-center.x,p.y-center.y)<=size*1.01);
  for (const [width,color] of [
    [.15,new Color(92,95,91,255)],
    [.129,new Color(174,178,167,255)],
    [.079,new Color(211,213,199,255)],
  ] as const) {
    g.fillColor=color;
    const pairs=joints.flatMap(joint=>joint.rays.flatMap((ray,i)=>joint.rays.slice(i+1).map(other=>({...joint,rays:[ray,other]}))));
    for (const joint of pairs) {
      const polygon=seawallJointPolygon(joint,size*width,size*.18);
      if (polygon.length<3) continue;
      polygon.forEach((p,i)=>{if(i)g.lineTo(p.x,p.y);else g.moveTo(p.x,p.y);});
      g.close();g.fill();
    }
  }
}

/** Native map art: strictly overhead footprints, no visible vertical faces. */
export function drawBeachOverlays(g: Graphics, x: number, y: number, size: number, crater: boolean, steel: boolean) {
  if (crater) {
    const colors = [new Color(166, 144, 109, 110), new Color(207, 184, 141, 175), new Color(190, 163, 118, 210), new Color(153, 129, 96, 230), new Color(130, 109, 82, 245), new Color(111, 94, 73, 245), new Color(99, 84, 66, 245)];
    for (let ring = 0; ring < colors.length; ring++) {
      g.fillColor = colors[ring];
      const radius = size * [.48, .44, .405, .365, .33, .285, .23][ring];
      for (let i = 0; i < 28; i++) {
        const a = i * Math.PI / 14, r = radius * (1 + .065 * Math.sin(i * 2.7) + .035 * Math.cos(i * .9));
        const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r * .91;
        if (!i) g.moveTo(px, py); else g.lineTo(px, py);
      }
      g.close(); g.fill();
    }
    // Sparse ejecta and bowl speckles soften the ring silhouette without perspective.
    for (let i = 0; i < 26; i++) {
      const a = i * 2.39996, radius = size * (i < 15 ? .46 + .075 * Math.sin(i * 3.1) : .10 + .13 * Math.abs(Math.sin(i * 1.7)));
      g.fillColor = i % 2 ? new Color(115, 98, 75, 130) : new Color(177, 153, 114, 145);
      g.circle(x + Math.cos(a) * radius, y + Math.sin(a) * radius * .91, size * (.009 + .008 * Math.abs(Math.sin(i * 4.3)))); g.fill();
    }
  }
  if (steel) {
    // Exactly three obstacles per hex; the upright beam is an end-on square.
    for (const [dx, dy, angle] of [[-.38, .18, .15], [.34, .22, -.22], [.02, -.35, .48]]) {
      const cx = x + dx * size, cy = y + dy * size, arm = size * .17;
      for (const turn of [Math.PI / 4, -Math.PI / 4]) {
        const a = angle + turn, ux = Math.cos(a), uy = Math.sin(a);
        g.lineWidth = size * .075; g.strokeColor = new Color(47, 47, 44, 255);
        g.moveTo(cx - ux * arm, cy - uy * arm); g.lineTo(cx + ux * arm, cy + uy * arm); g.stroke();
        g.lineWidth = size * .042; g.strokeColor = new Color(99, 95, 84, 255);
        g.moveTo(cx - ux * arm, cy - uy * arm); g.lineTo(cx + ux * arm, cy + uy * arm); g.stroke();
      }
      g.fillColor = new Color(137, 114, 87, 255);
      g.rect(cx - size * .028, cy - size * .028, size * .056, size * .056); g.fill();
    }
  }
  g.lineWidth = 1;
}

export function drawBeachEdge(g: Graphics, x0: number, y0: number, x1: number, y1: number, size: number, kind: 'wire' | 'seawall', state = 1) {
  const dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy) || 1, nx = -dy / len, ny = dx / len;
  if (kind === 'seawall') {
    // Overhead coastal structure: broad concrete footing, cap slabs, buttress
    // footprints and rubble at its base. All shapes lie in the ground plane.
    const point = (u: number, v: number) => ({ x: x0 + dx * u + nx * size * v, y: y0 + dy * u + ny * size * v });
    const polygon = (vertices: readonly (readonly [number, number])[], color: Color) => {
      g.fillColor = color;
      vertices.forEach(([u, v], index) => { const p = point(u, v); if (!index) g.moveTo(p.x, p.y); else g.lineTo(p.x, p.y); });
      g.close(); g.fill();
    };
    const line = (vertices: readonly (readonly [number, number])[], color: Color, width: number) => {
      g.strokeColor = color; g.lineWidth = width;
      vertices.forEach(([u, v], index) => { const p = point(u, v); if (!index) g.moveTo(p.x, p.y); else g.lineTo(p.x, p.y); });
      g.stroke();
    };
    // Soft ground contact does not suggest a visible vertical wall face.
    polygon([[0,-.18],[1,-.18],[1,.18],[0,.18]], new Color(107, 99, 81, 90));
    // Two projecting supports are seen only as solid trapezoidal top footprints.
    for (const u of [.23, .77]) {
      polygon([[u-.075,-.13],[u+.075,-.13],[u+.05,-.26],[u-.05,-.26]], new Color(93, 96, 91, 255));
      polygon([[u-.06,-.13],[u+.06,-.13],[u+.037,-.245],[u-.037,-.245]], new Color(163, 165, 156, 255));
    }
    polygon([[0,-.15],[1,-.15],[1,.145],[.81,.15],[.78,.13],[.49,.15],[.46,.132],[0,.15]], new Color(92, 95, 91, 255));
    polygon([[0,-.128],[1,-.128],[1,.12],[.81,.13],[.78,.11],[.49,.13],[.46,.112],[0,.13]], new Color(174, 178, 167, 255));
    // A thick pale coping reads as a concrete wall, rather than road markings.
    for (let k = 0; k < 3; k++) {
      const a = k / 3 + .008, b = (k + 1) / 3 - .008;
      polygon([[a,-.076],[b,-.076],[b,.063],[b-.028,.08],[a,.08]], new Color(211-k*3, 213-k*3, 199-k*2, 255));
      line([[a,-.076],[b,-.076]], new Color(128, 133, 127, 255), Math.max(.55,size*.014));
      // Tiny mottled aggregate stays quieter than the outline at game scale.
      for (let i = 0; i < 5; i++) {
        const p = point(a + (b-a)*(i+.5)/5, .025*Math.sin(i*2.7+k));
        g.fillColor = new Color(120, 126, 120, 65);
        g.circle(p.x, p.y, size*(.007+.003*(i%2))); g.fill();
      }
    }
    for (const u of [1/3, 2/3]) line([[u,-.13],[u,.13]], new Color(99, 105, 100, 220), Math.max(.7,size*.014));
    // Short hairline cracks and chipped edges, never an extruded side facade.
    line([[.10,.11],[.14,.025],[.18,.015],[.20,-.035]], new Color(102, 112, 106, 155), Math.max(.45,size*.009));
    line([[.66,-.12],[.64,-.025],[.69,.01]], new Color(102, 112, 106, 155), Math.max(.45,size*.009));
    // A few irregular armour stones identify the structure as a coastal defence.
    for (const [u,v,r] of [[.08,.19,.033],[.32,.20,.044],[.56,.19,.035],[.91,.20,.045]]) {
      const vertices: [number,number][] = [];
      for (let i=0;i<6;i++) {
        const angle=i*Math.PI/3, radius=r*(1+.13*Math.sin(i*2.1+u));
        vertices.push([u+Math.cos(angle)*radius*size/len,v+Math.sin(angle)*radius]);
      }
      polygon(vertices,new Color(123,133,128,255));
      const p=point(u-.009,v+.008); g.fillColor=new Color(188,194,179,225); g.circle(p.x,p.y,size*r*.43); g.fill();
    }
  } else {
    const damaged = state === 2;
    g.strokeColor = damaged ? new Color(126, 116, 94, 170) : new Color(58, 57, 48, 255);
    g.lineWidth = Math.max(.8, size * .018);
    for (let k = 0; k < 7; k++) {
      if (damaged && k >= 2 && k <= 4) continue;
      const cx = x0 + dx * (k + .5) / 7, cy = y0 + dy * (k + .5) / 7;
      for (let i = 0; i <= 16; i++) {
        const a = i * Math.PI / 8, along = Math.cos(a) * len * .095, across = Math.sin(a) * size * (damaged ? .022 : .047);
        const px = cx + dx / len * along + nx * across, py = cy + dy / len * along + ny * across;
        if (!i) g.moveTo(px, py); else g.lineTo(px, py);
      }
      g.stroke();
      // Short crossed barbs remain visible at map zoom.
      if (!damaged && k % 2 === 0) {
        g.moveTo(cx - size * .028, cy - size * .028); g.lineTo(cx + size * .028, cy + size * .028); g.stroke();
      }
    }
    g.fillColor = damaged ? new Color(115, 105, 83, 180) : new Color(65, 61, 50, 255);
    for (const f of [.12, .88]) { g.circle(x0 + dx * f, y0 + dy * f, size * .026); g.fill(); }
  }
  g.lineWidth = 1;
}
