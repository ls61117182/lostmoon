import { director, EffectAsset, Material, Node, Rect, resources, Size, Sprite, SpriteFrame, UITransform, Vec4 } from 'cc';
import type { Tile } from '../core/types';
import { GROUND_RADIUS, GROUND_CHUNK_SIZE, terrainGroundFingerprint, type TerrainMaterialBundle } from './TerrainGroundRaster';
import { TerrainGroundGpuData, type GpuChunkPlan } from './TerrainGroundGpuData';
import { TerrainGroundGpuBaker, type GpuBakedChunk } from './TerrainGroundGpuBaker';

interface CachedChunk extends GpuBakedChunk { key:string; fingerprint:string; node:Node; frame:SpriteFrame; material:Material|null; x:number; y:number; }
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
  draw(tiles:readonly Tile[],winter:boolean,hexSize:number,offsetX:number,offsetY:number,europeanSummer=false):void {
    if(this.destroyed)return;
    this.visible=true;this.layout={size:hexSize,x:offsetX,y:offsetY};
    const selected=winter&&this.bundle.europeanWinter?this.bundle.europeanWinter:europeanSummer&&!winter&&this.bundle.europeanSummer?this.bundle.europeanSummer:this.bundle;
    const style=(selected===this.bundle.europeanWinter?'europe-winter':selected===this.bundle.europeanSummer?'europe-summer':'base')+(winter?'|winter':'|summer');
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
    try {this.baker.bake(plan,this.winter,this.resolution,result=>{
      if(this.destroyed||epoch!==this.epoch){result.texture.destroy();result.mask?.destroy();return;}
      this.busy=false;
      const previous=this.chunks.get(plan.key);if(previous)this.releaseChunk(previous);
      const frame=new SpriteFrame();frame.texture=result.texture;const size=GROUND_CHUNK_SIZE*this.resolution+2;
      frame.rect=new Rect(0,0,size,size);frame.originalSize=new Size(size,size);frame.packable=false;
      const node=new Node('ContinuousTerrainChunk');node.layer=this.parent.layer;node.addComponent(UITransform);
      const sprite=node.addComponent(Sprite);sprite.sizeMode=Sprite.SizeMode.CUSTOM;sprite.spriteFrame=frame;
      this.parent.addChild(node);node.setSiblingIndex(0);
      const chunk:CachedChunk={...result,key:plan.key,fingerprint:plan.fingerprint,node,frame,material:null,x:plan.x,y:plan.y};
      this.chunks.set(plan.key,chunk);this.applyWaterMaterial(chunk);this.queue.shift();this.completedChunks++;
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
  update(dt:number):void {
    if(this.destroyed||!Number.isFinite(dt)||dt<=0)return;
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
  private releaseChunk(c:CachedChunk):void {c.node.destroy();c.material?.destroy();c.frame.destroy();c.texture.destroy();c.mask?.destroy();}
  private releaseChunks():void {for(const c of this.chunks.values())this.releaseChunk(c);this.chunks.clear();}
  destroy():void {this.destroyed=true;this.requested=false;this.cancelWork(true);this.releaseChunks();this.data=null;}
}
