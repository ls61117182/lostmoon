'use strict';
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const root = path.resolve(__dirname, '..');
const source = path.join(root, 'source_art/tanks/panzer4_f');
async function main() {
  // Uniform scale: turret roof width matches G hull and the F1 overhead plan.
  // Coordinates were measured on the saved generated image, before cropping.
  const scale = 0.146;
  const {data, info} = await sharp(path.join(source, 'turret-user-composited.png')).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  await sharp(data,{raw:info}).resize(Math.round(info.width*scale), Math.round(info.height*scale)).png().toFile(path.join(source,'turret-selected.png'));
  const point = (x,y) => [x*scale,y*scale];
  const manifest = {
    '$schema':'./tank-art-manifest.schema.json', schemaVersion:1, kind:'panzer4_f',
    notes:'User turret raster retained except approved forward socket redraw. Gun root and curved mantlet refined against newest detail reference; approximate short-gun placement retained. Grey hull palette; uniform final scale 0.146.',
    inputs:{
      hull:{path:'assets/resources/textures/units/panzer4_top_hull.png',background:'alpha'},
      turret:{path:'source_art/tanks/panzer4_f/turret-selected.png',background:'alpha'},
      destroyed:{path:'assets/resources/textures/units/panzer4_top_destroyed.png',background:'alpha'},
    },
    processing:{alphaThreshold:32,commonScale:1,outlinePixels:0,hullPadding:[1,1,1,1],turretPadding:[1,1,1,1]},
    sourceGeometry:{hullPivot:[79,38],turretPivot:point(463,230),muzzle:point(38,235),commanderHatch:point(523,230)},
  };
  fs.writeFileSync(path.join(root,'data/tank_art/panzer4_f.json'),JSON.stringify(manifest,null,2)+'\n');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
