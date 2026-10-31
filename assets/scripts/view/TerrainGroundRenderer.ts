import { director, EffectAsset, Graphics, Mask, Material, Node, Rect, resources, Size, Sprite, SpriteFrame, UITransform, Vec4 } from 'cc';
import type { Tile } from '../core/types';
import type { EuropeanTerrainLook } from '../core/TerrainSeason';
import { GROUND_RADIUS, GROUND_CHUNK_SIZE, terrainGroundFingerprint, selectEuropeanTerrainBundle, type TerrainMaterialBundle } from './TerrainGroundRaster';
import { TerrainGroundGpuData, type GpuChunkPlan } from './TerrainGroundGpuData';
import { TerrainGroundGpuBaker, type GpuBakedChunk } from './TerrainGroundGpuBaker';

interface CachedChunk extends GpuBakedChunk { key:string; fingerprint:string; node:Node; frame:SpriteFrame; material:Material|null; x:number; y:number; }
interface TileGroundPreview { node:Node; x:number; y:number; scale:number; chunks:CachedChunk[]; }
/** GPU-composited immutable blocks. Camera/unit/UI redraws only transform sprites. */
export class TerrainGroundRenderer {
  private data:TerrainGroundGpuData|null=null;
  private baker:TerrainGroundGpuBaker|null=null;
  private bakeEffect:EffectAsset|null=null;
  private waterEffect:EffectAsset|null=null;
  private effectError:Error|null=null;
  private style='';
  private mapSignature='';
  private chunks=new Map<string,CachedChunk>();
  private previews=new Set<TileGroundPreview>();
  private queue:GpuChunkPlan[]=[];
  private busy=false;
  private completionPending=false;
  private requested=false;
  private completedChunks=0;
  private totalChunks=0;
  private epoch=0;
  private destroyed=false;
  private visible=false;
  private winter=false;
  private waterClock=new Vec4(0,0,0,0);
  private layout={size:48,x:0,y:0};
  /** Resolution is bounded independently of map zoom; mobile callers may use 1. */
  constructor(private parent:Node,private bundle:TerrainMaterialBundle,private resolution=1) {
    this.resolution=Math.max(1,Math.min(2,Math.floor(resolution)));
    resources.load('effects/terrain-bake',EffectAsset,(error,effect)=>{
      if(this.destroyed)return;
      if(error){this.effectError=new Error('GPU terrain effect unavailable: '+error);return;}
      this.bakeEffect=effect;
    });
    resources.load('effects/water-surface',EffectAsset,(error,effect)=>{
      if(this.destroyed||error)return;this.waterEffect=effect;
      for(const chunk of this.chunks.values())this.applyWaterMaterial(chunk);
    });
  }
  get loading():boolean {return this.requested&&(!this.bakeEffect||this.busy||this.queue.length>0);}
  get progress():number {return this.totalChunks?this.completedChunks/this.totalChunks:this.requested&&this.bakeEffect?1:0;}
  draw(tiles:readonly Tile[],winter:boolean,hexSize:number,offsetX:number,offsetY:number,europeanSummer=false,look:EuropeanTerrainLook=winter?'winter_snow':'summer'):void {
    if(this.destroyed)return;
    this.visible=true;this.layout={size:hexSize,x:offsetX,y:offsetY};
    const european=winter||europeanSummer;
    const selected=european?selectEuropeanTerrainBundle(this.bundle,look):this.bundle;
    const style=(european?`europe-${look}`:'base')+(winter?'|snow':'|bare');
    if(style!==this.style){this.cancelWork(true);this.releaseChunks();this.style=style;this.mapSignature='';this.data=new TerrainGroundGpuData(selected);}
    const signature=terrainGroundFingerprint(tiles,winter);
    if(this.requested&&signature===this.mapSignature){this.position();return;}
    this.mapSignature=signature;
    // Plan data is immutable for the duration of an asynchronous bake.
    const plans=this.data!.plans(tiles,winter);
    const wanted=plans.filter(p=>this.chunks.get(p.key)?.fingerprint!==p.fingerprint);
    const queueSignature=(items:GpuChunkPlan[])=>items.map(p=>p.key+':'+p.fingerprint).join('|');
    if(queueSignature(wanted)!==queueSignature(this.queue)) {
      this.cancelWork();this.queue=wanted.map(p=>({...p,tiles:p.tiles.map(t=>({...t,pos:{...t.pos},roads:t.roads?.slice() as typeof t.roads,bridgeEnds:t.bridgeEnds?.slice() as typeof t.bridgeEnds}))}));
      const keys=new Set(plans.map(p=>p.key));
      for(const [key,c]of this.chunks)if(!keys.has(key)){this.releaseChunk(c);this.chunks.delete(key);}
      this.completionPending=this.queue.length===0;
    }
    this.winter=winter;this.requested=true;this.totalChunks=plans.length;this.completedChunks=plans.length-wanted.length;
    this.position();
  }
  /** At most one chunk (two outputs) submitted per frame. No CPU rasterization. */
  advanceGeneration(_budgetMs=6):boolean {
    if(this.destroyed||!this.requested)return false;
    if(this.effectError)throw this.effectError;
    if(this.completionPending){this.completionPending=false;this.position();return true;}
    if(this.busy||!this.queue.length||!this.bakeEffect)return false;
    if(!this.baker)this.baker=new TerrainGroundGpuBaker(this.parent,this.data!,this.bakeEffect);
    const plan=this.queue[0],epoch=this.epoch;this.busy=true;
    // Only chunks near a painted summer bridge need denser colour/mask output.
    const resolution=!this.winter&&this.data!.bundle.bridgeArtwork&&plan.tiles.some(t=>t.terrain==='water'&&!!t.bridgeEnds)?Math.max(2,this.resolution):this.resolution;
    try {this.baker.bake(plan,this.winter,resolution,result=>{
      if(this.destroyed||epoch!==this.epoch){result.texture.destroy();result.mask?.destroy();return;}
      this.busy=false;
      const previous=this.chunks.get(plan.key);if(previous)this.releaseChunk(previous);
      const frame=new SpriteFrame();frame.texture=result.texture;const size=GROUND_CHUNK_SIZE*resolution+2;
      frame.rect=new Rect(0,0,size,size);frame.originalSize=new Size(size,size);frame.packable=false;
      const node=new Node('ContinuousTerrainChunk');node.layer=this.parent.layer;node.addComponent(UITransform);
      const sprite=node.addComponent(Sprite);sprite.sizeMode=Sprite.SizeMode.CUSTOM;sprite.spriteFrame=frame;
      this.parent.addChild(node);node.setSiblingIndex(0);
      const chunk:CachedChunk={...result,key:plan.key,fingerprint:plan.fingerprint,node,frame,material:null,x:plan.x,y:plan.y};
      this.chunks.set(plan.key,chunk);this.applyWaterMaterial(chunk);this.queue.shift();this.completedChunks++;
      this.refreshTilePreviews();
      this.completionPending=this.queue.length===0;this.position();
    });}catch(error){this.busy=false;this.cancelWork();throw error;}
    return false;
  }
  private position():void {
    const scale=this.layout.size/GROUND_RADIUS;
    for(const c of this.chunks.values()) {
      c.node.active=this.visible&&!this.loading;
      c.node.getComponent(UITransform)!.setContentSize((GROUND_CHUNK_SIZE+2*c.padding)*scale,(GROUND_CHUNK_SIZE+2*c.padding)*scale);
      c.node.setPosition((c.x+GROUND_CHUNK_SIZE/2)*scale+this.layout.x,-(c.y+GROUND_CHUNK_SIZE/2)*scale+this.layout.y,0);
    }
  }
  hide():void {this.visible=false;this.position();}
  /** Crop the actual baked ground in canonical map coordinates. The inspector
   * supplies its own artwork rotation; map zoom/pan never enter this crop.
   * Reuse the colour frames as a static preview: no readback or extra bake. */
  addTilePreview(parent:Node,q:number,r:number,cx:number,cy:number,hexRadius:number):boolean {
    if(this.destroyed||this.loading||!this.visible)return false;
    const x=Math.sqrt(3)*GROUND_RADIUS*(q+r*.5),y=1.5*GROUND_RADIUS*r;
    const chunks=this.tilePreviewChunks(x,y);if(!chunks)return false;
    const node=new Node('TileInspectBakedGround');node.layer=parent.layer;
    node.addComponent(UITransform).setContentSize(hexRadius*Math.sqrt(3),hexRadius*2);
    node.setPosition(cx,cy,0);parent.addChild(node);
    const mask=node.addComponent(Mask);mask.type=Mask.Type.GRAPHICS_STENCIL;
    // Mask starts with a rectangular path. Clear it before supplying the hex;
    // retain its transparent fill so the stencil itself never paints the UI.
    const graphics=mask.subComp as Graphics;graphics.clear();
    for(let i=0;i<6;i++) {
      const a=(-30+60*i)*Math.PI/180,px=hexRadius*Math.cos(a),py=hexRadius*Math.sin(a);
      if(i===0)graphics.moveTo(px,py);else graphics.lineTo(px,py);
    }
    graphics.close();graphics.fill();
    const preview:TileGroundPreview={node,x,y,scale:hexRadius/GROUND_RADIUS,chunks:[]};
    this.previews.add(preview);this.drawTilePreview(preview,chunks);return true;
  }
  private tilePreviewChunks(x:number,y:number):CachedChunk[]|null {
    const result:CachedChunk[]=[],halfWidth=GROUND_RADIUS*Math.sqrt(3)*.5;
    for(let row=Math.floor((y-GROUND_RADIUS)/GROUND_CHUNK_SIZE);row<=Math.floor((y+GROUND_RADIUS)/GROUND_CHUNK_SIZE);row++)
      for(let col=Math.floor((x-halfWidth)/GROUND_CHUNK_SIZE);col<=Math.floor((x+halfWidth)/GROUND_CHUNK_SIZE);col++) {
        const chunk=this.chunks.get(`${col*GROUND_CHUNK_SIZE},${row*GROUND_CHUNK_SIZE}`);if(!chunk)return null;result.push(chunk);
      }
    return result;
  }
  private clearTilePreview(preview:TileGroundPreview):void {
    preview.node.active=false;
    for(const child of [...preview.node.children]){child.active=false;child.destroy();}
    preview.chunks=[];
  }
  private drawTilePreview(preview:TileGroundPreview,chunks:CachedChunk[]):void {
    this.clearTilePreview(preview);
    for(const chunk of chunks) {
      const node=new Node('TileInspectGroundChunk');node.layer=preview.node.layer;
      node.addComponent(UITransform).setContentSize((GROUND_CHUNK_SIZE+2*chunk.padding)*preview.scale,(GROUND_CHUNK_SIZE+2*chunk.padding)*preview.scale);
      const sprite=node.addComponent(Sprite);sprite.sizeMode=Sprite.SizeMode.CUSTOM;sprite.spriteFrame=chunk.frame;
      node.setPosition((chunk.x+GROUND_CHUNK_SIZE/2-preview.x)*preview.scale,-(chunk.y+GROUND_CHUNK_SIZE/2-preview.y)*preview.scale,0);
      preview.node.addChild(node);
    }
    preview.chunks=chunks;preview.node.active=true;
  }
  private refreshTilePreviews():void {
    for(const preview of this.previews) {
      if(!preview.node.isValid){this.previews.delete(preview);continue;}
      const chunks=this.tilePreviewChunks(preview.x,preview.y);
      if(chunks&&(chunks.length!==preview.chunks.length||chunks.some((c,i)=>c!==preview.chunks[i])))this.drawTilePreview(preview,chunks);
    }
  }
  update(dt:number):void {
    if(this.destroyed||!Number.isFinite(dt)||dt<=0)return;
    for(const preview of this.previews)if(!preview.node.isValid)this.previews.delete(preview);
    this.waterClock.x+=Math.min(dt,.1);
    for(const c of this.chunks.values())if(c.node.active&&c.material) {
      c.material.setProperty('waterClock',this.waterClock);
      const rendered=c.node.getComponent(Sprite)!.getRenderMaterial(0);
      if(rendered&&rendered!==c.material)rendered.setProperty('waterClock',this.waterClock);
    }
  }
  private applyWaterMaterial(c:CachedChunk):void {
    if(!this.waterEffect||!c.mask||c.material)return;
    const material=new Material();material.initialize({effectAsset:this.waterEffect,defines:{USE_TEXTURE:true,SAMPLE_FROM_RT:true}});
    material.setProperty('waterMask',c.mask);material.setProperty('waterClock',this.waterClock);
    material.setProperty('chunkBounds',new Vec4(c.x-c.padding,c.y-c.padding,GROUND_CHUNK_SIZE+2*c.padding,GROUND_CHUNK_SIZE+2*c.padding));
    // Builtin sprite materials already flip render-target sampling. Match that
    // convention in the water vertex shader and undo it only for map coordinates.
    material.setProperty('waterUv',new Vec4(director.root!.device.capabilities.screenSpaceSignY>0?1:0,0,0,0));
    c.node.getComponent(Sprite)!.customMaterial=material;c.material=material;
  }
  private cancelWork(releaseBaker=false):void {
    this.epoch++;this.baker?.cancel();
    if(releaseBaker){this.baker?.destroy();this.baker=null;}
    this.busy=false;this.queue=[];this.completionPending=false;
  }
  private releaseChunk(c:CachedChunk):void {
    for(const preview of this.previews)if(preview.node.isValid&&preview.chunks.includes(c))this.clearTilePreview(preview);
    c.node.destroy();c.material?.destroy();c.frame.destroy();c.texture.destroy();c.mask?.destroy();
  }
  private releaseChunks():void {for(const c of this.chunks.values())this.releaseChunk(c);this.chunks.clear();}
  destroy():void {
    this.destroyed=true;this.requested=false;this.cancelWork(true);this.releaseChunks();this.data=null;
    for(const preview of this.previews)if(preview.node.isValid)preview.node.destroy();this.previews.clear();
  }
}
