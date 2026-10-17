export type SeawallSegment = readonly [number, number, number, number];

/** Duplicate shared hex edges count once; only real shared endpoints get a cap. */
export function seawallJunctions(segments: readonly SeawallSegment[], size: number) {
  const points = new Map<string, { x: number; y: number; edges: Set<string>; rays: {x:number;y:number}[] }>();
  const key = (x: number, y: number) => `${Math.round(x / size * 1000)},${Math.round(y / size * 1000)}`;
  for (const [x0, y0, x1, y1] of segments) {
    const a = key(x0, y0), b = key(x1, y1);
    const edge = [a, b].sort().join(':');
    for (const [x, y, k] of [[x0, y0, a], [x1, y1, b]] as const) {
      let point = points.get(k);
      if (!point) { point = { x, y, edges: new Set(), rays: [] }; points.set(k, point); }
      if (!point.edges.has(edge)) {
        const dx = k === a ? x1-x0 : x0-x1, dy = k === a ? y1-y0 : y0-y1;
        const length = Math.hypot(dx,dy);
        if (length > 0) point.rays.push({x:dx/length,y:dy/length});
      }
      point.edges.add(edge);
    }
  }
  return [...points.values()].filter(point => point.edges.size >= 2);
}

/** Intersect the actual offset wall outlines to form a flush miter, no cap block. */
export function seawallJointPolygon(joint: ReturnType<typeof seawallJunctions>[number], halfWidth: number, reach = halfWidth*3) {
  const normals = joint.rays.map(ray => ({x:-ray.y, y:ray.x}));
  if (joint.rays.length === 2) {
    const [u,v]=joint.rays, [a,b]=normals, dot=a.x*b.x+a.y*b.y;
    if (Math.abs(dot)<.9999) {
      const m={x:(a.x-b.x)*halfWidth/(1-dot),y:(a.y-b.y)*halfWidth/(1-dot)};
      const length=reach;
      // Extend inside each existing strip to erase its old butt-end outline.
      // The two miter points remain exactly on the offset boundary intersection.
      return [
        {x:u.x*length+a.x*halfWidth,y:u.y*length+a.y*halfWidth},m,
        {x:v.x*length-b.x*halfWidth,y:v.y*length-b.y*halfWidth},
        {x:v.x*length+b.x*halfWidth,y:v.y*length+b.y*halfWidth},
        {x:-m.x,y:-m.y},
        {x:u.x*length-a.x*halfWidth,y:u.y*length-a.y*halfWidth},
      ].map(p=>({x:joint.x+p.x,y:joint.y+p.y}));
    }
  }
  const vertices: {x:number;y:number}[] = [];
  for (const n of normals) for (const sign of [-1,1]) vertices.push({x:n.x*halfWidth*sign,y:n.y*halfWidth*sign});
  for (let i=0;i<normals.length;i++) for (let j=i+1;j<normals.length;j++) {
    const a=normals[i],b=normals[j], dot=a.x*b.x+a.y*b.y;
    if (Math.abs(dot) > .9999) continue;
    const x=(a.x-b.x)*halfWidth/(1-dot), y=(a.y-b.y)*halfWidth/(1-dot);
    for (const sign of [-1,1]) vertices.push({x:x*sign,y:y*sign});
  }
  vertices.sort((a,b)=>a.x-b.x || a.y-b.y);
  const cross = (a:typeof vertices[number],b:typeof a,c:typeof a) => (b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
  const lower:typeof vertices=[],upper:typeof vertices=[];
  for (const v of vertices) { while(lower.length>=2 && cross(lower[lower.length-2],lower[lower.length-1],v)<=0) lower.pop(); lower.push(v); }
  for (const v of [...vertices].reverse()) { while(upper.length>=2 && cross(upper[upper.length-2],upper[upper.length-1],v)<=0) upper.pop(); upper.push(v); }
  lower.pop(); upper.pop();
  return [...lower,...upper].map(v=>({x:joint.x+v.x,y:joint.y+v.y}));
}
