export interface RuralBuilding { x:number; y:number; width:number; height:number; angle:number; scale:number; variant:number; }

/** Rectangle separation permits natural close groups without overlapping roofs. */
export function ruralBuildingsOverlap(a:RuralBuilding,b:RuralBuilding,padding=.025):boolean {
  const dx=b.x-a.x,dy=b.y-a.y;
  for(const angle of [a.angle,a.angle+Math.PI/2,b.angle,b.angle+Math.PI/2]){
    const extent=(roof:RuralBuilding)=>Math.abs(Math.cos(roof.angle-angle))*roof.width*.5+Math.abs(Math.sin(roof.angle-angle))*roof.height*.5;
    if(Math.abs(dx*Math.cos(angle)+dy*Math.sin(angle))>=extent(a)+extent(b)+padding)return false;
  }
  return true;
}

export interface RuralProp { name:'rural_hay'|'rural_well'; x:number; y:number; size:number; angle:number; }
export function ruralVillageProps(q:number,r:number,buildings:readonly RuralBuilding[],roadDistance?:(x:number,y:number)=>number,sizeMultiplier=1):RuralProp[]{
  let state=(Math.imul(q,92837111)^Math.imul(r,689287499)^0x726f6f66)>>>0;
  const random=()=>{state^=state<<13;state^=state>>>17;state^=state<<5;return(state>>>0)/4294967296;};
  const hayCount=2+Math.floor(random()*3),props:RuralProp[]=[];
  const candidates:Array<{x:number;y:number;priority:number}>=[];
  for(let iy=-12;iy<=12;iy++)for(let ix=-12;ix<=12;ix++)candidates.push({x:ix*.06,y:iy*.06,priority:random()});
  candidates.sort((a,b)=>a.priority-b.priority);
  const names:Array<RuralProp['name']>=[...(!roadDistance?['rural_well' as const]:[]),...Array<RuralProp['name']>(hayCount).fill('rural_hay')];
  for(const name of names){
    const size=(name==='rural_well'?.13:.13+random()*.035)*sizeMultiplier, radius=size*.71;
    for(const p of candidates){
      let valid=true;
      for(let i=0;i<6;i++)if(p.x*Math.cos(i*Math.PI/3)+p.y*Math.sin(i*Math.PI/3)+radius>.84)valid=false;
      if(!valid||roadDistance&&roadDistance(p.x,p.y)<radius+.025)continue;
      if(buildings.some(b=>{
        const dx=p.x-b.x,dy=p.y-b.y,c=Math.cos(b.angle),s=Math.sin(b.angle);
        return Math.abs(dx*c+dy*s)<b.width*.5+radius+.02&&Math.abs(-dx*s+dy*c)<b.height*.5+radius+.02;
      }))continue;
      if(props.some(o=>Math.hypot(p.x-o.x,p.y-o.y)<radius+o.size*.71+.025))continue;
      props.push({name,x:p.x,y:p.y,size,angle:name==='rural_hay'?random()*Math.PI:0});break;
    }
  }
  if(props.length<names.length&&sizeMultiplier>.25)return ruralVillageProps(q,r,buildings,roadDistance,sizeMultiplier*.85);
  return props;
}

/** Coordinates use hex radius 1 and Y-up. Buildings remain stable across redraws. */
export function ruralBuildingLayout(q:number,r:number,roadDistance?:(x:number,y:number)=>number):RuralBuilding[]{
  let state=(Math.imul(q,73856093)^Math.imul(r,19349663)^0x5f3759df)>>>0;
  const random=()=>{state^=state<<13;state^=state>>>17;state^=state<<5;return(state>>>0)/4294967296;};
  const target=roadDistance?4:6,minimum=roadDistance?3:5;
  const scales=Array.from({length:target},()=>.9+random()*.2),firstVariant=Math.floor(random()*4);
  const candidates:Array<{x:number;y:number;angle:number;priority:number}>=[];
  for(let iy=-13;iy<=13;iy++)for(let ix=-13;ix<=13;ix++){
    const x=ix*.06,y=iy*.06;
    if(Math.hypot(x,y)>.79)continue;
    let angle=random()*Math.PI;
    if(roadDistance){
      const e=.003,gx=roadDistance(x+e,y)-roadDistance(x-e,y),gy=roadDistance(x,y+e)-roadDistance(x,y-e);
      angle=Math.atan2(gy,gx)+Math.PI/2;
    }
    candidates.push({x,y,angle,priority:random()});
  }
  const valid=(b:RuralBuilding,placed:RuralBuilding[])=>{
    const c=Math.cos(b.angle),s=Math.sin(b.angle);
    for(const u of [-.5,0,.5])for(const v of [-.5,0,.5]){
      const x=b.x+u*b.width*c-v*b.height*s,y=b.y+u*b.width*s+v*b.height*c;
      for(let i=0;i<6;i++)if(x*Math.cos(i*Math.PI/3)+y*Math.sin(i*Math.PI/3)>.866-.025)return false;
      if(roadDistance&&roadDistance(x,y)<.025)return false;
    }
    return placed.every(o=>!ruralBuildingsOverlap(b,o));
  };
  // Reduce the shared baseline when a complicated road junction leaves little space.
  // Individual variation always remains within 90–110 percent of that baseline.
  for(const previousBase of [.38,.34,.30,.26,.22,.18,.14]){
    const base=previousBase*1.1;
    let best:RuralBuilding[]=[];
    for(let trial=0;trial<4;trial++){
    const placed:RuralBuilding[]=[];
    for(let i=0;i<target;i++){
      const ordered=candidates.slice().sort((a,b)=>{
        const score=(p:typeof a)=>p.priority*(.10+trial*.18)+(placed.length?Math.min(...placed.map(o=>Math.hypot(p.x-o.x,p.y-o.y))):-.15*Math.hypot(p.x,p.y));
        return score(b)-score(a);
      });
      for(const p of ordered){
        const building={x:p.x,y:p.y,width:base*scales[i],height:base*.69*scales[i],angle:p.angle,scale:scales[i],variant:(firstVariant+i)%4};
        if(valid(building,placed)){placed.push(building);break;}
      }
      if(placed.length!==i+1)break;
    }
    if(placed.length===target)return placed;
    if(placed.length>best.length)best=placed;
    }
    if(best.length>=minimum)return best;
  }
  throw new Error('No space for the minimum rural settlement size');
}
