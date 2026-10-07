import { Camera, Canvas, Color, director, Director, EffectAsset, Material, Node, RenderTexture, Sprite, SpriteFrame, Texture2D, UITransform, Vec4 } from 'cc';
import { GROUND_CHUNK_SIZE } from './TerrainGroundRaster';
import { TerrainGroundGpuData, type GpuChunkPlan } from './TerrainGroundGpuData';

export interface GpuBakedChunk { texture:RenderTexture; mask:RenderTexture|null; padding:number; }
/** One isolated offscreen job at a time. No readPixels, canvas, CPU colour
 * rasterization, or per-frame rebaking. AFTER_DRAW acknowledges submitted work. */
export class TerrainGroundGpuBaker {
  private atlas:Texture2D;
  private root:Node;
  private frame:SpriteFrame;
  private cancelled=false;
  private cleanupJob:(()=>void)|null=null;
  constructor(private parent:Node,private data:TerrainGroundGpuData,private effect:EffectAsset) {
    const source=data.atlas();this.atlas=this.upload(source.width,source.height,source.pixels,false);
    this.root=new Node('TerrainGpuBake');
    // Keep it independent of map transforms and UI layers. Main cameras cannot
    // see the distant quad even if their visibility mask includes custom bits.
    this.root.setPosition(1000000,1000000,0);parent.scene!.addChild(this.root);
    this.frame=new SpriteFrame();this.frame.texture=this.atlas;this.frame.packable=false;
  }
  private upload(width:number,height:number,pixels:Uint8Array,nearest:boolean):Texture2D {
    const texture=new Texture2D();texture.reset({width,height});
    texture.setWrapMode(Texture2D.WrapMode.CLAMP_TO_EDGE,Texture2D.WrapMode.CLAMP_TO_EDGE);
    const filter=nearest?Texture2D.Filter.NEAREST:Texture2D.Filter.LINEAR;
    texture.setFilters(filter,filter);texture.uploadData(pixels);return texture;
  }
  bake(plan:GpuChunkPlan,winter:boolean,resolution:number,complete:(chunk:GpuBakedChunk)=>void):void {
    if(this.cancelled||this.cleanupJob)throw new Error('Terrain bake job unavailable');
    const size=GROUND_CHUNK_SIZE*resolution+2,padding=1/resolution,span=GROUND_CHUNK_SIZE+padding*2;
    const encoded=this.data.tileData(plan.tiles,winter);
    const ground=this.upload(encoded.width,encoded.height,encoded.ground,true),roads=this.upload(encoded.width,encoded.height,encoded.roads,true);
    const job=new Node('TerrainGpuChunkJob');this.root.addChild(job);
    const textures:RenderTexture[]=[],materials:Material[]=[];
    const layer=1<<19;
    const cameras:Camera[]=[];
    const dispose=()=>{
      director.off(Director.EVENT_AFTER_DRAW,afterDraw);
      for(const camera of cameras){camera.enabled=false;camera.targetTexture=null;}
      job.destroy();for(const material of materials)material.destroy();ground.destroy();roads.destroy();this.cleanupJob=null;
    };
    const afterDraw=()=>{
      dispose();if(this.cancelled){for(const texture of textures)texture.destroy();return;}
      complete({texture:textures[0],mask:textures[1]??null,padding});
    };
    this.cleanupJob=()=>{dispose();for(const texture of textures)texture.destroy();};
    try {
      for(let pass=0;pass<(encoded.hasWater?2:1);pass++) {
        const target=new RenderTexture();target.reset({width:size,height:size});
        target.setWrapMode(Texture2D.WrapMode.CLAMP_TO_EDGE,Texture2D.WrapMode.CLAMP_TO_EDGE);
        target.setFilters(Texture2D.Filter.LINEAR,Texture2D.Filter.LINEAR);textures.push(target);
        const material=new Material();material.initialize({effectAsset:this.effect});materials.push(material);
        material.setProperty('terrainAtlas',this.atlas);material.setProperty('tileGround',ground);material.setProperty('tileRoads',roads);
        material.setProperty('chunkBounds',new Vec4(plan.x-padding,plan.y-padding,span,span));
        material.setProperty('tileBounds',new Vec4(encoded.q,encoded.r,encoded.width,encoded.height));
        const bundle=this.data.bundle;
        material.setProperty('terrainStyle',new Vec4(winter?1:0,bundle.fieldBasedLand?1:0,bundle.curvedRoads?1:0,bundle.winterArtwork?1:0));
        material.setProperty('bakeOptions',new Vec4(pass,bundle.materials.road_surface?1:0,bundle.materials.winter_yard?1:0,0));
        // Separate locations, so each camera sees only its own output quad.
        const canvasNode=new Node('TerrainBakeCanvas');canvasNode.layer=layer;job.addChild(canvasNode);canvasNode.setPosition(pass*span*3,0,0);
        canvasNode.addComponent(UITransform).setContentSize(span,span);
        const canvas=canvasNode.addComponent(Canvas);canvas.alignCanvasWithScreen=false;
        const quad=new Node('TerrainBakeQuad');quad.layer=layer;canvasNode.addChild(quad);
        quad.addComponent(UITransform).setContentSize(span,span);
        const sprite=quad.addComponent(Sprite);sprite.sizeMode=Sprite.SizeMode.CUSTOM;sprite.spriteFrame=this.frame;sprite.customMaterial=material;
        const view=new Node('TerrainBakeCamera');job.addChild(view);view.setPosition(pass*span*3,0,10);
        const camera=view.addComponent(Camera);camera.projection=Camera.ProjectionType.ORTHO;camera.orthoHeight=span/2;
        camera.near=1;camera.far=20;camera.visibility=layer;camera.clearFlags=Camera.ClearFlag.SOLID_COLOR;
        camera.clearColor=new Color(0,0,0,0);camera.targetTexture=target;cameras.push(camera);
        canvas.cameraComponent=camera;
      }
      director.once(Director.EVENT_AFTER_DRAW,afterDraw);
    }catch(error){this.cleanupJob?.();throw error;}
  }
  cancel():void {this.cleanupJob?.();}
  destroy():void {this.cancelled=true;this.cancel();this.root.destroy();this.frame.destroy();this.atlas.destroy();}
}
