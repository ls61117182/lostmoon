import { Node, Rect, Size, Sprite, SpriteFrame, Texture2D, UITransform } from 'cc';
import type { Tile } from '../core/types';
import { GROUND_RADIUS, GROUND_CHUNK_SIZE, TerrainGroundRaster, terrainGroundFingerprint, type TerrainMaterialBundle } from './TerrainGroundRaster';

/** Cached chunk sprites; no material decoding, rasterization or GPU upload on
 * unit movement, aim previews, camera movement, or ordinary redraws. */
export class TerrainGroundRenderer {
  private raster:TerrainGroundRaster;
  private europeanSummerRaster:TerrainGroundRaster|null=null;
  private europeanWinterRaster:TerrainGroundRaster|null=null;
  private fingerprint='';
  private chunks:Array<{node:Node;frame:SpriteFrame;texture:Texture2D;x:number;y:number;width:number;height:number;padding:number}>=[];
  constructor(private parent:Node,bundle:TerrainMaterialBundle) {
    this.raster=new TerrainGroundRaster(bundle);
    if(bundle.europeanWinter)this.europeanWinterRaster=new TerrainGroundRaster(bundle.europeanWinter);
    if(bundle.europeanSummer)this.europeanSummerRaster=new TerrainGroundRaster(bundle.europeanSummer);
  }
  draw(tiles:readonly Tile[],winter:boolean,hexSize:number,offsetX:number,offsetY:number,europeanSummer=false):void {
    const selected=winter&&this.europeanWinterRaster?this.europeanWinterRaster:europeanSummer&&!winter&&this.europeanSummerRaster?this.europeanSummerRaster:this.raster;
    const resolution=selected===this.europeanSummerRaster||selected===this.europeanWinterRaster?2:1;
    const signature=(selected===this.europeanWinterRaster?'europe-winter|':selected===this.europeanSummerRaster?'europe-summer|':'base|')+terrainGroundFingerprint(tiles,winter);
    if(signature!==this.fingerprint){
      this.clear();
      try {
        for(const origin of selected.chunkOrigins(tiles)){
          const chunk=selected.renderChunk(tiles,winter,origin.x,origin.y,GROUND_CHUNK_SIZE,GROUND_CHUNK_SIZE,resolution);
          const texture=new Texture2D();texture.reset({width:chunk.textureWidth,height:chunk.textureHeight});
          // Texture2D defaults to REPEAT. Linear sampling at a full-frame UV
          // edge would then pull opaque terrain from the opposite side into
          // transparent off-map pixels, producing long rectangular ghost lines.
          texture.setWrapMode(Texture2D.WrapMode.CLAMP_TO_EDGE,Texture2D.WrapMode.CLAMP_TO_EDGE);
          texture.setFilters(Texture2D.Filter.LINEAR,Texture2D.Filter.LINEAR);texture.uploadData(chunk.pixels);
          // Display the matching world-space padding as a small overlap.
          // Abutting sprite meshes can expose a hairline at fractional screen
          // positions even when the adjacent texture pixels match exactly.
          const frame=new SpriteFrame();frame.texture=texture;frame.rect=new Rect(0,0,chunk.textureWidth,chunk.textureHeight);frame.originalSize=new Size(chunk.textureWidth,chunk.textureHeight);frame.packable=false;
          const node=new Node('ContinuousTerrainChunk');node.layer=this.parent.layer;node.addComponent(UITransform);
          const sprite=node.addComponent(Sprite);sprite.sizeMode=Sprite.SizeMode.CUSTOM;sprite.spriteFrame=frame;this.parent.addChild(node);node.setSiblingIndex(0);
          this.chunks.push({node,frame,texture,x:chunk.x,y:chunk.y,width:chunk.width,height:chunk.height,padding:1/resolution});
        }
        this.fingerprint=signature;
      } catch(error){this.clear();throw error;}
    }
    const scale=hexSize/GROUND_RADIUS;
    for(const c of this.chunks){c.node.active=true;c.node.getComponent(UITransform)!.setContentSize((c.width+2*c.padding)*scale,(c.height+2*c.padding)*scale);c.node.setPosition((c.x+c.width/2)*scale+offsetX,-(c.y+c.height/2)*scale+offsetY,0);}
  }
  hide():void {for(const c of this.chunks)c.node.active=false;}
  private clear():void {for(const c of this.chunks){c.node.destroy();c.frame.destroy();c.texture.destroy();}this.chunks=[];this.fingerprint='';}
  destroy():void {this.clear();}
}
