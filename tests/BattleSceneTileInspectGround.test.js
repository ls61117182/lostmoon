const assert=require('node:assert/strict');
const sceneMethods=require('./helpers/BattleSceneMethods.cjs');
class Node{constructor(name){this.name=name;this.children=[];this.angle=0;}addChild(n){this.children.push(n);n.parent=this;}addComponent(Type){const c=new Type();c.node=this;return c;}setPosition(x,y){this.position={x,y};}}
class UITransform{setContentSize(){}}
class Graphics{}
class Color{}
const Scene=sceneMethods(['addTileInspectTilePreview','paintTileInspectPreview'],{
 Node,UITransform,Graphics,Color,t:key=>key,tileHasBridge:tile=>!!tile.bridgeEnds,
 neighbor:()=>({q:0,r:0}),drawBeachOverlays:()=>{},drawSeawallJoints:()=>{},
 HorizontalTextAlignment:{CENTER:0},VerticalTextAlignment:{CENTER:0},
});
for(const cached of [true,false])for(const rotation of [0,90]){
 const scene=new Scene(),calls=[],tile={pos:{q:2,r:3},terrain:'water',bridgeEnds:[1,4],roads:[false,true,false,false,true,false]};
 scene.node={layer:1};scene.g={original:true};const original=scene.g;
 scene.mission={data:{cameraRotation:rotation},map:{get:()=>undefined}};
 scene.continuousTerrain={addTilePreview:(parent,q,r,cx,cy,hexR)=>{calls.push(['cached',parent,q,r,cx,cy,hexR]);return cached;}};
 for(const name of ['addTileInspectTerrainSprite','addTileInspectBridgeSurfaceSprite','addTileInspectRoadSurfaceSprite',
   'addTileInspectUrbanBuildingSprite','addTileInspectForestSprites','addTileInspectHedgeSprites',
   'drawWaterBankOverlay','drawBridgeOverlay','drawRoadOverlay'])scene[name]=(...args)=>calls.push([name,...args]);
 scene.terrainSpriteFrameFor=()=>({});scene.bridgeSurfaceSpriteInfo=()=>({});scene.drawBeachTileEdges=()=>{};
 scene.usesWinterTerrainVisuals=()=>false;scene.makeBattleModalLabel=()=>({});
 const parent=new Node('modal');scene.addTileInspectTilePreview(parent,tile,50,-20,38);
 const cacheCall=calls.find(c=>c[0]==='cached');assert.deepEqual(cacheCall.slice(2),[2,3,0,24,38]);
 for(const name of ['addTileInspectTerrainSprite','addTileInspectBridgeSurfaceSprite','addTileInspectRoadSurfaceSprite','drawWaterBankOverlay'])
   assert.equal(calls.filter(c=>c[0]===name).length,cached?0:1,`${name}: cached crop must bypass the old terrain/shore/bridge painter`);
 assert.equal(calls.filter(c=>c[0]==='drawBridgeOverlay').length,0,'painted bridges are not drawn over again');
 assert(calls.some(c=>c[0]==='addTileInspectHedgeSprites'),'scenery still layers over the ground');
 assert.equal(parent.children[0].children[0].angle,rotation,'the whole crop follows camera rotation');
 assert.equal(scene.g,original,'preview rendering restores the map graphics context');
}
console.log('Tile inspector shares map ground/shore/bridge pixels, preserves rotation/scenery, and retains renderer fallback.');
