(async()=>{
  const result=document.getElementById('result');
  try{
    const images={};
    await Promise.all(Object.entries(input.images).map(([key,url])=>new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>{images[key]=image;resolve();};image.onerror=reject;image.src=url;})));
    const compile=(gl,type,source)=>{const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));return s;};
    const makeProgram=(gl,version)=>{
      const prefix=version===2?'#version 300 es\n':'';
      const vertex=version===2?'in vec2 position;in vec2 texcoord;out vec2 uv0;out vec4 color;':'attribute vec2 position;attribute vec2 texcoord;varying vec2 uv0;varying vec4 color;';
      const v=prefix+'precision highp float;'+vertex+'void main(){gl_Position=vec4(position,0,1);uv0=texcoord;color=vec4(1);}';
      let f=input.body;
      if(version===1)f=f.replace(/\bin vec(\d) (\w+);/g,'varying vec$1 $2;').replace(/\btexture\(/g,'texture2D(')+'\nvoid main(){gl_FragColor=frag();}';
      else f+='\nlayout(location=0)out vec4 outputColor;void main(){outputColor=frag();}';
      const p=gl.createProgram();gl.attachShader(p,compile(gl,gl.VERTEX_SHADER,v));gl.attachShader(p,compile(gl,gl.FRAGMENT_SHADER,prefix+f));gl.linkProgram(p);
      if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(p));return p;
    };
    const gl1=document.createElement('canvas').getContext('webgl');if(!gl1)throw Error('WebGL1 unavailable');makeProgram(gl1,1);
    const canvas=document.getElementById('preview');canvas.width=850;canvas.height=570;
    const gl=canvas.getContext('webgl2',{premultipliedAlpha:true,preserveDrawingBuffer:true});if(!gl)throw Error('WebGL2 unavailable');
    const program=makeProgram(gl,2);gl.useProgram(program);gl.viewport(0,0,850,570);gl.enable(gl.BLEND);gl.blendFuncSeparate(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA,gl.ONE,gl.ONE_MINUS_SRC_ALPHA);
    const textures={};for(const[key,image]of Object.entries(images)){
      const texture=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,texture);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,image);
      for(const p of[gl.TEXTURE_MIN_FILTER,gl.TEXTURE_MAG_FILTER])gl.texParameteri(gl.TEXTURE_2D,p,gl.LINEAR);
      for(const p of[gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T])gl.texParameteri(gl.TEXTURE_2D,p,gl.CLAMP_TO_EDGE);textures[key]=texture;
    }
    const dirs=['e','se','sw','w','nw','ne'];
    const path=(edge,camera)=>`textures/terrain/elevation/${edge.blocked?'cliff':'slope'}_${dirs[edge.direction]}_c${camera}_v1/spriteFrame`;
    const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
    for(const[name,offset]of[['position',0],['texcoord',8]]){const a=gl.getAttribLocation(program,name);gl.enableVertexAttribArray(a);gl.vertexAttribPointer(a,2,gl.FLOAT,false,16,offset);}
    const uniform=(name,values)=>gl.uniform4fv(gl.getUniformLocation(program,name),values);
    const height=edge=>input.art.heightScale*Math.min(1.7,1+Math.log2(Math.max(1,Math.abs(edge.difference)))*.22);
    const draw=(scene,reverse,single=-1)=>{
      gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);
      const joins=single>=0?[scene.joins[single]]:reverse?[...scene.joins].reverse():scene.joins;
      for(const join of joins){
        const edge=join.edge,a=edge.direction*Math.PI/3,n=[Math.cos(a),-Math.sin(a)],t=[Math.sin(a),Math.cos(a)],h=height(edge);
        const center=[Math.sqrt(3)*(edge.high.pos.q+edge.high.pos.r/2)+n[0]*Math.sqrt(3)/2,-edge.high.pos.r*1.5+n[1]*Math.sqrt(3)/2];
        const vertices=[];for(const[u,v]of[[0,0],[1,0],[0,1],[1,1]]){
          const x=(center[0]+t[0]*(u-.5)*2+n[0]*(v-.5)*h)*48,y=-(center[1]+t[1]*(u-.5)*2+n[1]*(v-.5)*h)*48;
          vertices.push((x+70)/850*2-1,1-(y+60)/570*2,u,v);
        }
        gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(vertices),gl.STREAM_DRAW);uniform('mainInfo',[h,edge.direction,0,0]);
        for(let i=0;i<5;i++){
          const neighbor=join.neighbors[i-1],e=i===0?edge:neighbor?.edge??edge;
          gl.activeTexture(gl.TEXTURE0+i);gl.bindTexture(gl.TEXTURE_2D,textures[path(e,scene.camera)]);
          gl.uniform1i(gl.getUniformLocation(program,i===0?'cc_spriteTexture':`neighbor${i-1}`),i);
          if(i){uniform(`mapU${i-1}`,neighbor?.rowU??[0,0,0,0]);uniform(`mapV${i-1}`,neighbor?.rowV??[0,0,0,0]);}
        }
        gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
      }
      const data=new Uint8Array(850*570*4);gl.readPixels(0,0,850,570,gl.RGBA,gl.UNSIGNED_BYTE,data);return data;
    };
    const cases=[],previews=[];
    for(const scene of input.scenes){
      const forward=draw(scene,false),back=draw(scene,true);let max=0,covered=0,maxAt=0;
      for(let i=0;i<forward.length;i++){const error=Math.abs(forward[i]-back[i]);if(error>max){max=error;maxAt=i;}if(i%4===3&&forward[i]>0)covered++;}
      if(gl.getError()!==gl.NO_ERROR)throw Error('WebGL error in '+scene.name);
      if(covered<1000)throw Error('Missing slope coverage in '+scene.name);
      // Four 8-bit values allow subpixel interpolation at the ownership bisector, not a dark overlap seam.
      if(max>4){const at=maxAt-maxAt%4,owners=[];for(let i=0;i<scene.joins.length;i++){const pixel=draw(scene,false,i).slice(at,at+4);if(pixel[3])owners.push({edge:scene.joins[i].edge,neighbors:scene.joins[i].neighbors.map(n=>n.edge),pixel:Array.from(pixel)});}throw Error('Join depends on draw order in '+scene.name+': '+max+' at '+JSON.stringify({x:Math.floor(maxAt/4)%850,y:569-Math.floor(maxAt/4/850),owners}));}
      cases.push({name:scene.name,maxOrderError:max,coveredPixels:covered});
      if(scene.camera===0)previews.push({name:scene.name,png:canvas.toDataURL('image/png')});
    }
    result.textContent=JSON.stringify({passed:true,webgl1Compiled:true,webgl2Compiled:true,cases,previews});
  }catch(error){result.textContent=JSON.stringify({passed:false,error:String(error.stack||error)});}
})();
