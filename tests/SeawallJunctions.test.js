const fs=require('node:fs'),ts=require('typescript'),assert=require('node:assert/strict');
const {test}=require('node:test');
require.extensions['.ts']=(m,p)=>m._compile(ts.transpileModule(fs.readFileSync(p,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,p);
const {seawallJunctions,seawallJointPolygon}=require('../assets/scripts/core/SeawallJunctions.ts');
test('duplicate ownership does not turn free ends into junctions',()=>{
  assert.equal(seawallJunctions([[0,0,0,100],[0,100,0,0]],100).length,0);
});
test('turns and three-way junctions have exactly one shared cap',()=>{
  const edges=[[0,0,0,100],[0,0,86.6,-50]];
  assert.equal(seawallJunctions(edges,100).length,1);
  assert.equal(seawallJunctions([...edges,[0,0,-86.6,-50]],100).length,1);
});
test('explicit passage stays open; small projection drift is tolerated',()=>{
  assert.equal(seawallJunctions([[-120,0,-30,0],[30,0,120,0]],100).length,0);
  assert.equal(seawallJunctions([[0,50,0,-50],[.00001,-50.00001,86.6,-100]],100).length,1);
});
test('miter points follow both wall outlines in every hex rotation',()=>{
  for(let turn=0;turn<6;turn++) {
    const a=turn*Math.PI/3,b=a+2*Math.PI/3;
    const joint=seawallJunctions([[0,0,100*Math.cos(a),100*Math.sin(a)],[0,0,100*Math.cos(b),100*Math.sin(b)]],100)[0];
    const polygon=seawallJointPolygon(joint,15,18);
    assert.equal(polygon.length,6);
    for(const p of [polygon[1],polygon[4]]) {
      for(const ray of joint.rays) assert.ok(Math.abs(Math.abs(p.x*ray.y-p.y*ray.x)-15)<1e-8);
    }
    assert.ok(Math.abs(Math.hypot(polygon[1].x,polygon[1].y)-15/Math.cos(Math.PI/6))<1e-8);
  }
});
test('all concrete layers stop at the same distance inside the old strips',()=>{
  const joint=seawallJunctions([[0,0,100,0],[0,0,-50,86.6025403784]],100)[0];
  for(const width of [15,12.9,7.9]) {
    const polygon=seawallJointPolygon(joint,width,18);
    assert.ok(Math.abs(polygon[0].x-18)<1e-8);
    assert.ok(Math.abs(polygon[5].x-18)<1e-8);
  }
});
